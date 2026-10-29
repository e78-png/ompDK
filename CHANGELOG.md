# 變更紀錄

本專案遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
版本號遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

## [未發佈]

### 修正

- **Windows 上的命令列注入**：走 `cmd.exe /c` 的啟動器（`.cmd`／`.bat`）會重新解析
  引號與 `& | < >`，帶引號的使用者文字（第一句訊息、助理回覆、模型名）可能被
  解讀成一條真的命令。提示改走 stdin，模型識別字加形狀檢查。
- **路徑穿越**：web root 以外的檔案可經由 `%2e%2e%2f` 編碼的路徑被讀到。
- **缺少 `frame-ancestors`**：任何網站都能把本機介面鑲進 iframe 做點擊劫持。
  每個回應現在都帶 `Content-Security-Policy: frame-ancestors 'none'`。
- **路徑洩漏**：作業系統的錯誤訊息會把絕對路徑送到瀏覽器，現在會換成佔位符。
- **DOMPurify 3.4.16 的 critical 漏洞**：升到 3.4.17。

## [1.1.0] — 2026-10-29

### 新增

- **MCP 面板**（外掛頁的第三個分頁）：顯示 omp **實際載入** 的 MCP server
  ——傳輸型別、啟用狀態、端點、來源。資料來自上游的 `/mcp list`，
  不是讀設定檔（設定檔只是十幾個來源中的一個，且同名時會去重）。
- **命令面板**（`⌘/Ctrl+K`）：搜尋所有頁面動作；動作清單是資料驅動的。
- **對話區狀態列**：模型、思考等級、上下文用量、階段狀態；點任一格開右側面板。
- **桌機版（Electron）**：可打包成 Windows 安裝檔；選單含「檢查 omp 更新」。
- **omp 官版更新**：設定頁可一鍵查詢與安裝上游最新版（轉呼叫 `omp update`）。
- **相容性可見性**：未驗證的 omp 版本會在主畫面顯示提示，可就地跑完整檢查。
- **繁體中文介面**：以 opencc 預產生對照表，介面與終端機輸出都是繁體。
- **側欄「時間」模式**：依 activeAt 分成今天／昨天／近 7 天／更早。
- **骨架屏與空狀態**：側欄、Inspector、子代理頁、技能抽屜等。
- **新會話起始提示**：四顆可點的範例，點一下填進輸入框。

### 改變

- 專案由 `ompDS` 更名為 `ompDK`。
- `bun run omp:check` 對實機 omp 18.13.3 通過 29/29。

[未發佈]: https://github.com/e78-png/ompDK/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/e78-png/ompDK/releases/tag/v1.1.0
