import data from "./stations.json";
import type { Station } from "./domain/types";
export const stations: Station[] = data as Station[];
export const stationById = new Map(stations.map(station => [station.id, station]));
export const stationName = (id: string): string => stationById.get(id)?.name ?? id;
export const neiwanStations = stations.filter(s => s.neiwanOrder !== undefined).sort((a, b) => a.neiwanOrder! - b.neiwanOrder!);
export const counties = ["基隆市", "新北市", "臺北市", "桃園市", "新竹縣", "新竹市", "苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "嘉義市", "臺南市", "高雄市", "屏東縣", "臺東縣", "花蓮縣", "宜蘭縣"];
