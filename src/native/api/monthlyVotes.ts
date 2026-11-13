import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."

export default new NativeFunction({
    name: "$monthlyVotes",
    version: "1.0.0",
    description: "Gets the votes of the bot this month from Top.gg. Fails with an error when the request fails, so use $try for a fallback",
    unwrap: false,
    output: ArgType.Number,
    async execute(ctx) {
        const id = ctx.client.user?.id
        if (!id) return this.customError("The bot is not logged in yet")
        const result = await ctx.getExtension(ReForgeTopGG, true).api.request((api) => api.getBot(id))
        if (!result.ok) return this.customError(result.error)
        const value = result.value?.monthlyPoints
        return typeof value === "number" ? this.success(value) : this.customError("Top.gg API returned no monthlyPoints")
    },
})
