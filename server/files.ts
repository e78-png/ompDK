/**
 * Read-only file and git access for the right-hand panel.
 *
 * Every entry point takes a `cwd` the app already knows (validated by the
 * caller) plus a path that must resolve inside it, so `..` cannot escape the
 * project. Git runs as a short-lived child process with optional locks off.
 */
import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import type { FileView, FsTree, GitDiff, GitStatus } from "../shared/api.ts";
import { type Lang, msg } from "./messages.ts";
import { samePath } from "./session-index.ts";

/** Text previews stop here; the client is told the content was clipped. */
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_DIFF_BYTES = 512 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const SKIP_DIRS = new Set([".git", "node_modules"]);
const NUL_SCAN_BYTES = 8000;

const IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
};

export interface TreeEntry {
	name: string;
	dir: boolean;
}

export function inside(base: string, target: string): boolean {
	return insideReal(realPath(base), realPath(target));
}

/**
 * The path as the operating system reports it.
 *
 * 為什麼要這一步：Windows 上同一個目錄有兩個寫法——長名（`C:\Users\runneradmin`）
 * 與 8.3 短名（`C:\Users\RUNNER~1`）。`git rev-parse --show-toplevel` 回的是短名，
 * 而 `path.resolve` 給的是長名；用字串比較，兩邊會被說成不同的目錄，於是
 * 面板對每個檔案都說「路徑越界」。
 *
 * `realpath` 會把短名展開成長名；路徑不存在時就退回原樣（正在寫入的檔案就是
 * 這種情況）。
 */
function realPath(p: string): string {
	const resolved = path.resolve(p);
	try {
		return realpathSync.native(resolved);
	} catch {
		// The file itself may not exist yet (one being written). Resolve the directory
		// instead and keep the leaf: that is where the 8.3 name lives.
		try {
			return path.join(realpathSync.native(path.dirname(resolved)), path.basename(resolved));
		} catch {
			return resolved;
		}
	}
}

/** The containment check itself, on two already-resolved paths. */
function insideReal(resolvedBase: string, resolvedTarget: string): boolean {
	if (samePath(resolvedBase, resolvedTarget)) return true;
	const prefix = (resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep).toLowerCase();
	return resolvedTarget.toLowerCase().startsWith(prefix);
}

/**
 * 把一個網址路徑解析成 web root 底下的一個檔案路徑；解析不了就回 null。
 *
 * 為什麼要獨立成一個純函式：`inside()` 的邊界檢查很容易在改動時被繞過
 * （前綴比對沒有目錄邊界時，`dist-evil\x` 會被 `dist` 開頭比對命中）。
 * 把它放在這裡並附上測試，就不會再有人用錯的判斷式。
 *
 * 為什麼要自己解碼路徑：路由層已經把路徑解碼過一次，但編碼過的 `%2e%2e%2f`
 * 在這裡解碼後才是 `../`，所以邊界檢查必須發生在解碼之後。
 */
export function resolveStaticFile(distDir: string, urlPath: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(urlPath);
	} catch {
		// 不是合法的 percent-encoding：沒有理由猜使用者想指哪個檔案。
		return null;
	}
	const rel = decoded.replace(/^\/+/, "");
	if (!rel) return null;
	const file = path.join(distDir, rel);
	return inside(distDir, file) ? file : null;
}

/** Resolve `rel` against `cwd`, refusing anything that escapes it. */
export function resolveInside(cwd: string, rel: string, lang: Lang): string {
	const target = path.resolve(cwd, rel || ".");
	if (!inside(cwd, target)) throw new Error(msg(lang, ["路径越界", "Path is outside the project"]));
	return target;
}

function relPath(cwd: string, absolute: string): string {
	return path.relative(path.resolve(cwd), absolute).replace(/\\/g, "/");
}

/** One directory level, directories first, hidden of `.git`/`node_modules`. */
export async function listTree(cwd: string, rel: string, lang: Lang): Promise<FsTree> {
	const dir = resolveInside(cwd, rel, lang);
	const dirents = await fs.readdir(dir, { withFileTypes: true });
	const entries = dirents
		.filter(e => !SKIP_DIRS.has(e.name))
		.map(e => ({ name: e.name, dir: e.isDirectory() }))
		.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, "zh-CN", { sensitivity: "base" }));
	return { path: relPath(cwd, dir), entries };
}

/** Looks like text? Same heuristic as git: a NUL byte in the first few KB. */
function looksBinary(head: Buffer): boolean {
	return head.subarray(0, NUL_SCAN_BYTES).includes(0);
}

