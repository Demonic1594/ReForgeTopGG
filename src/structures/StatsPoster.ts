import type { Client } from "discord.js"
import { TypedEmitter } from "tiny-typed-emitter"
import { BotStats, TopGGClient } from "./TopGGClient"

/** Default time between two posts (topgg-autoposter's default). */
export const DEFAULT_POST_INTERVAL = 1_800_000
/** The first post waits this long after the client is ready. */
export const POST_ON_START_DELAY = 5_000

export interface PosterOptions {
    /** Time between posts in ms, at least 900000 (15 minutes). Defaults to 30 minutes. */
    interval?: number
    /** Post 5 seconds after start instead of waiting a full interval. Defaults to true. */
    postOnStart?: boolean
    /** Start posting when the client is ready. Defaults to true. */
    startPosting?: boolean
    /** Something with a `postStats(stats)` method to post with, in place of the built-in client. */
    sdk?: { postStats(stats: BotStats): Promise<unknown> }
}

interface IPosterEvents {
    posted: (stats: BotStats) => void
    error: (err: Error) => void
}

/**
 * Posts a discord.js client's server count to Top.gg on an interval.
 * Replaces topgg-autoposter (which depends on @top-gg/sdk 3.x) for the one
 * client this extension posts for. Its timers are unref'd, and `stop()` also
 * cancels a first post that is still waiting.
 */
export class StatsPoster extends TypedEmitter<IPosterEvents> {
    public started = false
    public readonly interval: number
    private readonly api: { postStats(stats: BotStats): Promise<unknown> }
    private timer: NodeJS.Timeout | null = null
    private first: NodeJS.Timeout | null = null

    constructor(token: string, private readonly client: Client, private readonly options: PosterOptions = {}) {
        super()
        this.interval = options.interval ?? DEFAULT_POST_INTERVAL
        this.api = options.sdk ?? new TopGGClient(token)
    }

    /** Starts posting now if the client is connected. Returns whether it started. */
    start(): boolean {
        if (this.started) return true
        if (this.options.startPosting === false) return false
        this.started = true
        if (this.options.postOnStart !== false) {
            this.first = setTimeout(() => {
                this.first = null
                void this.post()
            }, POST_ON_START_DELAY)
            this.first.unref()
        }
        this.timer = setInterval(() => {
            if (this.client.ws.status === 0) void this.post()
        }, this.interval)
        this.timer.unref()
        return true
    }

    /** Whether a timer (the interval or the first post) is still set. */
    get scheduled(): boolean {
        return this.timer !== null || this.first !== null
    }

    stop() {
        this.started = false
        if (this.timer) clearInterval(this.timer)
        if (this.first) clearTimeout(this.first)
        this.timer = this.first = null
    }

    stats(): BotStats {
        return {
            serverCount: this.client.guilds.cache.size,
            shardId: this.client.shard?.ids[0],
            shardCount: this.client.options.shardCount || 1,
        }
    }

    /** Posts once. Never throws: the outcome is a `posted` or an `error` event. */
    async post(): Promise<void> {
        try {
            const stats = this.stats()
            await this.api.postStats(stats)
            this.emit("posted", stats)
        } catch (err) {
            this.emit("error", err instanceof Error ? err : new Error(String(err)))
        }
    }
}
