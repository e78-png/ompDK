/**
 * Every omp command line, and the one environment variable omp reads.
 *
 * Flags are the interface most likely to change under us and the hardest to see
 * change: a renamed flag is a 500 in one screen, or in the worst case a test profile
 * that quietly writes the user's real one. So each line is assembled here, and
 * `bun run lint:omp` fails if a flag or the profile variable appears anywhere else.
 */
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

/** The long-lived `rpc-ui` process one session owns. */
export function ompRpcUiArgs(options: { resume?: string; model?: string; ephemeral?: boolean } = {}): string[] {
	const args = [config.ompBin, "--mode", "rpc-ui"];
	if (options.ephemeral) args.push("--no-session");
	if (options.resume) args.push("--resume", options.resume);
	// A locked model wins over both the session's saved model and the caller's: the
	// test profile must never reach whatever model the file happens to name.
	if (config.modelLock) args.push("--provider", config.modelLock.provider, "--model", config.modelLock.model);
	else if (options.model) args.push("--model", options.model);
	return args;
}

/**
 * A one-shot `-p` call. Nothing is written to the profile (`--no-session`) and no
 * extension runs (`--no-extensions`); `maxTime` is omp's own kill switch, so a call
 * that hangs cannot outlive the page that asked for it.
 */
export function ompOneShotArgs(options: { prompt: string; model?: { provider: string; id: string }; maxTime?: string }): string[] {
	const args = [config.ompBin, "-p", "--no-session", "--no-extensions"];
	if (options.maxTime) args.push("--max-time", options.maxTime);
	if (options.model) args.push("--provider", options.model.provider, "--model", options.model.id);
	return [...args, options.prompt];
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
/** Skills visible in `cwd`: `{ skills: [{ name, source, … }] }`. */
export const ompSkillListArgs = (): string[] => [config.ompBin, "skill", "list", "--json"];
/** `{ npm: […], marketplace: […] }`. */
export const ompPluginListArgs = (): string[] => [config.ompBin, "plugin", "list", "--json"];
export const ompPluginToggleArgs = (id: string, enabled: boolean): string[] => [config.ompBin, "plugin", enabled ? "enable" : "disable", id];

export interface OmpRun {
	stdout: string;
	stderr: string;
	code: number;
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
 * means, because for these commands it is an error message rather than a failure of
 * the session.
 */
export async function runOmp(args: string[], cwd?: string): Promise<OmpRun> {
	const proc = Bun.spawn(spawnArgs(args), { cwd, stdout: "pipe", stderr: "pipe", env: ompEnv() });
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	return { stdout, stderr, code: await proc.exited };
}

/**
 * One run against a named profile, whatever the gateway itself is configured for. Only
 * the compatibility check needs this: it proves the profile variable is honoured by
 * pointing two throwaway directories at each other, and neither of them is the user's.
 */
export async function runOmpIn(agentDir: string, args: string[]): Promise<OmpRun> {
	const proc = Bun.spawn(spawnArgs(args), { stdout: "pipe", stderr: "pipe", env: ompEnvFor(agentDir) });
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	return { stdout, stderr, code: await proc.exited };
}
