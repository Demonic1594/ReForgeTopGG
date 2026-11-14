import { ForgeClient, ForgeExtension } from "@tryforge/forgescript";
import { IncomingMessage, Server, ServerResponse } from "http";
import type { PosterOptions } from "topgg-autoposter/dist/typings";
import { TypedEmitter } from "tiny-typed-emitter";
import { TopGGCommandManager } from "./structures/TopGGCommandManager";
import { ITopGGEvents } from "./structures/TopGGEventHandlers";
import { VoteWebhook } from "./structures/VoteWebhook";
import { Vote } from "./structures/Vote";
import { VoteRecord, VoteStore } from "./structures/VoteStore";
import { TopGGApi } from "./structures/TopGGApi";
export * from "./structures/Vote";
export * from "./structures/VoteWebhook";
export * from "./structures/TopGGApi";
export * from "./structures/Dedupe";
export * from "./structures/KeyedLock";
export * from "./structures/VoteStore";
export * from "./structures/Reminders";
/** Top.gg refuses to be posted to more often than every 15 minutes. */
export declare const MIN_POST_INTERVAL = 900000;
export declare const DEFAULT_PORT = 3000;
export declare const DEFAULT_PATH = "/dblwebhook";
/** Top.gg retries a legacy delivery up to 10 times over about half an hour. */
export declare const DEFAULT_DEDUPE_WINDOW = 3600000;
/** A streak continues when the next vote comes at most this long after the user could vote again. */
export declare const DEFAULT_STREAK_GRACE: number;
export interface IWebhookOptions {
    /** Port to listen on. Defaults to the top-level `port`, then 3000. A numeric string (from .env) works. */
    port?: number | string;
    /** Address to listen on. Defaults to all interfaces. */
    host?: string;
    /** URL path Top.gg posts to. Defaults to `/dblwebhook`. */
    path?: string;
    /**
     * Whether to open a port. Set to `false` to mount `webhookListener` on a
     * server of your own instead. Defaults to `true`.
     */
    listen?: boolean;
    /** Largest accepted request body in bytes. Defaults to 16384. */
    maxBodySize?: number;
    /**
     * The v1 webhook secret (`whs_...`) from your project's Webhooks page on
     * Top.gg. Signed deliveries are checked with it; the webhook starts when
     * this or `auth` is set.
     */
    secret?: string | null;
}
export interface IReForgeTopGGOptions {
    /** Your Top.gg API token. Needed for posting stats and the API functions. */
    token?: string | null;
    /**
     * The webhook authorization you set on Top.gg. The webhook only starts
     * when this is set, and an empty value is refused.
     */
    auth?: string | number | null;
    /** Port of the vote webhook. Same as `webhook.port`. Defaults to 3000. A numeric string (from .env) works. */
    port?: number | string;
    /** Webhook settings, or `false` to never start the webhook. */
    webhook?: IWebhookOptions | false;
    /** Post server counts to Top.gg. Requires `token`. */
    post?: PosterOptions | false;
    /** Events your commands listen to. */
    events?: Array<keyof ITopGGEvents>;
    /**
     * Top.gg delivers a vote again when it gets no 2xx answer in time. A vote
     * of the same user for the same bot within this many ms is dropped as a
     * repeat. Defaults to 1 hour, 0 turns it off, at most 11 hours (a user can
     * only vote every 12). Test votes are collapsed for 1 minute at most.
     */
    dedupeWindow?: number;
    /**
     * Where vote history is kept: `"memory"` (default, lost on restart, at
     * most 100,000 users), `"forgedb"` (ForgeDB user variables, needs the
     * ForgeDB extension), or your own {@link VoteStore}.
     */
    store?: "memory" | "forgedb" | VoteStore;
    /** ForgeDB variable name used by the `"forgedb"` store. Defaults to `topggVote`. */
    storeVariable?: string;
    /**
     * How long after a user could vote again a new vote still continues their
     * streak. Defaults to 12 hours.
     */
    streakGrace?: number;
    /**
     * Fire the voteReminder event when a user who voted can vote again.
     * Defaults to `false`.
     */
    reminders?: boolean;
}
/** @deprecated Use {@link IReForgeTopGGOptions}. */
export type IForgeTopGGOptions = IReForgeTopGGOptions;
export type TransformEvents<T> = {
    [P in keyof T]: T[P] extends any[] ? (...args: T[P]) => any : never;
};
/**
 * The client's ready event. discord.js 14.22+ emits "clientReady" and prints a deprecation warning
 * when anything listens to "ready" (gone in v15); older versions only emit "ready". Events.ClientReady
 * holds the right name for the installed version.
 */
