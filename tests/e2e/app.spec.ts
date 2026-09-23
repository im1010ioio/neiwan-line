import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.route("https://font.emtech.cc/**", route => route.fulfill({ contentType: "text/css", body: "" }));
    await page.clock.setFixedTime(new Date("2026-09-21T08:00:00+08:00"));
    await page.route("**/data/*.json", async route => {
        const date = /([0-9]{4}-[0-9]{2}-[0-9]{2})\.json/.exec(route.request().url())?.[1] ?? "2026-09-21";
        const times = ["07:00", "08:10", "08:25", "09:00"];
        await route.fulfill({ json: { schemaVersion: 1, date, generatedAt: "2026-09-21T04:30:00+08:00", coverage: { tra: true, thsr: true }, sources: ["自動化測試專用資料"], trains: times.map((time, i) => {
            const departure = Date.parse(`${date}T${time}:00+08:00`);
            return { id: `test-${i}`, number: `TEST-${i}`, operator: "tra", service: "測試車次", stops: [{ station: "tra:1208", arrival: departure, departure }, { station: "tra:1210", arrival: departure + 3600000, departure: departure + 3600000 }] };
        }) } });
    });
    await page.route("**/www.googletagmanager.com/**", route => route.fulfill({ contentType: "application/javascript", body: "/* Test boundary: do not contact Google. */" }));
    await page.goto("/");
});
test("預設選站、雙向交換與重新開啟還原", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "內灣線轉乘攻略", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "選擇起站：內灣" })).toBeVisible();
    await page.getByRole("button", { name: "選擇迄站：新竹" }).click();
    await page.getByRole("tab", { name: "高鐵", exact: true }).click();
    await page.getByRole("button", { name: "台北", exact: true }).click();
    await page.getByRole("button", { name: "交換起迄站" }).click();
    await expect(page.getByRole("button", { name: "選擇起站：台北" })).toContainText("高鐵");
    await page.reload();
    await expect(page.getByRole("button", { name: "選擇起站：台北" })).toBeVisible();
    await page.getByRole("button", { name: "選擇迄站：內灣" }).click();
    await expect(page.getByRole("dialog")).not.toContainText("六家");
});


