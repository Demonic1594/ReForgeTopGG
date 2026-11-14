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
/** Minimal shape of ForgeDB's DataBase class used here. */
interface ForgeDBDataBase {
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
}
/**
 * Keeps records in ForgeDB user variables (one JSON value per user, readable
 * with `$getUserVar[<name>;<user ID>]`). ForgeDB must be installed and loaded
 * as an extension; it is not a dependency of this package.
 */
export declare class ForgeDBVoteStore implements VoteStore {
    readonly variable: string;
    private readonly load;
    private db;
    constructor(variable?: string, load?: () => ForgeDBDataBase);
    /**
     * ForgeDB opens its database in the background after the bot starts. Wait for
     * it: briefly for a vote (the webhook must answer Top.gg within 5 s, and a
     * failure makes Top.gg deliver it again), longer when restoring reminders.
     */
    private database;
    get(user: string): Promise<VoteRecord | undefined>;
    set(record: VoteRecord): Promise<void>;
    pending(): Promise<VoteRecord[]>;
}
export {};
//# sourceMappingURL=VoteStore.d.ts.map