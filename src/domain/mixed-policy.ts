import { passedRailStations, railDistance } from "./rail-path";
import { localStations } from "./local-stations";
import type { Train } from "./types";

export interface RailInterchange {
    highSpeed: string;
    rail: string;
    localHubs: readonly string[];
}

// Product-defined local access corridors; these do not specify walking or travel minutes.
export const railInterchanges: readonly RailInterchange[] = [
    { highSpeed: "thsr:0990", rail: "tra:0980", localHubs: [] },
    { highSpeed: "thsr:1000", rail: "tra:1000", localHubs: [] },
    { highSpeed: "thsr:1010", rail: "tra:1020", localHubs: [] },
    { highSpeed: "thsr:1035", rail: "tra:3150", localHubs: ["tra:1250", "tra:3160"] },
    { highSpeed: "thsr:1040", rail: "tra:3340", localHubs: ["tra:3300", "tra:3360"] },
    { highSpeed: "thsr:1060", rail: "tra:4272", localHubs: ["tra:4220"] },
    { highSpeed: "thsr:1070", rail: "tra:4340", localHubs: ["tra:4310", "tra:4400"] },
];
const highSpeedOrder = ["thsr:0990", "thsr:1000", "thsr:1010", "thsr:1020", "thsr:1030", "thsr:1035", "thsr:1040", "thsr:1043", "thsr:1047", "thsr:1050", "thsr:1060", "thsr:1070"];

export function highSpeedSpan(origin: string, destination: string): number {
    return Math.abs(highSpeedOrder.indexOf(destination) - highSpeedOrder.indexOf(origin));
}

/** Do not ride past a closer rail gateway and then return a long distance by TRA. */
export function usefulInterchange(interchange: RailInterchange, remote: string): boolean {
    if (remote !== interchange.rail && passedRailStations(interchange.rail, remote).some(station => localStations.has(station))) return false;
    const anchor = highSpeedOrder.indexOf("thsr:1030"), target = highSpeedOrder.indexOf(interchange.highSpeed);
    const distance = railDistance(interchange.rail, remote);
    return !railInterchanges.some(earlier => {
        const index = highSpeedOrder.indexOf(earlier.highSpeed);
        return Math.sign(index - anchor) === Math.sign(target - anchor) && Math.abs(index - anchor) < Math.abs(target - anchor)
            && railDistance(earlier.rail, remote) < distance;
    });
}

/** Only the two ends of an HSR feeder may use locals to reach a reserved-service stop. */
export function mixedConnectionEdges(trains: Train[], origin: string, destination: string, interchange?: RailInterchange): Set<string> {
    const route = [origin, ...passedRailStations(origin, destination)];
    const positions = new Map(route.map((station, index) => [station, index]));
    const reservedStops = new Set<string>();
    for (const train of trains) {
        if (train.operator !== "tra" || train.reserved !== true) continue;
        for (let index = 1; index < train.stops.length; index++) {
            const from = train.stops[index - 1].station, to = train.stops[index].station;
            const fromPosition = positions.get(from), toPosition = positions.get(to);
            if (fromPosition === undefined && toPosition === undefined) continue;
            const movement = [from, ...passedRailStations(from, to)].flatMap(station => {
                const position = positions.get(station);
                return position === undefined ? [] : [position];
            });
            if (fromPosition !== undefined && movement.some(position => position > fromPosition)) reservedStops.add(from);
            if (toPosition !== undefined && movement.some(position => position < toPosition)) reservedStops.add(to);
        }
    }
    const first = route.findIndex(station => reservedStops.has(station));
    const last = route.length - 1 - [...route].reverse().findIndex(station => reservedStops.has(station));
    const edges = new Set(route.slice(1).flatMap((station, index) => first < 0 || index < first || index >= last
        ? [`${route[index]}>${station}`] : []));
    // Explicit short access corridors remain local even if a few reserved trains also stop there.
    if (!interchange) return edges;
    for (const hub of interchange.localHubs) {
        const path = origin === interchange.rail
            ? [origin, ...passedRailStations(origin, hub)]
            : [hub, ...passedRailStations(hub, destination)];
        for (let index = 1; index < path.length; index++) {
            const from = positions.get(path[index - 1]), to = positions.get(path[index]);
            if (from !== undefined && to === from + 1) edges.add(`${path[index - 1]}>${path[index]}`);
        }
    }
    return edges;
}
