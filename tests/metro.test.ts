import { expect, it } from "vitest";
import { metroLegs, connectMetro, type MetroSnapshot } from "../src/domain/metro";
import { planAirportJourneys } from "../src/domain/airport-planner";
import { loadFilters, saveFilters, filterAvailability } from "../src/filters";
import type { Train } from "../src/domain/types";
const date = "2026-09-22";
const at = (time: string) => Date.parse(`${date}T${time}:00+08:00`);
const services = { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true, Saturday: false, Sunday: false, NationalHolidays: false };
const snapshot: MetroSnapshot = {
    generatedAt: `${date}T04:30:00+08:00`,
    timetables: [
        { StationID: "A18", Direction: 1, DestinationStaionID: "A1", ServiceDay: services, Timetables: [
            { DepartureTime: "09:10", TrainType: 1, StoppingPatternID: "SP1" },
            { DepartureTime: "09:12", TrainType: 2, StoppingPatternID: "SP5" },
            { DepartureTime: "09:15", TrainType: 2, StoppingPatternID: "SP2" },
        ] },
        { StationID: "A12", Direction: 0, DestinationStaionID: "A22", ServiceDay: services, Timetables: [{ DepartureTime: "08:00", TrainType: 1, StoppingPatternID: "SP1" }] },
    ],
    patterns: [
        { StoppingPatternID: "SP1", Stations: ["A1", "A12", "A13", "A18", "A22"].map((StationID, Sequence) => ({ StationID, Sequence })) },
        { StoppingPatternID: "SP5", Stations: ["A1", "A12", "A13", "A18"].map((StationID, Sequence) => ({ StationID, Sequence })) },
        { StoppingPatternID: "SP2", Stations: ["A1", "A12", "A13"].map((StationID, Sequence) => ({ StationID, Sequence })) },
    ],
    travelTimes: [
        { TrainType: 1, TravelTimes: [{ FromStationID: "A18", ToStationID: "A12", RunTime: 1200 }, { FromStationID: "A12", ToStationID: "A18", RunTime: 1200 }] },
        { TrainType: 2, TravelTimes: [{ FromStationID: "A18", ToStationID: "A12", RunTime: 900 }] },
    ],
};
it("機捷車種依停靠模式篩選，不誤列未停 A18 的直達車，抵達標示預估", () => {
    const local = metroLegs(snapshot, "tymc:A18", "tymc:A12", date, "local").filter(l => l.departure < at("23:59"));
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ departure: at("09:10"), arrival: at("09:30"), estimatedArrival: true, number: "" });
    const express = metroLegs(snapshot, "tymc:A18", "tymc:A12", date, "express").filter(l => l.departure < at("23:59"));
    expect(express.map(l => l.departure)).toEqual([at("09:12")]);
    expect(metroLegs(snapshot, "tymc:A18", "tymc:A22", date, "express")).toEqual([]);
});
it("平日遇國定假日採假日班表，未知年度不猜測", () => {
    const holiday = structuredClone(snapshot);
    holiday.timetables = [{ ...holiday.timetables[0], ServiceDay: { ...services, NationalHolidays: true } }];
    expect(metroLegs(snapshot, "tymc:A18", "tymc:A12", "2026-09-25", "local").filter(l => l.departure >= Date.parse("2026-09-25T04:00+08:00") && l.departure < Date.parse("2026-09-26T04:00+08:00"))).toHaveLength(0);
    expect(metroLegs(holiday, "tymc:A18", "tymc:A12", "2026-09-25", "local")).not.toHaveLength(0);
    expect(metroLegs(snapshot, "tymc:A18", "tymc:A12", "2030-01-01", "all")).toEqual([]);
});
const train = (id: string, operator: "tra" | "thsr", stops: [string, string][]): Train => ({ id, number: id, operator, service: id, stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })) });
it("機捷去回程必經竹中、六家、高鐵新竹及桃園，A18 本身只需步行", () => {
    const outgoing = [train("N", "tra", [["tra:1208", "07:30"], ["tra:1193", "08:00"]]), train("L", "tra", [["tra:1193", "08:05"], ["tra:1194", "08:10"]]), train("H", "thsr", [["thsr:1030", "08:25"], ["thsr:1020", "09:00"]])];
    const journeys = planAirportJourneys(outgoing, "tra:1208", "tymc:A12", date, {}, snapshot);
    expect(journeys).toHaveLength(2);
    expect(planAirportJourneys(outgoing, "tra:1208", "tymc:A12", date, { thsrMaxMinutes: 40, metroMaxMinutes: 11 }, snapshot)).toHaveLength(1);
    expect(planAirportJourneys(outgoing, "tra:1208", "tymc:A12", date, { thsrMaxMinutes: 40, metroMaxMinutes: 12 }, snapshot)).toHaveLength(2);
    expect(planAirportJourneys(outgoing, "tra:1208", "tymc:A12", date, { thsrMaxMinutes: 40, metroMaxMinutes: 13 }, snapshot)).toHaveLength(2);
    expect(journeys[0].legs.map(l => l.operator)).toEqual(["tra", "tra", "thsr", "tymc"]);
    expect(planAirportJourneys(outgoing, "tra:1208", "tymc:A18", date, {}, snapshot)[0]).toMatchObject({ arrival: at("09:10"), accessWalk: { destination: "tymc:A18" } });
    const returning = [train("H", "thsr", [["thsr:1020", "08:30"], ["thsr:1030", "09:00"]]), train("L", "tra", [["tra:1194", "09:10"], ["tra:1193", "09:15"]]), train("N", "tra", [["tra:1193", "09:20"], ["tra:1208", "10:00"]])];
    expect(planAirportJourneys(returning, "tymc:A12", "tra:1208", date, {}, snapshot)[0]).toMatchObject({ departure: at("08:00"), arrival: at("10:00") });
});
it("機捷轉乘使用設定範圍且包含上下限，儲存車種不影響其他運具", () => {
    const leg = metroLegs(snapshot, "tymc:A18", "tymc:A12", date, "local")[0];
    const rail = { id: "r", departure: at("07:00"), arrival: at("09:00"), legs: [] };
    expect(connectMetro([rail], [leg], false, date, 9)).toHaveLength(0);
    expect(connectMetro([rail], [leg], false, date, 10)).toHaveLength(1);
    expect(connectMetro([{ ...rail, arrival: at("09:01") }], [leg], false, date, 40)).toHaveLength(0);
    expect(filterAvailability("tra:1208", "tymc:A12")).toEqual({ reserved: false, direct: false });
    let saved = "";
    const storage = { removeItem: () => { saved = ""; }, getItem: () => saved, setItem: (_: string, value: string) => { saved = value; } };
    storage.setItem("neiwan.filters.v1", JSON.stringify({ reservedOnly: true, directOutbound: true, directReturn: true, metroService: "express" }));
    expect(loadFilters(storage)).toEqual({ reservedOnly: true, directOutbound: true, directReturn: true });
});
it("午夜班次屬前一營運日，且不得越過該班終點", () => {
    const night = structuredClone(snapshot);
    night.timetables = [{ ...night.timetables[0], Timetables: [{ DepartureTime: "00:10", TrainType: 1, StoppingPatternID: "SP1" }] }];
    expect(metroLegs(night, "tymc:A18", "tymc:A12", date, "local")[0].departure).toBe(at("00:10"));
    night.timetables[0].DestinationStaionID = "A13";
    expect(metroLegs(night, "tymc:A18", "tymc:A12", date, "local")).toEqual([]);
});


