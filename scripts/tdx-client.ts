const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_ROOT = "https://tdx.transportdata.tw/api/basic";

interface TdxClientOptions {
    clientId: string;
    clientSecret: string;
    fetchImpl?: typeof fetch;
    requestIntervalMs?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
}

interface TokenResponse {
    access_token?: string;
    expires_in?: number;
}

export interface TdxClient {
    getJson(path: string): Promise<unknown>;
}

export function createTdxClient(options: TdxClientOptions): TdxClient {
    const fetchImpl = options.fetchImpl ?? fetch;
    const requestIntervalMs = options.requestIntervalMs ?? 13_000;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((milliseconds) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    let token: { value: string; expiresAt: number } | null = null;
    let lastRequestAt: number | null = null;
    let requestQueue = Promise.resolve();

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
            if (lastRequestAt !== null) {
                const remaining = requestIntervalMs - (now() - lastRequestAt);
                if (remaining > 0) {
                    await sleep(remaining);
                }
            }
            lastRequestAt = now();
            const response = await fetchImpl(`${API_ROOT}${path}`, {
                signal: AbortSignal.timeout(30000),
                headers: {
                    authorization: `Bearer ${await accessToken()}`,
                    "accept-encoding": "br, gzip",
                },
            });
            if (!response.ok) {
                throw new Error(`TDX 資料取得失敗（HTTP ${response.status}，${path.split("?")[0]}）`);
            }
            return response.json() as Promise<unknown>;
        });
        requestQueue = task.then(() => undefined, () => undefined);
        return task;
    };

    return {
        getJson: queuedGet,
    };
}
