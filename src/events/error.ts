import { runCommands, TopGGEventHandler } from "../structures/TopGGEventHandlers"

export default new TopGGEventHandler({
    name: "error",
    version: "1.0.0",
    description: "This event is fired when posting stats fails, the webhook cannot start, or Top.gg sends a vote that cannot be used",
    listener(err) {
        runCommands(this, "error", err)
    },
})
