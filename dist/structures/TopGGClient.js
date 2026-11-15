"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopGGClient = exports.TopGGAPIError = exports.TOPGG_REQUEST_TIMEOUT = exports.TOPGG_API_URL = void 0;
const http_1 = require("http");
/** Top.gg's API, legacy routes (the ones @top-gg/sdk 3.x calls). */
exports.TOPGG_API_URL = "https://top.gg/api";
/** A request that gets no answer in this many ms fails instead of waiting. */
exports.TOPGG_REQUEST_TIMEOUT = 15_000;
const TIPS = {
    401: "You need a token for this endpoint",
    403: "You don't have access to this endpoint",
};
/** A non-2xx answer from Top.gg. The message is `<status> <text>`, as @top-gg/sdk 3.x wrote it. */
class TopGGAPIError extends Error {
    status;
    body;
    constructor(status, body) {
        const text = http_1.STATUS_CODES[status] ?? "";
        super(status in TIPS ? `${status} ${text} (${TIPS[status]})` : `${status} ${text}`);
        this.status = status;
        this.body = body;
        this.name = "TopGGAPIError";
    }
}
exports.TopGGAPIError = TopGGAPIError;
/**
 * The four Top.gg calls this extension makes, on Node's built-in fetch.
 * Replaces @top-gg/sdk 3.x, whose undici 5 dependency carries advisories that
 * an override in this package cannot fix for users. Requests, answers and
 * error messages are the ones the SDK used.
 */
class TopGGClient {
    token;
    baseUrl;
    timeout;
    constructor(token, options = {}) {
        this.token = token;
        this.baseUrl = (options.baseUrl ?? exports.TOPGG_API_URL).replace(/\/+$/, "");
        this.timeout = options.timeout ?? exports.TOPGG_REQUEST_TIMEOUT;
    }
    async request(method, path, body) {
        const headers = { authorization: this.token };
        let url = this.baseUrl + path;
        if (body && method === "GET") {
            const query = new URLSearchParams();
            for (const [k, v] of Object.entries(body))
                if (v !== undefined)
                    query.set(k, String(v));
            url += `?${query}`;
        }
        if (method !== "GET")
            headers["content-type"] = "application/json";
        const response = await fetch(url, {
            method,
            headers,
            body: body && method !== "GET" ? JSON.stringify(body) : undefined,
            redirect: "error",
            signal: AbortSignal.timeout(this.timeout),
        }).catch((err) => {
            const e = err;
            if (e?.name === "TimeoutError")
                throw new Error(`no answer within ${this.timeout} ms`);
            throw new Error(e?.cause?.message ?? (err instanceof Error ? err.message : String(err)));
        });
        const text = await response.text();
        let data = text;
        if (response.headers.get("content-type")?.startsWith("application/json")) {
            try {
                data = JSON.parse(text);
            }
            catch {
                throw new Error(`${response.status}: Top.gg answered with invalid JSON`);
            }
        }
        if (response.status < 200 || response.status > 299)
            throw new TopGGAPIError(response.status, data);
        return data;
    }
    async hasVoted(id) {
        if (!id)
            throw new Error("Missing ID");
        const data = (await this.request("GET", "/bots/check", { userId: id }));
        return !!data?.voted;
    }
    async getBot(id) {
        if (!id)
            throw new Error("ID Missing");
        return this.request("GET", `/bots/${encodeURIComponent(id)}`);
    }
    async isWeekend() {
        const data = (await this.request("GET", "/weekend"));
        return !!data?.is_weekend;
    }
    async postStats(stats) {
        if (!stats?.serverCount)
            throw new Error("Missing Server Count");
        await this.request("POST", "/bots/stats", {
            server_count: stats.serverCount,
            shard_id: stats.shardId,
            shard_count: stats.shardCount,
        });
        return stats;
    }
}
exports.TopGGClient = TopGGClient;
//# sourceMappingURL=TopGGClient.js.map