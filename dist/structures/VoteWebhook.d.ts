import type { IncomingMessage, ServerResponse } from "http";
import { Vote } from "./Vote";
/** Default largest request body accepted, in bytes. A vote is well under 1 KiB. */
export declare const DEFAULT_MAX_BODY_SIZE: number;
/** Signed deliveries older or newer than this are refused (Top.gg's docs: 5 minutes). */
export declare const SIGNATURE_TOLERANCE: number;
export interface IVoteWebhookOptions {
    /** The legacy (v0) secret Top.gg sends in the `Authorization` header. */
    auth?: string;
    /** The v1 webhook secret (`whs_...`) Top.gg signs deliveries with. */
    secret?: string;
    /** Largest accepted body in bytes. */
    maxBodySize?: number;
    /**
     * Called with every authenticated, valid vote. Throwing (or rejecting) makes
     * the webhook answer 500, so Top.gg delivers the vote again later.
     */
    onVote: (vote: Vote) => unknown;
    /** Called for authenticated deliveries that could not be used. */
    onError?: (err: Error) => void;
    /** Called for each request refused for a wrong or missing secret or signature. */
    onRefused?: (reason: string) => void;
    /** Clock, for tests. */
    now?: () => number;
}
export declare class WebhookRequestError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/**
 * Compares two secrets in constant time. Both sides are hashed first, so
 * neither the content nor the length of the expected secret leaks through the
 * time the comparison takes.
 */
export declare function safeEqual(received: string | undefined, expected: string): boolean;
/**
 * Checks a v1 `x-topgg-signature` header (`t=<unix seconds>,v1=<hex>`):
 * an HMAC SHA-256 of `<t>.<raw body>` keyed with the secret, compared in
 * constant time, and a timestamp within {@link SIGNATURE_TOLERANCE}.
 * Returns the reason it fails, or `null` when it is valid.
 */
export declare function checkSignature(headerValue: string, raw: Buffer, secret: string, now: number): string | null;
/** Signs a body the way Top.gg does, for tests and local development. */
export declare function signBody(raw: string | Buffer, secret: string, now?: number): string;
/** Reads the request body, refusing anything larger than `limit` bytes. */
export declare function readBody(req: IncomingMessage, limit: number): Promise<Buffer>;
/**
 * Receives Top.gg vote webhooks. Usable as a plain `node:http` request
 * listener, or mounted on an existing express app (`app.post(path, listener)`).
 */
export declare class VoteWebhook {
    private readonly options;
    private readonly maxBodySize;
    private readonly now;
    constructor(options: IVoteWebhookOptions);
    /** Node request listener. Answers every request itself. */
    readonly listener: (req: IncomingMessage, res: ServerResponse) => void;
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
//# sourceMappingURL=VoteWebhook.d.ts.map