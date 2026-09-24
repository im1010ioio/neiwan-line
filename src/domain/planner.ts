import type { Journey, Leg, Train } from "./types";
import stationData from "../stations.json";
const reservedTransferExceptionStations = new Set(stationData.filter(station => /基隆|宜蘭|花蓮|臺東|台東|屏東/.test(station.county)).map(station => station.id));
import { passedRailStations, approachesDestination, sameMainlineTransfer } from "./rail-path";
import { addDays } from "./query";

export interface PlannerFilters { traMinMinutes?: number; thsrMinMinutes?: number; metroMinMinutes?: number; traMaxMinutes?: number; thsrMaxMinutes?: number; metroMaxMinutes?: number; reservedOnly?: boolean; directOnly?: boolean; }
import { localStations as branchStations } from "./local-stations";

interface Label {
    legs: Leg[];
    visited: Set<string>;
    mainlineVisited: Set<string>;
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
    const traMin = filters.traMinMinutes ?? 5;
    const thsrMin = filters.thsrMinMinutes ?? 10;
    const traMax = filters.traMaxMinutes ?? 30;
    const thsrMax = filters.thsrMaxMinutes ?? 40;
    const start = Date.parse(`${date}T00:00:00+08:00`);
    const end = Date.parse(`${addDays(date, 1)}T00:00:00+08:00`);
    const usesHighSpeed = origin.startsWith("thsr:") || destination.startsWith("thsr:");
    const railTarget = destination.startsWith("thsr:") ? "tra:1194" : destination;
    const connections = trains.filter(t => t.operator === "tra" || usesHighSpeed).flatMap(train =>
        train.stops.slice(0, -1).map((from, i) => ({ train, from, to: train.stops[i + 1], i })))
        .filter(c => c.train.operator !== "tra" || (branchStations.has(c.from.station) && branchStations.has(c.to.station)) || approachesDestination(c.from.station, c.to.station, railTarget))
        .filter(c => !filters.reservedOnly || c.train.reserved === true || (branchStations.has(c.from.station) && branchStations.has(c.to.station)))
        .filter(c => c.from.departure >= start && c.from.departure < end + 86400000)
        .sort((a, b) => a.from.departure - b.from.departure || a.i - b.i);
    const trainsById = new Map(trains.map(train => [train.id, train]));
    const outboundTra = branchStations.has(origin) && destination.startsWith("tra:") && !branchStations.has(destination);
    const headsSouth = outboundTra && passedRailStations("tra:1190", destination).includes("tra:1210");
    const regionalTransferException = reservedTransferExceptionStations.has(origin) || reservedTransferExceptionStations.has(destination);
    const inboundTra = origin.startsWith("tra:") && !branchStations.has(origin) && branchStations.has(destination);
    const approachesFromSouth = inboundTra && passedRailStations(origin, "tra:1190").includes("tra:1210");
    const branchTrainIds = new Set(trains.filter(train => train.stops.some(stop => branchStations.has(stop.station) && !["tra:1210", "tra:1190"].includes(stop.station))).map(train => train.id));
    const branchTrain = (train: Train) => branchTrainIds.has(train.id);
    const arrivals = new Map<string, Label[]>();
    const aboard = new Map<string, Map<string, Label>>();
    const results = new Map<string, Journey>();
    for (const { train, from, to, i } of connections) {
        const candidates: Label[] = [];
        if (from.station === origin && from.departure < end) {
            candidates.push({ legs: [], visited: new Set([origin]), mainlineVisited: new Set(branchStations.has(origin) ? [] : [origin]) });
        }
        const interchange = from.station === "tra:1194" ? "thsr:1030" : from.station === "thsr:1030" ? "tra:1194" : undefined;
        const recent = (station: string): Label[] => {
            const labels = (arrivals.get(station) ?? []).filter(label => label.legs.at(-1)!.arrival >= from.departure - Math.max(traMax, thsrMax) * 60000);
            arrivals.set(station, labels);
            return labels;
        };
        const waiting = [...recent(from.station), ...(interchange ? recent(interchange) : [])];
        for (const label of waiting) {
            const last = label.legs.at(-1)!;
            const wait = (from.departure - last.arrival) / 60000;
            const crossing = last.destination !== from.station;
            if (last.trip !== train.id && wait >= (crossing ? thsrMin : traMin) && wait <= (crossing ? thsrMax : traMax)) {
                // Direct mode permits at most one transfer, exclusively at Hsinchu in either direction.
                if (filters.directOnly && (label.legs.length >= 2 || from.station !== "tra:1210" || last.destination !== "tra:1210")) continue;
                const previousTrain = trainsById.get(last.trip)!;
                if (previousTrain.operator === "tra" && train.operator === "tra"
                    && previousTrain.reserved === true && train.reserved === true) {
                    // Toward Neiwan, check the incoming service; away from it, the onward service.
                    // Even on exception routes, keep the original train when it reaches
                    // the same next-train destination no later, with no added change.
                    const onwardDestination = train.stops.find(stop => stop.station === destination && stop.arrival >= from.departure);
                    const originalDestination = previousTrain.stops.find(stop => stop.station === destination && stop.arrival >= last.arrival);
                    if (onwardDestination && originalDestination && originalDestination.arrival <= onwardDestination.arrival) continue;
                    const serviceAtHsinchu = inboundTra ? previousTrain : train;
                    if (!regionalTransferException && serviceAtHsinchu.stops.some(stop => stop.station === "tra:1210")) continue;
                }
                if (!crossing && train.operator === "tra" && previousTrain.operator === "tra"
                    && branchStations.has(from.station) && !["tra:1193", "tra:1190", "tra:1210"].includes(from.station)) continue;
                if (outboundTra && branchTrain(previousTrain)) {
                    const arrivalIndex = previousTrain.stops.findIndex(stop => stop.station === last.destination && stop.arrival === last.arrival);
                    const directToHsinchu = label.legs.length === 1 && previousTrain.stops.slice(arrivalIndex).some(stop => stop.station === "tra:1210");
                    if (directToHsinchu && from.station !== "tra:1210") continue;
                    if (branchTrain(train)) {
                        if (from.station !== "tra:1193") continue;
                    } else if (!filters.directOnly) {
                        const hub = directToHsinchu || headsSouth || train.reserved === true ? "tra:1210" : train.reserved === false ? "tra:1190" : undefined;
                        if (hub ? from.station !== hub : !["tra:1210", "tra:1190"].includes(from.station)) continue;
                    }
                }
                if (previousTrain.operator === "tra" && train.operator === "tra"
                    && previousTrain.reserved === false && train.reserved === false && !crossing
                    && !branchTrain(previousTrain) && !branchTrain(train)) {
                    const arrivalIndex = previousTrain.stops.findIndex(stop => stop.station === last.destination && stop.arrival === last.arrival);
                    const previousStation = previousTrain.stops[arrivalIndex - 1]?.station;
                    if (previousStation && sameMainlineTransfer(previousStation, from.station, to.station)) continue;
                }
                if (inboundTra && !filters.directOnly) {
                    if (!branchTrain(previousTrain)) {
                        const hub = approachesFromSouth || previousTrain.reserved === true ? "tra:1210" : "tra:1190";
                        const arrivalIndex = previousTrain.stops.findIndex(stop => stop.station === last.destination && stop.arrival === last.arrival);
                        const canStayToHub = previousTrain.stops.slice(arrivalIndex + 1).some(stop => stop.station === hub);
                        const passedHub = previousTrain.stops.slice(0, arrivalIndex + 1).some(stop => stop.station === hub && stop.departure >= last.departure);
                        // Stay on the mainline train to its interchange; do not replace it en route.
                        if (from.station !== hub && (canStayToHub || passedHub)
                            && !(regionalTransferException && !passedHub && previousTrain.reserved === true && train.reserved === true)) continue;
                        if (branchTrain(train) && from.station !== hub) continue;
                        // Once at the hub, board a branch service rather than another mainline train.
                        if (from.station === hub && !branchTrain(train)) continue;
                    } else if (from.station !== "tra:1193") {
                        // Keep necessary Zhuzhong changes; other branch stops are not extra interchanges.
                        continue;
                    }
                }
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
        const passed = train.operator === "tra" ? passedRailStations(from.station, to.station).filter(station => !branchStations.has(station)) : [];
        for (const label of candidates) {
            // Branch access via Hsinchu/North Hsinchu is allowed; mainline backtracking is not.
            if (passed.some(station => label.mainlineVisited.has(station))) continue;
            // Hsinchu transfers legitimately pass North Hsinchu again in both directions.
            const hsinchuAccess = from.station === "tra:1210" && to.station === "tra:1190";
            if (label.visited.has(to.station) && !hsinchuAccess) continue;
            const last = label.legs.at(-1);
            const continuing = last?.trip === train.id;
            const leg: Leg = continuing ? { ...last!, destination: to.station, arrival: to.arrival } : {
                trip: train.id, number: train.number, operator: train.operator, service: train.service, reserved: train.reserved, trainType: train.trainType,
                origin: from.station, destination: to.station, departure: from.departure, arrival: to.arrival,
            };
            const legs = continuing ? [...label.legs.slice(0, -1), leg] : [...label.legs, leg];
            const next: Label = { legs, visited: new Set([...label.visited, to.station]), mainlineVisited: new Set([...label.mainlineVisited, ...passed]) };
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
