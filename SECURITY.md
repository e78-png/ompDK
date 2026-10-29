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
