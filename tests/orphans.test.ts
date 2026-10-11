/**
 * The two process-table decisions, tested as pure functions over a hand-written table: what a
 * dead gateway left behind (must be retired before the new one opens anything), and what a live
 * process elsewhere owns (must never be touched, and must be reported before we open the file).
 *
 * The table carries `live` separately on purpose. omp's own list never contains a gateway, so a
 * picker that decided "parent gone" from the omp rows alone would kill other gateways' healthy
 * session processes — one of these cases pins that down.
 */
import { describe, expect, test } from "bun:test";
import { pickForeignOwners, pickOrphanSessions, pickOwner, resumedFile, type ProcessEntry, type ProcessTable } from "../server/orphans.ts";

const ROOT = "E:\\Profiles\\agent\\sessions";
const FILE = `${ROOT}\\2026-10-10T14-10-19-447Z_01a1.jsonl`;
const OTHER = "E:\\Other\\profile\\sessions\\x.jsonl";
const session = (file?: string) => `omp --mode rpc-ui${file ? ` --resume ${file}` : " --no-session"}`;
const quoted = (file: string) => `omp --mode rpc-ui --resume "${file}"`;
const entry = (pid: number, parent: number, commandLine: string): ProcessEntry => ({ pid, parent, commandLine });
const table = (sessions: ProcessEntry[], live: number[]): ProcessTable => ({ sessions, live: new Set(live) });
const SELF = 100;

describe("pickOrphanSessions", () => {
	test("父进程已经不在，且 --resume 的文件属于本 profile：选中", () => {
		const picked = pickOrphanSessions(table([entry(7, 999, session(FILE))], []), { self: SELF, sessionsRoot: ROOT, platform: "win32" });
		expect(picked).toEqual([{ pid: 7, file: FILE }]);
	});

	// The gateway is not an omp process, so it never appears in `sessions`; liveness comes
	// from the full pid table. Reading only the omp rows would make every healthy child orphan.
	test("父进程是一个还活着的网关（网关不在 omp 列表里）：不选", () => {
		const other = entry(7, 500, session(FILE));
		expect(pickOrphanSessions(table([other], [500]), { self: SELF, sessionsRoot: ROOT, platform: "win32" })).toEqual([]);
	});

	test("--resume 指向别的 profile：不选", () => {
		expect(pickOrphanSessions(table([entry(7, 999, session(OTHER))], []), { self: SELF, sessionsRoot: ROOT, platform: "win32" })).toEqual([]);
	});

	test("没有 --resume 的会话进程（一次性探针）：不选，因为没有文件要守", () => {
		expect(pickOrphanSessions(table([entry(7, 999, session())], []), { self: SELF, sessionsRoot: ROOT, platform: "win32" })).toEqual([]);
	});

	test("不是会话进程的 omp 命令行：根本不进表", () => {
		expect(pickOrphanSessions(table([entry(7, 999, "omp -p --no-session --no-extensions 打招呼")], []), { self: SELF, sessionsRoot: ROOT, platform: "win32" })).toEqual([]);
	});

	test("Windows 上路径大小写和斜杠不同也算同一个 profile", () => {
		const lower = entry(7, 999, session("e:/profiles/agent/sessions/a.jsonl"));
		expect(pickOrphanSessions(table([lower], []), { self: SELF, sessionsRoot: ROOT, platform: "win32" })).toEqual([{ pid: 7, file: "e:/profiles/agent/sessions/a.jsonl" }]);
		// The same comparison is case-sensitive on Linux.
		expect(pickOrphanSessions(table([lower], []), { self: SELF, sessionsRoot: ROOT, platform: "linux" })).toEqual([]);
	});
	test("路径中的 .. 越出 profile 时不选中", () => {
		const outside = `${ROOT}\\..\\outside.jsonl`;
		expect(pickOrphanSessions(table([entry(7, 999, session(outside))], []), { self: SELF, sessionsRoot: ROOT, platform: "win32" })).toEqual([]);
	});
});

describe("pickForeignOwners", () => {
	const gateway = 500;
	const procs = table(
		[entry(11, SELF, session(FILE)), entry(12, gateway, session(FILE)), entry(13, 999, session(FILE))],
		[gateway],
	);

	test("不因父进程退出而漏报外部占用进程", () => {
		expect(pickForeignOwners(procs, { self: SELF, sessionsRoot: ROOT, platform: "win32" })).toEqual([
			{ pid: 12, file: FILE },
			{ pid: 13, file: FILE },
		]);
		expect(pickOwner(procs, { self: SELF, sessionsRoot: ROOT, file: FILE, platform: "win32" })?.pid).toBe(12);
	});

	test("同一个目录里的另一个会话不算占用", () => {
		const neighbour = table([entry(12, gateway, session(`${ROOT}\\other.jsonl`))], [gateway]);
		expect(pickOwner(neighbour, { self: SELF, sessionsRoot: ROOT, file: FILE, platform: "win32" })).toBeUndefined();
		expect(pickOwner(neighbour, { self: SELF, sessionsRoot: ROOT, file: `${ROOT}\\other.jsonl`, platform: "win32" })?.pid).toBe(12);
	});

	// The path the browser holds and the one in the command line are rarely spelled the same
	// way, and a comparison that misses that is a comparison that lets a duplicate through.
	test("要打开的路径写法不同（正斜杠、大小写）仍是同一个会话", () => {
		const held = table([entry(12, gateway, session(FILE))], [gateway]);
		const spelled = FILE.replace(/\\/g, "/").toLowerCase();
		expect(pickOwner(held, { self: SELF, sessionsRoot: ROOT, file: spelled, platform: "win32" })?.pid).toBe(12);
		expect(pickOwner(held, { self: SELF, sessionsRoot: ROOT, file: spelled, platform: "linux" })).toBeUndefined();
	});
});

describe("resumedFile", () => {
	test("带空格的路径以引号形式解析", () => {
		expect(resumedFile(quoted("E:\\My Projects\\a\\sessions\\x y.jsonl"))).toBe("E:\\My Projects\\a\\sessions\\x y.jsonl");
	});

	test("不带引号时取到下一个参数为止", () => {
		expect(resumedFile("omp --mode rpc-ui --resume /srv/agent/sessions/x.jsonl --provider example")).toBe("/srv/agent/sessions/x.jsonl");
	});
});
