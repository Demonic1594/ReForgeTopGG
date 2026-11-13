import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { currentVote } from "../../structures/Vote"

export default new NativeFunction({
    name: "$voteType",
    version: "1.0.0",
    description: "Returns the type of the vote, upvote for a real vote or test for the test button",
    unwrap: false,
    output: ArgType.String,
    execute(ctx) {
        return this.success(currentVote(ctx.runtime.extras)?.type)
    },
})
