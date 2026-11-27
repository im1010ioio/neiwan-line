import { describe, expect, it, vi } from "vitest";
import { createTdxClient } from "../scripts/tdx-client";

function mockClient(responses: Response[], maxDataRequests?: number) {
    let time = Date.UTC(2026, 10, 27);
    const fetchImpl = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ access_token: "test-token", expires_in: 3600 }));
    for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
    const sleep = vi.fn(async (ms: number) => { time += ms; });
    const client = createTdxClient({
        clientId: "test", clientSecret: "test", fetchImpl, sleep, now: () => time, maxDataRequests,
    });
    return { client, fetchImpl, sleep };
}

describe("TDX 429 重試", () => {
    it("依 Retry-After 等待後重試，並把重試計入請求數", async () => {
        const { client, fetchImpl, sleep } = mockClient([
            new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
            Response.json({ ok: true }),
        ], 2);
        await expect(client.getJson("/first")).resolves.toEqual({ ok: true });
        await expect(client.getJson("/second")).rejects.toThrow("2 次 TDX 請求上限");
        expect(sleep.mock.calls).toEqual([[20_000]]);
        expect(client.dataRequests).toBe(2);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("等待超過上限時保留 429，且冷卻期間不發出新請求", async () => {
        const { client, fetchImpl, sleep } = mockClient([
            new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
        ]);
        await expect(client.getJson("/first")).rejects.toThrow("HTTP 429");
        await expect(client.getJson("/second")).rejects.toThrow("限流尚未解除");
        expect(sleep).not.toHaveBeenCalled();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
