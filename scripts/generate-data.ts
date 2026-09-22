import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { addDays, dateInTaipei } from "../src/domain/query";
import { normalizeOds, normalizeTdx, records } from "./normalize";
import { createTdxClient } from "./tdx-client";
import type { DayData, Manifest, Operator, Train } from "../src/domain/types";

const directory = "public/data";
const today = process.env.DATA_DATE || dateInTaipei();
const generatedAt = new Date().toISOString();
const client = process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET
    ? createTdxClient({ clientId: process.env.TDX_CLIENT_ID, clientSecret: process.env.TDX_CLIENT_SECRET }) : null;
const source = process.env.TRA_SOURCE || "official";
const dates = Array.from({ length: 8 }, (_, i) => addDays(today, i));
const slices = new Map<string, { trains: Train[]; updatedAt: string }>();
let requests = 0;
let failed = false;
await mkdir(directory, { recursive: true });

async function get(url: string): Promise<Response> {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`官方資料 HTTP ${response.status}`);
    return response;
}
async function tdxDay(operator: Operator, date: string): Promise<Train[]> {
    if (!client) throw new Error("未設定 TDX 憑證");
    const prefix = operator === "tra" ? `/v3/Rail/TRA/DailyTrainTimetable/TrainDate/${date}` : `/v2/Rail/THSR/DailyTimetable/TrainDate/${date}`;
    const trains: Train[] = [];
    for (let skip = 0; ; skip += 1000) {
        if (++requests > 60) throw new Error("達到單次更新 60 次 TDX 請求上限");
        const response = await client.getJson(`${prefix}?$format=JSON&$top=1000&$skip=${skip}`);
        const page = normalizeTdx(response, operator, date);
        trains.push(...page);
        if (records(response, ["TrainTimetables", "DailyTimetables"]).length < 1000) break;
    }
    if (!trains.length) throw new Error("尚無完整班表");
    return trains;
}

// Retain yesterday's actual trips for boarding after midnight; never shift today's schedule backward.
for (const file of await readdir(directory)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    try {
        const old: DayData = JSON.parse(await readFile(`${directory}/${file}`, "utf8"));
        for (const operator of ["tra", "thsr"] as const) {
            if (!old.coverage[operator]) continue;
            const trains = old.trains.filter(t => t.operator === operator && t.id.startsWith(`${operator}:${addDays(today, -1)}:`));
            if (trains.length) slices.set(`${operator}:${addDays(today, -1)}`, { trains, updatedAt: old.generatedAt });
        }
    } catch { /* Invalid prior files are not used. */ }
}
let officialLinks = new Map<string, string>();
if (source === "official") {
    try {
        const html = await (await get("https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list")).text();
        for (const match of html.matchAll(/href=["']([^"']+)["'][^>]*>\s*(\d{8})\.json\s*</g)) {
            officialLinks.set(`${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6)}`, new URL(match[1], "https://ods.railway.gov.tw").href);
        }
        if (!officialLinks.size) throw new Error("無法辨識台鐵官方日期清單");
    } catch (error) { console.error(String(error)); failed = true; }
}
for (const date of dates) {
    for (const operator of ["tra", "thsr"] as const) {
        try {
            let trains: Train[];
            if (operator === "tra" && source === "official") {
                const url = officialLinks.get(date);
                if (!url) throw new Error("台鐵尚未提供此日期");
                trains = normalizeOds(await (await get(url)).json(), date);
                if (!trains.length) throw new Error("台鐵班表為空");
            } else {
                trains = await tdxDay(operator, date);
            }
            slices.set(`${operator}:${date}`, { trains, updatedAt: generatedAt });
            console.log(`${date} ${operator}: ${trains.length} 個真實車次`);
        } catch (error) {
            console.error(`${date} ${operator}: ${String(error)}`);
            if (client || operator === "tra") failed = true;
        }
    }
}
const manifest: Manifest = { generatedAt, days: [] };
for (const date of dates.slice(0, 7)) {
    const coverage = { tra: slices.has(`tra:${date}`), thsr: slices.has(`thsr:${date}`) };
    const data: DayData = {
        schemaVersion: 1, date, generatedAt, coverage,
        sources: [source === "official" ? "臺鐵官方開放資料" : "TDX 台鐵", ...(coverage.thsr ? ["TDX 高鐵"] : [])],
        trains: [-1, 0, 1].flatMap(offset => ["tra", "thsr"].flatMap(op => slices.get(`${op}:${addDays(date, offset)}`)?.trains ?? [])),
        contextCoverage: Object.fromEntries(["tra", "thsr"].map(op => [op, [-1, 0, 1].map(offset => slices.has(`${op}:${addDays(date, offset)}`))])) as Record<Operator, boolean[]>,
    };
    // On an upstream failure preserve the previous complete file and its original update time.
    try {
        const old: DayData = JSON.parse(await readFile(`${directory}/${date}.json`, "utf8"));
        for (const op of ["tra", "thsr"] as const) {
            if (!coverage[op] && old.coverage[op]) {
                data.trains.push(...old.trains.filter(t => t.operator === op));
                data.coverage[op] = true;
                data.staleOperators = [...(data.staleOperators ?? []), op];
                data.operatorUpdatedAt = { ...data.operatorUpdatedAt, [op]: old.operatorUpdatedAt?.[op] ?? old.generatedAt };
            }
        }
    } catch { /* No last successful file. */ }
    await writeFile(`${directory}/${date}.tmp`, JSON.stringify(data));
    await rename(`${directory}/${date}.tmp`, `${directory}/${date}.json`);
    manifest.days.push({ date, file: `${date}.json`, generatedAt: data.generatedAt, coverage: data.coverage });
}
await writeFile(`${directory}/manifest.tmp`, JSON.stringify(manifest, null, 4));
await rename(`${directory}/manifest.tmp`, `${directory}/manifest.json`);
for (const file of await readdir(directory)) {
    if (/^\d{4}-\d{2}-\d{2}\.json$/.test(file) && file.slice(0, 10) < addDays(today, -1)) await unlink(`${directory}/${file}`);
}
console.log(`TDX 資料請求合計 ${requests} 次；查詢者共用上述靜態班表。`);
if (failed) process.exitCode = 1;
