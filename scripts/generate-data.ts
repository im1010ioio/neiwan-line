import { QUERY_DAYS, FETCH_DAYS } from "../src/domain/schedule-window";
import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { addDays, dateInTaipei } from "../src/domain/query";
import { normalizeOds, normalizeTdx, records } from "./normalize";
import { createTdxClient } from "./tdx-client";
import { assembleDay, fillSlices, restoreSlices } from "./timetable-cache";
import type { DayData, Manifest, RailOperator, Train } from "../src/domain/types";

const directory = "public/data";
const today = process.env.DATA_DATE || dateInTaipei();
const generatedAt = new Date().toISOString();
const client = process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET
    ? createTdxClient({ clientId: process.env.TDX_CLIENT_ID, clientSecret: process.env.TDX_CLIENT_SECRET }) : null;
const source = process.env.TRA_SOURCE || "official";
const dates = Array.from({ length: FETCH_DAYS }, (_, i) => addDays(today, i));
const force = process.env.FORCE_REFRESH === "true";
let requests = 0;
let failed = false;
await mkdir(directory, { recursive: true });

async function get(url: string): Promise<Response> {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`官方資料 HTTP ${response.status}`);
    return response;
}
async function tdxDay(operator: RailOperator, date: string): Promise<Train[]> {
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

// Reuse complete date slices committed by prior runs, including cross-day context.
const priorDays: DayData[] = [];
for (const file of await readdir(directory)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    try {
        priorDays.push(JSON.parse(await readFile(`${directory}/${file}`, "utf8")));
    } catch { /* Invalid prior files are not used. */ }
}
const cached = restoreSlices(priorDays);
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
// Published availability may be shorter than the configured query window.
// Check once before filling missing days, rather than requesting unpublished dates.
let thsrDates: Set<string> | undefined;
if (client && dates.some(date => force || !cached.has(`thsr:${date}`) || cached.get(`thsr:${date}`)?.stale)) {
    try {
        requests++;
        const availability = await client.getJson("/v2/Rail/THSR/DailyTimetable/TrainDates?$format=JSON") as { TrainDates?: string[] };
        if (!Array.isArray(availability.TrainDates)) throw new Error("高鐵供應日期格式不符");
        thsrDates = new Set(availability.TrainDates);
    } catch (error) {
        console.error(String(error));
        failed = true;
    }
}
const slices = await fillSlices({
    cached, dates, updatedAt: generatedAt, force,
    // TRA's free official feed can still refresh daily without using TDX quota.
    refreshOperators: source === "official" ? ["tra"] : [],
    fetchDay: async (operator, date) => {
        if (operator === "thsr" && thsrDates && !thsrDates.has(date)) throw new Error("高鐵尚未提供此日期班表，待後續補齊");
        let trains: Train[];
        if (operator === "tra" && source === "official") {
            const url = officialLinks.get(date);
            if (!url) throw new Error("台鐵尚未提供此日期");
            trains = normalizeOds(await (await get(url)).json(), date);
        } else {
            trains = await tdxDay(operator, date);
        }
        console.log(`${date} ${operator}: ${trains.length} 個真實車次`);
        return trains;
    },
    onFailure: (operator, date, error) => {
        console.error(`${date} ${operator}: ${String(error)}`);
        if (operator === "thsr" && thsrDates && !thsrDates.has(date)) return;
        if (client || operator === "tra") failed = true;
    },
});
const manifest: Manifest = { generatedAt, days: [] };
for (const date of dates.slice(0, QUERY_DAYS)) {
    const data = assembleDay(date, slices, generatedAt, [
        source === "official" ? "臺鐵官方開放資料" : "TDX 台鐵",
        ...(slices.has(`thsr:${date}`) ? ["TDX 高鐵"] : []),
    ]);
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
