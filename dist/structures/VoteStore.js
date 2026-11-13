"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForgeDBVoteStore = exports.MemoryVoteStore = void 0;
exports.applyVote = applyVote;
exports.currentStreak = currentStreak;
exports.recordToVote = recordToVote;
const Vote_1 = require("./Vote");
/** Folds a new vote into the user's record. Test votes must not be passed. */
function applyVote(previous, vote, streakGrace) {
    const continues = previous !== undefined && vote.votedAt <= previous.expiresAt + streakGrace;
    return {
        user: vote.user,
        target: (0, Vote_1.voteTarget)(vote),
        targetIsGuild: vote.guild !== undefined,
        count: (previous?.count ?? 0) + 1,
        points: (previous?.points ?? 0) + vote.weight,
        streak: continues ? previous.streak + 1 : 1,
        firstVoteAt: previous?.firstVoteAt ?? vote.votedAt,
        lastVoteAt: vote.votedAt,
        expiresAt: vote.expiresAt,
        lastWeight: vote.weight,
        reminded: false,
    };
}
/** The streak as it stands now: 0 once the user missed the chance to continue it. */
function currentStreak(record, now, streakGrace) {
    if (!record)
        return 0;
    return now <= record.expiresAt + streakGrace ? record.streak : 0;
}
/** Rebuilds the last vote of a record, for the voteReminder event. */
function recordToVote(record) {
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
    };
}
/**
 * Keeps records in memory, at most `max` users (the least recently voting
 * users are forgotten first). Everything is lost on restart.
 */
class MemoryVoteStore {
    max;
    records = new Map();
    constructor(max = 100_000) {
        this.max = max;
    }
    get size() {
        return this.records.size;
    }
    get(user) {
        const r = this.records.get(user);
        return r ? { ...r } : undefined;
    }
    set(record) {
        this.records.delete(record.user);
        this.records.set(record.user, { ...record });
        while (this.records.size > this.max)
            this.records.delete(this.records.keys().next().value);
    }
    pending() {
        return [...this.records.values()].filter((r) => !r.reminded).map((r) => ({ ...r }));
    }
}
exports.MemoryVoteStore = MemoryVoteStore;
/**
 * Keeps records in ForgeDB user variables (one JSON value per user, readable
 * with `$getUserVar[<name>;<user ID>]`). ForgeDB must be installed and loaded
 * as an extension; it is not a dependency of this package.
 */
class ForgeDBVoteStore {
    variable;
    load;
    db = null;
    constructor(variable = "topggVote", load = () => require("@tryforge/forge.db/dist/util").DataBase) {
        this.variable = variable;
        this.load = load;
    }
    /**
     * ForgeDB opens its database in the background after the bot starts. Wait for
     * it: briefly for a vote (the webhook must answer Top.gg within 5 s, and a
     * failure makes Top.gg deliver it again), longer when restoring reminders.
     */
    async database(waitMs) {
        this.db ??= this.load();
        const connected = () => !!this.db.db;
        for (const until = Date.now() + waitMs; !connected() && Date.now() < until;)
            await new Promise((r) => setTimeout(r, 50));
        if (!connected())
            throw new Error("ForgeDB is not connected yet");
        return this.db;
    }
    async get(user) {
        const row = await (await this.database(3_000)).get({ type: "user", name: this.variable, id: user });
        return row ? parseRecord(row.value) : undefined;
    }
    async set(record) {
        await (await this.database(3_000)).set({ type: "user", name: this.variable, id: record.user, value: JSON.stringify(record) });
    }
    async pending() {
        const rows = await (await this.database(60_000)).find({ type: "user", name: this.variable });
        return rows.map((r) => parseRecord(r.value)).filter((r) => !!r && !r.reminded);
    }
}
exports.ForgeDBVoteStore = ForgeDBVoteStore;
function parseRecord(value) {
    try {
        const r = typeof value === "string" ? JSON.parse(value) : value;
        return r && typeof r === "object" && typeof r.user === "string" && typeof r.expiresAt === "number" ? r : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=VoteStore.js.map