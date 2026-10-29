/**
 * Preload：在 isolated context 裡跑，負責把「少量、明確」的東西交給 renderer。
 *
 * 為什麼要克制：renderer 載入的是 gateway 提供的頁面，而頁面本身不需要任何 Node 能力。
 * 把 `fs` 或 `child_process` 交出去，等於讓任何一段被注入頁面的字串都能讀磁碟、起行程。
 * 所以這裡只給「renderer 真的用得到、又無法自己取得」的東西：平台與版本，
 * 以及一條**單向、具名**的 IPC 通道（讓主行程可以請頁面開設定頁）。
 *
 * 為什麼更新檢查要走 IPC 而不是讓主行程直接改網址：改網址會觸發頁面的 hash 路由，
 * 把正在進行的工作階段踢回首頁。改用 IPC 讓頁面自己決定要不要開設定，
 * 使用者正在講的話就不會被打斷。
 */
import { contextBridge, ipcRenderer } from "electron";

const api = {
	platform: process.platform,
	versions: {
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		node: process.versions.node,
	},
	/**
	 * 主行程請頁面開設定頁（桌機版選單的「檢查 omp 更新」用）。
	 * 回傳一個取消訂閱的函式，讓頁面卸載時收掉。
	 */
	onOpenSettings(handler: () => void): () => void {
		const listener = (): void => handler();
		ipcRenderer.on("omp:open-settings", listener);
		return () => ipcRenderer.removeListener("omp:open-settings", listener);
	},
};

contextBridge.exposeInMainWorld("ompDK", api);

export type OmpDsApi = typeof api;
