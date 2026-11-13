"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const Vote_1 = require("../../structures/Vote");
exports.default = new forgescript_1.NativeFunction({
    name: "$voteType",
    version: "1.0.0",
    description: "Returns the type of the vote, upvote for a real vote or test for the test button",
    unwrap: false,
    output: Vote_1.VoteType,
    execute(ctx) {
        return this.success((0, Vote_1.currentVote)(ctx.runtime.extras)?.type);
    },
});
//# sourceMappingURL=voteType.js.map