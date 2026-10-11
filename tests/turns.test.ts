/**
 * Pure view-model tests: turn grouping, live steps, active-time accounting.
 * No DOM and no components here.
 */
import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "../shared/api.ts";
import { buildTurns, MAX_ACTIVE_GAP_MS, mergeChanges, type Step, toolStatus, turnDuration, turnSteps } from "../web/src/lib/turns.ts";

const msg = (value: Record<string, unknown>): AgentMessage => value as unknown as AgentMessage;
const text = (value: string) => [{ type: "text", text: value }];
type ToolStep = Extract<Step, { kind: "tool" }>;

describe("buildTurns", () => {
	test("普通 user 消息开新回合，steering 与 synthetic 不开", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "第一条", timestamp: 1 }),
			msg({ role: "assistant", content: text("回复一"), timestamp: 2 }),
			msg({ role: "user", content: "插一句话", steering: true, timestamp: 3 }),
			msg({ role: "user", content: "合成消息", synthetic: true, timestamp: 4 }),
			msg({ role: "user", content: "第二条", timestamp: 5 }),
		]);
		expect(turns).toHaveLength(2);
		expect(turns[0].user?.text).toBe("第一条");
		expect(turns[1].user?.text).toBe("第二条");
		// steering / synthetic 留在第一个回合里
		expect(turns[0].messages).toHaveLength(3);
		expect(turns[1].messages).toHaveLength(0);
	});

	const skillPrompt = (name: string, stamp = 1) =>
		msg({
			role: "custom",
			customType: "skill-prompt",
			content: `[IMPORTANT: User invoked the "${name}" skill; follow its instructions. Full skill below.]\n\n# ${name}\n\n很长的技能正文……`,
			timestamp: stamp,
		});

	test("技能调用没有 user 消息，由它开回合并显示成 /skill:<名称>", () => {
		const turns = buildTurns([skillPrompt("tidy-prose-zh"), msg({ role: "assistant", content: text("收到"), timestamp: 2 })]);
		expect(turns).toHaveLength(1);
		expect(turns[0].user?.text).toBe("/skill:tidy-prose-zh");
		expect(turns[0].messages).toHaveLength(2);
		const steps = turnSteps(turns[0]);
		expect(steps.map(s => s.kind)).toEqual(["skill", "text"]);
		expect(steps[0]).toMatchObject({ kind: "skill", name: "tidy-prose-zh" });
	});

	test("真实消息在前时，技能调用留在同一回合，不再开一个", () => {
		const turns = buildTurns([msg({ role: "user", content: "改一下这段", timestamp: 1 }), skillPrompt("tidy-prose", 2)]);
		expect(turns).toHaveLength(1);
		expect(turns[0].user?.text).toBe("改一下这段");
		expect(turns[0].messages).toHaveLength(1);
	});

	test("认不出名字的技能消息仍按文本显示，不会被吞", () => {
		const turns = buildTurns([msg({ role: "custom", customType: "skill-prompt", content: "格式变了的前缀", timestamp: 1 })]);
		expect(turns[0].user).toBeUndefined();
		const steps = turnSteps(turns[0]);
		expect(steps[0]).toMatchObject({ kind: "note", text: "格式变了的前缀" });
	});

	test("steering 变成 steer 步骤，synthetic 被忽略", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "问题", timestamp: 1 }),
			msg({ role: "assistant", content: text("回复"), timestamp: 2 }),
			msg({ role: "user", content: "插一句话", steering: true, timestamp: 3 }),
			msg({ role: "user", content: "合成消息", synthetic: true, timestamp: 4 }),
		]);
		const steps = turnSteps(turns[0]);
		expect(steps.map(s => s.kind)).toEqual(["text", "steer"]);
		expect(steps[1]).toMatchObject({ kind: "steer", text: "插一句话" });
	});

	test("compactionSummary 产生带 divider 的回合", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "问题一", timestamp: 1 }),
			msg({ role: "assistant", content: text("回复"), timestamp: 2 }),
			msg({ role: "compactionSummary", content: "摘要", timestamp: 3 }),
			msg({ role: "user", content: "问题二", timestamp: 4 }),
		]);
		expect(turns).toHaveLength(3);
		expect(turns[0].divider).toBeUndefined();
		expect(turns[1].divider).toBe("上下文已压缩");
		expect(turns[1].user).toBeUndefined();
		expect(turns[1].messages).toHaveLength(0);
		expect(turns[2].user?.text).toBe("问题二");
	});
});

const commandOutput = (out: string, command?: string, stamp = 1) =>
	msg({
		role: "custom",
		customType: "command-output",
		display: true,
		content: text(out),
		...(command ? { details: { command } } : {}),
		timestamp: stamp,
	});

