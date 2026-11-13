import { ArgType, NativeFunction } from "@tryforge/forgescript"

export default new NativeFunction({
    name: "$postStatsError",
    version: "1.0.0",
    description: "Returns the error message, in the error event",
    unwrap: false,
    output: ArgType.String,
    execute(ctx) {
        const err = ctx.runtime.extras
        return this.success(err instanceof Error ? err.message : undefined)
    },
})
