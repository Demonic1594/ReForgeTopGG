"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TopGGEventHandlers_1 = require("../structures/TopGGEventHandlers");
exports.default = new TopGGEventHandlers_1.TopGGEventHandler({
    name: "voted",
    version: "1.0.0",
    description: "This event is fired once for each vote (or test vote) Top.gg delivers to your webhook",
    listener(vote) {
        (0, TopGGEventHandlers_1.runCommands)(this, "voted", vote);
    },
});
//# sourceMappingURL=voted.js.map