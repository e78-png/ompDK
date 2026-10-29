/**
 * gateway 的自我保護：讓單一 session 的問題不會升級成全域 outage。
 *
 * 為什麼要獨立成一個模組：這個守門人必須**可以被測試**。放在 `server/main.ts`
 * 裡的話，測試就得真的啟動一個 gateway（佔用連接埠、起 omp 子行程）才能碰到它——
 * 那種測試既慢又不穩。獨立出來之後，測試直接呼叫它，行為完全相同。
 */

/** 未處理的 rejection 記錄下來，但**不讓 process 結束**。 */
export function reportUnhandled(reason: unknown): void {
	const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
	console.error(`[unhandled] ${detail}`);
}

/**
 * 掛上未處理 rejection 的守門人。
 *
 * 為什麼需要它：Bun 對未處理的 promise rejection 會直接結束整個 process。
 * gateway 裡有十幾處 fire-and-forget 的 promise（自動改名、背景刷新、讀 stdout…），
 * 它們的失敗本來只該影響一個 session。但沒有這道防線的話，單一 session 的問題
 * 會讓所有分頁斷線、所有 omp 子行程變成孤兒（還在跑、還持有使用者真實的
 * session 檔），下一次啟動才會被 `cleanOrphanSessions` 硬殺。
 *
 * 這是安全網，不是讓錯誤消失：個別的 fire-and-forget 仍然補自己的 `.catch()`，
 * 這裡只是保證「沒有人接的」不會把整個程序帶走。
 */
export function installResilienceHandlers(): void {
	process.on("unhandledRejection", reportUnhandled);
}
