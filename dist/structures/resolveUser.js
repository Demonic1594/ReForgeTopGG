"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUser = resolveUser;
const Vote_1 = require("./Vote");
const Logger_1 = require("./Logger");
/**
 * The user a history function is about: the argument when given, else the
 * voter in vote events, else the author.
 */
function resolveUser(ctx, arg) {
    if (arg && arg.trim()) {
        const id = (0, Vote_1.parseUserId)(arg);
        return id ? { ok: true, id } : { ok: false, error: (0, Logger_1.prefixed)(`"${arg}" is not a user ID or mention`) };
    }
    const id = (0, Vote_1.currentVote)(ctx.runtime.extras)?.user ?? ctx.user?.id;
    return id ? { ok: true, id } : { ok: false, error: (0, Logger_1.prefixed)("No user ID given and none in this context") };
}
//# sourceMappingURL=resolveUser.js.map