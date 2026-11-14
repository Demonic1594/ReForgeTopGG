/**
 * How much ReForgeTopGG writes to the console.
 *
 * - `silent`: nothing
 * - `error`: failures (a vote that could not be stored, a webhook that could not start)
 * - `warn`: also misconfiguration and refused webhook requests (counted, once a minute)
 * - `info` (default): also start-up messages
 * - `debug`: also every vote, reminder and Top.gg API request
 * - `trace`: also every webhook request with its answer
 *
 * Secrets (`auth`, `webhook.secret`, `token`), Authorization and signature
 * headers and request bodies are never written, at any level.
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";
export declare const LOG_PREFIX = "[ReForgeTopGG]";
export declare const LOG_LEVELS: LogLevel[];
export declare function isLogLevel(value: unknown): value is LogLevel;
/** A message with the extension's prefix, for errors meant for the bot developer. */
export declare function prefixed(message: string): string;
/**
 * ReForgeTopGG's logger. Writes through ForgeScript's `Logger`, so output looks
 * like the rest of the bot, with its own level: `debug` and `trace` lines are
 * shown when ReForgeTopGG's level allows them, whatever ForgeScript's own
 * priority is.
 *
 * The level comes from the `logLevel` option, or the `REFORGETOPGG_LOG_LEVEL`
 * environment variable when the option is not set.
 */
export declare class ReForgeTopGGLogger {
    static level: LogLevel;
    static enabled(level: LogLevel): boolean;
    private static write;
    static error(message: string): void;
    static warn(message: string): void;
    static info(message: string): void;
    static debug(message: string): void;
    static trace(message: string): void;
}
/** The message of any thrown value, without a stack. */
export declare function errorMessage(err: unknown): string;
//# sourceMappingURL=Logger.d.ts.map