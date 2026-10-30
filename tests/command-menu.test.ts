/**
 * Row building for the `/` menu. The component itself is checked in the browser; these
 * cover the parts that are pure logic: grouping, the second level, the mode switch's
 * current value and what Enter means on each kind of row.
 */
import { describe, expect, test } from "bun:test";
import type { AvailableSlashCommand, SessionState } from "../shared/api.ts";
import { buildRows, detailOf, pickAction, selectableOf, type SelectableRow } from "../web/src/components/CommandMenu.tsx";

const cmd = (over: Partial<AvailableSlashCommand> & { name: string }): AvailableSlashCommand => ({ source: "builtin", ...over }) as AvailableSlashCommand;

const context = cmd({ name: "context", description: "Show context usage" });
const fast = cmd({
	name: "fast",
	description: "Toggle fast mode",
	input: { hint: "[on|ultra|off|status]" },
	subcommands: [
		{ name: "on", description: "Enable fast mode (priority tier)" },
		{ name: "ultra", description: "Enable Ultrafast" },
		{ name: "off", description: "Disable fast mode" },
		{ name: "status", description: "Show fast mode status" },
	],
});
const todo = cmd({ name: "todo", description: "Manage todos", input: { hint: "<subcommand>" }, subcommands: [{ name: "export", description: "Write todos as Markdown", usage: "[<path>]" }, { name: "copy", description: "Copy todos" }] });
const model = cmd({ name: "model", description: "Show current model selection" });
const tidyZh = cmd({ name: "skill:tidy-prose-zh", source: "skill", description: "清理草稿文字里的模板腔。适用于编辑或审阅文本。" });
const CATALOG = [context, fast, todo, model, tidyZh];

const kinds = (cwd: AvailableSlashCommand[], query: Parameters<typeof buildRows>[1], recent: string[] = [], state?: SessionState) => buildRows(cwd, query, recent, state).map(r => r.kind);

