"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const Vote_1 = require("../../structures/Vote");
exports.default = new forgescript_1.NativeFunction({
    name: "$voteIsWeekend",
    version: "1.0.0",
    description: "Returns whether the weekend multiplier was active for the vote (it counts twice)",
    unwrap: false,
    output: forgescript_1.ArgType.Boolean,
    execute(ctx) {
        return this.success((0, Vote_1.currentVote)(ctx.runtime.extras)?.isWeekend);
    },
});
//# sourceMappingURL=voteIsWeekend.js.map