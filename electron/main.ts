/**
 * Electron 主行程。
 *
 * 為什麼要有這一支：ompDK 的 gateway（Bun + WebSocket）本來是「開一個終端機跑起來、
 * 別人用瀏覽器連過去」的形狀。做成桌面應用後，使用者不該再看到終端機，也不該在關掉
 * 視窗後留下一個沒人管的背景行程。所以這個主行程負責三件事：
 *   1. 找到或啟動一個健康的 gateway（重複啟動會讓兩個 gateway 搶同一個 port）。
 *   2. 開視窗、載入它、盯著它的健康狀態。
 *   3. 視窗關掉時把「自己啟動的」gateway 一起收掉，不留孤兒行程。
 *
 * 註解一律繁體中文，且先講為什麼再講怎麼做（與 repo 其餘程式碼同一個慣例）。
 */
import { app, BrowserWindow, Menu, nativeTheme, Notification, type MenuItemConstructorOptions } from "electron";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** 介面主題色：跟著 web/src/styles/app.css 的 --bg 走，避免視窗閃白。 */
const THEME_BG = { light: "#fafafa", dark: "#0b0d13" };

/** gateway 的 port：環境變數優先，沒有就用 server/config.ts 的預設值 30190。 */
const PORT = Number(process.env.OMP_WEB_PORT ?? 30190);
const HOST = "127.0.0.1";
/** 等待 gateway 就緒的上限（毫秒）。超過就開一個說明錯誤的視窗，不開一片空白。 */
const READY_TIMEOUT_MS = 30_000;

/** 真正由這個主行程啟動的 gateway；若是沿用別人已經在跑的，就不動它。 */
let gateway: ChildProcess | null = null;
/** 沿用既有 gateway 時為 true：關窗時不得把它一起關掉。 */
let gatewayBorrowed = false;
let mainWindow: BrowserWindow | null = null;

/**
 * 這個應用程式認知的「專案根目錄」：裡面要有前端 `dist/`，server 才讀得到頁面。
 * 為什麼要自己算：打包後前端與 server 執行檔都住在 unpacked 資源目錄裡，
 * 而 Electron 的 `app.getAppPath()` 指向的是 `app.asar`（封裝後的虛擬路徑），
 * server 是獨立行程、讀不到 asar，必須指給它真實的 unpacked 目錄。
 */
function resolveAppRoot(): string {
	const explicit = process.env.OMP_DK_ROOT;
	if (explicit) return path.resolve(explicit);
	if (app.isPackaged) {
		const unpacked = path.join(process.resourcesPath, "app.asar.unpacked");
		if (fs.existsSync(path.join(unpacked, "dist"))) return unpacked;
		return process.resourcesPath;
	}
	// 開發模式：electron/app/ 或 electron/dist/ 的上一層就是 repo 根。
	return path.resolve(__dirname, "..", "..");
}

/** 打健康檢查：gateway 回 { ok: true } 才算活著。 */
async function probeHealth(port: number, timeoutMs = 1_500): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`http://${HOST}:${port}/api/health`, { signal: controller.signal });
		if (!response.ok) return false;
		const body = (await response.json()) as { ok?: boolean };
		return body?.ok === true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

/** gateway 啟動需要的環境變數。 */
function gatewayEnv(root: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		/** 沿用同一個 port，主行程與子行程才不會各開一個。 */
		OMP_WEB_PORT: String(PORT),
		/** 資料放 Electron 的 userData，而不是被當成「程式安裝目錄」而沒有寫入權限。 */
		OMP_WEB_DATA_DIR: path.join(app.getPath("userData"), "ompdk-web"),
		/** 告訴 server 前端 `dist/` 在哪裡（打包後是 unpacked 資源目錄）。 */
		OMP_DK_ROOT: root,
	};
}

/**
 * 找出可以啟動 gateway 的方式，依序嘗試：
 *   1. `OMP_DK_SERVER`：外部指定就一定用它，不要自作主張。
 *   2. 打包後的 `ompdk-server.exe`（Windows）/ `ompdk-server`（其他）：放在 Electron 的
 *      resources 旁邊。它必須 unpack——它是一支獨立執行檔，躺在 asar 裡跑不起來。
 *   3. 開發模式退階：`bun run scripts/serve.ts`（`<root>/scripts/serve.ts`）。
 * 回傳 null 代表這個平台沒有任何可用的啟動方式。
 */
