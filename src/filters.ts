import type { MetroService } from "./domain/metro";
import { stationById } from "./stations";
import type { StorageLike } from "./preferences";
export const FILTERS_KEY = "neiwan.filters.v1";
export interface Filters {
    metroService?: MetroService;
    reservedOnly: boolean;
    directOutbound: boolean;
    directReturn: boolean;
}
export function loadFilters(storage?: StorageLike): Filters {
    const defaults: Filters = { reservedOnly: true, directOutbound: false, directReturn: false };
    try {
        const saved = JSON.parse(storage?.getItem(FILTERS_KEY) ?? "null");
        if (["all", "express", "local"].includes(saved?.metroService)) defaults.metroService = saved.metroService;
        for (const key of ["reservedOnly", "directOutbound", "directReturn"] as const) {
            if (typeof saved?.[key] === "boolean") defaults[key] = saved[key];
        }
    } catch { /* Restore valid defaults when local storage is unavailable. */ }
    return defaults;
}
export function saveFilters(storage: StorageLike | undefined, filters: Filters): boolean {
    try {
        storage?.setItem(FILTERS_KEY, JSON.stringify(filters));
        return Boolean(storage);
    } catch { return false; }
}

export function filterAvailability(neiwan: string, other: string) {
    function branch(id: string): string {
        if (id === "tra:1193") return "junction";
        if (id.startsWith("thsr:") || id.startsWith("tymc:") || id === "tra:1194") return "liujia";
        const order = stationById.get(id)?.neiwanOrder;
        return order !== undefined && order > 4 ? "neiwan" : "mainline";
    }
    const a = branch(neiwan), b = branch(other);
    return {
        reserved: other.startsWith("tra:") && stationById.get(other)?.neiwanOrder === undefined && other !== "tra:1194",
        direct: a !== "junction" && b !== "junction" && a !== "liujia" && b !== "liujia" && a !== b,
    };
}
