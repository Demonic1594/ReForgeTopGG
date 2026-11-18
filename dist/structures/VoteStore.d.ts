import { Vote } from "./Vote";
/** What the extension remembers about one user's votes. */
export interface VoteRecord {
    /** Discord ID of the voter. */
    user: string;
    /** The bot or server voted for last. */
    target: string;
    /** Whether `target` is a server. */
    targetIsGuild: boolean;
    /** Votes recorded (test votes are not). */
    count: number;
    /** Votes recorded, counting weekend votes twice. */
    points: number;
    /** Votes in a row, each cast at most `streakGrace` after the previous one expired. */
    streak: number;
    firstVoteAt: number;
    lastVoteAt: number;
    /** When the user can vote again. */
    expiresAt: number;
    /** Weight of the last vote. */
    lastWeight: number;
    /** Whether the reminder for the last vote was sent. */
    reminded: boolean;
}
/**
 * Where vote records are kept. Implement this to keep them in your own
 * database; methods may be synchronous or return promises.
 */
export interface VoteStore {
    get(user: string): Promise<VoteRecord | undefined> | VoteRecord | undefined;
    set(record: VoteRecord): Promise<void> | void;
    /**
     * Records whose reminder has not been sent yet. Used to schedule reminders
     * again after a restart; stores that lose data on restart can omit it.
     */
    pending?(): Promise<VoteRecord[]> | VoteRecord[];
    /**
     * With several bot processes on one store: claims the reminder of the vote that ends at `expiresAt`,
     * so exactly one process sends it. `true`: this process sends it; `false`: another process has it;
     * `undefined`: this store cannot claim (then only the process with shard 0 restores reminders).
     */
    claimReminder?(user: string, expiresAt: number): Promise<boolean | undefined> | boolean | undefined;
    /** Ends a claim once the reminder is marked as sent (or dropped). */
    releaseReminder?(user: string, expiresAt: number): Promise<void> | void;
}
/** Folds a new vote into the user's record. Test votes must not be passed. */
export declare function applyVote(previous: VoteRecord | undefined, vote: Vote, streakGrace: number): VoteRecord;
/** The streak as it stands now: 0 once the user missed the chance to continue it. */
export declare function currentStreak(record: VoteRecord | undefined, now: number, streakGrace: number): number;
/** Rebuilds the last vote of a record, for the voteReminder event. */
export declare function recordToVote(record: VoteRecord): Vote;
/**
 * Keeps records in memory, at most `max` users (the least recently voting
 * users are forgotten first). Everything is lost on restart.
 */
export declare class MemoryVoteStore implements VoteStore {
    private readonly max;
    private readonly records;
    constructor(max?: number);
    get size(): number;
    get(user: string): {
        /** Discord ID of the voter. */
        user: string;
        /** The bot or server voted for last. */
        target: string;
        /** Whether `target` is a server. */
        targetIsGuild: boolean;
        /** Votes recorded (test votes are not). */
        count: number;
        /** Votes recorded, counting weekend votes twice. */
        points: number;
        /** Votes in a row, each cast at most `streakGrace` after the previous one expired. */
        streak: number;
        firstVoteAt: number;
        lastVoteAt: number;
        /** When the user can vote again. */
        expiresAt: number;
        /** Weight of the last vote. */
        lastWeight: number;
        /** Whether the reminder for the last vote was sent. */
        reminded: boolean;
    } | undefined;
    set(record: VoteRecord): void;
    pending(): {
        /** Discord ID of the voter. */
        user: string;
        /** The bot or server voted for last. */
        target: string;
        /** Whether `target` is a server. */
        targetIsGuild: boolean;
        /** Votes recorded (test votes are not). */
        count: number;
        /** Votes recorded, counting weekend votes twice. */
        points: number;
        /** Votes in a row, each cast at most `streakGrace` after the previous one expired. */
        streak: number;
        firstVoteAt: number;
        lastVoteAt: number;
        /** When the user can vote again. */
        expiresAt: number;
        /** Weight of the last vote. */
        lastWeight: number;
        /** Whether the reminder for the last vote was sent. */
        reminded: boolean;
    }[];
}
/** The database extensions the database store works with, in order of preference. */
export declare const DATABASE_EXTENSIONS: readonly ["reforge.db", "forge.db"];
export type DatabaseExtensionName = (typeof DATABASE_EXTENSIONS)[number];
/** Minimal shape of the `DataBase` class of ReForgeDB and ForgeDB used here. */
export interface DataBaseLike {
    get(data: {
        type: string;
        name: string;
        id: string;
    }): Promise<{
        value: string;
    } | null>;
    set(data: {
        type: string;
        name: string;
        id: string;
        value: string;
    }): Promise<void>;
    find(data: {
        type: string;
        name: string;
    }): Promise<Array<{
        value: string;
    }>>;
    /** ReForgeDB: resolves once connected, rejects after `timeout` ms. */
    ready?(timeout?: number): Promise<void>;
    /** ReForgeDB: starts a stored cooldown only if it is not running, across processes; `0` when started. */
    cdClaim?(data: {
        name: string;
        id?: string;
        duration: number;
    }): Promise<number>;
    cdDelete?(identifier: string): Promise<unknown>;
    make_cdIdentifier?(data: {
        name?: string;
        id?: string;
    }): string;
}
/**
 * Reminder claims are ReForgeDB cooldowns with this name, `<user>.<expiresAt>` as the ID. Each one is
 * deleted as soon as the reminder is marked as sent; one left by a process that stopped in between
 * expires after `REMINDER_CLAIM_TTL` ms (a `cooldownExpire` command sees it under this name).
 */
