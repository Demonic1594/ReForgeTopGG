import { Vote, voteTarget } from "./Vote"

/**
 * Remembers keys for a while, to drop repeated deliveries. Bounded: when full,
 * the oldest key is forgotten first.
 */
export class DedupeCache {
    private readonly expiries = new Map<string, number>()

    constructor(private readonly max = 10_000, private readonly now: () => number = Date.now) {}

    get size() {
        return this.expiries.size
    }

    has(key: string): boolean {
        const expiry = this.expiries.get(key)
        if (expiry === undefined) return false
        if (expiry <= this.now()) {
            this.expiries.delete(key)
            return false
        }
        return true
    }

    add(key: string, ttl: number) {
        if (ttl <= 0) return
        this.expiries.delete(key)
        this.expiries.set(key, this.now() + ttl)
        while (this.expiries.size > this.max) {
            this.expiries.delete(this.expiries.keys().next().value!)
        }
    }
}

/** Test deliveries are only collapsed for this long, so the test button can be pressed again. */
export const TEST_DEDUPE_WINDOW = 60_000

/**
 * What makes two deliveries the same vote. Signed (v1) votes carry an ID;
 * legacy votes do not, so voter, target and type identify them: a user can
 * only vote again 12 hours later, well outside the de-duplication window.
 */
export function dedupeKey(vote: Vote): string {
    if (vote.id) return `id:${vote.id}`
    return `${vote.source}:${voteTarget(vote)}:${vote.user}:${vote.type}`
}
