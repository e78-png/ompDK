/**
 * Session processes that outlived their gateway.
 *
 * When a gateway dies without draining (`process.kill`, a crash, Task Manager), its
 * `omp --mode rpc-ui` children stay alive and keep owning the session file each is writing.
 * The next gateway opens the same file in a *second* process, omp notices the file is owned
 * elsewhere, and saves the conversation to a sibling — which is where the duplicate sidebar
 * entry came from. So the new gateway retires those children before it can open anything.
 *
 * Startup cleanup only retires a process whose parent is gone and whose resumed file is inside
 * this gateway's profile. Runtime ownership checks the session process itself, because a live
 * terminal omp can outlive the shell that launched it and still owns the file.
 */
import * as path from "node:path";
import { RESUME_ARG, RPC_UI_ARGS } from "./omp/cli.ts";

export interface ProcessEntry {
	pid: number;
	parent: number;
	commandLine: string;
}

export interface ProcessTable {
	/** Every `omp --mode rpc-ui` process on the machine, whatever owns it. */
	sessions: ProcessEntry[];
	/** Every pid that exists, which is what makes "the parent is gone" decidable. */
	live: Set<number>;
}

/** `--resume "C:\path\with space\x.jsonl"`, or the unquoted form. */
const RESUMED = new RegExp(`${RESUME_ARG}\\s+(?:"([^"]+)"|(\\S+))`);

export function resumedFile(commandLine: string): string | undefined {
	const match = RESUMED.exec(commandLine);
	return match?.[1] ?? match?.[2];
}

function normalize(value: string, insensitive: boolean, platform: NodeJS.Platform): string {
	const slashes = value.replace(/\\/g, "/");
	const normalized = (platform === "win32" ? path.win32.normalize(slashes) : path.posix.normalize(slashes)).replace(/\\/g, "/");
	const root = (platform === "win32" ? path.win32.parse(normalized).root : path.posix.parse(normalized).root).replace(/\\/g, "/");
	const trimmed = normalized === root ? normalized : normalized.replace(/\/+$/, "");
	return insensitive ? trimmed.toLowerCase() : trimmed;
}

/** Both platforms where `Foo` and `foo` name the same session file. */
function caseInsensitive(platform: NodeJS.Platform): boolean {
	return platform === "win32" || platform === "darwin";
}

function isInside(root: string, file: string): boolean {
	if (file === root) return true;
	const prefix = root.endsWith("/") ? root : `${root}/`;
	return file.startsWith(prefix);
}

interface Scope {
	self: number;
	sessionsRoot: string;
	platform?: NodeJS.Platform;
}

/**
 * Pure: what the startup cleanup may retire. A live parent means somebody waits on this
 * process; a file outside this profile means it is not ours to free; a process without
 * `--resume` (a one-shot probe) owns no file we could be blocked by.
 */
export function pickOrphanSessions(table: ProcessTable, info: Scope): { pid: number; file: string }[] {
	const platform = info.platform ?? process.platform;
	const insensitive = caseInsensitive(platform);
	const root = normalize(info.sessionsRoot, insensitive, platform);
	const picked: { pid: number; file: string }[] = [];
	for (const proc of table.sessions) {
		if (proc.pid === info.self || table.live.has(proc.parent) || !proc.commandLine.includes(RPC_UI_ARGS)) continue;
		const file = resumedFile(proc.commandLine);
		if (!file || !isInside(root, normalize(file, insensitive, platform))) continue;
		picked.push({ pid: proc.pid, file });
	}
	return picked;
}

/** Pure: sessions of this profile that another live session process already owns. */
export function pickForeignOwners(table: ProcessTable, info: Scope): { pid: number; file: string }[] {
	const platform = info.platform ?? process.platform;
	const insensitive = caseInsensitive(platform);
	const root = normalize(info.sessionsRoot, insensitive, platform);
	const owners: { pid: number; file: string }[] = [];
	for (const proc of table.sessions) {
		// Ours is a process we already wait on: we are its parent, or we are it.
		if (proc.pid === info.self || proc.parent === info.self) continue;
		// The session row came from the current process snapshot. Its parent may have exited
		// already; that still does not make this live owner safe to duplicate.
		const file = resumedFile(proc.commandLine);
		if (!file || !isInside(root, normalize(file, insensitive, platform))) continue;
		owners.push({ pid: proc.pid, file });
	}
	return owners;
}

/** Pure: the owner of exactly this file, so opening it would only produce a copy. */
export function pickOwner(table: ProcessTable, info: Scope & { file: string }): { pid: number; file: string } | undefined {
	const platform = info.platform ?? process.platform;
	const insensitive = caseInsensitive(platform);
	const target = normalize(info.file, insensitive, platform);
	for (const owner of pickForeignOwners(table, info)) {
		if (normalize(owner.file, insensitive, platform) === target) return owner;
	}
	return undefined;
}

