/**
 * The shared slash-command output message. Escapes are built with String.fromCharCode
 * so no level of escaping can eat them, and the shape is asserted through the view
 * model rather than as an object literal: what matters is that a thread renders it.
 */
import { describe, expect, test } from "bun:test";
import { commandEchoMessage, commandOutputMessage, stripAnsi } from "../shared/command-output.ts";
import { ansiToText } from "../web/src/lib/ansi.tsx";
import { buildTurns, turnSteps } from "../web/src/lib/turns.ts";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("stripAnsi", () => {
	test("去掉颜色与光条转义，保留文本本身", () => {
		const bar = `${ESC}[38;5;243m░░░${ESC}[39m 0%  2566 tokens`;
		expect(stripAnsi(`Context window: 1048576 tokens\n  System prompt    [${bar}]`)).toBe("Context window: 1048576 tokens\n  System prompt    [░░░ 0%  2566 tokens]");
	});

	test("去掉 OSC 超链接，普通文本原样返回", () => {
		expect(stripAnsi(`${ESC}]8;;https://omp.sh${BEL}omp${ESC}[0m`)).toBe("omp");
		expect(stripAnsi("Fast mode disabled.")).toBe("Fast mode disabled.");
	});
});

describe("commandOutputMessage", () => {
	test("带上命令名的消息在视图里就是一个命令项", () => {
		const turns = buildTurns([commandOutputMessage("Fast mode is off.", "/fast status", 123)]);
		expect(turns).toHaveLength(1);
		expect(turns[0].commands).toEqual([{ key: "c0", command: "/fast status", text: "Fast mode is off." }]);
		// 命令项不是步骤：它不进处理过程，也不参与回答的切分
		expect(turnSteps(turns[0])).toEqual([]);
	});

	test("认不出命令名时仍然是命令项，不会退回便签或被丢掉", () => {
		const turns = buildTurns([commandOutputMessage("Context window: 262144 tokens", undefined, 1)]);
		expect(turns[0].commands).toHaveLength(1);
		expect(turns[0].commands?.[0].command).toBeUndefined();
	});

	test("转义原样进消息列表，颜色留给线程渲染", () => {
		const message = commandOutputMessage(`${ESC}[38;5;243m已开启${ESC}[39m`, "/computer", 1) as unknown as { content: { text: string }[] };
		expect(message.content[0].text).toBe(`${ESC}[38;5;243m已开启${ESC}[39m`);
		expect(ansiToText(message.content[0].text)).toBe("已开启");
	});
});

describe("commandEchoMessage", () => {
	test("没有输出的命令同样是一个命令项，文字就是它的记录", () => {
		const turns = buildTurns([commandEchoMessage("Fast mode is unavailable for the current model.", "/fast on", 456)]);
		expect(turns[0].commands).toEqual([{ key: "c0", command: "/fast on", text: "Fast mode is unavailable for the current model." }]);
	});

	test("没有命令名也没有输出时不留空项", () => {
		const turns = buildTurns([commandEchoMessage("已执行", undefined, 1)]);
		expect(turns[0].commands?.[0]).toMatchObject({ command: undefined, text: "已执行" });
	});
});
