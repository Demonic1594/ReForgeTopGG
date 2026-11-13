import { EventManager, ForgeClient, ForgeExtension, Logger } from "@tryforge/forgescript"
import { createServer, IncomingMessage, request, Server, ServerResponse } from "http"
import { AutoPoster as autoPoster } from "topgg-autoposter"
import type { PosterOptions } from "topgg-autoposter/dist/typings"
import type { BasePoster } from "topgg-autoposter/dist/structs/BasePoster"
import { TypedEmitter } from "tiny-typed-emitter"
import { TopGGEventManagerName } from "./constants"
import { TopGGCommandManager } from "./structures/TopGGCommandManager"
import { ITopGGEvents } from "./structures/TopGGEventHandlers"
import { signBody, VoteWebhook } from "./structures/VoteWebhook"
import { isSnowflake, Vote } from "./structures/Vote"
import { applyVote, ForgeDBVoteStore, MemoryVoteStore, recordToVote, VoteRecord, VoteStore } from "./structures/VoteStore"
import { ReminderScheduler } from "./structures/Reminders"
import { TopGGApi } from "./structures/TopGGApi"
import { DedupeCache, dedupeKey, TEST_DEDUPE_WINDOW } from "./structures/Dedupe"

export * from "./structures/Vote"
export * from "./structures/VoteWebhook"
export * from "./structures/TopGGApi"
export * from "./structures/Dedupe"
export * from "./structures/VoteStore"
export * from "./structures/Reminders"

/** Top.gg refuses to be posted to more often than every 15 minutes. */
export const MIN_POST_INTERVAL = 900_000
export const DEFAULT_PORT = 3000
export const DEFAULT_PATH = "/dblwebhook"
/** Top.gg retries a legacy delivery up to 10 times over about half an hour. */
export const DEFAULT_DEDUPE_WINDOW = 3_600_000
/** A streak continues when the next vote comes at most this long after the user could vote again. */
export const DEFAULT_STREAK_GRACE = 12 * 3_600_000

export interface IWebhookOptions {
    /** Port to listen on. Defaults to the top-level `port`, then 3000. */
    port?: number
    /** Address to listen on. Defaults to all interfaces. */
    host?: string
    /** URL path Top.gg posts to. Defaults to `/dblwebhook`. */
    path?: string
    /**
     * Whether to open a port. Set to `false` to mount `webhookListener` on a
     * server of your own instead. Defaults to `true`.
     */
    listen?: boolean
    /** Largest accepted request body in bytes. Defaults to 16384. */
    maxBodySize?: number
    /**
     * The v1 webhook secret (`whs_...`) from your project's Webhooks page on
     * Top.gg. Signed deliveries are checked with it; the webhook starts when
     * this or `auth` is set.
     */
    secret?: string
}

export interface IReForgeTopGGOptions {
    /** Your Top.gg API token. Needed for posting stats and the API functions. */
    token?: string
    /**
     * The webhook authorization you set on Top.gg. The webhook only starts
     * when this is set, and an empty value is refused.
     */
    auth?: string
    /** Port of the vote webhook. Same as `webhook.port`. Defaults to 3000. */
    port?: number
    /** Webhook settings, or `false` to never start the webhook. */
    webhook?: IWebhookOptions | false
    /** Post server counts to Top.gg. Requires `token`. */
    post?: PosterOptions | false
    /** Events your commands listen to. */
    events?: Array<keyof ITopGGEvents>
    /**
     * Top.gg delivers a vote again when it gets no 2xx answer in time. A vote
     * of the same user for the same bot within this many ms is dropped as a
     * repeat. Defaults to 1 hour, 0 turns it off, at most 11 hours (a user can
     * only vote every 12). Test votes are collapsed for 1 minute at most.
     */
    dedupeWindow?: number
    /**
     * Where vote history is kept: `"memory"` (default, lost on restart, at
     * most 100,000 users), `"forgedb"` (ForgeDB user variables, needs the
     * ForgeDB extension), or your own {@link VoteStore}.
     */
    store?: "memory" | "forgedb" | VoteStore
    /** ForgeDB variable name used by the `"forgedb"` store. Defaults to `topggVote`. */
    storeVariable?: string
    /**
     * How long after a user could vote again a new vote still continues their
     * streak. Defaults to 12 hours.
     */
    streakGrace?: number
    /**
     * Fire the voteReminder event when a user who voted can vote again.
     * Defaults to `false`.
     */
    reminders?: boolean
}

/** @deprecated Use {@link IReForgeTopGGOptions}. */
export type IForgeTopGGOptions = IReForgeTopGGOptions

