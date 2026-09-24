import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { projectMetro } from "./project-metro";
import { createTdxClient } from "./tdx-client";
import type { MetroSnapshot } from "../src/domain/metro";
import { dateInTaipei } from "../src/domain/query";
import { validateMetro } from "../src/domain/metro-health";
let previous: MetroSnapshot | undefined;
try { previous = JSON.parse(await readFile("public/data/metro.json", "utf8")); } catch { /* Initial fetch. */ }
try {
    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) throw Error("機捷更新需要 TDX 憑證");
    const client = createTdxClient({ clientId: process.env.TDX_CLIENT_ID, clientSecret: process.env.TDX_CLIENT_SECRET });
    const timetables = await client.getJson("/v2/Rail/Metro/StationTimeTable/TYMC?$format=JSON") as MetroSnapshot["timetables"];
    const patterns = await client.getJson("/v2/Rail/Metro/StoppingPattern/TYMC?$format=JSON") as { StoppingPatterns: MetroSnapshot["patterns"] };
    const travelTimes = await client.getJson("/v2/Rail/Metro/S2STravelTime/TYMC?$format=JSON") as MetroSnapshot["travelTimes"];
    const snapshot = projectMetro({ generatedAt: new Date().toISOString(), timetables, patterns: patterns.StoppingPatterns, travelTimes });
    validateMetro(snapshot, previous, dateInTaipei());
    await mkdir("public/data", { recursive: true });
    await writeFile("public/data/metro.tmp", JSON.stringify(snapshot));
    await rename("public/data/metro.tmp", "public/data/metro.json");
    console.log("機捷班表更新完成，TDX 資料請求 3 次，所有日期與訪客共用。");
} catch (error) {
    if (previous) {
        await writeFile("public/data/metro.tmp", JSON.stringify({ ...previous, updateFailedAt: new Date().toISOString() }));
        await rename("public/data/metro.tmp", "public/data/metro.json");
    }
    throw error;
}
