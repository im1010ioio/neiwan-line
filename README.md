# 內灣線轉乘攻略

以內灣線為一端，查詢全台台鐵及高鐵往返行程。採 TypeScript、Vite 與靜態資料；轉乘計算在瀏覽器的背景工作執行，不因查詢人數增加 TDX 請求。

## 本機開啟

需要 Node.js 22.12 以上及 npm。

```sh
npm ci
npm run dev
```

終端機會顯示本機網址。正式檔案以 `npm run build` 產生於 `dist/`。本站可部署在子目錄，建置時設定 `BASE_PATH=/neiwan-line/`。

## 已實作

- 內灣線／全台台鐵與高鐵選站、方向交換、同站停用，立即套用並記住偏好。
- 台鐵「六家線」快捷分類及縣市／車站雙欄；高鐵北到南直接列站。
- 含今天七天、日期與星期、現在出發與 04:00–23:00 整點下限、查看已過組合。
- 同車續搭、跨日到站、雙向六家／高鐵新竹步行銜接、前三組及全部行程。
- 台鐵轉乘至少 5 分鐘、高鐵接駁至少 10 分鐘（包含步行）；上限可於設定調整，預設分別未滿 20、40 分鐘，儲存後立即重算。
- 今日已過／黃色／綠色狀態，預設準備時間 25 分鐘，可從設定修改。未來日期顯示預定班次。
- 主要幹線僅搭對號列車、各方向內灣新竹直達車篩選，保存於本機；依路線顯示適用選項，對號篩選保留內灣線區間接駁。台鐵選站提供新竹快捷，查無結果可清除篩選。
- 隱私權頁、分析同意／拒絕／撤回、本機偏好還原；使用者同意前完全不載入分析。

內灣線特色先保留入口，列車、車站、景點、故事及美食內容待另行確認。

## 官方資料與額度

`public/data/` 隨附首次取得的真實台鐵班表，非即時誤點資料。日期過期後必須重新產生；資料缺少時會明確顯示「班表尚未更新」，不以範例班表代替。

```sh
cp .env.example .env
npm run data:generate
```

預設直接下載[臺鐵官方開放班表](https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list)，不消耗 TDX。高鐵需在 `.env` 設定自己的 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`。不可加上 `VITE_` 前綴，也不可提交 `.env`。未設定憑證時仍可查台鐵，高鐵跨站查詢會提示資料不足；高鐵新竹與六家間步行不需要高鐵列車資料。

更新一次產生七天檔案，另抓第八天作為最後一天的跨日銜接，保留前日列車資料。高鐵通常每天八次資料請求（每日期一頁，超過 1,000 筆才分頁），所有訪客共用。實際次數記在更新紀錄；一次上限 60 次、請求間隔至少 13 秒。首次更新缺少昨日資料時，會提示凌晨銜接可能不完整。可設定 `TRA_SOURCE=tdx` 改走 TDX 台鐵來源，但會增加請求，通常不需要。

上游失敗保留同日期、同運具最後成功的班表並標記較舊資料；不拿其他日期平移代替。更新程式會以失敗狀態結束，方便通知維護者。班表不包含訂位與餘票，也不保證實際誤點時能接上。

車站來自[臺鐵官方車站基本資料](https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/0518b833e8964d53bfea3f7691aea0ee)，可用 `npm run data:stations` 更新。高鐵十二站依北到南固定列出，改站時需人工維護。

台鐵對號列車以「對號列車」標籤顯示，車次後接官方完整車種；普悠瑪與太魯閣省略重複名稱。車種代碼對照保存在 `src/tra-train-types.json`（來源：TDX TrainType），每日轉換班表時直接使用，不增加查詢額度。若官方新增代碼，需更新對照；缺少詳細資料時僅顯示班表原有名稱。

## 每日更新與發布

GitHub 專案為 `im1010ioio/neiwan-line`。使用 GitHub Actions 建置與發布至 https://im1010ioio.github.io/neiwan-line/ 。

1. 將程式碼提交至 `main`。
2. 在 GitHub Actions secrets 設定 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`，並允許 Actions 寫入儲存庫。
3. Pages 的建置來源選 GitHub Actions。
4. 手動執行 `Update daily timetables`，成功後會發布網站；之後預定每天台灣時間 04:30 更新（GitHub 排程可能延遲）。
5. 網站程式推送至 `main` 後自動執行 `Publish website`；也可手動執行。發布前須通過單元測試、手機／桌面操作測試與建置。

