import calendar from "../calendar.json";
import { addDays } from "./query";
import type { Journey, Leg } from "./types";

export type MetroService = "all" | "express" | "local";
export interface MetroSnapshot {
    generatedAt: string;
    timetables: {
        StationID: string;
        Direction: number;
        DestinationStaionID: string;
        ServiceDay: Record<string, boolean | string>;
        Timetables: { DepartureTime: string; TrainType: number; StoppingPatternID: string }[];
    }[];
    patterns: { StoppingPatternID: string; Stations: { StationID: string; Sequence: number }[] }[];
    travelTimes: { TrainType: number; TravelTimes: { FromStationID: string; ToStationID: string; RunTime: number }[] }[];
}
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function metroCalendarKnown(date: string): boolean {
    return typeof (calendar as Record<string, boolean>)[date] === "boolean";
}
function operates(service: MetroSnapshot["timetables"][number]["ServiceDay"], date: string): boolean {
    const holiday = (calendar as Record<string, boolean>)[date];
    if (holiday === undefined) return false;
    const day = new Date(`${date}T12:00:00+08:00`).getUTCDay();
    return holiday ? service.NationalHolidays === true : service[weekdays[day]] === true;
}
function timestamp(date: string, time: string): number {
    const [hour, minute] = time.split(":").map(Number);
    if (!Number.isInteger(hour) || hour < 0 || hour > 26 || !Number.isInteger(minute) || minute < 0 || minute > 59) return NaN;
    // Metro service days continue beyond midnight, until the overnight closure.
    return Date.parse(`${date}T00:00:00+08:00`) + ((hour < 4 ? hour + 24 : hour) * 60 + minute) * 60000;
}
/** Official departure + published OD travel time; arrival is explicitly an estimate. */
export function metroLegs(snapshot: MetroSnapshot, origin: string, destination: string, date: string, service: MetroService): Leg[] {
    const from = origin.replace("tymc:", ""), to = destination.replace("tymc:", "");
    const result = new Map<string, Leg>();
    for (const offset of [-1, 0, 1]) {
        const serviceDate = addDays(date, offset);
        for (const row of snapshot.timetables) {
            if (row.StationID !== from || !operates(row.ServiceDay, serviceDate)) continue;
            for (const departure of row.Timetables) {
                if (departure.TrainType !== 1 && departure.TrainType !== 2) continue;
                const type = departure.TrainType === 2 ? "express" : "local";
                if (service !== "all" && type !== service) continue;
                const pattern = snapshot.patterns.find(p => p.StoppingPatternID === departure.StoppingPatternID);
                // Use geographic station order, because SP4 is stored south-to-north.
                const order = (id: string) => Number(id.slice(1).replace("a", ".5"));
                const stops = pattern?.Stations.map(s => s.StationID).sort((a, b) => order(a) - order(b)) ?? [];
                if (row.Direction === 1) stops.reverse();
                const start = stops.indexOf(from), end = stops.indexOf(to), terminal = stops.indexOf(row.DestinationStaionID);
                if (start < 0 || end <= start || terminal < end) continue;
                const duration = snapshot.travelTimes.find(t => t.TrainType === departure.TrainType)?.TravelTimes.find(t => t.FromStationID === from && t.ToStationID === to)?.RunTime;
                if (!duration || !Number.isFinite(duration) || duration <= 0) continue;
                const time = timestamp(serviceDate, departure.DepartureTime);
                if (!Number.isFinite(time) || time < Date.parse(`${date}T00:00:00+08:00`)) continue;
                const id = `tymc:${serviceDate}:${from}:${to}:${time}:${type}`;
                result.set(id, { trip: id, number: "", operator: "tymc", service: type === "express" ? "機捷直達車" : "機捷普通車", origin, destination, departure: time, arrival: time + duration * 1000, estimatedArrival: true });
            }
        }
    }
    return [...result.values()].sort((a, b) => a.departure - b.departure);
}

export function connectMetro(rail: Journey[], metro: Leg[], reversed: boolean, date: string, maxMinutes: number): Journey[] {
    const start = Date.parse(`${date}T00:00:00+08:00`), end = start + 86400000;
    const journeys: Journey[] = [];
    for (const trip of rail) {
        for (const leg of metro) {
            const gap = (reversed ? trip.departure - leg.arrival : leg.departure - trip.arrival) / 60000;
            if (gap < 10 || gap >= maxMinutes) continue;
            const departure = reversed ? leg.departure : trip.departure;
            if (departure < start || departure >= end) continue;
            journeys.push({ id: `${trip.id}|${leg.trip}`, departure, arrival: reversed ? trip.arrival : leg.arrival, legs: reversed ? [leg, ...trip.legs] : [...trip.legs, leg] });
        }
    }
    // Keep the earliest onward / latest feeder of each service type per rail combination.
    return journeys.filter(j => !journeys.some(other => other !== j
        && other.legs.filter(l => l.operator !== "tymc").map(l => l.trip).join() === j.legs.filter(l => l.operator !== "tymc").map(l => l.trip).join()
        && other.legs.find(l => l.operator === "tymc")?.service === j.legs.find(l => l.operator === "tymc")?.service
        && other.departure >= j.departure && other.arrival <= j.arrival
        && (other.departure > j.departure || other.arrival < j.arrival)))
        .sort((a, b) => a.departure - b.departure || a.arrival - b.arrival);
}
