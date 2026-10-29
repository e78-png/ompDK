# ompDS 規劃

ompDS = **ompDS Web**，把 `omp`（oh-my-pi）這個終端機 agent 變成一個「各大 AI 公司都有的那種 agent 應用介面」：
左邊是 session 紀錄，右邊是聊天框。

本文件說明：為什麼這樣做、二次開發做了什麼、還有什麼沒做。

---

## 1. 現況：omp 本身已經具備什麼

`omp` 是本機的 coding agent，binary 在 `C:\Users\e7896\AppData\Local\omp\omp.exe`（18.12.6）。

實測確認的關鍵事實：

| 事實 | 證據 |
| --- | --- |
| `omp --mode rpc` / `--mode rpc-ui` 是 **newline-delimited JSON over stdio**，不是 JSON-RPC 2.0 | 開機即吐 `{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],...}` |
| 協定 v2 需要 client 主動送 `{"type":"negotiate_protocol","protocolVersion":2}`；超長 frame 會被切成 `rpc_chunk`（base64 分片） | 上游 `docs/rpc.md`「Transport and Framing」 |
| session 是磁碟上的 `.jsonl`，在 `~/.omp/agent/sessions/<編碼後的 cwd>/<時間戳>_<uuid>.jsonl` | 本機 291 個檔案，實測 |
| `-r <sessionId>` 可以續接；`omp --export <path>` 可匯出 HTML | `omp --help` |
| 內建模型 11 個（minimax-code 系列），憑證在 `~/.omp/agent` | `omp models --json` |
| `--model rpc-ui` 模式下 `ask` 對話卡、subagent 進度、delta update、訊息分頁都可用 | `bun run omp:check` 對實機 profile 跑出 28/29 通過 |

上游文件：`https://github.com/can1357/oh-my-pi`（MIT）。
`docs/rpc.md` 是協定的權威來源；`docs/session-switching-and-recent-listing.md` 說明 session 檔的結構。

**結論：不需要自己實作 agent 迴圈、模型串接、session 存檔。** 這些 omp 都有。
要做的是把它「開箱可用的介面」接起來。

---

## 2. 選型：第二次開發用哪個專案

評估了 GitHub 上所有針對 omp 的 Web UI（`nibblebot/omp-web`、`agegr/pi-web`、`Po1nt9/omp-web`、
`klffjbkmhjkndml-arch/omp-web`、`theturtlecsz/omp-webui`、`dylansantwani/oh-my-pi-desktop` 等），
最後選 **`klffjbkmhjkndml-arch/omp-web`** 作為基底：

| 候選 | 贊成 | 反對 |
| --- | --- | --- |
| **klffjbkmhjkndml-arch/omp-web**（選用） | 正是「左側 session 紀錄 + 右側聊天框」；MIT；跟著 omp 版本走（`TESTED_OMP` 機制）；`bun run omp:check` 會自己驗證相容性；前後端都有測試 | 介面只有簡體中文 |
| agegr/pi-web | 7.9k stars，功能最全 | 是給 `pi`（earendil-works）不是 `omp`，協定細節對不上 |
| nibblebot/omp-web | 用 SDK 而非 RPC，能控制 daemon | 太重（21 MB），早期階段，Solide 技術棧與本機既有棧不合 |
| dylansantwani/oh-my-pi-desktop | Electron + React，Windows 桌面 | 打包 Electron 體積大；只支援桌面，不符「瀏覽器介面」 |

基底已經實測通過：`bun install` → `bun run build` → `bunx tsc --noEmit` 全部乾淨，
gateway 起來後 `GET /api/index` 回傳 16 個專案、110 個 session。

---

## 3. 架構

```
┌──────────────── 瀏覽器 (React 19 + Vite) ─────────────────┐
│  Sidebar          │        SessionView                   │
│  ├ 時間模式       │  ├ 對話串流（markdown / KaTeX）      │
│  │  今天          │  ├ 工具呼叫卡片 / diff              │
│  │  昨天          │  ├ Composer（送出 / 中斷 / 佇列）    │
│  │  近 7 天       │  └ Inspector（右側：todos / subagent │
│  │  更早          │                    / files / diff）  │
│  └ 專案模式       │                                      │
└────────────────────┬─────────────────────────────────────┘
                     │ WebSocket /ws（omp RPC 影射）
┌────────────────────┴─────────────────────────────────────┐
│  Bun gateway（server/）                                    │
│  ├ session-hub   每個開啟的 session 一個 omp 子行程        │
│  ├ session-index 掃 ~/.omp/agent/sessions 的 .jsonl        │
│  ├ omp-process   JSONL framing + v2 chunk 重组 + 請求配對   │
│  └ providers     models.yml / config 的外科式改寫          │
└────────────────────┬─────────────────────────────────────┘
                     │ stdio：omp --mode rpc-ui
              ┌──────┴───────┐
              │  omp.exe     │  →  ~/.omp/agent/sessions/*.jsonl
              └──────────────┘
```

