# 參與開發

先讀 [`AGENTS.md`](AGENTS.md)——那裡有本專案的命令、慣例與陷阱。

## 快速上手

```sh
bun install
bun run scripts/serve.ts     # 終端機 A：gateway :30190
bun run dev                   # 終端機 B：Vite :5190（代理 /api 與 /ws 到 gateway）
```

需要 [Bun](https://bun.sh) 1.4.4+ 與一份已登入模型的 `omp`。

## 提交前必跑

```sh
bunx tsc --noEmit -p tsconfig.json   # 型別
bun run lint:omp                     # 分層規則
bun test                             # 單元測試
bun run build                        # 前端建置
```

CI 跑的就是這四項。`bun run lint:omp` 尤其要跑：它擋的是「omp 的細節漏到
`server/omp/` 與 `shared/omp/` 之外」——那個規則一破，omp 改版時的相容性問題
就會散落到整個 codebase。

## 這個專案特有的兩條規矩

**一、知道 omp 細節的地方只有兩個目錄。**

`server/omp/` 與 `shared/omp/` 知道 omp 的旗標、錯誤文字、frame 欄位、
CLI 子命令、斜線命令。其餘程式碼只跟 gateway 的 HTTP/WS 介面講話。
`bun run lint:omp` 會驗證這條。

**二、涉及檔案系統的操作，要先說清楚寫進去的是哪個 profile。**

gateway 預設操作**使用者真實的** omp profile（`~/.omp/agent`），
不是隔離環境。改任何會寫檔案的邏輯之前，先想清楚：

- 寫進去的是 `~/.omp/agent`（真實）還是 `.data/omp-agent`（隔離）？
- 這次寫入**可逆**嗎？「永久刪除」不可逆。
- 使用者正在跑的工作階段會不會被影響？

## 改 omp 支援的相關程式碼時

上游 omp **一天發一版**，`docs/rpc.md` 幾乎天天在改。改這一層之前：

1. 先看上游的 `docs/rpc.md` 與 `docs/mcp-config.md`。
2. 用 `OMP_WEB_OMP_BIN` 指向新版本，先驗再改：

   ```sh
   OMP_WEB_OMP_BIN=/path/to/omp-new.exe bun run omp:check --no-bump
   ```

   `--no-bump` 不會動 `TESTED_OMP`。全部通過時，去掉 `--no-bump` 讓檢查腳本
   自己改寫那個常數（**不要手改**）。
3. 壞掉時只動 `server/omp/` 與 `shared/omp/`。

## 測試

- 測試在 `tests/`，用 `bun:test`。檔名對應被測模組：
  `tests/session-groups.test.ts` ↔ `web/src/lib/session-groups.ts`。
- 不要用真實的 `omp` 或真實網路寫測試——用 stub（見 `tests/fixtures/`）。
- 每個測試都要有**可觀察的行為**。不要為了讓測試過而放寬斷言。

## 提交訊息

用繁體中文，說清楚**為什麼**而不只是改了什麼。格式參考既有的 commit：

```
<類型>: <一句話>

<為什麼這樣做>

<怎麼驗證的>
```

類型：`feat` / `fix` / `chore` / `docs` / `refactor`。

## 不要做的事

- 不要把使用者的對話或憑證寫進程式碼、測試或文件。
- 不要改 `shared/zh-hant.generated.ts`（自動產生，跑 `bun run gen:zh-hant`）。
- 不要放寬 `bun run lint:omp` 的規則來讓自己的改動過關。
- 不要把 `omp` 的原始碼複製進來——這個專案只透過公開的 RPC 協定與它溝通。
