import { QUERY_DAYS } from "./domain/schedule-window";
import type { Consent } from "./analytics";

export function privacyPage(base: string, analyticsConfigured: boolean | undefined, consent: Consent) {
    return `<main class="privacy">
        <a class="back" href="${base}">← 回到車班查詢</a>
        <h1>隱私權與使用條款</h1>
        <p class="muted">條款更新日期：2026/09/29</p>
        <p>歡迎使用內灣線轉乘攻略！</p>
        <p>存取及使用本網站，即表示您同意遵守以下使用條款。本條款說明使用內灣線轉乘攻略網站（<a href="https://neiwan-line.im1010ioio.dev/">neiwan-line.im1010ioio.dev</a>）時應遵守的規範。若您不同意本使用條款，請勿使用本網站。Cookie 與 Google Analytics（GA）分析另由您選擇是否允許，使用網站不代表同意分析。</p>
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
        <h3>分享預覽圖（OG Image）素材授權</h3>
        <p>分享預覽圖使用的攝影素材為「<a href="https://www.flickr.com/photos/yoshihuang/5023388464" title="@內灣" target="_blank" rel="noopener noreferrer">@內灣</a>」（<a href="https://www.flickr.com/photos/yoshihuang/" target="_blank" rel="noopener noreferrer">由 Yoshi Huang 製作</a>），採用 <a href="https://creativecommons.org/licenses/by-nc-sa/2.0/deed.zh-hant" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 2.0</a> 授權。本網站將照片與網站標誌、文字及介面示意合成為分享預覽圖。</p>
        <hr>
        <h2>隱私權聲明</h2>
        <h3>查詢偏好與本機儲存</h3>
        <p>本網站不要求您註冊帳號或提供姓名、電子郵件等身分資料。為了方便下次使用，本網站使用瀏覽器的 localStorage 記住起迄站、方向、查詢日期、出發準備時間、台鐵轉乘、高鐵與機捷接駁的下限與上限、對號列車及各方向的「內灣新竹直達車」篩選，以及您對網站分析的選擇。</p>
        <p>這些查詢偏好儲存在您的瀏覽器，不會跨裝置同步，也不會作為分析事件傳送給 GA。手動出發時間與「顯示已過組合」不會跨次開啟保留；查詢日期過期後會自動切回今天，起迄站與方向維持原設定。本機偏好會保留到您清除網站資料或使用下方清除功能為止。</p>
        <h3>Cookie 與 Google Analytics 分析</h3>
        <p>只有在您選擇允許 Cookie 與 GA 分析後，本網站才會載入已設定的 Google Analytics，統計瀏覽量及開啟設定、查看隱私說明、展開行程等一般互動。分析不包含起迄站、搭乘日期、出發時間、準備時間、轉乘間隔或查詢結果。</p>
        <p>GA 可能使用 Cookie 識別造訪，並處理瀏覽器、裝置及一般互動資料；相關資料由 Google 依其服務設定與隱私政策處理。本網站不啟用廣告個人化或 Google signals。</p>
        <p>${analyticsConfigured === undefined ? "網站分析僅在您同意後啟用。" : analyticsConfigured ? "本網站已設定 Google Analytics。" : "本網站目前尚未啟用 Google Analytics，不會載入分析程式。"} 您的選擇：<strong>${consent === "granted" ? "允許 Cookie 與 GA 分析" : consent === "denied" ? "拒絕 Cookie 與 GA 分析" : "尚未選擇"}</strong>。</p>
        <p>尚未同意或選擇拒絕時，本網站不載入 GA，也不傳送 GA 分析訊號；查詢與記住本機偏好的功能仍可使用。您可隨時改為拒絕，停止後續分析並清除本站可存取的 GA Cookie，但不會回溯刪除已送出的分析紀錄。</p>
        <h3>網站連線與第三方服務</h3>
        <p>起迄站篩選與轉乘計算在瀏覽器內完成，不會直接向 TDX 傳送您的查詢。瀏覽器仍會向網站主機 GitHub Pages 讀取所選日期的台鐵、高鐵靜態班表，以及查詢機捷所需的共用班表檔案，並向 font.emtech.cc 載入 LINESeedTW 字體。主機與字體服務可能處理 IP 位址、請求時間、檔案路徑等一般連線紀錄；這與 GA 分析不同。</p>
        <p>前往台鐵、高鐵、桃園捷運、Google、Instagram 等外部網站後，適用各網站的隱私政策。</p>
        <p><a href="https://policies.google.com/privacy?hl=zh-TW" target="_blank" rel="noreferrer">Google 隱私權政策 ↗</a> · <a href="https://policies.google.com/technologies/cookies?hl=zh-TW" target="_blank" rel="noreferrer">Google Cookie 說明 ↗</a></p>
        <h3>管理與清除資料</h3>
        <noscript><p>如需變更分析選擇或清除查詢偏好，請先啟用 JavaScript。</p></noscript>
        <div class="privacy-actions">
            <button class="secondary" id="privacy-allow">允許分析</button>
            <button class="secondary" id="privacy-deny">拒絕分析</button>
            <button class="secondary" id="clear-preferences">清除查詢偏好</button>
        </div>
        <p>您也可以在瀏覽器的網站設定中刪除此網站的 Cookie 與儲存資料。拒絕分析不影響查詢功能；清除偏好後，下次使用時需重新設定。</p>
        <hr>
        <h2>免責聲明</h2>
        <p>本網站依據臺鐵官方開放資料及 TDX 提供的班表，搭配您選擇的條件計算轉乘組合，結果僅供旅程規劃參考。本網站並非台鐵、高鐵或桃園捷運官方網站，也不提供訂票或座位保證。</p>
        <p>本網站每日排程更新含今天 ${QUERY_DAYS} 天的可查詢班表，另取得一天資料供跨日轉乘。實際更新時間可能因排程或資料來源狀況延後，各運具更新方式如下：</p>
        <ul>
            <li><strong>台鐵：</strong>每天嘗試從臺鐵官方開放資料重新取得整個查詢範圍的班表，不使用 TDX 額度。</li>
            <li><strong>高鐵：</strong>每天補齊新增、缺漏或先前更新失敗的日期，並重新取得今天、明天、後天的班表；較遠日期則挑選一個最久未更新的已取得日期重新下載。同一日期在一次更新中只取得一遍，其餘日期沿用先前資料。必要時可由管理者強制重新取得全部日期。</li>
            <li><strong>機場捷運：</strong>每天更新共用的各站時刻、停靠模式與站間旅行時間，依查詢日期的星期及假日規則計算。正常每次更新使用三次 TDX 資料請求。來源未提供明確適用期間時，依常態規則推算，不代表未來班次已獲確認。</li>
        </ul>
        <p>以上更新資料由所有使用者共用，操作查詢不會額外向 TDX 請求資料。更新失敗時，若有先前成功取得的資料則保留使用，並顯示更新狀態。畫面標示的班表取得時間代表本站取得該份資料的時間，不代表營運單位最後修改班表的時間。高鐵較遠日期的改班可能延後反映，直到輪到更新或進入近期三天範圍。</p>
        <p>所有運具的行程時間僅供參考，不提供即時誤點資訊，也不保證即時反映臨時加班、停駛或其他班次調整。我們會盡力維持資料與計算結果的準確性，但不保證所有資訊均為最新、完整或完全沒有錯誤，也不保證網站持續可用。</p>
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
