/**
 * Runs tasks with the same key one after another (tasks with different keys
 * run in parallel). Used so two votes of one user never read and write the
 * same history record at the same time.
 */
export declare class KeyedLock {
    private readonly tails;
    get size(): number;
    run<T>(key: string, task: () => Promise<T> | T): Promise<T>;
}
//# sourceMappingURL=KeyedLock.d.ts.map