"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopGGApi = void 0;
const sdk_1 = require("@top-gg/sdk");
/**
 * Wraps the Top.gg API client so callers can tell an answer apart from a
 * failed request. The token is never part of the returned message.
 */
class TopGGApi {
    token;
    client;
    constructor(token) {
        this.token = token;
        this.client = token ? new sdk_1.Api(token) : null;
    }
    async request(call) {
        if (!this.client)
            return { ok: false, error: "Top.gg API request failed: no \"token\" was set in the ReForgeTopGG options" };
        try {
            return { ok: true, value: await call(this.client) };
        }
        catch (err) {
            let message = err instanceof Error ? err.message : String(err);
            if (this.token)
                message = message.split(this.token).join("[token]");
            return { ok: false, error: `Top.gg API request failed: ${message}` };
        }
    }
}
exports.TopGGApi = TopGGApi;
//# sourceMappingURL=TopGGApi.js.map