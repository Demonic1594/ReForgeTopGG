"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("../..");
const Logger_1 = require("../../structures/Logger");
exports.default = new forgescript_1.NativeFunction({
    name: "$totalVotes",
    version: "1.0.0",
    description: "Gets the total votes of the bot from Top.gg. Fails with an error when the request fails, so use $try for a fallback",
    unwrap: false,
    output: forgescript_1.ArgType.Number,
    async execute(ctx) {
        const id = ctx.client.user?.id;
        if (!id)
            return this.customError((0, Logger_1.prefixed)("The bot is not logged in yet"));
        const result = await ctx.getExtension(__1.ReForgeTopGG, true).api.getBot(id);
        if (!result.ok)
            return this.customError(result.error);
        const value = result.value?.points;
        return typeof value === "number" ? this.success(value) : this.customError((0, Logger_1.prefixed)("Top.gg API returned no points"));
    },
});
//# sourceMappingURL=totalVotes.js.map