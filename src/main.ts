import { QUERY_DAYS } from "./domain/schedule-window";
import "./style.css";
import { isMajorStation } from "./major-stations";
import { FILTERS_KEY, loadFilters, saveFilters, filterAvailability } from "./filters";
import { stations, neiwanStations, counties, stationById, stationName } from "./stations";
import { dateInTaipei, dateOptions, addDays, displayTime, filterJourneys, journeyState } from "./domain/query";
import { defaults, loadPreferences, savePreferences, PREFERENCES_KEY } from "./preferences";
import type { StorageLike } from "./preferences";
import type { Journey, Leg, Station } from "./domain/types";
import type { MetroSnapshot } from "./domain/metro";
import type { DaySummary } from "./domain/timetable-format";
import { CONSENT_KEY, createAnalytics } from "./analytics";
import type { Consent } from "./analytics";

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
let storage: StorageLike | undefined;
try { storage = localStorage; } catch { /* Browsing remains available without storage. */ }
let filters = loadFilters(storage);
let today = dateInTaipei();
const restored = loadPreferences(storage, today);
let preferences = restored.value;
let time = preferences.date === today ? "now" : "all";
let showPast = false;
let showAll = false;
let notice = restored.reset ? "部分設定已重設" : "";
let consent: Consent = "unknown";
try {
    const saved = storage?.getItem(CONSENT_KEY);
    if (saved === "granted" || saved === "denied") consent = saved;
} catch { /* Ask again when storage is unavailable. */ }
const analytics = createAnalytics(import.meta.env.VITE_GA_MEASUREMENT_ID, window);
analytics.setConsent(consent);
let data: DaySummary | undefined;
let metroData: Pick<MetroSnapshot, "generatedAt"> | undefined;
let journeys: Journey[] = [];
let phase: "loading" | "ready" | "missing" | "error" = "loading";
let requestId = 0;
let worker: Worker | undefined;
let modalRole: "neiwan" | "other" = "neiwan";
let modalOperator = "tra";
let modalCounty = "六家線";
let search = "";
const app = document.querySelector<HTMLDivElement>("#app")!;
const endpoints = () => preferences.reversed ? [preferences.other, preferences.neiwan] : [preferences.neiwan, preferences.other];
const operatorLabel = (id: string) => id.startsWith("tymc:") ? "機場捷運" : id.startsWith("thsr:") ? "高鐵" : "台鐵";
const clockText = (timestamp: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));