test("今天的狀態、已過組合及指定時間一起運作", async ({ page }) => {
    await expect(page.locator(".journey-card")).toHaveCount(3);
    await expect(page.locator(".badge--warning")).toHaveCount(1);
    await expect(page.locator(".badge--upcoming")).toHaveCount(2);
    await page.getByLabel("顯示已過組合", { exact: true }).check();
    await expect(page.locator(".journey-card")).toHaveCount(4);
    await expect(page.locator(".badge--past")).toHaveCount(1);
    await page.getByLabel("出發時間", { exact: true }).selectOption("09:00");
    await expect(page.locator(".journey-card")).toHaveCount(1);
    await page.reload();
    await expect(page.getByLabel("顯示已過組合", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("出發時間", { exact: true })).toHaveValue("now");
});

test("未來日期顯示星期與預定班次，重新開啟保留日期但回全天", async ({ page }) => {
    await page.getByLabel("出發日期", { exact: true }).selectOption("2026-09-26");
    await expect(page.getByLabel("出發日期", { exact: true }).locator("option:checked")).toHaveText("2026/09/26 (六)");
    await expect(page.locator(".badge--scheduled")).toHaveCount(3);
    await expect(page.locator(".countdown")).toHaveCount(0);
    await expect(page.getByLabel("顯示已過組合", { exact: true })).toHaveCount(0);
    await page.getByLabel("出發時間", { exact: true }).selectOption("09:00");
    await page.reload();
    await expect(page.getByLabel("出發日期", { exact: true })).toHaveValue("2026-09-26");
    await expect(page.getByLabel("出發時間", { exact: true })).toHaveValue("all");
});

test("六家線快捷分類、同站停用與取消選站", async ({ page }) => {
    await page.getByRole("button", { name: "選擇起站：內灣" }).click();
    await page.getByRole("button", { name: "竹中", exact: true }).click();
    await page.getByRole("button", { name: "選擇迄站：新竹" }).click();
    await page.getByRole("button", { name: "六家線 六家・竹中" }).click();
    await expect(page.getByRole("button", { name: "竹中 與起站相同" })).toBeDisabled();
    await expect(page.locator(".station-option")).toHaveCount(2);
    await page.getByRole("button", { name: "新竹縣", exact: true }).click();
    await expect(page.getByRole("button", { name: "竹中 與起站相同" })).toBeDisabled();
    await page.getByRole("tab", { name: "高鐵", exact: true }).click();
    await page.getByRole("button", { name: "關閉選站" }).click();
    await expect(page.getByRole("button", { name: "選擇迄站：新竹" })).toContainText("台鐵");
});

test("拒絕分析後重新開啟不載入 GA，允許與撤回可從設定變更", async ({ page }) => {
    const googleRequests: string[] = [];
    page.on("request", r => { if (/google-analytics|googletagmanager/.test(r.url())) googleRequests.push(r.url()); });
    await expect(page.locator("script[src*='googletagmanager']")).toHaveCount(0);
    await page.getByRole("button", { name: "拒絕", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("complementary", { name: "網站分析選擇" })).toHaveCount(0);
    expect(googleRequests).toEqual([]);
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "允許分析", exact: true }).click();
    await expect(page.locator("script[src*='googletagmanager']")).toHaveCount(1);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("status")).toHaveText("已同意使用 Cookie 與 GA 分析");
    await expect(page.locator("#settings-allow")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("dialog").getByRole("button", { name: "拒絕分析", exact: true }).click();
    await expect(page.locator("script[src*='googletagmanager']")).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("status")).toHaveText("已拒絕 Cookie 與 GA 分析");
    await expect(page.locator("#settings-deny")).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toHaveText("已拒絕 Cookie 與 GA 分析");
});

