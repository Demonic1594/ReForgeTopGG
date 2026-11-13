"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TopGGEventHandlers_1 = require("../structures/TopGGEventHandlers");
exports.default = new TopGGEventHandlers_1.TopGGEventHandler({
    name: "posted",
    version: "1.0.0",
    description: "This event is fired when your bot's stats were posted to Top.gg",
    listener(stats) {
        (0, TopGGEventHandlers_1.runCommands)(this, "posted", stats);
    },
});
//# sourceMappingURL=posted.js.map