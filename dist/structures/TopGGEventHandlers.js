"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopGGEventHandler = void 0;
exports.runCommands = runCommands;
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("..");
class TopGGEventHandler extends forgescript_1.BaseEventHandler {
    register(client) {
        client.getExtension(__1.ReForgeTopGG, true).emitter.on(this.name, this.listener.bind(client));
    }
}
exports.TopGGEventHandler = TopGGEventHandler;
/** Runs every command of an event with `extras` as its data. */
function runCommands(client, name, extras) {
    const commands = client.getExtension(__1.ReForgeTopGG, true).commands.get(name);
    for (const command of commands) {
        forgescript_1.Interpreter.run({
            obj: {},
            client,
            command,
            data: command.compiled.code,
            extras,
        });
    }
}
//# sourceMappingURL=TopGGEventHandlers.js.map