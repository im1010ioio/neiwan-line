import type { DayData } from "./domain/types";
export type LoadedDay = { status: "ready"; data: DayData } | { status: "missing" };

export function validDay(value: unknown, date: string): value is DayData {
    if (!value || typeof value !== "object") return false;
    const day = value as DayData;
    return day.schemaVersion === 1 && day.date === date && Number.isFinite(Date.parse(day.generatedAt))
        && typeof day.coverage?.tra === "boolean" && typeof day.coverage?.thsr === "boolean"
        && Array.isArray(day.trains) && day.trains.every(t => typeof t.id === "string"
            && (t.operator === "tra" || t.operator === "thsr") && typeof t.number === "string"
            && typeof t.service === "string" && Array.isArray(t.stops) && t.stops.length >= 2
            && t.stops.every(s => typeof s.station === "string" && Number.isFinite(s.arrival) && Number.isFinite(s.departure) && s.departure >= s.arrival));
}
export async function loadDay(date: string, fetcher: typeof fetch = fetch): Promise<LoadedDay> {
    try {
        const response = await fetcher(`${import.meta.env.BASE_URL}data/${date}.json`, { cache: "no-cache", signal: AbortSignal.timeout(15000) });
        if (!response.ok) return { status: "missing" };
        const data: unknown = await response.json();
        return validDay(data, date) ? { status: "ready", data } : { status: "missing" };
    } catch { return { status: "missing" }; }
}
