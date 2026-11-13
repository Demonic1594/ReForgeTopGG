import type { Context } from "@tryforge/forgescript"
import { currentVote, isSnowflake } from "./Vote"

/**
 * The user a history function is about: the argument when given, else the
 * voter in vote events, else the author.
 */
export function resolveUser(ctx: Context, arg: string | null | undefined): { ok: true; id: string } | { ok: false; error: string } {
    if (arg) return isSnowflake(arg) ? { ok: true, id: arg } : { ok: false, error: `"${arg}" is not a user ID` }
    const id = currentVote(ctx.runtime.extras)?.user ?? ctx.user?.id
    return id ? { ok: true, id } : { ok: false, error: "No user ID given and none in this context" }
}
