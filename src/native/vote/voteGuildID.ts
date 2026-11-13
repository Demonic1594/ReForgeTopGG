import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { currentVote } from "../../structures/Vote"

export default new NativeFunction({
    name: "$voteGuildID",
    version: "1.0.0",
    description: "Returns the ID of the server that was voted for, in the voted event (empty for bot votes)",
    unwrap: false,
    output: ArgType.Guild,
    execute(ctx) {
        return this.success(currentVote(ctx.runtime.extras)?.guild)
    },
})