test("缺少資料與零組合分開提示，狹窄螢幕沒有橫向溢出", async ({ page }) => {
    await page.getByLabel("出發時間", { exact: true }).selectOption("23:00");
    await expect(page.getByRole("heading", { name: "此時段沒有符合轉乘條件的行程" })).toBeVisible();
    await page.route("**/data/*.json", route => route.fulfill({ status: 404, body: "" }));
    await page.getByLabel("出發日期", { exact: true }).selectOption("2026-09-22");
    await expect(page.getByRole("heading", { name: "班表資料尚未齊全" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("直達與竹中轉乘一起顯示，行程卡標示竹中換車間隔", async ({ page }) => {
    await page.route("**/data/*.json", async route => {
        const at = (time: string) => Date.parse(`2026-09-21T${time}:00+08:00`);
        const train = (id: string, stops: [string, string][]) => ({ id, number: id, operator: "tra", service: "測試車次", stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })) });
        await route.fulfill({ json: { schemaVersion: 1, date: "2026-09-21", generatedAt: "2026-09-21T04:30:00+08:00", coverage: { tra: true, thsr: false }, sources: ["自動化測試專用資料"], trains: [
            train("BRANCH", [["tra:1208", "08:10"], ["tra:1193", "08:40"]]),
            train("SHUTTLE", [["tra:1193", "08:45"], ["tra:1210", "09:05"]]),
            train("DIRECT", [["tra:1208", "08:15"], ["tra:1210", "09:00"]]),
        ] } });
    });
    await page.reload();
    await expect(page.locator(".journey-card")).toHaveCount(2);
    await expect(page.locator(".journey-card").first()).toContainText("竹中站內換車");
    await expect(page.locator(".transfer")).toContainText("5 分鐘");
    await expect(page.locator(".journey-card").last()).toContainText("免換車");
    const summary = page.locator(".journey-summary").first();
    const departureBox = (await summary.locator(":scope > strong").first().boundingBox())!;
    const arrivalBox = (await summary.locator(":scope > strong").last().boundingBox())!;
    const arrowBox = (await summary.locator(".summary-line i").boundingBox())!;
    expect(Math.abs(departureBox.y - arrivalBox.y)).toBeLessThan(1);
    expect(Math.abs(departureBox.y + departureBox.height / 2 - arrowBox.y - arrowBox.height / 2)).toBeLessThan(1);

    await page.getByLabel("內灣新竹直達車", { exact: true }).check();
    await expect(page.locator(".journey-card")).toHaveCount(1);
    await expect(page.locator(".journey-card")).toContainText("DIRECT");
    await page.reload();
    await expect(page.getByLabel("內灣新竹直達車", { exact: true })).toBeChecked();
    await expect(page.locator(".journey-card")).toHaveCount(1);
    await page.getByRole("button", { name: "交換起迄站" }).click();
    await expect(page.getByLabel("內灣新竹直達車", { exact: true })).not.toBeChecked();
    await page.getByRole("button", { name: "交換起迄站" }).click();
    await expect(page.getByLabel("內灣新竹直達車", { exact: true })).toBeChecked();
    await page.getByLabel("內灣新竹直達車", { exact: true }).uncheck();
    await expect(page.locator(".journey-card")).toHaveCount(2);
});

test("對號篩選預設勾選且保留接駁，可透過搜尋切換新竹", async ({ page }) => {
    await page.route("**/data/*.json", async route => {
        const at = (time: string) => Date.parse(`2026-09-21T${time}:00+08:00`);
        const train = (id: string, reserved: boolean, stops: [string, string][]) => ({ id, number: id, operator: "tra", reserved, trainType: reserved ? "自強(3000)(EMU3000 型電車)" : undefined, service: reserved ? "自強號" : "區間車", stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })) });
        await route.fulfill({ json: { schemaVersion: 1, date: "2026-09-21", generatedAt: "2026-09-21T04:30:00+08:00", coverage: { tra: true, thsr: false }, sources: ["自動化測試專用資料"], trains: [
            train("BRANCH", false, [["tra:1208", "08:10"], ["tra:1210", "09:00"]]),
            train("LOCAL", false, [["tra:1210", "09:05"], ["tra:1000", "10:00"]]),
            train("EXPRESS", true, [["tra:1210", "09:10"], ["tra:1000", "10:10"]]),
        ] } });
    });
    await page.reload();
    await page.getByRole("button", { name: "拒絕", exact: true }).click();
    await page.getByRole("button", { name: "選擇迄站：新竹" }).click();
    await page.getByRole("button", { name: "臺北市", exact: true }).click();
    await page.getByRole("button", { name: "臺北", exact: true }).click();
    await expect(page.getByLabel("主要幹線僅搭對號列車", { exact: true })).toBeChecked();
    await expect(page.locator(".journey-card")).toContainText("EXPRESS");
    const express = page.locator(".leg-line").filter({ hasText: "EXPRESS" });
    await expect(express.locator(".train-tag")).toHaveText("對號列車");
    await expect(express.locator(".train-number")).toHaveText("EXPRESS 次 自強(3000)(EMU3000 型電車) 無售站票");
    await expect(express.locator(".train-type")).toHaveCSS("display", "inline");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".journey-card")).toContainText("BRANCH");
    await page.getByLabel("主要幹線僅搭對號列車", { exact: true }).uncheck();
    await expect(page.locator(".journey-card")).toContainText("LOCAL");
    await expect(page.getByLabel("僅前往新竹", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "選擇迄站：臺北" }).click();
    await expect(page.getByText("常用車站", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新竹（快捷）", exact: true })).toHaveCount(0);
    await page.getByLabel("搜尋車站", { exact: true }).fill("新竹");
    await page.getByRole("button", { name: "新竹", exact: true }).click();
    await expect(page.getByRole("button", { name: "選擇迄站：新竹" })).toBeVisible();
    await expect(page.getByLabel("主要幹線僅搭對號列車", { exact: true })).toHaveCount(0);
    await expect(page.locator(".journey-card")).not.toContainText("LOCAL");
    await page.reload();
    await expect(page.getByRole("button", { name: "選擇迄站：新竹" })).toBeVisible();
    await page.getByRole("button", { name: "調整轉乘時間" }).click();
    await expect(page.getByLabel("台鐵轉乘上限（分鐘）")).toBeVisible();

});

