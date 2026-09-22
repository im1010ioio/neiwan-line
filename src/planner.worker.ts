import { planAirportJourneys } from "./domain/airport-planner";
import type { MetroSnapshot, MetroService } from "./domain/metro";
import { planJourneys, type PlannerFilters } from "./domain/planner";
import type { Train } from "./domain/types";
self.onmessage = (event: MessageEvent<{ id: number; trains: Train[]; origin: string; destination: string; date: string; filters?: PlannerFilters; metro?: MetroSnapshot; metroService?: MetroService }>) => {
    const { id, trains, origin, destination, date, filters, metro, metroService } = event.data;
    try { self.postMessage({ id, journeys: metro ? planAirportJourneys(trains, origin, destination, date, filters ?? {}, metro, metroService) : planJourneys(trains, origin, destination, date, filters) }); }
    catch { self.postMessage({ id, error: true }); }
};