function findGatewayCommand(root: string): { command: string; args: string[]; cwd: string } | null {
	const fromEnv = process.env.OMP_DK_SERVER;
	if (fromEnv) return { command: path.resolve(fromEnv), args: [], cwd: root };

	const exeName = process.platform === "win32" ? "ompdk-server.exe" : "ompdk-server";
	// 打包後的 server 與前端 `dist/` 並排在 unpacked 資源根目錄（見 electron-builder.yml），
	// 開發時則可能就在 root 旁邊；兩種位置都找一次。
	const candidates = [
		path.join(root, exeName),
		path.join(root, "server", exeName),
		path.join(process.resourcesPath, exeName),
		path.join(path.dirname(process.execPath), exeName),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return { command: candidate, args: [], cwd: root };
	}

	const serveScript = path.join(root, "scripts", "serve.ts");
	if (fs.existsSync(serveScript)) return { command: "bun", args: ["run", serveScript], cwd: root };
	return null;
}

/** 收掉子行程（連同它的孫行程）。Windows 沒有 process group，只能用 taskkill /T。 */
function killGateway(child: ChildProcess): void {
	if (!child.pid || child.exitCode !== null) return;
	if (process.platform === "win32") {
		// 為什麼用同步的 taskkill：Electron 一下就會結束這個行程，非同步的 taskkill
		// 可能還沒跑到就被一起收掉，gateway 就變成孤兒行程留在背景。
		const killer = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		if (killer.error) child.kill();
		return;
	}
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {
		child.kill("SIGTERM");
	}
}

/**
 * 啟動 gateway 子行程。回傳 false 代表連子行程都生不起來（錯誤訊息在 log 裡）。
 */
function startGateway(root: string): boolean {
	const plan = findGatewayCommand(root);
	if (!plan) {
		console.error("[ompDK] 找不到可用的 gateway 啟動方式（OMP_DK_SERVER、打包好的 ompdk-server 或 bun scripts/serve.ts）。");
		return false;
	}
	console.log(`[ompDK] 啟動 gateway：${plan.command} ${plan.args.join(" ")}`);
	const child = spawn(plan.command, plan.args, {
		cwd: plan.cwd,
		env: gatewayEnv(root),
		stdio: ["ignore", "pipe", "pipe"],
		// POSIX 之下用 process group 收掉整棵樹；Windows 走 taskkill /T。
		detached: process.platform !== "win32",
	});
	gateway = child;
	child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[gateway] ${chunk.toString()}`));
	child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[gateway] ${chunk.toString()}`));
	child.on("exit", (code, signal) => {
		console.log(`[ompDK] gateway 結束（code=${code} signal=${signal}）。`);
		if (gateway === child) gateway = null;
	});
	child.on("error", error => {
		console.error(`[ompDK] gateway 啟動失敗：${error.message}`);
	});
	return true;
}

/** 短暫停頓：輪詢健康檢查時不要用 busy loop 燒 CPU。 */
function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

/** 等 gateway 回應健康檢查；逾時回 false。 */
async function waitForGateway(port: number): Promise<boolean> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await probeHealth(port)) return true;
		await sleep(300);
	}
	return false;
}

