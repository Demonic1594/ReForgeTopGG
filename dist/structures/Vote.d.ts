/**
 * How long a Top.gg vote lasts before the user can vote again. The legacy
 * payload has no expiry, so it is derived from this: the SDK documents
 * `hasVoted` as "voted in the last 12 hours", and v1 payloads carry
 * `created_at` and `expires_at` 12 hours apart.
 */
export declare const VOTE_COOLDOWN: number;
/** The kinds of vote $voteType returns. */
export declare enum VoteType {
    /** A real vote. */
    upvote = "upvote",
    /** Sent by the test button on Top.gg or $sendTestVote. */
    test = "test"
}
/** A vote as the extension hands it to events and functions. */
export interface Vote {
    /** Discord ID of the voter. */
    user: string;
    /** Discord ID of the bot voted for (bot webhooks). */
    bot?: string;
    /** Discord ID of the server voted for (server webhooks). */
    guild?: string;
    /** `upvote` for a real vote, `test` for the dashboard's test button. */
    type: `${VoteType}`;
    /** Whether the weekend multiplier was active (the vote counts twice). */
    isWeekend: boolean;
    /** How many votes this one counts as: 2 on weekends, otherwise 1. */
    weight: number;
    /** Query parameters of the vote page URL. */
    query: Record<string, string>;
    /** When the vote was received (ms since epoch). */
    votedAt: number;
    /** When the user can vote again (ms since epoch). */
    expiresAt: number;
    /** Top.gg's ID of the vote (signed v1 webhooks only). */
    id?: string;
    /** Which webhook format delivered it. */
    source: "v0" | "v1";
}
export declare function isSnowflake(value: unknown): value is string;
/** A user ID as people write it in commands: `123...`, ` 123... `, `<@123...>` or `<@!123...>`. */
export declare function parseUserId(raw: string): string | null;
export declare function parseQuery(raw: unknown): Record<string, string>;
/**
 * Validates a legacy (v0) webhook body and turns it into a {@link Vote}.
 * Throws with a short reason when the body is not a usable vote.
 */
export declare function normalizeLegacyVote(body: unknown, now: number): Vote;
/**
 * Validates a signed (v1) webhook body and turns it into a {@link Vote}.
 * Returns `null` for event types that are not votes (they are acknowledged
 * and ignored). Throws with a short reason when the body is not usable.
 */
export declare function normalizeSignedVote(body: unknown, now: number): Vote | null;
/** The ID of what was voted for: the bot or the server. */
export declare function voteTarget(vote: Vote): string;
/** The vote an event is running for, or `undefined` outside vote events. */
export declare function currentVote(extras: unknown): Vote | undefined;
//# sourceMappingURL=Vote.d.ts.map