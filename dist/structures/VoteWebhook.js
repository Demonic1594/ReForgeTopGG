"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoteWebhook = exports.WebhookRequestError = exports.SIGNATURE_TOLERANCE = exports.DEFAULT_MAX_BODY_SIZE = void 0;
exports.safeEqual = safeEqual;
exports.checkSignature = checkSignature;
exports.signBody = signBody;
exports.readBody = readBody;
const crypto_1 = require("crypto");
const Vote_1 = require("./Vote");
/** Default largest request body accepted, in bytes. A vote is well under 1 KiB. */
exports.DEFAULT_MAX_BODY_SIZE = 16 * 1024;
/** Signed deliveries older or newer than this are refused (Top.gg's docs: 5 minutes). */
exports.SIGNATURE_TOLERANCE = 5 * 60 * 1000;
class WebhookRequestError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.WebhookRequestError = WebhookRequestError;
/**
 * Compares two secrets in constant time. Both sides are hashed first, so
 * neither the content nor the length of the expected secret leaks through the
 * time the comparison takes.
 */
function safeEqual(received, expected) {
    if (typeof received !== "string")
        return false;
    const a = (0, crypto_1.createHash)("sha256").update(received).digest();
    const b = (0, crypto_1.createHash)("sha256").update(expected).digest();
    return (0, crypto_1.timingSafeEqual)(a, b);
}
/**
 * Checks a v1 `x-topgg-signature` header (`t=<unix seconds>,v1=<hex>`):
 * an HMAC SHA-256 of `<t>.<raw body>` keyed with the secret, compared in
 * constant time, and a timestamp within {@link SIGNATURE_TOLERANCE}.
 * Returns the reason it fails, or `null` when it is valid.
 */
function checkSignature(headerValue, raw, secret, now) {
    const parts = {};
    for (const part of headerValue.split(",")) {
        const i = part.indexOf("=");
        if (i > 0)
            parts[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    const t = Number(parts.t);
    const sig = parts.v1;
    if (!Number.isInteger(t) || !sig || !/^[0-9a-f]+$/i.test(sig))
        return "Invalid signature format";
    if (Math.abs(now - t * 1000) > exports.SIGNATURE_TOLERANCE)
        return "Signature timestamp outside the accepted window";
    const expected = (0, crypto_1.createHmac)("sha256", secret).update(`${parts.t}.`).update(raw).digest();
    const given = Buffer.from(sig, "hex");
    if (given.length !== expected.length || !(0, crypto_1.timingSafeEqual)(given, expected))
        return "Invalid signature";
    return null;
}
/** Signs a body the way Top.gg does, for tests and local development. */
function signBody(raw, secret, now = Date.now()) {
    const t = Math.floor(now / 1000);
    const sig = (0, crypto_1.createHmac)("sha256", secret).update(`${t}.`).update(raw).digest("hex");
    return `t=${t},v1=${sig}`;
}
/** Reads the request body, refusing anything larger than `limit` bytes. */
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > limit) {
            req.resume();
            return reject(new WebhookRequestError(413, "Payload too large"));
        }
        const chunks = [];
        let size = 0;
        let done = false;
        req.on("data", (chunk) => {
            if (done)
                return;
            size += chunk.length;
            if (size > limit) {
                done = true;
                req.resume();
                return reject(new WebhookRequestError(413, "Payload too large"));
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (done)
                return;
            done = true;
            resolve(Buffer.concat(chunks));
        });
        req.on("error", (err) => {
            if (done)
                return;
            done = true;
            reject(new WebhookRequestError(400, err.message));
        });
    });
}
function send(res, status, body) {
    if (res.headersSent)
        return;
    if (body) {
        const json = JSON.stringify(body);
        res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
        res.end(json);
    }
    else {
        res.writeHead(status);
        res.end();
    }
}
/**
 * Receives Top.gg vote webhooks. Usable as a plain `node:http` request
 * listener, or mounted on an existing express app (`app.post(path, listener)`).
 */
class VoteWebhook {
    options;
    maxBodySize;
    now;
    constructor(options) {
        this.options = options;
        this.maxBodySize = options.maxBodySize ?? exports.DEFAULT_MAX_BODY_SIZE;
        this.now = options.now ?? Date.now;
    }
    /** Node request listener. Answers every request itself. */
    listener = (req, res) => {
        this.handle(req, res).catch((err) => {
            this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
            send(res, 500, { error: "Internal error" });
        });
    };
    async handle(req, res) {
        if (req.method !== "POST") {
            res.setHeader("allow", "POST");
            req.resume();
            return send(res, 405, { error: "Method not allowed" });
        }
        const signature = header(req, "x-topgg-signature");
        const signed = signature !== undefined;
        if (signed ? !this.options.secret : !this.options.auth || !safeEqual(header(req, "authorization"), this.options.auth)) {
            req.resume();
            return send(res, 401, { error: "Unauthorized" });
        }
        const type = header(req, "content-type")?.split(";")[0].trim().toLowerCase();
        if (type !== "application/json") {
            req.resume();
            return send(res, 415, { error: "Content-Type must be application/json" });
        }
        let body;
        const parsed = req.body;
        if (req.readableEnded && parsed && typeof parsed === "object") {
            if (signed) {
                this.options.onError?.(new Error("A signed Top.gg delivery reached the webhook after a body parser read it, so its signature cannot be checked. Mount the webhook listener before express.json()."));
                return send(res, 500, { error: "Body already consumed" });
            }
            // Mounted behind a body parser (e.g. express.json()) that already read it.
            body = parsed;
        }
        else {
            let raw;
            try {
                raw = await readBody(req, this.maxBodySize);
            }
            catch (err) {
                const e = err;
                return send(res, e.status ?? 400, { error: e.message });
            }
            if (signed) {
                const failure = checkSignature(signature, raw, this.options.secret, this.now());
                if (failure)
                    return send(res, 401, { error: failure });
            }
            try {
                body = JSON.parse(raw.toString("utf8"));
            }
            catch {
                return send(res, 400, { error: "Invalid JSON" });
            }
        }
        let vote;
        try {
            vote = signed ? (0, Vote_1.normalizeSignedVote)(body, this.now()) : (0, Vote_1.normalizeLegacyVote)(body, this.now());
        }
        catch (err) {
            const message = err.message;
            this.options.onError?.(new Error(`Top.gg sent a vote that could not be used: ${message}`));
            // 4xx: Top.gg does not retry a delivery that can never succeed.
            return send(res, 400, { error: message });
        }
        // Signed event types other than votes are acknowledged and ignored.
        if (!vote)
            return send(res, 204);
        try {
            await this.options.onVote(vote);
        }
        catch (err) {
            this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
            // 5xx: Top.gg delivers the vote again later.
            return send(res, 500, { error: "Vote could not be processed" });
        }
        send(res, 204);
    }
}
exports.VoteWebhook = VoteWebhook;
function header(req, name) {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
}
//# sourceMappingURL=VoteWebhook.js.map