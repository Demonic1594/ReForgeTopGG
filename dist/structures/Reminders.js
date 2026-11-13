"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReminderScheduler = void 0;
/**
 * One timer per user, firing when that user can vote again. Timers do not
 * keep the process alive. A vote cooldown is 12 hours, far below the
 * ~24.8 day limit of setTimeout.
 */
class ReminderScheduler {
    fire;
    now;
    timers = new Map();
    constructor(fire, now = Date.now) {
        this.fire = fire;
        this.now = now;
    }
    get size() {
        return this.timers.size;
    }
    schedule(user, expiresAt) {
        this.cancel(user);
        const timer = setTimeout(() => {
            this.timers.delete(user);
            this.fire(user, expiresAt);
        }, Math.max(0, expiresAt - this.now()));
        timer.unref?.();
        this.timers.set(user, timer);
    }
    cancel(user) {
        const t = this.timers.get(user);
        if (t)
            clearTimeout(t);
        this.timers.delete(user);
    }
    clear() {
        for (const t of this.timers.values())
            clearTimeout(t);
        this.timers.clear();
    }
}
exports.ReminderScheduler = ReminderScheduler;
//# sourceMappingURL=Reminders.js.map