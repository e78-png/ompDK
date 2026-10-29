/**
 * Which omp build this app has been verified against, and the boot check that keeps the
 * answer honest.
 *
 * `bun run omp:check` is what earns a new number in `TESTED_OMP`: it runs every probe
 * against the installed binary, and when the version is the only thing left to complain
 * about, that check rewrites the constant itself. Nobody edits it by hand. The
 * gateway's own check is deliberately a subset — version, process, handshake — because it
 * runs on every start and has to cost about a second rather than ten. It never calls a
 * model: the ephemeral process writes no session file.
 */
import type { OmpCapabilities, OmpCheck } from "../../shared/api.ts";
import { config } from "../config.ts";
import { OmpProcess } from "../omp-process.ts";
import { ompBinaryName, ompVersionArgs, runOmp } from "./cli.ts";
import { capabilities } from "./capabilities.ts";

/** The last version whose `bun run omp:check` came back entirely green. */
export const TESTED_OMP = "18.13.3";
/** Below this framing version the transport this app reads does not exist. */
export const MIN_PROTOCOL = 1;

/** `omp/18.8.6` → `18.8.6`; anything without a dotted number is unreadable. */
export function parseVersion(text: string): string | undefined {
	return /(\d+\.\d+\.\d+[^\s]*)/.exec(text)?.[1];
}

/** Readiness plus the handshake of one ephemeral process; the process is always stopped. */
async function probeProcess(timeoutMs: number): Promise<OmpCapabilities> {
	const proc = new OmpProcess({ cwd: config.root, ephemeral: true, onFrame: () => undefined, onExit: () => undefined });
	try {
		await Promise.race([proc.ready, Bun.sleep(timeoutMs).then(() => {
			throw new Error(`就绪超时（${timeoutMs / 1000}s）`);
		})]);
		if (!proc.capabilities) throw new Error("握手没有记录能力");
		return proc.capabilities;
	} finally {
		await proc.stop(800);
	}
}

/**
 * The light check: three facts the UI can act on. `broken` means something required
 * failed, `untested` means the build is not the one pinned above but it behaves, and
 * `tested` is the quiet case the app was written against.
 */
export async function checkOmp(timeoutMs = 15_000): Promise<OmpCheck> {
	const problems: string[] = [];
	let version: string | undefined;
	let ran = true;
	try {
		version = parseVersion((await runOmp(ompVersionArgs())).stdout);
	} catch {
		ran = false;
		problems.push(`无法执行 ${ompBinaryName()}`);
	}
	if (ran && !version) problems.push("版本输出里没有可解析的号码");

	let negotiated: OmpCapabilities | undefined;
	try {
		negotiated = await probeProcess(timeoutMs);
	} catch (error) {
		problems.push(`临时进程未能就绪：${(error as Error).message}`);
	}
	if (negotiated && negotiated.protocol < MIN_PROTOCOL) problems.push(`协议版本 ${negotiated.protocol} 低于要求的 ${MIN_PROTOCOL}`);

	const compat = problems.length ? "broken" : version === TESTED_OMP ? "tested" : "untested";
	// The probe handshakes like any session, so the published table is current by now.
	return { compat, version: version ?? null, problems, capabilities: negotiated ?? capabilities() ?? null };
}
