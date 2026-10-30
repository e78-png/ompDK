/**
 * The history window: what the gateway sends for a long session, and what happens when
 * omp refuses to answer `get_entries` because the answer does not fit the transport.
 *
 * Why this is worth a test of its own: a session file can hold 21,198 messages (57 MB).
 * Sending all of it makes the browser parse 55 MB before it shows anything, and asking
 * omp for the whole transcript in one frame makes omp refuse the request outright —
 * which used to kill the session with "RPC response exceeded the transport limit".
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeStubBin } from "./fixtures/stub-bin.ts";
import { removeTempDir } from "./fixtures/cleanup.ts";
import { HISTORY_PAGE, HISTORY_WINDOW, isTransportOverflow } from "../server/history-window.ts";
// Type only: the module itself is imported after the environment is set, because the
// config reads it at import time.
import type { SessionHub } from "../server/session-hub.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-history-${process.pid}-${Date.now()}`));
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
const FILE = path.join(dir, "sessions", "a.jsonl");
const envNames = ["OMP_WEB_OMP_BIN", "OMP_WEB_AGENT_DIR", "STUB_CONFIG_FILE", "STUB_COMMANDS_SILENT", "STUB_FAIL_COMMANDS", "STUB_OVERFLOW_COMMANDS", "STUB_MESSAGES"];
const previous = new Map(envNames.map(name => [name, process.env[name]]));

let SessionHubClass: typeof SessionHub;

/** A transcript of `count` user messages, each one distinguishable by its text. */
function transcript(count: number): string {
	return JSON.stringify(Array.from({ length: count }, (_, i) => ({ role: "user", content: [{ type: "text", text: `m${i}` }], timestamp: i })));
}

beforeAll(async () => {
	fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
	fs.writeFileSync(FILE, '{"type":"session","id":"a"}\n');
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
	for (const [name, value] of previous) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	removeTempDir(dir);
});

describe("传输上限的识别", () => {
	test("oversized 的回答算溢出，未知的命令不算", () => {
		expect(isTransportOverflow("RPC response exceeded the transport limit")).toBe(true);
		expect(isTransportOverflow("Unknown command: get_entries")).toBe(false);
		expect(isTransportOverflow(undefined)).toBe(false);
		expect(isTransportOverflow(null)).toBe(false);
	});
});

describe("长会话的历史窗口", () => {
	test("omp 放不下整份记录时改走分页，session 不会死", async () => {
		process.env.STUB_OVERFLOW_COMMANDS = "get_entries";
		process.env.STUB_MESSAGES = transcript(500);
		const instance = new SessionHubClass();
		// The old behaviour: get_entries refused the answer and the session threw, so the
		// tab showed "会话程序已退出 / RPC response exceeded the transport limit".
		const live = await instance.open(FILE, dir);
		expect(live.messages.length).toBe(500);
		await instance.stop(live);
	});

	test("snapshot 只带最近一窗，并说清楚前面还剩多少", async () => {
		process.env.STUB_OVERFLOW_COMMANDS = "get_entries";
		process.env.STUB_MESSAGES = transcript(500);
		const instance = new SessionHubClass();
		const live = await instance.open(FILE, dir);
		const snapshot = live.snapshot();
		expect(snapshot.t).toBe("snapshot");
		if (snapshot.t !== "snapshot") throw new Error("expected a snapshot");
		expect(snapshot.messages.length).toBe(HISTORY_WINDOW);
		expect(snapshot.history).toEqual({ offset: 500 - HISTORY_WINDOW, total: 500 });
		// The window is the tail, not an arbitrary slice.
		expect(snapshot.messages.at(-1)).toEqual(live.messages.at(-1));
		await instance.stop(live);
	});

	test("短会话全部送出，不留历史窗口", async () => {
		process.env.STUB_OVERFLOW_COMMANDS = "get_entries";
		process.env.STUB_MESSAGES = transcript(10);
		const instance = new SessionHubClass();
		const live = await instance.open(FILE, dir);
		const snapshot = live.snapshot();
		if (snapshot.t !== "snapshot") throw new Error("expected a snapshot");
		expect(snapshot.messages.length).toBe(10);
		expect(snapshot.history).toEqual({ offset: 0, total: 10 });
		await instance.stop(live);
	});
});

describe("往前取一页", () => {
	test("取到的是刚好在前面的一段", async () => {
		process.env.STUB_OVERFLOW_COMMANDS = "get_entries";
		process.env.STUB_MESSAGES = transcript(500);
		const instance = new SessionHubClass();
		const live = await instance.open(FILE, dir);
		const page = live.historyPage(200, HISTORY_PAGE);
		if (page.t !== "history_page") throw new Error("expected a page");
		expect(page.messages.length).toBe(200);
		expect(page.offset).toBe(0);
		expect(page.total).toBe(500);
		// The page is the 200 messages before the client's oldest one.
		expect(page.messages[0]).toEqual(live.messages[0]);
		expect(page.messages.at(-1)).toEqual(live.messages[199]);
		await instance.stop(live);
	});

	test("已经到最前面就没有更早的了", async () => {
		process.env.STUB_OVERFLOW_COMMANDS = "get_entries";
		process.env.STUB_MESSAGES = transcript(500);
		const instance = new SessionHubClass();
		const live = await instance.open(FILE, dir);
		const page = live.historyPage(0, HISTORY_PAGE);
		if (page.t !== "history_page") throw new Error("expected a page");
		expect(page.messages.length).toBe(0);
		expect(page.offset).toBe(0);
		await instance.stop(live);
	});
});
