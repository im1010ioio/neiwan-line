import { QUERY_DAYS, FETCH_DAYS } from "../src/domain/schedule-window";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { addDays, dateInTaipei } from "../src/domain/query";
import { normalizeOds, normalizeTdx, records } from "./normalize";
import { createTdxClient } from "./tdx-client";
import { fillSlices, thsrRefreshKeys } from "./timetable-cache";
import { publishTimetables, readCachedSlices } from "./publish-timetables";
import type { RailOperator, Train } from "../src/domain/types";

const directory = "public/data";
const officialIndexUrl = "https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list";
const today = process.env.DATA_DATE || dateInTaipei();
const generatedAt = new Date().toISOString();
const client = process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET
    ? createTdxClient({ clientId: process.env.TDX_CLIENT_ID, clientSecret: process.env.TDX_CLIENT_SECRET, maxDataRequests: 60 }) : null;
const source = process.env.TRA_SOURCE || "official";
const dates = Array.from({ length: FETCH_DAYS }, (_, i) => addDays(today, i));
const force = process.env.FORCE_REFRESH === "true";
let failed = false;
await mkdir(directory, { recursive: true });

async function get(url: string): Promise<Response> {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`官方資料 HTTP ${response.status}`);
    return response;
}

async function getOfficialIndex(): Promise<string> {
    const retryDelays = [2_000, 5_000];
    for (let attempt = 0; ; attempt++) {
        try {
            return await (await get(officialIndexUrl)).text();
        } catch (error) {
            if (attempt >= retryDelays.length) throw error;
            await delay(retryDelays[attempt]);
        }
    }
}

async function tdxDay(operator: RailOperator, date: string): Promise<Train[]> {
    if (!client) throw new Error("未設定 TDX 憑證");
    const prefix = operator === "tra" ? `/v3/Rail/TRA/DailyTrainTimetable/TrainDate/${date}` : `/v2/Rail/THSR/DailyTimetable/TrainDate/${date}`;
    const trains: Train[] = [];
    for (let skip = 0; ; skip += 1000) {
        const response = await client.getJson(`${prefix}?$format=JSON&$top=1000&$skip=${skip}`);
        const page = normalizeTdx(response, operator, date);
        trains.push(...page);
        if (records(response, ["TrainTimetables", "DailyTimetables"]).length < 1000) break;
    }
    if (!trains.length) throw new Error("尚無完整班表");
    return trains;
}

// Reuse complete operator/date slices, including the final cross-day context.
const cached = await readCachedSlices(directory);
let officialLinks: Map<string, string> | undefined;
if (source === "official") {
    try {
        const html = await getOfficialIndex();
        const links = new Map<string, string>();
        for (const match of html.matchAll(/href=["']([^"']+)["'][^>]*>\s*(\d{8})\.json\s*</g)) {
            links.set(`${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6)}`, new URL(match[1], "https://ods.railway.gov.tw").href);
        }
        if (!links.size) throw new Error("日期清單沒有可辨識的班表連結");
        officialLinks = links;
    } catch (error) {
        console.error(`台鐵官方日期清單取得失敗（${officialIndexUrl}）`, error);
        failed = true;
    }
}
// Published availability may be shorter than the configured query window.
// Check once before filling missing days, rather than requesting unpublished dates.
let thsrDates: Set<string> | undefined;
if (client) {
    try {
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
    refreshKeys: thsrRefreshKeys(cached, dates, thsrDates),
    fetchDay: async (operator, date) => {
        if (operator === "thsr" && thsrDates && !thsrDates.has(date)) throw new Error("高鐵尚未提供此日期班表，待後續補齊");
        let trains: Train[];
        if (operator === "tra" && source === "official") {
            if (!officialLinks) throw new Error("台鐵官方日期清單無法使用");
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
        if (operator === "tra" && source === "official" && !officialLinks) return;
        console.error(`${date} ${operator}: ${String(error)}`);
        if (operator === "thsr" && thsrDates && !thsrDates.has(date)) return;
        if (client || operator === "tra") failed = true;
    },
});
await publishTimetables(directory, slices, dates.slice(0, QUERY_DAYS), generatedAt, [
    source === "official" ? "臺鐵官方開放資料" : "TDX 台鐵", "TDX 高鐵",
]);
console.log(`TDX 資料請求合計 ${client?.dataRequests ?? 0} 次；查詢者共用上述靜態班表。`);
if (failed) process.exitCode = 1;
