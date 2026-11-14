"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReForgeTopGGLogger = exports.LOG_LEVELS = exports.LOG_PREFIX = void 0;
exports.isLogLevel = isLogLevel;
exports.prefixed = prefixed;
exports.errorMessage = errorMessage;
const forgescript_1 = require("@tryforge/forgescript");
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };
exports.LOG_PREFIX = "[ReForgeTopGG]";
exports.LOG_LEVELS = Object.keys(LEVELS);
function isLogLevel(value) {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEVELS, value);
}
/** A message with the extension's prefix, for errors meant for the bot developer. */
function prefixed(message) {
    return message.startsWith(`${exports.LOG_PREFIX} `) ? message : `${exports.LOG_PREFIX} ${message}`;
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
class ReForgeTopGGLogger {
    static level = isLogLevel(process.env.REFORGETOPGG_LOG_LEVEL) ? process.env.REFORGETOPGG_LOG_LEVEL : "info";
    static enabled(level) {
        return level !== "silent" && LEVELS[this.level] >= LEVELS[level];
    }
    static write(level, type, message) {
        if (!this.enabled(level))
            return;
        try {
            // Logger.log is private in ForgeScript's typings but public at run
            // time. LogPriority.None is always printed: the level gate is ours.
            const raw = forgescript_1.Logger;
            const text = prefixed(message);
            if (typeof raw.log === "function")
                raw.log(forgescript_1.LogPriority.None, type, text);
            else if (type === forgescript_1.LogType.Error)
                forgescript_1.Logger.error(text);
            else if (type === forgescript_1.LogType.Warn)
                forgescript_1.Logger.warn(text);
            else
                forgescript_1.Logger.info(text);
        }
        catch {
            // Logging never breaks a vote.
        }
    }
    static error(message) {
        this.write("error", forgescript_1.LogType.Error, message);
    }
    static warn(message) {
        this.write("warn", forgescript_1.LogType.Warn, message);
    }
    static info(message) {
        this.write("info", forgescript_1.LogType.Info, message);
    }
    static debug(message) {
        this.write("debug", forgescript_1.LogType.Debug, message);
    }
    static trace(message) {
        this.write("trace", forgescript_1.LogType.Debug, message);
    }
}
exports.ReForgeTopGGLogger = ReForgeTopGGLogger;
/** The message of any thrown value, without a stack. */
function errorMessage(err) {
    if (err instanceof Error)
        return err.message || err.name;
    if (typeof err === "string")
        return err;
    try {
        return JSON.stringify(err);
    }
    catch {
        return String(err);
    }
}
//# sourceMappingURL=Logger.js.map