每日更新失敗時仍提交已取得資料與過期標記，但不自動發布該次更新；檢查紀錄後修復並重跑，或手動發布保留資料。修改網域或部署在根目錄時，調整 `pages.yml` 的 `BASE_PATH`。

## GA 與隱私

已設定 GA ID `G-DKH16N2ZM8`，開發與正式建置皆使用此 ID，只有使用者同意後才載入。GitHub Actions variable `VITE_GA_MEASUREMENT_ID` 可覆寫發布用 ID，本機可使用 `.env.local` 同名欄位覆寫，修改後重新啟動或建置。在 GA 資料串流關閉「加強型評估」，只使用本站明確送出的瀏覽量與互動事件。

事件白名單只有 `page_view`、`view_all`、`open_settings`、`open_privacy`。不傳送起迄站、查詢日期、出發時間、準備時間或行程；頁面位置排除 query/hash，固定頁面標題，不送來源頁。拒絕分析不影響 localStorage 記住偏好。GA 憑證與資料保留政策請由網站管理者在自己的 GA 專案設定。

## 測試

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

單元測試涵蓋轉乘門檻、跨日、時間狀態、偏好恢復、官方資料轉換、載入失敗與分析同意；操作測試涵蓋手機和桌面完整流程。操作測試使用明確標註的測試班表，並攔截 Google 請求；這些資料不會打包成正式班表。

設計與需求見 [規格](docs/spec.md) 和 [任務清單](docs/tasks.md)。

## 機場捷運

對向可選 22 個已通車機捷站（A1–A22，含 A14a，不含未通車 A14），去回程經高鐵新竹、桃園及機捷 A18。機捷不提供車種篩選，自動包含可搭直達車與普通車。接駁上限獨立儲存在本機，不傳給 GA。A18 本身只含步行。

`npm run data:metro` 每日抓一次 TDX StationTimeTable、StoppingPattern、S2STravelTime，共 3 次請求，原子更新 `public/data/metro.json`；失敗保留最後成功檔案，舊日期顯示提醒。每日 Actions 已串接，連同高鐵通常共 11 次 TDX 請求。

機捷發車時間來自官方站別班表；抵達時間由發車時間加官方 OD 旅行時間預估，介面明確標示，沒有虛構車次編號。僅計算 A18 與選定站間同車可達的班次，依方向、終點與停靠模式判斷，不把未停 A18 的直達車列入；不另計機捷內部換車。桃園高鐵／A18 至少 10 分鐘，且嚴格小於使用者的機捷接駁上限。新使用者預設 40 分鐘，舊偏好首次沿用原高鐵上限；可獨立設定 11–180 分鐘。

通用班表不等同逐日異動班表，臨時加班／停駛請以桃捷現場與[官方 A18 班表](https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-A18)為準。本站不推估臨時加班車。

國定假日依[政府行政機關辦公日曆表](https://data.gov.tw/dataset/14718)套用假日服務。`src/calendar.json` 已納入 2026、2027 年；每年須補入下一年度官方日曆，未知日期不猜測為平日。來源 CSV：

- 2026：https://www.dgpa.gov.tw/FileConversion?filename=dgpa%2Ffiles%2F202506%2Fa52331bd-a189-466b-b0f0-cae3062bbf74.csv&name=115.csv&nfix=
- 2027：https://www.dgpa.gov.tw/FileConversion?filename=dgpa%2Ffiles%2F202607%2Ff538b1ff-ba60-4c63-9477-10db8e6612d1.csv&name=116.csv&nfix=

機捷車站另存 `src/metro-stations.json`，來源 TDX Station/TYMC；新增車站須同步更新。
