/**
 * Duration formatting for the transcript: a turn's total and one tool call's own time.
 */
import { describe, expect, test } from "bun:test";
import { duration, stepDuration } from "../web/src/lib/format.ts";

describe("stepDuration", () => {
	test("一秒以下给小数秒，因为多数 read/grep 就落在这里", () => {
		expect(stepDuration(300)).toBe("0.3 秒");
		expect(stepDuration(900)).toBe("0.9 秒");
		expect(stepDuration(980)).toBe("1.0 秒");
	});

	test("100ms 以下和读不出来的时长都不显示", () => {
		expect(stepDuration(40)).toBe("");
		expect(stepDuration(Number.NaN)).toBe("");
	});

	test("一秒起沿用回合汇总那套中文单位", () => {
		expect(stepDuration(1000)).toBe("1 秒");
		expect(stepDuration(65_000)).toBe(duration(65_000));
	});
});
