import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { currentVote } from "../../structures/Vote"

export default new NativeFunction({
    name: "$voteTimestamp",
    version: "2.0.0",
    description: "Returns when the vote was cast (ms timestamp)",
    unwrap: false,
    output: ArgType.Number,
    execute(ctx) {
        return this.success(currentVote(ctx.runtime.extras)?.votedAt)
    },
})
