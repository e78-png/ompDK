/**
 * 專案邊界：哪些目錄算「已知專案」。
 *
 * 為什麼要有這個測試：`POST /api/sessions` 以前不檢查 cwd，所以任何客戶端都能
 * 指定任意目錄開一個工作階段——而那個目錄立刻變成「已知項目目錄」，
 * 於是 `/api/fs/*` 就能讀它。那等於讓「未知項目目錄」那個 403 沒有作用：
 * 一個已配對的手機可以讀整台機器。
 *
 * 規則本身在 `server/project-scope.ts`（獨立成模組才能直接測它）。
 */
import { describe, expect, test } from "bun:test";
import { isKnownProject, projectKey } from "../server/project-scope.ts";

const PINNED = { path: "C:\\Work\\ompDS" };
const SESSION = { cwd: "C:\\Work\\other" };
const LIVE = "C:\\Work\\live";

describe("已知專案", () => {
	test("釘選的專案是已知的", () => {
		expect(isKnownProject("C:\\Work\\ompDS", { pinned: [PINNED], sessions: [], liveCwds: [] })).toBe(true);
	});

	test("已經有工作階段的目錄是已知的", () => {
		expect(isKnownProject("C:\\Work\\other", { pinned: [], sessions: [SESSION], liveCwds: [] })).toBe(true);
	});

	test("這個 gateway 正在開著的目錄是已知的", () => {
		expect(isKnownProject("C:\\Work\\live", { pinned: [], sessions: [], liveCwds: [LIVE] })).toBe(true);
	});

	test("其他目錄不是已知的", () => {
		// 這是重點：任意目錄不能被開成工作階段，那會讓它變得可讀。
		expect(isKnownProject("C:\\Windows", { pinned: [PINNED], sessions: [SESSION], liveCwds: [LIVE] })).toBe(false);
		expect(isKnownProject("C:\\Users\\someone", { pinned: [], sessions: [], liveCwds: [] })).toBe(false);
		expect(isKnownProject("", { pinned: [PINNED], sessions: [], liveCwds: [] })).toBe(false);
	});

	test("比對不受大小寫與結尾斜線影響", () => {
		// Windows 的大小寫不敏感，同一個目錄不能看起來像兩個。
		expect(isKnownProject("c:\\work\\ompds", { pinned: [PINNED], sessions: [], liveCwds: [] })).toBe(true);
		expect(isKnownProject("C:\\Work\\ompDS\\", { pinned: [PINNED], sessions: [], liveCwds: [] })).toBe(true);
		expect(projectKey("C:\\Work\\ompDS\\")).toBe(projectKey("C:\\Work\\ompDS"));
		// 但不同名稱不能撞在一起。
		expect(projectKey("C:\\Work\\ompDS")).not.toBe(projectKey("C:\\Work\\ompDS2"));
	});
});
