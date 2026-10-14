import calendar from "../calendar.json";
import { METRO_FALLBACK_DAYS, metroCalendarKnown, metroLegs, metroSnapshotForDate, metroVersionExpired, type MetroSnapshot, type MetroVersion } from "./metro";
import { addDays, dateInTaipei } from "./query";
import { QUERY_DAYS } from "./schedule-window";

export function metroHealth(snapshot: MetroSnapshot | undefined, date: string, now = new Date()) {
    if (!metroCalendarKnown(date)) return { warning: true, usable: false, text: "機捷：所選日期的假日日曆尚未建置，暫不提供行程。" };
    if (!snapshot) return { warning: true, usable: false, text: "機捷：班表暫時無法取得。" };
    const selected = metroSnapshotForDate(snapshot, date);
    if (!selected) {
        const versions = [snapshot, ...(snapshot.future ?? [])];
        if (versions.every(version => version.validity && date < version.validity.from)) {
            return { warning: true, usable: false, text: "機捷：所選日期的班表尚未生效，暫不提供行程。" };
        }
        if (versions.some(version => version.staleAfter && date > version.staleAfter && !version.validity)) {
            return { warning: true, usable: false, text: "機捷：所選日期已超過舊資料保留期限，暫不提供行程。" };
        }
        return { warning: true, usable: false, text: "機捷：所選日期超出資料適用期間，暫不提供行程。" };
    }
    if (metroVersionExpired(selected, now)) {
        return { warning: true, usable: false, text: `機捷：班表已超過 ${METRO_FALLBACK_DAYS} 天未更新，且來源未提供適用期間，暫不提供行程。` };
    }
    const available = ["A18", "A12"].every((from, i) => metroLegs(snapshot, `tymc:${from}`, `tymc:${i ? "A18" : "A12"}`, date, "all").some(leg => leg.departure < Date.parse(`${addDays(date, 1)}T00:00:00+08:00`)));
    if (!available) return { warning: true, usable: false, text: "機捷：所選日期缺少行駛資料，暫不提供行程。" };
    const updateFailed = Boolean(snapshot.updateFailedAt || selected.updateFailedAt);
    const stale = updateFailed || dateInTaipei(new Date(selected.generatedAt)) < dateInTaipei(now);
    const validity = selected.validity ? `適用至 ${selected.validity.through}。` : "來源未提供適用期間，依常態行駛規則推算；未來班次仍可能調整。";
    return { warning: stale, usable: true, text: `機捷：${updateFailed ? "最近更新失敗，沿用上次資料。" : stale ? "今天尚未更新，沿用上次資料。" : "今日資料已取得。"}${validity}` };
}

export interface MetroChange {
    date: string;
    from: string;
    to: string;
    previousCount: number;
    count: number;
    previousFirst?: string;
    first?: string;
    previousLast?: string;
    last?: string;
    reasons: string[];
}

export interface MetroAssessment {
    errors: string[];
    changes: MetroChange[];
}

const expectedStations = [...Array.from({ length: 22 }, (_, i) => `A${i + 1}`).filter(id => id !== "A14"), "A14a"];
const stationIds = new Set(expectedStations);
const serviceDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "NationalHolidays"];
const pairs = expectedStations.filter(station => station !== "A18").flatMap(station => [[station, "A18"], ["A18", station]]);
const stationOrder = (id: string) => Number(id.slice(1).replace("a", ".5"));

function validDate(date: unknown): date is string {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const time = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}

function validTimestamp(timestamp: unknown): boolean {
    return typeof timestamp === "string" && validDate(timestamp.slice(0, 10))
        && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(timestamp)
        && Number.isFinite(Date.parse(timestamp));
}

