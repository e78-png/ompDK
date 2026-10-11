/**
 * The slash-command catalog is data plus pure functions, so the acceptance cases of
 * plan-slash-commands.md S1 are asserted here instead of through a DOM. Shapes are
 * copied from a real `available_commands_update` capture.
 */
import { describe, expect, test } from "bun:test";
import type { AvailableSlashCommand } from "../shared/api.ts";
import {
	groupOf,
	guidanceOf,
	hintText,
	iconOf,
	isDestructive,
	isHidden,
	rankCommands,
	recentCommands,
	slashNameOf,
	subTitleOf,
	titleOf,
} from "../shared/commands.ts";

const cmd = (over: Partial<AvailableSlashCommand> & { name: string }): AvailableSlashCommand => ({ source: "builtin", ...over }) as AvailableSlashCommand;

const context = cmd({ name: "context", description: "Show context usage" });
const compact = cmd({
	name: "compact",
	description: "Compact the conversation",
	input: { hint: "[soft|remote|snapcompact] [focus]" },
	subcommands: [
		{ name: "soft", description: "Summarize locally with the active model", usage: "[focus]" },
		{ name: "remote", description: "Summarize via server compaction", usage: "[focus]" },
		{ name: "snapcompact", description: "Archive history onto dense bitmap images" },
	],
});
const handoff = cmd({ name: "handoff", description: "Summarize the session into a handoff document and compact in place", input: { hint: "[focus instructions]" } });
const shake = cmd({ name: "shake", aliases: ["flush"], description: "Shake heavy content out of the conversation context", input: { hint: "[elide|images|thinking]" } });
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
const session = cmd({ name: "session", description: "Show or configure the current session", subcommands: [{ name: "info" }, { name: "delete" }, { name: "pin" }] });
const memory = cmd({ name: "memory", description: "Manage memory", subcommands: [{ name: "clear" }, { name: "mm delete" }, { name: "view" }] });
const model = cmd({ name: "model", description: "Show current model selection" });
const plugins = cmd({ name: "plugins", aliases: ["plugin"], description: "Manage plugins" });
const quibble = cmd({ name: "quibble", description: "Recount the recent history" });
const humanizer = cmd({ name: "skill:humanizer", source: "skill", description: "Remove signs of AI-generated writing from text. Use when editing." });
const humanizerZh = cmd({ name: "skill:humanizer-zh", source: "skill", description: "去除文本中的 AI 生成痕迹。适用于编辑或审阅文本。" });
const green = cmd({ name: "green", source: "custom", description: "Generate a prompt to iterate on CI failures", input: { hint: "arguments" } });

const CATALOG: AvailableSlashCommand[] = [context, compact, handoff, shake, fast, session, memory, model, plugins, quibble, humanizer, humanizerZh, green];
const names = (list: { command: AvailableSlashCommand }[]) => list.map(r => r.command.name);

describe("排序与匹配", () => {
	test("/con 时 context 在 compact 之前，隐藏命令不进列表", () => {
		const ranked = rankCommands(CATALOG, "con");
		expect(names(ranked)[0]).toBe("context");
		expect(names(ranked)).toContain("compact");
		expect(ranked.findIndex(r => r.command.name === "context")).toBeLessThan(ranked.findIndex(r => r.command.name === "compact"));
		expect(names(ranked)).not.toContain("model");
	});

	test("中文标题命中：「压缩」找到 compact 和 handoff", () => {
		const ranked = rankCommands(CATALOG, "压缩");
		expect(new Set(names(ranked))).toEqual(new Set(["compact", "handoff"]));
	});

	test("技能忽略 skill: 前缀：/human 命中 skill:humanizer", () => {
		const ranked = rankCommands(CATALOG, "human");
		expect(ranked.length).toBe(2);
		expect(slashNameOf(ranked[0].command)).toBe("/skill:humanizer");
	});

	test("别名前缀命中：/flu 通过 shake 的别名 flush 找到它", () => {
		expect(names(rankCommands(CATALOG, "flu"))).toEqual(["shake"]);
	});

	test("同一档里最近使用靠前", () => {
		expect(names(rankCommands(CATALOG, "co", ["compact"])).slice(0, 1)).toEqual(["compact"]);
	});

	test("有查询时最多 50 条，右侧分组名保留在结果里", () => {
		const many = Array.from({ length: 60 }, (_, i) => cmd({ name: `tool${i}`, description: `helper ${i}` }));
		const ranked = rankCommands(many, "tool");
		expect(ranked).toHaveLength(50);
		expect(ranked.every(r => r.group === "system")).toBe(true);
	});

	test("无查询按分组顺序平铺，一条都不丢", () => {
		const ranked = rankCommands(CATALOG, "");
		expect(ranked).toHaveLength(CATALOG.length - 2);
		expect(ranked.map(r => r.group)).toEqual(["context", "context", "context", "context", "mode", "session", "system", "system", "skill", "skill", "custom"]);
		expect(names(ranked).slice(0, 4)).toEqual(["compact", "context", "handoff", "shake"]);
	});
});

