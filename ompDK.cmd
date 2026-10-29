@echo off
setlocal EnableExtensions

REM ==========================================================================
REM  ompDK.cmd - start the ompDK web UI (gateway + browser)
REM
REM  Usage:
REM    ompDK.cmd              start the gateway (foreground, Ctrl+C stops it) and open the browser
REM    ompDK.cmd --no-open    same, but do not open a browser
REM    ompDK.cmd --lan        pass --lan through to serve.ts (also reachable on the LAN)
REM
REM  Rules:
REM    - The working directory is always this script's own directory, whatever
REM      the caller's CWD is.
REM    - If dist/index.html is missing, or older than any file under web/, the
REM      frontend is rebuilt first. A failed build stops the launch.
REM    - The gateway runs in the foreground so Ctrl+C stops it; only opening the
REM      browser happens in the background.
REM    - Only --lan is passed through to serve.ts. Every other flag is ignored
REM      so serve.ts never sees an argument it does not understand.
REM
REM  This file is deliberately ASCII-only. cmd.exe reads a batch file in the
REM  console code page, so any non-ASCII byte in a comment can be parsed as part
REM  of a command. The Chinese documentation lives in ompDK.ps1 and AGENTS.md.
REM
REM  The console code page is switched to UTF-65001 for the gateway: omp writes
REM  UTF-8, and on a Traditional Chinese Windows (code page 950) that would
REM  otherwise come out as mojibake. The original code page is restored on exit.
REM ==========================================================================

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" >nul
if errorlevel 1 (
	echo [ompDK] Cannot enter the script directory: %SCRIPT_DIR%
	exit /b 1
)

REM --------------------------------------------------------------------------
REM  Remember the console code page so it can be restored when the gateway ends
REM --------------------------------------------------------------------------
set "ORIGINAL_CP="
for /f "tokens=3" %%c in ('chcp') do set "ORIGINAL_CP=%%c"

REM --------------------------------------------------------------------------
REM  Parse the arguments: --no-open (ours), --lan (passed through), rest ignored
REM --------------------------------------------------------------------------
set "NO_OPEN=0"
set "PASSTHRU="
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--no-open" set "NO_OPEN=1"
if /i "%~1"=="--lan" set "PASSTHRU=--lan"
if /i not "%~1"=="--no-open" if /i not "%~1"=="--lan" echo [ompDK] Ignoring unsupported argument: %~1
shift
goto parse_args
:args_done

REM --------------------------------------------------------------------------
REM  bun is required for both the build and the gateway
REM --------------------------------------------------------------------------
where bun >nul 2>&1
if errorlevel 1 (
	echo.
	echo [ompDK] bun was not found. This project needs bun to build and to run the gateway.
	echo.
	echo   Install it from: https://bun.sh
	echo   On Windows: powershell -c "irm bun.sh/install.ps1 ^| iex"
	echo   Then open a new terminal and run this script again.
	echo.
	popd
	exit /b 1
)

REM --------------------------------------------------------------------------
REM  Is the frontend stale? The check lives in scripts/needs-build.ts: a bun -e
REM  one-liner inside a batch file breaks cmd's parenthesis counting.
REM --------------------------------------------------------------------------
set "STALE=1"
for /f "usebackq delims=" %%i in (`bun scripts/needs-build.ts`) do set "STALE=%%i"

if "%STALE%"=="1" (
	echo [ompDK] Web sources changed, building the frontend ^(bun run build^)...
	call bun run build
	if errorlevel 1 (
		echo.
		echo [ompDK] The frontend build failed, so the launch was stopped.
		echo        Fix the errors above and run this script again.
		echo.
		popd
		exit /b 1
	)
	echo [ompDK] Build done.
)

REM --------------------------------------------------------------------------
REM  Open the browser once the gateway answers /api/health. The waiter is a
REM  separate .ps1 file so this batch file stays free of braces and quotes.
REM --------------------------------------------------------------------------
if "%NO_OPEN%"=="0" (
	start "" /b powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\open-browser.ps1" -Url "http://127.0.0.1:30190/"
)

REM --------------------------------------------------------------------------
REM  UTF-8 console for the gateway's own messages (omp writes UTF-8).
REM --------------------------------------------------------------------------
chcp 65001 >nul

echo [ompDK] Starting the gateway ^(http://127.0.0.1:30190/^) - press Ctrl+C to stop.
rem The gateway stays in the foreground so Ctrl+C really stops it.
bun run scripts/serve.ts %PASSTHRU%
set "EXIT_CODE=%ERRORLEVEL%"

if not "%ORIGINAL_CP%"=="" chcp %ORIGINAL_CP% >nul
popd
exit /b %EXIT_CODE%
