import { currentStats } from "../../structures/BotStats";
import { ArgType, NativeFunction } from "@tryforge/forgescript";

export default new NativeFunction({
    name: "$postedShardCount",
    version: "1.0.0",
    description: "The amount of shards that was posted",
    unwrap: false,
    output: ArgType.Number,
    execute(ctx) {
        return this.success(currentStats(ctx.runtime.extras)?.shardCount)
    },
})