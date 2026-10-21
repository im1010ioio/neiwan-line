import { localStations } from "./local-stations";

export function mixedRouteAvailable(origin: string, destination: string): boolean {
    return [origin, destination].every(id => id.startsWith("tra:"))
        && localStations.has(origin) !== localStations.has(destination);
}

