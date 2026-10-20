// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { Journey, Leg } from "../src/domain/types";

const at = (time: string) => Date.parse(`2026-10-20T${time}:00+08:00`);
const leg = (trip: string, departure: string, arrival: string, origin: string, destination: string): Leg => ({ trip, number: trip, operator: "tra", reserved: true, service: "自強", origin, destination, departure: at(departure), arrival: at(arrival) });
const first = leg("A", "09:00", "10:00", "tra:1208", "tra:1210");
const second = leg("B", "10:10", "11:00", "tra:1210", "tra:1000");
const journey: Journey = { id: "test-journey", departure: first.departure, arrival: second.arrival, legs: [first, second] };

function click(selector: string) {
    const element = document.querySelector<HTMLButtonElement>(selector);
    expect(element, selector).not.toBeNull();
    element!.click();
}
function choose(trip: string) {
    const input = [...document.querySelectorAll<HTMLInputElement>('input[name="rideable-train"]')].find(input => input.value === trip)!;
    expect(input).toBeDefined();
    expect(input.disabled).toBe(false);
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
}
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

it("多段切換、目前時間篩選、排除新車次與整卡還原保持一致", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at("08:00")));
    document.body.innerHTML = '<div id="app"></div>';
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
    let worker: WorkerMock;
    class WorkerMock {
        onmessage?: (event: { data: unknown }) => void;
        postMessage = vi.fn();
        constructor() { worker = this; }
    }
    vi.stubGlobal("Worker", WorkerMock);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    await import("../src/main");
    const id = worker!.postMessage.mock.calls[0][0].id;
    const other: Journey = { id: "other", departure: at("12:00"), arrival: at("13:00"), legs: [leg("C", "12:00", "13:00", "tra:1208", "tra:1000")] };
    worker!.onmessage!({ data: { id, status: "ready", journeys: [journey, other], data: { generatedAt: "2026-10-20T00:00:00Z", coverage: { tra: true, thsr: true } } } });
    const respond = (index: number, later: Leg[]) => worker!.onmessage!({ data: { kind: "alternatives", id, journeyId: journey.id, index, alternatives: { earlier: [], later } } });
    const laterB = { ...second, trip: "B-late", number: "B-late", departure: at("11:00"), arrival: at("12:00") };
    click('[data-journey="test-journey"][data-leg="1"]');
    respond(1, [laterB]);
    choose(laterB.trip);
    expect(document.querySelector(".journey-card")!.textContent).toContain("間隔 60 分鐘 · 等待時間超過設定");
    const laterA = { ...first, trip: "A-late", number: "A-late", departure: at("10:00"), arrival: at("10:30") };
    click('[data-journey="test-journey"][data-leg="0"]');
    expect(worker!.postMessage.mock.calls.at(-1)![0].legs[1].trip).toBe(laterB.trip);
    respond(0, [laterA]);
    choose(laterA.trip);
    expect(document.querySelector(".journey-card")!.textContent).toContain("較晚組合");
    expect(document.querySelector(".journey-card")!.textContent).not.toContain("目前選擇");
    vi.setSystemTime(new Date(at("09:15")));
    vi.advanceTimersByTime(30000);
    expect(document.querySelector('[data-journey="test-journey"]')).not.toBeNull();
    click('[data-journey="other"][data-leg="0"]');
    expect(worker!.postMessage.mock.calls.at(-1)![0].usedTrips).toEqual(expect.arrayContaining(["A-late", "B-late", "A", "B"]));
    click("#close-other-trains");
    click('[data-journey="test-journey"][data-leg="1"]');
    respond(1, [laterB]);
    const best = document.querySelector<HTMLInputElement>('input[value="B"]')!;
    expect(best.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="B-late"]')!.checked).toBe(true);
    expect(document.getElementById("incompatible-train-note")!.textContent).toContain("無法銜接");
    click("#close-other-trains");
    // Restore at a time when both the original and edited first trains are visible.
    vi.setSystemTime(new Date(at("08:00")));
    click('[data-restore-journey="test-journey"]');
    expect(document.querySelector('[data-restore-journey="test-journey"]')).toBeNull();
    expect(document.querySelector(".journey-card")!.textContent).toContain("間隔 10 分鐘");
    expect(document.querySelector(".journey-card")!.textContent).not.toContain("B-late");
    expect(document.querySelector(".journey-card")!.textContent).not.toContain("較晚組合");
});
