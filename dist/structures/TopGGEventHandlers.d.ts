import { BotStats } from "@top-gg/sdk";
import { BaseEventHandler, ForgeClient } from "@tryforge/forgescript";
import { Vote } from "./Vote";
export interface ITopGGEvents {
    posted: [BotStats];
    error: [Error];
    voted: [Vote];
    voteReminder: [Vote];
}
export declare class TopGGEventHandler<T extends keyof ITopGGEvents> extends BaseEventHandler<ITopGGEvents, T> {
    register(client: ForgeClient): void;
}
/** Runs every command of an event with `extras` as its data. */
export declare function runCommands(client: ForgeClient, name: keyof ITopGGEvents, extras: unknown): void;
//# sourceMappingURL=TopGGEventHandlers.d.ts.map