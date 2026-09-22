import { planAirportJourneys } from "./domain/airport-planner";
import type { MetroSnapshot } from "./domain/metro";
import { planJourneys, type PlannerFilters } from "./domain/planner";
import type { Train } from "./domain/types";
self.onmessage = (event: MessageEvent<{ id: number; trains: Train[]; origin: string; destination: string; date: string; filters?: PlannerFilters; metro?: MetroSnapshot }>) => {
    const { id, trains, origin, destination, date, filters, metro } = event.data;
    try { self.postMessage({ id, journeys: metro ? planAirportJourneys(trains, origin, destination, date, filters ?? {}, metro) : planJourneys(trains, origin, destination, date, filters) }); }
    catch { self.postMessage({ id, error: true }); }
};