/** Check source relationships before metroLegs can silently filter an inconsistent departure. */
function validateVersion(version: MetroVersion, label: string, errors: Set<string>): void {
    const fail = (message: string) => errors.add(`機捷 ${label} ${message}`);
    if (!validTimestamp(version.generatedAt)) fail("資料取得時間異常");
    if (version.validity && (!validDate(version.validity.from) || !validDate(version.validity.through)
        || version.validity.from > version.validity.through)) fail("適用期間異常");
    if (version.staleAfter !== undefined && !validDate(version.staleAfter)) fail("舊資料保留期限異常");
    if (!Array.isArray(version.timetables) || !Array.isArray(version.patterns) || !Array.isArray(version.travelTimes)) {
        fail("資料格式異常");
        return;
    }
    const stations = new Set(version.timetables.map(row => row?.StationID));
    if (expectedStations.some(station => !stations.has(station))) fail("車站資料不完整");
    const patterns = new Map<string, string[]>();
    for (const pattern of version.patterns) {
        if (!pattern || typeof pattern.StoppingPatternID !== "string" || !pattern.StoppingPatternID
            || !Array.isArray(pattern.Stations) || pattern.Stations.length < 2) {
            fail("停靠模式格式異常");
            continue;
        }
        if (patterns.has(pattern.StoppingPatternID)) fail(`停靠模式 ${pattern.StoppingPatternID} 重複`);
        const ids = pattern.Stations.map(station => station?.StationID);
        const sequences = pattern.Stations.map(station => station?.Sequence);
        if (ids.some(id => !stationIds.has(id)) || new Set(ids).size !== ids.length
            || sequences.some(sequence => !Number.isInteger(sequence) || sequence <= 0) || new Set(sequences).size !== sequences.length) {
            fail(`停靠模式 ${pattern.StoppingPatternID} 的車站或順序異常`);
            continue;
        }
        patterns.set(pattern.StoppingPatternID, ids.sort((a, b) => stationOrder(a) - stationOrder(b)));
    }
    const durations = new Set<string>();
    const travelTypes = new Set<number>();
    for (const row of version.travelTimes) {
        if (!row || ![1, 2].includes(row.TrainType) || !Array.isArray(row.TravelTimes)) {
            fail("旅行時間格式或車種異常");
            continue;
        }
        if (travelTypes.has(row.TrainType)) fail(`車種 ${row.TrainType} 旅行時間資料重複`);
        travelTypes.add(row.TrainType);
        for (const time of row.TravelTimes) {
            if (!time || !stationIds.has(time.FromStationID) || !stationIds.has(time.ToStationID)
                || time.FromStationID === time.ToStationID || !Number.isFinite(time.RunTime) || time.RunTime <= 0 || time.RunTime > 10800) {
                fail("旅行時間異常");
                continue;
            }
            const key = `${row.TrainType}:${time.FromStationID}:${time.ToStationID}`;
            if (durations.has(key)) fail(`旅行時間 ${key} 重複`);
            durations.add(key);
        }
    }
    for (const row of version.timetables) {
        if (!row || !stationIds.has(row.StationID) || ![0, 1].includes(row.Direction) || !Array.isArray(row.Timetables)) {
            fail("班表車站、方向或格式異常");
            continue;
        }
        if (!row.ServiceDay || serviceDays.some(day => typeof row.ServiceDay[day] !== "boolean")) fail(`${row.StationID} 行駛規則異常`);
        for (const departure of row.Timetables) {
            if (!departure || !/^(?:[01]\d|2[0-6]):[0-5]\d(?::[0-5]\d)?$/.test(departure.DepartureTime)
                || ![1, 2].includes(departure.TrainType)) {
                fail(`${row.StationID} 發車時間或車種異常`);
                continue;
            }
            const stops = patterns.get(departure.StoppingPatternID);
            if (!stops) {
                fail(`${row.StationID} 引用不存在的停靠模式 ${departure.StoppingPatternID}`);
                continue;
            }
            const terminal = departure.DestinationStationID ?? row.DestinationStaionID;
            const originIndex = stops.indexOf(row.StationID), terminalIndex = stops.indexOf(terminal);
            if (originIndex < 0) {
                fail(`${row.StationID} 不在停靠模式 ${departure.StoppingPatternID} 中`);
                continue;
            }
            if (terminalIndex < 0 || (row.Direction === 0 ? terminalIndex <= originIndex : terminalIndex >= originIndex)) {
                fail(`${row.StationID} 終點 ${terminal} 與方向或停靠模式 ${departure.StoppingPatternID} 矛盾`);
                continue;
            }
            if (departure.ServiceName !== undefined && (typeof departure.ServiceName !== "string" || !departure.ServiceName.trim())) {
                fail(`${row.StationID} 班次服務名稱異常`);
            }
            if (departure.RunTimeByDestination !== undefined) {
                if (!departure.RunTimeByDestination || typeof departure.RunTimeByDestination !== "object" || Array.isArray(departure.RunTimeByDestination)) {
                    fail(`${row.StationID} 每班旅行時間格式異常`);
                } else for (const [destination, duration] of Object.entries(departure.RunTimeByDestination)) {
                    const index = stops.indexOf(destination);
                    const reachable = row.Direction === 0 ? index > originIndex && index <= terminalIndex : index < originIndex && index >= terminalIndex;
                    if (index < 0 || !reachable || !Number.isFinite(duration) || duration <= 0 || duration > 10800) {
                        fail(`${row.StationID}→${destination} 每班旅行時間或停靠站異常`);
                    }
                }
            }
            for (const destination of row.StationID === "A18" ? stops : ["A18"]) {
                const destinationIndex = stops.indexOf(destination);
                const reachable = row.Direction === 0
                    ? destinationIndex > originIndex && destinationIndex <= terminalIndex
                    : destinationIndex < originIndex && destinationIndex >= terminalIndex;
                if (destinationIndex >= 0 && reachable && departure.RunTimeByDestination?.[destination] === undefined
                    && !durations.has(`${departure.TrainType}:${row.StationID}:${destination}`)) {
                    fail(`${row.StationID}→${destination} 車種 ${departure.TrainType} 缺少旅行時間`);
                }
            }
        }
    }
}

