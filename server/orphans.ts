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
import { RESUME_ARG, RPC_UI_ARGS, ompBinaryName } from "./omp/cli.ts";

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

/**
 * The wider table: every process that could be an omp, plus every pid that exists.
 *
 * `ProcessTable` answers "which session processes are running", and an interactive `omp`
 * — the one a user started in a terminal, which holds a session file without ever naming
 * it on the command line — is not a session process by that definition. The diagnostic
 * page has to show those too, or the user cannot tell who holds the file the gateway
 * refuses to open.
 */
export interface OmpProcessTable {
	/** Every process the platform recognised as an omp, whatever it is doing. */
	processes: ProcessEntry[];
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

/** One scan of the machine: the processes we can describe, and every pid that exists. */
interface Scan {
	/** The processes worth describing, with the parent they were started from. */
	processes: ProcessEntry[];
	/** Every pid that exists, which is what makes "the parent is gone" decidable. */
	live: Set<number>;
}

/**
 * One CIM pass (~1 s). `-f` and not `+`: `ProcessId` is a UInt32, and PowerShell converts the
 * *string* side of `+` to that type — which throws, leaves stdout empty, and would make the
 * cleanup silently find nothing.
 *
 * `S` rows carry the command line of a process whose name starts with omp; `P` rows carry
 * only the pid of everything else. The command lines of 600 unrelated processes are a lot of
 * noise, and nothing here needs them.
 */
const WINDOWS_SCAN = 'Get-CimInstance Win32_Process | ForEach-Object { if ($_.Name -like "omp*") { "S`t{0}`t{1}`t{2}" -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine } else { "P`t{0}" -f $_.ProcessId } }';

async function scanWindows(): Promise<Scan> {
	const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCAN], { stdout: "pipe", stderr: "ignore" });
	const text = await new Response(proc.stdout).text();
	const live = new Set<number>();
	const processes: ProcessEntry[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("P\t")) {
			live.add(Number(trimmed.slice(2)));
			continue;
		}
		if (!trimmed.startsWith("S\t")) continue;
		const parts = trimmed.slice(2).split("\t");
		if (parts.length < 3) continue;
		const pid = Number(parts[0]);
		live.add(pid);
		processes.push({ pid, parent: Number(parts[1]), commandLine: parts.slice(2).join("\t") });
	}
	return { processes, live };
}

/** `ps` already gives every process, so the same walk yields both halves of the table. */
async function scanPosix(): Promise<Scan> {
	const proc = Bun.spawn(["ps", "-e", "-o", "pid=,ppid=,args="], { stdout: "pipe", stderr: "ignore" });
	const text = await new Response(proc.stdout).text();
	const live = new Set<number>();
	const processes: ProcessEntry[] = [];
	for (const line of text.split("\n")) {
		const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
		if (!match) continue;
		const entry = { pid: Number(match[1]), parent: Number(match[2]), commandLine: match[3] };
		live.add(entry.pid);
		processes.push(entry);
	}
	return { processes, live };
}

function scan(): Promise<Scan> {
	return process.platform === "win32" ? scanWindows() : scanPosix();
}

/** A session process: the long-lived rpc-ui one, or one that resumed a file. */
function isSessionProcess(entry: ProcessEntry): boolean {
	return entry.commandLine.includes(RPC_UI_ARGS) || resumedFile(entry.commandLine) !== undefined;
}

async function readWindows(): Promise<ProcessTable> {
	const scan = await scanWindows();
	return { sessions: scan.processes.filter(isSessionProcess), live: scan.live };
}

async function readPosix(): Promise<ProcessTable> {
	const scan = await scanPosix();
	// The POSIX list has every process on the machine, so "is this an omp" has to be
	// answered here — and the answer has to name the binary, not just mention it.
	const sessions = scan.processes.filter(entry => entry.commandLine.includes(RPC_UI_ARGS) || (isOmpProcess(entry.commandLine) && resumedFile(entry.commandLine) !== undefined));
	return { sessions, live: scan.live };
}

export function readProcessTable(): Promise<ProcessTable> {
	return process.platform === "win32" ? readWindows() : readPosix();
}

/** The bare name of the omp binary, without a directory or an extension: `omp`. */
function ompBinaryBase(): string {
	const base = ompBinaryName().split(/[\\/]/).pop() ?? "";
	return base.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

/**
 * Does this command line start the omp binary?
 *
 * The first token is the executable, quoted when the path holds spaces. Only the bare file
 * name is compared, because the same binary is reached by many paths (PATH, an absolute
 * path, a symlink) — and `ompdk.exe`, this app's own shell, is a different program that
 * merely starts with the same letters.
 */
export function isOmpProcess(commandLine: string): boolean {
	const text = commandLine.trim();
	const quoted = /^"([^"]*)"/.exec(text);
	const first = quoted ? quoted[1] : (text.split(/\s+/, 1)[0] ?? "");
	const base = (first.split(/[\\/]/).pop() ?? "").replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
	return base === ompBinaryBase() || base === "omp";
}

/**
 * Every omp process on the machine, whatever it is doing.
 *
 * The session table is narrower on purpose: it keeps the processes that own a session file
 * we could name, which is all the cleanup needs. A diagnostic page needs the rest too — an
 * interactive `omp` holds a session file without ever naming it on the command line, and it
 * is exactly the process the user cannot identify on their own.
 */
export async function readOmpProcessTable(): Promise<OmpProcessTable> {
	const table = await scan();
	return { processes: table.processes.filter(entry => isOmpProcess(entry.commandLine)), live: table.live };
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

/**
 * Stop one process for good, with anything it spawned. On Windows that is `taskkill /T`:
 * nothing else walks the tree, and omp may have left a shell or build step of its own
 * holding the session file open.
 */
export async function terminateProcess(pid: number): Promise<void> {
	if (process.platform === "win32") {
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
		await terminateProcess(orphan.pid);
		cache = undefined;
		if (!(await waitGone(orphan.pid, 3000))) console.error(`[orphans] 程序 ${orphan.pid} 沒有退出`);
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
