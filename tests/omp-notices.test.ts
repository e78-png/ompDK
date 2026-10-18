/**
 * The `xd://` mount notice as one line: an MCP server (re)connect names every device it
 * mounted, and the web shows notices as toasts — the list has to become counts with a
 * sample name, in both languages, without touching anything that is not this notice.
 */
import { describe, expect, test } from "bun:test";
import { summarizeXdevNotice } from "../server/omp/notices.ts";

function many(prefix: string, n: number): string[] {
	return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

const MOUNTED = many("mcp__rea_tool_", 118);

describe("xd:// 挂载通知摘要", () => {
	test("长名单：计数加示例", () => {
		const text = `xd://: mounted ${MOUNTED.join(", ")}`;
		expect(summarizeXdevNotice(text, "zh")).toBe("xd://: 新增 118 个工具（mcp__rea_tool_0 等）");
		expect(summarizeXdevNotice(text, "en")).toBe("xd://: 118 tools mounted (mcp__rea_tool_0 etc.)");
	});

	test("两侧同现：各自成句，短的一侧列全名", () => {
		const text = `xd://: mounted ${MOUNTED.join(", ")}; unmounted gone_a, gone_b`;
		expect(summarizeXdevNotice(text, "zh")).toBe("xd://: 新增 118 个工具（mcp__rea_tool_0 等）；移除 2 个工具（gone_a、gone_b）");
		expect(summarizeXdevNotice(text, "en")).toBe("xd://: 118 tools mounted (mcp__rea_tool_0 etc.); 2 tools unmounted (gone_a, gone_b)");
	});

	test("单个长名：没有『等』", () => {
		const name = `mcp__rea_${"x".repeat(90)}`;
		expect(summarizeXdevNotice(`xd://: unmounted ${name}`, "zh")).toBe(`xd://: 移除 1 个工具（${name}）`);
	});

	test("不长于两行的原文原样留下", () => {
		const text = "xd://: mounted mcp__a, mcp__b";
		expect(summarizeXdevNotice(text, "zh")).toBe(text);
		expect(summarizeXdevNotice(text, "en")).toBe(text);
	});

	test("界限：96 字符不动，97 字符收成一行", () => {
		const name = "n".repeat(81);
		const exact = `xd://: mounted ${name}`;
		expect(exact).toHaveLength(96);
		expect(summarizeXdevNotice(exact, "zh")).toBe(exact);
		const over = `${exact}n`;
		expect(summarizeXdevNotice(over, "zh")).toBe(`xd://: 新增 1 个工具（${name}n）`);
	});

	test("不是这条通知就一个字都不改", () => {
		const other = `xd://: adb connected ${"y".repeat(200)}`;
		expect(summarizeXdevNotice(other, "zh")).toBe(other);
		const wall = `另一条很长的通知 ${"z".repeat(200)}`;
		expect(summarizeXdevNotice(wall, "zh")).toBe(wall);
		expect(summarizeXdevNotice(wall, "en")).toBe(wall);
	});
});
