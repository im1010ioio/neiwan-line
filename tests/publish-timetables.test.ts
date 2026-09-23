import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { publishTimetables, readCachedSlices } from "../scripts/publish-timetables";
import { fillSlices, type TimetableSlices } from "../scripts/timetable-cache";
import type { Train } from "../src/domain/types";
import type { DayIndex } from "../src/domain/timetable-format";

it("發布後仍能還原逐日快取、原始時間及失敗標記，隔天只抓新增的高鐵日期", async () => {
    const directory = await mkdtemp(join(tmpdir(), "neiwan-publish-"));
    try {
        const slices: TimetableSlices = new Map();
        for (const date of ["2026-09-25", "2026-09-26"]) {
            const time = Date.parse(`${date}T08:00:00+08:00`);
            const train: Train = { id: `thsr:${date}:42`, number: "42", operator: "thsr", service: "高鐵", stops: ["thsr:1030", "thsr:1020"].map((station, i) => ({ station, arrival: time + i * 60000, departure: time + i * 60000 })) };
            slices.set(`thsr:${date}`, { trains: [train], updatedAt: "2026-09-24T00:00:00Z" });
        }
        await publishTimetables(directory, slices, ["2026-09-25"], "2026-09-25T00:00:00Z", []);
        const restored = await readCachedSlices(directory);
        expect(restored).toEqual(slices);
        const calls: string[] = [];
        await fillSlices({ cached: restored, dates: ["2026-09-26", "2026-09-27"], updatedAt: "2026-09-26T00:00:00Z", force: false, refreshOperators: [],
            fetchDay: async (op, date) => { calls.push(`${op}:${date}`); throw new Error("測試用失敗"); }, onFailure: () => {} });
        expect(calls.filter(key => key.startsWith("thsr:"))).toEqual(["thsr:2026-09-27"]);
        const index = JSON.parse(await readFile(`${directory}/2026-09-25.json`, "utf8")) as DayIndex;
        expect(index.operatorUpdatedAt?.thsr).toBe("2026-09-24T00:00:00Z");
        expect(index.files.thsr[2]).toBeTruthy();
        slices.get("thsr:2026-09-25")!.stale = true;
        await publishTimetables(directory, slices, ["2026-09-25"], "2026-09-26T00:00:00Z", []);
        expect((await readCachedSlices(directory)).get("thsr:2026-09-25")?.stale).toBe(true);
        // Corruption invalidates only that date, so recovery does not spend quota on the others.
        await writeFile(`${directory}/${index.files.thsr[1]}`, "{}");
        const partial = await readCachedSlices(directory);
        expect(partial.has("thsr:2026-09-25")).toBe(false);
        expect(partial.has("thsr:2026-09-26")).toBe(true);
        expect((await readdir(`${directory}/slices`)).filter(file => file.endsWith(".tmp"))).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
