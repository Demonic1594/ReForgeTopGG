import { Vote } from "./Vote";
/**
 * Remembers keys for a while, to drop repeated deliveries. Bounded: when full,
 * the oldest key is forgotten first.
 */
export declare class DedupeCache {
    private readonly max;
    private readonly now;
    private readonly expiries;
    constructor(max?: number, now?: () => number);
    get size(): number;
    has(key: string): boolean;
    add(key: string, ttl: number): void;
}
/** Test deliveries are only collapsed for this long, so the test button can be pressed again. */
export declare const TEST_DEDUPE_WINDOW = 60000;
/**
 * What makes two deliveries the same vote. Signed (v1) votes carry an ID;
 * legacy votes do not, so voter, target and type identify them: a user can
 * only vote again 12 hours later, well outside the de-duplication window.
 */
export declare function dedupeKey(vote: Vote): string;
//# sourceMappingURL=Dedupe.d.ts.map