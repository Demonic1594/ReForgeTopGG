"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TopGGEventHandlers_1 = require("../structures/TopGGEventHandlers");
exports.default = new TopGGEventHandlers_1.TopGGEventHandler({
    name: "error",
    version: "1.0.0",
    description: "This event is fired when posting stats fails, the webhook cannot start, or Top.gg sends a vote that cannot be used",
    listener(err) {
        (0, TopGGEventHandlers_1.runCommands)(this, "error", err);
    },
});
//# sourceMappingURL=error.js.map