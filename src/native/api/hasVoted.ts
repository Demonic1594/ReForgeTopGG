import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."
import { isSnowflake } from "../../structures/Vote"

export default new NativeFunction({
    name: "$hasVoted",
    version: "1.0.0",
    description: "Asks Top.gg whether a user voted for the bot in the last 12 hours. Fails with an error when the request fails, so use $try for a fallback",
    brackets: true,
    unwrap: true,
    args: [
        {
            name: "user ID",
            description: "The user to check",
            rest: false,
            required: true,
            type: ArgType.String,
        },
    ],
    output: ArgType.Boolean,
    async execute(ctx, [user]) {
        if (!isSnowflake(user)) return this.customError(`"${user}" is not a user ID`)
        const result = await ctx.getExtension(ReForgeTopGG, true).api.request((api) => api.hasVoted(user))
        return result.ok ? this.success(result.value) : this.customError(result.error)
    },
})
