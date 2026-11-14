import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."
import { prefixed } from "../../structures/Logger"

export default new NativeFunction({
    name: "$totalVotes",
    version: "1.0.0",
    description: "Gets the total votes of the bot from Top.gg. Fails with an error when the request fails, so use $try for a fallback",
    unwrap: false,
    output: ArgType.Number,
    async execute(ctx) {
        const id = ctx.client.user?.id
        if (!id) return this.customError(prefixed("The bot is not logged in yet"))
        const result = await ctx.getExtension(ReForgeTopGG, true).api.getBot(id)
        if (!result.ok) return this.customError(result.error)
        const value = result.value?.points
        return typeof value === "number" ? this.success(value) : this.customError(prefixed("Top.gg API returned no points"))
    },
})
