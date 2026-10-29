/**
 * Every omp command line, and the one environment variable omp reads.
 *
 * Flags are the interface most likely to change under us and the hardest to see
 * change: a renamed flag is a 500 in one screen, or in the worst case a test profile
 * that quietly writes the user's real one. So each line is assembled here, and
 * `bun run lint:omp` fails if a flag or the profile variable appears anywhere else.
 */
import type { Subprocess } from "bun";
import { config } from "../config.ts";

/**
 * Tells omp which profile directory to use. If omp renames it, every isolated run
 * would fall back to the user's real `~/.omp/agent` — the highest-risk string in this
 * app, which is why it is defined once.
 */
export const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** `process.env` plus a profile directory: the gateway's own when one is configured. */
export function ompEnvFor(agentDir: string | undefined): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...process.env };
	if (agentDir) env[AGENT_DIR_ENV] = agentDir;
	return env;
}

/** `process.env` plus the profile directory, when the gateway was told one. */
export function ompEnv(): Record<string, string | undefined> {
	return ompEnvFor(config.agentDir);
}

/**
 * The binary this app would run, for a log line or an error message. Reading it is not
 * assembling a command line — only this file does that.
 */
export function ompBinaryName(): string {
	return config.ompBin;
}

/**
 * 模型識別字串的合法形狀。
 *
 * 為什麼要限制：模型名會被放進 `--model`／`--provider` 的引數裡，而 Windows 上
 * 走 `cmd.exe /c` 的啟動器（`.cmd`/`.bat`）會重新解析引號與 `& | < >`。
 *
 * 允許的字元要涵蓋**真的**模型識別字：供應商／模型（斜線），OpenRouter 之類的
 * 供應商還會在後面加 `:free`、`:batch` 這類標記（實測：`recursive/flint-v1.0:free`），
 * 所以冒號與多個斜線都要放行。擋掉的是 cmd 會重新解析的 metachar：
 * 引號、`& | < > ^ ( ) % !`、空白與控制字元。
 *
 * 為什麼寧可放寬也不要擋掉真的 id：擋掉之後 `--model` 會被**靜默地**略過，
 * 工作階段就會用預設模型開啟——使用者選了 A、實際跑的是 B，而且沒有任何錯誤。
 * 靜默地用錯模型比明確報錯更糟。
 */
const MODEL_ID_PATTERN = /^[A-Za-z0-9_.:/@+-]+$/;