test("設定轉乘上限後立即重算，重新開啟保留，等於上限不列入", async ({ page }) => {
    await page.route("**/data/*.json", async route => {
        const at = (time: string) => Date.parse(`2026-09-21T${time}:00+08:00`);
        const train = (id: string, stops: [string, string][]) => ({ id, number: id, operator: "tra", service: "測試車次", stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })) });
        await route.fulfill({ json: { schemaVersion: 1, date: "2026-09-21", generatedAt: "2026-09-21T04:30:00+08:00", coverage: { tra: true, thsr: false }, sources: ["自動化測試專用資料"], trains: [
            train("BRANCH", [["tra:1208", "08:10"], ["tra:1193", "08:40"]]),
            train("SHUTTLE", [["tra:1193", "09:05"], ["tra:1210", "09:20"]]),
        ] } });
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "此時段沒有符合轉乘條件的行程" })).toBeVisible();
    await page.getByRole("button", { name: "開啟設定" }).click();
    await page.getByLabel("台鐵轉乘上限（分鐘）").fill("26");
    await page.getByLabel("高鐵接駁上限（分鐘）").fill("60");
    await page.getByRole("button", { name: "儲存設定" }).click();
    await expect(page.locator(".journey-card")).toHaveCount(1);
    await expect(page.locator(".transfer-hint")).toHaveText("調整轉乘時間");
    await page.reload();
    await expect(page.locator(".journey-card")).toHaveCount(1);
    await page.getByRole("button", { name: "開啟設定" }).click();
    await expect(page.getByLabel("台鐵轉乘上限（分鐘）")).toHaveValue("26");
    await expect(page.getByLabel("高鐵接駁上限（分鐘）")).toHaveValue("60");
    await page.getByLabel("台鐵轉乘上限（分鐘）").fill("5");
    await page.getByRole("button", { name: "儲存設定" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("台鐵轉乘上限（分鐘）").fill("25");
    await page.getByRole("button", { name: "儲存設定" }).click();
    await expect(page.getByRole("heading", { name: "此時段沒有符合轉乘條件的行程" })).toBeVisible();
});

