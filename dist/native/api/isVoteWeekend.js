"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
exports.default = new forgescript_1.NativeFunction({
    name: "$isVoteWeekend",
    version: "2.0.0",
    description: "Asks Top.gg whether the weekend multiplier is active (votes count twice). Fails with an error when the request fails, so use $try for a fallback",
    unwrap: false,
    output: forgescript_1.ArgType.Boolean,
    async execute(ctx) {
        const result = await ctx.getExtension(__1.ReForgeTopGG, true).api.request((api) => api.isWeekend());
        return result.ok ? this.success(!!result.value) : this.customError(result.error);
    },
});
//# sourceMappingURL=isVoteWeekend.js.map