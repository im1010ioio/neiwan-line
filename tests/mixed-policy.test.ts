import { expect, it } from "vitest";
import { allowsLocalConnection } from "../src/domain/endpoint-connection";
import { mixedConnectionEdges, railInterchanges, usefulInterchange } from "../src/domain/mixed-policy";
import type { Train } from "../src/domain/types";

it.each(railInterchanges.flatMap(interchange => interchange.localHubs.map(remote => ({ remote, highSpeed: interchange.highSpeed }))))(
    "已有在地高鐵接駁的目的地 $remote 只使用該接點 $highSpeed",
    ({ remote, highSpeed }) => {
        expect(railInterchanges.filter(interchange => usefulInterchange(interchange, remote)).map(interchange => interchange.highSpeed)).toEqual([highSpeed]);
    },
);

it("轉乘站不得越過更接近目的地的高鐵接點，仍允許新烏日回接台中", () => {
    const allowed = (remote: string) => railInterchanges.filter(interchange => usefulInterchange(interchange, remote)).map(interchange => interchange.highSpeed);
    expect(allowed("tra:3300")).toContain("thsr:1040");
    expect(allowed("tra:3300")).not.toContain("thsr:1060");
    expect(allowed("tra:3300")).not.toContain("thsr:1070");
    expect(allowed("tra:0900")).toEqual(["thsr:0990", "thsr:1000", "thsr:1010"]);
    expect(allowed("tra:6000")).toContain("thsr:0990");
    expect(allowed("tra:6000")).toContain("thsr:1070");
    expect(allowed("tra:4340")).toContain("thsr:1070");
});

it.each([false, true])("新烏日至台中接駁不因已有少量對號列車而消失，也不能延伸到幹線（回程：%s）", reversed => {
    const stations = reversed ? ["tra:3230", "tra:3300", "tra:3340"] : ["tra:3340", "tra:3300", "tra:3230"];
    const train: Train = { id: "reserved", number: "reserved", operator: "tra", reserved: true, service: "自強", stops: stations.map((station, index) => ({ station, arrival: index * 600000, departure: index * 600000 })) };
    const interchange = railInterchanges.find(item => item.rail === "tra:3340")!;
    const edges = mixedConnectionEdges([train], stations[0], stations.at(-1)!, interchange);
    expect(allowsLocalConnection(edges, reversed ? "tra:3300" : "tra:3340", reversed ? "tra:3340" : "tra:3300")).toBe(true);
    expect(allowsLocalConnection(edges, reversed ? "tra:3230" : "tra:3300", reversed ? "tra:3300" : "tra:3230")).toBe(false);
    expect(allowsLocalConnection(edges, stations[0], stations.at(-1)!)).toBe(false);
});

it.each(railInterchanges.flatMap(interchange => interchange.localHubs.flatMap(hub => [false, true].map(reversed => ({
    rail: interchange.rail, hub, interchange, reversed,
})))))("必要接駁逐站套用同一政策：$rail ↔ $hub（回程：$reversed）", ({ rail, hub, interchange, reversed }) => {
    const stations = reversed ? [hub, rail] : [rail, hub];
    const service: Train = { id: "reserved", number: "reserved", operator: "tra", reserved: true, service: "自強",
        stops: stations.map((station, index) => ({ station, arrival: index * 600000, departure: index * 600000 })) };
    const edges = mixedConnectionEdges([service], stations[0], stations[1], interchange);
    expect(allowsLocalConnection(edges, stations[0], stations[1])).toBe(true);
});
