/**
 * D6: omp continues a conversation in a file of its own making whenever the file it was handed
 * belongs to somebody else. The tab must follow that file, and it must say why — a session that
 * silently changes address is how the sidebar grew a second identical entry with no explanation.
 *
 * The stub is what moves: `STUB_STATE_FILE` names the file `get_state` reports once the session
 * has "moved", `STUB_STATE_FILE_AFTER` how many reads still report the resumed one. The count
 * lives inside each stub process, so a test can make the move happen at open or later.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-moved-${process.pid}-${Date.now()}`));
const cmdFile = path.join(dir, "omp.cmd");
const previous = {
	bin: process.env.OMP_WEB_OMP_BIN,
	agent: process.env.OMP_WEB_AGENT_DIR,
	cfg: process.env.STUB_CONFIG_FILE,
	silent: process.env.STUB_COMMANDS_SILENT,
	stateFile: process.env.STUB_STATE_FILE,
	after: process.env.STUB_STATE_FILE_AFTER,
};

const FILE = path.join(dir, "sessions", "a.jsonl");
const MOVED = path.join(dir, "sessions", "a-copy.jsonl");
const TOOK_OVER = "另存为新文件";

let SessionHubClass: typeof import("../server/session-hub.ts")["SessionHub"];

/** Only the takeover text matters here; a model fallback notice would use other words. */
function takeover(notices: string[]): boolean {
	return notices.some(line => line.includes(TOOK_OVER));
}

function steer(stateFile?: string, after = 0): void {
	if (stateFile) {
		process.env.STUB_STATE_FILE = stateFile;
		process.env.STUB_STATE_FILE_AFTER = String(after);
	} else {
		delete process.env.STUB_STATE_FILE;
		delete process.env.STUB_STATE_FILE_AFTER;
	}
}

beforeAll(async () => {
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	fs.writeFileSync(cmdFile, `@bun "${stub}" %*\r\n`);
	fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
	fs.writeFileSync(FILE, '{"type":"session","id":"a"}\n');
	fs.writeFileSync(MOVED, '{"type":"session","id":"a-copy"}\n');
	fs.writeFileSync(path.join(dir, "config.json"), "{}");
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = dir;
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	process.env.STUB_COMMANDS_SILENT = "1";
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = dir;
	config.sessionsRoot = path.join(dir, "sessions");
	SessionHubClass = (await import("../server/session-hub.ts")).SessionHub;
});

afterAll(() => {
	for (const [key, value] of Object.entries(previous)) {
		const name = { bin: "OMP_WEB_OMP_BIN", agent: "OMP_WEB_AGENT_DIR", cfg: "STUB_CONFIG_FILE", silent: "STUB_COMMANDS_SILENT", stateFile: "STUB_STATE_FILE", after: "STUB_STATE_FILE_AFTER" }[key]!;
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("会话文件被另存后跟随并说明", () => {
	test("打开时 omp 已经另存：键跟着走，并留下一条说明", async () => {
		const instance = new SessionHubClass();
		steer(MOVED);
		const live = await instance.open(FILE, dir);
		expect(live.key).toBe(MOVED);
		expect(instance.sessions.get(MOVED)).toBe(live);
		expect(instance.sessions.has(FILE)).toBe(false);
		expect(takeover(live.notices)).toBe(true);
		await instance.stop(live);
		steer();
	});

	test("分叉造成的另存是我们要的：跟随，但不提示被占用", async () => {
		const instance = new SessionHubClass();
		steer(MOVED, 1);
		const live = await instance.open(FILE, dir);
		expect(live.key).toBe(FILE);
		await live.command({ type: "fork" });
		expect(live.key).toBe(MOVED);
		expect(instance.sessions.get(MOVED)).toBe(live);
		expect(takeover(live.notices)).toBe(false);
		await instance.stop(live);
		steer();
	});

	test("中途被别的进程占用：下一次状态读取就跟上", async () => {
		const instance = new SessionHubClass();
		steer(MOVED, 1);
		const live = await instance.open(FILE, dir);
		expect(live.key).toBe(FILE);
		await live.refreshState();
		expect(live.key).toBe(MOVED);
		expect(instance.sessions.get(MOVED)).toBe(live);
		expect(instance.sessions.has(FILE)).toBe(false);
		expect(takeover(live.notices)).toBe(true);
		await instance.stop(live);
		steer();
	});
});
