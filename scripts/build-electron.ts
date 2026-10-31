#!/usr/bin/env bun
/**
 * Electron 打包流程。
 *
 * 為什麼要有這一支：桌機版的產物有兩層——「Electron 應用程式本身」與「gateway 執行檔」。
 * 兩者的相依關係（前端 `dist/` 要在哪、server 執行檔要放在哪）很容易在手工步驟裡出錯，
 * 所以把順序固定成一支腳本，讓誰跑都得到一樣的結果。
 *
 * 順序：
 *   1. 建前端（`bun run build` → `dist/`）：server 是從磁碟讀 `dist/` 的，沒有它就一片空白。
 *   2. 編譯 gateway（`bun build --compile` → `electron/build/server/ompdk-server.exe`）：
 *      它必須是獨立執行檔，Electron 才不用依賴使用者機器上裝了 Bun。
 *   3. 編譯 Electron 程式碼（`tsc` → `electron/dist/`）。
 *   4. 呼叫 electron-builder 產生安裝檔（`release/`）。
 *
 * `--dev` 只做 1（必要時）、3，然後直接啟動 Electron，不打包。
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const dev = process.argv.includes("--dev");
const isWindows = process.platform === "win32";

/** 跑一步會失敗就整個停下來：打包流程中斷在 halfway 只會留下難以判讀的半成品。 */
function run(label: string, command: string, args: string[]): void {
	console.log(`\n[electron] ${label}：${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: isWindows });
	if (result.error) {
		console.error(`[electron] ${label} 失敗：${result.error.message}`);
		process.exit(1);
	}
	if (result.status !== 0) {
		console.error(`[electron] ${label} 失敗（exit ${result.status}）。`);
		process.exit(result.status ?? 1);
	}
}

// ── 1. 前端 ──────────────────────────────────────────────────────────────────
// 為什麼開發模式也要建：`dist/` 不存在時 gateway 會回 404，畫面就是一片空白。
const indexHtml = path.join(root, "dist", "index.html");
if (dev && fs.existsSync(indexHtml)) {
	console.log("[electron] 前端已存在，略過建置（要強制重建請先刪掉 dist/）。");
} else {
	run("建置前端", "bun", ["run", "build"]);
}

// ── 2. gateway 執行檔（僅打包時需要）─────────────────────────────────────────
if (!dev) {
	// 為什麼輸出到 `electron/server/` 而不是 `electron/build/server/`：
	// electron-builder 預設會排除任何名為 `build` 的目錄（`!build{,/**/*}`），
	// 放在那裡會讓 server 執行檔在打包時被整個丟掉。
	const serverDir = path.join(root, "electron", "server");
	// 先清空：electron-builder 會把整個 `electron/server/` 打包，而這個目錄不在
	// 版控裡，改名前留下的舊執行檔（`ompds-server.exe`，83 MB）會跟著被裝進
	// 每一個安裝檔。乾淨的 checkout 沒有這個問題，所以只有本機打包會多 18 MB。
	fs.rmSync(serverDir, { recursive: true, force: true });
	fs.mkdirSync(serverDir, { recursive: true });
	const serverExe = path.join(serverDir, isWindows ? "ompdk-server.exe" : "ompdk-server");
	run("編譯 gateway", "bun", ["build", "--compile", "server/main.ts", "--outfile", serverExe]);
}

// ── 3. Electron 程式碼 ──────────────────────────────────────────────────────
// 為什麼用 `--project` 而不是短寫法：兩者等價，但 `lint:omp` 會把 tsc 的短專案
// 旗標誤判成 omp 的 print 旗標，要求把它集中到 `server/omp/cli.ts`。那是誤判——
// tsc 的旗標跟 omp 毫無關係。改用長寫法就不會踩到那條規則，也不必為了掃描器
// 去放寬規則。
run("型別檢查 Electron 程式碼", "bunx", ["tsc", "--noEmit", "--project", "electron/tsconfig.json"]);
run("編譯 Electron 程式碼", "bunx", ["tsc", "--project", "electron/tsconfig.build.json"]);

// 為什麼要改名成 .cjs：repo 的 package.json 是 `"type": "module"`，而 Electron 主行程
// 與 sandbox 化的 preload 必須是 CommonJS（preload 依副檔名決定模組系統）。
// `.cjs` 不管外層怎麼宣告都一定是 CommonJS，最沒有歧義。
const electronDist = path.join(root, "electron", "dist");
for (const name of ["main", "preload"]) {
	const js = path.join(electronDist, `${name}.js`);
	const cjs = path.join(electronDist, `${name}.cjs`);
	if (fs.existsSync(js)) fs.renameSync(js, cjs);
}

// ── 4. 打包 ──────────────────────────────────────────────────────────────────
if (dev) {
	const electronExe = path.join(root, "node_modules", "electron", "dist", isWindows ? "electron.exe" : "electron");
	if (!fs.existsSync(electronExe)) {
		console.error(`[electron] 找不到 Electron 執行檔：${electronExe}（請先跑 bun install）。`);
		process.exit(1);
	}
	console.log(`\n[electron] 啟動 Electron（開發模式，不打包）：${electronExe}`);
	const result = spawnSync(electronExe, [path.join(electronDist, "main.cjs")], {
		cwd: root,
		stdio: "inherit",
		shell: isWindows,
	});
	process.exit(result.status ?? 0);
}

run("打包", "bunx", ["electron-builder", "--publish", "never"]);
console.log(`\n[electron] 完成，產物在 ${path.join(root, "release")}`);