test("查無結果可清除車種篩選，保留日期時間與站點", async ({ page }) => {
    await page.getByLabel("出發日期", { exact: true }).selectOption("2026-09-23");
    await page.getByLabel("出發時間", { exact: true }).selectOption("09:00");
    await page.getByRole("button", { name: "選擇迄站：新竹" }).click();
    await page.getByRole("button", { name: "臺北市", exact: true }).click();
    await page.getByRole("button", { name: "臺北", exact: true }).click();
    await page.getByLabel("主要幹線僅搭對號列車", { exact: true }).check();
    await page.getByRole("button", { name: "清除篩選", exact: true }).click();
    await expect(page.getByLabel("主要幹線僅搭對號列車", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("出發日期", { exact: true })).toHaveValue("2026-09-23");
    await expect(page.getByLabel("出發時間", { exact: true })).toHaveValue("09:00");
    await expect(page.getByRole("button", { name: "選擇迄站：臺北" })).toBeVisible();
    await expect(page.getByRole("button", { name: "清除篩選", exact: true })).toHaveCount(0);
});

for (const other of ["tra:1194", "thsr:1000"]) {
    for (const reversed of [false, true]) {
        test(`六家及高鐵不套用已儲存的直達篩選 ${other} reversed=${reversed}`, async ({ page }) => {
            await page.route("**/data/*.json", async route => {
                const at = (time: string) => Date.parse(`2026-09-21T${time}:00+08:00`);
                const train = (id: string, stops: [string, string][]) => ({ id, number: id, operator: id === "HSR" ? "thsr" : "tra", service: "測試車次", stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })) });
                const trains = reversed ? [
                    train("HSR", [["thsr:1000", "08:10"], ["thsr:1030", "08:40"]]),
                    train("SHUTTLE", [["tra:1194", "08:55"], ["tra:1193", "09:00"]]),
                    train("BRANCH", [["tra:1193", "09:05"], ["tra:1208", "09:40"]]),
                ] : [
                    train("BRANCH", [["tra:1208", "08:10"], ["tra:1193", "08:40"]]),
                    train("SHUTTLE", [["tra:1193", "08:45"], ["tra:1194", "08:50"]]),
                    train("HSR", [["thsr:1030", "09:05"], ["thsr:1000", "09:40"]]),
                ];
                await route.fulfill({ json: { schemaVersion: 1, date: "2026-09-21", generatedAt: "2026-09-21T04:30:00+08:00", coverage: { tra: true, thsr: true }, sources: ["自動化測試專用資料"], trains } });
            });
            await page.evaluate(({ other, reversed }) => {
                localStorage.setItem("neiwan.preferences.v1", JSON.stringify({ neiwan: "tra:1208", other, reversed, date: "2026-09-21", preparation: 25, traMaxMinutes: 20, thsrMaxMinutes: 40 }));
                localStorage.setItem("neiwan.filters.v1", JSON.stringify({ reservedOnly: false, directOutbound: true, directReturn: true }));
            }, { other, reversed });
            await page.reload();
            await expect(page.getByLabel("內灣新竹直達車", { exact: true })).toHaveCount(0);
            await expect(page.locator(".journey-card")).toHaveCount(1);
            await expect(page.locator(".journey-card")).toContainText("竹中站內換車");
        });
    }
}

test("主要站標示適用台鐵選單與搜尋，保留同站停用且支援深色模式", async ({ page }, testInfo) => {
    await page.getByRole("button", { name: "拒絕", exact: true }).click();
    await page.getByRole("button", { name: "選擇迄站：新竹" }).click();
    await page.getByRole("button", { name: "臺北市", exact: true }).click();
    await expect(page.locator('.station-option[data-station="tra:1000"]')).toHaveClass(/major-station/);
    await expect(page.locator(".major-station-badge")).toHaveCount(0);
    await page.getByLabel("搜尋車站", { exact: true }).fill("新竹");
    await expect(page.getByRole("button", { name: "新竹", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "北新竹", exact: true }).locator(".major-station-badge")).toHaveCount(0);
    for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({ path: `/tmp/neiwan-major-${testInfo.project.name}-${colorScheme}.png` });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByLabel("搜尋車站", { exact: true }).fill("");
    await page.getByRole("tab", { name: "高鐵", exact: true }).click();
    await expect(page.locator(".major-station-badge")).toHaveCount(0);
    await page.getByRole("button", { name: "關閉選站" }).click();
    await page.getByRole("button", { name: "選擇起站：內灣" }).click();
    await expect(page.getByRole("button", { name: "新竹 與迄站相同", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "新竹 與迄站相同", exact: true })).toContainText("與迄站相同");
});

