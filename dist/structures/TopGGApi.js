"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopGGApi = exports.API_CACHE_TTL = exports.TOPGG_API_WINDOW = exports.TOPGG_API_BUDGET = void 0;
const sdk_1 = require("@top-gg/sdk");
/**
 * Top.gg blocks a token for an hour once it sends more than 60 requests a
 * minute to /bots/* (its rate-limit docs). The extension stays below that with
 * its own budget, leaving room for stats posting.
 */
exports.TOPGG_API_BUDGET = 50;
exports.TOPGG_API_WINDOW = 60_000;
/** How long answers are reused. A vote reaching the webhook clears that user's answer. */
exports.API_CACHE_TTL = { voted: 60_000, notVoted: 30_000, bot: 60_000, weekend: 300_000 };
const CACHE_MAX = 10_000;
/**
 * Wraps the Top.gg API client so callers can tell an answer apart from a
 * failed request. Identical requests in flight share one call, answers are
 * reused for a short time, and requests beyond the budget fail locally
 * instead of getting the token blocked. The token is never part of a message.
 */
class TopGGApi {
    token;
    now;
    client;
    sent = [];
    cache = new Map();
    pending = new Map();
    constructor(token, now = Date.now) {
        this.token = token;
        this.now = now;
        this.client = token ? new sdk_1.Api(token) : null;
    }
    /** Requests Top.gg has been sent in the current window. */
    get used() {
        this.prune();
        return this.sent.length;
    }
    hasVoted(user) {
        return this.cached(`voted:${user}`, (v) => (v ? exports.API_CACHE_TTL.voted : exports.API_CACHE_TTL.notVoted), (api) => api.hasVoted(user));
    }
    getBot(id) {
        return this.cached(`bot:${id}`, () => exports.API_CACHE_TTL.bot, (api) => api.getBot(id));
    }
    isWeekend() {
        return this.cached("weekend", () => exports.API_CACHE_TTL.weekend, async (api) => !!(await api.isWeekend()));
    }
    /** Forgets every cached answer (the request budget is kept). */
    clearCache() {
        this.cache.clear();
    }
    /** Drops a user's cached $hasVoted answer (their vote just arrived). */
    forget(user) {
        this.cache.delete(`voted:${user}`);
    }
    prune() {
        const from = this.now() - exports.TOPGG_API_WINDOW;
        while (this.sent.length && this.sent[0] <= from)
            this.sent.shift();
    }
    async cached(key, ttl, call) {
        const hit = this.cache.get(key);
        if (hit && hit.expires > this.now())
            return { ok: true, value: hit.value };
        const running = this.pending.get(key);
        if (running)
            return running;
        const task = this.request(call).then((r) => {
            if (r.ok) {
                this.cache.delete(key);
                this.cache.set(key, { value: r.value, expires: this.now() + ttl(r.value) });
                while (this.cache.size > CACHE_MAX)
                    this.cache.delete(this.cache.keys().next().value);
            }
            return r;
        });
        this.pending.set(key, task);
        try {
            return await task;
        }
        finally {
            this.pending.delete(key);
        }
    }
    async request(call) {
        if (!this.client)
            return { ok: false, error: "Top.gg API request failed: no \"token\" was set in the ReForgeTopGG options" };
        this.prune();
        if (this.sent.length >= exports.TOPGG_API_BUDGET) {
            const wait = Math.ceil((this.sent[0] + exports.TOPGG_API_WINDOW - this.now()) / 1000);
            return { ok: false, error: `Top.gg API request not sent: ${this.sent.length} requests in the last minute (Top.gg blocks the token for an hour past 60). Try again in ${wait} s` };
        }
        this.sent.push(this.now());
        try {
            return { ok: true, value: await call(this.client) };
        }
        catch (err) {
            let message = err instanceof Error ? err.message : String(err);
            if (this.token)
                message = message.split(this.token).join("[token]");
            return { ok: false, error: `Top.gg API request failed: ${message}` };
        }
    }
}
exports.TopGGApi = TopGGApi;
//# sourceMappingURL=TopGGApi.js.map