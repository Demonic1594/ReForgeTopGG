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
exports.TOPGG_EVENTS = exports.ReForgeTopGG = exports.MIN_REMINDER_MAX_DELAY = exports.DEFAULT_REMINDER_MAX_DELAY = exports.DEFAULT_STREAK_GRACE = exports.DEFAULT_DEDUPE_WINDOW = exports.DEFAULT_PATH = exports.DEFAULT_PORT = exports.MIN_POST_INTERVAL = void 0;
exports.readyEventName = readyEventName;
exports.normalizeOptions = normalizeOptions;
exports.formatDuration = formatDuration;
const forgescript_1 = require("@tryforge/forgescript");
const http_1 = require("http");
const topgg_autoposter_1 = require("topgg-autoposter");
const tiny_typed_emitter_1 = require("tiny-typed-emitter");
const constants_1 = require("./constants");
const TopGGCommandManager_1 = require("./structures/TopGGCommandManager");
const VoteWebhook_1 = require("./structures/VoteWebhook");
const Vote_1 = require("./structures/Vote");
const VoteStore_1 = require("./structures/VoteStore");
const DatabaseReminder_1 = require("./structures/DatabaseReminder");
const Reminders_1 = require("./structures/Reminders");
const TopGGApi_1 = require("./structures/TopGGApi");
const Dedupe_1 = require("./structures/Dedupe");
const KeyedLock_1 = require("./structures/KeyedLock");
const Logger_1 = require("./structures/Logger");
__exportStar(require("./structures/Vote"), exports);
__exportStar(require("./structures/VoteWebhook"), exports);
__exportStar(require("./structures/TopGGApi"), exports);
__exportStar(require("./structures/Dedupe"), exports);
__exportStar(require("./structures/KeyedLock"), exports);
__exportStar(require("./structures/VoteStore"), exports);
__exportStar(require("./structures/Reminders"), exports);
__exportStar(require("./structures/DatabaseReminder"), exports);
__exportStar(require("./structures/Logger"), exports);
/** Top.gg refuses to be posted to more often than every 15 minutes. */
exports.MIN_POST_INTERVAL = 900_000;
exports.DEFAULT_PORT = 3000;
exports.DEFAULT_PATH = "/dblwebhook";
/** Top.gg retries a legacy delivery up to 10 times over about half an hour. */
exports.DEFAULT_DEDUPE_WINDOW = 3_600_000;
/** A streak continues when the next vote comes at most this long after the user could vote again. */
exports.DEFAULT_STREAK_GRACE = 12 * 3_600_000;
/** A reminder that came due while the bot was offline is still sent when it is at most this late. */
exports.DEFAULT_REMINDER_MAX_DELAY = 12 * 3_600_000;
/** The smallest `reminderMaxDelay`: timers fire a little late, and a restart takes a while. */
exports.MIN_REMINDER_MAX_DELAY = 60_000;
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
    seen = new Dedupe_1.DedupeCache(100_000);
    /** Deliveries being processed, by dedupe key: a repeat waits for the first one's outcome. */
    inFlight = new Map();
    /** One history update per user at a time. */
    userLock = new KeyedLock_1.KeyedLock();
    closed = false;
    /** Where vote history is kept. */
    store;
    reminders;
    /** The options, with values from .env or JSON configs normalized (see normalizeOptions). */
    options;
    refused = { count: 0, since: 0, logged: 0 };
    constructor(rawOptions = {}) {
        super();
        const options = normalizeOptions(rawOptions);
        validateOptions(options);
        if (options.logLevel)
            Logger_1.ReForgeTopGGLogger.level = options.logLevel;
        this.options = options;
        this.api = new TopGGApi_1.TopGGApi(options.token ?? undefined);
        this.store = options.store === "forgedb"
            ? new VoteStore_1.ForgeDBVoteStore(options.storeVariable)
            : typeof options.store === "object" ? options.store : new VoteStore_1.MemoryVoteStore();
        this.reminders = options.reminders ? new Reminders_1.ReminderScheduler((user, expiresAt) => void this.remind(user, expiresAt)) : null;
        this.webhook = this.webhookEnabled
            ? new VoteWebhook_1.VoteWebhook({
                auth: options.auth,
                secret: this.webhookOptions.secret ?? undefined,
                maxBodySize: this.webhookOptions.maxBodySize,
                onVote: (vote) => this.receive(vote),
                onError: (err) => this.emitError(err),
                onRefused: (reason) => this.noteRefused(reason),
            })
            : null;
    }
    /**
     * Refused requests are not events (anyone can send them), but a webhook that
     * refuses everything usually means the secret does not match Top.gg's: log
     * a count, at most once a minute.
     */
    noteRefused(reason) {
        const now = Date.now();
        this.refused.count++;
        Logger_1.ReForgeTopGGLogger.debug(`webhook request refused: ${reason}`);
        if (now - this.refused.logged < 60_000)
            return;
        Logger_1.ReForgeTopGGLogger.warn(`Refused ${this.refused.count} webhook request(s)${this.refused.logged ? " since the last report" : ""} (last: ${reason}). If these are Top.gg's, the secret in your options does not match the one on Top.gg.`);
        this.refused = { count: 0, since: now, logged: now };
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
            traceRequest(req, res);
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
            throw new Error((0, Logger_1.prefixed)(`Cannot run alongside ${conflict.name}: both register $hasVoted, $voteUserID and the vote events. Remove ${conflict.name} from your extensions and uninstall it.`));
        }
        const unknown = (this.options.events ?? []).filter((e) => !exports.TOPGG_EVENTS.includes(e));
        if (unknown.length) {
            throw new Error((0, Logger_1.prefixed)(`Unknown event${unknown.length > 1 ? "s" : ""} ${unknown.map((e) => `"${e}"`).join(", ")} in "events". The events are ${exports.TOPGG_EVENTS.join(", ")}.`));
        }
        const names = new Set((client.options.extensions ?? []).map((x) => x.name));
        if (this.options.store === "forgedb" && !names.has("reforge.db") && !names.has("forge.db")) {
            throw new Error((0, Logger_1.prefixed)("Store \"forgedb\" needs a database extension: add new ReForgeDB() (recommended, npm i github:Demonic1594/ReForgeDB) or new ForgeDB() (npm i @tryforge/forge.db) to your extensions."));
        }
        if (names.has("forge.db") && !names.has("reforge.db"))
            (0, DatabaseReminder_1.remindToSwitch)();
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
                    poster.on("posted", (stats) => {
                        Logger_1.ReForgeTopGGLogger.debug(`stats posted to Top.gg: ${stats.serverCount} servers${stats.shardCount ? `, ${stats.shardCount} shards` : ""}`);
                        this.safeEmit("posted", stats);
                    });
                    this.poster = poster;
                    Logger_1.ReForgeTopGGLogger.info(`Posting stats to Top.gg every ${Math.round((post.interval ?? exports.MIN_POST_INTERVAL) / 60_000)} minutes`);
                }
                catch (err) {
                    this.emitError(new Error(`Top.gg stats posting could not start: ${(0, Logger_1.errorMessage)(err)}`));
                }
            });
        }
        // The "forgedb" store reads and writes through client.db: ReForgeDB's or ForgeDB's DataBase.
        if (this.store instanceof VoteStore_1.ForgeDBVoteStore) {
            const store = this.store;
            store.use(() => {
                const db = client.db;
                if (!db)
                    throw new Error("The database (ReForgeDB or ForgeDB) is not loaded");
                return db;
            });
        }
        if (this.webhook && this.webhookOptions.listen !== false)
            this.listen();
        else if (!this.webhook)
            Logger_1.ReForgeTopGGLogger.info("No webhook auth or secret set, vote webhook is off");
        if (this.reminders && this.store.pending) {
            // Reschedule reminders a persistent store still holds.
            this.client.once(readyEventName(), () => void this.restoreReminders());
        }
        // Commands added for an event that is not in `events` never run: say so once.
        this.client.once(readyEventName(), () => {
            for (const name of exports.TOPGG_EVENTS) {
                if (this.commands.get(name).length && !this.options.events?.includes(name)) {
                    Logger_1.ReForgeTopGGLogger.warn(`There are ${name} commands, but "${name}" is not in the extension's events, so they never run. Add it to events: [...].`);
                }
            }
            const listens = !!this.options.events?.includes("voteReminder");
            if (listens && !this.reminders)
                Logger_1.ReForgeTopGGLogger.warn("\"voteReminder\" is in events, but \"reminders\" is off, so it never fires. Set reminders: true.");
            // ForgeScript's event handlers listen on the emitter too, so this counts both kinds.
            if (this.reminders && this.emitter.listenerCount("voteReminder") === 0) {
                Logger_1.ReForgeTopGGLogger.warn("\"reminders\" is on, but \"voteReminder\" is not in events, so reminders are timed for nothing. Add it to events: [...] or turn reminders off.");
            }
        });
        const auth = this.options.auth;
        if (typeof auth === "string" && auth !== auth.trim()) {
            Logger_1.ReForgeTopGGLogger.warn("\"auth\" starts or ends with whitespace (a stray space or a Windows line ending in .env?). Top.gg sends the value exactly as entered, so votes are refused if it differs.");
        }
        // ForgeExtension has no shutdown hook: close with the client.
        const destroy = client.destroy.bind(client);
        client.destroy = async () => {
            await this.close();
            return destroy();
        };
    }
    listen() {
        const port = Number(this.webhookOptions.port ?? this.options.port ?? exports.DEFAULT_PORT);
        const host = this.webhookOptions.host;
        const path = this.webhookOptions.path ?? exports.DEFAULT_PATH;
        // connectionsCheckingInterval: Node enforces the header and request timeouts
        // only when it checks, every 30 s by default; slow clients are cut off sooner.
        const server = (0, http_1.createServer)({ connectionsCheckingInterval: 1000 }, (req, res) => {
            traceRequest(req, res);
            const url = (req.url ?? "/").split("?")[0];
            if (url !== path) {
                req.resume();
                res.writeHead(404, req.complete ? {} : { connection: "close" }).end();
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
            Logger_1.ReForgeTopGGLogger.info(`Vote webhook listening on port ${actual}, path ${path}`);
        });
        this.server = server;
    }
    /**
     * Handles a vote that passed authentication and validation. Public so a
     * webhook mounted elsewhere, or a test, can feed votes in.
     */
    async receive(vote) {
        const key = (0, Dedupe_1.dedupeKey)(vote);
        const who = `vote of ${vote.user} for ${(0, Vote_1.voteTarget)(vote)}`;
        if (this.seen.has(key)) {
            Logger_1.ReForgeTopGGLogger.debug(`${who} dropped: repeat of a delivery already handled`);
            return false;
        }
        const running = this.inFlight.get(key);
        if (running) {
            // A repeat while the first delivery is still being stored. If that one
            // fails, this one must fail too (Top.gg then delivers it again), or the
            // vote would be lost.
            Logger_1.ReForgeTopGGLogger.debug(`${who} dropped: repeat of a delivery being stored, waiting for its outcome`);
            await running;
            return false;
        }
        const task = this.process(key, vote);
        this.inFlight.set(key, task);
        try {
            return await task;
        }
        finally {
            this.inFlight.delete(key);
        }
    }
    async process(key, vote) {
        // Test votes are not history. A failed write throws, the webhook answers
        // 500 and Top.gg delivers the vote again.
        const started = performance.now();
        if (vote.type === "upvote") {
            await this.userLock.run(vote.user, async () => {
                const record = (0, VoteStore_1.applyVote)(await this.store.get(vote.user), vote, this.streakGrace);
                await this.store.set(record);
                this.reminders?.schedule(record.user, record.expiresAt);
            });
            this.api.forget(vote.user);
        }
        Logger_1.ReForgeTopGGLogger.debug(`vote of ${vote.user} for ${(0, Vote_1.voteTarget)(vote)} accepted (${vote.type}, ${vote.source}, weight ${vote.weight}${vote.type === "upvote" ? `, stored in ${(performance.now() - started).toFixed(1)} ms` : ", not stored"})`);
        const window = this.options.dedupeWindow ?? exports.DEFAULT_DEDUPE_WINDOW;
        this.seen.add(key, vote.type === "test" ? Math.min(window, Dedupe_1.TEST_DEDUPE_WINDOW) : window);
        // The vote is stored: a failing listener must not turn it into a 500.
        this.safeEmit("voted", vote);
        return true;
    }
    /** Emits without letting a listener's exception escape (into the webhook, a timer or the server). */
    safeEmit(name, ...args) {
        try {
            ;
            this.emitter.emit(name, ...args);
        }
        catch (err) {
            Logger_1.ReForgeTopGGLogger.error(`A ${name} listener threw: ${(0, Logger_1.errorMessage)(err)}`);
        }
    }
    get streakGrace() {
        return this.options.streakGrace ?? exports.DEFAULT_STREAK_GRACE;
    }
    /** The vote history of a user, if any. */
    async getRecord(user) {
        return (await this.store.get(user)) ?? undefined;
    }
    /** How late a reminder may be and still be sent. */
    get reminderMaxDelay() {
        return this.options.reminderMaxDelay ?? exports.DEFAULT_REMINDER_MAX_DELAY;
    }
    /**
     * Sends the reminder of the vote that ends at `expiresAt`, once, or drops it
     * when it is more than `reminderMaxDelay` late. Returns whether it was sent.
     * Holds the user's lock: a vote stored meanwhile is never overwritten.
     */
    async remind(user, expiresAt) {
        if (this.closed)
            return false;
        try {
            const record = await this.userLock.run(user, async () => {
                const current = await this.store.get(user);
                // A newer vote moved the reminder, or it was already sent.
                if (!current || current.reminded || current.expiresAt !== expiresAt)
                    return null;
                current.reminded = true;
                await this.store.set(current);
                return current;
            });
            if (!record)
                return false;
            const late = Date.now() - expiresAt;
            if (late > this.reminderMaxDelay) {
                Logger_1.ReForgeTopGGLogger.debug(`reminder of ${user} dropped: it came due ${formatDuration(late)} ago`);
                return false;
            }
            Logger_1.ReForgeTopGGLogger.debug(`reminder of ${user} sent`);
            this.safeEmit("voteReminder", (0, VoteStore_1.recordToVote)(record));
            return true;
        }
        catch (err) {
            this.emitError(new Error(`Vote reminder for ${user} failed: ${(0, Logger_1.errorMessage)(err)}`));
            return false;
        }
    }
    async restoreReminders() {
        try {
            const now = Date.now();
            const stale = [];
            let scheduled = 0;
            for (const record of await this.store.pending()) {
                if (now - record.expiresAt > this.reminderMaxDelay)
                    stale.push(record);
                else {
                    this.reminders?.schedule(record.user, record.expiresAt);
                    scheduled++;
                }
            }
            // Marked as sent one at a time, never as a burst of writes, and after
            // the reminders that are still due have been scheduled.
            for (const record of stale) {
                if (this.closed)
                    return;
                await this.remind(record.user, record.expiresAt);
            }
            if (scheduled)
                Logger_1.ReForgeTopGGLogger.debug(`${scheduled} reminder(s) restored`);
            if (stale.length)
                Logger_1.ReForgeTopGGLogger.info(`Dropped ${stale.length} reminder(s) that came due more than ${formatDuration(this.reminderMaxDelay)} ago while the bot was offline (reminderMaxDelay)`);
        }
        catch (err) {
            this.emitError(new Error(`Vote reminders could not be restored: ${(0, Logger_1.errorMessage)(err)}`));
        }
    }
    /**
     * Sends a test vote to the running webhook over HTTP, exactly as Top.gg
     * would (signed when a v1 secret is set). Resolves with the HTTP status.
     * Test votes run the voted event with $voteType "test" and are not stored.
     */
    async sendTestVote(options) {
        if (!(0, Vote_1.isSnowflake)(options.user))
            throw new Error((0, Logger_1.prefixed)(`"${options.user}" is not a user ID`));
        const server = this.server;
        const address = server?.listening ? server.address() : null;
        if (!address || typeof address !== "object")
            throw new Error((0, Logger_1.prefixed)("The vote webhook is not listening"));
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
            headers.authorization = String(this.options.auth);
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
            this.safeEmit("error", err);
        else
            Logger_1.ReForgeTopGGLogger.error(err.message);
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
/** The events the extension can emit. */
exports.TOPGG_EVENTS = ["voted", "voteReminder", "posted", "error"];
/**
 * Values that come from .env files or JSON configs, made usable: a numeric
 * string port becomes a number, a numeric auth a string, and null means "not
 * set". Anything else is left for validateOptions to refuse.
 */
function normalizeOptions(raw) {
    const o = { ...raw };
    const port = (p) => (typeof p === "string" && /^\s*\d{1,5}\s*$/.test(p) ? Number(p) : p);
    if (o.auth === null)
        delete o.auth;
    if (typeof o.auth === "number" && Number.isFinite(o.auth))
        o.auth = String(o.auth);
    if (o.token === null)
        delete o.token;
    if (o.port !== undefined)
        o.port = port(o.port);
    if (o.webhook && typeof o.webhook === "object") {
        o.webhook = { ...o.webhook };
        if (o.webhook.port !== undefined)
            o.webhook.port = port(o.webhook.port);
        if (o.webhook.secret === null)
            delete o.webhook.secret;
    }
    return o;
}
function validateOptions(o) {
    const fail = (msg) => { throw new Error((0, Logger_1.prefixed)(msg)); };
    if (o.logLevel !== undefined && !(0, Logger_1.isLogLevel)(o.logLevel))
        fail(`"logLevel" must be one of ${Logger_1.LOG_LEVELS.join(", ")}, got ${JSON.stringify(o.logLevel)}`);
    if (o.reminderMaxDelay !== undefined && (!Number.isFinite(o.reminderMaxDelay) || o.reminderMaxDelay < exports.MIN_REMINDER_MAX_DELAY)) {
        fail(`"reminderMaxDelay" must be a number of ms, at least ${exports.MIN_REMINDER_MAX_DELAY} (1 minute)`);
    }
    if (o.auth !== undefined && typeof o.auth !== "string")
        fail(`"auth" must be text, got ${typeof o.auth}`);
    if (typeof o.auth === "string" && o.auth.trim() === "") {
        fail("\"auth\" is empty. Anyone could send fake votes to an unprotected webhook. Set it to the authorization you entered on Top.gg, or remove it to turn the webhook off.");
    }
    const port = (o.webhook || {}).port ?? o.port;
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535))
        fail(`"port" must be a whole number from 0 to 65535, got ${JSON.stringify(port)}`);
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
/** A duration for log messages: "45 s", "12 min", "3.5 h", "60 days". */
function formatDuration(ms) {
    if (ms < 60_000)
        return `${Math.round(ms / 1000)} s`;
    if (ms < 3_600_000)
        return `${Math.round(ms / 60_000)} min`;
    if (ms < 2 * 86_400_000)
        return `${+(ms / 3_600_000).toFixed(1)} h`;
    return `${Math.round(ms / 86_400_000)} days`;
}
/** Logs each webhook request with its answer at trace level: method, path, status and time, never headers or body. */
function traceRequest(req, res) {
    if (!Logger_1.ReForgeTopGGLogger.enabled("trace"))
        return;
    const started = performance.now();
    res.once("finish", () => {
        const path = (req.url ?? "/").split("?")[0].slice(0, 200);
        Logger_1.ReForgeTopGGLogger.trace(`${req.method} ${path} -> ${res.statusCode} (${(performance.now() - started).toFixed(1)} ms)`);
    });
}
//# sourceMappingURL=index.js.map