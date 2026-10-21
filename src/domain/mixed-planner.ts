import { mixedConnectionEdges, railInterchanges, usefulInterchange, highSpeedSpan } from "./mixed-policy";
import type { planJourneys, PlannerFilters } from "./planner";
import { addDays } from "./query";
import { localStations } from "./local-stations";
import type { Journey, Leg, Train } from "./types";

/** Choose one interchange for the same remote TRA services and final arrival. */
export function preferredMixedInterchanges(journeys: Journey[], minimumMinutes: number): Journey[] {
    const margin = (journey: Journey) => Math.min(...journey.legs.slice(1).flatMap((leg, index) => {
        const previous = journey.legs[index];
        return previous.destination !== leg.origin && previous.destination !== "thsr:1030" && leg.origin !== "thsr:1030"
            ? [(leg.departure - previous.arrival) / 60000 - minimumMinutes] : [];
    }));
    // All mixed routes use HSR Hsinchu, so fewer station intervals means a shorter HSR distance.
    const journeyHighSpeedSpan = (journey: Journey) => {
        const leg = journey.legs.find(leg => leg.operator === "thsr")!;
        return highSpeedSpan(leg.origin, leg.destination);
    };
    const compare = (a: Journey, b: Journey) => b.departure - a.departure
        || a.legs.length - b.legs.length
        || margin(b) - margin(a)
        || journeyHighSpeedSpan(a) - journeyHighSpeedSpan(b)
        || a.id.localeCompare(b.id);
    const preferred = new Map<string, Journey>();
    for (const journey of journeys) {
        const remoteServices = journey.legs.filter(leg => leg.operator === "tra"
            && !(localStations.has(leg.origin) && localStations.has(leg.destination))).map(leg => leg.trip);
        // Access-walk-only endpoints have no remote train to compare.
        if (!remoteServices.length) {
            preferred.set(journey.id, journey);
            continue;
        }
        const key = JSON.stringify([journey.arrival, remoteServices]);
        const previous = preferred.get(key);
        if (!previous || compare(journey, previous) < 0) preferred.set(key, journey);
    }
    return [...preferred.values()];
}

interface TimedJourney {
    time: number;
    order: number;
    journey: Journey;
}

function timeIndex(journeys: Journey[], field: "arrival" | "departure"): TimedJourney[] {
    return journeys.map((journey, order) => ({ time: journey[field], order, journey })).sort((a, b) => a.time - b.time || a.order - b.order);
}

function journeysInWindow(index: TimedJourney[], minimum: number, maximum: number): Journey[] {
    const bound = (value: number, inclusive: boolean) => {
        let low = 0, high = index.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (index[middle].time < value || inclusive && index[middle].time === value) low = middle + 1;
            else high = middle;
        }
        return low;
    };
    return index.slice(bound(minimum, false), bound(maximum, true)).sort((a, b) => a.order - b.order).map(item => item.journey);
}

/** Preserve equal choices; discard only strictly dominated complete journeys. */
export function usefulMixedJourneys(journeys: Journey[]): Journey[] {
    const groups = new Map<string, Journey[]>();
    for (const journey of journeys) {
        const trip = journey.legs[0].trip;
        const group = groups.get(trip) ?? [];
        group.push(journey);
        groups.set(trip, group);
    }
    const dominated = new Set<Journey>();
    for (const group of groups.values()) {
        group.sort((a, b) => b.departure - a.departure || a.arrival - b.arrival || a.legs.length - b.legs.length);
        const bestByLegCount = new Map<number, { arrival: number; departure: number }>();
        for (const journey of group) {
            const count = journey.legs.length;
            for (const [legs, best] of bestByLegCount) {
                if (legs <= count && best.arrival <= journey.arrival
                    && (legs < count || best.arrival < journey.arrival || best.departure > journey.departure)) {
                    dominated.add(journey);
                    break;
                }
            }
            const previous = bestByLegCount.get(count);
            if (!previous || journey.arrival < previous.arrival) {
                bestByLegCount.set(count, { arrival: journey.arrival, departure: journey.departure });
            }
        }
    }
    return journeys.filter(journey => !dominated.has(journey));
}

