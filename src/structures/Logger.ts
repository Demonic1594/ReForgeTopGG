import { Logger, LogPriority, LogType } from "@tryforge/forgescript"

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
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace"

const LEVELS: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 }
export const LOG_PREFIX = "[ReForgeTopGG]"
export const LOG_LEVELS = Object.keys(LEVELS) as LogLevel[]

export function isLogLevel(value: unknown): value is LogLevel {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEVELS, value)
}

/** A message with the extension's prefix, for errors meant for the bot developer. */
export function prefixed(message: string): string {
    return message.startsWith(`${LOG_PREFIX} `) ? message : `${LOG_PREFIX} ${message}`
}

/**
 * ReForgeTopGG's logger. Writes through ForgeScript's `Logger`, so output looks
 * like the rest of the bot, with its own level: `debug` and `trace` lines are
 * shown when ReForgeTopGG's level allows them, whatever ForgeScript's own
 * priority is.
 *
 * The level comes from the `logLevel` option, or the `REFORGETOPGG_LOG_LEVEL`
 * environment variable when the option is not set.
 */
export class ReForgeTopGGLogger {
    static level: LogLevel = isLogLevel(process.env.REFORGETOPGG_LOG_LEVEL) ? process.env.REFORGETOPGG_LOG_LEVEL : "info"

    static enabled(level: LogLevel) {
        return level !== "silent" && LEVELS[this.level] >= LEVELS[level]
    }

    private static write(level: LogLevel, type: LogType, message: string) {
        if (!this.enabled(level)) return
        try {
            // Logger.log is private in ForgeScript's typings but public at run
            // time. LogPriority.None is always printed: the level gate is ours.
            const raw = Logger as unknown as { log?: (priority: LogPriority, type: LogType, ...a: unknown[]) => void }
            const text = prefixed(message)
            if (typeof raw.log === "function") raw.log(LogPriority.None, type, text)
            else if (type === LogType.Error) Logger.error(text)
            else if (type === LogType.Warn) Logger.warn(text)
            else Logger.info(text)
        } catch {
            // Logging never breaks a vote.
        }
    }

    static error(message: string) {
        this.write("error", LogType.Error, message)
    }

    static warn(message: string) {
        this.write("warn", LogType.Warn, message)
    }

    static info(message: string) {
        this.write("info", LogType.Info, message)
    }

    static debug(message: string) {
        this.write("debug", LogType.Debug, message)
    }

    static trace(message: string) {
        this.write("trace", LogType.Debug, message)
    }
}

/** The message of any thrown value, without a stack. */
export function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message || err.name
    if (typeof err === "string") return err
    try {
        return JSON.stringify(err)
    } catch {
        return String(err)
    }
}
