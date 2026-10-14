import { afterEach, describe, expect, it, vi } from "vitest";
import { metroHealth } from "../src/domain/metro-health";
import { metroLegs, metroSnapshotForDate, type MetroSnapshot, type MetroVersion } from "../src/domain/metro";
import { loadMetro } from "../src/metro-loader";

const today = "2026-09-22";
const now = new Date(`${today}T12:00:00+08:00`);
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+08:00`);
function version(daytime = "09:10", overnight = "00:10"): MetroVersion {
    const service = { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true, Saturday: true, Sunday: true, NationalHolidays: true };
    return {
        generatedAt: now.toISOString(),
        timetables: [
            { StationID: "A18", Direction: 1, DestinationStaionID: "A1", ServiceDay: service, Timetables: [
                { DepartureTime: daytime, TrainType: 1, StoppingPatternID: "local" },
                { DepartureTime: overnight, TrainType: 1, StoppingPatternID: "local" },
            ] },
            { StationID: "A12", Direction: 0, DestinationStaionID: "A22", ServiceDay: service, Timetables: [
                { DepartureTime: daytime, TrainType: 1, StoppingPatternID: "local" },
            ] },
        ],
        patterns: [{ StoppingPatternID: "local", Stations: ["A1", "A12", "A13", "A18", "A22"].map((StationID, Sequence) => ({ StationID, Sequence })) }],
        travelTimes: [{ TrainType: 1, TravelTimes: [
            { FromStationID: "A18", ToStationID: "A12", RunTime: 1200 },
            { FromStationID: "A12", ToStationID: "A18", RunTime: 1200 },
        ] }],
    };
}
const departures = (snapshot: MetroSnapshot, date: string) => metroLegs(snapshot, "tymc:A18", "tymc:A12", date, "all")
    .filter(leg => leg.departure < at(date, "23:59")).map(leg => leg.departure);

afterEach(() => vi.unstubAllGlobals());

describe("機捷班表適用期間", () => {
    it("依營運日選版，生效日凌晨沿用前一營運日且不提前套用新班表", () => {
        const snapshot: MetroSnapshot = {
            ...version(),
            validity: { from: "2026-09-01", through: "2026-09-21" },
            future: [{ ...version("09:20", "00:20"), validity: { from: today, through: "2026-09-30" } }],
        };
        expect(departures(snapshot, "2026-09-21")).toEqual([at("2026-09-21", "00:10"), at("2026-09-21", "09:10")]);
        expect(departures(snapshot, today)).toEqual([at(today, "00:10"), at(today, "09:20")]);
        expect(departures(snapshot, "2026-09-23")).toEqual([at("2026-09-23", "00:20"), at("2026-09-23", "09:20")]);
        expect(metroHealth(snapshot, today, now).text).toContain("適用至 2026-09-30");
    });

    it("新版本到期後不重新套用被取代的未知效期班表", () => {
        const snapshot: MetroSnapshot = { ...version(), future: [{ ...version("09:20"), validity: { from: "2026-09-23", through: "2026-09-24" } }] };
        expect(metroSnapshotForDate(snapshot, today)).toBe(snapshot);
        expect(metroSnapshotForDate(snapshot, "2026-09-25")).toBeUndefined();
        expect(departures(snapshot, "2026-09-26")).toEqual([]);
        expect(metroHealth(snapshot, "2026-09-25", now).usable).toBe(false);
    });

    it("已知到期日後只保留最後營運日的凌晨末班，不再產生日間或下一營運日班次", () => {
        const snapshot = { ...version(), validity: { from: "2026-09-01", through: today } };
        expect(departures(snapshot, "2026-09-23")).toEqual([at("2026-09-23", "00:10")]);
        expect(metroLegs(snapshot, "tymc:A18", "tymc:A12", "2026-09-24", "all")).toEqual([]);
    });

    it("未生效、到期及明確保留期限結束均提供停用原因", () => {
        expect(metroHealth({ ...version(), validity: { from: "2026-09-23", through: "2026-09-30" } }, today, now)).toMatchObject({ usable: false, text: expect.stringContaining("尚未生效") });
        expect(metroHealth({ ...version(), validity: { from: "2026-09-01", through: "2026-09-20" } }, today, now)).toMatchObject({ usable: false, text: expect.stringContaining("超出資料適用期間") });
        const retained = { ...version(), staleAfter: "2026-09-20" };
        expect(metroHealth(retained, today, now)).toMatchObject({ usable: false, text: expect.stringContaining("保留期限") });
        expect(metroLegs(retained, "tymc:A18", "tymc:A12", today, "all")).toEqual([]);
    });

    it("未知效期的七天保留期限依實際時間計算，未來二十八天查詢仍可使用新資料", () => {
        const snapshot = version();
        expect(metroHealth(snapshot, "2026-10-19", now)).toMatchObject({ usable: true, warning: false });
        expect(metroHealth(snapshot, today, new Date(now.getTime() + 7 * 86400000))).toMatchObject({ usable: true, warning: true });
        expect(metroHealth(snapshot, today, new Date(now.getTime() + 7 * 86400000 + 1))).toMatchObject({ usable: false, text: expect.stringContaining("超過 7 天") });
    });

    it("已知適用期間的班表依期間使用，狀態讀取所選版本的取得時間", () => {
        const snapshot: MetroSnapshot = {
            ...version(), generatedAt: "2026-09-01T00:00:00Z", validity: { from: "2026-09-01", through: "2026-09-21" },
            future: [{ ...version("09:20"), validity: { from: today, through: "2026-10-31" } }],
        };
        expect(metroHealth(snapshot, today, now)).toMatchObject({ usable: true, warning: false });
        expect(metroHealth(snapshot, "2026-10-19", new Date("2026-10-19T12:00:00+08:00"))).toMatchObject({ usable: true, warning: true });
    });

    it("每班終點優先於整列終點，並仍受方向與停靠模式限制", () => {
        const snapshot = version();
        snapshot.timetables[0].DestinationStaionID = "A13";
        snapshot.timetables[0].Timetables[0].DestinationStationID = "A1";
        expect(departures(snapshot, today)).toEqual([at(today, "09:10")]);
        snapshot.timetables[0].Timetables[0].DestinationStationID = "A13";
        expect(departures(snapshot, today)).toEqual([]);
        snapshot.timetables[0].Timetables[0].DestinationStationID = "A1";
        snapshot.timetables[0].Direction = 0;
        expect(departures(snapshot, today)).toEqual([]);
        snapshot.timetables[0].Direction = 1;
        snapshot.patterns[0].Stations = snapshot.patterns[0].Stations.filter(station => station.StationID !== "A18");
        expect(departures(snapshot, today)).toEqual([]);
    });

    it("已核實的個別班次使用專屬旅行時間與名稱，其餘班次維持來源車種時間", () => {
        const snapshot = version();
        const departure = snapshot.timetables[0].Timetables[0];
        departure.RunTimeByDestination = { A12: 900 };
        departure.ServiceName = "機捷普通車（跳站）";
        const legs = metroLegs(snapshot, "tymc:A18", "tymc:A12", today, "all");
        expect(legs.find(leg => leg.departure === at(today, "09:10"))).toMatchObject({ arrival: at(today, "09:25"), service: "機捷普通車（跳站）", estimatedArrival: true });
        expect(legs.find(leg => leg.departure === at(today, "00:10"))).toMatchObject({ arrival: at(today, "00:30"), service: "機捷普通車" });
        departure.RunTimeByDestination.A12 = -1;
        expect(departures(snapshot, today)).toEqual([at(today, "00:10")]);
    });
});

describe("機捷版本資料載入", () => {
    it("快取保留完整版本，切換查詢日期仍能選到正確版本", async () => {
        const snapshot: MetroSnapshot = { ...version(), future: [{ ...version("09:20"), validity: { from: "2026-09-23", through: "2026-10-31" } }] };
        const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshot)));
        vi.stubGlobal("fetch", fetcher);
        expect(await loadMetro(today, true)).toEqual(snapshot);
        const later = await loadMetro("2026-09-23");
        expect(later && metroSnapshotForDate(later, "2026-09-23")).toEqual(snapshot.future![0]);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("拒絕無效日期、沒有適用期間的未來版，以及巢狀未來版", async () => {
        const malformed = [
            { ...version(), validity: { from: "2026-02-30", through: "2026-03-31" } },
            { ...version(), future: [version()] },
            { ...version(), future: [{ ...version(), validity: { from: today, through: "2026-09-30" }, future: [] }] },
        ];
        for (const snapshot of malformed) {
            vi.stubGlobal("fetch", async () => new Response(JSON.stringify(snapshot)));
            expect(await loadMetro(today, true)).toBeUndefined();
        }
    });
});