/** `pid <TAB> parent <TAB> command line`, tolerating tabs inside the command line itself. */
function parseRows(text: string, split: (line: string) => [string, string, string] | undefined): ProcessEntry[] {
	const rows: ProcessEntry[] = [];
	for (const line of text.split("\n")) {
		const parts = split(line.trim());
		if (!parts) continue;
		const [pid, parent, commandLine] = parts;
		if (!commandLine.includes(RPC_UI_ARGS) && !resumedFile(commandLine)) continue;
		rows.push({ pid: Number(pid), parent: Number(parent), commandLine });
	}
	return rows;
}

/**
 * One CIM pass (~1 s). `-f` and not `+`: `ProcessId` is a UInt32, and PowerShell converts the
 * *string* side of `+` to that type — which throws, leaves stdout empty, and would make the
 * cleanup silently find nothing.
 */
async function readWindows(): Promise<ProcessTable> {
	const script = 'Get-CimInstance Win32_Process | ForEach-Object { if ($_.Name -like "omp*") { "S`t{0}`t{1}`t{2}" -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine } else { "P`t{0}" -f $_.ProcessId } }';
	const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], { stdout: "pipe", stderr: "ignore" });
	const text = await new Response(proc.stdout).text();
	const live = new Set<number>();
	const sessionLines: string[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("P\t")) live.add(Number(trimmed.slice(2)));
		else if (trimmed.startsWith("S\t")) {
			live.add(Number(trimmed.split("\t")[1]));
			sessionLines.push(trimmed.slice(2));
		}
	}
	const sessions = parseRows(sessionLines.join("\n"), line => {
		const parts = line.split("\t");
		if (parts.length < 3) return undefined;
		return [parts[0], parts[1], parts.slice(2).join("\t")];
	});
	for (const session of sessions) live.add(session.pid);
	return { sessions, live };
}

/** `ps` already gives every process, so the same walk yields both halves of the table. */
async function readPosix(): Promise<ProcessTable> {
	const proc = Bun.spawn(["ps", "-e", "-o", "pid=,ppid=,args="], { stdout: "pipe", stderr: "ignore" });
	const text = await new Response(proc.stdout).text();
	const live = new Set<number>();
	const rows: ProcessEntry[] = [];
	for (const line of text.split("\n")) {
		const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
		if (!match) continue;
		const entry = { pid: Number(match[1]), parent: Number(match[2]), commandLine: match[3] };
		live.add(entry.pid);
		if (entry.commandLine.includes(RPC_UI_ARGS) || (/\bomp(?:\.exe)?\b/.test(entry.commandLine) && resumedFile(entry.commandLine))) rows.push(entry);
	}
	return { sessions: rows, live };
}

export function readProcessTable(): Promise<ProcessTable> {
	return process.platform === "win32" ? readWindows() : readPosix();
}

let cache: { at: number; table: ProcessTable } | undefined;

/**
 * The same table, reused for a few seconds. A browser that reconnects and opens three sessions
 * should cost one process table, not three, at roughly a second each.
 */
export async function recentProcessTable(ttlMs = 5000): Promise<ProcessTable> {
	if (cache && Date.now() - cache.at < ttlMs) return cache.table;
	const table = await readProcessTable();
	cache = { at: Date.now(), table };
	return table;
}

async function terminate(pid: number): Promise<void> {
	if (process.platform === "win32") {
		// /T because omp may have spawned a worker of its own; leaving that behind would keep
		// the file owned by something the process table no longer traces back to a gateway.
		await Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }).exited;
		return;
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// already gone
	}
}

async function waitGone(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!(await readProcessTable()).live.has(pid)) return true;
		await Bun.sleep(200);
	}
	return false;
}

/**
 * Retire the children a dead gateway left behind. Returns what it killed; the caller logs it,
 * because a cleanup that runs silently is indistinguishable from one that found nothing.
 */
export async function cleanOrphanSessions(sessionsRoot: string): Promise<{ pid: number; file: string }[]> {
	const orphans = pickOrphanSessions(await readProcessTable(), { self: process.pid, sessionsRoot });
	for (const orphan of orphans) {
		await terminate(orphan.pid);
		cache = undefined;
		if (!(await waitGone(orphan.pid, 3000))) console.error(`[orphans] 进程 ${orphan.pid} 没有退出`);
	}
	return orphans;
}

/** Which sessions of this profile some other live process already owns. */
export async function foreignOwners(sessionsRoot: string, self: number): Promise<{ pid: number; file: string }[]> {
	return pickForeignOwners(await recentProcessTable(), { self, sessionsRoot });
}

/** Who, if anybody but us, has `file` open in a session process right now. */
export async function findOwner(sessionsRoot: string, self: number, file: string): Promise<{ pid: number; file: string } | undefined> {
	return pickOwner(await recentProcessTable(), { self, sessionsRoot, file });
}