export type TransformEvents<T> = {
    [P in keyof T]: T[P] extends any[] ? (...args: T[P]) => any : never
}

/**
 * The client's ready event. discord.js 14.22+ emits "clientReady" and prints a deprecation warning
 * when anything listens to "ready" (gone in v15); older versions only emit "ready". Events.ClientReady
 * holds the right name for the installed version.
 */
export function readyEventName(): string {
    try {
        return require("discord.js").Events?.ClientReady ?? "ready"
    } catch {
        return "ready"
    }
}

/** Names of extensions that register the same functions and cannot run alongside. */
const CONFLICTING_EXTENSIONS = ["forge.topgg"]

export class ReForgeTopGG extends ForgeExtension {
    name = "reforge.topgg"
    description = "Posts your bot stats to Top.gg and receives votes from it, safely."
    version = require("../package.json").version

    private client!: ForgeClient
    public readonly emitter = new TypedEmitter<TransformEvents<ITopGGEvents>>()
    public commands!: TopGGCommandManager

    /** The vote webhook, or `null` when it is disabled. */
    public readonly webhook: VoteWebhook | null
    /** The HTTP server, once it listens. */
    public server: Server | null = null
    /** Top.gg API access for the API functions. */
    public readonly api: TopGGApi
    private poster: BasePoster | null = null
    private readonly seen = new DedupeCache()
    private readonly inFlight = new Set<string>()
    private closed = false
    /** Where vote history is kept. */
    public readonly store: VoteStore
    private readonly reminders: ReminderScheduler | null

    public constructor(public readonly options: IReForgeTopGGOptions = {}) {
        super()
        validateOptions(options)
        this.api = new TopGGApi(options.token)
        this.store = options.store === "forgedb"
            ? new ForgeDBVoteStore(options.storeVariable)
            : typeof options.store === "object" ? options.store : new MemoryVoteStore()
        this.reminders = options.reminders ? new ReminderScheduler((user, expiresAt) => void this.remind(user, expiresAt)) : null
        this.webhook = this.webhookEnabled
            ? new VoteWebhook({
                auth: options.auth,
                secret: this.webhookOptions.secret,
                maxBodySize: this.webhookOptions.maxBodySize,
                onVote: (vote) => this.receive(vote),
                onError: (err) => this.emitError(err),
            })
            : null
    }

    private get webhookOptions(): IWebhookOptions {
        return this.options.webhook || {}
    }

    private get webhookEnabled(): boolean {
        return this.options.webhook !== false && (typeof this.options.auth === "string" || typeof this.webhookOptions.secret === "string")
    }

    /**
     * Node request listener for the webhook, for mounting on your own server
     * (`webhook: { listen: false }`). Answers 404 when the webhook is disabled.
     */
    public get webhookListener(): (req: IncomingMessage, res: ServerResponse) => void {
        return (req, res) => {
            if (!this.webhook) {
                res.writeHead(404).end()
                return
            }
            this.webhook.listener(req, res)
        }
    }

    /**
     * ForgeScript catches and only logs errors thrown by init(), and the bot
     * keeps running half set up. Problems that must stop the bot are checked
     * here instead, where an error does reach the ForgeClient constructor.
     */
    protected override validateAndInit(client: ForgeClient): void {
        const conflict = client.options.extensions?.find((x) => CONFLICTING_EXTENSIONS.includes(x.name))
        if (conflict) {
            throw new Error(`ReForgeTopGG cannot run alongside ${conflict.name}: both register $hasVoted, $voteUserID and the vote events. Remove ${conflict.name} from your extensions and uninstall it.`)
        }
        if (this.options.store === "forgedb" && !client.options.extensions?.some((x) => x.name === "forge.db")) {
            throw new Error("ReForgeTopGG: store \"forgedb\" needs the ForgeDB extension (npm i @tryforge/forge.db, then add new ForgeDB() to your extensions).")
        }
        super.validateAndInit(client)
    }

