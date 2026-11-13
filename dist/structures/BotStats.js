"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentStats = currentStats;
/** The posted stats an event is running for, or `undefined` elsewhere. */
function currentStats(extras) {
    if (!extras || typeof extras !== "object" || extras instanceof Error)
        return undefined;
    return "serverCount" in extras ? extras : undefined;
}
//# sourceMappingURL=BotStats.js.map