/** 逾時時顯示錯誤的頁面：寫成真檔案再用 loadFile 開，比 data: URL 可靠。 */
function showStartupError(detail: string): void {
	const file = path.join(app.getPath("userData"), "startup-error.html");
	const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>ompDK 啟動失敗</title>
<style>
	body{font:14px/1.7 system-ui,"Microsoft JhengHei",sans-serif;margin:0;padding:48px;background:#0b0d13;color:#f1f5f9}
	h1{font-size:20px;margin:0 0 12px}
	pre{white-space:pre-wrap;background:#171b26;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:16px}
	code{color:#f59e0b}
</style></head>
<body>
<h1>ompDK 啟動失敗：gateway 沒有在 30 秒內就緒</h1>
<pre>${detail.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)}

請確認：
1. 這個 port（${PORT}）沒有被其他程式佔用——可用 <code>OMP_WEB_PORT</code> 換一個。
2. <code>omp</code> 執行檔在 PATH 上，或用 <code>OMP_WEB_OMP_BIN</code> 指定。
3. 若是自己啟動的 gateway 已經在跑，請讓它回答 <code>/api/health</code>。</pre>
</body></html>`;
	fs.writeFileSync(file, html, "utf8");
	mainWindow?.loadFile(file);
}

/** 開主視窗。 */
function createWindow(): BrowserWindow {
	const window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 960,
		minHeight: 640,
		title: "ompDK",
		backgroundColor: nativeTheme.shouldUseDarkColors ? THEME_BG.dark : THEME_BG.light,
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			// 最小權限：renderer 只拿得到 preload 明確 expose 出來的東西。
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	window.on("closed", () => {
		mainWindow = null;
	});
	return window;
}

/**
 * 應用程式選單。
 *
 * 為什麼要有「檢查 omp 更新」：桌機版的使用者不會去開設定頁找更新按鈕，
 * 而更新是上游每天都在發版的功能。把它放進選單，使用者隨時看得到。
 * 實際的檢查與安裝由 gateway 做（`/api/omp/update`），這裡只是把它接到選單上。
 */
function buildMenu(): void {
	const template: MenuItemConstructorOptions[] = [
		{
			label: "ompDK",
			submenu: [
				{ label: "檢查 omp 更新…", click: () => void checkOmpUpdate() },
				{ type: "separator" },
				{ role: "quit", label: "結束" },
			],
		},
		{
			label: "編輯",
			submenu: [
				{ role: "undo", label: "復原" },
				{ role: "redo", label: "重做" },
				{ type: "separator" },
				{ role: "cut", label: "剪下" },
				{ role: "copy", label: "複製" },
				{ role: "paste", label: "貼上" },
				{ role: "selectAll", label: "全選" },
			],
		},
		{
			label: "檢視",
			submenu: [
				{ role: "reload", label: "重新載入" },
				{ role: "toggleDevTools", label: "開發者工具" },
				{ type: "separator" },
				{ role: "resetZoom", label: "實際大小" },
				{ role: "zoomIn", label: "放大" },
				{ role: "zoomOut", label: "縮小" },
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** 問 gateway 有沒有新版 omp；有就請頁面開設定頁的「關於」，讓使用者在那裡更新。 */
async function checkOmpUpdate(): Promise<void> {
	if (!mainWindow) return;
	try {
		const response = await fetch(`http://${HOST}:${PORT}/api/omp/update`, { signal: AbortSignal.timeout(30_000) });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const status = (await response.json()) as { current: string; latest: string | null; upToDate: boolean };
		// 不直接改網址：改網址會觸發頁面的 hash 路由，把正在進行的工作階段踢回首頁。
		// 用 IPC 請頁面自己開設定，使用者正在講的話就不會被打斷。
		mainWindow.webContents.send("omp:open-settings");
		if (status.latest && status.latest !== status.current) {
			new Notification({ title: "ompDK", body: `omp ${status.latest} 可用（目前 ${status.current}）` }).show();
		} else {
			new Notification({ title: "ompDK", body: `omp 已是最新（${status.current}）` }).show();
		}
	} catch (error) {
		new Notification({ title: "ompDK", body: `檢查更新失敗：${(error as Error).message}` }).show();
	}
}

/**
…
 * 也不是搶同一個 port 起第二個 gateway。
 */
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!mainWindow) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	});

	void app.whenReady().then(async () => {
		const root = resolveAppRoot();
		console.log(`[ompDK] root=${root}`);
		buildMenu();

		// 先問健康檢查：已經有人在同一個 port 跑著健康的 gateway，就直接借用。
		if (await probeHealth(PORT)) {
			console.log(`[ompDK] 沿用既有的 gateway：http://${HOST}:${PORT}/`);
			gatewayBorrowed = true;
		} else if (!startGateway(root)) {
			mainWindow = createWindow();
			showStartupError("無法啟動 gateway 子行程。");
			return;
		}

		if (!gatewayBorrowed && !(await waitForGateway(PORT))) {
			mainWindow = createWindow();
			showStartupError("gateway 沒有回應 /api/health。");
			return;
		}

		mainWindow = createWindow();
		await mainWindow.loadURL(`http://${HOST}:${PORT}/`);
	});

	app.on("window-all-closed", () => {
		app.quit();
	});

	app.on("before-quit", () => {
		// 只有自己啟動的 gateway 才收；借來的不動。
		if (gateway && !gatewayBorrowed) killGateway(gateway);
		gateway = null;
	});
}
