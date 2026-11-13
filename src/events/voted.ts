import { runCommands, TopGGEventHandler } from "../structures/TopGGEventHandlers"

export default new TopGGEventHandler({
    name: "voted",
    version: "1.0.0",
    description: "This event is fired once for each vote (or test vote) Top.gg delivers to your webhook",
    listener(vote) {
        runCommands(this, "voted", vote)
    },
})
