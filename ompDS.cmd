@echo off
setlocal EnableExtensions

REM ==========================================================================
REM  ompDS.cmd — 一鍵啟動 omp 網頁版 Agent 介面
REM
REM  用法：
REM    ompDS.cmd                 啟動 gateway（前景執行，Ctrl+C 可停止），就緒後開啟瀏覽器
REM    ompDS.cmd --no-open       同上，但不開啟瀏覽器
REM    ompDS.cmd --lan           透傳 --lan 給 serve.ts（區域網路也能連進來）
REM
REM  規則：
REM    - 工作目錄一律是「腳本自身所在目錄」，不受呼叫者的 CWD 影響。
REM    - dist/index.html 不存在、或比 web/ 底下任一檔案舊，就先跑 bun run build；
REM      建置失敗會直接報錯並停止，不會靜默帶著舊檔案啟動。
REM    - gateway 留在前景，所以 Ctrl+C 可以直接停掉它；只有「開瀏覽器」是背景執行。
REM    - 只有 --lan 會被透傳到 serve.ts；其他旗標一律忽略，serve.ts 不會收到看不懂的參數。
REM
REM  這個檔案刻意存成 CP950（繁中 Windows 的主控台編碼）：
REM  cmd.exe 讀批次檔時用的是主控台字碼頁，存成 UTF-8 會讓中文註解被解析成亂碼指令。
REM  .gitattributes 對本檔設了 -text，避免 git 把它改寫。
REM ==========================================================================

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" >nul
if errorlevel 1 (
	echo [ompDS] 無法切換到腳本所在目錄：%SCRIPT_DIR%
	exit /b 1
)

REM --------------------------------------------------------------------------
REM  解析參數：--no-open（ours）、--lan（透傳），其餘忽略
REM --------------------------------------------------------------------------
set "NO_OPEN=0"
set "PASSTHRU="
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--no-open" set "NO_OPEN=1"
if /i "%~1"=="--lan" set "PASSTHRU=--lan"
if /i not "%~1"=="--no-open" if /i not "%~1"=="--lan" echo [ompDS] 忽略不支援的參數：%~1
shift
goto parse_args
:args_done

REM --------------------------------------------------------------------------
REM  bun 是 build 與 gateway 都要用到的必要程式
REM --------------------------------------------------------------------------
where bun >nul 2>&1
if errorlevel 1 (
	echo.
	echo [ompDS] 找不到 bun。這個專案需要 bun 來執行 build 與 gateway。
	echo.
	echo   安裝指引： https://bun.sh
	echo   Windows 可直接執行： powershell -c "irm bun.sh/install.ps1 ^| iex"
	echo   安裝完之後重新開一個終端機視窗，再跑一次本腳本。
	echo.
	popd
	exit /b 1
)

REM --------------------------------------------------------------------------
REM  前端是否過期？判斷邏輯放在 scripts/needs-build.ts：把判斷寫成
REM  bun -e 單行內嵌在批次檔裡，會踩到 cmd 的括號解析。
REM --------------------------------------------------------------------------
set "STALE=1"
for /f "usebackq delims=" %%i in (`bun scripts/needs-build.ts`) do set "STALE=%%i"

if "%STALE%"=="1" (
	echo [ompDS] 前端原始檔有更新，正在建置（bun run build）…
	call bun run build
	if errorlevel 1 (
		echo.
		echo [ompDS] 前端建置失敗，已中止啟動。
		echo        請先修好上面的錯誤，再重新執行本腳本。
		echo.
		popd
		exit /b 1
	)
	echo [ompDS] 建置完成。
)

REM --------------------------------------------------------------------------
REM  gateway 回應 /api/health 之後才開瀏覽器。等待器是獨立的 .ps1 檔案，
REM  這樣本批次檔裡就不會有讓 cmd 難以解析的花括號與引號。
REM --------------------------------------------------------------------------
if "%NO_OPEN%"=="0" (
	start "" /b powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\open-browser.ps1" -Url "http://127.0.0.1:30190/"
)

echo [ompDS] 啟動 gateway（http://127.0.0.1:30190/），按 Ctrl+C 停止。
rem gateway 留在前景，所以 Ctrl+C 真的停得掉。
bun run scripts/serve.ts %PASSTHRU%
set "EXIT_CODE=%ERRORLEVEL%"

popd
exit /b %EXIT_CODE%
