import { expect, it } from "vitest";
import { normalizeTdx } from "../scripts/normalize";

it("完整車次跨午夜時正確延續日期，不把終點站當成另一班車", () => {
    const trains = normalizeTdx({ TrainDate: "2026-09-21", TrainTimetables: [{
        TrainInfo: { TrainNo: "TEST-1", TrainTypeName: { Zh_tw: "區間" } },
        StopTimes: [
            { StationID: "A", StopSequence: 1, ArrivalTime: "23:50", DepartureTime: "23:50" },
            { StationID: "B", StopSequence: 2, ArrivalTime: "23:59", DepartureTime: "00:01" },
            { StationID: "C", StopSequence: 3, ArrivalTime: "00:15", DepartureTime: "00:15" },
        ],
    }] }, "tra", "2026-09-21");
    expect(trains).toHaveLength(1);
    expect(trains[0].stops.map(s => [s.station, new Date(s.arrival).toISOString(), new Date(s.departure).toISOString()])).toEqual([
        ["tra:A", "2026-09-21T15:50:00.000Z", "2026-09-21T15:50:00.000Z"],
        ["tra:B", "2026-09-21T15:59:00.000Z", "2026-09-21T16:01:00.000Z"],
        ["tra:C", "2026-09-21T16:15:00.000Z", "2026-09-21T16:15:00.000Z"],
    ]);
});
it("拒絕日期不符與格式錯誤，不把上游故障當作零班次", () => {
    expect(() => normalizeTdx({ TrainDate: "2026-09-20", TrainTimetables: [] }, "tra", "2026-09-21")).toThrow("日期");
    expect(() => normalizeTdx({ error: "quota" }, "thsr", "2026-09-21")).toThrow("格式");
});
it("台鐵官方逐日原始班表保留跨日車次與來源日期", async () => {
    const { normalizeOds } = await import("../scripts/normalize");
    const result = normalizeOds({ TrainInfos: [{ Train: "TEST-ODS", CarClass: "1131", TimeInfos: [
        { Station: "1208", Order: "1", ARRTime: "23:50:00", DEPTime: "23:50:00" },
        { Station: "1210", Order: "2", ARRTime: "00:20:00", DEPTime: "00:20:00" },
    ] }] }, "2026-09-21");
    expect(result[0].id).toBe("tra:2026-09-21:TEST-ODS");
    expect(result[0].stops[1].arrival).toBe(Date.parse("2026-09-22T00:20:00+08:00"));
});
it("保留官方對號車種，區間與未知車種不誤判為對號列車", async () => {
    const { normalizeOds } = await import("../scripts/normalize");
    const TimeInfos = [{ Station: "1210", Order: "1", ARRTime: "08:00:00", DEPTime: "08:00:00" }, { Station: "1000", Order: "2", ARRTime: "09:00:00", DEPTime: "09:00:00" }];
    const result = normalizeOds({ TrainInfos: ["110G", "1110", "1131", "1132", "1150", "UNKNOWN"].map((CarClass, i) => ({ Train: `TEST-${i}`, CarClass, TimeInfos })) }, "2026-09-21");
    expect(result.map(t => t.reserved)).toEqual([true, true, false, false, false, false]);
});
