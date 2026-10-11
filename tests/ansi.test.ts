/**
 * The ANSI subset omp's command output uses. Escapes are built with
 * String.fromCharCode so no level of escaping can eat them.
 */
import { describe, expect, test } from "bun:test";
import { ansiNodes, ansiRuns, ansiToText } from "../web/src/lib/ansi.tsx";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const sgr = (...codes: number[]) => ESC + "[" + codes.join(";") + "m";

describe("ansiRuns", () => {
	test("没有转义时就是一个无样式片段", () => {
		expect(ansiRuns("Fast mode is off.")).toEqual([{ text: "Fast mode is off.", style: {} }]);
	});

	test("31 是红色，39 只清颜色不动其它", () => {
		expect(ansiRuns(sgr(31) + "红" + sgr(39) + "普通")).toEqual([
			{ text: "红", style: { fg: 1 } },
			{ text: "普通", style: {} },
		]);
	});

	test("90–97 是亮色，落在 8–15", () => {
		expect(ansiRuns(sgr(90) + "灰")).toEqual([{ text: "灰", style: { fg: 8 } }]);
	});

	test("256 色的灰阶就近折算到 16 色", () => {
		expect(ansiRuns(sgr(38, 5, 243) + "░")).toEqual([{ text: "░", style: { fg: 8 } }]);
		expect(ansiRuns(sgr(38, 5, 250) + "█")).toEqual([{ text: "█", style: { fg: 7 } }]);
	});

	test("直接色也折算到最近的 16 色", () => {
		expect(ansiRuns(sgr(38, 2, 255, 0, 0) + "纯红")).toEqual([{ text: "纯红", style: { fg: 9 } }]);
	});

	test("颜色状态跨片段保留，直到 ESC[0m 复位", () => {
		expect(ansiRuns(sgr(31) + "a b" + sgr(0) + "c")).toEqual([
			{ text: "a b", style: { fg: 1 } },
			{ text: "c", style: {} },
		]);
	});

	test("背景与粗体、暗色各自独立", () => {
		expect(ansiRuns(sgr(41, 1) + "警告" + sgr(22) + "继续")).toEqual([
			{ text: "警告", style: { bg: 1, bold: true } },
			{ text: "继续", style: { bg: 1 } },
		]);
		expect(ansiRuns(sgr(2) + "次要")).toEqual([{ text: "次要", style: { dim: true } }]);
	});

	test("占用条：同一种方块字符靠颜色区分各段", () => {
		const bar = sgr(38, 5, 243) + "░░░" + sgr(39) + sgr(38, 5, 250) + "██" + sgr(39) + " 12%";
		expect(ansiRuns(bar).map(r => [r.text, r.style.fg])).toEqual([
			["░░░", 8],
			["██", 7],
			[" 12%", undefined],
		]);
	});
});

describe("ansiToText", () => {
	test("去掉 OSC 超链接只留文字", () => {
		expect(ansiToText(ESC + "]8;;https://omp.sh" + BEL + "omp" + ESC + "]8;;" + BEL)).toBe("omp");
	});

	test("结果里不会留下裸的转义字节", () => {
		const broken = "a" + ESC + "Xb" + ESC + "[";
		expect(ansiToText(broken)).not.toContain(ESC);
	});
});

describe("ansiNodes", () => {
	test("纯文本直接原样返回，不包 span", () => {
		expect(ansiNodes("Fast mode is off.")).toBe("Fast mode is off.");
	});

	test("解析不出剥落后的同一份文本时，退回纯文本", () => {
		const nodes = ansiNodes("a" + ESC + "Xb");
		expect(typeof nodes).toBe("string");
		expect(nodes).toBe(ansiToText("a" + ESC + "Xb"));
	});
});
