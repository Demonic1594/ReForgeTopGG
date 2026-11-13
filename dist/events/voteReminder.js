"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TopGGEventHandlers_1 = require("../structures/TopGGEventHandlers");
exports.default = new TopGGEventHandlers_1.TopGGEventHandler({
    name: "voteReminder",
    version: "2.0.0",
    description: "This event is fired when a user who voted can vote again (needs the reminders option); the vote functions describe their last vote",
    listener(vote) {
        (0, TopGGEventHandlers_1.runCommands)(this, "voteReminder", vote);
    },
});
//# sourceMappingURL=voteReminder.js.map