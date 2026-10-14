import { describe, expect, it } from "vitest";
import { applyMetroReview, mergeMetroVersions, metroSourceHash, normalizeMetroDirections, prepareMetroUpdate, type MetroReview } from "../scripts/metro-update";
import { metroLegs, metroSnapshotForDate } from "../src/domain/metro";
import { createMetroFixture } from "./helpers/metro-fixture";

const today = "2026-10-14";
const reviewOf = (source: ReturnType<typeof createMetroFixture>): MetroReview => ({
    sourceHash: metroSourceHash(source), reviewedAt: "2026-10-14T00:00:00Z", reason: "測試用已核實改班",
    sources: ["https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-A18"],
    validity: { from: today, through: "2026-11-11" },
});

describe("機捷更新決策與版本保存", () => {
    it("小幅調整自動接受且不污染來源資料", () => {
        const previous = createMetroFixture(), next = createMetroFixture();
        next.timetables[0].Timetables[1].DepartureTime = "12:05";
        const before = structuredClone(next);
        const result = prepareMetroUpdate(next, previous, today, []);
        expect(result.report.status).toBe("accepted");
        expect(result.snapshot).toBeDefined();
        expect(next).toEqual(before);
    });

    it("大量減班必須核實精確版本，重新下載或別版紀錄不能放行", () => {
        const previous = createMetroFixture(), next = createMetroFixture();
        next.timetables[0].Timetables.splice(1, 1);
        const rejected = prepareMetroUpdate(next, previous, today, []);
        expect(rejected.report.status).toBe("needs-review");
        expect(rejected.snapshot).toBeUndefined();
        expect(rejected.report.changes[0]).toMatchObject({ previousCount: 3, count: 2 });
        expect(prepareMetroUpdate(next, previous, today, [reviewOf(previous)]).snapshot).toBeUndefined();
        const accepted = prepareMetroUpdate(next, previous, today, [reviewOf(next)]);
        expect(accepted.report.status).toBe("accepted");
        expect(accepted.report.changes.length).toBeGreaterThan(0);
        expect(accepted.snapshot).toBeDefined();
    });

    it("核實不能略過缺站與格式錯誤", () => {
        const raw = createMetroFixture();
        raw.timetables = raw.timetables.filter(row => row.StationID !== "A8");
        const result = prepareMetroUpdate(raw, undefined, today, [reviewOf(raw)]);
        expect(result.report.status).toBe("invalid");
        expect(result.report.errors.join()).toContain("車站資料不完整");
        expect(result.snapshot).toBeUndefined();
    });

    it("精簡前攔截其他站的矛盾模式，不能因仍有普通車而靜默丟掉", () => {
        const raw = createMetroFixture();
        raw.patterns.push({ StoppingPatternID: "short", Stations: [{ StationID: "A1", Sequence: 1 }, { StationID: "A3", Sequence: 2 }] });
        const row = structuredClone(raw.timetables.find(row => row.StationID === "A3" && row.Direction === 0)!);
        row.DestinationStaionID = "A18";
        row.Timetables = [{ DepartureTime: "12:15", TrainType: 1, StoppingPatternID: "short" }];
        raw.timetables.push(row);
        const result = prepareMetroUpdate(raw, undefined, today, []);
        expect(result.report.errors.join()).toContain("終點 A18");
        expect(result.snapshot).toBeUndefined();
    });

    it("指紋忽略刷新時間與陣列順序，班次及抵達時間改動必須重新核實", () => {
        const raw = createMetroFixture(), refreshed = structuredClone(raw);
        refreshed.generatedAt = "2026-10-15T00:00:00Z";
        refreshed.timetables.reverse();
        expect(metroSourceHash(refreshed)).toBe(metroSourceHash(raw));
        refreshed.timetables[0].Timetables[0].DepartureTime = "06:05";
        expect(metroSourceHash(refreshed)).not.toBe(metroSourceHash(raw));
        const arrivalChanged = { ...raw, extra: { ArrivalTime: "06:01" } };
        expect(metroSourceHash(arrivalChanged)).not.toBe(metroSourceHash(raw));
        expect(() => applyMetroReview(refreshed, reviewOf(raw))).toThrow("資料版本");
    });

    it("核實紀錄必須包含有效日期與依據，過期紀錄不適用", () => {
        const raw = createMetroFixture();
        expect(() => applyMetroReview(raw, { ...reviewOf(raw), sources: [] })).toThrow("官方依據");
        expect(() => applyMetroReview(raw, { ...reviewOf(raw), validity: { from: "2026-99-99", through: "2026-11-11" } })).toThrow("有效日期");
        raw.timetables[0].Timetables.splice(1, 1);
        const expired = { ...reviewOf(raw), validity: { from: "2026-10-01", through: "2026-10-13" } };
        const result = prepareMetroUpdate(raw, createMetroFixture(), today, [expired]);
        expect(result.report.status).toBe("invalid");
        expect(result.report.errors.join()).toContain("適用期間已到期");
        expect(result.snapshot).toBeUndefined();
    });

    it("缺方向只按已知線形的起迄站補入，不改寫明確的矛盾方向", () => {
        const raw = createMetroFixture();
        const row = raw.timetables.find(row => row.StationID === "A18" && row.Direction === 1)!;
        delete (row as Partial<typeof row>).Direction;
        expect(normalizeMetroDirections(raw).timetables.find(row => row.StationID === "A18" && row.DestinationStaionID === "A1")!.Direction).toBe(1);
        row.Direction = 0;
        const result = prepareMetroUpdate(raw, undefined, today, []);
        expect(result.report.errors.join()).toContain("矛盾");
    });

    it("核實修正須唯一對應班次且不能新增發車時刻", () => {
        const raw = createMetroFixture(), row = raw.timetables[0], time = row.Timetables[0];
        const review = reviewOf(raw);
        review.corrections = [{ station: row.StationID, direction: row.Direction, destination: row.DestinationStaionID,
            serviceTag: String(row.ServiceDay.ServiceTag ?? ""), departure: time.DepartureTime,
            expected: { TrainType: 1, StoppingPatternID: "local" }, replacement: { DestinationStationID: "A21" } }];
        row.ServiceDay.ServiceTag = "";
        review.sourceHash = metroSourceHash(raw);
        const corrected = applyMetroReview(raw, review);
        expect(corrected.timetables[0].Timetables[0]).toMatchObject({ DepartureTime: "06:00", DestinationStationID: "A21" });
        review.corrections[0].departure = "06:01";
        expect(() => applyMetroReview(raw, review)).toThrow("唯一對應");
        Object.assign(review.corrections[0].replacement, { DepartureTime: "06:05" });
        expect(() => applyMetroReview(raw, review)).toThrow("不得新增或變更發車時刻");
    });

    it("無效期的日常更新保持單一當前版本，不建立無效的future資料", () => {
        const previous = createMetroFixture(), next = createMetroFixture();
        delete previous.validity;
        delete next.validity;
        const merged = mergeMetroVersions(previous, next, today);
        expect(merged.future).toBeUndefined();
        expect(metroSnapshotForDate(merged, "2026-11-01")).toBeDefined();
    });

    it("未提供日期的新來源不能覆蓋已核實期間", () => {
        const next = createMetroFixture();
        delete next.validity;
        expect(prepareMetroUpdate(next, createMetroFixture(), today, []).snapshot).toBeUndefined();
    });

    it("提前取得下週班表保留今天版本，到期不復活舊版", () => {
        const previous = createMetroFixture(), next = createMetroFixture();
        next.validity = { from: "2026-10-20", through: "2026-10-30" };
        next.timetables[0].Timetables[0].DepartureTime = "06:05";
        const result = prepareMetroUpdate(next, previous, today, []);
        expect(result.report.status).toBe("scheduled");
        expect(metroSnapshotForDate(result.snapshot!, today)!.timetables[0].Timetables[0].DepartureTime).toBe("06:00");
        expect(metroSnapshotForDate(result.snapshot!, "2026-10-20")!.timetables[0].Timetables[0].DepartureTime).toBe("06:05");
        expect(metroSnapshotForDate(result.snapshot!, "2026-10-31")).toBeUndefined();
    });

    it("生效首日午夜沿用上一營運日，資料年齡與失败標記不會被假刷新", () => {
        const previous = createMetroFixture(), next = createMetroFixture();
        previous.generatedAt = "2026-10-13T00:00:00Z";
        previous.updateFailedAt = "2026-10-13T23:00:00Z";
        previous.timetables.forEach(row => row.Timetables.push({ DepartureTime: "00:10", TrainType: 1, StoppingPatternID: "local" }));
        next.validity = { from: today, through: "2026-11-11" };
        const merged = mergeMetroVersions(previous, next, today);
        expect(metroSnapshotForDate(merged, "2026-10-13")!.generatedAt).toBe(previous.generatedAt);
        expect(metroSnapshotForDate(merged, today)!.updateFailedAt).toBeUndefined();
        expect(metroLegs(merged, "tymc:A18", "tymc:A1", today, "all")[0].departure).toBe(Date.parse("2026-10-14T00:10:00+08:00"));
    });
});