describe("分组与标题", () => {
	test("不在表里的内置命令归入工具与系统，标题用英文描述", () => {
		expect(groupOf(quibble)).toBe("system");
		expect(titleOf(quibble)).toBe("Recount the recent history");
		expect(groupOf(compact)).toBe("context");
		expect(titleOf(compact)).toBe("压缩对话");
	});

	test("技能与扩展各自成组，标题取描述第一句并截断", () => {
		expect(groupOf(humanizerZh)).toBe("skill");
		expect(groupOf(green)).toBe("custom");
		expect(titleOf(humanizerZh)).toBe("去除文本中的 AI 生成痕迹");
		expect(titleOf(humanizer).length).toBeLessThanOrEqual(25);
	});

	test("图标按种类区分，模式开关用拨钮", () => {
		expect(iconOf(fast)).toBe("toggle");
		expect(iconOf(context)).toBe("terminal");
		expect(iconOf(humanizerZh)).toBe("sparkle");
		expect(iconOf(green)).toBe("file");
		expect(iconOf(cmd({ name: "autoresearch", source: "extension" }))).toBe("puzzle");
	});

	test("子命令中文描述：有则给出，没有就留给调用方显示原文", () => {
		expect(subTitleOf("fast", "on")).toBe("开启（优先级通道）");
		expect(subTitleOf("memory", "mm delete")).toBe("删除一个心智模型");
		expect(subTitleOf("fast", "nope")).toBeUndefined();
	});
});

describe("隐藏命令与引导", () => {
	test("列表里隐藏，但完整输入时给出引导动作", () => {
		expect(isHidden(model)).toBe(true);
		expect(isHidden(plugins)).toBe(true);
		expect(isHidden(compact)).toBe(false);
		expect(guidanceOf("/model")?.action).toBe("model-menu");
		expect(guidanceOf("plugin")?.action).toBe("plugins-page");
		expect(guidanceOf("rename")?.action).toBe("session-menu");
		expect(guidanceOf("context")).toBeUndefined();
	});

	test("技能即使叫同名也不隐藏", () => {
		expect(isHidden(cmd({ name: "skill:model", source: "skill" }))).toBe(false);
	});
});

describe("破坏性子命令", () => {
	test("内置的 delete/clear/reset/remove/uninstall 需要确认", () => {
		expect(isDestructive(session, "delete")).toBe(true);
		expect(isDestructive(memory, "clear")).toBe(true);
		expect(isDestructive(memory, "mm delete")).toBe(true);
	});

	test("读取类子命令不要确认", () => {
		expect(isDestructive(session, "info")).toBe(false);
		expect(isDestructive(fast, "on")).toBe(false);
		expect(isDestructive(session, undefined)).toBe(false);
	});

	test("技能和自定义命令永不确认", () => {
		expect(isDestructive(cmd({ name: "skill:drop", source: "skill" }), "delete")).toBe(false);
		expect(isDestructive(green, "clear")).toBe(false);
	});
});

describe("参数提示", () => {
	test("方括号是可选，尖括号是必填，arguments 是补充说明", () => {
		expect(hintText("[on|ultra|off|status]")).toBe("on|ultra|off|status（可选）");
		expect(hintText("<path>")).toBe("路径");
		expect(hintText("arguments")).toBe("补充说明（可选）");
	});

	test("常见的英文参数名翻成中文", () => {
		expect(hintText("[focus]")).toBe("重点（可选）");
		expect(hintText("[focus instructions]")).toBe("重点 补充说明（可选）");
		expect(hintText("[<path>]")).toBe("路径（可选）");
		expect(hintText("<plan|scan|status>")).toBe("plan|scan|status");
		expect(hintText("<subcommand>")).toBe("子命令");
		expect(hintText(undefined)).toBe("");
	});
});

describe("最近使用", () => {
	test("最多 5 条，按使用时间倒序，忽略未知与隐藏", () => {
		const recent = recentCommands(CATALOG, ["model", "compact", "context", "skill:humanizer", "nope", "handoff", "fast", "session"]);
		expect(names(recent)).toEqual(["compact", "context", "skill:humanizer", "handoff", "fast"]);
	});

	test("裸名称也能匹配到带前缀的技能", () => {
		expect(names(recentCommands(CATALOG, ["humanizer"]))).toEqual(["skill:humanizer"]);
	});
});
