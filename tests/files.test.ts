/**
 * 右側面板的檔案瀏覽與 git 讀取。
 *
 * 為什麼這裡值得有測試：`server/files.ts` 是「使用者給的路徑」與「磁碟上的真實檔案」
 * 之間唯一的一道防線。`inside()` 一旦被改壞（少了一個目錄邊界、或大小寫處理變了），
 * 症狀不是報錯，而是把專案外的檔案內容送到瀏覽器上——沒有編譯錯誤、沒有失敗的測試，
 * 只有一個看起來正常的畫面。所以這裡的每一個案例都對應一個「真的會壞掉」的行為。
 *
 * 所有檔案都放在暫存目錄裡：不碰專案內的任何路徑，也不碰使用者家目錄。
 * git 的案例用真的 git（`git init` 一個暫存倉庫），因為 `gitStatus`／`gitDiff`
 * 的行為取決於 porcelain 輸出格式，用假的 stub 只會測到 stub 自己。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { contentTypeFor, gitDiff, gitStatus, inside, listTree, readFileView, resolveInside } from "../server/files.ts";
import { removeTempDir } from "./fixtures/cleanup.ts";

/** 預覽用的上限：超過就截斷。 */
const MAX_TEXT_BYTES = 256 * 1024;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-web-files-"));
/** 一個普通的專案目錄，檔案面板的根。 */
const project = path.join(dir, "project");
/** 一個真的 git 倉庫。 */
const repo = path.join(dir, "repo");

