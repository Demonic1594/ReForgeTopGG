import { Api } from "@top-gg/sdk";
export type ApiResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
};
/**
 * Top.gg blocks a token for an hour once it sends more than 60 requests a
 * minute to /bots/* (its rate-limit docs). The extension stays below that with
 * its own budget, leaving room for stats posting.
 */
export declare const TOPGG_API_BUDGET = 50;
export declare const TOPGG_API_WINDOW = 60000;
/** How long answers are reused. A vote reaching the webhook clears that user's answer. */
export declare const API_CACHE_TTL: {
    voted: number;
    notVoted: number;
    bot: number;
    weekend: number;
};
/**
 * Wraps the Top.gg API client so callers can tell an answer apart from a
 * failed request. Identical requests in flight share one call, answers are
 * reused for a short time, and requests beyond the budget fail locally
 * instead of getting the token blocked. The token is never part of a message.
 */
export declare class TopGGApi {
    private readonly token?;
    private readonly now;
    readonly client: Api | null;
    private readonly sent;
    private readonly cache;
    private readonly pending;
    constructor(token?: string | undefined, now?: () => number);
    /** Requests Top.gg has been sent in the current window. */
    get used(): number;
    hasVoted(user: string): Promise<ApiResult<boolean>>;
    getBot(id: string): Promise<ApiResult<import("@top-gg/sdk").BotInfo>>;
    isWeekend(): Promise<ApiResult<boolean>>;
    /** Forgets every cached answer (the request budget is kept). */
    clearCache(): void;
    /** Drops a user's cached $hasVoted answer (their vote just arrived). */
    forget(user: string): void;
    private prune;
    private cached;
    request<T>(call: (api: Api) => Promise<T>): Promise<ApiResult<T>>;
}
//# sourceMappingURL=TopGGApi.d.ts.map