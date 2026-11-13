"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const Vote_1 = require("../../structures/Vote");
exports.default = new forgescript_1.NativeFunction({
    name: "$voteGuildID",
    version: "1.0.0",
    description: "Returns the ID of the server that was voted for, in the voted event (empty for bot votes)",
    unwrap: false,
    output: forgescript_1.ArgType.Guild,
    execute(ctx) {
        return this.success((0, Vote_1.currentVote)(ctx.runtime.extras)?.guild);
    },
});
//# sourceMappingURL=voteGuildID.js.map