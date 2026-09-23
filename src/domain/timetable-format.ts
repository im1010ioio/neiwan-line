import { addDays } from "./query";
import type { DayData, RailOperator, Train } from "./types";

import { localStations } from "./local-stations";
export { localStations } from "./local-stations";
export type TimetableGroup = "local" | "tra" | "thsr";
export type DaySummary = Omit<DayData, "trains">;
export interface DayIndex extends Omit<DaySummary, "schemaVersion"> {
    schemaVersion: 2;
    files: Record<TimetableGroup, (string | null)[]>;
}
// Station/type dictionaries and time deltas avoid repeating names, field names and epoch timestamps.
// Seconds (including fractions) retain source precision; the first arrival is relative to service midnight.
export interface PackedTimetable {
    schemaVersion: 1;
    date: string;
    operator: RailOperator;
    stations: string[];
    types: [service: string, trainType: string | null, trainTypeId: string | null, reserved: 0 | 1 | 2][];
    trains: [number: string, type: number, stops: number[], customId?: string][];
}
export function timetableGroups(origin: string, destination: string): TimetableGroup[] {
    const endpoints = [origin, destination];
    const needsThsr = endpoints.some(id => id.startsWith("tymc:") || (id.startsWith("thsr:") && id !== "thsr:1030"));
    const mainline = endpoints.some(id => id.startsWith("tra:") && !localStations.has(id));
    return [mainline ? "tra" : "local", ...(needsThsr ? ["thsr" as const] : [])];
}
export function localTrains(trains: Train[]): Train[] {
    return trains.flatMap(train => {
        const first = train.stops.findIndex(stop => localStations.has(stop.station));
        let last = train.stops.length - 1;
        while (last > first && !localStations.has(train.stops[last].station)) last--;
        // Retain every intermediate stop, never join two disconnected movements.
        return first >= 0 && last > first ? [{ ...train, stops: train.stops.slice(first, last + 1) }] : [];
    });
}
export function packTimetable(date: string, operator: RailOperator, trains: Train[]): PackedTimetable {
    const stations: string[] = [], types: PackedTimetable["types"] = [];
    const stationIds = new Map<string, number>(), typeIds = new Map<string, number>();
    const midnight = Date.parse(`${date}T00:00:00+08:00`);
    const packed = trains.map((train): PackedTimetable["trains"][number] => {
        if (train.operator !== operator) throw new Error("班表運具不符");
        const type: PackedTimetable["types"][number] = [train.service, train.trainType ?? null, train.trainTypeId ?? null, train.reserved === undefined ? 2 : train.reserved ? 1 : 0];
        const key = JSON.stringify(type);
        if (!typeIds.has(key)) { typeIds.set(key, types.length); types.push(type); }
        let previous = midnight;
        const stops = train.stops.flatMap(stop => {
            if (!stationIds.has(stop.station)) { stationIds.set(stop.station, stations.length); stations.push(stop.station); }
            const result = [stationIds.get(stop.station)!, (stop.arrival - previous) / 1000, (stop.departure - stop.arrival) / 1000];
            previous = stop.departure;
            return result;
        });
        const row: PackedTimetable["trains"][number] = [train.number, typeIds.get(key)!, stops];
        if (train.id !== `${operator}:${date}:${train.number}`) row.push(train.id);
        return row;
    });
    return { schemaVersion: 1, date, operator, stations, types, trains: packed };
}
export function unpackTimetable(value: unknown, date: string, operator: RailOperator): Train[] {
    const fail = (): never => { throw new Error("班表檔案格式或日期不符"); };
    if (!value || typeof value !== "object") return fail();
    const data = value as PackedTimetable;
    if (data.schemaVersion !== 1 || data.date !== date || data.operator !== operator
        || !Array.isArray(data.stations) || !data.stations.every(s => typeof s === "string" && s.startsWith(`${operator}:`))
        || !Array.isArray(data.types) || !data.types.every(t => Array.isArray(t) && t.length === 4 && typeof t[0] === "string"
            && (t[1] === null || typeof t[1] === "string") && (t[2] === null || typeof t[2] === "string") && [0, 1, 2].includes(t[3]))
        || !Array.isArray(data.trains)) return fail();
    const midnight = Date.parse(`${date}T00:00:00+08:00`);
    if (!Number.isFinite(midnight)) return fail();
    return data.trains.map(row => {
        if (!Array.isArray(row) || row.length < 3 || row.length > 4 || typeof row[0] !== "string"
            || !Number.isInteger(row[1]) || !data.types[row[1]] || (row[3] !== undefined && typeof row[3] !== "string")
            || !Array.isArray(row[2]) || row[2].length < 6 || row[2].length % 3 !== 0) return fail();
        const [number, typeIndex, times, customId] = row;
        const [service, trainType, trainTypeId, reserved] = data.types[typeIndex];
        const stops: Train["stops"] = [];
        let previous = midnight;
        for (let i = 0; i < times.length; i += 3) {
            const [station, delta, dwell] = times.slice(i, i + 3);
            if (!Number.isInteger(station) || data.stations[station] === undefined || !Number.isFinite(delta) || delta < 0
                || !Number.isFinite(dwell) || dwell < 0) return fail();
            const arrival = previous + Math.round(delta * 1000), departure = arrival + Math.round(dwell * 1000);
            if (!Number.isSafeInteger(arrival) || !Number.isSafeInteger(departure)) return fail();
            stops.push({ station: data.stations[station], arrival, departure });
            previous = departure;
        }
        return { id: customId ?? `${operator}:${date}:${number}`, number, operator, service, stops,
            ...(trainType !== null ? { trainType } : {}), ...(trainTypeId !== null ? { trainTypeId } : {}),
            ...(reserved !== 2 ? { reserved: reserved === 1 } : {}) };
    });
}
export function validDayIndex(value: unknown, date: string): value is DayIndex {
    if (!value || typeof value !== "object") return false;
    const day = value as DayIndex;
    return day.schemaVersion === 2 && day.date === date && Number.isFinite(Date.parse(day.generatedAt))
        && typeof day.coverage?.tra === "boolean" && typeof day.coverage?.thsr === "boolean"
        && ["local", "tra", "thsr"].every(group => {
            const files = day.files?.[group as TimetableGroup];
            return Array.isArray(files) && files.length === 3 && files.every((file, i) => file === null
                || (typeof file === "string" && new RegExp(`^slices/${group}-${addDays(date, i - 1)}-[a-f0-9]{16}\\.json$`).test(file)));
        });
}