test("機捷接駁上限獨立設定、舊車種篩選失效且去回程皆套用", async ({ page }, testInfo) => {
    const at = (time: string) => Date.parse(`2026-09-21T${time}:00+08:00`);
    const train = (id: string, operator: string, stops: [string, string][]) => ({ id, number: id, operator, service: id, stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })) });
    await page.route("**/data/2026-09-21.json", route => route.fulfill({ json: {
        schemaVersion: 1, date: "2026-09-21", generatedAt: "2026-09-21T04:30:00+08:00", coverage: { tra: true, thsr: true }, sources: ["自動化測試專用資料"], trains: [
            train("N", "tra", [["tra:1208", "08:10"], ["tra:1193", "08:30"]]),
            train("L", "tra", [["tra:1193", "08:35"], ["tra:1194", "08:40"]]),
            train("H", "thsr", [["thsr:1030", "08:50"], ["thsr:1020", "09:00"]]),
            train("HR", "thsr", [["thsr:1020", "10:30"], ["thsr:1030", "10:40"]]),
            train("LR", "tra", [["tra:1194", "10:50"], ["tra:1193", "10:55"]]),
            train("NR", "tra", [["tra:1193", "11:00"], ["tra:1208", "11:30"]]),
        ],
    } }));
    const ServiceDay = { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true, Saturday: true, Sunday: true, NationalHolidays: true };
    await page.route("**/data/metro.json", route => route.fulfill({ json: {
        generatedAt: "2026-09-21T04:30:00+08:00",
        timetables: [
            { StationID: "A18", Direction: 1, DestinationStaionID: "A12", ServiceDay, Timetables: [{ DepartureTime: "09:10", TrainType: 1, StoppingPatternID: "SP1" }, { DepartureTime: "09:12", TrainType: 2, StoppingPatternID: "SP5" }] },
            { StationID: "A12", Direction: 0, DestinationStaionID: "A18", ServiceDay, Timetables: [{ DepartureTime: "10:00", TrainType: 1, StoppingPatternID: "SP1" }, { DepartureTime: "10:02", TrainType: 2, StoppingPatternID: "SP5" }] },
        ],
        patterns: ["SP1", "SP5"].map(StoppingPatternID => ({ StoppingPatternID, Stations: [{ StationID: "A12", Sequence: 1 }, { StationID: "A18", Sequence: 2 }] })),
        travelTimes: [1, 2].map(TrainType => ({ TrainType, TravelTimes: [{ FromStationID: "A18", ToStationID: "A12", RunTime: 900 }, { FromStationID: "A12", ToStationID: "A18", RunTime: 900 }] })),
    } }));
    await page.getByRole("button", { name: "拒絕", exact: true }).click();
    await page.getByRole("button", { name: "選擇迄站：新竹" }).click();
    await page.getByRole("tab", { name: "機場捷運", exact: true }).click();
    await expect(page.locator(".station-option")).toHaveCount(22);
    await page.getByLabel("搜尋車站", { exact: true }).fill("A12");
    await page.getByRole("button", { name: "A12 機場第一航廈站", exact: true }).click();
    await expect(page.locator(".journey-card")).toHaveCount(2);
    await expect(page.getByLabel("內灣新竹直達車", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("機捷車種", { exact: true })).toHaveCount(0);
    await page.evaluate(() => localStorage.setItem("neiwan.filters.v1", JSON.stringify({ reservedOnly: true, directOutbound: false, directReturn: false, metroService: "express" })));
    await page.reload();
    await expect(page.locator(".journey-card")).toHaveCount(2);
    await page.getByRole("button", { name: "調整轉乘時間" }).click();
    await page.getByLabel("機捷接駁上限（分鐘）").fill("12");
    await expect(page.getByLabel("高鐵接駁上限（分鐘）")).toHaveValue("40");
    await page.getByRole("button", { name: "儲存設定", exact: true }).click();
    await expect(page.locator(".journey-card")).toHaveCount(1);
    await expect(page.locator(".journey-card")).toContainText("機捷普通車");
    await page.reload();
    await page.getByRole("button", { name: "調整轉乘時間" }).click();
    await expect(page.getByLabel("機捷接駁上限（分鐘）")).toHaveValue("12");
    await page.getByLabel("機捷接駁上限（分鐘）").fill("16");
    await page.getByRole("button", { name: "儲存設定", exact: true }).click();
    await page.getByRole("button", { name: "交換起迄站" }).click();
    await expect(page.locator(".journey-card")).toHaveCount(2);
    await page.getByRole("button", { name: "調整轉乘時間" }).click();
    await page.getByLabel("機捷接駁上限（分鐘）").fill("15");
    await page.getByRole("button", { name: "儲存設定", exact: true }).click();
    await expect(page.locator(".journey-card")).toHaveCount(1);
    await expect(page.locator(".journey-card")).toContainText("機捷直達車");
    await page.route("**/data/metro.json", route => route.fulfill({ status: 404, body: "" }));
    await page.reload();
    await expect(page.getByRole("heading", { name: "班表資料尚未齊全" })).toBeVisible();
    await expect(page.locator(".journey-card")).toHaveCount(0);
});

