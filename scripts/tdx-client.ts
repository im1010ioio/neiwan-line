const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_ROOT = "https://tdx.transportdata.tw/api/basic";
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_WAIT_MS = 90_000;

interface TdxClientOptions {
    clientId: string;
    clientSecret: string;
    fetchImpl?: typeof fetch;
    requestIntervalMs?: number;
    maxDataRequests?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
}

interface TokenResponse {
    access_token?: string;
    expires_in?: number;
}

export interface TdxClient {
    getJson(path: string): Promise<unknown>;
    readonly dataRequests: number;
}

function retryDelay(value: string | null, now: number): number {
    if (!value) return RATE_LIMIT_WAIT_MS;
    if (/^\d+$/.test(value)) return Number(value) * 1_000;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : RATE_LIMIT_WAIT_MS;
}

export function createTdxClient(options: TdxClientOptions): TdxClient {
    const fetchImpl = options.fetchImpl ?? fetch;
    const requestIntervalMs = options.requestIntervalMs ?? 13_000;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((milliseconds) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    let token: { value: string; expiresAt: number } | null = null;
    let lastRequestAt: number | null = null;
    let rateLimitedUntil = 0;
    let requestQueue = Promise.resolve();
    let dataRequests = 0;
    let retriesRemaining = 2;

    const accessToken = async (): Promise<string> => {
        if (token && token.expiresAt > now() + 60_000) {
            return token.value;
        }
        const body = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: options.clientId,
            client_secret: options.clientSecret,
        });
        const response = await fetchImpl(TOKEN_URL, {
            method: "POST",
            signal: AbortSignal.timeout(30000),
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body,
        });
        if (!response.ok) {
            throw new Error(`TDX 身分驗證失敗（HTTP ${response.status}）`);
        }
        const payload = await response.json() as TokenResponse;
        if (!payload.access_token) {
            throw new Error("TDX 身分驗證未回傳 Access Token");
        }
        token = {
            value: payload.access_token,
            expiresAt: now() + (payload.expires_in ?? 3600) * 1000,
        };
        return token.value;
    };

    const queuedGet = (path: string): Promise<unknown> => {
        const task = requestQueue.then(async () => {
            const endpoint = path.split("?")[0];
            for (let attempt = 0; ; attempt++) {
                if (now() < rateLimitedUntil) {
                    throw new Error(`TDX 限流尚未解除（HTTP 429，${endpoint}）`);
                }
                if (dataRequests >= (options.maxDataRequests ?? Infinity)) {
                    throw new Error(`達到單次更新 ${options.maxDataRequests} 次 TDX 請求上限`);
                }
                const access = await accessToken();
                if (lastRequestAt !== null) {
                    const remaining = requestIntervalMs - (now() - lastRequestAt);
                    if (remaining > 0) await sleep(remaining);
                }
                lastRequestAt = now();
                dataRequests++;
                const response = await fetchImpl(`${API_ROOT}${path}`, {
                    signal: AbortSignal.timeout(30000),
                    headers: {
                        authorization: `Bearer ${access}`,
                        "accept-encoding": "br, gzip",
                    },
                });
                if (response.ok) return response.json() as Promise<unknown>;

                await response.body?.cancel();
                const error = new Error(`TDX 資料取得失敗（HTTP ${response.status}，${endpoint}）`);
                if (response.status !== 429) throw error;

                const waitMs = Math.max(requestIntervalMs, retryDelay(response.headers.get("Retry-After"), now()));
                if (attempt > 0 || retriesRemaining === 0
                    || dataRequests >= (options.maxDataRequests ?? Infinity) || waitMs > MAX_RATE_LIMIT_WAIT_MS) {
                    rateLimitedUntil = now() + waitMs;
                    throw error;
                }
                retriesRemaining--;
                console.warn(`TDX 限流（HTTP 429，${endpoint}），等待 ${Math.ceil(waitMs / 1_000)} 秒後重試`);
                await sleep(waitMs);
            }
        });
        requestQueue = task.then(() => undefined, () => undefined);
        return task;
    };

    return {
        getJson: queuedGet,
        get dataRequests() { return dataRequests; },
    };
}