    init(client: ForgeClient): void {
        this.client = client
        this.commands = new TopGGCommandManager(client)

        EventManager.load(TopGGEventManagerName, __dirname + "/events")
        this.load(__dirname + "/native")

        if (this.options.events?.length) this.client.events.load(TopGGEventManagerName, this.options.events)

        if (this.options.post) {
            const post = this.options.post
            this.client.once(readyEventName() as "ready", (ready) => {
                if (this.closed || this.poster) return
                try {
                    const poster = autoPoster(this.options.token!, ready, post)
                    // topgg-autoposter starts its interval a microtask after it is created; a close()
                    // in between would stop nothing and the interval would keep the process alive.
                    const start = poster.start.bind(poster)
                    poster.start = () => {
                        if (!this.closed) start()
                    }
                    poster.on("error", (err) => this.emitError(err))
                    poster.on("posted", (stats) => this.emitter.emit("posted", stats))
                    this.poster = poster
                } catch (err) {
                    this.emitError(new Error(`Top.gg stats posting could not start: ${(err as Error).message}`))
                }
            })
        }

        if (this.webhook && this.webhookOptions.listen !== false) this.listen()
        else if (!this.webhook) Logger.info("ReForgeTopGG: no webhook auth or secret set, vote webhook is off")

        if (this.reminders && this.store.pending) {
            // Reschedule reminders a persistent store still holds.
            this.client.once(readyEventName() as "ready", () => void this.restoreReminders())
        }

        // ForgeExtension has no shutdown hook: close with the client.
        const destroy = client.destroy.bind(client)
        client.destroy = async () => {
            await this.close()
            return destroy()
        }
    }

    private listen() {
        const port = this.webhookOptions.port ?? this.options.port ?? DEFAULT_PORT
        const host = this.webhookOptions.host
        const path = this.webhookOptions.path ?? DEFAULT_PATH
        const server = createServer((req, res) => {
            const url = (req.url ?? "/").split("?")[0]
            if (url !== path) {
                req.resume()
                res.writeHead(404).end()
                return
            }
            this.webhook!.listener(req, res)
        })
        // Slow or stalled clients cannot hold connections open for long.
        server.headersTimeout = 10_000
        server.requestTimeout = 15_000
        server.on("error", (err: NodeJS.ErrnoException) => {
            const reason = err.code === "EADDRINUSE"
                ? `port ${port} is already in use (set another one with the "port" option)`
                : err.code === "EACCES"
                    ? `no permission to use port ${port}`
                    : err.message
            this.server = null
            this.emitError(new Error(`Top.gg vote webhook could not start: ${reason}`))
        })
        server.listen({ port, host }, () => {
            const address = server.address()
            const actual = typeof address === "object" && address ? address.port : port
            Logger.info(`ReForgeTopGG: vote webhook listening on port ${actual}, path ${path}`)
        })
        this.server = server
    }

    /**
     * Handles a vote that passed authentication and validation. Public so a
     * webhook mounted elsewhere, or a test, can feed votes in.
     */
    public async receive(vote: Vote): Promise<boolean> {
        const key = dedupeKey(vote)
        if (this.seen.has(key) || this.inFlight.has(key)) return false
        this.inFlight.add(key)
        try {
            // Test votes are not history. A failed write throws, the webhook
            // answers 500 and Top.gg delivers the vote again.
            if (vote.type === "upvote") {
                const record = applyVote(await this.store.get(vote.user), vote, this.streakGrace)
                await this.store.set(record)
                this.reminders?.schedule(record.user, record.expiresAt)
            }
            const window = this.options.dedupeWindow ?? DEFAULT_DEDUPE_WINDOW
            this.seen.add(key, vote.type === "test" ? Math.min(window, TEST_DEDUPE_WINDOW) : window)
        } finally {
            this.inFlight.delete(key)
        }
        this.emitter.emit("voted", vote)
        return true
    }

    public get streakGrace(): number {
        return this.options.streakGrace ?? DEFAULT_STREAK_GRACE
    }

    /** The vote history of a user, if any. */
    public async getRecord(user: string): Promise<VoteRecord | undefined> {
        return (await this.store.get(user)) ?? undefined
    }

    private async remind(user: string, expiresAt: number) {
        if (this.closed) return
        try {
            const record = await this.store.get(user)
            // A newer vote moved the reminder, or it was already sent.
            if (!record || record.reminded || record.expiresAt !== expiresAt) return
            record.reminded = true
            await this.store.set(record)
            this.emitter.emit("voteReminder", recordToVote(record))
        } catch (err) {
            this.emitError(new Error(`Vote reminder for ${user} failed: ${(err as Error).message}`))
        }
    }

    private async restoreReminders() {
        try {
            for (const record of await this.store.pending!()) this.reminders?.schedule(record.user, record.expiresAt)
        } catch (err) {
            this.emitError(new Error(`Vote reminders could not be restored: ${(err as Error).message}`))
        }
    }

