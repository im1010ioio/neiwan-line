import { expect, it } from "vitest";
import { createDayLoader } from "../src/data-loader";
import { packTimetable, type DayIndex, type TimetableGroup } from "../src/domain/timetable-format";
import { addDays } from "../src/domain/query";
import type { RailOperator } from "../src/domain/types";
const date = "2026-09-25";
const stamp = `${date}T04:30:00+08:00`;
function fixture() {
    const calls: string[] = [];
    let revision = "0123456789abcdef", fail = "", now = 0;
    const fetcher: typeof fetch = async input => {
        const path = String(input).split("/data/")[1];
        calls.push(path);
        if (fail && path.includes(fail)) return new Response("", { status: 503 });
        const slice = /^slices\/(local|tra|thsr)-(\d{4}-\d{2}-\d{2})-/.exec(path);
        if (slice) {
            const operator: RailOperator = slice[1] === "thsr" ? "thsr" : "tra";
            const time = Date.parse(`${slice[2]}T08:00:00+08:00`);
            return Response.json(packTimetable(slice[2], operator, [{ id: `${operator}:${slice[2]}:42`, number: "42", operator, service: "測試班表",
                stops: ["A", "B"].map((id, i) => ({ station: `${operator}:${id}`, arrival: time + i * 60000, departure: time + i * 60000 })) }]));
        }
        const selected = path.slice(0, 10);
        const index: DayIndex = { schemaVersion: 2, date: selected, generatedAt: stamp, coverage: { tra: true, thsr: true }, sources: [],
            operatorUpdatedAt: { tra: stamp, thsr: stamp },
            files: Object.fromEntries(["local", "tra", "thsr"].map(group => [group,
                [-1, 0, 1].map(offset => `slices/${group}-${addDays(selected, offset)}-${revision}.json`),
            ])) as DayIndex["files"] };
        return Response.json(index);
    };
    return { calls, loader: createDayLoader(fetcher, "/neiwan-line/", () => now),
        fail: (value: string) => { fail = value; }, update: () => { revision = "fedcba9876543210"; now += 61000; } };
}
it("同日篩選不重新下載，隔日共用兩天資料，高鐵僅在需要時載入", async () => {
    const f = fixture();
    expect((await f.loader(date, ["local"])).status).toBe("ready");
    expect(f.calls).toHaveLength(4);
    expect(f.calls.some(file => /slices\/(tra|thsr)-/.test(file))).toBe(false);
    await f.loader(date, ["local"]);
    expect(f.calls).toHaveLength(4);
    await f.loader(addDays(date, 1), ["local"]);
    expect(f.calls).toHaveLength(6);
    await f.loader(date, ["local", "thsr"]);
    expect(f.calls).toHaveLength(9);
    await f.loader(date, ["tra"]);
    expect(f.calls).toHaveLength(12);
});
it("上游更新後採新內容檔，資料顯示原始取得時間", async () => {
    const f = fixture();
    await f.loader(date, ["local"]);
    f.update();
    const result = await f.loader(date, ["local"]);
    expect(f.calls).toHaveLength(8);
    expect(f.calls.at(-1)).toContain("fedcba9876543210");
    expect(result.status === "ready" && result.data.operatorUpdatedAt?.tra).toBe(stamp);
});
it("下載失敗不永久快取；日間資料仍可查，缺少跨日檔須標記不完整", async () => {
    const f = fixture();
    f.fail("local-2026-09-26");
    const partial = await f.loader(date, ["local"]);
    expect(partial.status === "ready" && partial.data.coverage.tra).toBe(true);
    expect(partial.status === "ready" && partial.data.contextCoverage?.tra).toEqual([true, true, false]);
    f.fail("local-2026-09-25");
    const missing = await f.loader(date, ["local"], true);
    expect(missing.status === "ready" && missing.data.coverage.tra).toBe(false);
    f.fail("");
    const retry = await f.loader(date, ["local"]);
    expect(retry.status === "ready" && retry.data.contextCoverage?.tra).toEqual([true, true, true]);
});
it("拒絕錯誤日期與索引中的外部路徑，不將它們當成成功班表", async () => {
    const fetcher: typeof fetch = async () => Response.json({ schemaVersion: 2, date, generatedAt: stamp, coverage: { tra: true, thsr: false },
        files: { local: [null, "https://example.com/data.json", null], tra: [null, null, null], thsr: [null, null, null] } });
    expect((await createDayLoader(fetcher, "/")(date, ["local"])).status).toBe("missing");
});
