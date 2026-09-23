import { readFile, rename, writeFile } from "node:fs/promises";
import { publishTimetables, readCachedSlices } from "./publish-timetables";
import { projectMetro } from "./project-metro";
import type { Manifest } from "../src/domain/types";

// Offline migration: never contacts TDX or changes the original acquisition timestamps.
const directory = "public/data";
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8")) as Manifest;
const first = JSON.parse(await readFile(`${directory}/${manifest.days[0].file}`, "utf8"));
const slices = await readCachedSlices(directory);
if (!slices.size) throw new Error("沒有可轉換的班表；保留原檔案");
await publishTimetables(directory, slices, manifest.days.map(day => day.date), manifest.generatedAt, first.sources ?? []);
const metroPath = `${directory}/metro.json`;
const metro = projectMetro(JSON.parse(await readFile(metroPath, "utf8")));
await writeFile(`${metroPath}.tmp`, JSON.stringify(metro));
await rename(`${metroPath}.tmp`, metroPath);
console.log(`已離線轉換 ${manifest.days.length} 個查詢日期、${slices.size} 份運具／日期班表；TDX 請求 0 次。`);
