"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsPoster = exports.POST_ON_START_DELAY = exports.DEFAULT_POST_INTERVAL = void 0;
const tiny_typed_emitter_1 = require("tiny-typed-emitter");
const TopGGClient_1 = require("./TopGGClient");
/** Default time between two posts (topgg-autoposter's default). */
exports.DEFAULT_POST_INTERVAL = 1_800_000;
/** The first post waits this long after the client is ready. */
exports.POST_ON_START_DELAY = 5_000;
/**
 * Posts a discord.js client's server count to Top.gg on an interval.
 * Replaces topgg-autoposter (which depends on @top-gg/sdk 3.x) for the one
 * client this extension posts for. Its timers are unref'd, and `stop()` also
 * cancels a first post that is still waiting.
 */
class StatsPoster extends tiny_typed_emitter_1.TypedEmitter {
    client;
    options;
    started = false;
    interval;
    api;
    timer = null;
    first = null;
    constructor(token, client, options = {}) {
        super();
        this.client = client;
        this.options = options;
        this.interval = options.interval ?? exports.DEFAULT_POST_INTERVAL;
        this.api = options.sdk ?? new TopGGClient_1.TopGGClient(token);
    }
    /** Starts posting now if the client is connected. Returns whether it started. */
    start() {
        if (this.started)
            return true;
        if (this.options.startPosting === false)
            return false;
        this.started = true;
        if (this.options.postOnStart !== false) {
            this.first = setTimeout(() => {
                this.first = null;
                void this.post();
            }, exports.POST_ON_START_DELAY);
            this.first.unref();
        }
        this.timer = setInterval(() => {
            if (this.client.ws.status === 0)
                void this.post();
        }, this.interval);
        this.timer.unref();
        return true;
    }
    /** Whether a timer (the interval or the first post) is still set. */
    get scheduled() {
        return this.timer !== null || this.first !== null;
    }
    stop() {
        this.started = false;
        if (this.timer)
            clearInterval(this.timer);
        if (this.first)
            clearTimeout(this.first);
        this.timer = this.first = null;
    }
    stats() {
        return {
            serverCount: this.client.guilds.cache.size,
            shardId: this.client.shard?.ids[0],
            shardCount: this.client.options.shardCount || 1,
        };
    }
    /** Posts once. Never throws: the outcome is a `posted` or an `error` event. */
    async post() {
        try {
            const stats = this.stats();
            await this.api.postStats(stats);
            this.emit("posted", stats);
        }
        catch (err) {
            this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
    }
}
exports.StatsPoster = StatsPoster;
//# sourceMappingURL=StatsPoster.js.map