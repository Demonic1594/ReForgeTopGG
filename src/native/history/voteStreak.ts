import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."
import { resolveUser } from "../../structures/resolveUser"
import { currentStreak } from "../../structures/VoteStore"

export default new NativeFunction({
    name: "$voteStreak",
    version: "2.0.0",
    description: "Returns how many times in a row the user voted, each vote at most streakGrace (12 hours by default) after they could vote again; 0 once the streak is broken",
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "user ID",
            description: "The user (an ID or a mention), defaults to the voter in vote events and to the author elsewhere",
            rest: false,
            type: ArgType.String,
        },
    ],
    output: ArgType.Number,
    async execute(ctx, [userID]) {
        const user = resolveUser(ctx, userID)
        if (!user.ok) return this.customError(user.error)
        const ext = ctx.getExtension(ReForgeTopGG, true)
        const record = await ext.getRecord(user.id)
        return this.success(currentStreak(record, Date.now(), ext.streakGrace))
    },
})
