import type { Client } from "discord.js";
import { TypedEmitter } from "tiny-typed-emitter";
import { BotStats } from "./TopGGClient";
/** Default time between two posts (topgg-autoposter's default). */
export declare const DEFAULT_POST_INTERVAL = 1800000;
/** The first post waits this long after the client is ready. */
export declare const POST_ON_START_DELAY = 5000;
export interface PosterOptions {
    /** Time between posts in ms, at least 900000 (15 minutes). Defaults to 30 minutes. */
    interval?: number;
    /** Post 5 seconds after start instead of waiting a full interval. Defaults to true. */
    postOnStart?: boolean;
    /** Start posting when the client is ready. Defaults to true. */
    startPosting?: boolean;
    /** Something with a `postStats(stats)` method to post with, in place of the built-in client. */
    sdk?: {
        postStats(stats: BotStats): Promise<unknown>;
    };
}
interface IPosterEvents {
    posted: (stats: BotStats) => void;
    error: (err: Error) => void;
}
/**
 * Posts a discord.js client's server count to Top.gg on an interval.
 * Replaces topgg-autoposter (which depends on @top-gg/sdk 3.x) for the one
 * client this extension posts for. Its timers are unref'd, and `stop()` also
 * cancels a first post that is still waiting.
 */
export declare class StatsPoster extends TypedEmitter<IPosterEvents> {
    private readonly client;
    private readonly options;
    started: boolean;
    readonly interval: number;
    private readonly api;
    private timer;
    private first;
    constructor(token: string, client: Client, options?: PosterOptions);
    /** Starts posting now if the client is connected. Returns whether it started. */
    start(): boolean;
    /** Whether a timer (the interval or the first post) is still set. */
    get scheduled(): boolean;
    stop(): void;
    stats(): BotStats;
    /** Posts once. Never throws: the outcome is a `posted` or an `error` event. */
    post(): Promise<void>;
}
export {};
//# sourceMappingURL=StatsPoster.d.ts.map