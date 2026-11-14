"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
const resolveUser_1 = require("../../structures/resolveUser");
const Logger_1 = require("../../structures/Logger");
exports.default = new forgescript_1.NativeFunction({
    name: "$sendTestVote",
    version: "2.0.0",
    description: "Sends a test vote to the bot's own running webhook, the way Top.gg does, and returns the HTTP status (204 when it was accepted). The voted event runs with $voteType test; nothing is stored",
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "user ID",
            description: "The voter (an ID or a mention), defaults to the author",
            rest: false,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "weekend",
            description: "Whether to mark the vote as a weekend vote (legacy webhooks only)",
            rest: false,
            type: forgescript_1.ArgType.Boolean,
        },
        {
            name: "query",
            description: "Query string of the vote page, e.g. ref=abc (legacy webhooks only)",
            rest: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    output: forgescript_1.ArgType.Number,
    async execute(ctx, [userID, weekend, query]) {
        const user = (0, resolveUser_1.resolveUser)(ctx, userID);
        if (!user.ok)
            return this.customError(user.error);
        try {
            return this.success(await ctx.getExtension(__1.ReForgeTopGG, true).sendTestVote({ user: user.id, weekend: !!weekend, query: query ?? undefined }));
        }
        catch (err) {
            return this.customError((0, Logger_1.prefixed)(`Test vote failed: ${err.message.replace(/^\[ReForgeTopGG\] /, "")}`));
        }
    },
});
//# sourceMappingURL=sendTestVote.js.map