分層規則（基底專案已強制，`bun run lint:omp` 會驗）：

- `server/omp/` 與 `shared/omp/` 是**唯一**知道 omp 細節的地方。flag、錯誤碼文字、frame 欄位只在這裡。
- 其餘程式碼只跟 gateway 的 HTTP/WS 介面講話。
- 這讓 omp 升級時的影響面可控：改兩個目錄，跑 `bun run omp:check`。

---

## 4. 二次開發內容

### 4.1 繁體中文介面（zh-Hant）

基底只有 `zh`（簡體）與 `en`。用 `opencc-js` 的 `cn → twp` 轉換產生繁體表：

- `scripts/gen-zh-hant.ts` 掃描所有含漢字的 TS 字串常值，產生 `shared/zh-hant.generated.ts`。
- 前端 `t()`、後端 `msg()`、`shared/commands.ts` 的中文標籤都查同一張表。
- 查不到就回原文——新文案在重跑產生器之前會暫時是簡體，這是刻意的 fallback。
- 繁體是**新增**選項，簡體與英文都保留。

### 4.2 扁平 session 紀錄清單（ChatGPT / Claude Desktop 風格）

左側側欄新增「時間」模式（預設）與既有的「專案」模式：

- 時間模式：今天 / 昨天 / 近 7 天 / 更早四組，依 `activeAt`（真的聊過的時間，不是檔案 mtime）。
- 每列右側顯示相對時間，右上角顯示所屬專案名。
- 專案模式完全保留（分組、摺疊、每專案「新建會話」）。

### 4.3 ompDS 品牌化

介面名稱、頁籤標題、PWA manifest、圖示改成 ompDS。底層仍然是 omp——`ompDS` 是它的介面層。

### 4.4 Windows 一鍵啟動

`ompDS.cmd` / `ompDS.ps1`：切到腳本自身目錄 → 判斷前端是否需要 rebuild → 前景啟動 gateway
（Ctrl+C 可停）→ 就緒後開瀏覽器。`--lan` 可透傳，其餘旗標一律忽略以免 serve.ts 報錯。

三個 Windows 實測踩到的坑，寫在 `AGENTS.md` 與啟動器自己的註解裡：

- **批次檔必須是純 ASCII**：cmd.exe 以主控台字碼頁讀批次檔，非 ASCII 位元組會被
  當成指令的一部分解析（症狀是 `'REM' is not recognized`）。
- **批次檔必須是 CRLF**：只有 LF 時 cmd 會把 `REM …` 拆成兩行執行。
- **主控台要切 UTF-8**：omp 寫出來的是 UTF-8，而繁中 Windows 的主控台預設是
  code page 950（Big5）。啟動器在啟動 gateway 前 `chcp 65001`，結束後還原原本的
  碼頁；不切的話 gateway 自己的訊息（手機訪問網址、訪問碼、埠被占用）全是亂碼。
  終端機訊息也一併改成繁體（`scripts/to-zh-hant-console.ts` 機械式轉換）。

### 4.5 相容性釘選

`bun run omp:check` 對實機 profile 跑出 28/29 通過，唯一警告是版本號。
`TESTED_OMP` 由檢查腳本自己改寫（人不手改），本次從 18.8.9 改為 18.12.6。

### 4.6 實測：omp 升級後能不能繼續用

**實測過：18.12.6 → 18.13.3 完全相容。** 上游發布很頻繁（近兩週 18.11.3 → 18.13.3，
平均一天一個版本），所以這不是假設，是必須驗的東西。

做法：下載 v18.13.3 的 `omp-windows-x64.exe`，用 `OMP_WEB_OMP_BIN` 指向它，
對**真實 profile** 跑 `bun run omp:check`：

```
⚠ 18.13.3  — 本应用验证过的是 18.12.6；跑完这份检查其余项都过了就可以改它
✓ 协议版本 2  — v2 分帧可用
✓ 增量更新 / ask 对话卡片 / 子代理订阅  — 已协商
✓ 8 个必需字段  — 全部读到
✓ 78 条命令  — 每条都有 name
✓ session 头 / 标题槽或首个用户消息
✓ models --json：11 个模型
28/29 项通过，1 项警告，0 项失败。
```

再用那個新 binary 實際起一個 gateway，從瀏覽器送一輪真實訊息：
8 秒收到回覆、串流與 token 統計正常、`/api/health` 回報 `"version":"18.13.3"`。

**升級後要做的唯一一件事**：把 `TESTED_OMP` 從舊版號改成新版號。這是
`bun run omp:check` 自己寫的（跑完 28/29、唯一警告是版本號時），人不手改。

