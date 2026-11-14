import { ReForgeTopGGLogger as log } from "./Logger"

export const SWITCH_GUIDE = "https://github.com/Demonic1594/ReForgeDB#switching-from-forgedb"

/**
 * Shared by every ReForge extension in the process (the same symbol in each):
 * the reminder to switch from ForgeDB to ReForgeDB is shown once, however many
 * of them notice ForgeDB.
 */
const REMINDED = Symbol.for("reforge.forgeDBReminder")

/** Shows the reminder to switch to ReForgeDB once per process. Returns whether it was shown now. */
export function remindToSwitch(): boolean {
    const store = globalThis as unknown as Record<symbol, boolean>
    if (store[REMINDED]) return false
    store[REMINDED] = true
    log.info(
        "This bot uses ForgeDB (forge.db). Consider switching to ReForgeDB (reforge.db): it keeps using your existing data as it is, " +
            `and with other ReForge extensions it means fewer complications, better compatibility and a better experience. How to switch: ${SWITCH_GUIDE}`
    )
    return true
}
