import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."

export default new NativeFunction({
    name: "$isVoteWeekend",
    version: "2.0.0",
    description: "Asks Top.gg whether the weekend multiplier is active (votes count twice). Fails with an error when the request fails, so use $try for a fallback",
    unwrap: false,
    output: ArgType.Boolean,
    async execute(ctx) {
        const result = await ctx.getExtension(ReForgeTopGG, true).api.request((api) => api.isWeekend())
        return result.ok ? this.success(!!result.value) : this.customError(result.error)
    },
})
