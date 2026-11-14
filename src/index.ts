import { EventManager, ForgeClient, ForgeExtension } from "@tryforge/forgescript"
import { createServer, IncomingMessage, request, Server, ServerResponse } from "http"
import { AutoPoster as autoPoster } from "topgg-autoposter"
import type { PosterOptions } from "topgg-autoposter/dist/typings"
import type { BasePoster } from "topgg-autoposter/dist/structs/BasePoster"
import { TypedEmitter } from "tiny-typed-emitter"
import { TopGGEventManagerName } from "./constants"
import { TopGGCommandManager } from "./structures/TopGGCommandManager"
import { ITopGGEvents } from "./structures/TopGGEventHandlers"
import { signBody, VoteWebhook } from "./structures/VoteWebhook"
import { isSnowflake, Vote, voteTarget } from "./structures/Vote"
import { applyVote, DatabaseVoteStore, loadedDatabaseExtensions, MemoryVoteStore, recordToVote, VoteRecord, VoteStore } from "./structures/VoteStore"
import { remindToSwitch } from "./structures/DatabaseReminder"
import { ReminderScheduler } from "./structures/Reminders"
import { TopGGApi } from "./structures/TopGGApi"
import { DedupeCache, dedupeKey, TEST_DEDUPE_WINDOW } from "./structures/Dedupe"
import { KeyedLock } from "./structures/KeyedLock"
import { errorMessage, isLogLevel, LOG_LEVELS, LogLevel, prefixed, ReForgeTopGGLogger as log } from "./structures/Logger"

export * from "./structures/Vote"
export * from "./structures/VoteWebhook"
export * from "./structures/TopGGApi"
export * from "./structures/Dedupe"
export * from "./structures/KeyedLock"
export * from "./structures/VoteStore"
export * from "./structures/Reminders"
export * from "./structures/DatabaseReminder"
export * from "./structures/Logger"

/** Top.gg refuses to be posted to more often than every 15 minutes. */
export const MIN_POST_INTERVAL = 900_000
export const DEFAULT_PORT = 3000
export const DEFAULT_PATH = "/dblwebhook"
/** Top.gg retries a legacy delivery up to 10 times over about half an hour. */
export const DEFAULT_DEDUPE_WINDOW = 3_600_000
/** A streak continues when the next vote comes at most this long after the user could vote again. */
export const DEFAULT_STREAK_GRACE = 12 * 3_600_000
/** A reminder that came due while the bot was offline is still sent when it is at most this late. */
export const DEFAULT_REMINDER_MAX_DELAY = 12 * 3_600_000
/** The smallest `reminderMaxDelay`: timers fire a little late, and a restart takes a while. */
export const MIN_REMINDER_MAX_DELAY = 60_000

export interface IWebhookOptions {
    /** Port to listen on. Defaults to the top-level `port`, then 3000. A numeric string (from .env) works. */
    port?: number | string
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
    secret?: string | null
}

