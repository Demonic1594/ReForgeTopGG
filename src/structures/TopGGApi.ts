import { Api } from "@top-gg/sdk"

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Wraps the Top.gg API client so callers can tell an answer apart from a
 * failed request. The token is never part of the returned message.
 */
export class TopGGApi {
    public readonly client: Api | null

    constructor(private readonly token?: string) {
        this.client = token ? new Api(token) : null
    }

    async request<T>(call: (api: Api) => Promise<T>): Promise<ApiResult<T>> {
        if (!this.client) return { ok: false, error: "Top.gg API request failed: no \"token\" was set in the ReForgeTopGG options" }
        try {
            return { ok: true, value: await call(this.client) }
        } catch (err) {
            let message = err instanceof Error ? err.message : String(err)
            if (this.token) message = message.split(this.token).join("[token]")
            return { ok: false, error: `Top.gg API request failed: ${message}` }
        }
    }
}
