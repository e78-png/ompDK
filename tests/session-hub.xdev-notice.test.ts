/**
 * A long `xd://` mount notice — an MCP server (re)connecting names every device it
 * mounted, on one line — used to reach the browser whole: a toast covering the chat, and
 * the same wall again whenever the notice became a command's record. The hub now says a
 * long one as counts with a sample name before either path reads it, so the toast and the
 * transcript agree on the same short line.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServerMsg } from "../shared/api.ts";
import type { LiveSession, Socket } from "../server/session-hub.ts";
import { SessionStore } from "../web/src/lib/session-store.ts";
import { buildTurns } from "../web/src/lib/turns.ts";

const tempRoot = path.resolve(os.tmpdir());
const dir = fs.mkdtempSync(path.join(tempRoot, "omp-web-xdev-"));
const envNames = ["OMP_WEB_OMP_BIN", "OMP_WEB_AGENT_DIR", "STUB_CONFIG_FILE", "STUB_COMMANDS_SILENT", "STUB_FAIL_COMMANDS"];
let previousEnv: Record<string, string | undefined>;
let config: typeof import("../server/config.ts")["config"];
let previousConfig: Pick<typeof config, "ompBin" | "agentDir" | "sessionsRoot" | "autoTitle">;
let LiveSessionClass: typeof import("../server/session-hub.ts")["LiveSession"];
let SessionHubClass: typeof import("../server/session-hub.ts")["SessionHub"];
const lives: LiveSession[] = [];
const previousRaf = globalThis.requestAnimationFrame;
const previousCancel = globalThis.cancelAnimationFrame;

const SUMMARY = "xd://: 新增 118 个工具（mcp__rea_tool_0 等）";
const LONG_NOTICE = `xd://: mounted ${Array.from({ length: 118 }, (_, i) => `mcp__rea_tool_${i}`).join(", ")}`;
const SHORT_NOTICE = "xd://: mounted mcp__rea_a, mcp__rea_b";

beforeAll(async () => {
	previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
	for (const name of envNames) delete process.env[name];
	const cmdFile = path.join(dir, "omp.cmd");
	fs.writeFileSync(cmdFile, `@bun "${path.resolve(import.meta.dir, "fixtures/omp-stub.ts")}" %*\r\n`);
	fs.writeFileSync(path.join(dir, "config.json"), "{}");
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = dir;
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	process.env.STUB_COMMANDS_SILENT = "1";
	({ config } = await import("../server/config.ts"));
	previousConfig = { ompBin: config.ompBin, agentDir: config.agentDir, sessionsRoot: config.sessionsRoot, autoTitle: config.autoTitle };
	Object.assign(config, { ompBin: cmdFile, agentDir: dir, sessionsRoot: path.join(dir, "sessions"), autoTitle: false });
	({ LiveSession: LiveSessionClass, SessionHub: SessionHubClass } = await import("../server/session-hub.ts"));
	globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
	globalThis.cancelAnimationFrame = id => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
});

afterEach(async () => {
	for (const live of lives.splice(0)) await live.proc.stop();
});

afterAll(() => {
	Object.assign(config, previousConfig);
	for (const [name, value] of Object.entries(previousEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	globalThis.requestAnimationFrame = previousRaf;
	globalThis.cancelAnimationFrame = previousCancel;
	if (path.dirname(path.resolve(dir)) !== tempRoot) throw new Error("Refusing to remove a directory outside the test temp root");
	fs.rmSync(dir, { recursive: true, force: true });
});

async function open(): Promise<LiveSession> {
	process.env.STUB_FAIL_COMMANDS = "";
	const live = new LiveSessionClass(new SessionHubClass(), "xdev", dir);
	lives.push(live);
	await live.init();
	return live;
}

function attach(live: LiveSession, store = new SessionStore(live.key)): SessionStore {
	const socket = { send: (text: string) => {
		store.handle(JSON.parse(text) as ServerMsg);
		return text.length;
	} } as unknown as Socket;
	live.attach(socket);
	return store;
}

async function emit(live: LiveSession, frames: Record<string, unknown>[]): Promise<void> {
	await live.proc.request({ type: "test_emit", stubFrames: frames });
	live.send({ t: "state", key: live.key, state: live.state });
}

describe("xd:// 挂载通知到达浏览器前收成一行", () => {
	test("长名单：提示条只剩计数与示例", async () => {
		const live = await open();
		const store = attach(live);
		await emit(live, [{ type: "notice", level: "info", source: "xdev", message: LONG_NOTICE }]);
		expect(store.notices.map(n => n.text)).toEqual([SUMMARY]);
	});

	test("成为命令记录时同样是摘要", async () => {
		const live = await open();
		const store = attach(live);
		store.markCommand("/mcp reload");
		await live.command({
			type: "prompt",
			message: "/mcp reload",
			stubFrames: [
				{ type: "notice", level: "info", source: "xdev", message: LONG_NOTICE },
				{ type: "prompt_result", status: "completed", agentInvoked: false },
			],
		});
		live.send({ t: "state", key: live.key, state: live.state });
		const commands = buildTurns(store.messages).flatMap(turn => turn.commands ?? []);
		expect(commands.map(item => [item.command, item.text])).toEqual([["/mcp reload", SUMMARY]]);
	});

	test("短名单与其他通知原样通过", async () => {
		const live = await open();
		const store = attach(live);
		const other = `xd://: adb connected ${"y".repeat(200)}`;
		await emit(live, [
			{ type: "notice", level: "info", source: "xdev", message: SHORT_NOTICE },
			{ type: "notice", level: "warning", source: "collab", message: other },
		]);
		expect(store.notices.map(n => n.text)).toEqual([SHORT_NOTICE, other]);
	});
});
