import { expect, it } from "vitest";
import { loadDay } from "../src/data-loader";
it("不把其他日期或損壞的班表顯示成今天資料", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ schemaVersion: 1, date: "2026-09-20", trains: [], coverage: { tra: true, thsr: true } }));
    expect((await loadDay("2026-09-21", fakeFetch)).status).toBe("missing");
});
