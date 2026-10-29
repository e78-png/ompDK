/**
 * 路徑邊界：web root 底下以外的檔案一律不給。
 *
 * 為什麼要有這個測試：`inside()` 的前綴比對如果沒有目錄邊界，
 * `dist-evil\x` 會被 `dist` 開頭比對命中。這不是假想的問題——
 * 實測 `GET /%2e%2e%2fdist-evil%2fsecret.txt` 會把 web root 外的檔案內容
 * 原封送回瀏覽器。修好之後同一個請求會落到 SPA 的 fallback，
 * 所以這個測試守的是「那個回歸不會再回來」。
 */
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { inside, resolveStaticFile } from "../server/files.ts";

const ROOT = path.resolve("/repo");
const DIST = path.join(ROOT, "dist");

describe("web root 的邊界", () => {
	test("底下的檔案找得到", () => {
		expect(resolveStaticFile(DIST, "/index.html")).toBe(path.join(DIST, "index.html"));
		expect(resolveStaticFile(DIST, "/assets/index-abc.js")).toBe(path.join(DIST, "assets", "index-abc.js"));
	});

	test("編碼過的 .. 逃不出去", () => {
		// 這是實測能讀到檔案的請求：%2e%2e%2f 解碼後就是 ../
		expect(resolveStaticFile(DIST, "/%2e%2e%2fdist-evil%2fsecret.txt")).toBeNull();
		expect(resolveStaticFile(DIST, "/../secret.txt")).toBeNull();
		expect(resolveStaticFile(DIST, "/a/../../secret.txt")).toBeNull();
	});

	test("同前綴的兄弟目錄不算在裡面", () => {
		// 開頭比對會把 dist-evil 當成 dist 的一部分；目錄邊界不會。
		expect(inside(DIST, path.join(ROOT, "dist-evil", "secret.txt"))).toBe(false);
		expect(inside(DIST, path.join(ROOT, "dist-evil"))).toBe(false);
		expect(inside(DIST, path.join(DIST, "assets", "a.js"))).toBe(true);
		expect(inside(DIST, DIST)).toBe(true);
	});

	test("空路徑與不合法編碼都不解析成檔案", () => {
		expect(resolveStaticFile(DIST, "/")).toBeNull();
		expect(resolveStaticFile(DIST, "")).toBeNull();
		// 不合法的 percent-encoding 不該被猜成某個檔案。
		expect(resolveStaticFile(DIST, "/%zz")).toBeNull();
	});
});
