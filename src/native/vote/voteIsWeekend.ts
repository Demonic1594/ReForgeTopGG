import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { currentVote } from "../../structures/Vote"

export default new NativeFunction({
    name: "$voteIsWeekend",
    version: "1.0.0",
    description: "Returns whether the weekend multiplier was active for the vote (it counts twice)",
    unwrap: false,
    output: ArgType.Boolean,
    execute(ctx) {
        return this.success(currentVote(ctx.runtime.extras)?.isWeekend)
    },
})
