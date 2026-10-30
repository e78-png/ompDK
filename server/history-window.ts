/**
 * 大型 session 的歷史視窗：決定「一次送多少訊息給瀏覽器」。
 *
 * 為什麼需要這個邊界：session 檔是無上限的 JSONL。實測最大的一個 57 MB、21,198 則
 * 訊息。把整份 transcript 一次送出去，代價是：伺服器組 JSON 要 1.2 秒、前端 parse
 * 55 MB 又是好幾秒，接著要建出兩萬個 DOM 節點——使用者看到的是「這個對話開不起來」。
 *
 * 這裡限制的是**送出去**的量，不是**留著**的量：伺服器仍保留完整紀錄，因為
 * 「往前的頁」要從裡面取。前端按需往回取，指令是 `history_page`。
 */

/** snapshot 帶著的訊息數：夠看最近幾輪，也不會讓前端一次 parse 太多。 */
export const HISTORY_WINDOW = 300;

/** 往回取一頁的訊息數。前端按「載入更早」時一次拿這麼多。 */
export const HISTORY_PAGE = 200;

/**
 * omp 回答一個放不進傳輸限制的回應時的錯誤。
 *
 * 這不是「命令不存在」，而是「答案太大」：`get_entries` 對一個 57 MB 的 session
 * 回的 logical frame 超過 64 MiB，omp 直接拒答。上游文件講得很直接：
 * *Large history APIs should use pagination rather than depending on arbitrarily
 * large logical frames.*
 *
 * 遇到它要改走分頁，不能當成致命錯誤——不然大型 session 一開就死，
 * 使用者看到的是「會話程序已退出 / RPC response exceeded the transport limit」。
 */
export function isTransportOverflow(error: unknown): boolean {
	const text = typeof error === "string" ? error : String((error as { error?: unknown } | null)?.error ?? error ?? "");
	return /transport limit/i.test(text);
}
