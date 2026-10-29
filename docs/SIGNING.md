# 程式碼簽章

## 現況：安裝檔沒有簽章

`release/ompDK-*.exe` 是**未簽章**的。Windows 的 SmartScreen 會擋下未簽章的下載，
使用者要按「更多資訊 → 仍要執行」才裝得上。

### 為什麼不用自我簽章擋掉這個警告

自我簽章（self-signed）**不會**消除 SmartScreen 的警告——憑證鏈不被 Windows 信任，
SmartScreen 照樣跳，只多一層「無法驗證發布者」的困惑。使用者仍然要手動放行，
而那個憑證還得另外安裝到使用者的機器上（否則連 integrity 都驗不了）。

真正能免掉警告的是**公開信任的簽章憑證**：

| 方案 | 費用 | 適合誰 |
| --- | --- | --- |
| **OV（Open Source）憑證**（SignPath Community、Azure Trusted Signing） | 免費，但只開放給公開的開源專案，且要人工審核 | 本專案符合（公開的 MIT 專案） |
| 商業憑證（EV／OV Code Signing） | 每年數千美元 | 不適合個人專案 |

### 接上憑證要做的（不用改程式碼）

electron-builder 原生支援 `CSC_LINK` 與 `CSC_KEY_PASSWORD`：

```sh
# PFX 憑證檔（.pfx）與它的密碼
CSC_LINK=/path/to/ompdk.pfx CSC_KEY_PASSWORD=... bun run electron:build
```

Windows 上也可以用簽章工具（`signtool sign /fd SHA256 /f ompdk.pfx /p <密碼>`）在打包後簽。

`electron-builder.yml` 不需要為此改任何東西——簽章是環境變數決定的。

### 若要用 OV 憑證

1. 申請 SignPath Community 或 Azure Trusted Signing（需要 GitHub 專案是公開的、
   且通過審核——本專案符合）。
2. 取得憑證後設定 `CSC_LINK`／`CSC_KEY_PASSWORD`，重新打包。
3. 在 [GitHub Releases](https://github.com/e78-png/ompDK/releases) 上傳簽過的安裝檔。

在簽章到位之前，請在說明裡告知使用者要手動放行 SmartScreen——本專案的 release 說明
已經寫了這件事。
