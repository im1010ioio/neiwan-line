import { findAlternativeTrains } from "./domain/alternatives";
import type { Journey, Leg, Train } from "./domain/types";
import { planAirportJourneys } from "./domain/airport-planner";
import { planJourneys, type PlannerFilters } from "./domain/planner";
import { timetableGroups } from "./domain/timetable-format";
import { createDayLoader } from "./data-loader";
import { metroHealth } from "./domain/metro-health";
import { metroLegs, metroSnapshotForDate, type MetroSnapshot } from "./domain/metro";
import { loadMetro } from "./metro-loader";

const loadDay = createDayLoader();
let latestId = 0;
let alternativeContext: { id: number; trains: Train[]; journeys: Journey[]; date: string; metro?: MetroSnapshot } | undefined;
self.onmessage = async (event: MessageEvent<{ id: number; origin: string; destination: string; date: string; force?: boolean; filters?: PlannerFilters }>) => {
    if ("kind" in event.data && event.data.kind === "alternatives") {
        const request = event.data as unknown as { id: number; journeyId: string; index: number; usedTrips: string[]; legs?: Leg[] };
        const journey = alternativeContext?.id === request.id ? alternativeContext.journeys.find(item => item.id === request.journeyId) : undefined;
        const original = journey?.legs[request.index];
        const metroCandidates = original?.operator === "tymc" && alternativeContext?.metro
            ? metroLegs(alternativeContext.metro, original.origin, original.destination, alternativeContext.date, "all") : [];
        self.postMessage({ kind: "alternatives", id: request.id, journeyId: request.journeyId, index: request.index,
            alternatives: journey ? findAlternativeTrains(alternativeContext!.trains, { ...journey, legs: journey.legs.map((leg, i) => i === request.index ? leg : request.legs?.[i] ?? leg) }, request.index, new Set(request.usedTrips), metroCandidates) : undefined });
        return;
    }
    const { id, origin, destination, date, filters, force = false } = event.data;
    alternativeContext = undefined;
    latestId = id;
    try {
        const groups = timetableGroups(origin, destination);
        const needsMetro = origin.startsWith("tymc:") || destination.startsWith("tymc:");
        const needsMetroTimetable = needsMetro && origin !== "tymc:A18" && destination !== "tymc:A18";
        const [loaded, metro] = await Promise.all([loadDay(date, groups, force), needsMetroTimetable ? loadMetro(date, force) : undefined]);
        if (id !== latestId) return;
        if (loaded.status !== "ready") { self.postMessage({ id, status: "missing" }); return; }
        // Only metadata and visible journey information cross the worker boundary.
        const { trains, ...data } = loaded.data;
        const health = needsMetroTimetable ? metroHealth(metro, date) : undefined;
        const metroSummary = health ? { ...health, generatedAt: metro && metroSnapshotForDate(metro, date)?.generatedAt } : undefined;
        if (!data.coverage.tra || (groups.includes("thsr") && !data.coverage.thsr) || (needsMetroTimetable && !health?.usable)) {
            self.postMessage({ id, status: "missing", data, metro: metroSummary }); return;
        }
        const journeys = needsMetro ? planAirportJourneys(trains, origin, destination, date, filters ?? {}, metro)
            : planJourneys(trains, origin, destination, date, filters);
        alternativeContext = { id, trains, journeys, date, metro };
        self.postMessage({ id, status: "ready", data, metro: metroSummary, journeys });
    } catch { if (id === latestId) self.postMessage({ id, status: "error" }); }
};
