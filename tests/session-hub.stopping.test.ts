/**
 * D3: an idle session's process is removed from the registry before it has actually exited, and
 * that window is when a reopening browser can start a *second* owner for the same file. The stub
 * is told to linger (STUB_EXIT_DELAY_MS) so the window exists, and the call log is what proves
 * the ordering: a new process may only start after the previous one is gone.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeStubBin } from "./fixtures/stub-bin.ts";
import { removeTempDir } from "./fixtures/cleanup.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-stop-${process.pid}-${Date.now()}`));
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
const callsFile = path.join(dir, "calls.txt");
const previous = {
	bin: process.env.OMP_WEB_OMP_BIN,
	agent: process.env.OMP_WEB_AGENT_DIR,
	cfg: process.env.STUB_CONFIG_FILE,
	calls: process.env.STUB_CALLS_FILE,
	silent: process.env.STUB_COMMANDS_SILENT,
	exitDelay: process.env.STUB_EXIT_DELAY_MS,
	readyDelay: process.env.STUB_READY_DELAY_MS,
};

const EXIT_DELAY_MS = 700;
const FILE = path.join(dir, "sessions", "a.jsonl");

function log(): string[] {
	return fs
		.readFileSync(callsFile, "utf8")
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
}

let SessionHubClass: typeof import("../server/session-hub.ts")["SessionHub"];

beforeAll(async () => {
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
	fs.writeFileSync(FILE, '{"type":"session","id":"a"}\n');
	fs.writeFileSync(path.join(dir, "config.json"), "{}");
	fs.writeFileSync(callsFile, "");
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = dir;
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	process.env.STUB_CALLS_FILE = callsFile;
	process.env.STUB_COMMANDS_SILENT = "1";
	process.env.STUB_EXIT_DELAY_MS = String(EXIT_DELAY_MS);
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = dir;
	config.sessionsRoot = path.join(dir, "sessions");
	SessionHubClass = (await import("../server/session-hub.ts")).SessionHub;
});

afterAll(() => {
	for (const [key, value] of Object.entries(previous)) {
		const name = { bin: "OMP_WEB_OMP_BIN", agent: "OMP_WEB_AGENT_DIR", cfg: "STUB_CONFIG_FILE", calls: "STUB_CALLS_FILE", silent: "STUB_COMMANDS_SILENT", exitDelay: "STUB_EXIT_DELAY_MS", readyDelay: "STUB_READY_DELAY_MS" }[key]!;
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	removeTempDir(dir);
});

describe("停止与打开不交错", () => {
	test("进程还在退出时重新打开同一路径：先等它退出，再起第二个", async () => {
		const instance = new SessionHubClass();
		const live = await instance.open(FILE, dir);
		expect(log().filter(line => line === "rpc-ui").length).toBe(1);

		const stopping = instance.stop(live);
		const again = await instance.open(FILE, dir);

		// Without the wait, the second `rpc-ui` lands before the `exit` line.
		const lines = log();
		expect(lines.filter(line => line === "rpc-ui").length).toBe(2);
		expect(lines.indexOf("exit")).toBe(1);
		expect(lines.lastIndexOf("rpc-ui")).toBeGreaterThan(lines.indexOf("exit"));
		expect(again.key).toBe(FILE);
		expect(instance.sessions.size).toBe(1);
		await stopping;
		await instance.stop(again);
		expect(instance.sessions.size).toBe(0);
	});

	test("另一条路径正在退出时打开别的会话：不跟着等", async () => {
		const instance = new SessionHubClass();
		const live = await instance.open(FILE, dir);
		const stopping = instance.stop(live);
		const other = path.join(dir, "sessions", "b.jsonl");
		fs.writeFileSync(other, '{"type":"session","id":"b"}\n');
		const at = Date.now();
		const opened = await instance.open(other, dir);
		expect(Date.now() - at).toBeLessThan(EXIT_DELAY_MS);
		expect(opened.key).toBe(other);
		await stopping;
		await instance.stop(opened);
	});
	test("同一文件的路径别名共享启动过程", async () => {
		const instance = new SessionHubClass();
		const before = log().filter(line => line === "rpc-ui").length;
		const alias = FILE.replace(/\\/g, "/");
		const [first, second] = await Promise.all([instance.open(FILE, dir), instance.open(alias, dir)]);
		expect(first).toBe(second);
		expect(log().filter(line => line === "rpc-ui").length).toBe(before + 1);
		await instance.stop(first);
	});

	test("关闭时等待正在退出的子进程", async () => {
		const instance = new SessionHubClass();
		const live = await instance.open(FILE, dir);
		const before = log().filter(line => line === "exit").length;
		const stopping = instance.stop(live);
		await instance.shutdown();
		expect(log().filter(line => line === "exit").length).toBe(before + 1);
		await stopping;
	});

	test("关闭时等待启动中的子进程，并阻止它注册", async () => {
		const previousReady = process.env.STUB_READY_DELAY_MS;
		process.env.STUB_READY_DELAY_MS = "500";
		try {
			const instance = new SessionHubClass();
			const opening = instance.open(FILE, dir, undefined, true).then(
				() => ({ opened: true as const }),
				error => ({ opened: false as const, error }),
			);
			await instance.shutdown();
			const result = await opening;
			expect(result.opened).toBe(false);
			expect(instance.sessions.size).toBe(0);
		} finally {
			if (previousReady === undefined) delete process.env.STUB_READY_DELAY_MS;
			else process.env.STUB_READY_DELAY_MS = previousReady;
		}
	});
});
