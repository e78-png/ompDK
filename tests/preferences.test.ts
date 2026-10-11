import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { applyPrefs, loadPrefs, savePrefs } from "../web/src/lib/preferences.ts";

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let values: Map<string, string>;
let attributes: Map<string, string>;
let styles: Map<string, string>;

beforeEach(() => {
	values = new Map();
	attributes = new Map();
	styles = new Map();
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
	} });
	Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: {
		setAttribute: (key: string, value: string) => { attributes.set(key, value); },
		removeAttribute: (key: string) => { attributes.delete(key); },
		style: { setProperty: (key: string, value: string) => { styles.set(key, value); } },
	} } });
});

afterEach(() => {
	if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
	else Reflect.deleteProperty(globalThis, "localStorage");
	if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
	else Reflect.deleteProperty(globalThis, "document");
});

describe("浏览器偏好边界", () => {
	test("旧版局部偏好与新增默认项合并", () => {
		values.set("omp-web:prefs", JSON.stringify({ theme: "dark", lastProject: "project", collapsedProjects: ["project"] }));
		const prefs = loadPrefs();
		expect(prefs.theme).toBe("dark");
		expect(prefs.lastProject).toBe("project");
		expect(prefs.collapsedProjects).toEqual(["project"]);
		expect(prefs.autoOpenAgents).toBe(true);
		expect(prefs.hiddenModels).toEqual([]);
	});

	test("缺失或损坏的存储恢复独立默认值", () => {
		const first = loadPrefs();
		first.collapsedProjects.push("changed");
		expect(loadPrefs().collapsedProjects).toEqual([]);
		values.set("omp-web:prefs", "invalid JSON");
		expect(loadPrefs().theme).toBe("system");
	});

	test("保存后恢复折叠项目、字体和侧栏状态", () => {
		const prefs = { ...loadPrefs(), collapsedProjects: ["project"], uiFont: "yahei" as const, inspectorOpen: true, inspectorTab: "agents" as const };
		savePrefs(prefs);
		expect(loadPrefs()).toEqual(prefs);
	});

	test("存储被禁用或已满时仍可使用内存偏好", () => {
		Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("storage disabled"); } });
		const prefs = loadPrefs();
		prefs.theme = "dark";
		expect(() => savePrefs(prefs)).not.toThrow();
		applyPrefs(prefs);
		expect(attributes.get("data-theme")).toBe("dark");
	});

	test("应用外观并在切回系统主题时清除显式主题", () => {
		const prefs = { ...loadPrefs(), theme: "light" as const, fontSize: "l" as const, colWidth: "wide" as const };
		applyPrefs(prefs);
		expect(attributes.get("data-theme")).toBe("light");
		expect(attributes.get("data-font")).toBe("l");
		expect(styles.get("--col")).toBe("960px");
		expect(styles.get("--font")).toContain("Inter");
		applyPrefs({ ...prefs, theme: "system" });
		expect(attributes.has("data-theme")).toBe(false);
	});
});
