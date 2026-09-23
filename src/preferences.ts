import { QUERY_DAYS } from "./domain/schedule-window";
import { stationById } from "./stations";
import { addDays } from "./domain/query";
export const PREFERENCES_KEY = "neiwan.preferences.v1";
export interface Preferences {
    neiwan: string;
    other: string;
    reversed: boolean;
    date: string;
    preparation: number;
    traMaxMinutes: number;
    thsrMaxMinutes: number;
    metroMaxMinutes: number;
}
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function defaults(date: string): Preferences {
    return { neiwan: "tra:1208", other: "tra:1210", reversed: false, date, preparation: 25, traMaxMinutes: 30, thsrMaxMinutes: 40, metroMaxMinutes: 40 };
}
export function loadPreferences(storage: StorageLike | undefined, today: string): { value: Preferences; reset: boolean } {
    const value = defaults(today);
    try {
        const text = storage?.getItem(PREFERENCES_KEY);
        if (!text) return { value, reset: false };
        const stored = JSON.parse(text);
        let reset = false;
        if (!stored || typeof stored !== "object") return { value, reset: true };
        if (stationById.get(stored.neiwan)?.neiwanOrder !== undefined) value.neiwan = stored.neiwan;
        else reset = true;
        if (stationById.has(stored.other)) value.other = stored.other;
        else reset = true;
        if (typeof stored.reversed === "boolean") value.reversed = stored.reversed;
        else reset = true;
        if (Number.isInteger(stored.preparation) && stored.preparation >= 0 && stored.preparation <= 180) value.preparation = stored.preparation;
        else reset = true;
        for (const [key, minimum] of [["traMaxMinutes", 6], ["thsrMaxMinutes", 11], ["metroMaxMinutes", 11]] as const) {
            if (stored[key] === undefined) continue;
            if (Number.isInteger(stored[key]) && stored[key] >= minimum && stored[key] <= 180) value[key] = stored[key];
            else reset = true;
        }
        if (stored.metroMaxMinutes === undefined) value.metroMaxMinutes = value.thsrMaxMinutes;
        if (typeof stored.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored.date) && stored.date >= today && stored.date <= addDays(today, QUERY_DAYS - 1)) value.date = stored.date;
        if (value.neiwan === value.other) {
            value.neiwan = "tra:1208";
            value.other = "tra:1210";
            value.reversed = false;
            reset = true;
        }
        return { value, reset };
    } catch {
        return { value, reset: true };
    }
}
export function savePreferences(storage: StorageLike | undefined, value: Preferences): boolean {
    try {
        storage?.setItem(PREFERENCES_KEY, JSON.stringify({ neiwan: value.neiwan, other: value.other, reversed: value.reversed, date: value.date, preparation: value.preparation, traMaxMinutes: value.traMaxMinutes, thsrMaxMinutes: value.thsrMaxMinutes, metroMaxMinutes: value.metroMaxMinutes }));
        return Boolean(storage);
    } catch { return false; }
}
