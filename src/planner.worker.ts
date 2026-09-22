import { planJourneys, type PlannerFilters } from "./domain/planner";
import type { Train } from "./domain/types";
self.onmessage = (event: MessageEvent<{ id: number; trains: Train[]; origin: string; destination: string; date: string; filters?: PlannerFilters }>) => {
    const { id, trains, origin, destination, date, filters } = event.data;
    try { self.postMessage({ id, journeys: planJourneys(trains, origin, destination, date, filters) }); }
    catch { self.postMessage({ id, error: true }); }
};
