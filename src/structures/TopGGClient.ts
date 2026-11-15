import { STATUS_CODES } from "http"

/** The stats posted to Top.gg (the shape @top-gg/sdk 3.x used). */
export interface BotStats {
    serverCount: number
    shardId?: number
    shardCount?: number
}

/** Top.gg's API, legacy routes (the ones @top-gg/sdk 3.x calls). */
export const TOPGG_API_URL = "https://top.gg/api"
/** A request that gets no answer in this many ms fails instead of waiting. */
export const TOPGG_REQUEST_TIMEOUT = 15_000

const TIPS: Record<number, string> = {
    401: "You need a token for this endpoint",
    403: "You don't have access to this endpoint",
}

/** A non-2xx answer from Top.gg. The message is `<status> <text>`, as @top-gg/sdk 3.x wrote it. */
export class TopGGAPIError extends Error {
    constructor(public readonly status: number, public readonly body: unknown) {
        const text = STATUS_CODES[status] ?? ""
        super(status in TIPS ? `${status} ${text} (${TIPS[status]})` : `${status} ${text}`)
        this.name = "TopGGAPIError"
    }
}

export interface ITopGGClientOptions {
    /** Base URL, for tests. Defaults to {@link TOPGG_API_URL}. */
    baseUrl?: string
    /** Defaults to {@link TOPGG_REQUEST_TIMEOUT}. */
    timeout?: number
}

/**
 * The four Top.gg calls this extension makes, on Node's built-in fetch.
 * Replaces @top-gg/sdk 3.x, whose undici 5 dependency carries advisories that
 * an override in this package cannot fix for users. Requests, answers and
 * error messages are the ones the SDK used.
 */
export class TopGGClient {
    private readonly baseUrl: string
    private readonly timeout: number

    constructor(private readonly token: string, options: ITopGGClientOptions = {}) {
        this.baseUrl = (options.baseUrl ?? TOPGG_API_URL).replace(/\/+$/, "")
        this.timeout = options.timeout ?? TOPGG_REQUEST_TIMEOUT
    }

    async request(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<unknown> {
        const headers: Record<string, string> = { authorization: this.token }
        let url = this.baseUrl + path
        if (body && method === "GET") {
            const query = new URLSearchParams()
            for (const [k, v] of Object.entries(body)) if (v !== undefined) query.set(k, String(v))
            url += `?${query}`
        }
        if (method !== "GET") headers["content-type"] = "application/json"
        const response = await fetch(url, {
            method,
            headers,
            body: body && method !== "GET" ? JSON.stringify(body) : undefined,
            redirect: "error",
            signal: AbortSignal.timeout(this.timeout),
        }).catch((err: unknown) => {
            const e = err as { name?: string; cause?: { message?: string } } | undefined
            if (e?.name === "TimeoutError") throw new Error(`no answer within ${this.timeout} ms`)
            throw new Error(e?.cause?.message ?? (err instanceof Error ? err.message : String(err)))
        })
        const text = await response.text()
        let data: unknown = text
        if (response.headers.get("content-type")?.startsWith("application/json")) {
            try {
                data = JSON.parse(text)
            } catch {
                throw new Error(`${response.status}: Top.gg answered with invalid JSON`)
            }
        }
        if (response.status < 200 || response.status > 299) throw new TopGGAPIError(response.status, data)
        return data
    }

    async hasVoted(id: string): Promise<boolean> {
        if (!id) throw new Error("Missing ID")
        const data = (await this.request("GET", "/bots/check", { userId: id })) as { voted?: unknown } | null
        return !!data?.voted
    }

    async getBot(id: string): Promise<any> {
        if (!id) throw new Error("ID Missing")
        return this.request("GET", `/bots/${encodeURIComponent(id)}`)
    }

    async isWeekend(): Promise<boolean> {
        const data = (await this.request("GET", "/weekend")) as { is_weekend?: unknown } | null
        return !!data?.is_weekend
    }

    async postStats(stats: BotStats): Promise<BotStats> {
        if (!stats?.serverCount) throw new Error("Missing Server Count")
        await this.request("POST", "/bots/stats", {
            server_count: stats.serverCount,
            shard_id: stats.shardId,
            shard_count: stats.shardCount,
        })
        return stats
    }
}
