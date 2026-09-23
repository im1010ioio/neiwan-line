import { addDays } from "./domain/query";
import { unpackTimetable, validDayIndex, type TimetableGroup } from "./domain/timetable-format";
import type { RailOperator, Train, DayData } from "./domain/types";
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
/** A bounded session cache; immutable slice URLs change whenever their contents change. */
export function createDayLoader(fetcher: typeof fetch = fetch, base = import.meta.env.BASE_URL, now = Date.now) {
    const indexes = new Map<string, { expires: number; promise: Promise<unknown> }>();
    const slices = new Map<string, Promise<Train[]>>();
    async function json(file: string, immutable = false, force = false): Promise<unknown> {
        const response = await fetcher(`${base}data/${file}`, {
            cache: force ? "reload" : immutable ? "force-cache" : "no-cache",
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`班表 HTTP ${response.status}`);
        return response.json();
    }
    function index(date: string, force: boolean): Promise<unknown> {
        const saved = indexes.get(date);
        if (!force && saved && saved.expires > now()) return saved.promise;
        const promise = json(`${date}.json`);
        indexes.delete(date);
        indexes.set(date, { expires: now() + 60000, promise });
        if (indexes.size > 8) indexes.delete(indexes.keys().next().value!);
        void promise.then(value => {
            // Legacy snapshots are accepted during rollout, but never retained as the new format.
            if (!validDayIndex(value, date) && indexes.get(date)?.promise === promise) indexes.delete(date);
        }, () => { if (indexes.get(date)?.promise === promise) indexes.delete(date); });
        return promise;
    }
    function slice(file: string, date: string, operator: RailOperator, force: boolean): Promise<Train[]> {
        let promise = force ? undefined : slices.get(file);
        if (!promise) promise = json(file, true, force).then(value => unpackTimetable(value, date, operator));
        slices.delete(file);
        slices.set(file, promise);
        if (slices.size > 12) slices.delete(slices.keys().next().value!);
        const current = promise;
        void promise.catch(() => { if (slices.get(file) === current) slices.delete(file); });
        return promise;
    }
    return async (date: string, groups: TimetableGroup[] = ["tra", "thsr"], force = false): Promise<LoadedDay> => {
        try {
            const value = await index(date, force);
            if (validDay(value, date)) return { status: "ready", data: value };
            if (!validDayIndex(value, date)) return { status: "missing" };
            const { files, schemaVersion: _version, ...summary } = value;
            const data: DayData = { ...summary, schemaVersion: 1, trains: [], coverage: { ...summary.coverage },
                contextCoverage: { tra: [...(summary.contextCoverage?.tra ?? [false, false, false])], thsr: [...(summary.contextCoverage?.thsr ?? [false, false, false])] } };
            const parts = await Promise.all(groups.map(async group => {
                const operator = group === "thsr" ? "thsr" : "tra";
                const context = await Promise.all(files[group].map(async (file, i) => {
                    if (!file) return undefined;
                    try { return await slice(file, addDays(date, i - 1), operator, force); } catch { return undefined; }
                }));
                data.coverage[operator] = summary.coverage[operator] && context[1] !== undefined;
                data.contextCoverage![operator] = context.map(trains => trains !== undefined);
                return context.flatMap(trains => trains ?? []);
            }));
            data.trains = parts.flat();
            return { status: "ready", data };
        } catch { return { status: "missing" }; }
    };
}

export async function loadDay(date: string, fetcher: typeof fetch = fetch): Promise<LoadedDay> {
    return createDayLoader(fetcher)(date);
}
