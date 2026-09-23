import { expect, it } from "vitest";
import { loadPreferences, savePreferences } from "../src/preferences";
const today = "2026-09-21";
const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
};
it("重新開啟保留站點方向與準備時間，過期日期回今天", () => {
    const store = memory();
    savePreferences(store, { neiwan: "tra:1203", other: "thsr:1000", reversed: true, date: "2026-09-20", preparation: 15, traMaxMinutes: 20, thsrMaxMinutes: 40, metroMaxMinutes: 40 });
    expect(loadPreferences(store, today).value).toEqual({ neiwan: "tra:1203", other: "thsr:1000", reversed: true, date: today, preparation: 15, traMaxMinutes: 20, thsrMaxMinutes: 40, metroMaxMinutes: 40 });
});
it("損壞欄位不清除其他有效偏好，兩端同站則回預設", () => {
    const store = memory();
    savePreferences(store, { neiwan: "bad", other: "thsr:1000", reversed: true, date: today, preparation: 15, traMaxMinutes: 20, thsrMaxMinutes: 40, metroMaxMinutes: 40 });
    expect(loadPreferences(store, today)).toMatchObject({ reset: true, value: { neiwan: "tra:1208", other: "thsr:1000", preparation: 15, reversed: true } });
    savePreferences(store, { neiwan: "tra:1193", other: "tra:1193", reversed: true, date: today, preparation: 15, traMaxMinutes: 20, thsrMaxMinutes: 40, metroMaxMinutes: 40 });
    expect(loadPreferences(store, today).value).toMatchObject({ neiwan: "tra:1208", other: "tra:1210", reversed: false });
});
it("儲存空間被封鎖時仍可查詢，不拋出錯誤", () => {
    const blocked = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); }, removeItem: () => {} };
    expect(loadPreferences(blocked, today).value.neiwan).toBe("tra:1208");
    expect(savePreferences(blocked, loadPreferences(undefined, today).value)).toBe(false);
});
it("篩選偏好分方向儲存，損壞欄位回預設並保留其他有效設定", async () => {
    const { loadFilters, saveFilters, FILTERS_KEY } = await import("../src/filters");
    const store = memory();
    saveFilters(store, { reservedOnly: false, directOutbound: true, directReturn: false });
    expect(loadFilters(store)).toEqual({ reservedOnly: false, directOutbound: true, directReturn: false });
    store.setItem(FILTERS_KEY, JSON.stringify({ reservedOnly: "false", directOutbound: true, previousDestination: "bad" }));
    expect(loadFilters(store)).toEqual({ reservedOnly: true, directOutbound: true, directReturn: false });
});
it("舊偏好沿用預設上限，自訂上限可保存，無效欄位個別還原", () => {
    const store = memory();
    const original = loadPreferences(store, today).value;
    savePreferences(store, { ...original, traMaxMinutes: 30, thsrMaxMinutes: 60 });
    expect(loadPreferences(store, today).value).toMatchObject({ traMaxMinutes: 30, thsrMaxMinutes: 60 });
    store.setItem("neiwan.preferences.v1", JSON.stringify({ ...original, traMaxMinutes: 5, thsrMaxMinutes: 60 }));
    expect(loadPreferences(store, today)).toMatchObject({ reset: true, value: { traMaxMinutes: 30, thsrMaxMinutes: 60 } });
    const { traMaxMinutes, thsrMaxMinutes, ...legacy } = original;
    store.setItem("neiwan.preferences.v1", JSON.stringify(legacy));
    expect(loadPreferences(store, today)).toMatchObject({ reset: false, value: { traMaxMinutes: 30, thsrMaxMinutes: 40 } });
});

it("新使用者預設勾選對號列車，自行取消的選擇則保留", async () => {
    const { loadFilters, saveFilters } = await import("../src/filters");
    const store = memory();
    expect(loadFilters(store).reservedOnly).toBe(true);
    saveFilters(store, { reservedOnly: false, directOutbound: false, directReturn: false });
    expect(loadFilters(store).reservedOnly).toBe(false);
});
it("篩選僅在路線適用時提供，竹中端點及同側車站不提供竹中換車篩選", async () => {
    const { filterAvailability } = await import("../src/filters");
    expect(filterAvailability("tra:1208", "tra:1210")).toEqual({ reserved: false, direct: true });
    expect(filterAvailability("tra:1208", "tra:1203")).toEqual({ reserved: false, direct: false });
    expect(filterAvailability("tra:1193", "tra:1000")).toEqual({ reserved: true, direct: false });
    for (const other of ["tra:1194", "thsr:1000", "thsr:1030"]) {
        expect(filterAvailability("tra:1208", other)).toEqual({ reserved: false, direct: false });
    }
});

it("機捷上限獨立保存，舊設定沿用原高鐵上限，無效值回預設", () => {
    const store = memory();
    const original = loadPreferences(store, today).value;
    expect(original.metroMaxMinutes).toBe(40);
    savePreferences(store, { ...original, thsrMaxMinutes: 50, metroMaxMinutes: 25 });
    expect(loadPreferences(store, today).value).toMatchObject({ thsrMaxMinutes: 50, metroMaxMinutes: 25 });
    const { metroMaxMinutes, ...legacy } = original;
    store.setItem("neiwan.preferences.v1", JSON.stringify({ ...legacy, thsrMaxMinutes: 60 }));
    expect(loadPreferences(store, today)).toMatchObject({ reset: false, value: { thsrMaxMinutes: 60, metroMaxMinutes: 60 } });
    for (const invalid of [10, 181, 12.5, "40"]) {
        store.setItem("neiwan.preferences.v1", JSON.stringify({ ...original, metroMaxMinutes: invalid }));
        expect(loadPreferences(store, today)).toMatchObject({ reset: true, value: { metroMaxMinutes: 40 } });
    }
});


it("保留第28天查詢日期，第29天超出範圍則回到今天", () => {
    const store = memory();
    const original = loadPreferences(undefined, today).value;
    savePreferences(store, { ...original, date: "2026-10-18", reversed: true });
    expect(loadPreferences(store, today).value).toMatchObject({ date: "2026-10-18", reversed: true });
    savePreferences(store, { ...original, date: "2026-10-19", reversed: true });
    expect(loadPreferences(store, today).value).toMatchObject({ date: today, reversed: true });
});
