import { expect, it } from "vitest";
import { endpointConnection } from "../src/domain/endpoint-connection";
import { planJourneys } from "../src/domain/planner";
import type { Train } from "../src/domain/types";
const date = "2026-10-20";
const train = (id: string, reserved: boolean, stops: [string, string][]): Train => ({ id, number: id, operator: "tra", service: reserved ? "自強" : "區間", reserved,
    stops: stops.map(([station, time]) => ({ station, arrival: Date.parse(`${date}T${time}:00+08:00`), departure: Date.parse(`${date}T${time}:00+08:00`) })) });

it("保安去程可對號轉區間，不能用長途區間車取代幹線", () => {
    const trains = [
        train("branch", false, [["tra:1208", "08:00"], ["tra:1210", "09:00"]]),
        train("reserved", true, [["tra:1210", "09:10"], ["tra:4220", "12:00"]]),
        train("connector", false, [["tra:4220", "12:10"], ["tra:4250", "12:15"]]),
        train("long-local", false, [["tra:1210", "09:05"], ["tra:4220", "11:40"], ["tra:4250", "11:45"]]),
    ];
    expect(endpointConnection(trains, "tra:1208", "tra:4250")?.gateway).toBe("tra:4220");
    const result = planJourneys(trains, "tra:1208", "tra:4250", date, { reservedOnly: true });
    expect(result.map(j => j.legs.map(l => l.trip))).toEqual([["branch", "reserved", "connector"]]);
    expect(planJourneys(trains, "tra:1208", "tra:4250", date, { reservedOnly: true, traMaxMinutes: 9 })).toEqual([]);
});

it("小站回程在接駁站改搭對號，即使區間車可繼續到新竹也保留", () => {
    const trains = [
        train("connector", false, [["tra:4250", "08:00"], ["tra:4220", "08:05"], ["tra:1210", "12:00"]]),
        train("reserved", true, [["tra:4220", "08:15"], ["tra:1210", "11:00"]]),
        train("branch", false, [["tra:1210", "11:10"], ["tra:1208", "12:00"]]),
    ];
    expect(planJourneys(trains, "tra:4250", "tra:1208", date, { reservedOnly: true }).map(j => j.legs.map(l => l.trip))).toEqual([["connector", "reserved", "branch"]]);
});

it("集集線去回程保留二水接駁，且限制轉乘上下限", () => {
    const outgoing = [
        train("branch", false, [["tra:1208", "08:00"], ["tra:1210", "09:00"]]),
        train("reserved", true, [["tra:1210", "09:10"], ["tra:3430", "11:00"]]),
        train("jiji", false, [["tra:3430", "11:10"], ["tra:3431", "11:15"], ["tra:3432", "11:20"], ["tra:3433", "11:25"], ["tra:3434", "11:30"]]),
    ];
    expect(planJourneys(outgoing, "tra:1208", "tra:3434", date, { reservedOnly: true }).map(j => j.legs.map(l => l.trip))).toEqual([["branch", "reserved", "jiji"]]);
    const incoming = [
        train("jiji", false, [["tra:3434", "08:00"], ["tra:3433", "08:05"], ["tra:3432", "08:10"], ["tra:3431", "08:15"], ["tra:3430", "08:20"]]),
        train("reserved", true, [["tra:3430", "08:30"], ["tra:1210", "10:00"]]),
        train("branch", false, [["tra:1210", "10:10"], ["tra:1208", "11:00"]]),
    ];
    expect(planJourneys(incoming, "tra:3434", "tra:1208", date, { reservedOnly: true }).map(j => j.legs.map(l => l.trip))).toEqual([["jiji", "reserved", "branch"]]);
    expect(planJourneys(incoming, "tra:3434", "tra:1208", date, { reservedOnly: true, traMinMinutes: 11 })).toEqual([]);
});

it("接駁站按列車方向判斷，不能用反向對號停靠擋住支線接駁", () => {
    const trains = [
        train("opposite", true, [["tra:7350", "08:00"], ["tra:1210", "10:00"]]),
        train("outgoing", true, [["tra:1210", "08:00"], ["tra:7360", "10:00"]]),
    ];
    expect(endpointConnection(trains, "tra:1208", "tra:7335")?.gateway).toBe("tra:7360");
    expect(endpointConnection(trains, "tra:7335", "tra:1208")?.gateway).toBe("tra:7350");
});

it("小站鄰近新竹時允許區間接駁，已停靠對號的端點則維持原限制", () => {
    const trains = [train("branch", false, [["tra:1208", "08:00"], ["tra:1210", "09:00"]]), train("local", false, [["tra:1210", "09:10"], ["tra:1220", "09:15"], ["tra:1230", "09:20"]])];
    expect(planJourneys(trains, "tra:1208", "tra:1230", date, { reservedOnly: true }).map(j => j.legs.map(l => l.trip))).toEqual([["branch", "local"]]);
    const reserved = train("reserved", true, [["tra:1210", "09:10"], ["tra:1230", "09:30"]]);
    expect(endpointConnection([...trains, reserved], "tra:1208", "tra:1230")).toBeUndefined();
    expect(planJourneys([...trains, reserved], "tra:1208", "tra:1230", date, { reservedOnly: true }).map(j => j.legs.map(l => l.trip))).toEqual([["branch", "reserved"]]);
});


it("不先搭區間車前進再換上原站可搭的同一班對號，避免拆短等待", () => {
    const trains = [
        train("branch", false, [["tra:1208", "07:47"], ["tra:1210", "08:55"]]),
        train("local", false, [["tra:1210", "09:07"], ["tra:1250", "09:26"]]),
        train("reserved", true, [["tra:1210", "09:26"], ["tra:1250", "09:42"], ["tra:4220", "12:28"]]),
        train("connector", false, [["tra:4220", "12:43"], ["tra:4250", "12:49"]]),
    ];
    expect(planJourneys(trains, "tra:1208", "tra:4250", date)).toEqual([]);
    // When waiting at Hsinchu is allowed, board the reserved train there directly.
    const relaxed = planJourneys(trains, "tra:1208", "tra:4250", date, { traMaxMinutes: 31 });
    expect(relaxed.map(j => j.legs.map(l => l.trip))).toEqual([["branch", "reserved", "connector"]]);
});

it("對號車未停區間車起站，或已在起站開走時，保留必要的區間接駁", () => {
    const feeder = train("feeder", false, [["tra:1208", "08:00"], ["tra:1210", "09:00"]]);
    const local = train("local", false, [["tra:1210", "09:05"], ["tra:1250", "09:25"]]);
    const express = train("reserved", true, [["tra:1250", "09:35"], ["tra:4220", "12:00"]]);
    const connector = train("connector", false, [["tra:4220", "12:10"], ["tra:4250", "12:15"]]);
    expect(planJourneys([feeder, local, express, connector], "tra:1208", "tra:4250", date).map(j => j.legs.map(l => l.trip))).toEqual([["feeder", "local", "reserved", "connector"]]);
    const slow = train("slow-reserved", true, [["tra:1210", "08:55"], ["tra:1250", "09:35"], ["tra:4220", "12:00"]]);
    expect(planJourneys([feeder, local, slow, connector], "tra:1208", "tra:4250", date).map(j => j.legs.map(l => l.trip))).toEqual([["feeder", "local", "slow-reserved", "connector"]]);
});
