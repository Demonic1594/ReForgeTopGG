"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const Vote_1 = require("../../structures/Vote");
exports.default = new forgescript_1.NativeFunction({
    name: "$voteWeight",
    version: "2.0.0",
    description: "Returns how many votes the vote counts as, 2 during Top.gg's weekend multiplier, otherwise 1",
    unwrap: false,
    output: forgescript_1.ArgType.Number,
    execute(ctx) {
        return this.success((0, Vote_1.currentVote)(ctx.runtime.extras)?.weight);
    },
});
//# sourceMappingURL=voteWeight.js.map