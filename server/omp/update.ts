/**
 * 上游的更新機制：`omp update --check` 問版本，`omp update` 真的換掉本機那份。
 *
 * 為什麼放在 server/omp/：上游更新命令的旗標、它的輸出文字、它的失敗樣子都是
 * omp 的知識，只有這裡知道；server/main.ts 只看得懂結構化的結果。
 *
 * 為什麼解析要那麼寬容：上游改一句文案不該讓設定頁壞掉。認不出來就回 null
 * 加一句說明，讓前端顯示「讀不到更新資訊」而不是假裝已經是最新。
 */
import type { OmpUpdateStatus } from "../../shared/api.ts";
import { ompUpdateArgs, ompUpdateCheckArgs, ompVersionArgs, runOmp } from "./cli.ts";

/** 上游更新檢查要問網路，給它一段合理的時間。 */
const CHECK_TIMEOUT_MS = 30_000;
/** 換版要下載整個執行檔，比檢查慢得多。 */
const INSTALL_TIMEOUT_MS = 300_000;
/** 讀一次版本號的時間上限。 */
const VERSION_TIMEOUT_MS = 15_000;

/** ANSI 色碼：上游的輸出有顏色，認版本之前先洗掉。 */
const ANSI = /\x1b\[[0-9;]*m/g;

/** 換版失敗的原因；前端照這個碼翻譯，不去猜上游的措辭。 */
export type OmpUpdateFailure = "locked" | "failed" | "unchanged" | "timeout";

export interface OmpUpdateInstall {
	ok: boolean;
	/** 換完之後的版本；失敗時是空字串。 */
	version: string;
	/** 換之前的版本。 */
	previousVersion: string;
	/** 失敗的原因；成功時沒有。 */
	reason?: OmpUpdateFailure;
	/** 上游自己說的話（有的時候比翻譯有用）。 */
	detail?: string;
}

/**
 * 上游印出來的樣子（去掉顏色之後）：
 *   Current version: 18.13.3
 *   ✔ Already up to date
 * 或
 *   Current version: 18.12.6
 *   New version available: 18.13.3
 * 中間還可能夾一行 `Current channel: canary`（上游只在 canary 時印）。
 */
export function parseUpdateOutput(output: string): OmpUpdateStatus {
	const text = output.replace(ANSI, "");
	const current = /Current version:\s*(\S+)/i.exec(text)?.[1] ?? "";
	const latest = /New version available:\s*(\S+)/i.exec(text)?.[1] ?? null;
	const upToDate = /Already up to date/i.test(text);
	// 上游只在 canary 時印通道那一行，沒印就是 stable。
	const channel = /Current channel:\s*canary/i.test(text) ? "canary" : "stable";
	if (!current && !latest && !upToDate) {
		// 認不出來：不要假裝已經是最新，讓前端說「讀不到」。
		return { current: "", latest: null, channel: "unknown", upToDate: false, note: "unparsed" };
	}
	return { current, latest, channel, upToDate };
}

/**
 * 問上游有沒有新版。回不拋例外：任何失敗都變成 note，前端照樣能顯示畫面。
 */
export async function checkUpdate(): Promise<OmpUpdateStatus> {
	let output = "";
	try {
		const run = await runOmp(ompUpdateCheckArgs(), undefined, { timeoutMs: CHECK_TIMEOUT_MS });
		output = run.stdout + run.stderr;
		if (run.timedOut) return { current: "", latest: null, channel: "unknown", upToDate: false, note: "check-failed" };
		if (run.code !== 0) {
			// 檢查失敗（例如連不到發布伺服器），但版本號還是讀得到。
			const current = /Current version:\s*(\S+)/i.exec(output.replace(ANSI, ""))?.[1] ?? "";
			return { current, latest: null, channel: "unknown", upToDate: false, note: "check-failed" };
		}
		return parseUpdateOutput(run.stdout);
	} catch {
		return { current: "", latest: null, channel: "unknown", upToDate: false, note: "check-failed" };
	}
}

/** 讀一次本機的版本號；讀不到是空字串。 */
export async function readVersion(): Promise<string> {
	try {
		const run = await runOmp(ompVersionArgs(), undefined, { timeoutMs: VERSION_TIMEOUT_MS });
		return /(\d+\.\d+\.\d+[^\s]*)/.exec(run.stdout)?.[1] ?? "";
	} catch {
		return "";
	}
}

/**
 * 執行上游的更新。
 *
 * Windows 上正在執行的 omp.exe 不能被覆蓋：這個應用每開一個工作階段就 spawn
 * 一個 `omp --mode rpc-ui`，那些行程抓著執行檔不放。所以先試，真的換不掉就把
 * 原因說清楚（使用者要先把工作階段關掉），不要假裝成功。
 */
export async function installUpdate(): Promise<OmpUpdateInstall> {
	const previousVersion = await readVersion();
	let run;
	try {
		run = await runOmp(ompUpdateArgs(), undefined, { timeoutMs: INSTALL_TIMEOUT_MS });
	} catch (error) {
		return { ok: false, version: "", previousVersion, reason: "failed", detail: (error as Error).message };
	}
	const output = (run.stdout + run.stderr).replace(ANSI, "");
	if (run.timedOut) return { ok: false, version: "", previousVersion, reason: "timeout" };
	if (run.code !== 0) {
		// 上游自己報錯了：把它的話帶回去，那是使用者唯一看得懂的說明。
		const detail = /Failed to check for updates:\s*(.+)/i.exec(output)?.[1] ?? /Update failed:\s*(.+)/i.exec(output)?.[1] ?? output.trim().split("\n").slice(-1)[0] ?? "";
		// 換掉執行檔失敗，多半是那個檔案正被某個行程抓著（Windows）。
		const locked = /EBUSY|EPERM|EACCES|being used by another process|text file busy|resource busy|Access is denied|another process is using/i.test(detail);
		return { ok: false, version: "", previousVersion, reason: locked ? "locked" : "failed", detail: detail.slice(0, 300) };
	}
	const version = await readVersion();
	if (!version) return { ok: false, version: "", previousVersion, reason: "failed", detail: "could not read the version after the update" };
	if (previousVersion && version === previousVersion) {
		// 指令回來了，版本卻沒變：多半是執行檔被工作階段中的行程抓著。
		return { ok: false, version, previousVersion, reason: "locked" };
	}
	return { ok: true, version, previousVersion };
}