export function planMixedJourneys(trains: Train[], origin: string, destination: string, date: string, filters: PlannerFilters, planRail: typeof planJourneys): Journey[] {
    const plainFilters = { ...filters, includeThsr: false, directOnly: false };
    const pure = planRail(trains, origin, destination, date, plainFilters);
    const outbound = localStations.has(origin);
    const branch = outbound ? origin : destination;
    const remote = outbound ? destination : origin;
    const start = Date.parse(`${date}T00:00:00+08:00`);
    const end = Date.parse(`${addDays(date, 1)}T00:00:00+08:00`);
    const minimum = (filters.thsrMinMinutes ?? 10) * 60000;
    const maximum = (filters.thsrMaxMinutes ?? 40) * 60000;
    const branchOptions = [date, addDays(date, 1)].flatMap(day => planRail(trains,
        outbound ? branch : "tra:1194", outbound ? "tra:1194" : branch, day, plainFilters, { preserveCandidates: true }));
    const branchIndex = timeIndex(branchOptions, outbound ? "arrival" : "departure");
    const mixed: Journey[] = [];
    for (const interchange of railInterchanges) {
        if (!usefulInterchange(interchange, remote)) continue;
        const { highSpeed: hsr, rail } = interchange;
        const feederOrigin = outbound ? rail : remote, feederDestination = outbound ? remote : rail;
        const nonReservedEdges = filters.reservedOnly ? mixedConnectionEdges(trains, feederOrigin, feederDestination, interchange) : undefined;
        // Keep only necessary local access at either end; reserved-only still applies to the mainline.
        const feeders = remote === rail ? [] : [date, addDays(date, 1)].flatMap(day => planRail(trains,
            feederOrigin, feederDestination, day, plainFilters, { preserveCandidates: true, nonReservedEdges }));
        const feederIndex = timeIndex(feeders, outbound ? "departure" : "arrival");
        for (const train of trains.filter(train => train.operator === "thsr")) {
            const from = train.stops.findIndex(stop => stop.station === (outbound ? "thsr:1030" : hsr));
            const to = train.stops.findIndex((stop, index) => index > from && stop.station === (outbound ? hsr : "thsr:1030"));
            if (from < 0 || to < 0) continue;
            const highSpeed: Leg = { trip: train.id, number: train.number, operator: "thsr", service: train.service,
                origin: train.stops[from].station, destination: train.stops[to].station,
                departure: train.stops[from].departure, arrival: train.stops[to].arrival };
            const localOptions = journeysInWindow(branchIndex, outbound ? highSpeed.departure - maximum : highSpeed.arrival + minimum,
                outbound ? highSpeed.departure - minimum : highSpeed.arrival + maximum);
            const options: (Journey | undefined)[] = remote === rail ? [undefined] : journeysInWindow(feederIndex,
                outbound ? highSpeed.arrival + minimum : highSpeed.departure - maximum,
                outbound ? highSpeed.arrival + maximum : highSpeed.departure - minimum);
            for (const local of localOptions) {
                for (const feeder of options) {
                    const legs = outbound ? [...local.legs, highSpeed, ...(feeder?.legs ?? [])] : [...(feeder?.legs ?? []), highSpeed, ...local.legs];
                    const accessWalk: Journey["accessWalk"] = feeder ? undefined : outbound
                        ? { origin: hsr, destination: rail, departure: highSpeed.arrival, arrival: highSpeed.arrival + minimum, position: "end" }
                        : { origin: rail, destination: hsr, departure: highSpeed.departure - minimum, arrival: highSpeed.departure, position: "start" };
                    const departure = accessWalk?.position === "start" ? accessWalk.departure : legs[0].departure;
                    const arrival = accessWalk?.position === "end" ? accessWalk.arrival : legs.at(-1)!.arrival;
                    if (departure < start || departure >= end) continue;
                    const id = `${legs.map(leg => `${leg.trip}:${leg.origin}:${leg.destination}`).join("|")}:mixed`;
                    mixed.push({ id, legs, departure, arrival, ...(accessWalk ? { accessWalk } : {}) });
                }
            }
        }
    }
    const unique = [...new Map(mixed.map(journey => [journey.id, journey])).values()];
    const useful = usefulMixedJourneys(unique);
    return [...pure, ...preferredMixedInterchanges(useful, minimum / 60000)].sort((a, b) => a.departure - b.departure || a.arrival - b.arrival || a.legs.length - b.legs.length);
}
