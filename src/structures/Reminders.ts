/**
 * One timer per user, firing when that user can vote again. Timers do not
 * keep the process alive. A vote cooldown is 12 hours, far below the
 * ~24.8 day limit of setTimeout.
 */
export class ReminderScheduler {
    private readonly timers = new Map<string, NodeJS.Timeout>()

    constructor(private readonly fire: (user: string, expiresAt: number) => void, private readonly now: () => number = Date.now) {}

    get size() {
        return this.timers.size
    }

    schedule(user: string, expiresAt: number) {
        this.cancel(user)
        const timer = setTimeout(() => {
            this.timers.delete(user)
            this.fire(user, expiresAt)
        }, Math.max(0, expiresAt - this.now()))
        timer.unref?.()
        this.timers.set(user, timer)
    }

    cancel(user: string) {
        const t = this.timers.get(user)
        if (t) clearTimeout(t)
        this.timers.delete(user)
    }

    clear() {
        for (const t of this.timers.values()) clearTimeout(t)
        this.timers.clear()
    }
}
