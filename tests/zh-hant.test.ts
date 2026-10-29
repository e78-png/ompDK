/**
 * 繁體中文（zh-Hant）：轉換表、介面文案切換，以及查不到時的 fallback。
 *
 * 轉換表是產出來的，所以這裡驗的是「對照表對不對」與「執行期用得對不對」，
 * 不是重新驗一次 OpenCC 的字典。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { langOf, msg } from "../server/messages.ts";
import { ZH_HANT } from "../shared/zh-hant.generated.ts";
import { toZhHant } from "../shared/zh-hant.ts";
import { locale, setLocale, t } from "../web/src/lib/i18n/index.ts";

const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

beforeEach(() => {
	// setLocale 會寫入 <html lang>；測試裡只需要一個可以承接的節點。
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { documentElement: { lang: "zh-CN" } },
	});
});

afterEach(() => {
	// 語言是模組層級的狀態，測完要還原，免得影響同一個測試程序裡的其他檔案。
	setLocale("zh");
	if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
	else Reflect.deleteProperty(globalThis, "document");
});

describe("繁簡對照表", () => {
	test("常用詞彙換算成台灣用語", () => {
		expect(ZH_HANT["会话"]).toBe("會話");
		expect(ZH_HANT["软件"]).toBe("軟體");
		expect(ZH_HANT["默认"]).toBe("預設");
	});

	test("介面文案整句也在表裡", () => {
		expect(ZH_HANT["界面语言"]).toBe("介面語言");
		expect(ZH_HANT["关闭（Esc）"]).toBe("關閉（Esc）");
	});
});

describe("介面語言", () => {
	test("zh-Hant 回傳繁體、en 回傳英文、zh 回傳簡體", () => {
		setLocale("zh-Hant");
		expect(t("set.language")).toBe("介面語言");
		expect(locale()).toBe("zh-Hant");
		setLocale("en");
		expect(t("set.language")).toBe("Language");
		setLocale("zh");
		expect(t("set.language")).toBe("界面语言");
	});

	test("語言名稱本身也跟著換", () => {
		setLocale("zh-Hant");
		expect(t("set.languageDesc")).toContain("瀏覽器");
		setLocale("zh");
		expect(t("set.languageDesc")).toContain("浏览器");
	});
});

describe("伺服器端語言", () => {
	test("langOf 認得三種語言", () => {
		expect(langOf("en")).toBe("en");
		expect(langOf("zh-Hant")).toBe("zh-Hant");
		expect(langOf("ZH-HANT")).toBe("zh-Hant");
		expect(langOf("zh-CN")).toBe("zh");
		expect(langOf(null)).toBe("zh");
	});

	test("msg 在繁體模式換算中文", () => {
		expect(msg("zh-Hant", ["无法读取模型列表", "Could not read the model list"])).toBe("無法讀取模型列表");
		expect(msg("zh", ["无法读取模型列表", "Could not read the model list"])).toBe("无法读取模型列表");
		expect(msg("en", ["无法读取模型列表", "Could not read the model list"])).toBe("Could not read the model list");
	});
});

describe("查不到時的退路", () => {
	test("表裡沒有的字串原樣回傳，不丟例外", () => {
		expect(toZhHant("龘龘龘")).toBe("龘龘龘");
		expect(toZhHant("Hello")).toBe("Hello");
		expect(() => toZhHant("龘龘龘")).not.toThrow();
	});

	test("沒有的訊息鍵回傳鍵本身", () => {
		setLocale("zh-Hant");
		expect(t("set.doesNotExist" as never)).toBe("set.doesNotExist");
	});
});
