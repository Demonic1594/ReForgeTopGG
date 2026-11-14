import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."
import { parseUserId } from "../../structures/Vote"
import { prefixed } from "../../structures/Logger"

export default new NativeFunction({
    name: "$hasVoted",
    version: "1.0.0",
    description: "Asks Top.gg whether a user voted for the bot in the last 12 hours. Fails with an error when the request fails, so use $try for a fallback",
    brackets: true,
    unwrap: true,
    args: [
        {
            name: "user ID",
            description: "The user to check: an ID or a mention",
            rest: false,
            required: true,
            type: ArgType.String,
        },
    ],
    output: ArgType.Boolean,
    async execute(ctx, [user]) {
        const id = parseUserId(user)
        if (!id) return this.customError(prefixed(`"${user}" is not a user ID or mention`))
        const result = await ctx.getExtension(ReForgeTopGG, true).api.hasVoted(id)
        return result.ok ? this.success(result.value) : this.customError(result.error)
    },
})
