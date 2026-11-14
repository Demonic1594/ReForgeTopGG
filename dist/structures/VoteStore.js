"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForgeDBVoteStore = exports.DatabaseVoteStore = exports.DATABASE_EXTENSIONS = exports.MemoryVoteStore = void 0;
exports.applyVote = applyVote;
exports.currentStreak = currentStreak;
exports.recordToVote = recordToVote;
exports.loadedDatabaseExtensions = loadedDatabaseExtensions;
exports.resolveDataBase = resolveDataBase;
const Vote_1 = require("./Vote");
const Logger_1 = require("./Logger");
/** Folds a new vote into the user's record. Test votes must not be passed. */
function applyVote(previous, vote, streakGrace) {
    const continues = previous !== undefined && vote.votedAt <= previous.expiresAt + streakGrace;
    return {
        user: vote.user,
        target: (0, Vote_1.voteTarget)(vote),
        targetIsGuild: vote.guild !== undefined,
        count: (previous?.count ?? 0) + 1,
        points: (previous?.points ?? 0) + vote.weight,
        streak: continues ? previous.streak + 1 : 1,
        firstVoteAt: previous?.firstVoteAt ?? vote.votedAt,
        lastVoteAt: vote.votedAt,
        expiresAt: vote.expiresAt,
        lastWeight: vote.weight,
        reminded: false,
    };
}
/** The streak as it stands now: 0 once the user missed the chance to continue it. */
function currentStreak(record, now, streakGrace) {
    if (!record)
        return 0;
    return now <= record.expiresAt + streakGrace ? record.streak : 0;
}
/** Rebuilds the last vote of a record, for the voteReminder event. */
function recordToVote(record) {
    return {
        user: record.user,
        ...(record.targetIsGuild ? { guild: record.target } : { bot: record.target }),
        type: "upvote",
        isWeekend: record.lastWeight > 1,
        weight: record.lastWeight,
        query: {},
        votedAt: record.lastVoteAt,
        expiresAt: record.expiresAt,
        source: "v0",
    };
}
/**
 * Keeps records in memory, at most `max` users (the least recently voting
 * users are forgotten first). Everything is lost on restart.
 */
class MemoryVoteStore {
    max;
    records = new Map();
    constructor(max = 100_000) {
        this.max = max;
    }
    get size() {
        return this.records.size;
    }
    get(user) {
        const r = this.records.get(user);
        return r ? { ...r } : undefined;
    }
    set(record) {
        this.records.delete(record.user);
        this.records.set(record.user, { ...record });
        while (this.records.size > this.max)
            this.records.delete(this.records.keys().next().value);
    }
    pending() {
        return [...this.records.values()].filter((r) => !r.reminded).map((r) => ({ ...r }));
    }
}
exports.MemoryVoteStore = MemoryVoteStore;
/** The database extensions the database store works with, in order of preference. */
exports.DATABASE_EXTENSIONS = ["reforge.db", "forge.db"];
const LABELS = { "reforge.db": "ReForgeDB", "forge.db": "ForgeDB" };
/** The database extensions the bot loaded, preferred one first. */
function loadedDatabaseExtensions(client) {
    const out = [];
    for (const name of exports.DATABASE_EXTENSIONS) {
        const extension = client.options.extensions?.find((x) => x.name === name);
        if (extension)
            out.push({ name, label: LABELS[name], extension });
    }
    return out;
}
function isDataBase(value) {
    const v = value;
    return (typeof v === "function" || typeof v === "object") && !!v && typeof v.get === "function" && typeof v.set === "function" && typeof v.find === "function";
}
/**
 * The `DataBase` a loaded extension's package exports (ReForgeDB exports it),
 * found through the module cache so it is the very copy the bot loaded.
 */
function exportedDataBase(extension) {
    const ctor = extension.constructor;
    for (const mod of Object.values(require.cache)) {
        try {
            const exports = mod?.exports;
            if (exports && typeof exports === "object" && exports[ctor.name] === ctor && isDataBase(exports.DataBase))
                return exports.DataBase;
        }
        catch {
            // A module with odd exports (a throwing getter or proxy): not ours.
        }
    }
    return undefined;
}
/**
 * Finds the `DataBase` class of the database extension the bot loaded:
 * ReForgeDB, else ForgeDB. Both set `client.db` to it; with both loaded,
 * `client.db` is whichever loaded last, so ReForgeDB's own exports are used.
 */
