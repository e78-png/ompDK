import { describe, expect, test } from "bun:test";
import type { SessionSummary } from "../shared/api.ts";
import { groupByTime, TIME_GROUP_ORDER } from "../web/src/lib/session-groups.ts";

function session(path: string, activeAt: number, cwd = "/w/project"): SessionSummary {
	return {
		path,
		id: path,
		cwd,
		title: path,
		created: activeAt,
		modified: activeAt,
		activeAt,
	};
}

/** Local midnight of the day `ts` falls in. */
function midnight(ts: number): number {
	const d = new Date(ts);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

const NOW = new Date(2026, 2, 15, 14, 30, 0).getTime(); // 2026-03-15 14:30 local

describe("按时间分组的会话清单", () => {
	test("分组顺序固定，空清单返回空数组", () => {
		expect(TIME_GROUP_ORDER).toEqual(["today", "yesterday", "week", "older"]);
		expect(groupByTime([], NOW)).toEqual([]);
	});

	test("四个分组按本地时间归位", () => {
		const today = new Date(2026, 2, 15, 9, 0, 0).getTime();
		const yesterday = new Date(2026, 2, 14, 23, 0, 0).getTime();
		const week = new Date(2026, 2, 10, 12, 0, 0).getTime();
		const older = new Date(2026, 1, 20, 12, 0, 0).getTime();
		const groups = groupByTime([session("t", today), session("y", yesterday), session("w", week), session("o", older)], NOW);
		expect(groups.map(g => g.key)).toEqual(["today", "yesterday", "week", "older"]);
		expect(groups.map(g => g.sessions.map(s => s.path))).toEqual([["t"], ["y"], ["w"], ["o"]]);
	});

	test("空分组不出现在结果里", () => {
		const groups = groupByTime([session("t", new Date(2026, 2, 15, 9, 0, 0).getTime())], NOW);
		expect(groups.map(g => g.key)).toEqual(["today"]);
	});

	test("组内按最近活动时间由新到旧排序", () => {
		const old = new Date(2026, 2, 15, 8, 0, 0).getTime();
		const mid = new Date(2026, 2, 15, 10, 0, 0).getTime();
		const fresh = new Date(2026, 2, 15, 13, 0, 0).getTime();
		const groups = groupByTime([session("a", old), session("b", mid), session("c", fresh)], NOW);
		expect(groups[0].sessions.map(s => s.path)).toEqual(["c", "b", "a"]);
	});

	test("跨越本地午夜 00:00 的会话分到不同组", () => {
		const late = new Date(2026, 2, 14, 23, 59, 0).getTime();
		const early = new Date(2026, 2, 15, 0, 1, 0).getTime();
		// 「现在」在 2026-03-15 14:30：23:59 屬昨天，00:01 屬今天。
		const groups = groupByTime([session("late", late), session("early", early)], NOW);
		expect(groups.map(g => g.key)).toEqual(["today", "yesterday"]);
		expect(groups[0].sessions.map(s => s.path)).toEqual(["early"]);
		expect(groups[1].sessions.map(s => s.path)).toEqual(["late"]);
	});

	test("午夜刚过就换组：23:59 与 00:01 不会同组", () => {
		const late = new Date(2026, 2, 14, 23, 59, 59).getTime();
		const early = new Date(2026, 2, 15, 0, 1, 0).getTime();
		const groups = groupByTime([session("late", late), session("early", early)], NOW);
		expect(groups.map(g => g.key)).toEqual(["today", "yesterday"]);
		expect(groups[0].sessions.map(s => s.path)).toEqual(["early"]);
		expect(groups[1].sessions.map(s => s.path)).toEqual(["late"]);
	});

	test("七天前的 00:00 是近 7 天的下界", () => {
		const boundary = midnight(new Date(2026, 2, 8, 0, 0, 0).getTime());
		const justBefore = boundary - 1;
		const justAfter = boundary + 1;
		const groups = groupByTime([session("before", justBefore), session("after", justAfter)], NOW);
		expect(groups.map(g => g.key)).toEqual(["week", "older"]);
		expect(groups[0].sessions.map(s => s.path)).toEqual(["after"]);
		expect(groups[1].sessions.map(s => s.path)).toEqual(["before"]);
	});

	test("没有 activeAt 时退回 modified", () => {
		const at = new Date(2026, 2, 15, 11, 0, 0).getTime();
		const s: SessionSummary = { path: "x", id: "x", cwd: "/w/p", title: "x", created: at, modified: at, activeAt: 0 };
		expect(groupByTime([s], NOW)[0].key).toBe("today");
	});
});
