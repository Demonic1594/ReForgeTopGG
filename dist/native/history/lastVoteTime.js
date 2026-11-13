"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
const resolveUser_1 = require("../../structures/resolveUser");
exports.default = new forgescript_1.NativeFunction({
    name: "$lastVoteTime",
    version: "2.0.0",
    description: "Returns when the user last voted (ms timestamp) as recorded by the webhook, empty if no vote was recorded",
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "user ID",
            description: "The user (an ID or a mention), defaults to the voter in vote events and to the author elsewhere",
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
        return this.success(record?.lastVoteAt);
    },
});
//# sourceMappingURL=lastVoteTime.js.map