import { mkdir, readFile, writeFile, rename, appendFile } from "node:fs/promises";
import { createTdxClient } from "./tdx-client";
import type { MetroSnapshot, MetroVersion } from "../src/domain/metro";
import { dateInTaipei } from "../src/domain/query";
import { metroReportMarkdown, prepareMetroUpdate, type MetroReview, type MetroUpdateReport } from "./metro-update";

const reportDirectory = "output/metro-update";
const generatedAt = new Date().toISOString();
let previous: MetroSnapshot | undefined;
let report: MetroUpdateReport | undefined;
await mkdir(reportDirectory, { recursive: true });
await mkdir("public/data", { recursive: true });
try { previous = JSON.parse(await readFile("public/data/metro.json", "utf8")); } catch { /* Initial fetch. */ }
try {
    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) throw Error("機捷更新需要 TDX 憑證");
    const reviews = JSON.parse(await readFile("scripts/metro-reviews.json", "utf8")) as MetroReview[];
    const client = createTdxClient({ clientId: process.env.TDX_CLIENT_ID, clientSecret: process.env.TDX_CLIENT_SECRET });
    const timetables = await client.getJson("/v2/Rail/Metro/StationTimeTable/TYMC?$format=JSON") as MetroVersion["timetables"];
    const patterns = await client.getJson("/v2/Rail/Metro/StoppingPattern/TYMC?$format=JSON") as { StoppingPatterns: MetroVersion["patterns"] };
    const travelTimes = await client.getJson("/v2/Rail/Metro/S2STravelTime/TYMC?$format=JSON") as MetroVersion["travelTimes"];
    const raw = { generatedAt, timetables, patterns: patterns.StoppingPatterns, travelTimes };
    await writeFile(`${reportDirectory}/candidate.raw.json`, JSON.stringify(raw));
    const result = prepareMetroUpdate(raw, previous, dateInTaipei(), reviews);
    report = result.report;
    if (!result.snapshot) throw Error(report.errors[0] ?? `機捷 ${report.changes.length} 項班表異動待核實，詳見更新報告`);
    await writeFile(`${reportDirectory}/candidate.json`, JSON.stringify(result.snapshot));
    await writeFile("public/data/metro.tmp", JSON.stringify(result.snapshot));
    await rename("public/data/metro.tmp", "public/data/metro.json");
    console.log(`機捷班表${report.status === "scheduled" ? "已保存，於生效日自動切換" : "更新完成"}，TDX 資料請求 3 次，核實修正 ${report.corrections} 筆。`);
} catch (error) {
    if (!report) report = { generatedAt, sourceHash: "", status: "invalid", errors: [String(error)], changes: [], corrections: 0 };
    if (previous) {
        await writeFile("public/data/metro.tmp", JSON.stringify({ ...previous, updateFailedAt: generatedAt }));
        await rename("public/data/metro.tmp", "public/data/metro.json");
    }
    console.error(error);
    process.exitCode = 1;
} finally {
    if (report) {
        await writeFile(`${reportDirectory}/report.json`, JSON.stringify(report, null, 4));
        const summary = metroReportMarkdown(report);
        await writeFile(`${reportDirectory}/summary.md`, summary);
        if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    }
}
