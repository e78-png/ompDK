import * as os from "node:os";
import * as path from "node:path";
import { OMP_LAYOUT } from "../shared/omp/conventions.ts";

/**
 * Bun 編譯產物（`bun build --compile`）的 `import.meta.dir` 不是磁碟上的真實路徑，
 * 而是 Bun 的虛擬根目錄：Windows 上長得像 `B:\~BUN\root`，POSIX 上是 `/\~BUN/root`。
 * 認法：路徑片段中出現以 `~BUN` 開頭的一段（`~BUN` 是 Bun 自己發明的前綴，
 * 真實檔案系統不會有這種以 `~` 開頭的目錄名）。
 * 為什麼要在意：`path.resolve()` 對這種假路徑算出來的 root 會是 `B:\~BUN`，
 * 後面 `mkdir` dataDir 時就會變成 `EPERM: operation not permitted, mkdir '\'`。
 */
function isBunVirtualDir(dir: string): boolean {
	return dir
		.split(/[\\/]+/)
		.filter(Boolean)
		.some(segment => segment === "~BUN" || segment.startsWith("~BUN"));
}

/**
 * 專案根目錄（放著 `dist/` 與 `.data/` 的那一層）。
 * 決定順序：
 * 1. `OMP_DS_ROOT`：外部（Electron 桌機版、打包腳本）明確指定時一律採用，
 *    因為打包後的執行檔與前端 `dist/` 的相對位置會隨打包方式改變，
 *    與其猜不如讓啟動者告訴它。
 * 2. Bun 編譯產物：改用 `path.dirname(process.execPath)`，也就是執行檔自己所在的
 *    目錄——那才是真的、可以拿來讀 `dist/` 的地方。
 * 3. 原始碼執行：`path.resolve(import.meta.dir, "..")`，也就是 `server/` 的上一層。
 */
function resolveRoot(): string {
	const explicit = process.env.OMP_DS_ROOT;
	if (explicit) return path.resolve(explicit);
	if (isBunVirtualDir(import.meta.dir)) return path.dirname(process.execPath);
	return path.resolve(import.meta.dir, "..");
}

const root = resolveRoot();

function parseModelLock(value: string | undefined): { provider: string; model: string } | undefined {
	if (!value) return undefined;
	const slash = value.indexOf("/");
	if (slash <= 0) return undefined;
	return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

/** Explicit OMP profile directory; unset means omp's default `~/.omp/agent`. */
const agentDir = process.env.OMP_WEB_AGENT_DIR ? path.resolve(process.env.OMP_WEB_AGENT_DIR) : undefined;

/** `ompweb --lan`: answer on every interface instead of loopback only. */
const lan = process.env.OMP_WEB_LAN === "1";

export const config = {
	root,
	port: Number(process.env.OMP_WEB_PORT ?? 30190),
	host: lan ? "0.0.0.0" : "127.0.0.1",
	/** `OMP_WEB_ALLOWED_HOSTS`: extra names the request guard accepts, for a reverse proxy. */
	allowedHosts: (process.env.OMP_WEB_ALLOWED_HOSTS ?? "")
		.split(",")
		.map(name => name.trim())
		.filter(Boolean),
	lan,
	ompBin: process.env.OMP_WEB_OMP_BIN ?? "omp",
	agentDir,
	sessionsRoot: path.join(agentDir ?? path.join(os.homedir(), ...OMP_LAYOUT.defaultAgentDir), OMP_LAYOUT.sessionsDir),
	/** `provider/model` — forces every spawned session onto one model (test profile). */
	modelLock: parseModelLock(process.env.OMP_WEB_MODEL_LOCK),
	dataDir: path.resolve(process.env.OMP_WEB_DATA_DIR ?? path.join(root, ".data", "web")),
	distDir: path.join(root, "dist"),
	/** Idle sessions with no attached browser are stopped after this long. */
	idleStopMs: Number(process.env.OMP_WEB_IDLE_STOP_MS ?? 10 * 60_000),
	/** One-shot model call after the first exchange writes a better session title. */
	autoTitle: process.env.OMP_WEB_AUTO_TITLE !== "0",
};
