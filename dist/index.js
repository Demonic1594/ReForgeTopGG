"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForgeTopGG = exports.ReForgeTopGG = exports.DEFAULT_STREAK_GRACE = exports.DEFAULT_DEDUPE_WINDOW = exports.DEFAULT_PATH = exports.DEFAULT_PORT = exports.MIN_POST_INTERVAL = void 0;
exports.readyEventName = readyEventName;
const forgescript_1 = require("@tryforge/forgescript");
const http_1 = require("http");
const topgg_autoposter_1 = require("topgg-autoposter");
const tiny_typed_emitter_1 = require("tiny-typed-emitter");
const constants_1 = require("./constants");
const TopGGCommandManager_1 = require("./structures/TopGGCommandManager");
const VoteWebhook_1 = require("./structures/VoteWebhook");
const Vote_1 = require("./structures/Vote");
const VoteStore_1 = require("./structures/VoteStore");
const Reminders_1 = require("./structures/Reminders");
const TopGGApi_1 = require("./structures/TopGGApi");
const Dedupe_1 = require("./structures/Dedupe");
__exportStar(require("./structures/Vote"), exports);
__exportStar(require("./structures/VoteWebhook"), exports);
__exportStar(require("./structures/TopGGApi"), exports);
__exportStar(require("./structures/Dedupe"), exports);
__exportStar(require("./structures/VoteStore"), exports);
__exportStar(require("./structures/Reminders"), exports);
/** Top.gg refuses to be posted to more often than every 15 minutes. */
exports.MIN_POST_INTERVAL = 900_000;
exports.DEFAULT_PORT = 3000;
exports.DEFAULT_PATH = "/dblwebhook";
/** Top.gg retries a legacy delivery up to 10 times over about half an hour. */
exports.DEFAULT_DEDUPE_WINDOW = 3_600_000;
/** A streak continues when the next vote comes at most this long after the user could vote again. */
exports.DEFAULT_STREAK_GRACE = 12 * 3_600_000;
/**
 * The client's ready event. discord.js 14.22+ emits "clientReady" and prints a deprecation warning
 * when anything listens to "ready" (gone in v15); older versions only emit "ready". Events.ClientReady
 * holds the right name for the installed version.
 */
