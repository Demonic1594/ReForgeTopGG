"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_DEDUPE_WINDOW = exports.DedupeCache = void 0;
exports.dedupeKey = dedupeKey;
const Vote_1 = require("./Vote");
/**
 * Remembers keys for a while, to drop repeated deliveries. Bounded: when full,
 * the oldest key is forgotten first.
 */
class DedupeCache {
    max;
    now;
    expiries = new Map();
    constructor(max = 10_000, now = Date.now) {
        this.max = max;
        this.now = now;
    }
    get size() {
        return this.expiries.size;
    }
    has(key) {
        const expiry = this.expiries.get(key);
        if (expiry === undefined)
            return false;
        if (expiry <= this.now()) {
            this.expiries.delete(key);
            return false;
        }
        return true;
    }
    add(key, ttl) {
        if (ttl <= 0)
            return;
        this.expiries.delete(key);
        this.expiries.set(key, this.now() + ttl);
        while (this.expiries.size > this.max) {
            this.expiries.delete(this.expiries.keys().next().value);
        }
    }
}
exports.DedupeCache = DedupeCache;
/** Test deliveries are only collapsed for this long, so the test button can be pressed again. */
exports.TEST_DEDUPE_WINDOW = 60_000;
/**
 * What makes two deliveries the same vote. Signed (v1) votes carry an ID;
 * legacy votes do not, so voter, target and type identify them: a user can
 * only vote again 12 hours later, well outside the de-duplication window.
 */
function dedupeKey(vote) {
    if (vote.id)
        return `id:${vote.id}`;
    return `${vote.source}:${(0, Vote_1.voteTarget)(vote)}:${vote.user}:${vote.type}`;
}
//# sourceMappingURL=Dedupe.js.map