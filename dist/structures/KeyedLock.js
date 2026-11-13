"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyedLock = void 0;
/**
 * Runs tasks with the same key one after another (tasks with different keys
 * run in parallel). Used so two votes of one user never read and write the
 * same history record at the same time.
 */
class KeyedLock {
    tails = new Map();
    get size() {
        return this.tails.size;
    }
    run(key, task) {
        const previous = this.tails.get(key) ?? Promise.resolve();
        const result = previous.then(() => task(), () => task());
        const tail = result.then(() => undefined, () => undefined);
        this.tails.set(key, tail);
        tail.then(() => {
            if (this.tails.get(key) === tail)
                this.tails.delete(key);
        });
        return result;
    }
}
exports.KeyedLock = KeyedLock;
//# sourceMappingURL=KeyedLock.js.map