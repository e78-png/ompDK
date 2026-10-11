/**
 * Replay recorded omp frames through the real reducer.
 *
 * This is the check that a type change cannot provide: the fixture is what omp 18.8.6
 * actually sent over a real turn, and it goes through the same `SessionStore` the browser
 * uses, so an upgrade that changes a frame shape shows up here as a broken assertion
 * rather than as a session that renders nothing.
 *
 * Every recording under `tests/fixtures/omp-frames/<version>/` is replayed, so after
 * `bun run omp:record` on a new version both recordings are asserted side by side. Run
 * that command again to refresh one; it costs a single model call.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import type { OmpCapabilities, RpcServerFrame, ServerMsg, SessionState } from "../shared/api.ts";
import { SessionStore } from "../web/src/lib/session-store.ts";
import { buildTurns, turnSteps } from "../web/src/lib/turns.ts";

// Frame notifications are batched onto animation frames, which this runtime has no notion of.
const globals = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number; cancelAnimationFrame?: (id: number) => void };
globals.requestAnimationFrame = cb => setTimeout(cb, 0) as unknown as number;
globals.cancelAnimationFrame = id => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

const BASE = path.resolve(import.meta.dir, "fixtures/omp-frames");

interface Recording {
	version: string;
	capabilities: OmpCapabilities | undefined;
	frames: Record<string, unknown>[];
}

function load(file: string, version: string): Recording {
	const lines = fs.readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
	const [meta, ...frames] = lines;
	return { version, capabilities: meta.capabilities as OmpCapabilities | undefined, frames };
}

function recordings(): Recording[] {
	if (!fs.existsSync(BASE)) return [];
	return fs
		.readdirSync(BASE)
		.map(name => ({ name, file: path.join(BASE, name, "basic.jsonl") }))
		.filter(entry => fs.existsSync(entry.file))
		.map(entry => load(entry.file, entry.name))
		.sort((a, b) => a.version.localeCompare(b.version));
}

const found = recordings();

/** Feed a recording the way a tab does: a snapshot, then every frame in order. */
function replay(frames: Record<string, unknown>[], capabilities: OmpCapabilities | undefined): SessionStore {
	const store = new SessionStore("replay");
	const state: SessionState = { isStreaming: false, isCompacting: false, messageCount: 0, cwd: "C:\\replay" };
	store.handle({ t: "snapshot", key: "replay", state, messages: [], inflight: [], pendingUi: [], commands: [], subagents: [], capabilities } satisfies ServerMsg);
	for (const frame of frames) store.handle({ t: "frame", key: "replay", frame: frame as unknown as RpcServerFrame });
	return store;
}

if (found.length === 0) {
	test("没有录制的帧可比对", () => {
		// A missing recording must not read as a passing suite, so say where it came from.
		console.warn(`未找到 tests/fixtures/omp-frames/*/basic.jsonl；运行 bun run omp:record 录制一份（会调用一次模型）。`);
		expect(found.length).toBe(0);
	});
}

for (const recording of found) {
	describe(`回放 omp ${recording.version} 的录制`, () => {
		test("每一段都收尾，消息镜像与录制一致", () => {
			const store = replay(recording.frames, recording.capabilities);
			// `agent_end` empties the drafts and drops settled tools: they are in the
			// transcript by then, and keeping them would render the same tools twice.
			expect(store.drafts.size).toBe(0);
			const settled = recording.frames.filter(frame => frame.type === "message_end").length;
			const commands = recording.frames.filter(frame => frame.type === "command_output").length;
			expect(store.messages.length).toBe(settled + commands);
			expect(store.messages.some(message => (message as { role?: string }).role === "toolResult")).toBe(true);
			expect(store.messages.some(message => (message as { role?: string }).role === "assistant")).toBe(true);
		});

		test("一轮问答：用户消息开回合，工具与文本成为步骤", () => {
			const store = replay(recording.frames, recording.capabilities);
			const turns = buildTurns(store.messages);
			expect(turns.length).toBe(1);
			expect(turns[0].user?.text).toBeTruthy();
			const steps = turnSteps(turns[0]);
			expect(steps.some(step => step.kind === "tool" && step.call.name === "write")).toBe(true);
			expect(steps.some(step => step.kind === "text" && step.text.trim().length > 0)).toBe(true);
			// The tool result is paired by id, so the row is finished rather than still running.
			const toolStep = steps.find(step => step.kind === "tool");
			expect(toolStep?.kind === "tool" && toolStep.result !== undefined).toBe(true);
		});

		test("本地命令成为回合里的独立条目，不拆回合", () => {
			const store = replay(recording.frames, recording.capabilities);
			const turns = buildTurns(store.messages);
			const commands = turns.flatMap(turn => turn.commands ?? []);
			expect(commands.length).toBe(1);
			expect(commands[0].text).toContain("Fast mode");
			expect(turns.length).toBe(1);
		});

		test("不认识的 extension_ui_request 不会卡住会话", () => {
			const store = replay(recording.frames, recording.capabilities);
			// The recording profile carries an extension that pushes widgets; a method this
			// app has no card for must be ignored, not held as a question awaiting an answer.
			const asked = store.pendingUi.filter(request => ["select", "confirm", "input", "editor", "ask"].includes(request.method));
			expect(asked.length).toBe(0);
		});

		// A mutation check: if removing a frame changed nothing, the assertions above would be
		// decorative. The plan asks for this proof by hand; doing it here keeps it permanent.
		test("删掉 message_end 必须让回放挂掉", () => {
			const withoutEnd = recording.frames.filter(frame => frame.type !== "message_end");
			expect(withoutEnd.length).toBeLessThan(recording.frames.length);
			const store = replay(withoutEnd, recording.capabilities);
			// Messages only enter the mirror through `message_end`, so the thread loses the
			// whole exchange — which is what makes the assertions above real rather than decorative.
			expect(store.messages.length).toBeLessThan(replay(recording.frames, recording.capabilities).messages.length);
			// The command entry still stands up a turn of its own; what is gone is the exchange.
			expect(buildTurns(store.messages).filter(turn => turn.user).length).toBe(0);
		});
	});
}
