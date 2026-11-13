import { currentStats } from "../../structures/BotStats";
import { ArgType, NativeFunction } from "@tryforge/forgescript";

export default new NativeFunction({
    name: "$postedServerCount",
    version: "1.0.0",
    description: "The server count that was posted",
    unwrap: false,
    output: ArgType.Number,
    execute(ctx) {
        return this.success(currentStats(ctx.runtime.extras)?.serverCount)
    },
})