export async function readFileView(cwd: string, rel: string, lang: Lang): Promise<FileView> {
	const file = resolveInside(cwd, rel, lang);
	const stat = await fs.stat(file);
	if (!stat.isFile()) throw new Error(msg(lang, ["不是文件", "Not a file"]));
	const shown = relPath(cwd, file);
	if (IMAGE_TYPES[path.extname(file).toLowerCase()]) return { path: shown, image: true, size: stat.size };
	const handle = await fs.open(file, "r");
	try {
		const buffer = Buffer.allocUnsafe(Math.min(stat.size, MAX_TEXT_BYTES + 1));
		const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
		const head = buffer.subarray(0, bytesRead);
		if (looksBinary(head)) return { path: shown, binary: true, size: stat.size };
		const truncated = stat.size > MAX_TEXT_BYTES;
		return { path: shown, text: head.subarray(0, MAX_TEXT_BYTES).toString("utf8"), truncated, size: stat.size };
	} finally {
		await handle.close();
	}
}

/** Content type for `GET /api/fs/raw`, which streams a file unchanged (image preview). */
export function contentTypeFor(cwd: string, rel: string, lang: Lang): { file: string; type: string } {
	const file = resolveInside(cwd, rel, lang);
	const type = IMAGE_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
	return { file, type };
}

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
	const proc = Bun.spawn(["git", "-C", cwd, ...args], {
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS);
	try {
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;
		return { code: proc.exitCode ?? -1, stdout };
	} finally {
		clearTimeout(timer);
	}
}

/** Absolute git work-tree root for `cwd`, or undefined when it is not in a repository. */
async function gitRoot(cwd: string): Promise<string | undefined> {
	const res = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (res.code !== 0) return undefined;
	const root = res.stdout.trim();
	return root ? path.resolve(root) : undefined;
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
	const root = await gitRoot(cwd);
	if (!root) return { notRepo: true };
	const res = await runGit(root, ["status", "--porcelain=v1", "-z"]);
	if (res.code !== 0) return { notRepo: true };
	const files: { path: string; x: string; y: string }[] = [];
	const parts = res.stdout.split("\0");
	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		if (entry.length < 4) continue;
		files.push({ path: entry.slice(3).replace(/\\/g, "/"), x: entry[0], y: entry[1] });
		// A rename/copy carries the original path as the next NUL-separated field.
		if (entry[0] === "R" || entry[0] === "C") i++;
	}
	return { root, files };
}

function clip(diff: string): { diff: string; truncated?: boolean } {
	if (diff.length <= MAX_DIFF_BYTES) return { diff };
	return { diff: diff.slice(0, MAX_DIFF_BYTES), truncated: true };
}

async function exists(file: string): Promise<boolean> {
	try {
		await fs.stat(file);
		return true;
	} catch {
		return false;
	}
}

/**
 * `git diff HEAD` for a tracked file; an untracked one is shown as all-new.
 *
 * `rel` is accepted in either spelling: relative to the repository root (what
 * `git status` prints) or to the session cwd (what an edit card hands over),
 * because a session cwd may sit in a subdirectory of the work tree.
 */
export async function gitDiff(cwd: string, rel: string, lang: Lang): Promise<GitDiff> {
	const root = await gitRoot(cwd);
	if (!root) throw new Error(msg(lang, ["此项目不是 Git 仓库", "This project is not a Git repository"]));
	const fromRoot = path.resolve(root, rel || ".");
	const target = inside(root, fromRoot) && (await exists(fromRoot)) ? fromRoot : resolveInside(cwd, rel, lang);
	if (!inside(root, target)) throw new Error(msg(lang, ["路径越界", "Path is outside the project"]));
	const shown = relPath(root, target);

	const status = await gitStatus(root);
	if ((status.files ?? []).some(f => f.path === shown && f.x === "?")) {
		const text = await fs.readFile(target, "utf8");
		const body = text.split("\n").map(line => `+${line}`);
		return { ...clip([`--- /dev/null`, `+++ b/${shown}`, ...body].join("\n")), untracked: true };
	}
	const res = await runGit(root, ["diff", "HEAD", "--", shown]);
	if (res.code !== 0) {
		const fallback = await runGit(root, ["diff", "--", shown]);
		if (fallback.code !== 0) throw new Error(msg(lang, ["读取 diff 失败", "Could not read the diff"]));
		return clip(fallback.stdout);
	}
	return clip(res.stdout);
}
