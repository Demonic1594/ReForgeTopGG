import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."
import { resolveUser } from "../../structures/resolveUser"

export default new NativeFunction({
    name: "$votePoints",
    version: "2.0.0",
    description: "Returns the recorded votes of the user with weekend votes counted twice",
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
        return this.success(record?.points ?? 0)
    },
})
