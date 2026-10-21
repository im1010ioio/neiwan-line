import type { Journey, Leg, Train } from "./types";
import { dateInTaipei } from "./query";

export interface AlternativeTrains {
    earlier: Leg[];
    later: Leg[];
}

export function supportsAlternativeTrains(journey: Journey, index: number): boolean {
    const leg = journey.legs[index];
    return !!leg && (index === journey.legs.length - 1 || leg.operator === "tymc" || leg.operator === "thsr" || leg.reserved === true);
}

/** Transfer settings may be relaxed, but segments must still connect in time. */
export function canConnectLeg(journey: Journey, index: number, leg: Leg): boolean {
    const previous = journey.legs[index - 1];
    const next = journey.legs[index + 1];
    return leg.arrival > leg.departure
        && (!previous || leg.departure > previous.arrival && dateInTaipei(new Date(previous.arrival)) === dateInTaipei(new Date(leg.departure)))
        && (!next || leg.arrival < next.departure && dateInTaipei(new Date(leg.arrival)) === dateInTaipei(new Date(next.departure)));
}

export function findAlternativeTrains(trains: Train[], journey: Journey, index: number, usedTrips: Set<string>, metroCandidates: Leg[] = []): AlternativeTrains {
    const original = journey.legs[index];
    const result: AlternativeTrains = { earlier: [], later: [] };
    if (!original || !supportsAlternativeTrains(journey, index)) return result;
    const candidates = original.operator === "tymc" ? metroCandidates : trains.flatMap(train => {
        if (train.operator !== original.operator || train.operator === "tra" && original.reserved === true && train.reserved !== true) return [];
        const fromIndex = train.stops.findIndex(stop => stop.station === original.origin);
        const toIndex = train.stops.findIndex((stop, i) => i > fromIndex && stop.station === original.destination);
        if (fromIndex < 0 || toIndex < 0) return [];
        return [{ ...original, trip: train.id, number: train.number, service: train.service,
            reserved: train.reserved, trainType: train.trainType,
            departure: train.stops[fromIndex].departure, arrival: train.stops[toIndex].arrival }];
    });
    const seen = new Set<string>();
    for (const leg of candidates) {
        if (leg.operator !== original.operator || leg.origin !== original.origin || leg.destination !== original.destination
            || usedTrips.has(leg.trip) || leg.trip === original.trip || seen.has(leg.trip)) continue;
        const { departure } = leg;
        // Keep the segment's boarding day and prevent impossible or overnight connections.
        if (dateInTaipei(new Date(departure)) !== dateInTaipei(new Date(original.departure))
            || !canConnectLeg(journey, index, leg)) continue;
        if (departure < original.departure) result.earlier.push(leg);
        if (departure > original.departure) result.later.push(leg);
        seen.add(leg.trip);
    }
    result.earlier.sort((a, b) => b.departure - a.departure || a.arrival - b.arrival);
    result.later.sort((a, b) => a.departure - b.departure || a.arrival - b.arrival);
    return result;
}

/** Preserve access-walk duration when the first or last train changes. */
export function withSelectedLegs(journey: Journey, selections: ReadonlyMap<number, Leg>): Journey {
    if (!selections.size) return journey;
    const legs = journey.legs.map((leg, index) => selections.get(index) ?? leg);
    let departure = legs[0].departure;
    let arrival = legs[legs.length - 1].arrival;
    let accessWalk = journey.accessWalk;
    if (accessWalk) {
        const duration = accessWalk.arrival - accessWalk.departure;
        accessWalk = accessWalk.position === "start"
            ? { ...accessWalk, departure: departure - duration, arrival: departure }
            : { ...accessWalk, departure: arrival, arrival: arrival + duration };
        if (accessWalk.position === "start") departure = accessWalk.departure;
        else arrival = accessWalk.arrival;
    }
    return { ...journey, legs, departure, arrival, accessWalk };
}
