/**
 * 指令教學表與 OMP 設定表：內容與驗證規則。
 *
 * 為什麼要有這兩個的測試：兩張表都是「內容」，內容會被改壞——漏了用途、
 * 寫了半截的說明、列舉的值跟上游對不上。這些錯誤不會讓任何東西報錯，
 * 只會讓介面上少一句話或多一個能選但會寫壞設定的值。
 */
import { describe, expect, test } from "bun:test";
import { COMMAND_HELP, SUB_HELP } from "../shared/command-help.ts";
import { CURATED_SETTINGS, SETTING_GROUP_LABEL, type SettingGroup, specOf, validateSetting, WRITABLE_KEYS } from "../shared/omp/settings.ts";
import { helpOfName, setCommandLocale } from "../shared/commands.ts";

describe("指令教學表", () => {
	test("每一条指令都有用途说明", () => {
		for (const [name, doc] of Object.entries(COMMAND_HELP)) {
			expect(doc.purpose.length).toBeGreaterThan(4);
			expect(doc.purpose.trim()).toBe(doc.purpose);
			expect(name).toBe(name.trim());
		}
	});

	test("子指令的说明都以指令/子指令为键", () => {
		for (const key of Object.keys(SUB_HELP)) {
			expect(key).toContain("/");
			const [command, sub] = key.split("/");
			expect(command.length).toBeGreaterThan(0);
			expect(sub.length).toBeGreaterThan(0);
		}
	});

	test("教学表里的用法与例子都指向真实的指令", () => {
		for (const [name, doc] of Object.entries(COMMAND_HELP)) {
			for (const example of doc.examples ?? []) {
				// Each example starts with the command it teaches, so a reader can copy it.
				expect(example.startsWith(`/${name}`)).toBe(true);
			}
			if (doc.usage) expect(doc.usage.startsWith(`/${name}`)).toBe(true);
		}
	});
});

describe("教學的取用", () => {
	test("中文模式拿到教学，英文模式不拿", () => {
		setCommandLocale("zh");
		expect(helpOfName("compact")?.purpose).toContain("压缩对话");
		setCommandLocale("en");
		expect(helpOfName("compact")).toBeUndefined();
		setCommandLocale("zh");
	});

	test("没有教学的指令回 undefined，而不是空白", () => {
		setCommandLocale("zh");
		expect(helpOfName("a-command-nobody-teaches")).toBeUndefined();
	});
});

describe("OMP 设置表", () => {
	test("每一条设置都有名字、说明和分组", () => {
		for (const spec of CURATED_SETTINGS) {
			expect(spec.label.length).toBeGreaterThan(0);
			expect(spec.about.length).toBeGreaterThan(4);
			expect(SETTING_GROUP_LABEL[spec.group as SettingGroup]).toBeTruthy();
		}
	});

	test("键不重复", () => {
		const keys = CURATED_SETTINGS.map(s => s.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("可以改的设置都有编辑器，列舉都有可选的值", () => {
		for (const key of WRITABLE_KEYS) {
			const spec = specOf(key);
			expect(spec).toBeDefined();
			expect(spec!.kind).toBeTruthy();
			if (spec!.kind === "enum") expect(spec!.values?.length).toBeGreaterThan(0);
		}
	});

	test("布尔只接受 true 或 false", () => {
		const spec = specOf("retry.enabled")!;
		expect(validateSetting(spec, "true")).toEqual({ ok: true, value: true });
		expect(validateSetting(spec, "false")).toEqual({ ok: true, value: false });
		expect(validateSetting(spec, "maybe").ok).toBe(false);
		expect(validateSetting(spec, "").ok).toBe(false);
	});

	test("列舉只接受清单里的值", () => {
		const spec = specOf("tools.approvalMode")!;
		expect(validateSetting(spec, "yolo")).toEqual({ ok: true, value: "yolo" });
		expect(validateSetting(spec, "always-ask").ok).toBe(true);
		expect(validateSetting(spec, "whatever").ok).toBe(false);
	});

	test("数字只接受数字", () => {
		const spec = specOf("retry.maxRetries")!;
		expect(validateSetting(spec, "10")).toEqual({ ok: true, value: 10 });
		expect(validateSetting(spec, "ten").ok).toBe(false);
		expect(validateSetting(spec, "Infinity").ok).toBe(false);
	});

	test("不能改的设置改不了", () => {
		const spec = specOf("modelRoles")!;
		expect(spec.kind).toBeUndefined();
		expect(validateSetting(spec, "{}").ok).toBe(false);
	});
});