test("班表狀態依搭乘日期判斷，昨日取得的未來班表仍可使用", async ({ page }) => {
    const status = page.locator(".schedule-status");
    await expect(status).toHaveClass(/schedule-status--ready/);
    await expect(status).toContainText("2026/09/21 班表已取得");
    await expect(status).toContainText("2026/09/21 04:30");
    await page.getByLabel("出發日期", { exact: true }).selectOption("2026-09-22");
    await expect(status).toHaveClass(/schedule-status--ready/);
    await page.clock.setFixedTime(new Date("2026-09-22T08:00:00+08:00"));
    await page.reload();
    await expect(status).toHaveClass(/schedule-status--ready/);
    await expect(status).toContainText("2026/09/22 班表已取得");
    await expect(status).toContainText("班表取得時間｜台鐵：2026/09/21 04:30");
    await expect(status.getByRole("link", { name: "班表更新管理 ↗" })).toHaveCount(0);
    const position = await page.evaluate(() => ({
        statusTop: document.querySelector(".schedule-status")!.getBoundingClientRect().top,
        statusBottom: document.querySelector(".schedule-status")!.getBoundingClientRect().bottom,
        queryBottom: document.querySelector(".search-panel")!.getBoundingClientRect().bottom,
        resultsTop: document.querySelector("#results")!.getBoundingClientRect().top,
    }));
    expect(position.statusTop).toBeGreaterThanOrEqual(position.queryBottom);
    expect(position.statusBottom).toBeLessThanOrEqual(position.resultsTop);
});


test("所選日期缺少班表時，顯示日期與內灣線手動更新入口", async ({ page }) => {
    await page.route("**/data/*.json", route => route.fulfill({ status: 404, body: "" }));
    await page.getByLabel("出發日期", { exact: true }).selectOption("2026-09-23");
    const status = page.locator(".schedule-status");
    await expect(status).toHaveClass(/schedule-status--warning/);
    await expect(status).toContainText("2026/09/23 班表尚未取得");
    await expect(status.getByRole("link", { name: "班表更新管理 ↗" })).toHaveAttribute("href", "https://github.com/im1010ioio/neiwan-line/actions/workflows/daily-data.yml");
});

test("注音組字期間保留搜尋框與結果，選字後更新清單且不中斷游標", async ({ page }) => {
    await page.getByRole("button", { name: "選擇迄站：新竹" }).click();
    const input = page.getByRole("searchbox", { name: "搜尋車站" });
    await input.focus();
    const before = await page.locator(".station-option").allTextContents();
    const sameDuringComposition = await input.evaluate(element => {
        const input = element as HTMLInputElement;
        input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        input.value = "ㄅㄢ";
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "ㄅㄢ", isComposing: true }));
        return input.isConnected && document.activeElement === input;
    });
    expect(sameDuringComposition).toBe(true);
    expect(await page.locator(".station-option").allTextContents()).toEqual(before);
    const committed = await input.evaluate(element => {
        const input = element as HTMLInputElement;
        input.value = "板橋";
        input.setSelectionRange(1, 1);
        input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "板橋" }));
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "板橋", isComposing: false }));
        return { connected: input.isConnected, focused: document.activeElement === input, caret: input.selectionStart };
    });
    expect(committed).toEqual({ connected: true, focused: true, caret: 1 });
    await expect(page.locator(".station-option")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "板橋", exact: true })).toBeVisible();
    await input.fill("");
    await expect(page.getByRole("button", { name: "新竹市", exact: true })).toBeVisible();
    await input.fill("板橋");
    await page.getByRole("button", { name: "板橋", exact: true }).click();
    await expect(page.getByRole("button", { name: "選擇迄站：板橋" })).toBeVisible();
});
