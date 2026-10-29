# ompDK

**把 `omp`（oh-my-pi）變成瀏覽器裡的 agent 介面：左側 session 紀錄，右側聊天框。**

ompDK 是一個本機 Web 應用，用來操作本機的 [omp](https://github.com/can1357/oh-my-pi) coding agent。
它不重寫 agent——所有推理、工具呼叫、session 存檔都還是 omp 自己在做；
ompDK 是一層介面，用 `omp --mode rpc-ui` 的協定把 omp 接到瀏覽器上。

```
┌──────────────┬──────────────────────────────────┐
│  session 紀錄 │        聊天框                    │
│  今天 / 昨天  │  串流回覆 · 工具呼叫 · diff      │
│  近 7 天/更早 │  送出 / 中斷 / 佇列              │
└──────────────┴──────────────────────────────────┘
```

除了聊天框，介面還有：

- **MCP 面板**（外掛頁的第三個分頁）：顯示 omp **實際載入**的 MCP server——
  傳輸型別、啟用狀態、端點、來源。不是讀設定檔，是問上游的 `/mcp list`。
- **命令面板**（`⌘/Ctrl+K`）：搜尋所有頁面動作。
- **桌機版**（Electron）：可打包成 Windows 安裝檔。
- **繁體中文 / 簡體中文 / English**。

## 快速開始

需要 [Bun](https://bun.sh) 1.4+ 與已安裝並登入模型的 `omp`。

```sh
bun install
bun run scripts/launch.ts     # 或 Windows：ompDK.cmd / ompDK.ps1
```

開啟 <http://127.0.0.1:30190/>。

Windows 上的啟動器：

```sh
ompDK.cmd              # 啟動 gateway（前景，Ctrl+C 可停）並開瀏覽器
ompDK.cmd --no-open    # 不開瀏覽器
ompDK.cmd --lan        # 同時讓區網也能連進來（背後有配對碼）
```

`ompDK.ps1` 是等價的 PowerShell 版本。啟動器會在需要時先重新建置前端，
並把主控台切成 UTF-8，讓 gateway 的中文訊息在繁中 Windows 上也讀得懂。

開發模式（Vite HMR + 代理到 gateway）：

```sh
bun run scripts/serve.ts      # 終端機 A：gateway :30190
bun run dev                   # 終端機 B：Vite :5190
```

## 功能

- **左側 session 紀錄**：時間模式（今天／昨天／近 7 天／更早）與專案模式可切換；
  搜尋、改名、匯出 HTML、封存、唯讀檢視 CLI 佔用的 session。
- **右側聊天框**：串流 markdown、KaTeX 公式、工具呼叫卡片、檔案變更 diff、
  思考摘要摺疊、`/` 指令選單、`@` 檔案補全、圖片附件、送出／中斷／佇列。
- **右側面板**：todos 與 context 用量、subagent 即時進度、檔案樹與預覽、git diff。
- **繁體中文 / 簡體中文 / English**。
- **本機優先**：只綁 `127.0.0.1`，憑證留在 omp 自己的 `~/.omp/agent`。

## 相容性

基底跟著 omp 的版本走。`bun run omp:check` 會對本機安裝的 omp 跑一輪自我檢查
（不呼叫模型、不寫使用者的真實 session），並在只有版本號不符時自己更新 `TESTED_OMP`。

## 安全注意

gateway 預設操作**真實的** omp profile（`~/.omp/agent`）。
「永久刪除」會刪掉真實的 session 檔，不可逆。
要在隔離環境跑請用 `bun run scripts/serve.ts --test`，
或設 `OMP_WEB_AGENT_DIR` 指向別的 profile。

`--lan` 會讓介面開到區網（純 HTTP），只在信任的 Wi-Fi 下使用。

## 文件

- [`docs/PLAN.md`](docs/PLAN.md) — 架構、選型理由、安全邊界、驗證結果
- [`AGENTS.md`](AGENTS.md) — 給 agent 的操作說明（命令、慣例、陷阱）
- [`CHANGELOG.md`](CHANGELOG.md) — 變更紀錄
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 參與開發
- [`SECURITY.md`](SECURITY.md) — 信任邊界與回報漏洞的方式
- [`docs/maintenance.md`](docs/maintenance.md) — 維護記錄（上游的改動記錄也在裡面）

## 授權

本專案 fork 自 [`klffjbkmhjkndml-arch/omp-web`](https://github.com/klffjbkmhjkndml-arch/omp-web)（MIT，
原作者 Rain），該專案本身對話的是 [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi)（MIT）的 RPC 協定。

本 repo 不含任何 omp 的原始碼，只透過其公開的 RPC 協定與本機安裝的 `omp` 溝通。

MIT 授權，版權標示同時保留原作者與本 fork 的修改者（見 [`LICENSE`](LICENSE)）。
上游的原始說明文件保留在 [`docs/upstream-README.md`](docs/upstream-README.md) 與
[`docs/upstream-README.zh-CN.md`](docs/upstream-README.zh-CN.md)。
