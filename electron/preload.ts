/**
 * Preload：在 isolated context 裡跑，負責把「少量、明確」的東西交給 renderer。
 *
 * 為什麼要克制：renderer 載入的是 gateway 提供的頁面，而頁面本身不需要任何 Node 能力。
 * 把 `fs` 或 `child_process` 交出去，等於讓任何一段被注入頁面的字串都能讀磁碟、起行程。
 * 所以這裡只給「renderer 真的用得到、又無法自己取得」的東西：平台與版本。
 */
import { contextBridge } from "electron";

const api = {
	platform: process.platform,
	versions: {
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		node: process.versions.node,
	},
};

contextBridge.exposeInMainWorld("ompDS", api);

export type OmpDsApi = typeof api;
