import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { currentVote } from "../../structures/Vote"

export default new NativeFunction({
    name: "$voteBotID",
    version: "1.0.0",
    description: "Returns the ID of the bot that was voted for, in the voted event (empty for server votes)",
    unwrap: false,
    output: ArgType.User,
    execute(ctx) {
        return this.success(currentVote(ctx.runtime.extras)?.bot)
    },
})
