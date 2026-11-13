import { runCommands, TopGGEventHandler } from "../structures/TopGGEventHandlers"

export default new TopGGEventHandler({
    name: "posted",
    version: "1.0.0",
    description: "This event is fired when your bot's stats were posted to Top.gg",
    listener(stats) {
        runCommands(this, "posted", stats)
    },
})
