/**
 * `bun scripts/needs-build.ts` — 前端需要重新建置嗎？
 *
 * 存在這支腳本的原因是：啟動器（.cmd / .ps1）需要在啟動 gateway 之前判斷
 * `dist/` 是不是比 `web/` 的原始檔舊。把它放在 .cmd 內嵌指令裡會踩到 cmd 的
 * 引號與括號解析（一行 `bun -e "...{}..."` 會讓 cmd 報「{ was unexpected at
 * this time.」），所以這裡用一個真正的檔案。
 *
 * 輸出到 stdout：
 *   `1`  需要建置（dist 不存在，或 web/ 底下有檔案比 dist/index.html 新）
 *   `0`  不需要
 * 結束碼一律為 0，讓呼叫端直接讀 stdout 判斷。
 */
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const webDir = path.join(root, "web");
const indexFile = path.join(root, "dist", "index.html");

/** `web/` 底下最新的修改時間；目錄本身不算。 */
function newestSource(dir: string): number {
	let newest = 0;
	const walk = (current: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			try {
				if (entry.isDirectory()) walk(full);
				else newest = Math.max(newest, fs.statSync(full).mtimeMs);
			} catch {
				// 檔案在掃描期間消失；略過即可。
			}
		}
	};
	walk(dir);
	return newest;
}

let built = 0;
try {
	built = fs.statSync(indexFile).mtimeMs;
} catch {
	// 還沒有建置過。
}

process.stdout.write(built > 0 && newestSource(webDir) <= built ? "0" : "1");
