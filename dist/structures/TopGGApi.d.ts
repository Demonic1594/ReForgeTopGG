import { Api } from "@top-gg/sdk";
export type ApiResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
};
/**
 * Wraps the Top.gg API client so callers can tell an answer apart from a
 * failed request. The token is never part of the returned message.
 */
export declare class TopGGApi {
    private readonly token?;
    readonly client: Api | null;
    constructor(token?: string | undefined);
    request<T>(call: (api: Api) => Promise<T>): Promise<ApiResult<T>>;
}
//# sourceMappingURL=TopGGApi.d.ts.map