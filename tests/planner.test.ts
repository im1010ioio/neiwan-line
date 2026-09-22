import { expect, it } from "vitest";
import { planJourneys } from "../src/domain/planner";
import type { Train } from "../src/domain/types";
const at = (time: string) => Date.parse(`2026-09-21T${time}:00+08:00`);
export function train(id: string, stops: [string, string][], operator: "tra" | "thsr" = "tra"): Train {
    return { id, number: id, operator, service: "測試班表", stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })) };
}
it("同車續搭不算換車，五分鐘可換車、二十分鐘不可", () => {
    const trains = [
        train("through", [["tra:1208", "08:00"], ["tra:1193", "08:20"], ["tra:1210", "08:40"]]),
        train("branch", [["tra:1208", "09:00"], ["tra:1193", "09:20"]]),
        train("ok", [["tra:1193", "09:25"], ["tra:1210", "09:40"]]),
        train("late", [["tra:1193", "09:40"], ["tra:1210", "09:55"]]),
    ];
    const result = planJourneys(trains, "tra:1208", "tra:1210", "2026-09-21");
    expect(result.map(j => j.legs.map(l => l.number))).toEqual([["through"], ["branch", "ok"]]);
});
it("六家高鐵接駁十分钟可搭、四十分鐘不可，且台鐵目的地不混入高鐵", () => {
    const trains = [
        train("branch", [["tra:1208", "08:00"], ["tra:1193", "08:20"]]),
        train("shuttle", [["tra:1193", "08:25"], ["tra:1194", "08:30"]]),
        train("hsr-ok", [["thsr:1030", "08:40"], ["thsr:1000", "09:15"]], "thsr"),
        train("hsr-late", [["thsr:1030", "09:10"], ["thsr:1000", "09:45"]], "thsr"),
    ];
    expect(planJourneys(trains, "tra:1208", "thsr:1000", "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([["branch", "shuttle", "hsr-ok"]]);
    expect(planJourneys(trains, "tra:1208", "tra:1000", "2026-09-21")).toEqual([]);
});
it("反向高鐵接駁同樣適用，抵达高鐵新竹可以步行結束", () => {
    const reverse = [train("H", [["thsr:1000", "08:00"], ["thsr:1030", "08:30"]], "thsr"), train("S", [["tra:1194", "08:40"], ["tra:1193", "08:45"]]), train("N", [["tra:1193", "08:50"], ["tra:1208", "09:20"]])];
    expect(planJourneys(reverse, "thsr:1000", "tra:1208", "2026-09-21")).toHaveLength(1);
    const outward = [train("L", [["tra:1208", "08:00"], ["tra:1194", "08:30"]])];
    expect(planJourneys(outward, "tra:1208", "thsr:1030", "2026-09-21")[0]?.arrival).toBe(at("08:40"));
});
it("排除更早出發、抵達更晚且轉乘更多的繞路組合", () => {
    const trains = [train("detour1", [["tra:A", "07:00"], ["tra:B", "07:40"]]), train("detour2", [["tra:B", "07:45"], ["tra:C", "09:00"]]), train("direct", [["tra:A", "08:00"], ["tra:C", "08:30"]])];
    expect(planJourneys(trains, "tra:A", "tra:C", "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([["direct"]]);
});
it("保留午夜後的當次銜接，不把隔天發車或隔天早班算進來", () => {
    const first = train("night", [["tra:A", "23:35"], ["tra:B", "23:55"]]);
    const afterMidnight = train("next", [["tra:B", "00:05"], ["tra:C", "00:30"]]);
    const morning = train("morning", [["tra:B", "05:00"], ["tra:C", "05:30"]]);
    for (const t of [afterMidnight, morning]) for (const stop of t.stops) { stop.arrival += 86400000; stop.departure += 86400000; }
    const result = planJourneys([first, afterMidnight, morning], "tra:A", "tra:C", "2026-09-21");
    expect(result).toHaveLength(1);
    expect(result[0].arrival).toBe(Date.parse("2026-09-22T00:30:00+08:00"));
    expect(planJourneys([afterMidnight], "tra:B", "tra:C", "2026-09-21")).toEqual([]);
});
it("不足最短轉乘時間不能搭乘，高鐵新竹出發包含步行時間", () => {
    const fast = [train("a", [["tra:A", "08:00"], ["tra:B", "08:10"]]), train("b", [["tra:B", "08:14"], ["tra:C", "08:30"]])];
    expect(planJourneys(fast, "tra:A", "tra:C", "2026-09-21")).toEqual([]);
    const shuttle = train("walk", [["tra:1194", "08:10"], ["tra:1208", "09:00"]]);
    expect(planJourneys([shuttle], "thsr:1030", "tra:1208", "2026-09-21")[0].departure).toBe(at("08:00"));
});
it("直達較快時仍保留竹中轉乘，去回程均適用", () => {
    const outbound = [
        train("branch", [["tra:1208", "08:00"], ["tra:1193", "08:30"]]),
        train("connection", [["tra:1193", "08:40"], ["tra:1210", "09:00"]]),
        train("direct", [["tra:1208", "08:05"], ["tra:1210", "08:55"]]),
    ];
    expect(planJourneys(outbound, "tra:1208", "tra:1210", "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([["branch", "connection"], ["direct"]]);
    const reverse = [
        train("shuttle", [["tra:1210", "08:00"], ["tra:1193", "08:20"]]),
        train("neiwan", [["tra:1193", "08:25"], ["tra:1208", "09:00"]]),
        train("direct", [["tra:1210", "08:05"], ["tra:1208", "08:55"]]),
    ];
    expect(planJourneys(reverse, "tra:1210", "tra:1208", "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([["shuttle", "neiwan"], ["direct"]]);
});
it("竹中換車後接上同一班台鐵或高鐵時仍保留不同接駁組合", () => {
    for (const highSpeed of [false, true]) {
        const hub = highSpeed ? "tra:1194" : "tra:1210";
        const final = highSpeed ? "thsr:1000" : "tra:1000";
        const trains = [
            train("through", [["tra:1208", "08:00"], ["tra:1193", "08:20"], [hub, "08:45"]]),
            train("shuttle", [["tra:1193", "08:25"], [hub, "08:40"]]),
            train("onward", [[highSpeed ? "thsr:1030" : hub, "08:55"], [final, "09:30"]], highSpeed ? "thsr" : "tra"),
        ];
        expect(planJourneys(trains, "tra:1208", final, "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([
            ["through", "onward"], ["through", "shuttle", "onward"],
        ]);
    }
});
it("對號篩選保留內灣線區間接駁，只限制幹線，並在比較行程前套用", () => {
    const branch = train("branch", [["tra:1208", "08:00"], ["tra:1210", "08:50"]]);
    const local = train("local", [["tra:1210", "08:55"], ["tra:1000", "09:30"]]);
    const reserved = { ...train("reserved", [["tra:1210", "08:55"], ["tra:1000", "09:40"]]), reserved: true };
    expect(planJourneys([branch, local, reserved], "tra:1208", "tra:1000", "2026-09-21", { reservedOnly: true }).map(j => j.legs.map(l => l.number))).toEqual([["branch", "reserved"]]);
    const returning = [{ ...train("reserved-back", [["tra:1000", "08:00"], ["tra:1210", "09:00"]]), reserved: true }, train("local-back", [["tra:1000", "08:05"], ["tra:1210", "09:00"]]), train("branch-back", [["tra:1210", "09:05"], ["tra:1208", "10:00"]])];
    expect(planJourneys(returning, "tra:1000", "tra:1208", "2026-09-21", { reservedOnly: true }).map(j => j.legs.map(l => l.number))).toEqual([["reserved-back", "branch-back"]]);
});
it("自訂台鐵與高鐵上限採嚴格小於，超過原本 40 分鐘的接駁也能保留", () => {
    const tra = [train("a", [["tra:1208", "08:00"], ["tra:1193", "08:20"]]), train("b", [["tra:1193", "09:10"], ["tra:1210", "09:30"]])];
    expect(planJourneys(tra, "tra:1208", "tra:1210", "2026-09-21", { traMaxMinutes: 50 })).toHaveLength(0);
    expect(planJourneys(tra, "tra:1208", "tra:1210", "2026-09-21", { traMaxMinutes: 51 })).toHaveLength(1);
    const high = [train("a", [["tra:1208", "08:00"], ["tra:1194", "08:20"]]), train("h", [["thsr:1030", "09:10"], ["thsr:1000", "09:40"]], "thsr")];
    expect(planJourneys(high, "tra:1208", "thsr:1000", "2026-09-21", { thsrMaxMinutes: 50 })).toHaveLength(0);
    expect(planJourneys(high, "tra:1208", "thsr:1000", "2026-09-21", { thsrMaxMinutes: 51 })).toHaveLength(1);
});

it("往新竹時原車可續搭，不在北新竹改搭另一班車，仍保留必要竹中轉乘", () => {
    const trains = [
        train("branch", [["tra:1208", "08:00"], ["tra:1193", "08:30"]]),
        train("shuttle", [["tra:1193", "08:35"], ["tra:1190", "08:50"], ["tra:1210", "09:05"]]),
        train("unnecessary", [["tra:1190", "08:55"], ["tra:1210", "09:00"]]),
    ];
    expect(planJourneys(trains, "tra:1208", "tra:1210", "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([["branch", "shuttle"]]);
    expect(planJourneys(trains, "tra:1193", "tra:1210", "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([["shuttle"]]);
});

it("原車終止北新竹或轉往北上方向時，仍保留北新竹換車", () => {
    const terminating = [
        train("ending", [["tra:1193", "08:00"], ["tra:1190", "08:20"]]),
        train("south", [["tra:1190", "08:25"], ["tra:1210", "08:30"]]),
    ];
    expect(planJourneys(terminating, "tra:1193", "tra:1210", "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([["ending", "south"]]);
    const northbound = [
        train("shuttle", [["tra:1193", "08:00"], ["tra:1190", "08:20"], ["tra:1210", "08:30"]]),
        train("north", [["tra:1190", "08:25"], ["tra:1000", "09:30"]]),
    ];
    expect(planJourneys(northbound, "tra:1193", "tra:1000", "2026-09-21").map(j => j.legs.map(l => l.number))).toEqual([["shuttle", "north"]]);
});
