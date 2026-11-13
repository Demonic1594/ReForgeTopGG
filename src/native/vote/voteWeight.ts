import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { currentVote } from "../../structures/Vote"

export default new NativeFunction({
    name: "$voteWeight",
    version: "2.0.0",
    description: "Returns how many votes the vote counts as, 2 during Top.gg's weekend multiplier, otherwise 1",
    unwrap: false,
    output: ArgType.Number,
    execute(ctx) {
        return this.success(currentVote(ctx.runtime.extras)?.weight)
    },
})
