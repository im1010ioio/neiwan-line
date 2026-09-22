import type { RailOperator, Stop, Train } from "../src/domain/types";

type Row = Record<string, any>;

export function records(value: unknown, keys: string[]): Row[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
        for (const key of keys) {
            const rows = (value as Row)[key];
            if (Array.isArray(rows)) return rows;
        }
    }
    throw new Error("班表資料格式不符，拒絕發布空白班表");
}

function stopsWithDates(rows: Row[], date: string, operator: RailOperator): Stop[] {
    const midnight = Date.parse(`${date}T00:00:00+08:00`);
    let previous = midnight;
    let offset = 0;
    function dated(value: string): number {
        if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value ?? "")) throw new Error("班表缺少有效時間");
        const [h, m, s = 0] = value.split(":").map(Number);
        if (m > 59 || s > 59 || h > 47) throw new Error("班表時間超出範圍");
        let result = midnight + (h * 3600 + m * 60 + s) * 1000 + offset;
        if (result < previous) {
            offset += 86400000;
            result += 86400000;
        }
        previous = result;
        return result;
    }
    return rows.map(row => {
        const arrival = dated(row.ArrivalTime ?? row.ARRTime ?? row.DepartureTime ?? row.DEPTime);
        const departure = dated(row.DepartureTime ?? row.DEPTime ?? row.ArrivalTime ?? row.ARRTime);
        const station = row.StationID ?? row.Station;
        if (!station) throw new Error("班表缺少車站代碼");
        return { station: `${operator}:${station}`, arrival, departure };
    });
}

export function normalizeTdx(response: unknown, operator: RailOperator, date: string): Train[] {
    const declared = (response as Row)?.TrainDate;
    if (declared && declared !== date) throw new Error("班表日期不符");
    return records(response, ["TrainTimetables", "DailyTimetables"]).map(row => {
        if (row.TrainDate && row.TrainDate !== date) throw new Error("班表日期不符");
        const info = row.TrainInfo ?? row.DailyTrainInfo;
        if (!info?.TrainNo || !Array.isArray(row.StopTimes) || row.StopTimes.length < 2) throw new Error("車次資料不完整");
        return {
            id: `${operator}:${date}:${info.TrainNo}`,
            number: String(info.TrainNo), operator,
            reserved: operator === "thsr" || /自強|莒光|復興|普悠瑪|太魯閣/.test(info.TrainTypeName?.Zh_tw ?? ""),
            service: info.TrainTypeName?.Zh_tw ?? (operator === "thsr" ? "高鐵" : "台鐵"),
            stops: stopsWithDates([...row.StopTimes].sort((a, b) => a.StopSequence - b.StopSequence), date, operator),
        };
    });
}

export function normalizeOds(response: unknown, date: string): Train[] {
    return records(response, ["TrainInfos"]).map(row => {
        if (!row.Train || !Array.isArray(row.TimeInfos) || row.TimeInfos.length < 2) throw new Error("台鐵車次格式不完整");
        return {
            id: `tra:${date}:${row.Train}`, number: String(row.Train), operator: "tra",
            reserved: /^(110[0-9A-Z]|111[0-9A-Z]|1120)$/.test(String(row.CarClass)),
            service: String(row.CarClass).startsWith("110") ? "自強號" : String(row.CarClass).startsWith("111") ? "莒光號" : row.CarClass === "1120" ? "復興號" : row.CarClass === "1131" ? "區間車" : row.CarClass === "1132" ? "區間快" : "台鐵",
            stops: stopsWithDates([...row.TimeInfos].sort((a, b) => Number(a.Order) - Number(b.Order)), date, "tra"),
        };
    });
}
