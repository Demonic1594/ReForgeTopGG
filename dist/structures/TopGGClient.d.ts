/** The stats posted to Top.gg (the shape @top-gg/sdk 3.x used). */
export interface BotStats {
    serverCount: number;
    shardId?: number;
    shardCount?: number;
}
/** Top.gg's API, legacy routes (the ones @top-gg/sdk 3.x calls). */
export declare const TOPGG_API_URL = "https://top.gg/api";
/** A request that gets no answer in this many ms fails instead of waiting. */
export declare const TOPGG_REQUEST_TIMEOUT = 15000;
/** A non-2xx answer from Top.gg. The message is `<status> <text>`, as @top-gg/sdk 3.x wrote it. */
export declare class TopGGAPIError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, body: unknown);
}
export interface ITopGGClientOptions {
    /** Base URL, for tests. Defaults to {@link TOPGG_API_URL}. */
    baseUrl?: string;
    /** Defaults to {@link TOPGG_REQUEST_TIMEOUT}. */
    timeout?: number;
}
/**
 * The four Top.gg calls this extension makes, on Node's built-in fetch.
 * Replaces @top-gg/sdk 3.x, whose undici 5 dependency carries advisories that
 * an override in this package cannot fix for users. Requests, answers and
 * error messages are the ones the SDK used.
 */
export declare class TopGGClient {
    private readonly token;
    private readonly baseUrl;
    private readonly timeout;
    constructor(token: string, options?: ITopGGClientOptions);
    request(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<unknown>;
    hasVoted(id: string): Promise<boolean>;
    getBot(id: string): Promise<any>;
    isWeekend(): Promise<boolean>;
    postStats(stats: BotStats): Promise<BotStats>;
}
//# sourceMappingURL=TopGGClient.d.ts.map