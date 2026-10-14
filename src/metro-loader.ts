import { metroCalendarKnown, type MetroSnapshot, type MetroVersion } from "./domain/metro";
let cached: { expires: number; promise: Promise<MetroSnapshot | undefined> } | undefined;
function validVersion(version: MetroVersion): boolean {
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    return Number.isFinite(Date.parse(version.generatedAt))
        && Array.isArray(version.timetables) && version.timetables.length > 0
        && Array.isArray(version.patterns) && version.patterns.length > 0
        && Array.isArray(version.travelTimes) && version.travelTimes.length > 0
        && (!version.validity || (validDate(version.validity.from) && validDate(version.validity.through) && version.validity.from <= version.validity.through))
        && (!version.staleAfter || validDate(version.staleAfter));
}
export async function loadMetro(date: string, force = false): Promise<MetroSnapshot | undefined> {
    if (!metroCalendarKnown(date)) return undefined;
    if (!force && cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
        try {
            const response = await fetch(`${import.meta.env.BASE_URL}data/metro.json`, { cache: "no-cache", signal: AbortSignal.timeout(15000) });
            if (!response.ok) return undefined;
            const data = await response.json() as MetroSnapshot;
            if (!validVersion(data) || (data.future && (!Array.isArray(data.future)
                || data.future.some(version => !version.validity || "future" in version || !validVersion(version))))) return undefined;
            return data;
        } catch { return undefined; }
    })();
    cached = { expires: Date.now() + 60000, promise };
    if (!await promise && cached?.promise === promise) cached = undefined;
    return promise;
}