function resolveDataBase(client) {
    const [preferred, other] = loadedDatabaseExtensions(client);
    if (!preferred)
        throw new Error("No database extension is loaded: add new ReForgeDB() or new ForgeDB() to your extensions");
    const db = (other && exportedDataBase(preferred.extension)) || (isDataBase(client.db) ? client.db : undefined) || exportedDataBase(preferred.extension);
    if (!db)
        throw new Error(`${preferred.label} is in your extensions but did not set up its database (client.db is ${client.db === undefined ? "missing" : "not its DataBase class"}). Check the errors ${preferred.label} logged at start-up.`);
    return { label: preferred.label, db, alsoLoaded: other?.label };
}
/**
 * Keeps records in user variables of ReForgeDB or ForgeDB, whichever the bot
 * loaded (ReForgeDB when both are): one JSON value per user, readable with
 * `$getUserVar[<name>;<user ID>]`. Neither is a dependency of this package.
 */
class DatabaseVoteStore {
    variable;
    load;
    db = null;
    label = "The database";
    client = null;
    /**
     * @param variable The user variable records are kept in.
     * @param load Returns the `DataBase` class to use. By default it is the
     * one of the database extension the client loaded (see `attach`).
     */
    constructor(variable = "topggVote", load) {
        this.variable = variable;
        this.load = load;
    }
    /** Called by the extension with its client, to find the database extension the bot loaded. */
    attach(client) {
        this.client = client;
        this.db = null;
    }
    /** Sets `db` once: the one `load` returns, else the client's database extension. */
    resolve() {
        if (this.load)
            return this.load();
        if (this.client) {
            const { label, db, alsoLoaded } = resolveDataBase(this.client);
            this.label = label;
            Logger_1.ReForgeTopGGLogger.debug(`vote history is kept in the ${label} user variable "${this.variable}"`);
            if (alsoLoaded)
                Logger_1.ReForgeTopGGLogger.warn(`Both ${label} and ${alsoLoaded} are loaded. They add the same functions, so keep only one (vote history uses ${label}).`);
            return db;
        }
        // Used on its own, without the extension: the installed package.
        for (const [pkg, label] of [["@tryforge/reforge.db", "ReForgeDB"], ["@tryforge/forge.db/dist/util", "ForgeDB"]]) {
            try {
                const db = require(pkg).DataBase;
                if (isDataBase(db)) {
                    this.label = label;
                    return db;
                }
            }
            catch {
                // Not installed: try the next one.
            }
        }
        throw new Error("No database: install and load ReForgeDB or ForgeDB");
    }
    /**
     * The database opens in the background after the bot starts. Wait for
     * it: briefly for a vote (the webhook must answer Top.gg within 5 s, and a
     * failure makes Top.gg deliver it again), longer when restoring reminders.
     */
    async database(waitMs) {
        const db = (this.db ??= this.resolve());
        if (typeof db.ready === "function") {
            // ReForgeDB says when it is connected (and why it never will be).
            await db.ready(waitMs).catch((err) => {
                throw new Error(`${this.label} is not connected yet: ${(0, Logger_1.errorMessage)(err)}`);
            });
            return db;
        }
        // ForgeDB keeps its connection in a private static field.
        const connected = () => !!db.db;
        for (const until = Date.now() + waitMs; !connected() && Date.now() < until;)
            await new Promise((r) => setTimeout(r, 50));
        if (!connected())
            throw new Error(`${this.label} is not connected yet`);
        return db;
    }
    async get(user) {
        const row = await (await this.database(3_000)).get({ type: "user", name: this.variable, id: user });
        return row ? parseRecord(row.value) : undefined;
    }
    async set(record) {
        await (await this.database(3_000)).set({ type: "user", name: this.variable, id: record.user, value: JSON.stringify(record) });
    }
    async pending() {
        const rows = await (await this.database(60_000)).find({ type: "user", name: this.variable });
        return rows.map((r) => parseRecord(r.value)).filter((r) => !!r && !r.reminded);
    }
}
exports.DatabaseVoteStore = DatabaseVoteStore;
/** @deprecated Renamed to `DatabaseVoteStore`, which also works with ReForgeDB. */
exports.ForgeDBVoteStore = DatabaseVoteStore;
function parseRecord(value) {
    try {
        const r = typeof value === "string" ? JSON.parse(value) : value;
        return r && typeof r === "object" && typeof r.user === "string" && typeof r.expiresAt === "number" ? r : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=VoteStore.js.map