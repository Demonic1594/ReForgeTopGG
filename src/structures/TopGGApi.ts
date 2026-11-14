import { Api } from "@top-gg/sdk"
import { prefixed, ReForgeTopGGLogger as log } from "./Logger"

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Top.gg blocks a token for an hour once it sends more than 60 requests a
 * minute to /bots/* (its rate-limit docs). The extension stays below that with
 * its own budget, leaving room for stats posting.
 */
export const TOPGG_API_BUDGET = 50
export const TOPGG_API_WINDOW = 60_000
/** How long answers are reused. A vote reaching the webhook clears that user's answer. */
export const API_CACHE_TTL = { voted: 60_000, notVoted: 30_000, bot: 60_000, weekend: 300_000 }
const CACHE_MAX = 10_000

/**
 * Wraps the Top.gg API client so callers can tell an answer apart from a
 * failed request. Identical requests in flight share one call, answers are
 * reused for a short time, and requests beyond the budget fail locally
 * instead of getting the token blocked. The token is never part of a message.
 */
export class TopGGApi {
    public readonly client: Api | null
    private readonly sent: number[] = []
    private readonly cache = new Map<string, { value: unknown; expires: number }>()
    private readonly pending = new Map<string, Promise<ApiResult<unknown>>>()

    constructor(private readonly token?: string, private readonly now: () => number = Date.now) {
        this.client = token ? new Api(token) : null
    }

    /** Requests Top.gg has been sent in the current window. */
    get used(): number {
        this.prune()
        return this.sent.length
    }

    hasVoted(user: string): Promise<ApiResult<boolean>> {
        return this.cached(`voted:${user}`, (v) => (v ? API_CACHE_TTL.voted : API_CACHE_TTL.notVoted), (api) => api.hasVoted(user))
    }

    getBot(id: string) {
        return this.cached(`bot:${id}`, () => API_CACHE_TTL.bot, (api) => api.getBot(id))
    }

    isWeekend(): Promise<ApiResult<boolean>> {
        return this.cached("weekend", () => API_CACHE_TTL.weekend, async (api) => !!(await api.isWeekend()))
    }

    /** Forgets every cached answer (the request budget is kept). */
    clearCache() {
        this.cache.clear()
    }

    /** Drops a user's cached $hasVoted answer (their vote just arrived). */
    forget(user: string) {
        const key = `voted:${user}`
        this.cache.delete(key)
        // A request already on its way was answered before the vote: its answer
        // must neither be cached nor handed to callers that ask from now on.
        this.pending.delete(key)
    }

    private prune() {
        const from = this.now() - TOPGG_API_WINDOW
        while (this.sent.length && this.sent[0] <= from) this.sent.shift()
    }

    private async cached<T>(key: string, ttl: (value: T) => number, call: (api: Api) => Promise<T>): Promise<ApiResult<T>> {
        const hit = this.cache.get(key)
        if (hit && hit.expires > this.now()) {
            log.debug(`Top.gg API ${key}: answered from cache`)
            return { ok: true, value: hit.value as T }
        }
        const running = this.pending.get(key)
        if (running) {
            log.debug(`Top.gg API ${key}: sharing a request in flight`)
            return running as Promise<ApiResult<T>>
        }
        const task: Promise<ApiResult<T>> = this.request(call, key).then((r) => {
            // Only the request that is still the current one for this key may
            // fill the cache (forget() may have replaced it meanwhile).
            if (r.ok && this.pending.get(key) === task) {
                this.cache.delete(key)
                this.cache.set(key, { value: r.value, expires: this.now() + ttl(r.value) })
                while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!)
            }
            return r
        })
        this.pending.set(key, task)
        try {
            return await task
        } finally {
            if (this.pending.get(key) === task) this.pending.delete(key)
        }
    }

    async request<T>(call: (api: Api) => Promise<T>, label = "request"): Promise<ApiResult<T>> {
        if (!this.client) return { ok: false, error: prefixed("Top.gg API request failed: no \"token\" was set in the ReForgeTopGG options") }
        this.prune()
        if (this.sent.length >= TOPGG_API_BUDGET) {
            const wait = Math.ceil((this.sent[0] + TOPGG_API_WINDOW - this.now()) / 1000)
            log.warn(`Top.gg API ${label}: not sent, ${this.sent.length} requests in the last minute`)
            return { ok: false, error: prefixed(`Top.gg API request not sent: ${this.sent.length} requests in the last minute (Top.gg blocks the token for an hour past 60). Try again in ${wait} s`) }
        }
        this.sent.push(this.now())
        const started = performance.now()
        try {
            const value = await call(this.client)
            log.debug(`Top.gg API ${label}: answered in ${(performance.now() - started).toFixed(0)} ms (${this.sent.length} of ${TOPGG_API_BUDGET} requests this minute)`)
            return { ok: true, value }
        } catch (err) {
            let message = err instanceof Error ? err.message : String(err)
            if (this.token) message = message.split(this.token).join("[token]")
            log.debug(`Top.gg API ${label}: failed after ${(performance.now() - started).toFixed(0)} ms: ${message}`)
            return { ok: false, error: prefixed(`Top.gg API request failed: ${message}`) }
        }
    }
}
