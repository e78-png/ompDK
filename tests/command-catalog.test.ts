/**
 * The per-directory slash-command cache. Each test imports a fresh module instance
 * (`?case=`) because the cache lives in module state, deletes the persisted file first,
 * and counts probe spawns in its own file — a background probe outlives the test that
 * started it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AvailableSlashCommand } from "../shared/api.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-cmds-${process.pid}-${Date.now()}`));
const dataDir = path.join(dir, "web");
const agentDir = path.join(dir, "agent");
const cmdFile = path.join(dir, "omp.cmd");
const cacheFile = path.join(dataDir, "commands-cache.json");
const previous = { bin: process.env.OMP_WEB_OMP_BIN, agent: process.env.OMP_WEB_AGENT_DIR, cfg: process.env.STUB_CONFIG_FILE };

const PROJ_A = path.join(dir, "proj-a");
const PROJ_B = path.join(dir, "proj-b");
const CMDS_A: AvailableSlashCommand[] = [{ name: "context", source: "builtin", description: "Show context usage" }];
const CMDS_B: AvailableSlashCommand[] = [{ name: "tools", source: "builtin", description: "Show available tools" }];

type CatalogModule = typeof import("../server/command-catalog.ts");
let instance = 0;
let callsFile = path.join(dir, "calls-0.log");

async function freshCatalog(): Promise<CatalogModule> {
	instance++;
	return await import(`../server/command-catalog.ts?case=${instance}`);
}

function useCalls(name: string): void {
	callsFile = path.join(dir, `calls-${name}.log`);
	fs.rmSync(callsFile, { force: true });
	fs.rmSync(cacheFile, { force: true });
	process.env.STUB_CALLS_FILE = callsFile;
}

function calls(): number {
	try {
		return fs.readFileSync(callsFile, "utf8").split("\n").filter(Boolean).length;
	} catch {
		return 0;
	}
}

/** The count is written by a child process, so waiting for it is the assertion. */
async function waitCalls(n: number, timeoutMs = 4000): Promise<void> {
	const t0 = Date.now();
	while (calls() < n) {
		if (Date.now() - t0 > timeoutMs) throw new Error(`等了 ${timeoutMs}ms，只记录了 ${calls()} 次探测，期望 ${n} 次`);
		await new Promise(r => setTimeout(r, 25));
	}
}

function readDisk(): { agentDir: string; dirs: Record<string, { at: number; commands: unknown[] }> } {
	return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as never;
}

/** The probe stores its entry and writes it in the same tick, so the file says "landed". */
function hasDirKey(key: string): boolean {
	try {
		return key in readDisk().dirs;
	} catch {
		return false;
	}
}

const keyOf = (cwd: string) => path.resolve(cwd).replace(/[\\/]+$/, "").toLowerCase();

function serve(commands: unknown[]): void {
	process.env.STUB_COMMANDS = JSON.stringify(commands);
	delete process.env.STUB_COMMANDS_EXIT;
	delete process.env.STUB_COMMANDS_SILENT;
}

beforeAll(async () => {
	// The probe spawns with the project as cwd, so those directories have to be real.
	fs.mkdirSync(PROJ_A, { recursive: true });
	fs.mkdirSync(PROJ_B, { recursive: true });
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	fs.writeFileSync(cmdFile, `@bun "${stub}" %*\r\n`);
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = agentDir;
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	// bun shares one module registry across test files; pin config explicitly.
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = agentDir;
	config.dataDir = dataDir;
});

afterAll(async () => {
	if (previous.bin === undefined) delete process.env.OMP_WEB_OMP_BIN;
	else process.env.OMP_WEB_OMP_BIN = previous.bin;
	if (previous.agent === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previous.agent;
	if (previous.cfg === undefined) delete process.env.STUB_CONFIG_FILE;
	else process.env.STUB_CONFIG_FILE = previous.cfg;
	delete process.env.STUB_COMMANDS;
	delete process.env.STUB_COMMANDS_EXIT;
	delete process.env.STUB_COMMANDS_SILENT;
	delete process.env.STUB_CALLS_FILE;
	// A background probe may still be tearing down; Windows holds the directory until it is gone.
	for (let i = 0; i < 40; i++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			break;
		} catch {
			await new Promise(r => setTimeout(r, 50));
		}
	}
});

