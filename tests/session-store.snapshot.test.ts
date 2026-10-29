import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServerMsg } from "../shared/api.ts";
import type { LiveSession, Socket } from "../server/session-hub.ts";
import { SessionStore } from "../web/src/lib/session-store.ts";
import { buildTurns } from "../web/src/lib/turns.ts";
import { writeStubBin } from "./fixtures/stub-bin.ts";

const tempRoot = path.resolve(os.tmpdir());
const dir = fs.mkdtempSync(path.join(tempRoot, "omp-web-snapshot-"));
const envNames = ["OMP_WEB_OMP_BIN", "OMP_WEB_AGENT_DIR", "STUB_CONFIG_FILE", "STUB_COMMANDS_SILENT", "STUB_FAIL_COMMANDS", "STUB_STATE_FILE", "STUB_STATE_FILE_AFTER", "STUB_EXIT_DELAY_MS", "STUB_READY_DELAY_MS", "STUB_CALLS_FILE"];
let previousEnv: Record<string, string | undefined>;
let config: typeof import("../server/config.ts")["config"];
let previousConfig: Pick<typeof config, "ompBin" | "agentDir" | "sessionsRoot" | "autoTitle">;
let LiveSessionClass: typeof import("../server/session-hub.ts")["LiveSession"];
let SessionHubClass: typeof import("../server/session-hub.ts")["SessionHub"];
const lives: LiveSession[] = [];
const previousRaf = globalThis.requestAnimationFrame;
const previousCancel = globalThis.cancelAnimationFrame;

beforeAll(async () => {
	previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
	for (const name of envNames) delete process.env[name];
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
	writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
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

async function open(deltaUpdates = true): Promise<LiveSession> {
	process.env.STUB_FAIL_COMMANDS = deltaUpdates ? "" : "set_event_filter";
	const live = new LiveSessionClass(new SessionHubClass(), "snapshot", dir);
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
	// Match the authoritative state at this checkpoint, including any debounced read.
	live.send({ t: "state", key: live.key, state: live.state });
}

/** Receive-time clocks and transient toasts are intentionally not persisted in a snapshot. */
function view(store: SessionStore): unknown {
	return {
		status: store.status,
		state: store.state,
		messages: store.messages,
		drafts: [...store.drafts].map(([id, draft]) => [id, draft.content]),
		tools: [...store.tools].map(([id, { startedAt: _start, endedAt: _end, ...tool }]) => [id, tool]),
		pendingUi: store.pendingUi,
		commands: store.commands,
		subagents: [...store.subagents].map(([id, { lastUpdate: _time, ...agent }]) => [id, agent]),
		capabilities: store.capabilities,
		isRunning: store.isRunning,
	};
}

describe("在线帧与中途快照等价", () => {
	for (const deltaUpdates of [true, false]) {
		test(`${deltaUpdates ? "增量" : "完整消息"}流：草稿、运行中工具、审批与子代理恢复后继续收尾`, async () => {
			const live = await open(deltaUpdates);
			const online = attach(live);
			await emit(live, [
				{ type: "agent_start" },
				{ type: "message_end", messageId: "u", message: { role: "user", content: [{ type: "text", text: "检查文件" }], timestamp: 1 } },
				{ type: "message_start", messageId: "a", message: { role: "assistant", content: [] } },
				deltaUpdates
					? { type: "message_update", messageId: "a", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "正在检查" } }
					: { type: "message_update", messageId: "a", message: { role: "assistant", content: [{ type: "text", text: "正在检查" }] } },
				{ type: "tool_execution_start", toolCallId: "read", toolName: "read", args: { path: "a.ts" } },
				{ type: "tool_execution_update", toolCallId: "read", partialResult: { content: [{ type: "text", text: "第一行" }] } },
				{ type: "extension_ui_request", id: "approval", method: "confirm", title: "继续检查？" },
				{ type: "available_commands_update", commands: [{ name: "context", source: "builtin" }] },
				{ type: "subagent_lifecycle", payload: { id: "agent", status: "started", agent: "scout", task: "检查" } },
			]);
			const restored = new SessionStore(live.key);
			let attention = 0;
			let dispatched = 0;
			restored.onAttention = () => attention++;
			restored.onSubagentStarted = () => dispatched++;
			attach(live, restored);
			await Promise.resolve();
			expect(view(restored)).toEqual(view(online));
			expect(restored.drafts.get("a")?.content[0].text).toBe("正在检查");
			expect(restored.tools.get("read")?.partial).toBe("第一行");
			expect(attention).toBe(0);
			expect(dispatched).toBe(0);
			live.answerUi({ id: "approval", confirmed: true });
			await emit(live, [
				{ type: "tool_execution_end", toolCallId: "read", result: { content: [{ type: "text", text: "全部内容" }] } },
				{ type: "message_end", messageId: "result", message: { role: "toolResult", toolCallId: "read", content: [{ type: "text", text: "全部内容" }], timestamp: 2 } },
				{ type: "message_end", messageId: "a", message: { role: "assistant", content: [{ type: "text", text: "检查完成" }], timestamp: 3 } },
				{ type: "agent_end" },
				{ type: "prompt_result", status: "completed", agentInvoked: true },
			]);
			expect(view(restored)).toEqual(view(online));
			expect(restored.pendingUi).toEqual([]);
			expect(restored.tools.size).toBe(0);
			expect(restored.drafts.size).toBe(0);
			const afterEnd = attach(live);
			expect(view(afterEnd)).toEqual(view(online));
			await emit(live, [{ type: "agent_start" }, { type: "message_start", messageId: "next", message: { role: "assistant", content: [] } }]);
			expect(view(afterEnd)).toEqual(view(online));
			expect(afterEnd.tools.size).toBe(0);
		});
	}

	test("工具已完成但回合未结束：重新连接保留同一份工具状态", async () => {
		const live = await open();
		const online = attach(live);
		await emit(live, [
			{ type: "tool_execution_start", toolCallId: "read", toolName: "read", args: { path: "a.ts" } },
			{ type: "tool_execution_update", toolCallId: "read", partialResult: { content: [{ type: "text", text: "部分内容" }] } },
			{ type: "tool_execution_end", toolCallId: "read", isError: true, result: { content: [{ type: "text", text: "读取失败" }] } },
		]);
		const restored = attach(live);
		expect(view(restored)).toEqual(view(online));
		expect(restored.tools.get("read")?.status).toBe("error");
		await emit(live, [{ type: "agent_end" }]);
		expect(restored.tools.size).toBe(0);
	});

	for (const [label, frames, text] of [
		["有输出", [{ type: "command_output", text: "上下文用量" }], "上下文用量"],
		["无输出", [], "已执行"],
		["只有 notice", [{ type: "notice", level: "warning", message: "当前不可用" }], "当前不可用"],
	] as const) {
		test(`命令${label}：在线与快照各保留一条记录`, async () => {
			const live = await open();
			const online = attach(live);
			online.markCommand("/context");
			await live.command({ type: "prompt", message: "/context", stubFrames: [...frames, { type: "prompt_result", status: "completed", agentInvoked: false }] });
			live.send({ t: "state", key: live.key, state: live.state });
			const restored = attach(live);
			expect(view(restored)).toEqual(view(online));
			expect(restored.messages).toHaveLength(1);
			const commands = buildTurns(restored.messages).flatMap(turn => turn.commands ?? []);
			expect(commands).toHaveLength(1);
			expect(commands[0].command).toBe("/context");
			expect(commands[0].text).toBe(text);
		});
	}
});