it("機捷精簡資料保留所有經 A18 的雙向班次與抵達時間", async () => {
    const { projectMetro } = await import("../scripts/project-metro");
    const compact = projectMetro(snapshot);
    for (const station of ["A1", "A12", "A13", "A18", "A22"]) {
        for (const [origin, destination] of [["tymc:A18", `tymc:${station}`], [`tymc:${station}`, "tymc:A18"]]) {
            expect(metroLegs(compact, origin, destination, date, "all")).toEqual(metroLegs(snapshot, origin, destination, date, "all"));
        }
    }
});


it("機捷雙向使用自訂下限，包括剛好等於上下限的間隔", () => {
    const leg = metroLegs(snapshot, "tymc:A18", "tymc:A12", date, "local")[0];
    const rail = { id: "r", departure: at("07:00"), arrival: at("09:00"), legs: [] };
    expect(connectMetro([rail], [leg], false, date, 10, 10)).toHaveLength(1);
    expect(connectMetro([rail], [leg], false, date, 40, 11)).toHaveLength(0);
    const reverseRail = { ...rail, departure: leg.arrival + 15 * 60000, arrival: leg.arrival + 60 * 60000 };
    expect(connectMetro([reverseRail], [leg], true, date, 15, 15)).toHaveLength(1);
    expect(connectMetro([reverseRail], [leg], true, date, 40, 16)).toHaveLength(0);
});
