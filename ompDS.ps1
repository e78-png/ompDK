<#
.SYNOPSIS
	一鍵啟動 ompDS 網頁版 Agent 介面（gateway + 瀏覽器）。

.DESCRIPTION
	本腳本會：
	1. 切到「腳本自身所在目錄」（相對於腳本自身，不是呼叫者的 CWD）。
	2. 若 dist/index.html 不存在、或比 web/ 底下任一檔案舊，先跑 bun run build；
	   建置失敗會明確報錯並停止，不會靜默帶著舊檔案啟動。
	3. 以前景方式啟動 gateway（bun run scripts/serve.ts），Ctrl+C 可以停止；
	   同時在背景等 /api/health 回應後，用預設瀏覽器開 http://127.0.0.1:30190/。

.EXAMPLE
	.\ompDS.ps1
	啟動 gateway 並開啟瀏覽器。

.EXAMPLE
	.\ompDS.ps1 -NoOpen
	啟動 gateway 但不開瀏覽器。

.EXAMPLE
	.\ompDS.ps1 --lan
	把 --lan 透傳給 serve.ts（區域網路也能連進來）。

.NOTES
	可透傳給 serve.ts 的旗標只有 --lan；其他旗標（例如 --no-open）一律不透傳，
	以免 serve.ts 收到不认识的參數而報錯。

	若 PowerShell 報「無法載入檔案，因為這個檔案的執行原則受限」，
	改用： powershell -ExecutionPolicy Bypass -File .\ompDS.ps1
#>

$ErrorActionPreference = 'Stop'

# 切到腳本所在目錄：用 $PSScriptRoot（腳本自身位置），不受呼叫者 CWD 影響
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location -LiteralPath $Root

# ---------------------------------------------------------------------------
#  解析參數：只有 -NoOpen / --no-open 與 --lan 有意義，其餘一律忽略
# ---------------------------------------------------------------------------
$NoOpen = $false
$Passthru = @()

foreach ($arg in $args) {
	switch -Regex ($arg) {
		'^(-{1,2})no-?open$' { $NoOpen = $true }
		'^(-{1,2})lan$'      { $Passthru += '--lan' }
		default              { Write-Host "[ompDS] 忽略不支援的參數：$arg" }
	}
}

# ---------------------------------------------------------------------------
#  檢查 bun：沒有就印安裝指引後結束，不要丟難懂的例外
# ---------------------------------------------------------------------------
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
	Write-Host ''
	Write-Host '[ompDS] 找不到 bun。這個專案需要 bun 來執行 build 與 gateway。'
	Write-Host ''
	Write-Host '  安裝指引： https://bun.sh'
	Write-Host '  Windows 可直接執行： powershell -c "irm bun.sh/install.ps1 | iex"'
	Write-Host '  安裝完之後重新開一個終端機視窗，再跑一次本腳本。'
	Write-Host ''
	exit 1
}

# ---------------------------------------------------------------------------
#  判斷前端是否需要重新建置：
#  判斷邏輯放在 scripts/needs-build.ts，因為它同時要能被 .cmd 呼叫。
# ---------------------------------------------------------------------------
$NeedsBuild = (& bun scripts/needs-build.ts) -eq '1'

if ($NeedsBuild) {
	Write-Host '[ompDS] 前端原始檔有更新，正在建置（bun run build）…'
	& bun run build
	if ($LASTEXITCODE -ne 0) {
		Write-Host ''
		Write-Host '[ompDS] 前端建置失敗，已中止啟動。'
		Write-Host '       請先修好上面的錯誤，再重新執行本腳本。'
		Write-Host ''
		exit 1
	}
	Write-Host '[ompDS] 建置完成。'
}

# ---------------------------------------------------------------------------
#  背景小幫手：等 gateway 真的回應 /api/health 之後再開瀏覽器
#  只有「開瀏覽器」是背景的；gateway 本身接下來是前景執行，Ctrl+C 可停。
# ---------------------------------------------------------------------------
if (-not $NoOpen) {
	Start-Process -FilePath 'powershell' -WindowStyle Hidden -ArgumentList @(
		'-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\open-browser.ps1'),
		'-Url', 'http://127.0.0.1:30190/'
	)
}

Write-Host '[ompDS] 啟動 gateway（http://127.0.0.1:30190/），按 Ctrl+C 停止。'

# ---------------------------------------------------------------------------
#  把主控台切成 UTF-8：omp 寫出來的是 UTF-8，而繁中 Windows 的主控台預設是
#  code page 950（Big5），不切的話 gateway 自己的訊息會變成亂碼。
#  結束後還原原本的 code page。
# ---------------------------------------------------------------------------
$OriginalCp = $null
try {
	$cpLine = & cmd.exe /c chcp
	if ($cpLine -match ':\s*(\d+)') { $OriginalCp = $Matches[1] }
	& cmd.exe /c 'chcp 65001 >nul'
} catch {
	# 切不動就算了：只是主控台顯示，gateway 本身照跑。
}

if ($Passthru.Count -gt 0) {
	& bun run scripts/serve.ts @Passthru
} else {
	& bun run scripts/serve.ts
}
$ExitCode = $LASTEXITCODE

if ($OriginalCp) { & cmd.exe /c "chcp $OriginalCp >nul" }
exit $ExitCode
