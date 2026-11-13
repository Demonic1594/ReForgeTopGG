import { currentStats } from "../../structures/BotStats";
import { ArgType, NativeFunction } from "@tryforge/forgescript";

export default new NativeFunction({
    name: "$postedShardID",
    version: "1.0.0",
    description: "The main shard id that was posted",
    unwrap: false,
    output: ArgType.Number,
    execute(ctx) {
        return this.success(currentStats(ctx.runtime.extras)?.shardId)
    },
})