**壞掉時會怎樣**：協定一改，`omp:check` 會紅，接著只動 `server/omp/` 與
`shared/omp/` 兩個目錄——它們是唯一知道 omp 細節的地方（`bun run lint:omp` 會
驗這條規則沒有被破壞）。實際症狀通常是「能力協商降級」：少了 delta update
就改收整包訊息，少了 ask 卡片就退回一般的選擇/輸入卡，兩者都有 fallback，
不會整個不能用。

**上游 rpc.md 的變更頻率**（近 100 筆 commit 都在動它）說明這個協定還在長，
所以「相容」不是永久保證，是每次升級都要重驗的狀態。

---

## 5. 安全邊界（重要）

gateway **預設讀寫使用者真實的 omp profile**：`C:\Users\e7896\.omp\agent`（291 個真實 session）。

| 行為 | 寫在哪 | 危險度 |
| --- | --- | --- |
| 讀 session（索引、標題、訊息） | `~/.omp/agent/sessions/**` | 只讀 |
| 改名 session | 同一個 .jsonl 的標題欄位 | 可逆 |
| 封存 | 只寫 `.data/web/archived.json`，不碰真實檔案 | 安全 |
| **永久刪除** | 刪掉真實 .jsonl | **不可逆**（設定 → 已封存的會話 → 永久刪除） |
| 匯出 HTML | 只寫 `.data/web/exports/` | 安全 |
| 改模型供應商 | 改寫 `~/.omp/agent/models.yml`（先備份） | 可逆（有備份） |
| 改 agent 設定 | `omp config set` 經 omp 自己落盤 | 可逆 |

**規則**：

- 要跑在別的 profile 上就用 `OMP_WEB_AGENT_DIR`，或 `bun run scripts/serve.ts --test`（隔離 profile）。
- 不要在沒備份的情況下碰「永久刪除」。
- gateway 只綁 `127.0.0.1`。`--lan` 會開到區網，**必須**在信任的 Wi-Fi 下使用（純 HTTP，流量可被嗅探）。

---

## 6. 驗證

全部在這台機器（Windows 11、繁中主控台 code page 950、omp 18.12.6）上實測。

| 項目 | 方式 | 結果 |
| --- | --- | --- |
| 前端建置 | `bun run build` | 通過 |
| 型別 | `bunx tsc --noEmit -p tsconfig.json` | 通過 |
| 單元測試 | `bun test` | **304 pass / 0 fail**（基線在同機為 13 fail） |
| omp 分層規則 | `bun run lint:omp` | 通過（102 檔掃描） |
| omp 相容性 | `bun run omp:check`（實機 profile） | 28/29，唯一警告是版本號；`TESTED_OMP` 已由腳本改為 18.12.6 |
| 端對端 | 瀏覽器送「只回覆這四個字：二次開發完成」 | 4 秒收到「二次開發完成」，串流／計時／token 統計正常 |
| 側欄兩種模式 | 切換「時間／專案」 | 時間模式四組分層正確（今天／昨天／近 7 天／更早），專案模式分組與摺疊正常 |
| 繁體介面 | 切換語言 | 介面與終端機輸出皆為可讀繁體中文 |
| 啟動器 | 從 `C:\` 以 cmd 與 PowerShell 呼叫 | gateway 啟動、`/api/health` 回 200、`--lan` 透傳後回報 `"lan":true` |

修掉的兩個既有缺陷（都在這台 Windows 上實測會擋路）：

| 缺陷 | 位置 | 症狀 |
| --- | --- | --- |
| `.cmd`/`.bat` 直接餵 `Bun.spawn` 會 EINVAL | `server/omp/cli.ts` | 模型供應商設定與相容性檢查整片失效（13 個測試紅） |
| `invalidateModels()` 的非同步 `rm` 會刪掉後來才寫入的快取檔 | `server/models.ts` | 冷啟動讀磁碟快取失效，多跑一次 `omp models` |

---

## 7. 還沒做 / 下一步

- **沒有**做多使用者、權控、雲端部署。這個設計就是一個人一台機器的本機工具。
- **沒有**做 session 內容的全文檢索（只有標題過濾）。上游 `omp` 有 `grep` 能力，但接進索引需要改 `server/session-index.ts`。
- **沒有**做行動版專用排版（基底有 760px 斷點的抽屜式側欄，夠用但不完美）。
- 下一步的自然候選：把 subagent 的即時轉錄也放進左側時間列；把 `/` 指令選單做成跨 session 的全域搜尋。

---

## 8. 授權

基底 `klffjbkmhjkndml-arch/omp-web` 為 MIT。omp 本體 `can1357/oh-my-pi` 亦為 MIT。
本 fork 只在**本機** commit，永遠不 push。
