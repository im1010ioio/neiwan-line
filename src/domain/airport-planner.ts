import { planJourneys, type PlannerFilters } from "./planner";
import { connectMetro, metroLegs, type MetroSnapshot } from "./metro";
import { addDays } from "./query";
import type { Journey, Train } from "./types";

export function planAirportJourneys(trains: Train[], origin: string, destination: string, date: string, filters: PlannerFilters, snapshot: MetroSnapshot): Journey[] {
    const reversed = origin.startsWith("tymc:");
    const station = reversed ? origin : destination;
    const railOrigin = reversed ? "thsr:1020" : origin;
    const railDestination = reversed ? destination : "thsr:1020";
    const railFilters = { ...filters, reservedOnly: false, directOnly: false };
    const rail = [date, ...(reversed ? [addDays(date, 1)] : [])].flatMap(day => planJourneys(trains, railOrigin, railDestination, day, railFilters));
    if (station === "tymc:A18") {
        return rail.map(j => {
            const departure = reversed ? j.departure - 600000 : j.arrival;
            const arrival = departure + 600000;
            return { ...j, id: `${j.id}:A18-walk`, departure: reversed ? departure : j.departure, arrival: reversed ? j.arrival : arrival,
                accessWalk: { origin: reversed ? station : "thsr:1020", destination: reversed ? "thsr:1020" : station, departure, arrival, position: reversed ? "start" as const : "end" as const } };
        }).filter(j => j.departure >= Date.parse(`${date}T00:00:00+08:00`) && j.departure < Date.parse(`${addDays(date, 1)}T00:00:00+08:00`));
    }
    const legs = metroLegs(snapshot, reversed ? station : "tymc:A18", reversed ? "tymc:A18" : station, date, "all");
    return connectMetro(rail, legs, reversed, date, filters.metroMaxMinutes ?? 40, filters.metroMinMinutes ?? 10);
}
