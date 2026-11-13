/**
 * One timer per user, firing when that user can vote again. Timers do not
 * keep the process alive. A vote cooldown is 12 hours, far below the
 * ~24.8 day limit of setTimeout.
 */
export declare class ReminderScheduler {
    private readonly fire;
    private readonly now;
    private readonly timers;
    constructor(fire: (user: string, expiresAt: number) => void, now?: () => number);
    get size(): number;
    schedule(user: string, expiresAt: number): void;
    cancel(user: string): void;
    clear(): void;
}
//# sourceMappingURL=Reminders.d.ts.map