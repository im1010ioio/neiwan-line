import { createHash } from "node:crypto";
import type { MetroSnapshot, MetroVersion } from "../src/domain/metro";
import { metroSnapshotForDate } from "../src/domain/metro";
import { assessMetro } from "../src/domain/metro-health";
import { addDays } from "../src/domain/query";
import { projectMetro } from "./project-metro";

type Departure = MetroVersion["timetables"][number]["Timetables"][number];
export interface MetroCorrection {
    station: string;
    direction: number;
    destination: string;
    serviceTag: string;
    departure: string;
    expected: { TrainType: number; StoppingPatternID: string };
    replacement: Partial<Pick<Departure, "StoppingPatternID" | "DestinationStationID" | "RunTimeByDestination" | "ServiceName">>;
}
export interface MetroReview {
    sourceHash: string;
    reviewedAt: string;
    reason: string;
    sources: string[];
    validity: { from: string; through: string };
    corrections?: MetroCorrection[];
    patterns?: MetroVersion["patterns"];
}
export interface MetroUpdateReport {
    generatedAt: string;
    sourceHash: string;
    status: "accepted" | "scheduled" | "needs-review" | "invalid";
    errors: string[];
    changes: ReturnType<typeof assessMetro>["changes"];
    review?: Pick<MetroReview, "reviewedAt" | "reason" | "sources" | "validity">;
    corrections: number;
}

/** Ignore feed refresh metadata; bind reviews to all operational content, including arrival times. */
export function metroSourceHash(raw: unknown): string {
    const volatile = new Set(["generatedAt", "updateFailedAt", "UpdateTime", "SrcUpdateTime", "VersionID"]);
    const canonical = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).filter(([key, item]) => !volatile.has(key) && item !== undefined)
                .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
        }
        return value;
    };
    return createHash("sha256").update(JSON.stringify(canonical(raw))).digest("hex");
}

