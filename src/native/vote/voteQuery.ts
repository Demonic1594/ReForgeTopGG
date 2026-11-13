import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { currentVote } from "../../structures/Vote"

export default new NativeFunction({
    name: "$voteQuery",
    version: "1.0.0",
    description: "Returns the query parameters of the vote page URL as JSON, or one parameter's value",
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "key",
            description: "The parameter to return, e.g. ref for ?ref=abc",
            rest: false,
            type: ArgType.String,
        },
    ],
    output: ArgType.Unknown,
    execute(ctx, [key]) {
        const vote = currentVote(ctx.runtime.extras)
        if (!vote) return this.success()
        if (key) return this.success(Object.hasOwn(vote.query, key) ? vote.query[key] : undefined)
        return this.successJSON(vote.query)
    },
})