/** 模型名不合法就當作沒有給——寧可讓 omp 用預設模型，也不要把字串送進命令列。 */
export function safeModelId(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	return MODEL_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

/** The long-lived `rpc-ui` process one session owns. */
export function ompRpcUiArgs(options: { resume?: string; model?: string; ephemeral?: boolean } = {}): string[] {
	const args = [config.ompBin, "--mode", "rpc-ui"];
	if (options.ephemeral) args.push("--no-session");
	if (options.resume) args.push("--resume", options.resume);
	// A locked model wins over both the session's saved model and the caller's: the
	// test profile must never reach whatever model the file happens to name.
	if (config.modelLock) args.push("--provider", config.modelLock.provider, "--model", config.modelLock.model);
	else {
		const model = safeModelId(options.model);
		if (model) args.push("--model", model);
	}
	return args;
}

/**
 * A one-shot `-p` call. Nothing is written to the profile (`--no-session`) and no
 * extension runs (`--no-extensions`); `maxTime` is omp's own kill switch, so a call
 * that hangs cannot outlive the page that asked for it.
 *
 * **prompt 不在命令列上**：omp 會讀非 TTY 的 stdin 當提示文字，所以提示走 stdin。
 * 這不是風格偏好——提示裡裝的是使用者輸入與助理回覆的前幾百字，而 Windows 上
 * 走 `cmd.exe /c` 的啟動器（`spawnArgs` 對 `.cmd`/`.bat` 會那樣做）會重新解析
 * 引號與 `& | < >`：奇數個引號會讓後面的 metachar 掉出引號外，變成一條真的命令。
 * 實測 `hello "x & echo INJECTED` 會印出 INJECTED。提示走 stdin 就沒有命令列可解析。
 */
export function ompOneShotArgs(options: { model?: { provider: string; id: string }; maxTime?: string }): string[] {
	const args = [config.ompBin, "-p", "--no-session", "--no-extensions"];
	if (options.maxTime) args.push("--max-time", options.maxTime);
	// 模型名同樣要過形狀檢查：它也會進命令列。
	const provider = safeModelId(options.model?.provider);
	const id = safeModelId(options.model?.id);
	if (provider && id) args.push("--provider", provider, "--model", id);
	return args;
}

/**
 * `omp --mode rpc`: the plain RPC transport, without the session UI.
 *
 * `--no-session` keeps a read-only query from writing a session file into the user's
 * profile; the MCP listing asks a local command and reads the answer, and nothing
 * about that needs a session on disk.
 *
 * The model lock is passed on like every other call: a profile with no default model
 * refuses to start at all, and the test profile is exactly such a profile.
 */
export function ompRpcArgs(): string[] {
	const args = [config.ompBin, "--mode", "rpc", "--no-session"];
	if (config.modelLock) args.push("--provider", config.modelLock.provider, "--model", config.modelLock.model);
	return args;
}

/**
 * Start an `omp --mode rpc` child with pipes on all three streams.
 *
 * Unlike `runOmp`, the caller owns the lifetime: it writes commands in and reads
 * frames out, then stops the child. `spawnArgs` is applied here so a `.cmd` launcher
 * keeps working on Windows.
 */
export function spawnOmpRpc(cwd?: string): Subprocess<"pipe", "pipe", "pipe"> {
	return Bun.spawn(spawnArgs(ompRpcArgs()), { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: ompEnv() });
}

/**
 * The argument pair that marks a long-lived session process. `server/orphans.ts` looks for it
 * in an OS process list: if omp renames the pair, the cleanup must follow automatically rather
 * than quietly find nothing to clean.
 */
export const RPC_UI_ARGS = "--mode rpc-ui";
/** The argument that carries the session file a process resumed. */
export const RESUME_ARG = "--resume";

export const ompVersionArgs = (): string[] => [config.ompBin, "--version"];
/** The model list, as JSON: `{ models: [{ provider, id, … }] }`. */
export const ompModelsArgs = (): string[] => [config.ompBin, "models", "--json"];
/** The whole config as JSON, keyed by dotted name. */
export const ompConfigListArgs = (): string[] => [config.ompBin, "config", "list", "--json"];
/** One config value, written as JSON text so omp validates and persists it itself. */
export const ompConfigSetArgs = (key: string, valueJson: string): string[] => [config.ompBin, "config", "set", key, valueJson];
/** Skills visible in `cwd`: `{ skills: [{ name, source, …] }`. */
export const ompSkillListArgs = (): string[] => [config.ompBin, "skill", "list", "--json"];
/** `{ npm: […], marketplace: […] }`. */
export const ompPluginListArgs = (): string[] => [config.ompBin, "plugin", "list", "--json"];
export const ompPluginToggleArgs = (id: string, enabled: boolean): string[] => [config.ompBin, "plugin", enabled ? "enable" : "disable", id];
/** `omp update --check`: 問上游有沒有新版本，不動本機。 */
export const ompUpdateCheckArgs = (): string[] => [config.ompBin, "update", "--check"];
/** `omp update`: 把本機那份換成上游最新的。 */
export const ompUpdateArgs = (): string[] => [config.ompBin, "update"];

export interface OmpRun {
	stdout: string;
	stderr: string;
	code: number;
	/** Set when the run was killed for taking too long; the exit code is then 137. */
	timedOut?: boolean;
}

/**
 * Windows 的 `.cmd`/`.bat` 不是可執行檔：直接交給 `Bun.spawn` 會得到 EINVAL，
 * 必須經過 `cmd.exe /c`。這些副檔名只有測試的 stub 與使用者的自訂啟動器會用到，
 * 但同樣的失效會讓「設定 → 模型供應商」與相容性檢查整片失敗。
 */
function spawnArgs(args: string[]): string[] {
	const bin = args[0] ?? "";
	if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) return ["cmd.exe", "/c", ...args];
	return args;
}

/**
 * Run omp to completion and hand back its output. Both streams are drained so a
 * verbose run cannot block on a full pipe; the caller decides what a non-zero exit
 * means, because for these commands it is an error message rather than a failure of the
 * session.
 *
 * `timeoutMs` exists for the commands that reach outside the machine: `omp update`
 * talks to the release server, and a wedged connection must not hold a request open
 * forever. The process is killed when the time is up and `timedOut` says so, because
 * the exit code alone cannot tell a kill from a crash.
 */
export async function runOmp(args: string[], cwd?: string, options: { timeoutMs?: number } = {}): Promise<OmpRun> {
	const proc = Bun.spawn(spawnArgs(args), { cwd, stdout: "pipe", stderr: "pipe", env: ompEnv() });
	let timedOut = false;
	const timer = options.timeoutMs ? setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, options.timeoutMs) : undefined;
	try {
		const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
		return { stdout, stderr, code: await proc.exited, timedOut };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * One run against a named profile, whatever the gateway itself is configured for. Only
 * the compatibility check needs this: it proves the profile variable is honoured by
 * pointing two throwaway directories at each other, and neither of them is the user's.
 */
export async function runOmpIn(agentDir: string, args: string[], options: { timeoutMs?: number } = {}): Promise<OmpRun> {
	const proc = Bun.spawn(spawnArgs(args), { stdout: "pipe", stderr: "pipe", env: ompEnvFor(agentDir) });
	let timedOut = false;
	const timer = options.timeoutMs ? setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, options.timeoutMs) : undefined;
	try {
		const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
		return { stdout, stderr, code: await proc.exited, timedOut };
	} finally {
		clearTimeout(timer);
	}
}