function validDate(date: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
        && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

/** TYMC is a linear line. Only fill an omitted direction when both endpoints establish it. */
export function normalizeMetroDirections(raw: MetroVersion): MetroVersion {
    const next = structuredClone(raw);
    const stations = [...Array.from({ length: 22 }, (_, i) => `A${i + 1}`).filter(id => id !== "A14"), "A14a"]
        .sort((a, b) => Number(a.slice(1).replace("a", ".5")) - Number(b.slice(1).replace("a", ".5")));
    for (const row of next.timetables) {
        if (row.Direction !== undefined) continue;
        const from = stations.indexOf(row.StationID), to = stations.indexOf(row.DestinationStaionID);
        if (from >= 0 && to >= 0 && from !== to) row.Direction = from < to ? 0 : 1;
    }
    return next;
}

export function applyMetroReview(raw: MetroVersion, review: MetroReview): MetroVersion {
    if (metroSourceHash(raw) !== review.sourceHash) throw Error("機捷核實紀錄不符合這次取得的資料版本");
    if (!Number.isFinite(Date.parse(review.reviewedAt)) || !review.reason.trim() || !review.sources.length
        || review.sources.some(url => !url.startsWith("https://"))
        || !validDate(review.validity.from) || !validDate(review.validity.through)
        || review.validity.from > review.validity.through) throw Error("機捷核實紀錄缺少有效日期或官方依據");
    const next = normalizeMetroDirections(raw);
    next.validity = { ...review.validity };
    for (const pattern of review.patterns ?? []) {
        if (next.patterns.some(existing => existing.StoppingPatternID === pattern.StoppingPatternID)) throw Error("機捷核實修正不得覆寫既有停靠模式");
        next.patterns.push(structuredClone(pattern));
    }
    for (const correction of review.corrections ?? []) {
        const allowed = new Set(["StoppingPatternID", "DestinationStationID", "RunTimeByDestination", "ServiceName"]);
        if (Object.keys(correction.replacement).some(key => !allowed.has(key))) throw Error("機捷核實修正不得新增或變更發車時刻");
        const matches = next.timetables.filter(row => row.StationID === correction.station && row.Direction === correction.direction
            && row.DestinationStaionID === correction.destination && row.ServiceDay.ServiceTag === correction.serviceTag)
            .flatMap(row => row.Timetables.filter(time => time.DepartureTime === correction.departure
                && time.TrainType === correction.expected.TrainType && time.StoppingPatternID === correction.expected.StoppingPatternID));
        if (matches.length !== 1) throw Error(`機捷核實修正無法唯一對應 ${correction.station} ${correction.serviceTag} ${correction.departure}`);
        Object.assign(matches[0], structuredClone(correction.replacement));
    }
    return next;
}

/** Preserve operating-day versions around a change, including the previous day's after-midnight trains. */
export function mergeMetroVersions(previous: MetroSnapshot | undefined, candidate: MetroVersion, today: string): MetroSnapshot {
    const base = structuredClone(candidate);
    delete base.updateFailedAt;
    const prior = previous ? [previous, ...(previous.future ?? [])].map(version => {
        const { future: _future, ...plain } = version as MetroSnapshot;
        return structuredClone(plain);
    }) : [];
    const from = candidate.validity?.from ?? today;
    const retained = (candidate.validity ? prior : []).filter(version => !version.validity || version.validity.from < from).flatMap(version => {
        const through = version.validity?.through && version.validity.through < from ? version.validity.through : addDays(from, -1);
        if (through < addDays(today, -1)) return [];
        if (version.validity) version.validity.through = through;
        else version.staleAfter = through;
        return [version];
    });
    const later = prior.filter(version => version.validity && version.validity.from > from && version.validity.through >= today);
    // An unqualified feed must not overwrite an explicitly dated active/future timetable.
    if (!candidate.validity && previous) {
        const active = metroSnapshotForDate(previous, today);
        if (active?.validity) throw Error("新機捷來源未提供適用日期，無法覆蓋已核實的有效班表，需核對改班期間");
    }
    const versions = [...retained, base, ...later].sort((a, b) => (a.validity?.from ?? "").localeCompare(b.validity?.from ?? ""));
    const first = versions.shift()!;
    delete first.updateFailedAt;
    return { ...first, ...(versions.length ? { future: versions } : {}) };
}

/** A review approves a specific change, never malformed data or a future unreviewed version. */
export function prepareMetroUpdate(raw: MetroVersion, previous: MetroSnapshot | undefined, today: string, reviews: MetroReview[]) {
    const sourceHash = metroSourceHash(raw);
    const report: MetroUpdateReport = { generatedAt: raw.generatedAt, sourceHash, status: "invalid", errors: [], changes: [], corrections: 0 };
    let candidate = raw;
    try {
        const knownReviews = reviews.filter(review => review.sourceHash === sourceHash);
        const matches = knownReviews.filter(review => review.validity.through >= today);
        if (knownReviews.length && !matches.length) throw Error("機捷此資料版本的已核實適用期間已到期，需取得新班表或核實新的適用期間");
        if (matches.length > 1) throw Error("機捷同一資料版本有重複核實紀錄");
        const review = matches[0];
        if (review) {
            candidate = applyMetroReview(raw, review);
            report.review = { reviewedAt: review.reviewedAt, reason: review.reason, sources: review.sources, validity: review.validity };
            report.corrections = review.corrections?.length ?? 0;
        } else candidate = normalizeMetroDirections(raw);
        const assessmentDate = candidate.validity && candidate.validity.from > today ? candidate.validity.from : today;
        // Validate the full source before projection can discard non-A18 patterns.
        const sourceAssessment = assessMetro(candidate, undefined, assessmentDate);
        report.errors.push(...sourceAssessment.errors);
        if (report.errors.length) return { report };
        const projected = projectMetro(candidate);
        const snapshot = mergeMetroVersions(previous, projected, today);
        const assessment = assessMetro(snapshot, previous, assessmentDate);
        report.errors.push(...assessment.errors);
        report.changes = assessment.changes;
        if (report.errors.length) return { report };
        if (report.changes.length && !review) {
            report.status = "needs-review";
            return { report };
        }
        report.status = candidate.validity && candidate.validity.from > today ? "scheduled" : "accepted";
        return { snapshot, report };
    } catch (error) {
        report.errors.push(error instanceof Error ? error.message : String(error));
        return { report };
    }
}

export function metroReportMarkdown(report: MetroUpdateReport): string {
    const lines = ["## 機捷更新", "", `結果：${report.status}`, `資料指紋：\`${report.sourceHash}\``,
        `已核實欄位修正：${report.corrections} 筆`, ""];
    if (report.review) lines.push(`核實依據：${report.review.reason}`, ...report.review.sources.map(url => `- ${url}`), "");
    if (report.errors.length) lines.push("### 資料錯誤", "", ...report.errors.map(error => `- ${error}`), "");
    if (report.changes.length) lines.push("### 需核對的班表異動", "", "完整日期、方向、班數及首末班差異請下載 metro-update-report 附件。", "", "```json", JSON.stringify(report.changes.slice(0, 12), null, 4), "```");
    return `${lines.join("\n")}\n`;
}
