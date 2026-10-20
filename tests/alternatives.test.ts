import { expect, it } from "vitest";
import { findAlternativeTrains, withSelectedLegs } from "../src/domain/alternatives";
import type { Journey, Leg, Train } from "../src/domain/types";
const at = (time: string) => Date.parse(`2026-10-20T${time}:00+08:00`);
const leg = (trip: string, departure: string, arrival: string, origin = "A", destination = "B"): Leg => ({ trip, number: trip, operator: "tra", reserved: true, service: "自強", origin, destination, departure: at(departure), arrival: at(arrival) });
const train = (id: string, departure: string, arrival: string): Train => ({ id, number: id, operator: "tra", reserved: true, service: "自強", stops: [{ station: "A", arrival: at(departure), departure: at(departure) }, { station: "B", arrival: at(arrival), departure: at(arrival) }] });
const journey: Journey = { id: "j", departure: at("08:00"), arrival: at("12:00"), legs: [leg("before", "08:00", "09:00", "X", "A"), leg("original", "10:00", "11:00"), leg("after", "11:30", "12:00", "B", "Y")] };
it("排除其他組合車次後，保留超出轉乘上下限的班次並依接近原班次排序", () => {
    const trains = [train("earliest", "09:01", "10:01"), train("earlier", "09:30", "10:30"), train("used", "09:40", "10:40"), train("later", "10:20", "11:20"), train("original", "10:00", "11:00")];
    const result = findAlternativeTrains(trains, journey, 1, new Set(["used"]));
    expect(result.earlier.map(item => item.trip)).toEqual(["earlier", "earliest"]);
    expect(result.later.map(item => item.trip)).toEqual(["later"]);
});
it("排除前後段時間重疊、非對號、反方向與跨上車日的班次", () => {
    const nonReserved = { ...train("local", "09:30", "10:30"), reserved: false };
    const reverse = train("reverse", "09:30", "10:30");
    reverse.stops.reverse();
    const nextDay = train("tomorrow", "09:30", "10:30");
    nextDay.stops.forEach(stop => { stop.arrival += 86400000; stop.departure += 86400000; });
    expect(findAlternativeTrains([train("tooEarly", "08:59", "10:00"), train("tooLate", "10:30", "11:31"), nonReserved, reverse, nextDay], journey, 1, new Set())).toEqual({ earlier: [], later: [] });
});
it("高鐵雙向皆能查看，同車號不同日期以實際 trip 辨識", () => {
    const original = { ...leg("hsr", "10:00", "11:00"), operator: "thsr" as const };
    const direct = { ...journey, legs: [original] };
    const earlier = { ...train("today:123", "09:30", "10:30"), operator: "thsr" as const, number: "123", reserved: undefined };
    expect(findAlternativeTrains([earlier], direct, 0, new Set(["yesterday:123"])).earlier[0]?.trip).toBe("today:123");
    expect(findAlternativeTrains([earlier], { ...direct, legs: [{ ...original, reserved: false, operator: "tra" }] }, 0, new Set())).toEqual({ earlier: [], later: [] });
});

it("替換中段重算轉乘時間，替換首末段更新整組到發並保留原組合", () => {
    const selected = leg("chosen", "09:30", "10:30");
    const updated = withSelectedLegs(journey, new Map([[1, selected]]));
    expect((updated.legs[1].departure - updated.legs[0].arrival) / 60000).toBe(30);
    expect((updated.legs[2].departure - updated.legs[1].arrival) / 60000).toBe(60);
    expect(journey.legs[1].trip).toBe("original");
    const endpoints = withSelectedLegs(journey, new Map([[0, leg("first", "07:00", "08:30", "X", "A")], [2, leg("last", "11:45", "12:30", "B", "Y")]]));
    expect(endpoints.departure).toBe(at("07:00"));
    expect(endpoints.arrival).toBe(at("12:30"));
    expect(withSelectedLegs(journey, new Map())).toBe(journey);
});
it("替換步行接駁旁的班次仍保留步行時間", () => {
    const base: Journey = { id: "walk", departure: at("09:50"), arrival: at("11:00"), legs: [leg("best", "10:00", "11:00")], accessWalk: { origin: "X", destination: "A", departure: at("09:50"), arrival: at("10:00"), position: "start" } };
    const updated = withSelectedLegs(base, new Map([[0, leg("earlier", "09:30", "10:30")]]));
    expect(updated.departure).toBe(at("09:20"));
    expect(updated.accessWalk?.arrival).toBe(at("09:30"));
    const end = withSelectedLegs({ ...base, accessWalk: { ...base.accessWalk!, position: "end", departure: at("11:00"), arrival: at("11:10") } }, new Map([[0, leg("later", "10:30", "11:30")]]));
    expect(end.arrival).toBe(at("11:40"));
});

it("機捷前後班次排除已使用與無法銜接者，保留預估抵達及車種", () => {
    const metro = (trip: string, departure: string, arrival: string, service = "機捷普通車"): Leg => ({ ...leg(trip, departure, arrival, "tymc:A18", "tymc:A12"), operator: "tymc", number: "", service, estimatedArrival: true });
    const best = metro("best", "10:00", "10:30");
    const feeder = { ...leg("hsr", "08:00", "09:00", "thsr:1030", "thsr:1020"), operator: "thsr" as const };
    const outgoing: Journey = { id: "metro", departure: feeder.departure, arrival: best.arrival, legs: [feeder, best] };
    const result = findAlternativeTrains([], outgoing, 1, new Set(["used"]), [metro("early", "09:05", "09:35"), best, metro("used", "09:40", "10:10"), metro("overlap", "08:59", "09:29"), metro("late", "11:00", "11:20", "機捷直達車")]);
    expect(result.earlier.map(item => item.trip)).toEqual(["early"]);
    expect(result.later).toMatchObject([{ trip: "late", number: "", service: "機捷直達車", estimatedArrival: true }]);
    const updated = withSelectedLegs(outgoing, new Map([[1, result.later[0]]]));
    expect(updated.arrival).toBe(at("11:20"));
    expect((updated.legs[1].departure - feeder.arrival) / 60000).toBe(120);
});

it("機捷回程僅保留可接上高鐵的相同區間班次，變更後更新起程時間", () => {
    const metro = (trip: string, departure: string, arrival: string): Leg => ({ ...leg(trip, departure, arrival, "tymc:A12", "tymc:A18"), operator: "tymc", number: "", estimatedArrival: true });
    const best = metro("best", "09:00", "09:30");
    const next = { ...leg("hsr", "10:00", "10:30", "thsr:1020", "thsr:1030"), operator: "thsr" as const };
    const returning: Journey = { id: "return", departure: best.departure, arrival: next.arrival, legs: [best, next] };
    const wrongDirection = { ...metro("wrong", "08:30", "09:00"), origin: "tymc:A18", destination: "tymc:A12" };
    const tomorrow = metro("tomorrow", "08:30", "09:00");
    tomorrow.departure += 86400000;
    tomorrow.arrival += 86400000;
    const result = findAlternativeTrains([], returning, 0, new Set(), [metro("early", "08:00", "08:30"), metro("late", "09:20", "09:50"), metro("overlap", "09:40", "10:10"), wrongDirection, tomorrow]);
    expect(result.earlier.map(item => item.trip)).toEqual(["early"]);
    expect(result.later.map(item => item.trip)).toEqual(["late"]);
    expect(withSelectedLegs(returning, new Map([[0, result.earlier[0]]])).departure).toBe(at("08:00"));
});
