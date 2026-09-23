import { metroCalendarKnown, type MetroSnapshot } from "./domain/metro";
let cached: { expires: number; promise: Promise<MetroSnapshot | undefined> } | undefined;
export async function loadMetro(date: string, force = false): Promise<MetroSnapshot | undefined> {
    if (!metroCalendarKnown(date)) return undefined;
    if (!force && cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
        try {
            const response = await fetch(`${import.meta.env.BASE_URL}data/metro.json`, { cache: "no-cache", signal: AbortSignal.timeout(15000) });
            if (!response.ok) return undefined;
            const data = await response.json() as MetroSnapshot;
            if (!Number.isFinite(Date.parse(data.generatedAt)) || !data.timetables?.length || !data.patterns?.length || !data.travelTimes?.length) return undefined;
            return data;
        } catch { return undefined; }
    })();
    cached = { expires: Date.now() + 60000, promise };
    if (!await promise && cached?.promise === promise) cached = undefined;
    return promise;
}