export declare function readyEventName(): string;
export declare class ReForgeTopGG extends ForgeExtension {
    name: string;
    description: string;
    version: any;
    private client;
    readonly emitter: TypedEmitter<TransformEvents<ITopGGEvents>>;
    commands: TopGGCommandManager;
    /** The vote webhook, or `null` when it is disabled. */
    readonly webhook: VoteWebhook | null;
    /** The HTTP server, once it listens. */
    server: Server | null;
    /** Top.gg API access for the API functions. */
    readonly api: TopGGApi;
    private poster;
    private readonly seen;
    /** Deliveries being processed, by dedupe key: a repeat waits for the first one's outcome. */
    private readonly inFlight;
    /** One history update per user at a time. */
    private readonly userLock;
    private closed;
    /** Where vote history is kept. */
    readonly store: VoteStore;
    private readonly reminders;
    /** The options, with values from .env or JSON configs normalized (see normalizeOptions). */
    readonly options: IReForgeTopGGOptions;
    private refused;
    constructor(rawOptions?: IReForgeTopGGOptions);
    /**
     * Refused requests are not events (anyone can send them), but a webhook that
     * refuses everything usually means the secret does not match Top.gg's: log
     * a count, at most once a minute.
     */
    private noteRefused;
    private get webhookOptions();
    private get webhookEnabled();
    /**
     * Node request listener for the webhook, for mounting on your own server
     * (`webhook: { listen: false }`). Answers 404 when the webhook is disabled.
     */
    get webhookListener(): (req: IncomingMessage, res: ServerResponse) => void;
    /**
     * ForgeScript catches and only logs errors thrown by init(), and the bot
     * keeps running half set up. Problems that must stop the bot are checked
     * here instead, where an error does reach the ForgeClient constructor.
     */
    protected validateAndInit(client: ForgeClient): void;
    init(client: ForgeClient): void;
    private listen;
    /**
     * Handles a vote that passed authentication and validation. Public so a
     * webhook mounted elsewhere, or a test, can feed votes in.
     */
    receive(vote: Vote): Promise<boolean>;
    private process;
    /** Emits without letting a listener's exception escape (into the webhook, a timer or the server). */
    private safeEmit;
    get streakGrace(): number;
    /** The vote history of a user, if any. */
    getRecord(user: string): Promise<VoteRecord | undefined>;
    private remind;
    private restoreReminders;
    /**
     * Sends a test vote to the running webhook over HTTP, exactly as Top.gg
     * would (signed when a v1 secret is set). Resolves with the HTTP status.
     * Test votes run the voted event with $voteType "test" and are not stored.
     */
    sendTestVote(options: {
        user: string;
        weekend?: boolean;
        query?: string;
    }): Promise<number>;
    private emitError;
    /** Stops the webhook server and stats posting. Called by `client.destroy()`. */
    close(): Promise<void>;
}
/** @deprecated Kept so code written for forge.topgg keeps working. Use {@link ReForgeTopGG}. */
export declare const ForgeTopGG: typeof ReForgeTopGG;
/** @deprecated */
export type ForgeTopGG = ReForgeTopGG;
/** The events the extension can emit. */
export declare const TOPGG_EVENTS: readonly ["voted", "voteReminder", "posted", "error"];
/**
 * Values that come from .env files or JSON configs, made usable: a numeric
 * string port becomes a number, a numeric auth a string, and null means "not
 * set". Anything else is left for validateOptions to refuse.
 */
export declare function normalizeOptions(raw: IReForgeTopGGOptions): IReForgeTopGGOptions;
//# sourceMappingURL=index.d.ts.map