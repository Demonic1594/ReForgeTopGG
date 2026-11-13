import { createHash, timingSafeEqual } from "crypto"
import type { IncomingMessage, ServerResponse } from "http"
import { normalizeLegacyVote, Vote } from "./Vote"

/** Default largest request body accepted, in bytes. A vote is well under 1 KiB. */
export const DEFAULT_MAX_BODY_SIZE = 16 * 1024

export interface IVoteWebhookOptions {
    /** The legacy (v0) secret Top.gg sends in the `Authorization` header. */
    auth?: string
    /** Largest accepted body in bytes. */
    maxBodySize?: number
    /**
     * Called with every authenticated, valid vote. Throwing (or rejecting) makes
     * the webhook answer 500, so Top.gg delivers the vote again later.
     */
    onVote: (vote: Vote) => unknown
    /** Called for authenticated deliveries that could not be used. */
    onError?: (err: Error) => void
    /** Clock, for tests. */
    now?: () => number
}

export class WebhookRequestError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message)
    }
}

/**
 * Compares two secrets in constant time. Both sides are hashed first, so
 * neither the content nor the length of the expected secret leaks through the
 * time the comparison takes.
 */
export function safeEqual(received: string | undefined, expected: string): boolean {
    if (typeof received !== "string") return false
    const a = createHash("sha256").update(received).digest()
    const b = createHash("sha256").update(expected).digest()
    return timingSafeEqual(a, b)
}

/** Reads the request body, refusing anything larger than `limit` bytes. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers["content-length"])
        if (Number.isFinite(declared) && declared > limit) {
            req.resume()
            return reject(new WebhookRequestError(413, "Payload too large"))
        }
        const chunks: Buffer[] = []
        let size = 0
        let done = false
        req.on("data", (chunk: Buffer) => {
            if (done) return
            size += chunk.length
            if (size > limit) {
                done = true
                req.resume()
                return reject(new WebhookRequestError(413, "Payload too large"))
            }
            chunks.push(chunk)
        })
        req.on("end", () => {
            if (done) return
            done = true
            resolve(Buffer.concat(chunks))
        })
        req.on("error", (err) => {
            if (done) return
            done = true
            reject(new WebhookRequestError(400, err.message))
        })
    })
}

function send(res: ServerResponse, status: number, body?: object) {
    if (res.headersSent) return
    if (body) {
        const json = JSON.stringify(body)
        res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) })
        res.end(json)
    } else {
        res.writeHead(status)
        res.end()
    }
}

/**
 * Receives Top.gg vote webhooks. Usable as a plain `node:http` request
 * listener, or mounted on an existing express app (`app.post(path, listener)`).
 */
export class VoteWebhook {
    private readonly maxBodySize: number
    private readonly now: () => number

    constructor(private readonly options: IVoteWebhookOptions) {
        this.maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE
        this.now = options.now ?? Date.now
    }

    /** Node request listener. Answers every request itself. */
    public readonly listener = (req: IncomingMessage, res: ServerResponse) => {
        this.handle(req, res).catch((err) => {
            this.options.onError?.(err instanceof Error ? err : new Error(String(err)))
            send(res, 500, { error: "Internal error" })
        })
    }

    public async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (req.method !== "POST") {
            res.setHeader("allow", "POST")
            req.resume()
            return send(res, 405, { error: "Method not allowed" })
        }

        const auth = this.options.auth
        if (!auth || !safeEqual(header(req, "authorization"), auth)) {
            req.resume()
            return send(res, 401, { error: "Unauthorized" })
        }

        const type = header(req, "content-type")?.split(";")[0].trim().toLowerCase()
        if (type !== "application/json") {
            req.resume()
            return send(res, 415, { error: "Content-Type must be application/json" })
        }

        let body: unknown
        const parsed = (req as IncomingMessage & { body?: unknown }).body
        if (req.readableEnded && parsed && typeof parsed === "object") {
            // Mounted behind a body parser (e.g. express.json()) that already read it.
            body = parsed
        } else {
            let raw: Buffer
            try {
                raw = await readBody(req, this.maxBodySize)
            } catch (err) {
                const e = err as WebhookRequestError
                return send(res, e.status ?? 400, { error: e.message })
            }
            try {
                body = JSON.parse(raw.toString("utf8"))
            } catch {
                return send(res, 400, { error: "Invalid JSON" })
            }
        }

        let vote: Vote
        try {
            vote = normalizeLegacyVote(body, this.now())
        } catch (err) {
            const message = (err as Error).message
            this.options.onError?.(new Error(`Top.gg sent a vote that could not be used: ${message}`))
            // 4xx: Top.gg does not retry a delivery that can never succeed.
            return send(res, 400, { error: message })
        }

        try {
            await this.options.onVote(vote)
        } catch (err) {
            this.options.onError?.(err instanceof Error ? err : new Error(String(err)))
            // 5xx: Top.gg delivers the vote again later.
            return send(res, 500, { error: "Vote could not be processed" })
        }
        send(res, 204)
    }
}

function header(req: IncomingMessage, name: string): string | undefined {
    const value = req.headers[name]
    return Array.isArray(value) ? value[0] : value
}