interface DepartureSummary {
    count: number;
    first?: number;
    last?: number;
}

/** Reuse the journey engine; equivalent operating-day/version combinations share their result. */
function departureSummaries(snapshot: MetroSnapshot) {
    const versions = [snapshot, ...(snapshot.future ?? [])];
    const cache = new Map<string, Map<string, DepartureSummary>>();
    return (date: string): Map<string, DepartureSummary> => {
        const signature = [-1, 0].map(offset => {
            const serviceDate = addDays(date, offset);
            const version = metroSnapshotForDate(snapshot, serviceDate);
            const holiday = (calendar as Record<string, boolean>)[serviceDate];
            const day = holiday === true ? "holiday" : holiday === false ? new Date(`${serviceDate}T12:00:00+08:00`).getUTCDay() : "unknown";
            return `${version ? versions.indexOf(version) : -1}:${day}`;
        }).join("|");
        const cached = cache.get(signature);
        if (cached) return cached;
        const start = Date.parse(`${date}T00:00:00+08:00`);
        const result = new Map<string, DepartureSummary>();
        for (const [from, to] of pairs) {
            const departures = metroLegs(snapshot, `tymc:${from}`, `tymc:${to}`, date, "all")
                .filter(leg => leg.departure < start + 86400000).map(leg => (leg.departure - start) / 60000);
            result.set(`${from}:${to}`, { count: departures.length, first: departures[0], last: departures.at(-1) });
        }
        cache.set(signature, result);
        return result;
    };
}

const clockTime = (minutes: number | undefined): string | undefined => minutes === undefined ? undefined
    : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;

/** Data errors block publication; large changes separately require an exact-candidate review. */
export function assessMetro(snapshot: MetroSnapshot, previous: MetroSnapshot | undefined, today: string): MetroAssessment {
    const errors = new Set<string>();
    const changes: MetroChange[] = [];
    if (!validDate(today)) return { errors: ["機捷檢查日期異常"], changes };
    validateVersion(snapshot, "目前版", errors);
    if (snapshot.future !== undefined && !Array.isArray(snapshot.future)) errors.add("機捷未來版本格式異常");
    else for (const [index, version] of (snapshot.future ?? []).entries()) {
        if (!version.validity) errors.add(`機捷未來版 ${index + 1} 缺少明確適用期間`);
        validateVersion(version, `未來版 ${index + 1}`, errors);
    }
    if (errors.size) return { errors: [...errors], changes };
    const summarize = departureSummaries(snapshot);
    const summarizePrevious = previous ? departureSummaries(previous) : undefined;
    let applicableDays = 0;
    for (let offset = 0; offset <= QUERY_DAYS; offset++) {
        const date = addDays(today, offset);
        if (!metroSnapshotForDate(snapshot, date)) continue;
        applicableDays++;
        if (!metroCalendarKnown(date)) {
            errors.add(`機捷假日日曆缺少 ${date}`);
            continue;
        }
        const current = summarize(date);
        const old = previous && metroSnapshotForDate(previous, date) ? summarizePrevious?.(date) : undefined;
        for (const [from, to] of pairs) {
            const next = current.get(`${from}:${to}`)!;
            if (!next.count) errors.add(`機捷 ${date} ${from}→${to} 缺少班次`);
            const prior = old?.get(`${from}:${to}`);
            if (!prior?.count) continue;
            const reasons: string[] = [];
            if (next.count < prior.count * 0.7) reasons.push("班次減少超過三成");
            if (next.first !== undefined && prior.first !== undefined && Math.abs(next.first - prior.first) >= 60) reasons.push("首班時間異動至少一小時");
            if (next.last !== undefined && prior.last !== undefined && Math.abs(next.last - prior.last) >= 60) reasons.push("末班時間異動至少一小時");
            if (reasons.length) changes.push({ date, from, to, previousCount: prior.count, count: next.count,
                previousFirst: clockTime(prior.first), first: clockTime(next.first), previousLast: clockTime(prior.last), last: clockTime(next.last), reasons });
        }
    }
    if (!applicableDays) errors.add("機捷候選班表在檢查期間沒有適用日期");
    return { errors: [...errors], changes };
}

/** Compatibility entry point for callers that cannot present the assessment separately. */
export function validateMetro(snapshot: MetroSnapshot, previous: MetroSnapshot | undefined, today: string): void {
    const assessment = assessMetro(snapshot, previous, today);
    if (assessment.errors.length) throw Error(assessment.errors.join("；"));
    if (assessment.changes.length) {
        const first = assessment.changes[0];
        throw Error(`機捷 ${first.date} ${first.from}→${first.to} ${first.reasons.join("、")}，需核對官方來源後確認`);
    }
}