describe("一级菜单", () => {
	test("无查询时按分组排，标题行不占选择位", () => {
		const rows = buildRows(CATALOG, { name: "" }, []);
		expect(kinds(CATALOG, { name: "" })).toEqual(["group", "command", "group", "command", "group", "command", "group", "command"]);
		expect(rows.filter(r => r.kind === "group").map(r => (r as { text: string }).text)).toEqual(["对话与上下文", "模式开关", "会话", "技能"]);
		expect(selectableOf(rows).map(s => s.at)).toEqual([1, 3, 5, 7]);
	});

	test("最近使用单独成节，排在最前", () => {
		const rows = buildRows(CATALOG, { name: "" }, ["context"]);
		expect(rows[0]).toEqual({ key: "g:recent", kind: "group", text: "最近使用" });
		const first = selectableOf(rows)[0].row;
		expect(first.kind === "command" && first.rank.command.name).toBe("context");
	});

	test("同一命令出现在两节时键不重复", () => {
		const keys = buildRows(CATALOG, { name: "" }, ["context", "fast"]).map(r => r.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("有查询时不分组，右侧显示所属分组", () => {
		const rows = buildRows(CATALOG, { name: "tidy" }, []);
		expect(rows.map(r => r.kind)).toEqual(["command"]);
		expect(rows[0]).toMatchObject({ tail: "技能" });
	});
});

describe("二级菜单", () => {
	test("`/fast ` 换成子命令列表，标题行带上读得到的当前状态", () => {
		const rows = buildRows(CATALOG, { name: "fast", sub: "" }, [], { fastModeEnabled: false } as unknown as SessionState);
		expect(rows[0]).toMatchObject({ kind: "head" });
		expect((rows[0] as { text: string }).text).toContain("当前：关");
		expect(rows.slice(1).map(r => r.kind)).toEqual(["sub", "sub", "sub", "sub"]);
		const off = rows.find(r => r.kind === "sub" && (r as { sub: { name: string } }).sub.name === "off");
		expect(off).toMatchObject({ current: true });
	});

	test("读不到状态就不打勾，也不谎报", () => {
		const rows = buildRows(CATALOG, { name: "fast", sub: "" }, []);
		expect((rows[0] as { text: string }).text).not.toContain("当前：");
		expect(rows.filter(r => r.kind === "sub" && (r as { current?: boolean }).current)).toEqual([]);
	});

	test("空格后面的部分用于过滤子命令", () => {
		const rows = buildRows(CATALOG, { name: "fast", sub: "o" }, []);
		expect(rows.slice(1).map(r => (r as { sub: { name: string } }).sub.name)).toEqual(["on", "off"]);
	});

	test("没有子命令的命令不打开第二级", () => {
		expect(buildRows(CATALOG, { name: "context", sub: "" }, [])).toEqual([]);
	});

	test("第一级认不出的命令只剩一行警告", () => {
		expect(buildRows(CATALOG, { name: "nonexistent", sub: "" }, [])).toEqual([{ key: "warn", kind: "warn", text: "没有 /nonexistent 这个命令，发送后会作为普通消息交给模型" }]);
		expect(buildRows(CATALOG, { name: "abc" }, [])).toEqual([{ key: "warn", kind: "warn", text: "没有 /abc 这个命令，发送后会作为普通消息交给模型" }]);
	});

	test("隐藏命令完整输入时给一行引导，宿主打不开就不给", () => {
		const rows = buildRows(CATALOG, { name: "model" }, [], null, ["model-menu"]);
		expect(rows).toEqual([{ key: "guide", kind: "guide", name: "model", text: "用右下角的模型菜单切换", action: "model-menu" }]);
		expect(pickAction(rows[0] as SelectableRow)).toBe("guide");
		expect(buildRows(CATALOG, { name: "model" }, [], null, [])).toEqual([]);
		expect(buildRows(CATALOG, { name: "model" }, [], null, ["plugins-page"])).toEqual([]);
	});
});

describe("Enter 的含义", () => {
	test("无需参数的命令直接执行，其余先补全", () => {
		const [row] = selectableOf(buildRows(CATALOG, { name: "con" }, []));
		expect(pickAction(row.row)).toBe("run");
		const [sub] = selectableOf(buildRows(CATALOG, { name: "fast", sub: "" }, []));
		expect(pickAction(sub.row)).toBe("run");
		const exportRow = selectableOf(buildRows(CATALOG, { name: "todo", sub: "" }, [])).find(s => (s.row as { sub?: { name: string } }).sub?.name === "export");
		expect(exportRow && pickAction(exportRow.row)).toBe("complete");
		const fastRow = selectableOf(buildRows(CATALOG, { name: "fast" }, [])).find(s => (s.row as { rank?: { command: AvailableSlashCommand } }).rank?.command.name === "fast");
		expect(fastRow && pickAction(fastRow.row)).toBe("complete");
	});
});

describe("详情条", () => {
	test("内置命令显示教学表的用途，不显示 omp 的英文原文", () => {
		const rows = buildRows(CATALOG, { name: "con" }, []);
		// The teaching table replaces omp's one-line English description with what the
		// command is for. It is Chinese, and it does not carry the English original.
		expect(detailOf(rows, 0).main).toBe("看上下文用了多少、里面装了什么。");
		expect(detailOf(rows, 0).main).not.toContain("Show context usage");
	});

	test("教学表没有的指令退回 omp 自己的说明", () => {
		const rows = buildRows(CATALOG, { name: "tidy" }, []);
		expect(detailOf(rows, 0).main).toBe("清理草稿文字里的模板腔。适用于编辑或审阅文本。");
	});

	test("子命令显示自己的说明和参数", () => {
		const rows = buildRows(CATALOG, { name: "todo", sub: "" }, []);
		const at = selectableOf(rows).findIndex(s => (s.row as { sub?: { name?: string } }).sub?.name === "export");
		expect(detailOf(rows, at).sub).toBe("参数：[<path>]");
	});
});
