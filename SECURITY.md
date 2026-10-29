# 安全政策

## 這個專案是什麼

ompDK 是**本機**工具：它在你自己的機器上操作你自己安裝的 `omp`（oh-my-pi）coding agent。
預設只綁 `127.0.0.1`，不對外連線。

這代表「誰能碰到它」的答案通常是「能碰到你這台機器的人」。

## 已知的信任邊界

誠實說明比假裝沒有界線有用：

- **gateway 預設可以讀寫整台機器的檔案。** 它的功能包含「挑一個專案資料夾」，
  所以它本來就得能瀏覽磁碟。`POST /api/sessions` 帶入的 `cwd` 會成為可讀範圍。
  這是設計，不是漏洞——但知道這點很重要。
- **`--lan` 模式**會把介面開到區域網路，背後是六位數配對碼。
  流量是**明文 HTTP**（沒有 TLS），配對碼 cookie 有效期 30 天。
  **只在信任的 Wi-Fi 下使用。**
- **憑證留在 omp 自己那裡**（`~/.omp/agent`）。ompDK 不碰 api key，
  但它在 `設定 → 模型供應商` 裡可以**改寫** `models.yml`——那是你的選擇。

## 已做的防護

- 跨站請求與 DNS rebinding：`Host` 與 `Origin` 白名單（`server/request-guard.ts`）。
- 非本機的請求需要先配對。
- 每個回應帶 `Content-Security-Policy: frame-ancestors 'none'`、
  `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、
  `Referrer-Policy: no-referrer`。
- 匯出的 HTML 與預覽的原始檔案用 `sandbox` CSP 隔離。
- 使用者文字不進命令列（提示走 stdin）；模型識別字過形狀檢查。
- 路徑穿越防護（web root 邊界）與錯誤訊息的路徑遮蔽。
- 外部輸入在進入 DOM 前一律經 DOMPurify。
- **專案邊界**：開工作階段與讀檔案都要求 cwd 是「已知專案」
  （使用者釘選的，或已經有工作階段的）。少了這條，任何客戶端都能先開一個
  工作階段把任意目錄變成可讀的。

## 仍然存在的界線（誠實說明）

- **配對成功的手機可以讀整台機器。** `POST /api/sessions` 現在要求 cwd 是已知
  專案，但「已知專案」包含使用者曾經開過工作階段的目錄，而
  `GET /api/fs`（專案資料夾選擇器）本來就能列任意目錄——那是「挑一個專案資料夾」
  這個功能本身需要的。所以配對碼等同於本機檔案系統的讀取權限。
  這是本機工具的性質，不是可以修掉的洞；要收斂得把檔案瀏覽限制在已釘選的專案底下，
  那會讓「挑資料夾」這個功能沒得用。
- **Windows 以外沒有 session 租約。** `sessionLeaseOccupied()` 在 Windows 與 Linux 上
  能查到「有沒有別的行程持有這個 session 檔」，macOS 上查不到（回 `undefined`）。
  結果是 macOS 上同一個 session 可能被終端與網頁同時開著，omp 會另存一份副本
  （對話不會壞，但會多一份檔案）。這個平台的行為沒有實測過。
- **`--lan` 是明文 HTTP。** 配對碼 cookie 有效期 30 天，不綁定裝置。
  共用 Wi-Fi 下流量可被嗅探。要加密得自己架反向代理走 TLS。

## 回報漏洞

請用 GitHub 的 [Security Advisory](https://github.com/e78-png/ompDK/security/advisories/new)
私下回報，**不要**開公開 issue。回報請附上：

1. 受影響的版本（`git log -1` 或設定頁顯示的版本）
2. 重現步驟
3. 影響範圍（能不能讀到檔案／能不能執行命令／只是資訊洩漏）

我會在確認後盡快處理，並在修好之後把你的回報寫進
[CHANGELOG.md](CHANGELOG.md)（除非你要求匿名）。

## 已經修過的問題

見 [CHANGELOG.md](CHANGELOG.md) 的「修正」段落——包含一個 Windows 上的命令列注入
（可執行任意命令）與一個路徑穿越（可讀 web root 以外的檔案）。
