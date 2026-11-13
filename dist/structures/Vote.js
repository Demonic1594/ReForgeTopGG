"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoteType = exports.VOTE_COOLDOWN = void 0;
exports.isSnowflake = isSnowflake;
exports.parseUserId = parseUserId;
exports.parseQuery = parseQuery;
exports.normalizeLegacyVote = normalizeLegacyVote;
exports.normalizeSignedVote = normalizeSignedVote;
exports.voteTarget = voteTarget;
exports.currentVote = currentVote;
/**
 * How long a Top.gg vote lasts before the user can vote again. The legacy
 * payload has no expiry, so it is derived from this: the SDK documents
 * `hasVoted` as "voted in the last 12 hours", and v1 payloads carry
 * `created_at` and `expires_at` 12 hours apart.
 */
exports.VOTE_COOLDOWN = 12 * 60 * 60 * 1000;
/** The kinds of vote $voteType returns. */
var VoteType;
(function (VoteType) {
    /** A real vote. */
    VoteType["upvote"] = "upvote";
    /** Sent by the test button on Top.gg or $sendTestVote. */
    VoteType["test"] = "test";
})(VoteType || (exports.VoteType = VoteType = {}));
const SNOWFLAKE = /^\d{15,22}$/;
function isSnowflake(value) {
    return typeof value === "string" && SNOWFLAKE.test(value);
}
/** A user ID as people write it in commands: `123...`, ` 123... `, `<@123...>` or `<@!123...>`. */
function parseUserId(raw) {
    const id = raw.trim().replace(/^<@!?(\d+)>$/, "$1");
    return isSnowflake(id) ? id : null;
}
function parseQuery(raw) {
    if (raw === undefined || raw === null || raw === "")
        return {};
    if (typeof raw === "string")
        return Object.fromEntries(new URLSearchParams(raw));
    if (typeof raw === "object" && !Array.isArray(raw)) {
        // fromEntries defines own properties, so a "__proto__" key stays a plain key
        return Object.fromEntries(Object.entries(raw).filter((e) => typeof e[1] === "string"));
    }
    throw new Error("query must be a string");
}
/**
 * Validates a legacy (v0) webhook body and turns it into a {@link Vote}.
 * Throws with a short reason when the body is not a usable vote.
 */
function normalizeLegacyVote(body, now) {
    if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("body must be a JSON object");
    const b = body;
    if (!isSnowflake(b.user))
        throw new Error("user must be a Discord ID");
    if (b.bot !== undefined && !isSnowflake(b.bot))
        throw new Error("bot must be a Discord ID");
    if (b.guild !== undefined && !isSnowflake(b.guild))
        throw new Error("guild must be a Discord ID");
    if (b.bot === undefined && b.guild === undefined)
        throw new Error("bot or guild is required");
    if (b.type !== "upvote" && b.type !== "test")
        throw new Error("type must be upvote or test");
    if (b.isWeekend !== undefined && typeof b.isWeekend !== "boolean")
        throw new Error("isWeekend must be a boolean");
    const isWeekend = b.isWeekend === true;
    return {
        user: b.user,
        bot: b.bot,
        guild: b.guild,
        type: b.type,
        isWeekend,
        weight: isWeekend ? 2 : 1,
        query: parseQuery(b.query),
        votedAt: now,
        expiresAt: now + exports.VOTE_COOLDOWN,
        source: "v0",
    };
}
/**
 * Validates a signed (v1) webhook body and turns it into a {@link Vote}.
 * Returns `null` for event types that are not votes (they are acknowledged
 * and ignored). Throws with a short reason when the body is not usable.
 */
function normalizeSignedVote(body, now) {
    if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("body must be a JSON object");
    const b = body;
    if (b.type !== "vote.create" && b.type !== "webhook.test")
        return null;
    const d = b.data;
    if (!d || typeof d !== "object")
        throw new Error("data is missing");
    const user = d.user?.platform_id;
    if (!isSnowflake(user))
        throw new Error("data.user.platform_id must be a Discord ID");
    const project = d.project;
    const target = project?.platform_id;
    if (!isSnowflake(target))
        throw new Error("data.project.platform_id must be a Discord ID");
    if (project.type !== "bot" && project.type !== "server")
        throw new Error("data.project.type must be bot or server");
    const isVote = b.type === "vote.create";
    let votedAt = now;
    let expiresAt = now + exports.VOTE_COOLDOWN;
    let weight = 1;
    if (isVote) {
        if (typeof d.id !== "string" || d.id === "")
            throw new Error("data.id is missing");
        votedAt = Date.parse(d.created_at);
        expiresAt = Date.parse(d.expires_at);
        if (!Number.isFinite(votedAt) || !Number.isFinite(expiresAt))
            throw new Error("data.created_at and data.expires_at must be dates");
        weight = d.weight;
        if (!Number.isInteger(weight) || weight < 1)
            throw new Error("data.weight must be a positive whole number");
    }
    return {
        user,
        ...(project.type === "server" ? { guild: target } : { bot: target }),
        type: isVote ? "upvote" : "test",
        isWeekend: weight > 1,
        weight,
        query: isVote ? parseQuery(d.query) : {},
        votedAt,
        expiresAt,
        ...(isVote ? { id: d.id } : {}),
        source: "v1",
    };
}
/** The ID of what was voted for: the bot or the server. */
function voteTarget(vote) {
    return (vote.bot ?? vote.guild);
}
/** The vote an event is running for, or `undefined` outside vote events. */
function currentVote(extras) {
    if (!extras || typeof extras !== "object")
        return undefined;
    const v = extras;
    return (v.source === "v0" || v.source === "v1") && typeof v.user === "string" ? v : undefined;
}
//# sourceMappingURL=Vote.js.map