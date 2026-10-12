/** OMP 18.8 session leases, independent of how a CLI was started. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { readSessionId } from "./session-file.ts";

const execute = promisify(execFile);

/** Mirrors session-storage.ts + pi-utils/dirs.ts; leases are shared across profiles. */
function ownersDirectory(): string {
	if (process.env.PI_TEST_SESSION_OWNERS_DIR) return process.env.PI_TEST_SESSION_OWNERS_DIR;
	const xdg = process.env.XDG_STATE_HOME;
	const base = xdg && process.platform !== "win32" && existsSync(path.join(xdg, "omp"))
		? path.join(xdg, "omp")
		: path.join(os.homedir(), process.env.PI_CONFIG_DIR || ".omp");
	return path.join(base, "run", "session-owners");
}

/** Mirrors pi-natives/file_lock/mod.rs. Do not lowercase or realpath this string. */
export function sessionLeaseName(id: string): string {
	const token = /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : `h-${Bun.hash.wyhash(id).toString(16).padStart(16, "0")}`;
	const lockPath = `${path.resolve(ownersDirectory(), token)}.lock`;
	const bytes = Buffer.from(lockPath, "utf8");
	const high = Bun.hash.xxHash64(bytes, 0x4f4d502d4c4f434bn).toString(16).padStart(16, "0");
	const low = Bun.hash.xxHash64(bytes, 0x50492d46494c454cn).toString(16).padStart(16, "0");
	return `omp-file-lock-${high}${low}`;
}

/** Read-only probe: Windows leases depend on object existence, not mutex thread ownership. */
export async function sessionLeaseOccupied(file: string): Promise<boolean | undefined> {
	if (process.platform !== "win32" && process.platform !== "linux") return undefined;
	const id = await readSessionId(file);
	if (!id) throw new Error("无法读取会话 ID，已阻止打开以避免生成副本");
	const name = sessionLeaseName(id);
	if (process.platform === "linux") {
		// Abstract Unix datagram sockets appear here without opening or claiming the lease.
		const sockets = await Bun.file("/proc/net/unix").text();
		return sockets.split("\n").some(line => line.trim().split(/\s+/).at(-1) === `@${name}`);
	}
	const script = `$ErrorActionPreference = 'Stop'; $lease = $null; try { if ([System.Threading.Mutex]::TryOpenExisting('Global\\${name}', [ref]$lease)) { Write-Output 'occupied' } else { Write-Output 'free' } } finally { if ($null -ne $lease) { $lease.Dispose() } }`;
	try {
		const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8000 });
		const status = stdout.trim();
		if (status === "occupied") return true;
		if (status === "free") return false;
		throw new Error("系统租约查询未返回有效结果");
	} catch (error) {
		throw new Error(`无法确认会话占用，已阻止打开以避免生成副本：${(error as Error).message}`);
	}
}
