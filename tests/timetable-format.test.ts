import { expect, it } from "vitest";
import { localTrains, packTimetable, timetableGroups, unpackTimetable } from "../src/domain/timetable-format";
import type { Train } from "../src/domain/types";

const date = "2026-09-25";
const at = (time: string) => Date.parse(`${date}T${time}+08:00`);
const train: Train = {
    id: `tra:${date}:42`, number: "42", operator: "tra", service: "自強號", trainTypeId: "110G",
    trainType: "自強(3000)(EMU3000 型電車)", reserved: true,
    stops: [
        { station: "tra:1210", arrival: at("23:58:30"), departure: at("23:59:30.125") },
        { station: "tra:1190", arrival: at("23:59:59") + 60000, departure: at("23:59:59") + 90000 },
    ],
};
it("壓縮再還原保留跨日、秒數、車種、無售站票判斷所需資料與自訂 ID", () => {
    const unknown = { ...train, id: "test-only", number: "T", reserved: undefined, trainType: undefined, trainTypeId: undefined };
    const packed = JSON.parse(JSON.stringify(packTimetable(date, "tra", [train, unknown])));
    expect(unpackTimetable(packed, date, "tra")).toEqual([train, unknown]);
    expect(() => unpackTimetable(packed, "2026-09-26", "tra")).toThrow();
    expect(() => unpackTimetable(packed, date, "thsr")).toThrow();
    packed.trains[0][2][0] = 999;
    expect(() => unpackTimetable(packed, date, "tra")).toThrow();
});
it("只為幹線目的地載入全台台鐵；新竹高鐵步行不載入高鐵列車", () => {
    expect(timetableGroups("tra:1208", "tra:1210")).toEqual(["local"]);
    expect(timetableGroups("tra:1020", "tra:1208")).toEqual(["tra"]);
    expect(timetableGroups("tra:1208", "thsr:1030")).toEqual(["local"]);
    expect(timetableGroups("thsr:1000", "tra:1208")).toEqual(["local", "thsr"]);
    expect(timetableGroups("tra:1208", "tymc:A12")).toEqual(["local", "thsr"]);
});
it("周邊班表裁掉路線外起訖站，但保留區間內的每個停靠站", () => {
    const stops = ["tra:1000", "tra:1190", "tra:9999", "tra:1210", "tra:1240"].map((station, i) => ({ station, arrival: i, departure: i }));
    expect(localTrains([{ ...train, stops }])[0].stops).toEqual(stops.slice(1, 4));
    expect(localTrains([{ ...train, stops: stops.slice(3) }])).toEqual([]);
});
