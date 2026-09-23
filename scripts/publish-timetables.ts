import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { addDays } from "../src/domain/query";
import { localTrains, packTimetable, unpackTimetable, type DayIndex, type TimetableGroup } from "../src/domain/timetable-format";
import type { DayData, Manifest, RailOperator } from "../src/domain/types";
import { assembleDay, restoreSlices, type TimetableSlices } from "./timetable-cache";

interface SliceCache {
    schemaVersion: 1;
    slices: Record<string, { file: string; updatedAt: string; stale?: boolean }>;
}
async function atomicJson(path: string, data: unknown, indent?: number) {
    await writeFile(`${path}.tmp`, JSON.stringify(data, null, indent));
    await rename(`${path}.tmp`, path);
}
export async function readCachedSlices(directory: string): Promise<TimetableSlices> {
    const legacy: DayData[] = [];
    for (const file of await readdir(directory)) {
        if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
        try { legacy.push(JSON.parse(await readFile(`${directory}/${file}`, "utf8"))); } catch { /* Retry invalid dates. */ }
    }
    const slices = restoreSlices(legacy);
    try {
        const index = JSON.parse(await readFile(`${directory}/slices/index.json`, "utf8")) as SliceCache;
        if (index.schemaVersion !== 1 || !index.slices) return slices;
        for (const [key, entry] of Object.entries(index.slices)) {
            const [operator, date] = key.split(":") as [RailOperator, string];
            if (!/^(tra|thsr):\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(entry.updatedAt))
                || !new RegExp(`^slices/${operator}-${date}-[a-f0-9]{16}\\.json$`).test(entry.file)) continue;
            try {
                const trains = unpackTimetable(JSON.parse(await readFile(`${directory}/${entry.file}`, "utf8")), date, operator);
                if (!trains.length) continue;
                if (Date.parse(slices.get(key)?.updatedAt ?? "") > Date.parse(entry.updatedAt)) continue;
                slices.set(key, { trains, updatedAt: entry.updatedAt, ...(entry.stale ? { stale: true } : {}) });
            } catch { /* A corrupt slice is fetched again, without discarding other cached dates. */ }
        }
    } catch { /* First run or migration from the previous format. */ }
    return slices;
}
export async function publishTimetables(directory: string, slices: TimetableSlices, dates: string[], generatedAt: string, sources: string[]): Promise<Manifest> {
    await mkdir(`${directory}/slices`, { recursive: true });
    const files = new Map<string, string>();
    const cache: SliceCache = { schemaVersion: 1, slices: {} };
    for (const [key, slice] of slices) {
        const [operator, date] = key.split(":") as [RailOperator, string];
        for (const group of (operator === "tra" ? ["tra", "local"] : ["thsr"]) as TimetableGroup[]) {
            const packed = packTimetable(date, operator, group === "local" ? localTrains(slice.trains) : slice.trains);
            const body = JSON.stringify(packed);
            const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
            const file = `slices/${group}-${date}-${hash}.json`;
            await atomicJson(`${directory}/${file}`, packed);
            files.set(`${group}:${date}`, file);
            if (group === operator) cache.slices[key] = { file, updatedAt: slice.updatedAt, ...(slice.stale ? { stale: true } : {}) };
        }
    }
    const manifest: Manifest = { generatedAt, days: [] };
    const indexDates = [...new Set([...dates, ...[...slices.keys()].map(key => key.split(":")[1])])].sort();
    for (const date of indexDates) {
        const { trains: _trains, schemaVersion: _version, ...summary } = assembleDay(date, slices, generatedAt, sources);
        const index: DayIndex = { ...summary, schemaVersion: 2, files: Object.fromEntries(["local", "tra", "thsr"].map(group => [group,
            [-1, 0, 1].map(offset => files.get(`${group}:${addDays(date, offset)}`) ?? null),
        ])) as DayIndex["files"] };
        await atomicJson(`${directory}/${date}.json`, index);
        if (dates.includes(date)) manifest.days.push({ date, file: `${date}.json`, coverage: index.coverage, generatedAt });
    }
    await atomicJson(`${directory}/slices/index.json`, cache);
    await atomicJson(`${directory}/manifest.json`, manifest, 4);
    // Remove superseded payloads only after all indexes have been written.
    const retained = new Set([...files.values()].map(file => file.slice("slices/".length)));
    for (const file of await readdir(`${directory}/slices`)) {
        if (/^(local|tra|thsr)-\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json$/.test(file) && !retained.has(file)) await unlink(`${directory}/slices/${file}`);
    }
    for (const file of await readdir(directory)) {
        if (/^\d{4}-\d{2}-\d{2}\.json$/.test(file) && !indexDates.includes(file.slice(0, 10))) await unlink(`${directory}/${file}`);
    }
    return manifest;
}
