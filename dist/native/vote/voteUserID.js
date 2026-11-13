"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const Vote_1 = require("../../structures/Vote");
exports.default = new forgescript_1.NativeFunction({
    name: "$voteUserID",
    version: "1.0.0",
    description: "Returns the ID of the user who voted, in the voted event",
    unwrap: false,
    output: forgescript_1.ArgType.User,
    execute(ctx) {
        return this.success((0, Vote_1.currentVote)(ctx.runtime.extras)?.user);
    },
});
//# sourceMappingURL=voteUserID.js.map