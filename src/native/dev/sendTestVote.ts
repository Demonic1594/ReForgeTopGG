import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { ReForgeTopGG } from "../.."
import { resolveUser } from "../../structures/resolveUser"

export default new NativeFunction({
    name: "$sendTestVote",
    version: "2.0.0",
    description: "Sends a test vote to the bot's own running webhook, the way Top.gg does, and returns the HTTP status (204 when it was accepted). The voted event runs with $voteType test; nothing is stored",
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "user ID",
            description: "The voter (an ID or a mention), defaults to the author",
            rest: false,
            type: ArgType.String,
        },
        {
            name: "weekend",
            description: "Whether to mark the vote as a weekend vote (legacy webhooks only)",
            rest: false,
            type: ArgType.Boolean,
        },
        {
            name: "query",
            description: "Query string of the vote page, e.g. ref=abc (legacy webhooks only)",
            rest: false,
            type: ArgType.String,
        },
    ],
    output: ArgType.Number,
    async execute(ctx, [userID, weekend, query]) {
        const user = resolveUser(ctx, userID)
        if (!user.ok) return this.customError(user.error)
        try {
            return this.success(await ctx.getExtension(ReForgeTopGG, true).sendTestVote({ user: user.id, weekend: !!weekend, query: query ?? undefined }))
        } catch (err) {
            return this.customError(`Test vote failed: ${(err as Error).message}`)
        }
    },
})
