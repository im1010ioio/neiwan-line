import { readFile, writeFile, rename } from "node:fs/promises";
import type { Station } from "../src/domain/types";

const url = "https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/0518b833e8964d53bfea3f7691aea0ee";
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`車站資料取得失敗：HTTP ${response.status}`);
const raw: unknown = await response.json();
if (!Array.isArray(raw) || raw.length < 200) throw new Error("車站資料不完整，保留既有版本");
const order = ["1210", "1190", "1191", "1192", "1193", "1201", "1202", "1203", "1204", "1205", "1206", "1207", "1208"];
const counties = new Set(["基隆市", "新北市", "臺北市", "桃園市", "新竹縣", "新竹市", "苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "嘉義市", "臺南市", "高雄市", "屏東縣", "臺東縣", "花蓮縣", "宜蘭縣"]);
const railway: Station[] = raw.filter(row => row.stationCode !== "1998").map(row => {
    const county = String(row.stationAddrTw ?? "").slice(0, 3).replace("台", "臺");
    if (!/^\d{4}$/.test(row.stationCode) || typeof row.stationName !== "string" || !counties.has(county)) throw new Error("車站格式變更，請人工檢查官方資料");
    const index = order.indexOf(row.stationCode);
    return { id: `tra:${row.stationCode}`, name: row.stationName, operator: "tra", county, ...(index >= 0 ? { neiwanOrder: index } : {}) };
});
if (new Set(railway.map(s => s.id)).size !== railway.length || order.some(id => !railway.some(s => s.id === `tra:${id}`))) throw new Error("車站代碼重複或缺少內灣線車站");
// THSR's twelve stable stations are reviewed manually; do not consume TDX quota for each visitor.
const current: Station[] = JSON.parse(await readFile("src/stations.json", "utf8"));
await writeFile("src/stations.json.tmp", JSON.stringify([...railway, ...current.filter(s => s.operator === "thsr")], null, 4) + "\n");
await rename("src/stations.json.tmp", "src/stations.json");
console.log(`已更新 ${railway.length} 個台鐵客運車站。高鐵站表維持既有版本。`);
