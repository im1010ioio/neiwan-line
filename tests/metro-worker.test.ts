import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Train } from "../src/domain/types";
import snapshot from "../public/data/metro.json";

const mocks = vi.hoisted(() => ({ loadDay: vi.fn(), loadMetro: vi.fn() }));
vi.mock("../src/data-loader", () => ({ createDayLoader: () => mocks.loadDay }));
vi.mock("../src/metro-loader", () => ({ loadMetro: mocks.loadMetro }));

const date = "2026-09-22";
const at = (time: string) => Date.parse(`${date}T${time}:00+08:00`);
const train = (id: string, operator: "tra" | "thsr", stops: [string, string][]): Train => ({ id, number: id, operator, service: id, stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })) });

beforeEach(() => {
    vi.resetModules();
    mocks.loadDay.mockReset();
    mocks.loadMetro.mockReset().mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${date}T12:00:00+08:00`));
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function query(origin: string, destination: string, trains: Train[]) {
    const worker = { onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>), postMessage: vi.fn() };
    vi.stubGlobal("self", worker);
    mocks.loadDay.mockResolvedValue({ status: "ready", data: { coverage: { tra: true, thsr: true }, trains } });
    await import("../src/planner.worker");
    await worker.onmessage!({ data: { id: 1, origin, destination, date } });
    return worker.postMessage.mock.calls[0][0];
}

it("缺少機捷班表時仍能查詢往 A18 的高鐵與步行行程", async () => {
    const trains = [train("N", "tra", [["tra:1208", "07:30"], ["tra:1193", "08:00"]]), train("L", "tra", [["tra:1193", "08:05"], ["tra:1194", "08:10"]]), train("H", "thsr", [["thsr:1030", "08:25"], ["thsr:1020", "09:00"]])];
    const result = await query("tra:1208", "tymc:A18", trains);
    expect(result).toMatchObject({ status: "ready", journeys: [{ arrival: at("09:10"), accessWalk: { destination: "tymc:A18" } }] });
    expect(mocks.loadMetro).not.toHaveBeenCalled();
});

it("A18 回程步行同樣不依賴機捷班表", async () => {
    const trains = [train("H", "thsr", [["thsr:1020", "08:30"], ["thsr:1030", "09:00"]]), train("L", "tra", [["tra:1194", "09:10"], ["tra:1193", "09:15"]]), train("N", "tra", [["tra:1193", "09:20"], ["tra:1208", "10:00"]])];
    const result = await query("tymc:A18", "tra:1208", trains);
    expect(result).toMatchObject({ status: "ready", journeys: [{ departure: at("08:20"), accessWalk: { origin: "tymc:A18" } }] });
    expect(mocks.loadMetro).not.toHaveBeenCalled();
});

it("其他機捷目的地仍須通過班表健康檢查", async () => {
    const result = await query("tra:1208", "tymc:A12", []);
    expect(result).toMatchObject({ status: "missing", metro: { usable: false } });
    expect(mocks.loadMetro).toHaveBeenCalledWith(date, false);
});

it("沒有適用期間且超過七天未更新的機捷班表在查詢端停止使用", async () => {
    mocks.loadMetro.mockResolvedValue({ ...snapshot, generatedAt: "2026-09-14T12:00:00+08:00", validity: undefined, future: undefined });
    const result = await query("tra:1208", "tymc:A12", []);
    expect(result).toMatchObject({ status: "missing", metro: { usable: false, text: expect.stringContaining("超過 7 天") } });
    expect(result.journeys).toBeUndefined();
});
