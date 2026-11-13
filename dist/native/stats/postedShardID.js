"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BotStats_1 = require("../../structures/BotStats");
const forgescript_1 = require("@tryforge/forgescript");
exports.default = new forgescript_1.NativeFunction({
    name: "$postedShardID",
    version: "1.0.0",
    description: "The main shard id that was posted",
    unwrap: false,
    output: forgescript_1.ArgType.Number,
    execute(ctx) {
        return this.success((0, BotStats_1.currentStats)(ctx.runtime.extras)?.shardId);
    },
});
//# sourceMappingURL=postedShardID.js.map