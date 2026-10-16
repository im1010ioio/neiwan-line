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

function structuralRepairCase() {
    const previous = createMetroFixture(), raw = createMetroFixture();
    delete raw.validity;
    const originalStops = raw.patterns[0].Stations;
    raw.patterns.push({ StoppingPatternID: "wrong", Stations: originalStops.filter(stop => stop.StationID !== "A18") });
    const row = raw.timetables.find(row => row.StationID === "A18" && row.Direction === 1)!;
    row.ServiceDay.ServiceTag = "測試行駛日";
    row.Timetables[0].StoppingPatternID = "wrong";
    const review: MetroReview = { ...reviewOf(raw), validity: { ...previous.validity! },
        sourcePatterns: Object.fromEntries(raw.patterns.map(pattern => [pattern.StoppingPatternID, pattern.Stations.map(stop => stop.StationID)])),
        corrections: [{ station: "A18", direction: 1, destination: "A1", serviceTag: "測試行駛日", departure: "06:00",
            expected: { TrainType: 1, StoppingPatternID: "wrong" }, replacement: { StoppingPatternID: "local" } }],
    };
    // Another API adds a definition, changing the feed hash without changing existing departures.
    raw.patterns.push({ StoppingPatternID: "additional", Stations: structuredClone(originalStops) });
    return { previous, raw, review, row };
}

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

    it("未提供日期且實際改班的新來源須核實期間並列出差異", () => {
        const next = createMetroFixture();
        delete next.validity;
        next.timetables[0].Timetables[0].DepartureTime = "06:05";
        const result = prepareMetroUpdate(next, createMetroFixture(), today, []);
        expect(result.snapshot).toBeUndefined();
        expect(result.report.status).toBe("needs-review");
        expect(result.report.errors).toEqual([]);
        expect(result.report.equivalence?.added[0].departure).toBe("06:05");
        expect(result.report.equivalence?.removed[0].departure).toBe("06:00");
    });

    it("拆列、排序、模式代碼與標籤改名不影響服務，可沿用效期且清除失敗標記", () => {
        const previous = createMetroFixture(), next = createMetroFixture();
        previous.updateFailedAt = "2026-10-14T01:00:00Z";
        delete next.validity;
        next.generatedAt = "2026-10-14T02:00:00Z";
        next.patterns[0].StoppingPatternID = "renamed";
        next.patterns[0].Stations.reverse();
        next.timetables = next.timetables.flatMap(row => row.Timetables.map(time => ({ ...row,
            ServiceDay: { ...row.ServiceDay, ServiceTag: "新名稱" }, Timetables: [{ ...time, DepartureTime: `${time.DepartureTime}:00`, StoppingPatternID: "renamed" }] }))).reverse();
        const input = structuredClone(next);
        const result = prepareMetroUpdate(next, previous, today, []);
        expect(result.report.status).toBe("accepted");
        expect(result.report.equivalence).toMatchObject({ matched: true, removed: [], added: [] });
        expect(result.snapshot?.validity).toEqual(previous.validity);
        expect(result.snapshot?.generatedAt).toBe(next.generatedAt);
        expect(result.snapshot?.updateFailedAt).toBeUndefined();
        expect(next).toEqual(input);
    });

    it("行駛日拆成多列仍能辨識相同服務，任何一天減班都會攔下", () => {
        const previous = createMetroFixture(), next = createMetroFixture();
        delete next.validity;
        next.timetables = next.timetables.flatMap(row => Object.keys(row.ServiceDay).map(day => ({ ...row,
            ServiceDay: Object.fromEntries(Object.keys(row.ServiceDay).map(key => [key, key === day])) })));
        expect(prepareMetroUpdate(next, previous, today, []).report.status).toBe("accepted");
        next.timetables[0] = { ...next.timetables[0], Timetables: next.timetables[0].Timetables.slice(1) };
        expect(prepareMetroUpdate(next, previous, today, []).report.status).toBe("needs-review");
    });

    it.each(["stops", "terminal", "duration", "duplicate", "type"])("實際 %s 差異不可當成格式變動", kind => {
        const previous = createMetroFixture(), next = createMetroFixture();
        delete next.validity;
        const row = next.timetables.find(row => row.StationID === "A18" && row.Direction === 1)!;
        if (kind === "stops") {
            next.patterns.push({ StoppingPatternID: "skip", Stations: next.patterns[0].Stations.filter(stop => stop.StationID !== "A10") });
            row.Timetables[0].StoppingPatternID = "skip";
        } else if (kind === "terminal") row.Timetables[0].DestinationStationID = "A2";
        else if (kind === "duration") next.travelTimes[0].TravelTimes.find(time => time.FromStationID === "A18" && time.ToStationID === "A1")!.RunTime++;
        else if (kind === "duplicate") row.Timetables.push({ ...row.Timetables[0] });
        else {
            next.travelTimes.push({ ...structuredClone(next.travelTimes[0]), TrainType: 2 });
            row.Timetables[0].TrainType = 2;
        }
        const result = prepareMetroUpdate(next, previous, today, []);
        expect(result.snapshot).toBeUndefined();
        expect(["needs-review", "invalid"]).toContain(result.report.status);
    });

    it("只對完全相符班次沿用已核實旅行時間，後續刷新仍保留且不延長效期", () => {
        const previous = createMetroFixture(), next = createMetroFixture();
        delete next.validity;
        const row = previous.timetables.find(row => row.StationID === "A18" && row.Direction === 1)!;
        row.Timetables[0].RunTimeByDestination = { A1: 540 };
        row.Timetables[0].ServiceName = "測試跳站車";
        const first = prepareMetroUpdate(next, previous, today, []);
        expect(first.report.status).toBe("accepted");
        expect(first.report.equivalence?.supplements).toBe(1);
        const second = prepareMetroUpdate(next, first.snapshot, "2026-10-15", []);
        expect(second.report.status).toBe("accepted");
        expect(second.snapshot?.validity).toEqual(previous.validity);
        const legs = metroLegs(second.snapshot!, "tymc:A18", "tymc:A1", today, "all");
        expect(legs[0].arrival - legs[0].departure).toBe(540000);
        expect(legs[0].service).toBe("測試跳站車");
        expect(legs[1].arrival - legs[1].departure).toBe(600000);
    });

    it.each(["base", "override", "departure", "stops"])("有 %s 新資訊時不以舊旅行時間掩蓋差異", kind => {
        const previous = createMetroFixture(), next = createMetroFixture();
        delete next.validity;
        previous.timetables.find(row => row.StationID === "A18" && row.Direction === 1)!.Timetables[0].RunTimeByDestination = { A1: 540 };
        const row = next.timetables.find(row => row.StationID === "A18" && row.Direction === 1)!;
        if (kind === "base") next.travelTimes[0].TravelTimes.find(time => time.FromStationID === "A18" && time.ToStationID === "A1")!.RunTime = 660;
        if (kind === "override") row.Timetables[0].RunTimeByDestination = { A1: 550 };
        if (kind === "departure") row.Timetables[0].DepartureTime = "06:01";
        if (kind === "stops") {
            next.patterns.push({ StoppingPatternID: "skip", Stations: next.patterns[0].Stations.filter(stop => stop.StationID !== "A10") });
            row.Timetables[0].StoppingPatternID = "skip";
        }
        const result = prepareMetroUpdate(next, previous, today, []);
        expect(result.snapshot).toBeUndefined();
        expect(result.report.status).toBe("needs-review");
        expect(result.report.equivalence?.supplements).toBe(0);
    });

    it.each(["expired", "future"])("不能從 %s 班表借用效期", kind => {
        const previous = createMetroFixture(), next = createMetroFixture();
        delete next.validity;
        previous.validity = kind === "expired" ? { from: "2026-10-01", through: "2026-10-13" } : { from: "2026-10-15", through: "2026-11-11" };
        const result = prepareMetroUpdate(next, previous, today, []);
        expect(result.snapshot).toBeUndefined();
        expect(result.report.status).toBe("needs-review");
    });

    it("相同服務刷新保留另存的未來班表，不能提前使用或延長舊版", () => {
        const previous = createMetroFixture(), future = createMetroFixture(), next = createMetroFixture();
        previous.validity!.through = "2026-10-19";
        future.validity = { from: "2026-10-20", through: "2026-11-11" };
        future.timetables[0].Timetables[0].DepartureTime = "06:05";
        previous.future = [future];
        delete next.validity;
        const result = prepareMetroUpdate(next, previous, today, []);
        expect(result.report.status).toBe("accepted");
        expect(result.snapshot?.validity).toEqual(previous.validity);
        expect(metroSnapshotForDate(result.snapshot!, "2026-10-20")).toEqual(future);
        expect(metroSnapshotForDate(result.snapshot!, "2026-11-12")).toBeUndefined();
    });

    it("不同來源格式只在原始停站定義及班次吻合時重用官方結構修正", () => {
        const { previous, raw, review } = structuralRepairCase();
        expect(metroSourceHash(raw)).not.toBe(review.sourceHash);
        const before = structuredClone(raw);
        const result = prepareMetroUpdate(raw, previous, today, [review]);
        expect(result.report.status).toBe("accepted");
        expect(result.report.corrections).toBe(1);
        expect(result.report.equivalence?.matched).toBe(true);
        expect(result.snapshot?.validity).toEqual(previous.validity);
        expect(raw).toEqual(before);
    });

    it.each(["original-pattern", "replacement-pattern", "duplicate", "departure", "expired-review", "missing-evidence"])("官方結構修正遇到 %s 不可盲目沿用", kind => {
        const { previous, raw, review, row } = structuralRepairCase();
        if (kind === "original-pattern") raw.patterns.find(pattern => pattern.StoppingPatternID === "wrong")!.Stations.pop();
        if (kind === "replacement-pattern") raw.patterns[0].Stations.pop();
        if (kind === "duplicate") row.Timetables.push({ ...row.Timetables[0] });
        if (kind === "departure") row.Timetables[0].DepartureTime = "06:01";
        if (kind === "expired-review") review.validity.through = "2026-10-13";
        if (kind === "missing-evidence") review.sources = [];
        const result = prepareMetroUpdate(raw, previous, today, [review]);
        expect(result.snapshot).toBeUndefined();
        expect(result.report.status).toBe("invalid");
    });

    it("成功套用官方結構修正仍須整體服務相同，不能掩蓋其他班次異動", () => {
        const { previous, raw, review } = structuralRepairCase();
        raw.timetables[0].Timetables[1].DepartureTime = "12:01";
        const result = prepareMetroUpdate(raw, previous, today, [review]);
        expect(result.snapshot).toBeUndefined();
        expect(result.report.corrections).toBe(1);
        expect(result.report.status).toBe("needs-review");
        expect(result.report.equivalence?.matched).toBe(false);
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
