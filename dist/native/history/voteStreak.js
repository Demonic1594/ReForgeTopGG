"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
const resolveUser_1 = require("../../structures/resolveUser");
const VoteStore_1 = require("../../structures/VoteStore");
exports.default = new forgescript_1.NativeFunction({
    name: "$voteStreak",
    version: "2.0.0",
    description: "Returns how many times in a row the user voted, each vote at most streakGrace (12 hours by default) after they could vote again; 0 once the streak is broken",
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "user ID",
            description: "The user, defaults to the voter in vote events and to the author elsewhere",
            rest: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    output: forgescript_1.ArgType.Number,
    async execute(ctx, [userID]) {
        const user = (0, resolveUser_1.resolveUser)(ctx, userID);
        if (!user.ok)
            return this.customError(user.error);
        const ext = ctx.getExtension(__1.ReForgeTopGG, true);
        const record = await ext.getRecord(user.id);
        return this.success((0, VoteStore_1.currentStreak)(record, Date.now(), ext.streakGrace));
    },
});
//# sourceMappingURL=voteStreak.js.map