export declare const REMINDER_CLAIM = "reforge.topgg.reminder";
export declare const REMINDER_CLAIM_TTL: number;
interface ClientLike {
    options: {
        extensions?: Array<{
            name: string;
            constructor: Function;
        }>;
    };
    db?: unknown;
}
/** The database extensions the bot loaded, preferred one first. */
export declare function loadedDatabaseExtensions(client: ClientLike): {
    name: DatabaseExtensionName;
    label: string;
    extension: {
        name: string;
        constructor: Function;
    };
}[];
/**
 * Finds the `DataBase` class of the database extension the bot loaded:
 * ReForgeDB, else ForgeDB. Both set `client.db` to it; with both loaded,
 * `client.db` is whichever loaded last, so ReForgeDB's own exports are used.
 */
export declare function resolveDataBase(client: ClientLike): {
    label: string;
    db: DataBaseLike;
    alsoLoaded?: string;
};
/**
 * Keeps records in user variables of ReForgeDB or ForgeDB, whichever the bot
 * loaded (ReForgeDB when both are): one JSON value per user, readable with
 * `$getUserVar[<name>;<user ID>]`. Neither is a dependency of this package.
 */
export declare class DatabaseVoteStore implements VoteStore {
    readonly variable: string;
    private readonly load?;
    private db;
    private label;
    private client;
    /**
     * @param variable The user variable records are kept in.
     * @param load Returns the `DataBase` class to use. By default it is the
     * one of the database extension the client loaded (see `attach`).
     */
    constructor(variable?: string, load?: (() => DataBaseLike) | undefined);
    /** Called by the extension with its client, to find the database extension the bot loaded. */
    attach(client: ClientLike): void;
    /** Sets `db` once: the one `load` returns, else the client's database extension. */
    private resolve;
    /**
     * The database opens in the background after the bot starts. Wait for
     * it: briefly for a vote (the webhook must answer Top.gg within 5 s, and a
     * failure makes Top.gg deliver it again), longer when restoring reminders.
     */
    private database;
    get(user: string): Promise<VoteRecord | undefined>;
    set(record: VoteRecord): Promise<void>;
    pending(): Promise<VoteRecord[]>;
    /**
     * ReForgeDB: a conditional write in the database decides which process sends a reminder, so with
     * several processes exactly one does. ForgeDB has no conditional write: `undefined`.
     */
    claimReminder(user: string, expiresAt: number): Promise<boolean | undefined>;
    releaseReminder(user: string, expiresAt: number): Promise<void>;
}
/** @deprecated Renamed to `DatabaseVoteStore`, which also works with ReForgeDB. */
export declare const ForgeDBVoteStore: typeof DatabaseVoteStore;
/** @deprecated Renamed to `DatabaseVoteStore`. */
export type ForgeDBVoteStore = DatabaseVoteStore;
export {};
//# sourceMappingURL=VoteStore.d.ts.map