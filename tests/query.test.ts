import { describe, expect, it } from "vitest";
import { dateInTaipei, dateOptions, filterJourneys, journeyState } from "../src/domain/query";

describe("日期與使用者可見的時間篩選", () => {
    it("以台灣時間建立包含今天的28 天選單並顯示星期", () => {
        const now = new Date("2026-09-20T16:25:00Z");
        expect(dateInTaipei(now)).toBe("2026-09-21");
        expect(dateOptions(now)).toHaveLength(28);
        expect(dateOptions(now).at(-1)).toEqual(["2026-10-18", "2026/10/18 (日)"]);
        expect(dateOptions(now).slice(0, 7)).toEqual([
            ["2026-09-21", "2026/09/21 (一)"], ["2026-09-22", "2026/09/22 (二)"],
            ["2026-09-23", "2026/09/23 (三)"], ["2026-09-24", "2026/09/24 (四)"],
            ["2026-09-25", "2026/09/25 (五)"], ["2026-09-26", "2026/09/26 (六)"],
            ["2026-09-27", "2026/09/27 (日)"],
        ]);
    });
});

const now = new Date("2026-09-21T14:00:00+08:00");
const journeys = ["08:30", "09:00", "14:10", "14:25"].map((time, i) => ({
    id: String(i), departure: Date.parse(`2026-09-21T${time}:00+08:00`), arrival: Date.parse(`2026-09-21T${time}:00+08:00`) + 3600000, legs: [],
}));
it("手動時間與顯示已過組合共同生效，現在出發模式則可查看全天", () => {
    expect(filterJourneys(journeys, { date: "2026-09-21", time: "09:00", showPast: true }, now).map(j => j.id)).toEqual(["1", "2", "3"]);
    expect(filterJourneys(journeys, { date: "2026-09-21", time: "09:00", showPast: false }, now).map(j => j.id)).toEqual(["2", "3"]);
    expect(filterJourneys(journeys, { date: "2026-09-21", time: "now", showPast: true }, now)).toHaveLength(4);
});
it("今日門檻精確判斷，未來班次不顯示即將到來", () => {
    expect(journeyState(journeys[0], "2026-09-21", 25, now)).toBe("past");
    expect(journeyState(journeys[2], "2026-09-21", 25, now)).toBe("warning");
    expect(journeyState(journeys[3], "2026-09-21", 25, now)).toBe("upcoming");
    expect(journeyState({ ...journeys[0], departure: Date.parse("2026-09-22T08:30:00+08:00") }, "2026-09-22", 25, now)).toBe("scheduled");
});
