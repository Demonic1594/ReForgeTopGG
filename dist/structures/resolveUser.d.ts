import type { Context } from "@tryforge/forgescript";
/**
 * The user a history function is about: the argument when given, else the
 * voter in vote events, else the author.
 */
export declare function resolveUser(ctx: Context, arg: string | null | undefined): {
    ok: true;
    id: string;
} | {
    ok: false;
    error: string;
};
//# sourceMappingURL=resolveUser.d.ts.map