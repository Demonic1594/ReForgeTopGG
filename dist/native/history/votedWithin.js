"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
const resolveUser_1 = require("../../structures/resolveUser");
exports.default = new forgescript_1.NativeFunction({
    name: "$votedWithin",
    version: "2.0.0",
    description: "Returns whether the webhook recorded a vote of the user within the given time, without asking Top.gg",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "duration",
            description: "How far back to look, e.g. 12h or 1d",
            rest: false,
            required: true,
            type: forgescript_1.ArgType.Time,
        },
        {
            name: "user ID",
            description: "The user, defaults to the voter in vote events and to the author elsewhere",
            rest: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    output: forgescript_1.ArgType.Boolean,
    async execute(ctx, [duration, userID]) {
        const user = (0, resolveUser_1.resolveUser)(ctx, userID);
        if (!user.ok)
            return this.customError(user.error);
        const record = await ctx.getExtension(__1.ReForgeTopGG, true).getRecord(user.id);
        return this.success(!!record && record.lastVoteAt >= Date.now() - duration);
    },
});
//# sourceMappingURL=votedWithin.js.map