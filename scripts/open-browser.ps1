<#
.SYNOPSIS
	等 gateway 回應 /api/health 之後，用預設瀏覽器開啟 ompDS。

.DESCRIPTION
	這支腳本由 ompDS.ps1 在背景啟動。它每秒輪詢一次 /api/health，最多等 120 秒；
	gateway 回應 200 之後才開瀏覽器，這樣使用者不會看到「無法連線」的頁面。

	開啟瀏覽器用 Start-Process 直接傳網址。在這台機器上 Start-Process 傳網址
	會被「登檔預設」開啟（而不是 Start-Process 直接跑瀏覽器），行為不穩定，
	所以這裡改成：先用 Start-Process 嘗試，確認程序沒有立刻結束，才算成功；
	否則退回讀取 HKCU 的 http UserChoice，自己執行瀏覽器本體。
#>
param(
	[string]$Url = 'http://127.0.0.1:30190/',
	[int]$TimeoutSeconds = 120
)

$health = ($Url.TrimEnd('/')) + '/api/health'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

while ((Get-Date) -lt $deadline) {
	try {
		$response = Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 2
		if ($response.StatusCode -eq 200) {
			$opened = $false
			try {
				$proc = Start-Process $Url -PassThru -ErrorAction SilentlyContinue
				if ($proc) {
					Start-Sleep -Seconds 2
					$opened = -not $proc.HasExited
				}
			} catch {
				$opened = $false
			}
			if (-not $opened) {
				# 退回：找出使用者預設的 http 處理程式，直接執行瀏覽器本體。
				try {
					$choice = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction SilentlyContinue
					if ($choice -and $choice.ProgId) {
						$command = (Get-ItemProperty ('Registry::HKEY_CLASSES_ROOT\' + $choice.ProgId + '\shell\open\command') -ErrorAction SilentlyContinue).'(default)'
						if ($command) {
							$exe = $command.Split('"')[1]
							if ($exe -and (Test-Path -LiteralPath $exe)) { Start-Process -FilePath $exe -ArgumentList $Url }
						}
					}
				} catch {
					# 連登錄檔都讀不到就算了；使用者可以自己開瀏覽器。
				}
			}
			break
		}
	} catch {
		# gateway 還沒起來：繼續等。
	}
	Start-Sleep -Milliseconds 500
}
