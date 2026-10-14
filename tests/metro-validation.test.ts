import { describe, expect, it } from "vitest";
import { assessMetro, validateMetro } from "../src/domain/metro-health";
import { metroLegs, type MetroSnapshot } from "../src/domain/metro";
import { createMetroFixture as fixture, metroFixtureServices as services } from "./helpers/metro-fixture";

const today = "2026-10-14";

describe("機捷資料結構與改班複核", () => {
    it("完整且一致的班表可直接採用", () => {
        expect(assessMetro(fixture(), undefined, today)).toEqual({ errors: [], changes: [] });
    });

    it.each(["2026-02-30", "2026-2-01", "invalid"])("拒絕不存在或格式不正確的檢查日期 %s", date => {
        expect(assessMetro(fixture(), undefined, date).errors).toContain("機捷檢查日期異常");
    });

    it.each([
        ["資料取得時間", (snapshot: MetroSnapshot): unknown => snapshot.generatedAt = "2026-02-30T00:00:00Z"],
        ["適用期間", (snapshot: MetroSnapshot): unknown => snapshot.validity = { from: "2026-10-20", through: "2026-10-13" }],
        ["適用期間", (snapshot: MetroSnapshot): unknown => snapshot.validity = { from: "2026-02-30", through: "2026-10-30" }],
        ["保留期限", (snapshot: MetroSnapshot): unknown => snapshot.staleAfter = "2026-13-01"],
        ["車站資料不完整", (snapshot: MetroSnapshot): unknown => snapshot.timetables = snapshot.timetables.filter(row => row.StationID !== "A8")],
        ["方向", (snapshot: MetroSnapshot): unknown => snapshot.timetables[0].Direction = 2],
        ["行駛規則", (snapshot: MetroSnapshot): unknown => snapshot.timetables[0].ServiceDay.Monday = "true"],
        ["發車時間", (snapshot: MetroSnapshot): unknown => snapshot.timetables[0].Timetables[0].DepartureTime = "06:60"],
        ["發車時間", (snapshot: MetroSnapshot): unknown => snapshot.timetables[0].Timetables[0].DepartureTime = "27:00"],
        ["車種", (snapshot: MetroSnapshot): unknown => snapshot.timetables[0].Timetables[0].TrainType = 9],
        ["引用不存在的停靠模式", (snapshot: MetroSnapshot): unknown => snapshot.timetables[0].Timetables[0].StoppingPatternID = "missing"],
        ["車站或順序", (snapshot: MetroSnapshot): unknown => snapshot.patterns[0].Stations[0].StationID = "A99"],
        ["車站或順序", (snapshot: MetroSnapshot): unknown => snapshot.patterns[0].Stations[0].Sequence = 2],
        ["不在停靠模式", (snapshot: MetroSnapshot): unknown => snapshot.patterns[0].Stations = snapshot.patterns[0].Stations.filter(station => station.StationID !== "A18")],
        ["終點", (snapshot: MetroSnapshot): unknown => snapshot.timetables[0].Timetables[0].DestinationStationID = "A1"],
        ["終點", (snapshot: MetroSnapshot): unknown => snapshot.timetables[0].Timetables[0].DestinationStationID = "A99"],
        ["旅行時間異常", (snapshot: MetroSnapshot): unknown => snapshot.travelTimes[0].TravelTimes[0].RunTime = 0],
        ["缺少旅行時間", (snapshot: MetroSnapshot): unknown => snapshot.travelTimes[0].TravelTimes.shift()],
    ] as const)("阻擋 %s 錯誤且不歸類為可複核的正常改班", (message, mutate) => {
        const snapshot = fixture();
        mutate(snapshot);
        const result = assessMetro(snapshot, undefined, today);
        expect(result.errors.join("；")).toContain(message);
        expect(result.changes).toEqual([]);
    });

    it("每班終點可取代列層級終點，但仍檢查方向與停靠模式", () => {
        const snapshot = fixture();
        const row = snapshot.timetables.find(row => row.StationID === "A18" && row.Direction === 1)!;
        row.Timetables.forEach(departure => departure.DestinationStationID = "A1");
        row.DestinationStaionID = "A22";
        expect(assessMetro(snapshot, undefined, today).errors).toEqual([]);
        delete row.Timetables[0].DestinationStationID;
        expect(assessMetro(snapshot, undefined, today).errors.join("；")).toContain("終點 A22");
    });

    it("每班核實的旅行時間可取代通用旅行時間，且必須對應實際停站", () => {
        const snapshot = fixture();
        snapshot.travelTimes[0].TravelTimes = snapshot.travelTimes[0].TravelTimes.filter(time => time.FromStationID !== "A1");
        snapshot.timetables[0].Timetables.forEach(departure => departure.RunTimeByDestination = { A18: 450 });
        expect(assessMetro(snapshot, undefined, today).errors).toEqual([]);
        snapshot.timetables[0].Timetables[0].RunTimeByDestination = { A18: -1 };
        expect(assessMetro(snapshot, undefined, today).errors.join("；")).toContain("每班旅行時間或停靠站異常");
        snapshot.timetables[0].Timetables[0].RunTimeByDestination = { A99: 450 };
        expect(assessMetro(snapshot, undefined, today).errors.join("；")).toContain("每班旅行時間或停靠站異常");
    });

    it("逐日驗證每站雙向服務，不能被同站另一方向的資料掩蓋", () => {
        const snapshot = fixture();
        snapshot.timetables.find(row => row.StationID === "A12" && row.Direction === 0)!.ServiceDay.Wednesday = false;
        expect(assessMetro(snapshot, undefined, today).errors).toContain("機捷 2026-10-14 A12→A18 缺少班次");
    });

    it("減班超過三成產生逐日差異，維持需要複核的阻擋", () => {
        const previous = fixture(), snapshot = fixture();
        snapshot.timetables.find(row => row.StationID === "A1")!.Timetables.splice(1, 1);
        const result = assessMetro(snapshot, previous, today);
        expect(result.errors).toEqual([]);
        expect(result.changes[0]).toEqual({ date: today, from: "A1", to: "A18", previousCount: 3, count: 2,
            previousFirst: "06:00", first: "06:00", previousLast: "22:00", last: "22:00", reasons: ["班次減少超過三成"] });
        expect(() => validateMetro(snapshot, previous, today)).toThrow("需核對官方來源後確認");
    });

    it("一般增班、減班與小幅時間調整不要求人工確認", () => {
        const previous = fixture(), snapshot = fixture();
        for (const source of [previous, snapshot]) for (const row of source.timetables) {
            row.Timetables = ["06:00", "08:00", "10:00", "12:00", "22:00"].map(DepartureTime => ({ DepartureTime, TrainType: 1, StoppingPatternID: "local" }));
        }
        snapshot.timetables[0].Timetables.splice(1, 1);
        snapshot.timetables[0].Timetables[0].DepartureTime = "06:15";
        snapshot.timetables[1].Timetables.push({ DepartureTime: "15:00", TrainType: 1, StoppingPatternID: "local" });
        expect(assessMetro(snapshot, previous, today)).toEqual({ errors: [], changes: [] });
    });

    it("首末班移動一小時需要複核，即使總班數不變", () => {
        const previous = fixture(), snapshot = fixture();
        snapshot.timetables[0].Timetables[0].DepartureTime = "07:00";
        snapshot.timetables[0].Timetables[2].DepartureTime = "23:00";
        expect(assessMetro(snapshot, previous, today).changes[0].reasons)
            .toEqual(["首班時間異動至少一小時", "末班時間異動至少一小時"]);
    });

    it("過期活動班表不再作為新日期的比較基準", () => {
        const previous = fixture(), snapshot = fixture();
        previous.validity!.through = "2026-10-13";
        snapshot.validity!.from = today;
        snapshot.timetables.forEach(row => row.Timetables.splice(1, 1));
        expect(assessMetro(snapshot, previous, today)).toEqual({ errors: [], changes: [] });
    });

    it("只驗證候選版本的適用日期，尚未生效版本只比對生效後日期", () => {
        const previous = fixture(), snapshot = fixture();
        snapshot.future = [fixture()];
        snapshot.future[0].validity = { from: "2026-10-20", through: "2026-10-21" };
        snapshot.future[0].timetables[0].Timetables.splice(1, 1);
        const result = assessMetro(snapshot, previous, today);
        expect(result.errors).toEqual([]);
        expect([...new Set(result.changes.map(change => change.date))]).toEqual(["2026-10-20", "2026-10-21"]);
    });

    it("未來版本缺少明確日期時阻擋，避免提早套用", () => {
        const snapshot = fixture();
        const future = fixture();
        delete future.validity;
        snapshot.future = [future];
        expect(assessMetro(snapshot, undefined, today).errors.join("；")).toContain("缺少明確適用期間");
    });

    it("整個檢查期間均未生效或已過期的候選班表不能通過", () => {
        const snapshot = fixture();
        snapshot.validity!.through = "2026-10-13";
        expect(assessMetro(snapshot, undefined, today).errors.join("；")).toContain("沒有適用日期");
        snapshot.validity = { from: "2026-12-01", through: "2026-12-31" };
        expect(assessMetro(snapshot, undefined, today).errors.join("；")).toContain("沒有適用日期");
    });

    it("午夜班次統計與查詢引擎一致，快取也區分前一日假日規則", () => {
        const previous = fixture(), snapshot = fixture();
        previous.validity!.from = "2026-10-10";
        snapshot.validity!.from = "2026-10-10";
        const row = snapshot.timetables[0];
        const overnight = structuredClone(row);
        overnight.ServiceDay = { ...services, Monday: false, Tuesday: false, Wednesday: false, Thursday: false, Friday: false };
        overnight.Timetables = [{ DepartureTime: "00:30", TrainType: 1, StoppingPatternID: "local" }];
        snapshot.timetables.push(overnight);
        const result = assessMetro(snapshot, previous, today);
        expect(result.errors).toEqual([]);
        for (const date of ["2026-10-18", "2026-10-19", "2026-10-25", "2026-10-26"]) {
            const change = result.changes.find(change => change.date === date && change.from === "A1" && change.to === "A18")!;
            const end = Date.parse(`${date}T00:00:00+08:00`) + 86400000;
            const legs = metroLegs(snapshot, "tymc:A1", "tymc:A18", date, "all").filter(leg => leg.departure < end);
            expect(change.count).toBe(legs.length);
            expect(change.first).toBe("00:30");
        }
        expect(result.changes.some(change => change.date === "2026-10-20")).toBe(false);
    });
});
