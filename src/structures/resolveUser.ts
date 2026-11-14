import type { Context } from "@tryforge/forgescript"
import { currentVote, parseUserId } from "./Vote"
import { prefixed } from "./Logger"

/**
 * The user a history function is about: the argument when given, else the
 * voter in vote events, else the author.
 */
export function resolveUser(ctx: Context, arg: string | null | undefined): { ok: true; id: string } | { ok: false; error: string } {
    if (arg && arg.trim()) {
        const id = parseUserId(arg)
        return id ? { ok: true, id } : { ok: false, error: prefixed(`"${arg}" is not a user ID or mention`) }
    }
    const id = currentVote(ctx.runtime.extras)?.user ?? ctx.user?.id
    return id ? { ok: true, id } : { ok: false, error: prefixed("No user ID given and none in this context") }
}
