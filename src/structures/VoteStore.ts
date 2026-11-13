import { Vote, voteTarget } from "./Vote"

/** What the extension remembers about one user's votes. */
export interface VoteRecord {
    /** Discord ID of the voter. */
    user: string
    /** The bot or server voted for last. */
    target: string
    /** Whether `target` is a server. */
    targetIsGuild: boolean
    /** Votes recorded (test votes are not). */
    count: number
    /** Votes recorded, counting weekend votes twice. */
    points: number
    /** Votes in a row, each cast at most `streakGrace` after the previous one expired. */
    streak: number
    firstVoteAt: number
    lastVoteAt: number
    /** When the user can vote again. */
    expiresAt: number
    /** Weight of the last vote. */
    lastWeight: number
    /** Whether the reminder for the last vote was sent. */
    reminded: boolean
}

/**
 * Where vote records are kept. Implement this to keep them in your own
 * database; methods may be synchronous or return promises.
 */
export interface VoteStore {
    get(user: string): Promise<VoteRecord | undefined> | VoteRecord | undefined
    set(record: VoteRecord): Promise<void> | void
    /**
     * Records whose reminder has not been sent yet. Used to schedule reminders
     * again after a restart; stores that lose data on restart can omit it.
     */
    pending?(): Promise<VoteRecord[]> | VoteRecord[]
}

/** Folds a new vote into the user's record. Test votes must not be passed. */
export function applyVote(previous: VoteRecord | undefined, vote: Vote, streakGrace: number): VoteRecord {
    const continues = previous !== undefined && vote.votedAt <= previous.expiresAt + streakGrace
    return {
        user: vote.user,
        target: voteTarget(vote),
        targetIsGuild: vote.guild !== undefined,
        count: (previous?.count ?? 0) + 1,
        points: (previous?.points ?? 0) + vote.weight,
        streak: continues ? previous.streak + 1 : 1,
        firstVoteAt: previous?.firstVoteAt ?? vote.votedAt,
        lastVoteAt: vote.votedAt,
        expiresAt: vote.expiresAt,
        lastWeight: vote.weight,
        reminded: false,
    }
}

/** The streak as it stands now: 0 once the user missed the chance to continue it. */
export function currentStreak(record: VoteRecord | undefined, now: number, streakGrace: number): number {
    if (!record) return 0
    return now <= record.expiresAt + streakGrace ? record.streak : 0
}

/** Rebuilds the last vote of a record, for the voteReminder event. */
export function recordToVote(record: VoteRecord): Vote {
    return {
        user: record.user,
        ...(record.targetIsGuild ? { guild: record.target } : { bot: record.target }),
        type: "upvote",
        isWeekend: record.lastWeight > 1,
        weight: record.lastWeight,
        query: {},
        votedAt: record.lastVoteAt,
        expiresAt: record.expiresAt,
        source: "v0",
    }
}

/**
 * Keeps records in memory, at most `max` users (the least recently voting
 * users are forgotten first). Everything is lost on restart.
 */
export class MemoryVoteStore implements VoteStore {
    private readonly records = new Map<string, VoteRecord>()

    constructor(private readonly max = 100_000) {}

    get size() {
        return this.records.size
    }

    get(user: string) {
        const r = this.records.get(user)
        return r ? { ...r } : undefined
    }

    set(record: VoteRecord) {
        this.records.delete(record.user)
        this.records.set(record.user, { ...record })
        while (this.records.size > this.max) this.records.delete(this.records.keys().next().value!)
    }

    pending() {
        return [...this.records.values()].filter((r) => !r.reminded).map((r) => ({ ...r }))
    }
}

/** Minimal shape of ForgeDB's DataBase class used here. */
interface ForgeDBDataBase {
    get(data: { type: string; name: string; id: string }): Promise<{ value: string } | null>
    set(data: { type: string; name: string; id: string; value: string }): Promise<void>
    find(data: { type: string; name: string }): Promise<Array<{ value: string }>>
}

/**
 * Keeps records in ForgeDB user variables (one JSON value per user, readable
 * with `$getUserVar[<name>;<user ID>]`). ForgeDB must be installed and loaded
 * as an extension; it is not a dependency of this package.
 */
export class ForgeDBVoteStore implements VoteStore {
    private db: ForgeDBDataBase | null = null

    constructor(public readonly variable = "topggVote", private readonly load = () => require("@tryforge/forge.db/dist/util").DataBase as ForgeDBDataBase) {}

    /**
     * ForgeDB opens its database in the background after the bot starts. Wait for
     * it: briefly for a vote (the webhook must answer Top.gg within 5 s, and a
     * failure makes Top.gg deliver it again), longer when restoring reminders.
     */
    private async database(waitMs: number): Promise<ForgeDBDataBase> {
        this.db ??= this.load()
        const connected = () => !!(this.db as unknown as { db?: unknown }).db
        for (const until = Date.now() + waitMs; !connected() && Date.now() < until;) await new Promise((r) => setTimeout(r, 50))
        if (!connected()) throw new Error("ForgeDB is not connected yet")
        return this.db
    }

    async get(user: string) {
        const row = await (await this.database(3_000)).get({ type: "user", name: this.variable, id: user })
        return row ? parseRecord(row.value) : undefined
    }

    async set(record: VoteRecord) {
        await (await this.database(3_000)).set({ type: "user", name: this.variable, id: record.user, value: JSON.stringify(record) })
    }

    async pending() {
        const rows = await (await this.database(60_000)).find({ type: "user", name: this.variable })
        return rows.map((r) => parseRecord(r.value)).filter((r): r is VoteRecord => !!r && !r.reminded)
    }
}

function parseRecord(value: unknown): VoteRecord | undefined {
    try {
        const r = typeof value === "string" ? JSON.parse(value) : value
        return r && typeof r === "object" && typeof r.user === "string" && typeof r.expiresAt === "number" ? r : undefined
    } catch {
        return undefined
    }
}
