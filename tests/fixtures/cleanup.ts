/**
 * 測試的臨時目錄清理。
 *
 * 為什麼需要這個 helper：測試會起真的行程（假的 omp），而 Windows 上正在
 * 執行的行程會抓住它的執行檔——目錄就刪不掉，`rmSync` 丟出 EBUSY，
 * 整個測試套件就紅了（即使所有測試本身都通過）。
 *
 * 那是**清理**的問題，不是被測程式的問題：臨時目錄本來就會被作業系統收掉，
 * 刪不掉不該讓一整輪驗證失敗。所以這裡重試幾次，最後還是不行就記錄下來就算。
 */
import * as fs from "node:fs";

/** 重試幾次、每次間隔多久（毫秒）。 */
const ATTEMPTS = 5;
const INTERVAL_MS = 200;

/**
 * 刪掉測試的臨時目錄；抓不到就算了。
 *
 * @returns true 表示刪掉了（或者本來就不存在）
 */
export function removeTempDir(dir: string): boolean {
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			// EBUSY / EPERM：Windows 上有行程還抓著檔案。等一下再試。
			if (code !== "EBUSY" && code !== "EPERM") {
				console.warn(`[cleanup] ${dir}：${(error as Error).message}`);
				return false;
			}
			// 同步等待——afterAll 是同步的，不能用 await。
			const until = Date.now() + INTERVAL_MS;
			while (Date.now() < until) {
				/* 忙等 */
			}
		}
	}
	console.warn(`[cleanup] ${dir} 刪不掉（大概還有行程抓著它），留給作業系統收。`);
	return false;
}
