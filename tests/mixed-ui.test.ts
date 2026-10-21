// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

it("混搭開關傳入搜尋、保存偏好，關閉後還原原有直達篩選", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T08:00:00+08:00"));
    document.body.innerHTML = '<div id="app"></div>';
    const values = new Map([
        ["neiwan.preferences.v1", JSON.stringify({ neiwan: "tra:1208", other: "tra:3300", date: "2026-10-21" })],
        ["neiwan.filters.v1", JSON.stringify({ reservedOnly: true, directOutbound: true })],
    ]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const requests: { filters: { includeThsr: boolean; directOnly: boolean } }[] = [];
    vi.stubGlobal("Worker", class {
        postMessage(request: typeof requests[number]) { requests.push(request); }
    });
    await import("../src/main");
    expect(requests.at(-1)?.filters).toMatchObject({ includeThsr: false, directOnly: true });
    document.querySelector<HTMLInputElement>("#mixed-filter")!.click();
    expect(requests.at(-1)?.filters).toMatchObject({ includeThsr: true, directOnly: false });
    expect(document.querySelector("#direct-filter")).toBeNull();
    expect(JSON.parse(values.get("neiwan.filters.v1")!)).toMatchObject({ includeThsr: true, directOutbound: true });
    document.querySelector<HTMLInputElement>("#mixed-filter")!.click();
    expect(requests.at(-1)?.filters).toMatchObject({ includeThsr: false, directOnly: true });
    expect(document.querySelector<HTMLInputElement>("#direct-filter")!.checked).toBe(true);
});
