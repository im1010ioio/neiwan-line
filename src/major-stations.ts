// TRA special- and first-class stations; sources and review date: docs/station-grades.md.
// Separate from generated station data so timetable/station refreshes preserve this metadata.
const majorStationIds = new Set([
    "tra:1000", // 臺北
    "tra:3300", // 臺中
    "tra:4400", // 高雄
    "tra:7000", // 花蓮
    "tra:0900", // 基隆
    "tra:0930", // 七堵
    "tra:0980", // 南港
    "tra:0990", // 松山
    "tra:1010", // 萬華
    "tra:1020", // 板橋
    "tra:1040", // 樹林
    "tra:1080", // 桃園
    "tra:1100", // 中壢
    "tra:1210", // 新竹
    "tra:1250", // 竹南
    "tra:3160", // 苗栗
    "tra:3230", // 豐原
    "tra:3360", // 彰化
    "tra:3390", // 員林
    "tra:3470", // 斗六
    "tra:4080", // 嘉義
    "tra:4120", // 新營
    "tra:4220", // 臺南
    "tra:4310", // 岡山
    "tra:4340", // 新左營
    "tra:5000", // 屏東
    "tra:5050", // 潮州
    "tra:6000", // 臺東
    "tra:6110", // 玉里
    "tra:7130", // 蘇澳新
    "tra:7190", // 宜蘭
    "tra:7360", // 瑞芳
]);

export const isMajorStation = (id: string): boolean => majorStationIds.has(id);
