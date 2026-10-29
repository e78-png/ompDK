/**
 * 快捷鍵對照表的正確性。
 *
 * 這張表是「面板顯示的按法」與「實際按下去會做的事」之間唯一的橋，
 * 所以它的錯誤會直接變成使用者按了沒反應。因此這裡驗三件事：
 * 沒有重複的組合、格式一致、比對按鍵事件正確。
 */
import { describe, expect, test } from "bun:test";
import { SHORTCUTS, canonicalCombo, formatCombo, matchesCombo, parseCombo, shortcutById } from "../web/src/lib/shortcuts.ts";

/** 造一個像 KeyboardEvent 的物件；只帶比對用得到的欄位。 */
function key(name: string, modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) {
	return {
		key: name,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...modifiers,
	};
}

describe("快捷鍵對照表", () => {
	test("每一組组合都只出現一次", () => {
		const combos = SHORTCUTS.map(s => s.combo);
		expect(new Set(combos).size).toBe(combos.length);
	});

	test("代号不重复", () => {
		const ids = SHORTCUTS.map(s => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("组合的格式一致：都是正规写法", () => {
		for (const spec of SHORTCUTS) {
			// 正规形式与自身相同，说明没有多余修饰键、顺序也正确。
			expect(canonicalCombo(spec.combo)).toBe(spec.combo);
		}
	});

	test("组合都能被解析成修饰键与按键两部分", () => {
		for (const spec of SHORTCUTS) {
			const parsed = parseCombo(spec.combo);
			expect(parsed).not.toBeNull();
			expect(parsed?.key.length).toBeGreaterThan(0);
		}
	});

	test("代号可以反查回组合", () => {
		for (const spec of SHORTCUTS) {
			expect(shortcutById(spec.id)?.combo).toBe(spec.combo);
		}
		expect(shortcutById("没有这个代号")).toBeUndefined();
	});
});

describe("按鍵事件的比對", () => {
	test("Ctrl+K 命中 mod+k，Cmd+K 只在 mac 上命中", () => {
		expect(matchesCombo(key("k", { ctrlKey: true }), "mod+k")).toBe(true);
		expect(matchesCombo(key("k", { metaKey: true }), "mod+k", { mac: true })).toBe(true);
		expect(matchesCombo(key("k", { metaKey: true }), "mod+k", { mac: false })).toBe(false);
	});

	test("修饰键必须完全相同：多按一个 Shift 就不算命中", () => {
		expect(matchesCombo(key("k", { ctrlKey: true, shiftKey: true }), "mod+k")).toBe(false);
		expect(matchesCombo(key("k", { ctrlKey: true, altKey: true }), "mod+k")).toBe(false);
		expect(matchesCombo(key("k", { ctrlKey: true }), "mod+shift+k")).toBe(false);
	});

	test("按键本身必须相同", () => {
		expect(matchesCombo(key("j", { ctrlKey: true }), "mod+k")).toBe(false);
		expect(matchesCombo(key("k"), "mod+k")).toBe(false);
	});

	test("Escape 不带修饰键就能命中，带修饰键就不算", () => {
		expect(matchesCombo(key("Escape"), "escape")).toBe(true);
		expect(matchesCombo(key("Escape", { ctrlKey: true }), "escape")).toBe(false);
	});

	test("按键别名被正規化：Esc 与 escape 视为同一个键", () => {
		expect(matchesCombo(key("Esc"), "escape")).toBe(true);
		expect(canonicalCombo("esc")).toBe("escape");
	});

	test("Shift 加在字母上时按键名仍能对上", () => {
		expect(matchesCombo(key("K", { ctrlKey: true, shiftKey: true }), "mod+shift+k")).toBe(true);
	});

	test("修飾鍵的順序不影响命中", () => {
		expect(canonicalCombo("shift+mod+k")).toBe("mod+shift+k");
		expect(matchesCombo(key("k", { ctrlKey: true, shiftKey: true }), "shift+mod+k")).toBe(true);
	});

	test("无法解析的组合不命中任何事件", () => {
		expect(parseCombo("mod+")).toBeNull();
		expect(parseCombo("hyper+k")).toBeNull();
		expect(matchesCombo(key("k", { ctrlKey: true }), "hyper+k")).toBe(false);
	});
});

describe("按法的显示", () => {
	test("Windows 显示文字，macOS 显示符号", () => {
		expect(formatCombo("mod+k", false)).toBe("Ctrl+K");
		expect(formatCombo("mod+k", true)).toBe("⌘K");
		expect(formatCombo("mod+shift+s", true)).toBe("⌘⇧S");
	});

	test("功能键用自己的名字", () => {
		expect(formatCombo("escape", false)).toBe("Esc");
		expect(formatCombo("mod+enter", false)).toBe("Ctrl+Enter");
	});
});
