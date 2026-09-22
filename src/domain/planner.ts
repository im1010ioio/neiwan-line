import type { Journey, Leg, Train } from "./types";
import { addDays } from "./query";

export interface PlannerFilters { traMaxMinutes?: number; thsrMaxMinutes?: number; metroMaxMinutes?: number; reservedOnly?: boolean; directOnly?: boolean; }
const branchStations = new Set(["1210", "1190", "1191", "1192", "1193", "1194", "1201", "1202", "1203", "1204", "1205", "1206", "1207", "1208"].map(id => `tra:${id}`));

interface Label {
    legs: Leg[];
    visited: Set<string>;
}

// Keep distinct Zhuzhong connections, including when they share a later train.
function zhuzhongConnection(legs: Leg[]): string {
    return legs.slice(0, -1).flatMap((leg, i) => leg.destination === "tra:1193" && legs[i + 1].origin === "tra:1193"
        ? [`${leg.trip}>${legs[i + 1].trip}`] : []).join("|");
}

/** Scan actual train movements in time order; continuing on a train never incurs a transfer. */
export function planJourneys(trains: Train[], origin: string, destination: string, date: string, filters: PlannerFilters = {}): Journey[] {
    if (origin === destination) return [];
    if (origin === "thsr:1030" || destination === "thsr:1030") {
        const atStart = origin === "thsr:1030";
        return planJourneys(trains, atStart ? "tra:1194" : origin, atStart ? destination : "tra:1194", date, filters).map(j => {
            const departure = atStart ? j.departure - 600000 : j.arrival;
            const arrival = departure + 600000;
            return { ...j, id: `${j.id}:walk`, departure: atStart ? departure : j.departure, arrival: atStart ? j.arrival : arrival,
                accessWalk: { origin: atStart ? "thsr:1030" : "tra:1194", destination: atStart ? "tra:1194" : "thsr:1030", departure, arrival, position: atStart ? "start" as const : "end" as const } };
        }).filter(j => j.departure >= Date.parse(`${date}T00:00:00+08:00`));
    }
    const traMax = filters.traMaxMinutes ?? 20;
    const thsrMax = filters.thsrMaxMinutes ?? 40;
    const start = Date.parse(`${date}T00:00:00+08:00`);
    const end = Date.parse(`${addDays(date, 1)}T00:00:00+08:00`);
    const usesHighSpeed = origin.startsWith("thsr:") || destination.startsWith("thsr:");
    const connections = trains.filter(t => t.operator === "tra" || usesHighSpeed).flatMap(train =>
        train.stops.slice(0, -1).map((from, i) => ({ train, from, to: train.stops[i + 1], i })))
        .filter(c => !filters.reservedOnly || c.train.reserved === true || (branchStations.has(c.from.station) && branchStations.has(c.to.station)))
        .filter(c => c.from.departure >= start && c.from.departure < end + 86400000)
        .sort((a, b) => a.from.departure - b.from.departure || a.i - b.i);
    const trainsById = new Map(trains.map(train => [train.id, train]));
    const arrivals = new Map<string, Label[]>();
    const aboard = new Map<string, Map<string, Label>>();
    const results = new Map<string, Journey>();
    for (const { train, from, to, i } of connections) {
        const candidates: Label[] = [];
        if (from.station === origin && from.departure < end) {
            candidates.push({ legs: [], visited: new Set([origin]) });
        }
        const interchange = from.station === "tra:1194" ? "thsr:1030" : from.station === "thsr:1030" ? "tra:1194" : undefined;
        const recent = (station: string): Label[] => {
            const labels = (arrivals.get(station) ?? []).filter(label => label.legs.at(-1)!.arrival > from.departure - Math.max(traMax, thsrMax) * 60000);
            arrivals.set(station, labels);
            return labels;
        };
        const waiting = [...recent(from.station), ...(interchange ? recent(interchange) : [])];
        for (const label of waiting) {
            const last = label.legs.at(-1)!;
            const wait = (from.departure - last.arrival) / 60000;
            const crossing = last.destination !== from.station;
            if (last.trip !== train.id && wait >= (crossing ? 10 : 5) && wait < (crossing ? thsrMax : traMax)) {
                if (train.operator === "thsr" && (!crossing || !destination.startsWith("thsr:"))) continue;
                if (last.operator === "thsr" && (!crossing || !origin.startsWith("thsr:"))) continue;
                // Stay aboard to Hsinchu instead of changing trains at North Hsinchu.
                if (from.station === "tra:1190" && to.station === "tra:1210") {
                    const previousStops = trainsById.get(last.trip)?.stops ?? [];
                    const arrivalIndex = previousStops.findIndex(stop => stop.station === last.destination && stop.arrival === last.arrival);
                    if (arrivalIndex >= 0 && previousStops.slice(arrivalIndex + 1).some(stop => stop.station === "tra:1210")) continue;
                }
                candidates.push(label);
            }
        }
        for (const label of aboard.get(`${train.id}:${i}`)?.values() ?? []) candidates.push(label);
        for (const label of candidates) {
            if (label.visited.has(to.station)) continue;
            const last = label.legs.at(-1);
            const continuing = last?.trip === train.id;
            const leg: Leg = continuing ? { ...last!, destination: to.station, arrival: to.arrival } : {
                trip: train.id, number: train.number, operator: train.operator, service: train.service, reserved: train.reserved,
                origin: from.station, destination: to.station, departure: from.departure, arrival: to.arrival,
            };
            const legs = continuing ? [...label.legs.slice(0, -1), leg] : [...label.legs, leg];
            const next: Label = { legs, visited: new Set([...label.visited, to.station]) };
            const key = `${legs[0].trip}:${legs[0].departure}:${zhuzhongConnection(legs)}`;
            const onKey = `${train.id}:${i + 1}`;
            const onTrain = aboard.get(onKey) ?? new Map<string, Label>();
            const previous = onTrain.get(key);
            // Same first departure and same onward train: more changes cannot improve this continuation.
            if (previous && previous.legs.length <= legs.length) continue;
            onTrain.set(key, next);
            aboard.set(onKey, onTrain);
            const atStop = arrivals.get(to.station) ?? [];
            atStop.push(next);
            arrivals.set(to.station, atStop);
            if (to.station === destination) {
                const id = legs.map(l => `${l.trip}:${l.origin}:${l.destination}`).join("|");
                results.set(id, { id, departure: legs[0].departure, arrival: leg.arrival, legs });
            }
        }
    }
    const all = [...results.values()].filter(j => !filters.directOnly || !zhuzhongConnection(j.legs));
    const useful = all.filter(j => !all.some(other => other !== j && zhuzhongConnection(other.legs) === zhuzhongConnection(j.legs) && other.departure >= j.departure && other.arrival <= j.arrival
        && other.legs.length <= j.legs.length && (other.departure > j.departure || other.arrival < j.arrival || other.legs.length < j.legs.length)));
    return useful.sort((a, b) => a.departure - b.departure || a.arrival - b.arrival || a.legs.length - b.legs.length);
}
