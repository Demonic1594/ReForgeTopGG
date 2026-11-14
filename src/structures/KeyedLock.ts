/**
 * Runs tasks with the same key one after another (tasks with different keys
 * run in parallel). Used so two votes of one user never read and write the
 * same history record at the same time.
 */
export class KeyedLock {
    private readonly tails = new Map<string, Promise<unknown>>()

    get size() {
        return this.tails.size
    }

    run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        const previous = this.tails.get(key) ?? Promise.resolve()
        const result = previous.then(() => task(), () => task())
        const tail = result.then(() => undefined, () => undefined)
        this.tails.set(key, tail)
        tail.then(() => {
            if (this.tails.get(key) === tail) this.tails.delete(key)
        })
        return result
    }
}
