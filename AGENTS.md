# AGENTS.md — ompDS

`ompDS` 是一個 Bun + Vite + React 19 + TypeScript 專案：把本機的 `omp`（oh-my-pi）coding agent
做成瀏覽器介面，左側 session 紀錄、右側聊天框。

架構與設計決策見 [`docs/PLAN.md`](docs/PLAN.md)。**先讀它**再改程式碼。

## 必讀的分層規則

只有 `server/omp/` 與 `shared/omp/` 知道 omp 的細節（flag、錯誤文字、frame 欄位）。
其他程式碼只跟 gateway 的 HTTP/WS 介面講話。這條規則由 `bun run lint:omp` 強制，
改動時若發現某個 omp 細節漏到別處，要把它移回 `server/omp/`。

## 常用命令

```sh
bun install                # 安裝依賴
bun run build              # 建置前端到 dist/（gateway 從這裡讀）
bun run dev                # Vite 開發伺服器（:5190），代理 /api 與 /ws 到 gateway
bun run scripts/serve.ts   # 啟動 gateway（http://127.0.0.1:30190/）
bun run scripts/launch.ts  # 啟動 gateway + 自動 rebuild + 開瀏覽器
bunx tsc --noEmit -p tsconfig.json   # 型別檢查
bun test                   # 單元測試
bun run omp:check          # 對已安裝的 omp 跑相容性自我檢查（不呼叫模型）
bun run lint:omp           # 驗證 omp 細節沒有外洩
bun run gen:zh-hant        # 重新產生繁體中文轉換表
```

Windows 一鍵啟動：`ompDS.cmd` 或 `ompDS.ps1`（根目錄）。

## 慣例

- **Tab 縮排**，TypeScript，無分號以外的怪招。程式碼風格看鄰居。
- 變數、函式、檔名用英文；**註解用繁體中文**，且先說「為什麼」再說「怎麼做」。
- 測試用 `bun:test` 的 `describe` / `expect` / `test`，放在 `tests/`。
  測試檔名對應被測模組：`tests/session-groups.test.ts` ↔ `web/src/lib/session-groups.ts`。
- 每個命令都要有可觀察的行為；不要為了通過測試而放寬斷言。
- 不要手改 `shared/zh-hant.generated.ts`——改文案後跑 `bun run gen:zh-hant`。

## 陷阱

- **gateway 預設用使用者真實的 omp profile**（`~/.omp/agent`，本機有 291 個真實 session）。
  `bun run scripts/serve.ts --test` 才會用隔離的 `.data/omp-agent`。
  改任何會寫檔案的邏輯前，先想清楚寫進去的是哪一個 profile。
- 「永久刪除」會刪掉真實的 session .jsonl，不可逆。
- `TESTED_OMP`（`server/omp/compat.ts`）由 `bun run omp:check` 自己改寫，不要手動填。
- `omp --mode rpc` 是 newline-delimited JSON，不是 JSON-RPC 2.0。
  協定 v2 要 client 送 `negotiate_protocol`；超長 frame 會切成 `rpc_chunk`（base64 分片），
  必須驗證 `chunkId`/`index`/`count`/`byteLength` 再重组。
- 升級 omp 的順序是：先 `bun run omp:check`，只有當它除了版本號以外都通過時才讓它改寫
  `TESTED_OMP`。改壞了只動 `server/omp/` 與 `shared/omp/`。
- `bun run omp:record` 會**真的呼叫模型兩次**，只在升級 omp 時手動跑。

## 授權

本機 commit 為止，**永遠不要 push**（remote 的 pushurl 已鎖成 `DISABLED`）。
