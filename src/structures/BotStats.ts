import type { BotStats } from "@top-gg/sdk"

/** The posted stats an event is running for, or `undefined` elsewhere. */
export function currentStats(extras: unknown): BotStats | undefined {
    if (!extras || typeof extras !== "object" || extras instanceof Error) return undefined
    return "serverCount" in extras ? (extras as BotStats) : undefined
}