const commandEcho = (out: string, command?: string, stamp = 1) =>
	msg({
		role: "custom",
		customType: "command-echo",
		display: true,
		content: text(out),
		...(command ? { details: { command } } : {}),
		timestamp: stamp,
	});

/** One settled turn: a prompt and the reply that answers it. */
const round = (n: number) => [msg({ role: "user", content: `第 ${n} 轮`, timestamp: n * 10 }), msg({ role: "assistant", content: text(`回复 ${n}`), timestamp: n * 10 + 1 })];

describe("命令项", () => {
	test("第 5 轮结束后执行的命令排在第 5 轮之后、下一个问题之前", () => {
		const turns = buildTurns([
			...[1, 2, 3, 4, 5].flatMap(round),
			commandOutput("Context window: 262144 tokens", "/context", 60),
			msg({ role: "user", content: "第 6 轮", timestamp: 70 }),
		]);
		expect(turns).toHaveLength(6);
		expect(turns[4].commands).toEqual([{ key: "c10", command: "/context", text: "Context window: 262144 tokens" }]);
		// 命令不占 messages：那一轮的内容没有因为它而改变
		expect(turns[4].messages).toHaveLength(1);
		expect(turns[5].user?.text).toBe("第 6 轮");
	});

	test("某轮进行中执行的命令不拆开那一轮", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "问题", timestamp: 1 }),
			msg({ role: "assistant", content: text("开始处理"), timestamp: 2 }),
			commandOutput("Context window: 1048576 tokens", "/context", 3),
			msg({ role: "assistant", content: text("接着处理"), timestamp: 4 }),
		]);
		expect(turns).toHaveLength(1);
		expect(turns[0].messages).toHaveLength(2);
		expect(turns[0].commands?.map(c => c.command)).toEqual(["/context"]);
		expect(turnSteps(turns[0]).map(s => s.kind)).toEqual(["text", "text"]);
	});

	test("没有输出的命令由 command-echo 记一笔", () => {
		const turns = buildTurns([msg({ role: "user", content: "开快速模式", timestamp: 1 }), commandEcho("Fast mode is unavailable for the current model.", "/fast on", 2)]);
		expect(turns[0].commands).toEqual([{ key: "c1", command: "/fast on", text: "Fast mode is unavailable for the current model." }]);
	});

	test("会话开头的命令自己成一项，不影响后面的回合", () => {
		const turns = buildTurns([commandOutput("Workspace directories:\n  one (working directory)", "/dirs"), msg({ role: "user", content: "第一条", timestamp: 5 })]);
		expect(turns).toHaveLength(2);
		expect(turns[0].user).toBeUndefined();
		expect(turns[0].commands?.[0]).toMatchObject({ command: "/dirs" });
		expect(turns[1].user?.text).toBe("第一条");
	});

	test("同一轮里连续执行的命令按到达顺序排", () => {
		const turns = buildTurns([msg({ role: "user", content: "问题", timestamp: 1 }), commandOutput("Fast mode is on.", "/fast on", 2), commandOutput("Context window: 1 tokens", "/context", 3)]);
		expect(turns[0].commands?.map(c => c.command)).toEqual(["/fast on", "/context"]);
	});
});

describe("turnDuration", () => {
	test("中间夹 3 天空闲：只算两段 5 秒活动，加一段封顶的 10 分钟", () => {
		const idle = 3 * 24 * 60 * 60 * 1000;
		const turn = {
			key: "t0",
			user: { text: "开始", images: 0, timestamp: 1 },
			messages: [
				msg({ role: "assistant", content: text("a"), timestamp: 1, duration: 5000 }),
				msg({ role: "assistant", content: text("b"), timestamp: idle + 5000, duration: 5000 }),
			],
		};
		expect(turnDuration(turn)).toBe(10_000 + MAX_ACTIVE_GAP_MS);
	});

	test("没有 user 消息、或只有一个时间点时算不出来", () => {
		expect(turnDuration({ key: "t0", messages: [] })).toBeUndefined();
		expect(turnDuration({ key: "t1", user: { text: "x", images: 0, timestamp: 100 }, messages: [] })).toBeUndefined();
	});
});