function persist() {
    if (!savePreferences(storage, preferences)) notice = "瀏覽器目前無法儲存偏好；本次仍可正常查詢。";
}
function consentLabel() {
    return consent === "granted" ? "已同意使用 Cookie 與 GA 分析" : consent === "denied" ? "已拒絕 Cookie 與 GA 分析" : "尚未選擇是否允許 Cookie 與 GA 分析";
}
function setConsent(value: Consent) {
    consent = value;
    try { storage?.setItem(CONSENT_KEY, value); } catch { notice = "這次的分析選擇無法儲存，下次開啟會再次詢問。"; }
    analytics.setConsent(value);
    if (document.querySelector("#settings-dialog[open]")) {
        document.getElementById("analytics-consent-status")!.textContent = consentLabel();
        document.getElementById("settings-allow")!.setAttribute("aria-pressed", String(consent === "granted"));
        document.getElementById("settings-deny")!.setAttribute("aria-pressed", String(consent === "denied"));
        document.querySelector(".consent-banner")?.remove();
    } else render();
}
function dateLabel() { return dateOptions(new Date()).find(([date]) => date === preferences.date)?.[1] ?? preferences.date; }
function heading() {
    return `<header class="site-header"><a class="brand" href="#" aria-label="回到車班查詢"><img src="${import.meta.env.BASE_URL}icon.svg" width="42" height="42" alt=""><span>內灣線<span class="brand-sub">轉乘攻略</span></span></a><nav aria-label="主要導覽"><a href="#" ${location.hash !== "#privacy" ? 'aria-current="page"' : ""}>車班查詢</a><span class="soon-nav">內灣線特色 <small>準備中</small></span><button class="icon-button" id="settings-open" aria-label="開啟設定">⚙</button></nav></header>`;
}
function footer() {
    return `<footer><div><button class="text-button" id="privacy-settings">設定</button><a href="#privacy">隱私權與使用條款</a><a href="https://www.railway.gov.tw/tra-tip-web/tip/tip001/tip112/gobytime" target="_blank" rel="noreferrer">台鐵官方查詢 ↗</a><a href="https://www.thsrc.com.tw/" target="_blank" rel="noreferrer">高鐵官方查詢 ↗</a><a href="https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-A18" target="_blank" rel="noreferrer">桃捷官方查詢 ↗</a></div><p>資料來源：臺鐵官方開放資料、交通部 TDX。提供含今天 ${QUERY_DAYS} 天的班表，每日補齊可查詢日期。行程時間僅供參考，未反映臨時班次調整或誤點，請預留轉乘時間；實際運行與座位請以官方資訊為準。</p></footer>`;
}
function consentBanner() {
    if (consent !== "unknown") return "";
    return `<aside class="consent-banner" aria-label="網站分析選擇"><div><strong>Cookie 與 Google Analytics 分析</strong><p>是否允許本網站使用 Cookie 與 Google Analytics（GA）分析瀏覽量及一般互動？分析資料不包含起迄站、搭乘日期或時間。拒絕不影響查詢功能，查詢偏好仍會儲存在此瀏覽器。<a href="#privacy">隱私權與使用條款</a></p></div><div class="consent-actions"><button class="secondary" id="deny">拒絕</button><button class="primary" id="allow">允許 Cookie 與 GA 分析</button></div></aside>`;
}
function endpointButton(role: "neiwan" | "other", position: "起" | "迄") {
    const id = preferences[role];
    return `<button class="endpoint" data-pick="${role}" aria-label="選擇${position}站：${escapeHtml(stationName(id))}"><span class="eyebrow">${role === "neiwan" ? "內灣線" : operatorLabel(id)}</span><span class="station-title">${escapeHtml(stationName(id))}<svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></span></button>`;
}
function results() {
    if (phase === "loading") return `<div class="empty-state" role="status"><span class="spinner"></span><h2>正在整理可搭行程</h2><p>依班表尋找符合轉乘時間的組合。</p></div>`;
    if (phase === "missing") return `<div class="empty-state" role="status"><span class="empty-icon">◷</span><h2>班表資料尚未齊全</h2><p>所選日期的${preferences.other.startsWith("tymc:") ? "台鐵、高鐵或機捷" : preferences.other.startsWith("thsr:") ? "台鐵或高鐵" : "台鐵"}資料尚未完整取得或暫時無法讀取。請稍後再試，或查看官方班表。</p><button class="secondary" id="retry">重新讀取班表</button></div>`;
    if (phase === "error") return `<div class="empty-state" role="alert"><h2>暫時無法整理行程</h2><p>請重新讀取班表後再試。</p><button class="secondary" id="retry">重新讀取班表</button></div>`;
    const visible = filterJourneys(journeys, { date: preferences.date, time, showPast }, new Date());
    if (!visible.length) return `<div class="empty-state" role="status"><span class="empty-icon">↗</span><h2>此時段沒有符合轉乘條件的行程</h2><p>試著調整日期、出發時間或起迄站。台鐵轉乘須未滿 ${preferences.traMaxMinutes} 分鐘，高鐵接駁須未滿 ${preferences.thsrMaxMinutes} 分鐘。${preferences.other.startsWith("tymc:") && preferences.other !== "tymc:A18" ? `機捷接駁須未滿 ${preferences.metroMaxMinutes} 分鐘。` : ""}可在設定中調整。</p>${Object.values(activeRouteFilters()).some(Boolean) ? '<button class="secondary" id="clear-filters">清除篩選</button>' : ""}</div>`;
    return `<div class="results-heading"><h2>可搭行程 <span>${visible.length} 組</span></h2><span>依出發時間排序</span></div><div class="journey-list">${(showAll ? visible : visible.slice(0, 3)).map(card).join("")}</div>${visible.length > 3 ? `<button id="show-all" class="secondary show-all">${showAll ? "收合為前 3 組" : `顯示全部 ${visible.length} 組`}</button>` : ""}`;
}
function hasNoStanding(leg: Leg): boolean {
    return leg.operator === "tra" && /EMU\s*3000|自強[（(]3000[）)]|普悠瑪|太魯閣/i.test(leg.trainType ?? leg.service);
}
function card(journey: Journey) {
    const stale = data?.staleOperators?.some(op => op === "tra" || ((preferences.other.startsWith("thsr:") || preferences.other.startsWith("tymc:")) && op === "thsr"));
    const state = stale ? "scheduled" : journeyState(journey, preferences.date, preferences.preparation, new Date());
    const labels = { past: "已過", warning: "即將到來", upcoming: "即將到來", scheduled: stale ? "沿用先前班表" : "預定班次" };
    const minutes = Math.max(0, Math.ceil((journey.departure - Date.now()) / 60000));
    const countdown = (state === "warning" || state === "upcoming") ? `<span class="countdown">${minutes < 60 ? `${minutes} 分鐘後出發` : `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分後出發`}</span>` : "";
    const duration = Math.round((journey.arrival - journey.departure) / 60000);
    const durationText = duration >= 60 ? `${Math.floor(duration / 60)} 小時 ${duration % 60 ? `${duration % 60} 分` : ""}` : `${duration} 分鐘`;
    const walk = journey.accessWalk;
    const walkHtml = walk ? `<p class="access-walk">步行 ${escapeHtml(stationName(walk.origin))} → ${escapeHtml(stationName(walk.destination))} · 10 分鐘（${displayTime(walk.departure, preferences.date)}–${displayTime(walk.arrival, preferences.date)}）</p>` : "";
    return `<article class="journey-card ${state === "past" ? "is-past" : ""}"><header><div class="state-row"><span class="badge badge--${state}">${labels[state]}</span>${countdown}</div><span class="duration">${durationText}</span></header><div class="journey-summary"><strong>${displayTime(journey.departure, preferences.date)}</strong><span class="summary-line"><small>${journey.legs.length === 1 ? "免換車" : `轉乘 ${journey.legs.length - 1} 次`}</small><i></i></span><strong>${displayTime(journey.arrival, preferences.date)}</strong></div>${walk?.position === "start" ? walkHtml : ""}<ol class="timeline">${journey.legs.map((leg, index) => {
        const next = journey.legs[index + 1];
        const reservedTra = leg.operator === "tra" && leg.reserved === true;
        const trainType = (leg.trainType ?? leg.service).replace(/^普悠瑪\(普悠瑪\)$/, "普悠瑪").replace(/^太魯閣\(太魯閣\)$/, "太魯閣");
        const noStanding = hasNoStanding(leg);
        const transfer = next ? Math.round((next.departure - leg.arrival) / 60000) : 0;
        return `<li><div class="leg-line"><span class="train-tag ${leg.operator}">${leg.operator === "thsr" ? "高鐵" : reservedTra ? "對號列車" : escapeHtml(leg.service)}</span>${leg.operator === "tymc" ? "" : `<span class="train-number">${escapeHtml(leg.number)} 次${reservedTra ? ` <span class="train-type">${escapeHtml(trainType)}</span>` : ""}${noStanding ? ' <span class="no-standing">無售站票</span>' : ""}</span>`}<span class="leg-time">${displayTime(leg.departure, preferences.date)}–${displayTime(leg.arrival, preferences.date)}</span></div><div class="leg-stations">${escapeHtml(stationName(leg.origin))}<span>→</span>${escapeHtml(stationName(leg.destination))}</div>${next ? `<p class="transfer">${leg.destination !== next.origin ? `出站至${next.operator === "thsr" ? "高鐵" : next.operator === "tymc" ? "機捷" : ""}${escapeHtml(stationName(next.origin))}轉乘` : `${escapeHtml(stationName(leg.destination))}站內換車`}${hasNoStanding(next) ? "（需出站購票再進站）" : ""}<span>間隔 ${transfer} 分鐘</span></p>` : ""}</li>`;
    }).join("")}</ol>${walk?.position === "end" ? walkHtml : ""}</article>`;
}
function statusLine() {
    const selectedDate = preferences.date.replaceAll("-", "/");
    const updateLink = '<a href="https://github.com/im1010ioio/neiwan-line/actions/workflows/daily-data.yml" target="_blank" rel="noreferrer" title="需具備 GitHub 專案操作權限">班表更新管理 ↗</a>';
    const fullTime = (value: string) => {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? `${dateInTaipei(date).replaceAll("-", "/")} ${date.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : "時間不明";
    };
    if (!data) {
        if (phase === "loading") return `<section class="schedule-status" role="status"><span class="schedule-status-dot" aria-hidden="true"></span><div><strong>正在讀取 ${selectedDate} 班表</strong></div></section>`;
        return `<section class="schedule-status schedule-status--warning" role="status"><span class="schedule-status-dot" aria-hidden="true"></span><div><strong>${selectedDate} 班表尚未取得</strong><p>所選日期的資料尚未取得或暫時無法讀取，請稍後再試。</p></div>${updateLink}</section>`;
    }
    const context = data.contextCoverage;
    const required = (preferences.other.startsWith("tymc:") || (preferences.other.startsWith("thsr:") && preferences.other !== "thsr:1030")) ? ["tra", "thsr"] as const : ["tra"] as const;
    const contextMissing = required.some(op => context?.[op]?.some(v => !v));
    const acquired = required.filter(op => data!.coverage[op]).map(op => `${op === "tra" ? "台鐵" : "高鐵"}：${fullTime(data!.operatorUpdatedAt?.[op] ?? data!.generatedAt)}`);
    if (metroData) acquired.push(`機捷：${fullTime(metroData.generatedAt)}`);
    const stale = required.some(op => data!.staleOperators?.includes(op));
    const warning = stale || contextMissing || phase === "missing" || phase === "error";
    const title = phase === "missing" ? `${selectedDate} 班表尚未完整取得` : phase === "error" ? `${selectedDate} 行程暫時無法計算` : stale ? `${selectedDate} 班表更新未成功` : contextMissing ? `${selectedDate} 部分銜接資料尚未完整` : `${selectedDate} 班表已取得`;
    return `<section class="schedule-status schedule-status--${warning ? "warning" : "ready"}" role="status"><span class="schedule-status-dot" aria-hidden="true"></span><div><strong>${title}</strong>${acquired.length ? `<p>班表取得時間｜${escapeHtml(acquired.join("；"))}</p>` : ""}<p>${stale ? "部分運具更新未成功，目前沿用該日期上次取得的班表，請以官方資訊為準。" : warning ? "請以官方資訊為準。" : "依已取得的班表查詢，臨時異動請以官方資訊為準。"}</p>${contextMissing ? '<p>部分凌晨或跨日銜接資料尚未完整取得；日間行程仍可查詢。</p>' : ""}</div>${warning ? updateLink : ""}</section>`;
}
function privacyPage() {
    return `<main class="privacy">
        <a class="back" href="#">← 回到車班查詢</a>
        <h1>隱私權與使用條款</h1>
        <p class="muted">條款更新日期：2026/09/23</p>
        <p>歡迎使用內灣線轉乘攻略！</p>
        <p>存取及使用本網站，即表示您同意遵守以下使用條款。本條款說明使用內灣線轉乘攻略網站（<a href="https://im1010ioio.github.io/neiwan-line/">im1010ioio.github.io/neiwan-line</a>）時應遵守的規範。若您不同意本使用條款，請勿使用本網站。Cookie 與 Google Analytics（GA）分析另由您選擇是否允許，使用網站不代表同意分析。</p>
        <hr>
        <h2>使用規範</h2>
        <p>內灣線轉乘攻略為免費提供的個人旅程查詢工具。您可以：</p>
        <ul>
            <li>查詢內灣線沿線往返全台台鐵、高鐵及機場捷運車站的班次與轉乘組合。</li>
            <li>設定查詢偏好，作為規劃旅程的參考。</li>
            <li>基於非商業用途，將本網站連結分享給他人。</li>
        </ul>
        <p>您不得：</p>
        <ul>
            <li>未經授權，重新發布、販售或出租本網站的原創內容。</li>
            <li>未經授權，基於商業用途複製、重製或修改本網站的原創部分。</li>
            <li>將本網站用於任何非法或未經授權的活動。</li>
        </ul>
        <p>班表、字體及其他第三方資料的權利與使用方式，依各資料提供者的授權條款辦理。</p>
        <hr>
        <h2>隱私權聲明</h2>
        <h3>查詢偏好與本機儲存</h3>
        <p>本網站不要求您註冊帳號或提供姓名、電子郵件等身分資料。為了方便下次使用，本網站使用瀏覽器的 localStorage 記住起迄站、方向、查詢日期、出發準備時間、台鐵轉乘、高鐵與機捷接駁上限、對號列車及各方向的「內灣新竹直達車」篩選，以及您對網站分析的選擇。</p>
        <p>這些查詢偏好儲存在您的瀏覽器，不會跨裝置同步，也不會作為分析事件傳送給 GA。手動出發時間與「顯示已過組合」不會跨次開啟保留；查詢日期過期後會自動切回今天，起迄站與方向維持原設定。本機偏好會保留到您清除網站資料或使用下方清除功能為止。</p>
        <h3>Cookie 與 Google Analytics 分析</h3>
        <p>只有在您選擇允許 Cookie 與 GA 分析後，本網站才會載入已設定的 Google Analytics，統計瀏覽量及開啟設定、查看隱私說明、展開行程等一般互動。分析不包含起迄站、搭乘日期、出發時間、準備時間、轉乘上限或查詢結果。</p>
        <p>GA 可能使用 Cookie 識別造訪，並處理瀏覽器、裝置及一般互動資料；相關資料由 Google 依其服務設定與隱私政策處理。本網站不啟用廣告個人化或 Google signals。</p>
        <p>${analytics.configured ? "本網站已設定 Google Analytics。" : "本網站目前尚未啟用 Google Analytics，不會載入分析程式。"} 您的選擇：<strong>${consent === "granted" ? "允許 Cookie 與 GA 分析" : consent === "denied" ? "拒絕 Cookie 與 GA 分析" : "尚未選擇"}</strong>。</p>
        <p>尚未同意或選擇拒絕時，本網站不載入 GA，也不傳送 GA 分析訊號；查詢與記住本機偏好的功能仍可使用。您可隨時改為拒絕，停止後續分析並清除本站可存取的 GA Cookie，但不會回溯刪除已送出的分析紀錄。</p>
        <h3>網站連線與第三方服務</h3>
        <p>起迄站篩選與轉乘計算在瀏覽器內完成，不會直接向 TDX 傳送您的查詢。瀏覽器仍會向網站主機 GitHub Pages 讀取所選日期的台鐵、高鐵靜態班表，以及查詢機捷所需的共用班表檔案，並向 font.emtech.cc 載入 LINESeedTW 字體。主機與字體服務可能處理 IP 位址、請求時間、檔案路徑等一般連線紀錄；這與 GA 分析不同。</p>
        <p>前往台鐵、高鐵、桃園捷運、Google、Instagram 等外部網站後，適用各網站的隱私政策。</p>
        <p><a href="https://policies.google.com/privacy?hl=zh-TW" target="_blank" rel="noreferrer">Google 隱私權政策 ↗</a> · <a href="https://policies.google.com/technologies/cookies?hl=zh-TW" target="_blank" rel="noreferrer">Google Cookie 說明 ↗</a></p>
        <h3>管理與清除資料</h3>
        <div class="privacy-actions">
            <button class="secondary" id="privacy-allow">允許分析</button>
            <button class="secondary" id="privacy-deny">拒絕分析</button>
            <button class="secondary" id="clear-preferences">清除查詢偏好</button>
        </div>
        <p>您也可以在瀏覽器的網站設定中刪除此網站的 Cookie 與儲存資料。拒絕分析不影響查詢功能；清除偏好後，下次使用時需重新設定。</p>
        <hr>
        <h2>免責聲明</h2>
        <p>本網站依據臺鐵官方開放資料及 TDX 提供的班表，搭配您選擇的條件計算轉乘組合，結果僅供旅程規劃參考。本網站並非台鐵、高鐵或桃園捷運官方網站，也不提供訂票或座位保證。</p>
        <p>本網站原則上每日補齊含今天 ${QUERY_DAYS} 天的可查詢班表。台鐵與機捷資料每日嘗試更新；高鐵已取得的日期會沿用，僅補齊新增或缺漏日期，必要時由管理者重新取得。畫面標示的班表取得時間，代表本站取得該份資料的時間，不代表營運單位最後修改班表的時間。所有運具的行程時間僅供參考，不提供即時誤點資訊，也不保證即時反映臨時加班、停駛或其他班次調整。我們會盡力維持資料與計算結果的準確性，但不保證所有資訊均為最新、完整或完全沒有錯誤，也不保證網站持續可用。</p>
        <p>台鐵與高鐵時間依官方班表顯示；機捷發車時間依官方站別班表，抵達時間依官方站間旅行時間推估。接駁上限用於篩選行程，不代表實際轉乘所需時間。</p>
        <p>轉乘組合不代表保證接得上下一班車。實際發車、停駛、臨時調整、月台、步行時間及座位狀況，請以台鐵、高鐵、桃園捷運及現場公告為準，並自行預留足夠的轉乘時間。</p>
        <p>請自行評估使用本網站資訊所產生的風險。在法律允許的範圍內，內灣線轉乘攻略不對因資料錯誤、延遲、服務中斷或未能完成轉乘所造成的損失負責；依法不得排除或限制的責任，不受本條款影響。</p>
        <hr>
        <h2>條款變更</h2>
        <p>我們可能隨時更新或修改本條款，並於本頁更新日期，恕不另行個別通知。您於條款更新後繼續使用本網站，即表示同意更新後的使用條款。</p>
        <p>條款更新不會自動變更您對 Cookie 與 GA 分析的選擇；如分析用途或蒐集範圍有所變更，將另行說明並在需要時重新徵求同意。</p>
        <hr>
        <h2>聯絡我們</h2>
        <p>如果您有任何問題或意見，歡迎透過 Instagram <a href="https://www.instagram.com/im1010ioio/" target="_blank" rel="noreferrer">@im1010ioio</a> 與我們聯絡。</p>
        <p>依詢問內容不同，回覆可能需要一些時間，敬請見諒。</p>
    </main>`;
}
function activeRouteFilters() {
    const available = filterAvailability(preferences.neiwan, preferences.other);
    return {
        reservedOnly: available.reserved && filters.reservedOnly,
        directOnly: available.direct && (preferences.reversed ? filters.directReturn : filters.directOutbound),
    };
}
function filterControls() {
    const available = filterAvailability(preferences.neiwan, preferences.other);
    if (!available.reserved && !available.direct) return "";
    const active = activeRouteFilters();
    return `<div class="journey-filters" aria-label="行程篩選">${available.reserved ? `<label class="checkbox"><input id="reserved-filter" type="checkbox" ${active.reservedOnly ? "checked" : ""}>主要幹線僅搭對號列車</label>` : ""}${available.direct ? `<label class="checkbox"><input id="direct-filter" type="checkbox" ${active.directOnly ? "checked" : ""}>內灣新竹直達車</label>` : ""}${available.reserved ? '<p class="filter-note">對號列車篩選適用於幹線，內灣線與六家線仍需搭區間車。</p>' : ""}</div>`;
}
function persistFilters() {
    if (!saveFilters(storage, filters)) notice = "瀏覽器目前無法儲存篩選偏好；本次仍可正常查詢。";
}
function render() {
    const privacy = location.hash === "#privacy";
    app.innerHTML = `${heading()}${notice ? `<div class="notice" role="status">${escapeHtml(notice)}</div>` : ""}${privacy ? privacyPage() : `<main><section class="intro"><p class="eyebrow accent">NEIWAN LINE · RAIL JOURNEYS</p><h1>內灣線轉乘攻略</h1><p>往來內灣老街，查詢班次再也不麻煩。</p></section><section class="search-panel" aria-label="車班查詢條件"><div class="route-picker">${endpointButton(preferences.reversed ? "other" : "neiwan", "起")}<span class="route-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></span>${endpointButton(preferences.reversed ? "neiwan" : "other", "迄")}<button id="swap" class="swap-button" aria-label="交換起迄站"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"/></svg></button></div><div class="query-controls"><label class="date-field"><span class="date-heading"><span class="eyebrow">出發日期</span><span id="date-weekday" class="date-weekday">${dateLabel().slice(-3).replace("(", "(星期")}</span></span><input id="date" type="date" aria-label="出發日期" aria-describedby="date-weekday" min="${today}" max="${addDays(today, QUERY_DAYS - 1)}" value="${preferences.date}" required></label><label><span class="eyebrow">出發時間</span><select id="time" aria-label="出發時間">${preferences.date === today ? `<option value="now" ${time === "now" ? "selected" : ""}>現在出發</option>` : ""}<option value="all" ${time === "all" ? "selected" : ""}>全天</option>${Array.from({ length: 20 }, (_, i) => `${String(i + 4).padStart(2, "0")}:00`).map(value => `<option value="${value}" ${time === value ? "selected" : ""}>${value} 以後</option>`).join("")}</select></label></div>${filterControls()}<div class="filter-row">${preferences.date === today ? `<label class="checkbox"><input type="checkbox" id="past" ${showPast ? "checked" : ""}>顯示已過組合</label>${showPast ? '<span class="muted">包含已發車行程</span>' : ""}` : '<span class="muted">未來班表 · 預定班次</span>'}<button type="button" id="transfer-settings" class="transfer-hint text-button">調整轉乘時間</button></div></section>${statusLine()}<section id="results" aria-label="查詢結果">${results()}</section><section class="features-note"><div><span class="eyebrow">慢慢探索</span><h2>內灣線特色</h2><p>列車、車站、景點、故事與美食，內容準備中。</p></div><span class="outline-badge">即將推出</span></section></main>`}${footer()}${consentBanner()}<dialog id="station-dialog" aria-labelledby="station-dialog-title"></dialog><dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-header"><h2 id="settings-title">查詢與隱私設定</h2><button class="icon-button close-settings" aria-label="關閉設定">×</button></div><div class="settings-body"><label for="preparation">出發準備時間（分鐘）</label><p>距離發車不足這段時間時，會以黃色提醒，行程仍會顯示。</p><input id="preparation" type="number" min="0" max="180" step="1" value="${preferences.preparation}"><h3>轉乘間隔</h3><p>前一班抵達到下一班出發的時間。間隔達到你設定的上限，就不列入行程。</p><label for="tra-max">台鐵轉乘上限（分鐘）</label><p>站內換車至少保留 5 分鐘。</p><input id="tra-max" type="number" min="6" max="180" step="1" value="${preferences.traMaxMinutes}"><label for="thsr-max">高鐵接駁上限（分鐘）</label><p>至少保留 10 分鐘，包含六家站與高鐵新竹站之間的步行時間。</p><input id="thsr-max" type="number" min="11" max="180" step="1" value="${preferences.thsrMaxMinutes}"><label for="metro-max">機捷接駁上限（分鐘）</label><p>至少保留 10 分鐘，包含高鐵桃園站與機捷 A18 站之間的步行時間。</p><input id="metro-max" type="number" min="11" max="180" step="1" value="${preferences.metroMaxMinutes}"><button id="save-settings" class="primary">儲存設定</button><p>設定會記在這個瀏覽器，下次開啟仍會保留。</p><button type="button" class="secondary" id="settings-clear-preferences">清除查詢偏好</button><p>將起迄站、日期、篩選與時間設定恢復預設，不影響 Cookie 與 GA 分析的選擇。</p><hr><section class="home-screen-help" aria-labelledby="home-screen-title"><h3 id="home-screen-title">加入手機主畫面</h3><p>將內灣線加入主畫面，下次點圖示就能開啟查詢。</p><details><summary>查看加入方式</summary><p><strong>iPhone／iPad：</strong>在 Safari 開啟網站，點選「分享」→「加入主畫面」；若有「以網頁 App 打開」選項，請保持開啟。</p><p><strong>Android：</strong>在 Chrome 開啟網站，點選選單「⋮」→「加入主畫面」或「安裝應用程式」，依畫面指示完成。</p><p>查詢班表需要網路連線。加入後首次開啟若未帶入偏好，可重新選擇；之後會在此 Web App 中記住。</p></details></section><hr><h3>網站分析</h3><p>允許 Cookie 與 GA 分析，協助我們了解瀏覽量與一般操作。不包含起迄站、搭乘日期或時間。</p><p id="analytics-consent-status" role="status" aria-live="polite">${consentLabel()}</p>${analytics.configured ? "" : "<p>網站尚未啟用 GA，目前不會傳送分析資料；你的同意選擇仍會保留。</p>"}<div class="privacy-actions"><button class="secondary" id="settings-allow" aria-pressed="${consent === 'granted'}">允許分析</button><button class="secondary" id="settings-deny" aria-pressed="${consent === 'denied'}">拒絕分析</button></div><a href="#privacy" id="settings-privacy">閱讀隱私權與使用條款</a></div></dialog>`;
    bind();
}
function on(id: string, event: string, handler: (event: Event) => void) { document.getElementById(id)?.addEventListener(event, handler); }
function openSettings() { analytics.track("open_settings"); document.querySelector<HTMLDialogElement>("#settings-dialog")!.showModal(); }
function bind() {
    on("reserved-filter", "change", event => { filters.reservedOnly = (event.target as HTMLInputElement).checked; persistFilters(); showAll = showPast; void refresh(); });
    on("direct-filter", "change", event => { filters[preferences.reversed ? "directReturn" : "directOutbound"] = (event.target as HTMLInputElement).checked; persistFilters(); showAll = showPast; void refresh(); });
    on("clear-filters", "click", () => {
        filters.reservedOnly = false;
        filters[preferences.reversed ? "directReturn" : "directOutbound"] = false;
        persistFilters(); void refresh();
    });
    on("transfer-settings", "click", openSettings);
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-pick]")) button.onclick = () => openStations(button.dataset.pick as "neiwan" | "other");
    on("swap", "click", () => { preferences.reversed = !preferences.reversed; showAll = showPast; persist(); void refresh(); });
    on("date", "click", event => {
        const input = event.target as HTMLInputElement;
        try { input.showPicker?.(); } catch { /* Native focus/tap remains available on other browsers. */ }
    });
    on("date", "change", event => {
        const input = event.target as HTMLInputElement;
        // Check against current Taiwan time, including when the picker spans midnight.
        const current = dateInTaipei();
        if (!input.value || !input.validity.valid || input.value < current || input.value > addDays(current, QUERY_DAYS - 1)) {
            input.value = preferences.date;
            return;
        }
        if (input.value === preferences.date) return;
        today = current;
        preferences.date = input.value;
        time = preferences.date === today ? "now" : "all";
        showPast = false; showAll = false; persist(); void refresh();
    });
    on("time", "change", event => { time = (event.target as HTMLSelectElement).value; showAll = showPast; render(); });
    on("past", "change", event => { showPast = (event.target as HTMLInputElement).checked; showAll = showPast; render(); });
    on("show-all", "click", () => { showAll = !showAll; if (showAll) analytics.track("view_all"); render(); });
    on("retry", "click", () => { void refresh(true); });
    for (const id of ["allow", "privacy-allow", "settings-allow"]) on(id, "click", () => setConsent("granted"));
    for (const id of ["deny", "privacy-deny", "settings-deny"]) on(id, "click", () => setConsent("denied"));
    for (const id of ["settings-open", "privacy-settings"]) on(id, "click", openSettings);
    document.querySelector(".close-settings")?.addEventListener("click", () => document.querySelector<HTMLDialogElement>("#settings-dialog")!.close());
    on("save-settings", "click", () => {
        const input = document.querySelector<HTMLInputElement>("#preparation")!;
        const traMax = document.querySelector<HTMLInputElement>("#tra-max")!;
        const thsrMax = document.querySelector<HTMLInputElement>("#thsr-max")!;
        const metroMax = document.querySelector<HTMLInputElement>("#metro-max")!;
        for (const field of [input, traMax, thsrMax, metroMax]) {
            field.required = true;
            if (!field.reportValidity()) return;
        }
        preferences.preparation = Number(input.value);
        preferences.traMaxMinutes = Number(traMax.value);
        preferences.thsrMaxMinutes = Number(thsrMax.value);
        preferences.metroMaxMinutes = Number(metroMax.value);
        persist(); showAll = showPast; void refresh();
    });
    for (const id of ["clear-preferences", "settings-clear-preferences"]) on(id, "click", () => { try { storage?.removeItem(PREFERENCES_KEY); storage?.removeItem(FILTERS_KEY); } catch {} filters = loadFilters(); preferences = defaults(today); time = "now"; showPast = false; showAll = false; notice = "查詢偏好已清除。"; void refresh(); });
}
function openStations(role: "neiwan" | "other") {
    modalRole = role;
    modalOperator = stationById.get(preferences[role])!.operator;
    modalCounty = stationById.get(preferences[role])!.county || "六家線";
    if (["tra:1194", "tra:1193"].includes(preferences[role])) modalCounty = "六家線";
    search = "";
    renderStations();
    document.querySelector<HTMLDialogElement>("#station-dialog")!.showModal();
    document.querySelector<HTMLElement>(".station-option[aria-pressed='true']")?.scrollIntoView({ block: "nearest" });
}
function renderStations(updateListOnly = false) {
    const dialog = document.querySelector<HTMLDialogElement>("#station-dialog")!;
    const isOrigin = (modalRole === "neiwan") !== preferences.reversed;
    const other = preferences[modalRole === "neiwan" ? "other" : "neiwan"];
    let list: Station[] = modalRole === "neiwan" ? neiwanStations : stations.filter(s => s.operator === modalOperator);
    if (search) list = list.filter(s => s.name.replaceAll("臺", "台").includes(search.replaceAll("臺", "台")));
    else if (modalRole === "other" && modalOperator === "tra") list = modalCounty === "六家線" ? [stationById.get("tra:1194")!, stationById.get("tra:1193")!] : list.filter(s => s.county === modalCounty);
    if (!updateListOnly) {
        dialog.innerHTML = `<div class="dialog-header"><div><p class="eyebrow">${modalRole === "neiwan" ? "內灣線沿線" : "全台鐵路"}</p><h2 id="station-dialog-title">選擇${isOrigin ? "起" : "迄"}站</h2></div><button class="icon-button" id="close-stations" aria-label="關閉選站">×</button></div>${modalRole === "other" ? `<div class="operator-tabs" role="tablist" aria-label="運具"><button role="tab" data-operator="tra" aria-selected="${modalOperator === "tra"}">台鐵</button><button role="tab" data-operator="thsr" aria-selected="${modalOperator === "thsr"}">高鐵</button><button role="tab" data-operator="tymc" aria-selected="${modalOperator === "tymc"}">機場捷運</button></div>` : ""}<div class="station-search"><input type="search" id="station-search" aria-label="搜尋車站" placeholder="搜尋車站" value="${escapeHtml(search)}"></div><div id="station-options"></div>`;
        dialog.querySelector("#close-stations")!.addEventListener("click", () => dialog.close());
        dialog.querySelectorAll<HTMLButtonElement>("[data-operator]").forEach(button => button.onclick = () => { modalOperator = button.dataset.operator!; search = ""; renderStations(); });
        const input = dialog.querySelector<HTMLInputElement>("#station-search")!;
        let composing = false;
        const updateSearch = () => {
            if (search === input.value) return;
            search = input.value;
            renderStations(true);
        };
        input.addEventListener("compositionstart", () => { composing = true; });
        input.addEventListener("compositionend", () => { composing = false; updateSearch(); });
        input.addEventListener("input", event => {
            if (!composing && !(event as InputEvent).isComposing) updateSearch();
        });
    }
    dialog.querySelector("#station-options")!.innerHTML = `<div class="station-columns ${modalRole === "neiwan" || modalOperator !== "tra" || search ? "single" : ""}">${modalRole === "other" && modalOperator === "tra" && !search ? `<div class="county-list" aria-label="車站分類">${["六家線", ...counties].map(county => `<button data-county="${county}" aria-pressed="${county === modalCounty}">${county}${county === "六家線" ? '<small>六家・竹中</small>' : ""}</button>`).join("")}</div>` : ""}<div class="station-list" aria-label="車站">${list.map(station => `<button class="station-option${isMajorStation(station.id) ? " major-station" : ""}" ${isMajorStation(station.id) ? 'aria-description="主要站（特等站或一等站）"' : ""} data-station="${station.id}" aria-pressed="${preferences[modalRole] === station.id}" ${station.id === other ? "disabled" : ""}><span class="station-name">${escapeHtml(station.name)}</span>${station.id === other ? `<small>與${isOrigin ? "迄" : "起"}站相同</small>` : preferences[modalRole] === station.id ? '<span class="selected-check" aria-hidden="true">✓</span>' : ""}</button>`).join("") || '<p class="no-stations">找不到符合的車站</p>'}</div></div>`;
    dialog.querySelectorAll<HTMLButtonElement>("[data-county]").forEach(button => button.onclick = () => { const scroll = dialog.querySelector(".county-list")!.scrollTop; modalCounty = button.dataset.county!; renderStations(true); dialog.querySelector(".county-list")!.scrollTop = scroll; });
    dialog.querySelectorAll<HTMLButtonElement>("[data-station]").forEach(button => button.onclick = () => { preferences[modalRole] = button.dataset.station!; persist(); dialog.close(); showAll = showPast; void refresh(); });
}
function renderAfterLoad() {
    const openDialog = document.querySelector<HTMLDialogElement>("dialog[open]");
    if (openDialog) openDialog.addEventListener("close", () => render(), { once: true });
    else render();
}
function refresh(force = false) {
    const id = ++requestId;
    phase = "loading"; data = undefined; metroData = undefined; journeys = []; render();
    if (!worker) {
        worker = new Worker(new URL("./planner.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = event => {
            if (event.data.id !== requestId) return;
            journeys = event.data.journeys ?? [];
            data = event.data.data;
            metroData = event.data.metro;
            phase = event.data.status;
            renderAfterLoad();
        };
        worker.onerror = () => {
            phase = "error"; worker?.terminate(); worker = undefined; renderAfterLoad();
        };
    }
    const [origin, destination] = endpoints();
    worker.postMessage({ id, force, origin, destination, date: preferences.date,
        filters: { traMaxMinutes: preferences.traMaxMinutes, thsrMaxMinutes: preferences.thsrMaxMinutes, metroMaxMinutes: preferences.metroMaxMinutes, ...activeRouteFilters() } });
}
const backToTop = document.createElement("button");
backToTop.type = "button";
backToTop.className = "back-to-top";
backToTop.setAttribute("aria-label", "回到頂端");
backToTop.title = "回到頂端";
backToTop.hidden = window.scrollY < 300;
backToTop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v12"/></svg>';
backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
window.addEventListener("scroll", () => { backToTop.hidden = window.scrollY < 300; }, { passive: true });
document.body.append(backToTop);

window.addEventListener("hashchange", () => { if (location.hash === "#privacy") analytics.track("open_privacy"); render(); window.scrollTo(0, 0); });
setInterval(() => {
    const current = dateInTaipei();
    if (current !== today) {
        today = current;
        if (preferences.date < today) { preferences.date = today; time = "now"; showPast = false; showAll = false; persist(); }
        void refresh();
    } else if (!document.querySelector("dialog[open]") && location.hash !== "#privacy") {
        const resultsElement = document.getElementById("results");
        if (resultsElement) { resultsElement.innerHTML = results(); on("clear-filters", "click", () => { filters.reservedOnly = false; filters[preferences.reversed ? "directReturn" : "directOutbound"] = false; persistFilters(); void refresh(); }); on("show-all", "click", () => { showAll = !showAll; render(); }); on("retry", "click", () => { void refresh(true); }); }
    }
}, 30000);
void refresh();
