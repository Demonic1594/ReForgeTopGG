"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const Vote_1 = require("../../structures/Vote");
exports.default = new forgescript_1.NativeFunction({
    name: "$voteQuery",
    version: "1.0.0",
    description: "Returns the query parameters of the vote page URL as JSON, or one parameter's value",
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "key",
            description: "The parameter to return, e.g. ref for ?ref=abc",
            rest: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    output: forgescript_1.ArgType.Unknown,
    execute(ctx, [key]) {
        const vote = (0, Vote_1.currentVote)(ctx.runtime.extras);
        if (!vote)
            return this.success();
        if (key)
            return this.success(Object.hasOwn(vote.query, key) ? vote.query[key] : undefined);
        return this.successJSON(vote.query);
    },
});
//# sourceMappingURL=voteQuery.js.map