import { describe, expect, it } from "vitest";
import snapshot from "../public/data/metro.json";
import { metroHealth, validateMetro } from "../src/domain/metro-health";
import type { MetroSnapshot } from "../src/domain/metro";
const source = snapshot as MetroSnapshot;
const today = "2026-09-24";
const now = new Date("2026-09-24T12:00:00+08:00");
const fresh = () => ({ ...structuredClone(source), generatedAt: now.toISOString() });

describe("機捷更新品質", () => {
    it("下載成功不代表已確認未來有效期間", () => {
        expect(metroHealth(fresh(), today, now)).toMatchObject({ usable: true, warning: false });
        expect(metroHealth(fresh(), today, now).text).toContain("來源未提供適用期間");
        expect(metroHealth({ ...fresh(), updateFailedAt: now.toISOString() }, today, now).warning).toBe(true);
        expect(metroHealth({ ...fresh(), generatedAt: "2026-09-23T00:00:00Z" }, today, now).warning).toBe(true);
    });
    it("缺少日曆、班次或超出適用期間時不計算", () => {
        expect(metroHealth(fresh(), "2099-01-01", now).usable).toBe(false);
        expect(metroHealth(undefined, today, now).usable).toBe(false);
        expect(metroHealth({ ...fresh(), timetables: [] }, today, now).usable).toBe(false);
        expect(metroHealth({ ...fresh(), validity: { from: "2026-09-01", through: "2026-09-23" } }, today, now).usable).toBe(false);
    });
    it("拒絕車站缺漏、異常旅行時間與大量班次減少", () => {
        expect(() => validateMetro({ ...fresh(), timetables: [] }, source, today)).toThrow();
        const invalid = fresh();
        invalid.travelTimes[0].TravelTimes[0].RunTime = -1;
        expect(() => validateMetro(invalid, source, today)).toThrow("旅行時間");
        const reduced = fresh();
        reduced.timetables.forEach(row => row.Timetables = row.Timetables.slice(0, 1));
        expect(() => validateMetro(reduced, source, today)).toThrow("班次減少");
    });
    it("現有資料涵蓋完整查詢範圍與雙向車站", () => {
        expect(() => validateMetro(fresh(), undefined, today)).not.toThrow();
    }, 60000);
});