function git(args: string[], cwd: string): void {
	const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} 失敗：${proc.stderr.toString()}`);
}

beforeAll(() => {
	fs.mkdirSync(path.join(project, "src"), { recursive: true });
	fs.mkdirSync(path.join(project, "node_modules", "left-pad"), { recursive: true });
	fs.mkdirSync(path.join(project, ".git"), { recursive: true });
	fs.mkdirSync(path.join(project, "dist"), { recursive: true });
	fs.writeFileSync(path.join(project, "README.md"), "# 專案\n說明\n");
	fs.writeFileSync(path.join(project, "src", "index.ts"), "export const a = 1;\n");
	fs.writeFileSync(path.join(project, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
	fs.writeFileSync(path.join(project, ".git", "HEAD"), "ref: refs/heads/main\n");
	fs.writeFileSync(path.join(project, "dist", "bundle.js"), "console.log(1);\n");

	fs.mkdirSync(repo, { recursive: true });
	git(["init", "-q"], repo);
	git(["config", "user.email", "test@example.com"], repo);
	git(["config", "user.name", "Test"], repo);
	fs.writeFileSync(path.join(repo, "tracked.txt"), "第一版\n");
	git(["add", "tracked.txt"], repo);
	git(["commit", "-q", "-m", "init"], repo);
});

afterAll(() => {
	removeTempDir(dir);
});

describe("路徑邊界 inside()", () => {
	test("同一個路徑與底下的路徑算在裡面", () => {
		expect(inside(project, project)).toBe(true);
		expect(inside(project, path.join(project, "src", "index.ts"))).toBe(true);
		expect(inside(project, path.join(project, "src"))).toBe(true);
	});

	test("父層與兄弟目錄算在外面", () => {
		expect(inside(project, path.dirname(project))).toBe(false);
		expect(inside(project, path.join(path.dirname(project), "other", "x.txt"))).toBe(false);
		// 前綴相同的兄弟目錄不是子目錄。
		expect(inside(project, `${project}-evil`)).toBe(false);
		expect(inside(project, `${project}-evil${path.sep}x.txt`)).toBe(false);
	});

	test("`..` 逃不出來", () => {
		expect(inside(project, path.join(project, "..", "outside.txt"))).toBe(false);
		expect(inside(project, path.join(project, "src", "..", "..", "outside.txt"))).toBe(false);
	});

	test("尾斜線與大小寫不代表不同的目錄", () => {
		// 結尾有沒有分隔符不影響判斷。
		expect(inside(project, project + path.sep)).toBe(true);
		expect(inside(project + path.sep, path.join(project, "src"))).toBe(true);
		// Windows 上檔案系統本來就不分大小寫；`inside()` 的前綴比對一律轉小寫，
		// 所以兩種平台的結果一致——這是刻意的：不能靠大小寫繞過邊界檢查。
		expect(inside(project, path.join(project.toUpperCase(), "src", "index.ts"))).toBe(true);
		expect(inside(project.toUpperCase(), path.join(project, "src", "index.ts"))).toBe(true);
	});

	test("不同磁碟機不算在裡面", () => {
		const other = path.parse(project).root === "C:\\" ? "D:\\elsewhere" : "/elsewhere";
		expect(inside(project, other)).toBe(false);
		expect(inside(project, path.join(other, "x.txt"))).toBe(false);
	});
});

describe("resolveInside() 的越界保護", () => {
	test("允許底下的相對路徑", () => {
		expect(resolveInside(project, "src/index.ts", "zh")).toBe(path.join(project, "src", "index.ts"));
		// 空字串就是專案根。
		expect(resolveInside(project, "", "zh")).toBe(path.resolve(project));
	});

	test("越界時丟出可讀的錯誤", () => {
		expect(() => resolveInside(project, "../outside.txt", "zh")).toThrow("路径越界");
		expect(() => resolveInside(project, "../outside.txt", "en")).toThrow("Path is outside the project");
	});
});

describe("listTree() 的目錄清單", () => {
	test("目錄排前面，並且不列出 .git 與 node_modules", async () => {
		const tree = await listTree(project, "", "zh");
		const names = tree.entries.map(e => e.name);
		expect(names).toContain("src");
		expect(names).toContain("README.md");
		// 這兩個目錄會讓清單爆掉，所以不列出。
		expect(names).not.toContain(".git");
		expect(names).not.toContain("node_modules");
		// `dist` 不是被隱藏的目錄（只有 .git 與 node_modules 是），所以它要出現。
		expect(names).toContain("dist");
	});

	test("目錄在檔案前面，檔案用名稱排序", async () => {
		const tree = await listTree(project, "", "zh");
		const dirs = tree.entries.filter(e => e.dir).map(e => e.name);
		const files = tree.entries.filter(e => !e.dir).map(e => e.name);
		expect(dirs.length).toBeGreaterThan(0);
		expect(files.length).toBeGreaterThan(0);
		// 所有目錄都排在所有檔案之前。
		const firstFile = tree.entries.findIndex(e => !e.dir);
		const lastDir = tree.entries.map(e => e.dir).lastIndexOf(true);
		expect(lastDir).toBeLessThan(firstFile);
		// 檔案之間按名稱排（localeCompare，大小寫不敏感）。
		expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b, "zh-CN", { sensitivity: "base" })));
	});

	test("回傳的路徑是相對於專案根的", async () => {
		const tree = await listTree(project, "src", "zh");
		expect(tree.path).toBe("src");
		expect(tree.entries.map(e => e.name)).toEqual(["index.ts"]);
	});

	test("越界的相對路徑不會被讀取", async () => {
		await expect(listTree(project, "..", "zh")).rejects.toThrow("路径越界");
	});
});

describe("readFileView() 的預覽", () => {
	test("文字檔回傳內容與大小", async () => {
		const view = await readFileView(project, "README.md", "zh");
		expect(view.path).toBe("README.md");
		expect(view.text).toBe("# 專案\n說明\n");
		expect(view.size).toBe(Buffer.byteLength("# 專案\n說明\n"));
		expect(view.truncated).toBe(false);
		expect(view.binary).toBeUndefined();
	});

	test("圖片檔只回報大小與圖片標記", async () => {
		fs.writeFileSync(path.join(project, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		const view = await readFileView(project, "logo.png", "zh");
		expect(view.image).toBe(true);
		expect(view.text).toBeUndefined();
		expect(view.size).toBe(4);
	});

	test("有二進位位元組的檔案視為二進位", async () => {
		fs.writeFileSync(path.join(project, "blob.bin"), Buffer.from([0x01, 0x00, 0x02]));
		const view = await readFileView(project, "blob.bin", "zh");
		expect(view.binary).toBe(true);
		expect(view.text).toBeUndefined();
	});

	test("超過上限的檔案會被截斷並標記", async () => {
		const big = "a".repeat(MAX_TEXT_BYTES + 4096);
		fs.writeFileSync(path.join(project, "big.txt"), big);
		const view = await readFileView(project, "big.txt", "zh");
		expect(view.truncated).toBe(true);
		expect(view.text!.length).toBe(MAX_TEXT_BYTES);
		expect(view.size).toBe(Buffer.byteLength(big));
	});

	test("剛好在上限內的檔案不會被標成截斷", async () => {
		const exact = "b".repeat(MAX_TEXT_BYTES);
		fs.writeFileSync(path.join(project, "exact.txt"), exact);
		const view = await readFileView(project, "exact.txt", "zh");
		expect(view.truncated).toBe(false);
		expect(view.text!.length).toBe(MAX_TEXT_BYTES);
	});

	test("不存在的檔案與目錄都會失敗", async () => {
		await expect(readFileView(project, "missing.txt", "zh")).rejects.toThrow();
		// 目錄不是檔案。
		await expect(readFileView(project, "src", "zh")).rejects.toThrow("不是文件");
	});
});

describe("contentTypeFor() 的型別", () => {
	test("圖片副檔名有自己的型別", () => {
		expect(contentTypeFor(project, "logo.png", "zh").type).toBe("image/png");
		expect(contentTypeFor(project, "logo.JPG", "zh").type).toBe("image/jpeg");
		expect(contentTypeFor(project, "logo.svg", "zh").type).toBe("image/svg+xml");
	});

	test("其他副檔名是二進位流", () => {
		expect(contentTypeFor(project, "README.md", "zh").type).toBe("application/octet-stream");
		expect(contentTypeFor(project, "noext", "zh").type).toBe("application/octet-stream");
	});

	test("回傳的是磁碟上的絕對路徑", () => {
		expect(contentTypeFor(project, "src/index.ts", "zh").file).toBe(path.join(project, "src", "index.ts"));
		expect(() => contentTypeFor(project, "../x", "zh")).toThrow("路径越界");
	});
});

describe("gitStatus() 的狀態", () => {
	test("不在倉庫裡就是 notRepo", async () => {
		const status = await gitStatus(project);
		expect(status.notRepo).toBe(true);
		expect(status.files).toBeUndefined();
	});

	test("倉庫裡列出被改過與未追蹤的檔案", async () => {
		fs.writeFileSync(path.join(repo, "tracked.txt"), "第二版\n");
		fs.writeFileSync(path.join(repo, "new.txt"), "新檔案\n");
		const status = await gitStatus(repo);
		expect(status.notRepo).toBeUndefined();
		expect(status.root).toBe(path.resolve(repo));
		const tracked = status.files!.find(f => f.path === "tracked.txt");
		expect(tracked).toBeDefined();
		expect(tracked!.y).toBe("M");
		const untracked = status.files!.find(f => f.path === "new.txt");
		expect(untracked).toBeDefined();
		expect(untracked!.x).toBe("?");
	});
});

describe("gitDiff() 的差異", () => {
	test("已追蹤的檔案給出真實的 diff", async () => {
		const diff = await gitDiff(repo, "tracked.txt", "zh");
		expect(diff.untracked).toBeUndefined();
		expect(diff.diff).toContain("tracked.txt");
		expect(diff.diff).toContain("-第一版");
		expect(diff.diff).toContain("+第二版");
	});

	test("未追蹤的檔案整份都當成新增", async () => {
		const diff = await gitDiff(repo, "new.txt", "zh");
		expect(diff.untracked).toBe(true);
		expect(diff.diff).toContain("+++ b/new.txt");
		expect(diff.diff).toContain("+新檔案");
	});

	test("相對於倉庫根的路徑與相對於 cwd 的路徑都找得到同一個檔案", async () => {
		const sub = path.join(repo, "sub");
		fs.mkdirSync(sub, { recursive: true });
		fs.writeFileSync(path.join(sub, "inner.txt"), "內層\n");
		git(["add", "sub/inner.txt"], repo);
		git(["commit", "-q", "-m", "sub"], repo);
		fs.writeFileSync(path.join(sub, "inner.txt"), "改過了\n");
		// cwd 在子目錄，rel 也是相對於 cwd。
		const fromCwd = await gitDiff(sub, "inner.txt", "zh");
		expect(fromCwd.diff).toContain("+改過了");
		// rel 相對於倉庫根。
		const fromRoot = await gitDiff(repo, "sub/inner.txt", "zh");
		expect(fromRoot.diff).toContain("+改過了");
	});

	test("不是倉庫就沒有 diff 可給", async () => {
		await expect(gitDiff(project, "README.md", "zh")).rejects.toThrow("此项目不是 Git 仓库");
	});

	test("越界的路徑被擋下來", async () => {
		await expect(gitDiff(repo, "../../outside.txt", "zh")).rejects.toThrow("路径越界");
	});
});