    /**
     * Sends a test vote to the running webhook over HTTP, exactly as Top.gg
     * would (signed when a v1 secret is set). Resolves with the HTTP status.
     * Test votes run the voted event with $voteType "test" and are not stored.
     */
    public async sendTestVote(options: { user: string; weekend?: boolean; query?: string }): Promise<number> {
        if (!isSnowflake(options.user)) throw new Error(`"${options.user}" is not a user ID`)
        const server = this.server
        const address = server?.listening ? server.address() : null
        if (!address || typeof address !== "object") throw new Error("The vote webhook is not listening")
        const target = this.client?.user?.id ?? "0".repeat(18)
        const secret = this.webhookOptions.secret
        const now = Date.now()
        const body = secret
            ? JSON.stringify({
                type: "webhook.test",
                data: { user: { id: options.user, platform_id: options.user }, project: { id: target, type: "bot", platform: "discord", platform_id: target } },
            })
            : JSON.stringify({ user: options.user, bot: target, type: "test", isWeekend: !!options.weekend, query: options.query ?? "" })
        const headers: Record<string, string> = { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }
        if (secret) headers["x-topgg-signature"] = signBody(body, secret, now)
        else headers.authorization = this.options.auth!
        const host = address.address === "::" || address.address === "0.0.0.0" ? "127.0.0.1" : address.address
        return await new Promise<number>((resolve, reject) => {
            const req = request({ host, port: address.port, method: "POST", path: this.webhookOptions.path ?? DEFAULT_PATH, headers }, (res) => {
                res.resume()
                resolve(res.statusCode ?? 0)
            })
            req.on("error", reject)
            req.end(body)
        })
    }

    private emitError(err: Error) {
        if (this.emitter.listenerCount("error") > 0) this.emitter.emit("error", err)
        else Logger.error(err.message)
    }

    /** Stops the webhook server and stats posting. Called by `client.destroy()`. */
    public async close(): Promise<void> {
        this.closed = true
        this.reminders?.clear()
        this.poster?.stop()
        this.poster = null
        const server = this.server
        this.server = null
        if (server?.listening) {
            await new Promise<void>((resolve) => {
                server.close(() => resolve())
                server.closeAllConnections?.()
            })
        }
    }
}

/** @deprecated Kept so code written for forge.topgg keeps working. Use {@link ReForgeTopGG}. */
export const ForgeTopGG = ReForgeTopGG
/** @deprecated */
export type ForgeTopGG = ReForgeTopGG

function validateOptions(o: IReForgeTopGGOptions) {
    const fail = (msg: string) => { throw new Error(`ReForgeTopGG: ${msg}`) }
    if (o.auth !== undefined && (typeof o.auth !== "string" || o.auth.trim() === "")) {
        fail("\"auth\" is empty. Anyone could send fake votes to an unprotected webhook. Set it to the authorization you entered on Top.gg, or remove it to turn the webhook off.")
    }
    const port = (o.webhook || {}).port ?? o.port
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) fail(`"port" must be a whole number from 0 to 65535, got ${port}`)
    const w = o.webhook || {}
    if (w.secret !== undefined && (typeof w.secret !== "string" || w.secret.trim() === "")) fail("\"webhook.secret\" is empty. Set it to the secret shown on your project's Webhooks page on Top.gg, or remove it.")
    if (o.store !== undefined && o.store !== "memory" && o.store !== "forgedb" && !(o.store && typeof o.store === "object" && typeof o.store.get === "function" && typeof o.store.set === "function")) {
        fail("\"store\" must be \"memory\", \"forgedb\" or an object with get and set methods")
    }
    if (o.streakGrace !== undefined && (!Number.isFinite(o.streakGrace) || o.streakGrace < 0)) fail("\"streakGrace\" must be a number of ms, 0 or more")
    if (w.path !== undefined && !/^\/\S*$/.test(w.path)) fail("\"webhook.path\" must start with /")
    if (w.maxBodySize !== undefined && (!Number.isInteger(w.maxBodySize) || w.maxBodySize < 1024)) fail("\"webhook.maxBodySize\" must be a whole number of at least 1024 bytes")
    if (o.dedupeWindow !== undefined && (!Number.isFinite(o.dedupeWindow) || o.dedupeWindow < 0 || o.dedupeWindow > 11 * 3_600_000)) {
        fail("\"dedupeWindow\" must be from 0 to 39600000 ms (11 hours)")
    }
    if (o.post) {
        if (!o.token) fail("\"post\" needs your Top.gg \"token\"")
        if (o.post.interval !== undefined && !(o.post.interval >= MIN_POST_INTERVAL)) {
            fail(`"post.interval" must be at least ${MIN_POST_INTERVAL} ms (15 minutes), Top.gg refuses more frequent posts`)
        }
    }
}