function readyEventName() {
    try {
        return require("discord.js").Events?.ClientReady ?? "ready";
    }
    catch {
        return "ready";
    }
}
/** Names of extensions that register the same functions and cannot run alongside. */
const CONFLICTING_EXTENSIONS = ["forge.topgg"];
class ReForgeTopGG extends forgescript_1.ForgeExtension {
    options;
    name = "reforge.topgg";
    description = "Posts your bot stats to Top.gg and receives votes from it, safely.";
    version = require("../package.json").version;
    client;
    emitter = new tiny_typed_emitter_1.TypedEmitter();
    commands;
    /** The vote webhook, or `null` when it is disabled. */
    webhook;
    /** The HTTP server, once it listens. */
    server = null;
    /** Top.gg API access for the API functions. */
    api;
    poster = null;
    seen = new Dedupe_1.DedupeCache();
    inFlight = new Set();
    closed = false;
    /** Where vote history is kept. */
    store;
    reminders;
    constructor(options = {}) {
        super();
        this.options = options;
        validateOptions(options);
        this.api = new TopGGApi_1.TopGGApi(options.token);
        this.store = options.store === "forgedb"
            ? new VoteStore_1.ForgeDBVoteStore(options.storeVariable)
            : typeof options.store === "object" ? options.store : new VoteStore_1.MemoryVoteStore();
        this.reminders = options.reminders ? new Reminders_1.ReminderScheduler((user, expiresAt) => void this.remind(user, expiresAt)) : null;
        this.webhook = this.webhookEnabled
            ? new VoteWebhook_1.VoteWebhook({
                auth: options.auth,
                secret: this.webhookOptions.secret,
                maxBodySize: this.webhookOptions.maxBodySize,
                onVote: (vote) => this.receive(vote),
                onError: (err) => this.emitError(err),
            })
            : null;
    }
    get webhookOptions() {
        return this.options.webhook || {};
    }
    get webhookEnabled() {
        return this.options.webhook !== false && (typeof this.options.auth === "string" || typeof this.webhookOptions.secret === "string");
    }
    /**
     * Node request listener for the webhook, for mounting on your own server
     * (`webhook: { listen: false }`). Answers 404 when the webhook is disabled.
     */
    get webhookListener() {
        return (req, res) => {
            if (!this.webhook) {
                res.writeHead(404).end();
                return;
            }
            this.webhook.listener(req, res);
        };
    }
    /**
     * ForgeScript catches and only logs errors thrown by init(), and the bot
     * keeps running half set up. Problems that must stop the bot are checked
     * here instead, where an error does reach the ForgeClient constructor.
     */
    validateAndInit(client) {
        const conflict = client.options.extensions?.find((x) => CONFLICTING_EXTENSIONS.includes(x.name));
        if (conflict) {
            throw new Error(`ReForgeTopGG cannot run alongside ${conflict.name}: both register $hasVoted, $voteUserID and the vote events. Remove ${conflict.name} from your extensions and uninstall it.`);
        }
        if (this.options.store === "forgedb" && !client.options.extensions?.some((x) => x.name === "forge.db")) {
            throw new Error("ReForgeTopGG: store \"forgedb\" needs the ForgeDB extension (npm i @tryforge/forge.db, then add new ForgeDB() to your extensions).");
        }
        super.validateAndInit(client);
    }
    init(client) {
        this.client = client;
        this.commands = new TopGGCommandManager_1.TopGGCommandManager(client);
        forgescript_1.EventManager.load(constants_1.TopGGEventManagerName, __dirname + "/events");
        this.load(__dirname + "/native");
        if (this.options.events?.length)
            this.client.events.load(constants_1.TopGGEventManagerName, this.options.events);
        if (this.options.post) {
            const post = this.options.post;
            this.client.once(readyEventName(), (ready) => {
                if (this.closed || this.poster)
                    return;
                try {
                    const poster = (0, topgg_autoposter_1.AutoPoster)(this.options.token, ready, post);
                    // topgg-autoposter starts its interval a microtask after it is created; a close()
                    // in between would stop nothing and the interval would keep the process alive.
                    const start = poster.start.bind(poster);
                    poster.start = () => {
                        if (!this.closed)
                            start();
                    };
                    poster.on("error", (err) => this.emitError(err));
                    poster.on("posted", (stats) => this.emitter.emit("posted", stats));
                    this.poster = poster;
                }
                catch (err) {
                    this.emitError(new Error(`Top.gg stats posting could not start: ${err.message}`));
                }
            });
        }
        if (this.webhook && this.webhookOptions.listen !== false)
            this.listen();
        else if (!this.webhook)
            forgescript_1.Logger.info("ReForgeTopGG: no webhook auth or secret set, vote webhook is off");
        if (this.reminders && this.store.pending) {
            // Reschedule reminders a persistent store still holds.
            this.client.once(readyEventName(), () => void this.restoreReminders());
        }
        // ForgeExtension has no shutdown hook: close with the client.
        const destroy = client.destroy.bind(client);
        client.destroy = async () => {
            await this.close();
            return destroy();
        };
    }
    listen() {
        const port = this.webhookOptions.port ?? this.options.port ?? exports.DEFAULT_PORT;
        const host = this.webhookOptions.host;
        const path = this.webhookOptions.path ?? exports.DEFAULT_PATH;
        const server = (0, http_1.createServer)((req, res) => {
            const url = (req.url ?? "/").split("?")[0];
            if (url !== path) {
                req.resume();
                res.writeHead(404).end();
                return;
            }
            this.webhook.listener(req, res);
        });
        // Slow or stalled clients cannot hold connections open for long.
        server.headersTimeout = 10_000;
        server.requestTimeout = 15_000;
        server.on("error", (err) => {
            const reason = err.code === "EADDRINUSE"
                ? `port ${port} is already in use (set another one with the "port" option)`
                : err.code === "EACCES"
                    ? `no permission to use port ${port}`
                    : err.message;
            this.server = null;
            this.emitError(new Error(`Top.gg vote webhook could not start: ${reason}`));
        });
        server.listen({ port, host }, () => {
            const address = server.address();
            const actual = typeof address === "object" && address ? address.port : port;
            forgescript_1.Logger.info(`ReForgeTopGG: vote webhook listening on port ${actual}, path ${path}`);
        });
        this.server = server;
    }
    /**
     * Handles a vote that passed authentication and validation. Public so a
     * webhook mounted elsewhere, or a test, can feed votes in.
     */
    async receive(vote) {
        const key = (0, Dedupe_1.dedupeKey)(vote);
        if (this.seen.has(key) || this.inFlight.has(key))
            return false;
        this.inFlight.add(key);
        try {
            // Test votes are not history. A failed write throws, the webhook
            // answers 500 and Top.gg delivers the vote again.
            if (vote.type === "upvote") {
                const record = (0, VoteStore_1.applyVote)(await this.store.get(vote.user), vote, this.streakGrace);
                await this.store.set(record);
                this.reminders?.schedule(record.user, record.expiresAt);
            }
            const window = this.options.dedupeWindow ?? exports.DEFAULT_DEDUPE_WINDOW;
            this.seen.add(key, vote.type === "test" ? Math.min(window, Dedupe_1.TEST_DEDUPE_WINDOW) : window);
        }
        finally {
            this.inFlight.delete(key);
        }
        this.emitter.emit("voted", vote);
        return true;
    }
    get streakGrace() {
        return this.options.streakGrace ?? exports.DEFAULT_STREAK_GRACE;
    }
    /** The vote history of a user, if any. */
    async getRecord(user) {
        return (await this.store.get(user)) ?? undefined;
    }
    async remind(user, expiresAt) {
        if (this.closed)
            return;
        try {
            const record = await this.store.get(user);
            // A newer vote moved the reminder, or it was already sent.
            if (!record || record.reminded || record.expiresAt !== expiresAt)
                return;
            record.reminded = true;
            await this.store.set(record);
            this.emitter.emit("voteReminder", (0, VoteStore_1.recordToVote)(record));
        }
        catch (err) {
            this.emitError(new Error(`Vote reminder for ${user} failed: ${err.message}`));
        }
    }
    async restoreReminders() {
        try {
            for (const record of await this.store.pending())
                this.reminders?.schedule(record.user, record.expiresAt);
        }
        catch (err) {
            this.emitError(new Error(`Vote reminders could not be restored: ${err.message}`));
        }
    }
    /**
     * Sends a test vote to the running webhook over HTTP, exactly as Top.gg
     * would (signed when a v1 secret is set). Resolves with the HTTP status.
     * Test votes run the voted event with $voteType "test" and are not stored.
     */
    async sendTestVote(options) {
        if (!(0, Vote_1.isSnowflake)(options.user))
            throw new Error(`"${options.user}" is not a user ID`);
        const server = this.server;
        const address = server?.listening ? server.address() : null;
        if (!address || typeof address !== "object")
            throw new Error("The vote webhook is not listening");
        const target = this.client?.user?.id ?? "0".repeat(18);
        const secret = this.webhookOptions.secret;
        const now = Date.now();
        const body = secret
            ? JSON.stringify({
                type: "webhook.test",
                data: { user: { id: options.user, platform_id: options.user }, project: { id: target, type: "bot", platform: "discord", platform_id: target } },
            })
            : JSON.stringify({ user: options.user, bot: target, type: "test", isWeekend: !!options.weekend, query: options.query ?? "" });
        const headers = { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) };
        if (secret)
            headers["x-topgg-signature"] = (0, VoteWebhook_1.signBody)(body, secret, now);
        else
            headers.authorization = this.options.auth;
        const host = address.address === "::" || address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
        return await new Promise((resolve, reject) => {
            const req = (0, http_1.request)({ host, port: address.port, method: "POST", path: this.webhookOptions.path ?? exports.DEFAULT_PATH, headers }, (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
            });
            req.on("error", reject);
            req.end(body);
        });
    }
    emitError(err) {
        if (this.emitter.listenerCount("error") > 0)
            this.emitter.emit("error", err);
        else
            forgescript_1.Logger.error(err.message);
    }
    /** Stops the webhook server and stats posting. Called by `client.destroy()`. */
    async close() {
        this.closed = true;
        this.reminders?.clear();
        this.poster?.stop();
        this.poster = null;
        const server = this.server;
        this.server = null;
        if (server?.listening) {
            await new Promise((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections?.();
            });
        }
    }
}
exports.ReForgeTopGG = ReForgeTopGG;
/** @deprecated Kept so code written for forge.topgg keeps working. Use {@link ReForgeTopGG}. */
exports.ForgeTopGG = ReForgeTopGG;
function validateOptions(o) {
    const fail = (msg) => { throw new Error(`ReForgeTopGG: ${msg}`); };
    if (o.auth !== undefined && (typeof o.auth !== "string" || o.auth.trim() === "")) {
        fail("\"auth\" is empty. Anyone could send fake votes to an unprotected webhook. Set it to the authorization you entered on Top.gg, or remove it to turn the webhook off.");
    }
    const port = (o.webhook || {}).port ?? o.port;
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535))
        fail(`"port" must be a whole number from 0 to 65535, got ${port}`);
    const w = o.webhook || {};
    if (w.secret !== undefined && (typeof w.secret !== "string" || w.secret.trim() === ""))
        fail("\"webhook.secret\" is empty. Set it to the secret shown on your project's Webhooks page on Top.gg, or remove it.");
    if (o.store !== undefined && o.store !== "memory" && o.store !== "forgedb" && !(o.store && typeof o.store === "object" && typeof o.store.get === "function" && typeof o.store.set === "function")) {
        fail("\"store\" must be \"memory\", \"forgedb\" or an object with get and set methods");
    }
    if (o.streakGrace !== undefined && (!Number.isFinite(o.streakGrace) || o.streakGrace < 0))
        fail("\"streakGrace\" must be a number of ms, 0 or more");
    if (w.path !== undefined && !/^\/\S*$/.test(w.path))
        fail("\"webhook.path\" must start with /");
    if (w.maxBodySize !== undefined && (!Number.isInteger(w.maxBodySize) || w.maxBodySize < 1024))
        fail("\"webhook.maxBodySize\" must be a whole number of at least 1024 bytes");
    if (o.dedupeWindow !== undefined && (!Number.isFinite(o.dedupeWindow) || o.dedupeWindow < 0 || o.dedupeWindow > 11 * 3_600_000)) {
        fail("\"dedupeWindow\" must be from 0 to 39600000 ms (11 hours)");
    }
    if (o.post) {
        if (!o.token)
            fail("\"post\" needs your Top.gg \"token\"");
        if (o.post.interval !== undefined && !(o.post.interval >= exports.MIN_POST_INTERVAL)) {
            fail(`"post.interval" must be at least ${exports.MIN_POST_INTERVAL} ms (15 minutes), Top.gg refuses more frequent posts`);
        }
    }
}
//# sourceMappingURL=index.js.map