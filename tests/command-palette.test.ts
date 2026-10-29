/**
 * 命令面板的動作目錄。
 *
 * 面板是使用者唯一看得到的功能入口，所以這裡驗的是「面板的內容對不對」：
 * 每個動作都有代號與標籤、搜尋找得到它、快捷鍵不重複。
 */
import { describe, expect, test } from "bun:test";
import { type CommandAction, type CommandContext, bindShortcuts, comboOf, createCommands, filterCommands, shortcutConflicts } from "../web/src/lib/commands.ts";
import { SHORTCUTS } from "../web/src/lib/shortcuts.ts";

/** 假的主機：面板的每個動作都只是記錄下來，不碰任何真的東西。 */
function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
	return {
		translate: (key, params) => {
			const text = key.replace(/^[a-z]+\./, "");
			return params ? `${text} ${Object.values(params).join(" ")}` : text;
		},
		sessions: [
			{ path: "/work/alpha", title: "alpha" },
			{ path: "/work/beta", title: "beta" },
		],
		newChat: () => {},
		openPlugins: () => {},
		openSettings: () => {},
		toggleSidebar: () => {},
		toggleSidebarMode: () => {},
		toggleTheme: () => {},
		refresh: () => {},
		gotoSession: () => {},
		...overrides,
	};
}

describe("命令面板的動作目錄", () => {
	test("每个动作都有代号与标签", () => {
		const actions = createCommands(fakeContext());
		expect(actions.length).toBeGreaterThan(0);
		for (const action of actions) {
			expect(action.id.length).toBeGreaterThan(0);
			expect(action.label.length).toBeGreaterThan(0);
			expect(action.group.length).toBeGreaterThan(0);
		}
	});

	test("代号不重复", () => {
		const ids = createCommands(fakeContext()).map(a => a.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("会话清单里的每个会话都有一个跳转动作", () => {
		const actions = createCommands(fakeContext());
		const jumps = actions.filter(a => a.id.startsWith("session.open:"));
		expect(jumps.length).toBe(2);
		expect(jumps.map(j => j.id).sort()).toEqual(["session.open:/work/alpha", "session.open:/work/beta"]);
	});

	test("跳转动作真的会跳到那个会话", () => {
		const visited: string[] = [];
		const actions = createCommands(fakeContext({ gotoSession: path => visited.push(path) }));
		actions.find(a => a.id === "session.open:/work/beta")?.run();
		expect(visited).toEqual(["/work/beta"]);
	});

	test("快捷键不冲突：同一个组合只绑定一个动作", () => {
		const actions = createCommands(fakeContext());
		expect(shortcutConflicts(actions)).toEqual([]);
	});

	test("绑定的快捷键都指向确实存在的组合", () => {
		const actions = createCommands(fakeContext());
		const known = new Set(SHORTCUTS.map(s => s.combo));
		for (const action of actions) {
			const combo = comboOf(action);
			if (!combo) continue;
			expect(known.has(combo)).toBe(true);
		}
	});

	test("组合重复时只注册第一个动作", () => {
		const first: CommandAction = { id: "a", label: "A", group: "g", shortcutId: "toggle-sidebar", run: () => {} };
		const second: CommandAction = { id: "b", label: "B", group: "g", shortcutId: "toggle-sidebar", run: () => {} };
		const bound = bindShortcuts([first, second]);
		expect(bound.size).toBe(1);
		expect(bound.get("mod+b")?.id).toBe("a");
		expect(shortcutConflicts([first, second])).toEqual(["toggle-sidebar"]);
	});

	test("没有快捷键的动作不会被绑定", () => {
		const bound = bindShortcuts([{ id: "a", label: "A", group: "g", run: () => {} }]);
		expect(bound.size).toBe(0);
	});
});

describe("命令面板的搜索", () => {
	test("依标签过滤", () => {
		const actions = createCommands(fakeContext());
		const found = filterCommands(actions, "settings");
		expect(found.length).toBe(1);
		expect(found[0].id).toBe("view.settings");
	});

	test("大小写与空白不影响搜索", () => {
		const actions = createCommands(fakeContext());
		expect(filterCommands(actions, "  SETTINGS  ").length).toBe(1);
	});

	test("空白查询返回全部", () => {
		const actions = createCommands(fakeContext());
		expect(filterCommands(actions, "   ").length).toBe(actions.length);
	});

	test("找不到时返回空清单", () => {
		const actions = createCommands(fakeContext());
		expect(filterCommands(actions, "完全没有这个字串").length).toBe(0);
	});

	test("也会比对关键字，所以用英文也找得到", () => {
		const actions = createCommands(fakeContext());
		expect(filterCommands(actions, "plugin").some(a => a.id === "view.plugins")).toBe(true);
	});
});
