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
