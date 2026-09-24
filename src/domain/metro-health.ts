import { metroCalendarKnown, metroLegs, type MetroSnapshot } from "./metro";
import { addDays, dateInTaipei } from "./query";
import { QUERY_DAYS } from "./schedule-window";

export function metroHealth(snapshot: MetroSnapshot | undefined, date: string, now = new Date()) {
    if (!metroCalendarKnown(date)) return { warning: true, usable: false, text: "機捷：所選日期的假日日曆尚未建置，暫不提供行程。" };
    if (!snapshot) return { warning: true, usable: false, text: "機捷：班表暫時無法取得。" };
    if (snapshot.validity && (date < snapshot.validity.from || date > snapshot.validity.through)) {
        return { warning: true, usable: false, text: "機捷：所選日期超出資料適用期間，暫不提供行程。" };
    }
    const available = ["A18", "A12"].every((from, i) => metroLegs(snapshot, `tymc:${from}`, `tymc:${i ? "A18" : "A12"}`, date, "all").some(leg => leg.departure < Date.parse(`${addDays(date, 1)}T00:00:00+08:00`)));
    if (!available) return { warning: true, usable: false, text: "機捷：所選日期缺少行駛資料，暫不提供行程。" };
    const stale = Boolean(snapshot.updateFailedAt) || dateInTaipei(new Date(snapshot.generatedAt)) < dateInTaipei(now);
    const validity = snapshot.validity ? `適用至 ${snapshot.validity.through}。` : "來源未提供適用期間，依常態行駛規則推算；未來班次仍可能調整。";
    return { warning: stale, usable: true, text: `機捷：${snapshot.updateFailedAt ? "最近更新失敗，沿用上次資料。" : stale ? "今天尚未更新，沿用上次資料。" : "今日資料已取得。"}${validity}` };
}

/** Validate every selectable service day and all station/direction pairs via A18. */
export function validateMetro(snapshot: MetroSnapshot, previous: MetroSnapshot | undefined, today: string): void {
    const stations = new Set(snapshot.timetables.map(row => row.StationID));
    const expectedStations = [...Array.from({ length: 22 }, (_, i) => `A${i + 1}`).filter(id => id !== "A14"), "A14a"];
    if (expectedStations.some(station => !stations.has(station))) throw Error("機捷車站資料不完整");
    for (const row of snapshot.timetables) {
        if (!row.ServiceDay || row.Timetables.some(time => !/^(?:[01]\d|2[0-6]):[0-5]\d(?::[0-5]\d)?$/.test(time.DepartureTime))) throw Error("機捷行駛規則或發車時間異常");
    }
    for (const row of snapshot.travelTimes) for (const time of row.TravelTimes) {
        if (!Number.isFinite(time.RunTime) || time.RunTime <= 0 || time.RunTime > 10800) throw Error("機捷旅行時間異常");
    }
    const count = (s: MetroSnapshot) => s.timetables.reduce((sum, row) => sum + row.Timetables.length, 0);
    if (previous && count(snapshot) < count(previous) * 0.7) throw Error("機捷班次減少超過三成，需人工確認");
    for (let offset = 0; offset <= QUERY_DAYS; offset++) {
        const date = addDays(today, offset);
        if (!metroCalendarKnown(date)) throw Error(`機捷假日日曆缺少 ${date}`);
        for (const station of stations) {
            if (station === "A18") continue;
            for (const [from, to] of [[station, "A18"], ["A18", station]]) {
                const legs = metroLegs(snapshot, `tymc:${from}`, `tymc:${to}`, date, "all")
                    .filter(leg => leg.departure < Date.parse(`${addDays(date, 1)}T00:00:00+08:00`));
                if (!legs.length) throw Error(`機捷 ${date} ${from}→${to} 缺少班次`);
                if (previous) {
                    const old = metroLegs(previous, `tymc:${from}`, `tymc:${to}`, date, "all")
                        .filter(leg => leg.departure < Date.parse(`${addDays(date, 1)}T00:00:00+08:00`));
                    if (old.length && legs.length < old.length * 0.7) throw Error(`機捷 ${from}→${to} 班次異常減少`);
                }
            }
        }
    }
}
