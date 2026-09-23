import { expect, it } from "vitest";
import { addDays } from "../src/domain/query";
import type { DayData, RailOperator, Train } from "../src/domain/types";
import { assembleDay, fillSlices, restoreSlices, type TimetableSlices } from "../scripts/timetable-cache";

const start = "2026-09-23";
const firstUpdate = "2026-09-23T04:30:00+08:00";
const secondUpdate = "2026-09-24T04:30:00+08:00";
const dates = (today: string) => Array.from({ length: 29 }, (_, i) => addDays(today, i));
function train(operator: RailOperator, date: string): Train {
    const time = Date.parse(`${date}T08:00:00+08:00`);
    return {
        id: `${operator}:${date}:TEST`, number: "TEST", operator, service: "自動化測試資料",
        stops: [{ station: `${operator}:A`, arrival: time, departure: time }, { station: `${operator}:B`, arrival: time + 60000, departure: time + 60000 }],
    };
}
function snapshot(slices: TimetableSlices, today = start, updatedAt = firstUpdate): DayData[] {
    return dates(today).slice(0, 28).map(date => assembleDay(date, slices, updatedAt, ["自動化測試資料"]));
}
async function run(cached = new Map(), today = start, force = false, fail?: string) {
    const calls: string[] = [];
    const failures: string[] = [];
    const slices = await fillSlices({
        cached, dates: dates(today), updatedAt: today === start ? firstUpdate : secondUpdate,
        force, refreshOperators: ["tra"],
        fetchDay: async (operator, date) => {
            const key = `${operator}:${date}`;
            calls.push(key);
            if (key === fail) throw new Error("測試用上游失敗");
            return [train(operator, date)];
        },
        onFailure: (operator, date) => { failures.push(`${operator}:${date}`); },
    });
    return { slices, calls, failures, tdxCalls: calls.filter(key => key.startsWith("thsr:")) };
}

it("首次抓29天；隔天沿用已存日期，只用一次高鐵請求補跨日銜接；同日重跑零次", async () => {
    const first = await run();
    expect(first.tdxCalls).toHaveLength(29);
    const saved = restoreSlices(snapshot(first.slices));
    expect(saved.has("thsr:2026-10-21")).toBe(true);
    const second = await run(saved, "2026-09-24");
    expect(second.tdxCalls).toEqual(["thsr:2026-10-22"]);
    expect(second.calls.filter(key => key.startsWith("tra:"))).toHaveLength(29);
    const day = snapshot(second.slices, "2026-09-24", secondUpdate)[0];
    expect(day.operatorUpdatedAt?.thsr).toBe(firstUpdate);
    expect(day.operatorUpdatedAt?.tra).toBe(secondUpdate);
    expect(day.staleOperators).toEqual([]);
    expect(day.contextCoverage?.thsr).toEqual([true, true, true]);
    const repeated = await run(restoreSlices(snapshot(second.slices, "2026-09-24", secondUpdate)), "2026-09-24");
    expect(repeated.tdxCalls).toEqual([]);
});

it("漏跑數日只補缺少的日期；單一日期缺漏不重抓其他班表", async () => {
    const initial = await run();
    const saved = restoreSlices(snapshot(initial.slices));
    expect((await run(saved, "2026-09-26")).tdxCalls).toEqual(["thsr:2026-10-22", "thsr:2026-10-23", "thsr:2026-10-24"]);
    saved.delete("thsr:2026-09-25");
    expect((await run(saved)).tdxCalls).toEqual(["thsr:2026-09-25"]);
});

it("強制更新可取得異動班表；失敗保留原班表、原時間，之後只重試失敗日期", async () => {
    const initial = await run();
    const saved = restoreSlices(snapshot(initial.slices));
    const failedKey = "thsr:2026-09-25";
    const forced = await run(saved, start, true, failedKey);
    expect(forced.tdxCalls).toHaveLength(29);
    expect(forced.failures).toEqual([failedKey]);
    expect(forced.slices.get(failedKey)).toEqual({ ...saved.get(failedKey), stale: true });
    const failedFiles = snapshot(forced.slices);
    expect(failedFiles.find(day => day.date === "2026-09-25")?.staleOperators).toContain("thsr");
    const retry = await run(restoreSlices(failedFiles));
    expect(retry.tdxCalls).toEqual([failedKey]);
    expect(retry.slices.get(failedKey)?.stale).not.toBe(true);
});

it("首次取得失敗保留缺漏，重跑只補失敗日期，不寫入空班表當成成功", async () => {
    const failed = await run(new Map(), start, false, "thsr:2026-09-25");
    const days = snapshot(failed.slices);
    expect(days.find(day => day.date === "2026-09-25")?.coverage.thsr).toBe(false);
    const retry = await run(restoreSlices(days));
    expect(retry.tdxCalls).toEqual(["thsr:2026-09-25"]);
});

it("相容原有班表並忽略損壞資料，不能拿無效車次當快取", async () => {
    const initial = await run();
    const days = snapshot(initial.slices).map(({ sliceMetadata, operatorUpdatedAt, ...day }) => day);
    const corrupted = { ...days[0], trains: [{ ...days[0].trains[0], stops: [] }] };
    const cached = restoreSlices([...days, corrupted, null as unknown as DayData]);
    expect(cached.get("thsr:2026-10-21")?.updatedAt).toBe(firstUpdate);
    expect((await run(cached, "2026-09-24")).tdxCalls).toEqual(["thsr:2026-10-22"]);
});
