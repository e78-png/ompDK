/**
 * Electron 桌機版注入到 renderer 的橋接介面。
 *
 * 為什麼要宣告它：`electron/preload.ts` 用 `contextBridge.exposeInMainWorld` 把
 * `ompDK` 放上 `window`，但 renderer 這邊看不到 Electron 的型別（那在主行程的
 * 專案裡）。這份宣告只描述「頁面讀得到什麼」，讓使用它的程式碼有型別可依。
 *
 * 為什麼方法都是選擇性的：網頁版根本沒有 `window.ompDK`，所以任何讀取它的
 * 程式碼都必須能安全地處理「不存在」的情況。
 */
export interface OmpDsBridge {
	/** 執行平台，例如 "win32"。 */
	platform: string;
	/** 執行環境的版本號。 */
	versions: { electron: string; chrome: string; node: string };
	/**
	 * 訂閱「主行程請頁面開設定頁」的事件；回傳取消訂閱的函式。
	 * 桌機版的選單（檢查 omp 更新）會用到。
	 */
	onOpenSettings?: (handler: () => void) => () => void;
}

declare global {
	interface Window {
		/** 只有桌機版才有；網頁版是 undefined。 */
		ompDK?: OmpDsBridge;
	}
}
