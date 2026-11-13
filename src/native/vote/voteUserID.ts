import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { currentVote } from "../../structures/Vote"

export default new NativeFunction({
    name: "$voteUserID",
    version: "1.0.0",
    description: "Returns the ID of the user who voted, in the voted event",
    unwrap: false,
    output: ArgType.User,
    execute(ctx) {
        return this.success(currentVote(ctx.runtime.extras)?.user)
    },
})
