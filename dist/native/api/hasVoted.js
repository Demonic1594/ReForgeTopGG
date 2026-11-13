"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
const Vote_1 = require("../../structures/Vote");
exports.default = new forgescript_1.NativeFunction({
    name: "$hasVoted",
    version: "1.0.0",
    description: "Asks Top.gg whether a user voted for the bot in the last 12 hours. Fails with an error when the request fails, so use $try for a fallback",
    brackets: true,
    unwrap: true,
    args: [
        {
            name: "user ID",
            description: "The user to check",
            rest: false,
            required: true,
            type: forgescript_1.ArgType.String,
        },
    ],
    output: forgescript_1.ArgType.Boolean,
    async execute(ctx, [user]) {
        if (!(0, Vote_1.isSnowflake)(user))
            return this.customError(`"${user}" is not a user ID`);
        const result = await ctx.getExtension(__1.ReForgeTopGG, true).api.request((api) => api.hasVoted(user));
        return result.ok ? this.success(result.value) : this.customError(result.error);
    },
});
//# sourceMappingURL=hasVoted.js.map