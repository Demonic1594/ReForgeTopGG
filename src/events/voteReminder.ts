import { runCommands, TopGGEventHandler } from "../structures/TopGGEventHandlers"

export default new TopGGEventHandler({
    name: "voteReminder",
    version: "2.0.0",
    description: "This event is fired when a user who voted can vote again (needs the reminders option); the vote functions describe their last vote",
    listener(vote) {
        runCommands(this, "voteReminder", vote)
    },
})
