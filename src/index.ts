import { EventManager, ForgeClient, ForgeExtension, Logger } from "@tryforge/forgescript"
import { createServer, IncomingMessage, Server, ServerResponse } from "http"
import { AutoPoster as autoPoster } from "topgg-autoposter"
import type { PosterOptions } from "topgg-autoposter/dist/typings"
import type { BasePoster } from "topgg-autoposter/dist/structs/BasePoster"
import { TypedEmitter } from "tiny-typed-emitter"
import { TopGGEventManagerName } from "./constants"
import { TopGGCommandManager } from "./structures/TopGGCommandManager"
import { ITopGGEvents } from "./structures/TopGGEventHandlers"
import { VoteWebhook } from "./structures/VoteWebhook"
import { Vote } from "./structures/Vote"

export * from "./structures/Vote"
export * from "./structures/VoteWebhook"

/** Top.gg refuses to be posted to more often than every 15 minutes. */
export const MIN_POST_INTERVAL = 900_000
export const DEFAULT_PORT = 3000
export const DEFAULT_PATH = "/dblwebhook"

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
}

/** @deprecated Use {@link IReForgeTopGGOptions}. */
export type IForgeTopGGOptions = IReForgeTopGGOptions

export type TransformEvents<T> = {
    [P in keyof T]: T[P] extends any[] ? (...args: T[P]) => any : never
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
    private poster: BasePoster | null = null
    private closed = false

    public constructor(public readonly options: IReForgeTopGGOptions = {}) {
        super()
        validateOptions(options)
        this.webhook = this.webhookEnabled
            ? new VoteWebhook({
                auth: options.auth,
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
        return this.options.webhook !== false && typeof this.options.auth === "string"
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
            this.client.once("ready", (ready) => {
                if (this.closed || this.poster) return
                try {
                    const poster = autoPoster(this.options.token!, ready, post)
                    poster.on("error", (err) => this.emitError(err))
                    poster.on("posted", (stats) => this.emitter.emit("posted", stats))
                    this.poster = poster
                } catch (err) {
                    this.emitError(new Error(`Top.gg stats posting could not start: ${(err as Error).message}`))
                }
            })
        }

        if (this.webhook && this.webhookOptions.listen !== false) this.listen()
        else if (!this.webhook) Logger.info("ReForgeTopGG: no webhook auth set, vote webhook is off")

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
    public async receive(vote: Vote): Promise<void> {
        this.emitter.emit("voted", vote)
    }

    private emitError(err: Error) {
        if (this.emitter.listenerCount("error") > 0) this.emitter.emit("error", err)
        else Logger.error(err.message)
    }

    /** Stops the webhook server and stats posting. Called by `client.destroy()`. */
    public async close(): Promise<void> {
        this.closed = true
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
    if (w.path !== undefined && !/^\/\S*$/.test(w.path)) fail("\"webhook.path\" must start with /")
    if (w.maxBodySize !== undefined && (!Number.isInteger(w.maxBodySize) || w.maxBodySize < 1024)) fail("\"webhook.maxBodySize\" must be a whole number of at least 1024 bytes")
    if (o.post) {
        if (!o.token) fail("\"post\" needs your Top.gg \"token\"")
        if (o.post.interval !== undefined && !(o.post.interval >= MIN_POST_INTERVAL)) {
            fail(`"post.interval" must be at least ${MIN_POST_INTERVAL} ms (15 minutes), Top.gg refuses more frequent posts`)
        }
    }
}