describe("首页命令目录缓存", () => {
	test("完全没有缓存时同步探测一次，并把结果写到磁盘", async () => {
		useCalls("cold");
		serve(CMDS_A);
		const m = await freshCatalog();
		const res = await m.getCommands(PROJ_A);
		expect(res).toEqual({ commands: CMDS_A, exact: true });
		expect(calls()).toBe(1);
		await waitCalls(1);
		for (let i = 0; i < 100 && !fs.existsSync(cacheFile); i++) await new Promise(r => setTimeout(r, 20));
		const disk = readDisk();
		expect(disk.agentDir).toBe(agentDir);
		expect(disk.dirs[keyOf(PROJ_A)].commands).toEqual(CMDS_A);
	});

	test("该目录已有缓存时立即返回，不再起探测进程", async () => {
		useCalls("hit");
		serve(CMDS_A);
		const m = await freshCatalog();
		await m.getCommands(PROJ_A);
		const again = await m.getCommands(PROJ_A);
		expect(again.exact).toBe(true);
		expect(calls()).toBe(1);
	});

	test("末尾斜杠和大小写差异算同一个目录", async () => {
		useCalls("same");
		serve(CMDS_A);
		const m = await freshCatalog();
		await m.getCommands(PROJ_A);
		const res = await m.getCommands(`${PROJ_A}\\`);
		expect(res.exact).toBe(true);
		expect(calls()).toBe(1);
	});

	test("只有别的目录的缓存时先给那份，并在后台补齐自己那份", async () => {
		useCalls("fallback");
		const m = await freshCatalog();
		serve(CMDS_A);
		await m.getCommands(PROJ_A);
		expect(calls()).toBe(1);
		serve(CMDS_B);
		const first = await m.getCommands(PROJ_B);
		expect(first).toEqual({ commands: CMDS_A, exact: false });
		for (let i = 0; i < 80 && !hasDirKey(keyOf(PROJ_B)); i++) await new Promise(r => setTimeout(r, 50));
		const second = await m.getCommands(PROJ_B);
		expect(second).toEqual({ commands: CMDS_B, exact: true });
		expect(calls()).toBe(2);
	});

	test("同一目录的并发请求只起一个探测进程", async () => {
		useCalls("dedupe");
		serve(CMDS_A);
		const m = await freshCatalog();
		const all = await Promise.all([m.getCommands(PROJ_A), m.getCommands(PROJ_A), m.getCommands(PROJ_A)]);
		expect(all.every(r => r.exact)).toBe(true);
		expect(calls()).toBe(1);
	});

	test("会话推送的命令被记住，下一个进程实例直接读盘不再探测", async () => {
		useCalls("remember");
		const m = await freshCatalog();
		m.rememberCommands(PROJ_A, CMDS_A);
		expect(calls()).toBe(0);
		for (let i = 0; i < 100 && !fs.existsSync(cacheFile); i++) await new Promise(r => setTimeout(r, 20));
		const next = await freshCatalog();
		const res = await next.getCommands(PROJ_A);
		expect(res).toEqual({ commands: CMDS_A, exact: true });
		expect(calls()).toBe(0);
	});

	test("探测失败时返回空列表，不写缓存", async () => {
		useCalls("crash");
		process.env.STUB_COMMANDS = JSON.stringify(CMDS_A);
		process.env.STUB_COMMANDS_EXIT = "1";
		const m = await freshCatalog();
		const res = await m.getCommands(PROJ_A);
		expect(res).toEqual({ commands: [], exact: false });
		expect(fs.existsSync(cacheFile)).toBe(false);
	});

	test("profile 不同的磁盘缓存不会被采用", async () => {
		useCalls("agent");
		serve(CMDS_A);
		fs.mkdirSync(dataDir, { recursive: true });
		fs.writeFileSync(cacheFile, JSON.stringify({ agentDir: "some-other-profile", dirs: { [keyOf(PROJ_A)]: { at: Date.now(), commands: CMDS_B } } }));
		const m = await freshCatalog();
		const res = await m.getCommands(PROJ_A);
		expect(res.commands).toEqual(CMDS_A);
		expect(calls()).toBe(1);
	});
});