describe("turnSteps", () => {
	test("toolCall 与 toolResult 按 id 配对，isError 的结果为 error 状态", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "动手", timestamp: 1 }),
			msg({ role: "assistant", content: [{ type: "toolCall", id: "call1", name: "read", arguments: { path: "/tmp/a.ts" } }], timestamp: 2 }),
			msg({ role: "toolResult", toolCallId: "call1", content: text("文件内容"), timestamp: 3 }),
			msg({ role: "assistant", content: [{ type: "toolCall", id: "call2", name: "bash", arguments: { command: "false" } }], timestamp: 4 }),
			msg({ role: "toolResult", toolCallId: "call2", content: text("失败"), isError: true, timestamp: 5 }),
		]);
		const calls = turnSteps(turns[0]).filter(s => s.kind === "tool") as ToolStep[];
		expect(calls).toHaveLength(2);
		expect(calls[0].key).toBe("call1");
		expect(calls[0].result?.content?.[0]?.text).toBe("文件内容");
		expect(calls[0].exec).toBeUndefined();
		expect(toolStatus(calls[0])).toBe("done");
		expect(toolStatus(calls[1])).toBe("error");
	});

	test("没有结果的 toolCall 仍是 running", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "动手", timestamp: 1 }),
			msg({ role: "assistant", content: [{ type: "toolCall", id: "call1", name: "read", arguments: {} }], timestamp: 2 }),
		]);
		const calls = turnSteps(turns[0]).filter(s => s.kind === "tool") as ToolStep[];
		expect(toolStatus(calls[0])).toBe("running");
	});

	test("上一轮已结束的工具执行不会漏进下一轮", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "第一轮", timestamp: 1 }),
			msg({ role: "assistant", content: [{ type: "toolCall", id: "call1", name: "glob", arguments: { pattern: "**/*.md" } }], timestamp: 2 }),
			msg({ role: "toolResult", toolCallId: "call1", content: text("a.md"), timestamp: 3 }),
			msg({ role: "user", content: "第二轮", timestamp: 4 }),
		]);
		// store 里还留着上一轮的执行（agent_end 之前、或快照回放时）
		const settled = new Map([["call1", { id: "call1", name: "glob", args: { pattern: "**/*.md" }, status: "done" as const, startedAt: 1 }]]);
		expect(turnSteps(turns[1], undefined, settled).filter(s => s.kind === "tool")).toHaveLength(0);

		// 仍在运行、调用块还没到的执行才补成实时步骤
		const running = new Map([["call9", { id: "call9", name: "glob", args: {}, status: "running" as const, startedAt: 2 }]]);
		const live = turnSteps(turns[1], undefined, running).filter(s => s.kind === "tool") as ToolStep[];
		expect(live).toHaveLength(1);
		expect(live[0].exec?.status).toBe("running");
	});
});

describe("相邻同名工具调用折叠成一组", () => {
	const read = (id: string) => ({ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } });
	const write = (id: string, path: string) => ({ type: "toolCall", id, name: "write", arguments: { path, content: "a\nb\n" } });

	test("同一条消息里相邻的同名调用并成一组，落单的仍是单行", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "看文件", timestamp: 1 }),
			msg({ role: "assistant", content: [read("r1"), read("r2"), read("r3"), { type: "toolCall", id: "t1", name: "todo", arguments: {} }], timestamp: 2 }),
		]);
		const steps = turnSteps(turns[0]);
		expect(steps.map(s => s.kind)).toEqual(["tools", "tool"]);
		if (steps[0].kind !== "tools") throw new Error("三次相邻 read 应当并成一组");
		expect(steps[0].name).toBe("read");
		expect(steps[0].items.map(i => i.key)).toEqual(["r1", "r2", "r3"]);
		// 组里每一项仍是完整的 tool 步骤，展开后逐行渲染
		expect(steps[0].items.every(i => i.kind === "tool")).toBe(true);
	});

	test("被文本隔开的两次同名调用不并成一组", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "看文件", timestamp: 1 }),
			msg({ role: "assistant", content: [read("a1"), read("a2"), { type: "text", text: "先说一声" }, read("a3"), read("a4")], timestamp: 2 }),
		]);
		expect(turnSteps(turns[0]).map(s => s.kind)).toEqual(["tools", "text", "tools"]);
	});

	test("名字还没流到的调用不并进组，也不被吞掉", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "看文件", timestamp: 1 }),
			msg({ role: "assistant", content: [{ type: "toolCall", id: "p1", partialJson: '{"path"' }, read("b1"), read("b2")], timestamp: 2 }),
		]);
		const steps = turnSteps(turns[0]);
		expect(steps.map(s => s.kind)).toEqual(["tool", "tools"]);
		expect(steps[0]).toMatchObject({ key: "p1" });
	});

	test("组内的文件改动仍然计入回合的改动汇总", () => {
		const turns = buildTurns([
			msg({ role: "user", content: "写两个文件", timestamp: 1 }),
			msg({ role: "assistant", content: [write("w1", "a.ts"), write("w2", "b.ts")], timestamp: 2 }),
			msg({ role: "toolResult", toolCallId: "w1", content: text("ok"), timestamp: 3 }),
			msg({ role: "toolResult", toolCallId: "w2", content: text("ok"), timestamp: 4 }),
		]);
		const steps = turnSteps(turns[0]);
		expect(steps.map(s => s.kind)).toEqual(["tools"]);
		expect(mergeChanges(steps).map(c => c.path).sort()).toEqual(["a.ts", "b.ts"]);
	});
});
