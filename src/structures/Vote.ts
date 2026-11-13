/**
 * How long a Top.gg vote lasts before the user can vote again. The legacy
 * payload has no expiry, so it is derived from this: the SDK documents
 * `hasVoted` as "voted in the last 12 hours", and v1 payloads carry
 * `created_at` and `expires_at` 12 hours apart.
 */
export const VOTE_COOLDOWN = 12 * 60 * 60 * 1000

/** The kinds of vote $voteType returns. */
export enum VoteType {
    /** A real vote. */
    upvote = "upvote",
    /** Sent by the test button on Top.gg or $sendTestVote. */
    test = "test",
}

/** A vote as the extension hands it to events and functions. */
export interface Vote {
    /** Discord ID of the voter. */
    user: string
    /** Discord ID of the bot voted for (bot webhooks). */
    bot?: string
    /** Discord ID of the server voted for (server webhooks). */
    guild?: string
    /** `upvote` for a real vote, `test` for the dashboard's test button. */
    type: `${VoteType}`
    /** Whether the weekend multiplier was active (the vote counts twice). */
    isWeekend: boolean
    /** How many votes this one counts as: 2 on weekends, otherwise 1. */
    weight: number
    /** Query parameters of the vote page URL. */
    query: Record<string, string>
    /** When the vote was received (ms since epoch). */
    votedAt: number
    /** When the user can vote again (ms since epoch). */
    expiresAt: number
    /** Top.gg's ID of the vote (signed v1 webhooks only). */
    id?: string
    /** Which webhook format delivered it. */
    source: "v0" | "v1"
}

const SNOWFLAKE = /^\d{15,22}$/

export function isSnowflake(value: unknown): value is string {
    return typeof value === "string" && SNOWFLAKE.test(value)
}

export function parseQuery(raw: unknown): Record<string, string> {
    if (raw === undefined || raw === null || raw === "") return {}
    if (typeof raw === "string") return Object.fromEntries(new URLSearchParams(raw))
    if (typeof raw === "object" && !Array.isArray(raw)) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v
        return out
    }
    throw new Error("query must be a string")
}

/**
 * Validates a legacy (v0) webhook body and turns it into a {@link Vote}.
 * Throws with a short reason when the body is not a usable vote.
 */
export function normalizeLegacyVote(body: unknown, now: number): Vote {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body must be a JSON object")
    const b = body as Record<string, unknown>
    if (!isSnowflake(b.user)) throw new Error("user must be a Discord ID")
    if (b.bot !== undefined && !isSnowflake(b.bot)) throw new Error("bot must be a Discord ID")
    if (b.guild !== undefined && !isSnowflake(b.guild)) throw new Error("guild must be a Discord ID")
    if (b.bot === undefined && b.guild === undefined) throw new Error("bot or guild is required")
    if (b.type !== "upvote" && b.type !== "test") throw new Error("type must be upvote or test")
    if (b.isWeekend !== undefined && typeof b.isWeekend !== "boolean") throw new Error("isWeekend must be a boolean")
    const isWeekend = b.isWeekend === true
    return {
        user: b.user,
        bot: b.bot as string | undefined,
        guild: b.guild as string | undefined,
        type: b.type,
        isWeekend,
        weight: isWeekend ? 2 : 1,
        query: parseQuery(b.query),
        votedAt: now,
        expiresAt: now + VOTE_COOLDOWN,
        source: "v0",
    }
}

/**
 * Validates a signed (v1) webhook body and turns it into a {@link Vote}.
 * Returns `null` for event types that are not votes (they are acknowledged
 * and ignored). Throws with a short reason when the body is not usable.
 */
export function normalizeSignedVote(body: unknown, now: number): Vote | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body must be a JSON object")
    const b = body as { type?: unknown; data?: any }
    if (b.type !== "vote.create" && b.type !== "webhook.test") return null
    const d = b.data
    if (!d || typeof d !== "object") throw new Error("data is missing")
    const user = d.user?.platform_id
    if (!isSnowflake(user)) throw new Error("data.user.platform_id must be a Discord ID")
    const project = d.project
    const target = project?.platform_id
    if (!isSnowflake(target)) throw new Error("data.project.platform_id must be a Discord ID")
    if (project.type !== "bot" && project.type !== "server") throw new Error("data.project.type must be bot or server")
    const isVote = b.type === "vote.create"
    let votedAt = now
    let expiresAt = now + VOTE_COOLDOWN
    let weight = 1
    if (isVote) {
        if (typeof d.id !== "string" || d.id === "") throw new Error("data.id is missing")
        votedAt = Date.parse(d.created_at)
        expiresAt = Date.parse(d.expires_at)
        if (!Number.isFinite(votedAt) || !Number.isFinite(expiresAt)) throw new Error("data.created_at and data.expires_at must be dates")
        weight = d.weight
        if (!Number.isInteger(weight) || weight < 1) throw new Error("data.weight must be a positive whole number")
    }
    return {
        user,
        ...(project.type === "server" ? { guild: target } : { bot: target }),
        type: isVote ? "upvote" : "test",
        isWeekend: weight > 1,
        weight,
        query: isVote ? parseQuery(d.query) : {},
        votedAt,
        expiresAt,
        ...(isVote ? { id: d.id } : {}),
        source: "v1",
    }
}

/** The ID of what was voted for: the bot or the server. */
export function voteTarget(vote: Vote): string {
    return (vote.bot ?? vote.guild)!
}

/** The vote an event is running for, or `undefined` outside vote events. */
export function currentVote(extras: unknown): Vote | undefined {
    if (!extras || typeof extras !== "object") return undefined
    const v = extras as Partial<Vote>
    return (v.source === "v0" || v.source === "v1") && typeof v.user === "string" ? (v as Vote) : undefined
}