export interface IReForgeTopGGOptions {
    /** Your Top.gg API token. Needed for posting stats and the API functions. */
    token?: string | null
    /**
     * The webhook authorization you set on Top.gg. The webhook only starts
     * when this is set, and an empty value is refused.
     */
    auth?: string | number | null
    /** Port of the vote webhook. Same as `webhook.port`. Defaults to 3000. A numeric string (from .env) works. */
    port?: number | string
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
     * most 100,000 users), `"reforgedb"` (user variables of ReForgeDB or
     * ForgeDB, whichever the bot loaded; `"forgedb"` is the same), or your own
     * {@link VoteStore}.
     */
    store?: "memory" | "reforgedb" | "forgedb" | VoteStore
    /** User variable used by the `"reforgedb"` store. Defaults to `topggVote`. */
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
    /**
     * A reminder that came due while the bot was offline is still sent after a
     * restart when it is at most this many ms late. Older ones are dropped and
     * marked as sent, so a restart never sends a flood of stale reminders.
     * Defaults to 12 hours, at least 60000 (1 minute).
     */
    reminderMaxDelay?: number
    /**
     * What is written to the console: `silent`, `error`, `warn`, `info`
     * (default), `debug` (every vote, reminder and API request) or `trace`
     * (also every webhook request). Secrets are never written. The
     * `REFORGETOPGG_LOG_LEVEL` environment variable sets it when this is not given.
     */
    logLevel?: LogLevel
}

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
    private readonly seen = new DedupeCache(100_000)
    /** Deliveries being processed, by dedupe key: a repeat waits for the first one's outcome. */
    private readonly inFlight = new Map<string, Promise<boolean>>()
    /** One history update per user at a time. */
    private readonly userLock = new KeyedLock()
    private closed = false
    /** Where vote history is kept. */
    public readonly store: VoteStore
    private readonly reminders: ReminderScheduler | null

    /** The options, with values from .env or JSON configs normalized (see normalizeOptions). */
    public readonly options: IReForgeTopGGOptions
    private refused = { count: 0, since: 0, logged: 0 }

    public constructor(rawOptions: IReForgeTopGGOptions = {}) {
        super()
        const options = normalizeOptions(rawOptions)
        validateOptions(options)
        if (options.logLevel) log.level = options.logLevel
        this.options = options
        this.api = new TopGGApi(options.token ?? undefined)
        this.store = isDatabaseStore(options.store)
            ? new DatabaseVoteStore(options.storeVariable)
            : typeof options.store === "object" ? options.store : new MemoryVoteStore()
        this.reminders = options.reminders ? new ReminderScheduler((user, expiresAt) => void this.remind(user, expiresAt)) : null
        this.webhook = this.webhookEnabled
            ? new VoteWebhook({
                auth: options.auth as string | undefined,
                secret: this.webhookOptions.secret ?? undefined,
                maxBodySize: this.webhookOptions.maxBodySize,
                onVote: (vote) => this.receive(vote),
                onError: (err) => this.emitError(err),
                onRefused: (reason) => this.noteRefused(reason),
            })
            : null
    }

    /**
     * Refused requests are not events (anyone can send them), but a webhook that
     * refuses everything usually means the secret does not match Top.gg's: log
     * a count, at most once a minute.
     */
    private noteRefused(reason: string) {
        const now = Date.now()
        this.refused.count++
        log.debug(`webhook request refused: ${reason}`)
        if (now - this.refused.logged < 60_000) return
        log.warn(`Refused ${this.refused.count} webhook request(s)${this.refused.logged ? " since the last report" : ""} (last: ${reason}). If these are Top.gg's, the secret in your options does not match the one on Top.gg.`)
        this.refused = { count: 0, since: now, logged: now }
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
            traceRequest(req, res)
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
            throw new Error(prefixed(`Cannot run alongside ${conflict.name}: both register $hasVoted, $voteUserID and the vote events. Remove ${conflict.name} from your extensions and uninstall it.`))
        }
        const unknown = (this.options.events ?? []).filter((e) => !(TOPGG_EVENTS as readonly string[]).includes(e))
        if (unknown.length) {
            throw new Error(prefixed(`Unknown event${unknown.length > 1 ? "s" : ""} ${unknown.map((e) => `"${e}"`).join(", ")} in "events". The events are ${TOPGG_EVENTS.join(", ")}.`))
        }
        if (isDatabaseStore(this.options.store) && !loadedDatabaseExtensions(client).length) {
            throw new Error(prefixed(`Store "${this.options.store}" needs a database extension: add new ReForgeDB() (npm i github:Demonic1594/ReForgeDB) or new ForgeDB() (npm i @tryforge/forge.db) to your extensions.`))
        }
        // ForgeDB without ReForgeDB: remind once (shared with the other ReForge extensions).
        if (loadedDatabaseExtensions(client)[0]?.name === "forge.db") remindToSwitch()
        super.validateAndInit(client)
    }

    init(client: ForgeClient): void {
        this.client = client
        if (this.store instanceof DatabaseVoteStore) this.store.attach(client)
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
                    poster.on("posted", (stats) => {
                        log.debug(`stats posted to Top.gg: ${stats.serverCount} servers${stats.shardCount ? `, ${stats.shardCount} shards` : ""}`)
                        this.safeEmit("posted", stats)
                    })
                    this.poster = poster
                    log.info(`Posting stats to Top.gg every ${Math.round((post.interval ?? MIN_POST_INTERVAL) / 60_000)} minutes`)
                } catch (err) {
                    this.emitError(new Error(`Top.gg stats posting could not start: ${errorMessage(err)}`))
                }
            })
        }

        if (this.webhook && this.webhookOptions.listen !== false) this.listen()
        else if (!this.webhook) log.info("No webhook auth or secret set, vote webhook is off")

        if (this.reminders && this.store.pending) {
            // Reschedule reminders a persistent store still holds.
            this.client.once(readyEventName() as "ready", () => void this.restoreReminders())
        }
        // Commands added for an event that is not in `events` never run: say so once.
        this.client.once(readyEventName() as "ready", () => {
            for (const name of TOPGG_EVENTS) {
                if (this.commands.get(name).length && !this.options.events?.includes(name)) {
                    log.warn(`There are ${name} commands, but "${name}" is not in the extension's events, so they never run. Add it to events: [...].`)
                }
            }
            const listens = !!this.options.events?.includes("voteReminder")
            if (listens && !this.reminders) log.warn("\"voteReminder\" is in events, but \"reminders\" is off, so it never fires. Set reminders: true.")
            // ForgeScript's event handlers listen on the emitter too, so this counts both kinds.
            if (this.reminders && this.emitter.listenerCount("voteReminder") === 0) {
                log.warn("\"reminders\" is on, but \"voteReminder\" is not in events, so reminders are timed for nothing. Add it to events: [...] or turn reminders off.")
            }
        })
        const auth = this.options.auth
        if (typeof auth === "string" && auth !== auth.trim()) {
            log.warn("\"auth\" starts or ends with whitespace (a stray space or a Windows line ending in .env?). Top.gg sends the value exactly as entered, so votes are refused if it differs.")
        }

        // ForgeExtension has no shutdown hook: close with the client.
        const destroy = client.destroy.bind(client)
        client.destroy = async () => {
            await this.close()
            return destroy()
        }
    }

    private listen() {
        const port = Number(this.webhookOptions.port ?? this.options.port ?? DEFAULT_PORT)
        const host = this.webhookOptions.host
        const path = this.webhookOptions.path ?? DEFAULT_PATH
        // connectionsCheckingInterval: Node enforces the header and request timeouts
        // only when it checks, every 30 s by default; slow clients are cut off sooner.
        const server = createServer({ connectionsCheckingInterval: 1000 }, (req, res) => {
            traceRequest(req, res)
            const url = (req.url ?? "/").split("?")[0]
            if (url !== path) {
                req.resume()
                res.writeHead(404, req.complete ? {} : { connection: "close" }).end()
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
            log.info(`Vote webhook listening on port ${actual}, path ${path}`)
        })
        this.server = server
    }

    /**
     * Handles a vote that passed authentication and validation. Public so a
     * webhook mounted elsewhere, or a test, can feed votes in.
     */
    public async receive(vote: Vote): Promise<boolean> {
        const key = dedupeKey(vote)
        const who = `vote of ${vote.user} for ${voteTarget(vote)}`
        if (this.seen.has(key)) {
            log.debug(`${who} dropped: repeat of a delivery already handled`)
            return false
        }
        const running = this.inFlight.get(key)
        if (running) {
            // A repeat while the first delivery is still being stored. If that one
            // fails, this one must fail too (Top.gg then delivers it again), or the
            // vote would be lost.
            log.debug(`${who} dropped: repeat of a delivery being stored, waiting for its outcome`)
            await running
            return false
        }
        const task = this.process(key, vote)
        this.inFlight.set(key, task)
        try {
            return await task
        } finally {
            this.inFlight.delete(key)
        }
    }

    private async process(key: string, vote: Vote): Promise<boolean> {
        // Test votes are not history. A failed write throws, the webhook answers
        // 500 and Top.gg delivers the vote again.
        const started = performance.now()
        if (vote.type === "upvote") {
            await this.userLock.run(vote.user, async () => {
                const record = applyVote(await this.store.get(vote.user), vote, this.streakGrace)
                await this.store.set(record)
                this.reminders?.schedule(record.user, record.expiresAt)
            })
            this.api.forget(vote.user)
        }
        log.debug(`vote of ${vote.user} for ${voteTarget(vote)} accepted (${vote.type}, ${vote.source}, weight ${vote.weight}${vote.type === "upvote" ? `, stored in ${(performance.now() - started).toFixed(1)} ms` : ", not stored"})`)
        const window = this.options.dedupeWindow ?? DEFAULT_DEDUPE_WINDOW
        this.seen.add(key, vote.type === "test" ? Math.min(window, TEST_DEDUPE_WINDOW) : window)
        // The vote is stored: a failing listener must not turn it into a 500.
        this.safeEmit("voted", vote)
        return true
    }

    /** Emits without letting a listener's exception escape (into the webhook, a timer or the server). */
    private safeEmit<K extends keyof ITopGGEvents>(name: K, ...args: ITopGGEvents[K]) {
        try {
            ;(this.emitter.emit as (n: K, ...a: ITopGGEvents[K]) => boolean)(name, ...args)
        } catch (err) {
            log.error(`A ${name} listener threw: ${errorMessage(err)}`)
        }
    }

    public get streakGrace(): number {
        return this.options.streakGrace ?? DEFAULT_STREAK_GRACE
    }

    /** The vote history of a user, if any. */
    public async getRecord(user: string): Promise<VoteRecord | undefined> {
        return (await this.store.get(user)) ?? undefined
    }

    /** How late a reminder may be and still be sent. */
    public get reminderMaxDelay(): number {
        return this.options.reminderMaxDelay ?? DEFAULT_REMINDER_MAX_DELAY
    }

    /**
     * Sends the reminder of the vote that ends at `expiresAt`, once, or drops it
     * when it is more than `reminderMaxDelay` late. Returns whether it was sent.
     * Holds the user's lock: a vote stored meanwhile is never overwritten.
     */
    private async remind(user: string, expiresAt: number): Promise<boolean> {
        if (this.closed) return false
        try {
            const record = await this.userLock.run(user, async () => {
                const current = await this.store.get(user)
                // A newer vote moved the reminder, or it was already sent.
                if (!current || current.reminded || current.expiresAt !== expiresAt) return null
                current.reminded = true
                await this.store.set(current)
                return current
            })
            if (!record) return false
            const late = Date.now() - expiresAt
            if (late > this.reminderMaxDelay) {
                log.debug(`reminder of ${user} dropped: it came due ${formatDuration(late)} ago`)
                return false
            }
            log.debug(`reminder of ${user} sent`)
            this.safeEmit("voteReminder", recordToVote(record))
            return true
        } catch (err) {
            this.emitError(new Error(`Vote reminder for ${user} failed: ${errorMessage(err)}`))
            return false
        }
    }

    private async restoreReminders() {
        try {
            const now = Date.now()
            const stale: VoteRecord[] = []
            let scheduled = 0
            for (const record of await this.store.pending!()) {
                if (now - record.expiresAt > this.reminderMaxDelay) stale.push(record)
                else {
                    this.reminders?.schedule(record.user, record.expiresAt)
                    scheduled++
                }
            }
            // Marked as sent one at a time, never as a burst of writes, and after
            // the reminders that are still due have been scheduled.
            for (const record of stale) {
                if (this.closed) return
                await this.remind(record.user, record.expiresAt)
            }
            if (scheduled) log.debug(`${scheduled} reminder(s) restored`)
            if (stale.length) log.info(`Dropped ${stale.length} reminder(s) that came due more than ${formatDuration(this.reminderMaxDelay)} ago while the bot was offline (reminderMaxDelay)`)
        } catch (err) {
            this.emitError(new Error(`Vote reminders could not be restored: ${errorMessage(err)}`))
        }
    }

    /**
     * Sends a test vote to the running webhook over HTTP, exactly as Top.gg
     * would (signed when a v1 secret is set). Resolves with the HTTP status.
     * Test votes run the voted event with $voteType "test" and are not stored.
     */
    public async sendTestVote(options: { user: string; weekend?: boolean; query?: string }): Promise<number> {
        if (!isSnowflake(options.user)) throw new Error(prefixed(`"${options.user}" is not a user ID`))
        const server = this.server
        const address = server?.listening ? server.address() : null
        if (!address || typeof address !== "object") throw new Error(prefixed("The vote webhook is not listening"))
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
        else headers.authorization = String(this.options.auth)
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
        if (this.emitter.listenerCount("error") > 0) this.safeEmit("error", err)
        else log.error(err.message)
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

/** The events the extension can emit. */
export const TOPGG_EVENTS = ["voted", "voteReminder", "posted", "error"] as const

/**
 * Values that come from .env files or JSON configs, made usable: a numeric
 * string port becomes a number, a numeric auth a string, and null means "not
 * set". Anything else is left for validateOptions to refuse.
 */
export function normalizeOptions(raw: IReForgeTopGGOptions): IReForgeTopGGOptions {
    const o: IReForgeTopGGOptions = { ...raw }
    const port = (p: unknown) => (typeof p === "string" && /^\s*\d{1,5}\s*$/.test(p) ? Number(p) : p) as number | undefined
    if (o.auth === null) delete o.auth
    if (typeof o.auth === "number" && Number.isFinite(o.auth)) o.auth = String(o.auth)
    if (o.token === null) delete o.token
    if (o.port !== undefined) o.port = port(o.port)
    if (o.webhook && typeof o.webhook === "object") {
        o.webhook = { ...o.webhook }
        if (o.webhook.port !== undefined) o.webhook.port = port(o.webhook.port)
        if (o.webhook.secret === null) delete o.webhook.secret
    }
    return o
}

/** Whether `store` names the database store (`"reforgedb"`, or `"forgedb"` as before 3.1.0). */
function isDatabaseStore(store: unknown): store is "reforgedb" | "forgedb" {
    return store === "reforgedb" || store === "forgedb"
}

function validateOptions(o: IReForgeTopGGOptions) {
    const fail = (msg: string) => { throw new Error(prefixed(msg)) }
    if (o.logLevel !== undefined && !isLogLevel(o.logLevel)) fail(`"logLevel" must be one of ${LOG_LEVELS.join(", ")}, got ${JSON.stringify(o.logLevel)}`)
    if (o.reminderMaxDelay !== undefined && (!Number.isFinite(o.reminderMaxDelay) || o.reminderMaxDelay < MIN_REMINDER_MAX_DELAY)) {
        fail(`"reminderMaxDelay" must be a number of ms, at least ${MIN_REMINDER_MAX_DELAY} (1 minute)`)
    }
    if (o.auth !== undefined && typeof o.auth !== "string") fail(`"auth" must be text, got ${typeof o.auth}`)
    if (typeof o.auth === "string" && o.auth.trim() === "") {
        fail("\"auth\" is empty. Anyone could send fake votes to an unprotected webhook. Set it to the authorization you entered on Top.gg, or remove it to turn the webhook off.")
    }
    const port = (o.webhook || {}).port ?? o.port
    if (port !== undefined && (!Number.isInteger(port) || (port as number) < 0 || (port as number) > 65535)) fail(`"port" must be a whole number from 0 to 65535, got ${JSON.stringify(port)}`)
    const w = o.webhook || {}
    if (w.secret !== undefined && (typeof w.secret !== "string" || w.secret.trim() === "")) fail("\"webhook.secret\" is empty. Set it to the secret shown on your project's Webhooks page on Top.gg, or remove it.")
    if (o.store !== undefined && o.store !== "memory" && !isDatabaseStore(o.store) && !(o.store && typeof o.store === "object" && typeof o.store.get === "function" && typeof o.store.set === "function")) {
        fail("\"store\" must be \"memory\", \"reforgedb\" (or \"forgedb\") or an object with get and set methods")
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

/** A duration for log messages: "45 s", "12 min", "3.5 h", "60 days". */
export function formatDuration(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)} s`
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`
    if (ms < 2 * 86_400_000) return `${+(ms / 3_600_000).toFixed(1)} h`
    return `${Math.round(ms / 86_400_000)} days`
}

/** Logs each webhook request with its answer at trace level: method, path, status and time, never headers or body. */
function traceRequest(req: IncomingMessage, res: ServerResponse) {
    if (!log.enabled("trace")) return
    const started = performance.now()
    res.once("finish", () => {
        const path = (req.url ?? "/").split("?")[0].slice(0, 200)
        log.trace(`${req.method} ${path} -> ${res.statusCode} (${(performance.now() - started).toFixed(1)} ms)`)
    })
}
