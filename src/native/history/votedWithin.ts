import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."
import { resolveUser } from "../../structures/resolveUser"

export default new NativeFunction({
    name: "$votedWithin",
    version: "2.0.0",
    description: "Returns whether the webhook recorded a vote of the user within the given time, without asking Top.gg",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "duration",
            description: "How far back to look, e.g. 12h or 1d",
            rest: false,
            required: true,
            type: ArgType.Time,
        },
        {
            name: "user ID",
            description: "The user (an ID or a mention), defaults to the voter in vote events and to the author elsewhere",
            rest: false,
            type: ArgType.String,
        },
    ],
    output: ArgType.Boolean,
    async execute(ctx, [duration, userID]) {
        const user = resolveUser(ctx, userID)
        if (!user.ok) return this.customError(user.error)
        const record = await ctx.getExtension(ReForgeTopGG, true).getRecord(user.id)
        return this.success(!!record && record.lastVoteAt >= Date.now() - duration)
    },
})
