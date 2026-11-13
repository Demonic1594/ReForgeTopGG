import { BotStats } from "@top-gg/sdk"
import { BaseEventHandler, ForgeClient, Interpreter } from "@tryforge/forgescript"
import { ReForgeTopGG } from ".."
import { Vote } from "./Vote"

export interface ITopGGEvents {
    posted: [BotStats]
    error: [Error]
    voted: [Vote]
}

export class TopGGEventHandler<T extends keyof ITopGGEvents> extends BaseEventHandler<ITopGGEvents, T> {
    register(client: ForgeClient): void {
        client.getExtension(ReForgeTopGG, true).emitter.on(this.name, this.listener.bind(client) as any)
    }
}

/** Runs every command of an event with `extras` as its data. */
export function runCommands(client: ForgeClient, name: keyof ITopGGEvents, extras: unknown) {
    const commands = client.getExtension(ReForgeTopGG, true).commands.get(name)
    for (const command of commands) {
        Interpreter.run({
            obj: {},
            client,
            command,
            data: command.compiled.code,
            extras,
        })
    }
}
