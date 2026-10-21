import { passedRailStations } from "./rail-path";
import { localStations } from "./local-stations";
import type { Train } from "./types";

/** Limit non-reserved mainline travel to the small-station/branch end of a route. */
export function endpointConnection(trains: Train[], origin: string, destination: string) {
    const endpoint = localStations.has(origin) && destination.startsWith("tra:") ? destination
        : localStations.has(destination) && origin.startsWith("tra:") ? origin : undefined;
    if (!endpoint || localStations.has(endpoint)) return undefined;
    const route = [endpoint, ...passedRailStations(endpoint, "tra:1210")];
    const positions = new Map(route.map((station, index) => [station, index]));
    const inbound = endpoint === origin;
    const reservedStops = new Set<string>();
    for (const train of trains) {
        if (train.operator !== "tra" || train.reserved !== true) continue;
        const stops = train.stops.filter(stop => positions.has(stop.station));
        for (let i = 0; i < stops.length; i++) {
            const adjacent = stops[inbound ? i + 1 : i - 1];
            if (adjacent && positions.get(adjacent.station)! > positions.get(stops[i].station)!) reservedStops.add(stops[i].station);
        }
    }
    if (reservedStops.has(endpoint)) return undefined;
    const gatewayIndex = route.findIndex(station => reservedStops.has(station) || station === "tra:1210");
    if (gatewayIndex < 1) return undefined;
    return { gateway: route[gatewayIndex], stations: new Set(route.slice(0, gatewayIndex + 1)) };
}

/** Only the two ends of an HSR feeder may use locals to reach a reserved-service stop. */
export function mixedConnectionEdges(trains: Train[], origin: string, destination: string): Set<string> {
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
    return new Set(route.slice(1).flatMap((station, index) => first < 0 || index < first || index >= last
        ? [`${route[index]}>${station}`] : []));
}

export function allowsLocalConnection(edges: ReadonlySet<string> | undefined, origin: string, destination: string): boolean {
    if (!edges) return false;
    const path = [origin, ...passedRailStations(origin, destination)];
    return path.slice(1).every((station, index) => edges.has(`${path[index]}>${station}`));
}
