/**
 * `ompweb` entry point (shims live in ~/.bun/bin).
 *
 *   ompweb            daily profile (~/.omp/agent), http://127.0.0.1:30190
 *   ompweb --test     isolated example profile, http://127.0.0.1:30191
 *   ompweb --restart  stop a running server first (needed after server/ changes)
 *   ompweb --no-open  start without opening the browser
 *
 * Already running → just open the page, unless that server is older than the
 * files under server/ and shared/ (it would be missing new routes); then say so
 * and wait for `--restart`. `--restart` asks the running gateway to shut itself
 * down — it drains its omp children first, which is what keeps a session file from
 * being held by a process the next gateway then had to copy around — and only falls
 * back to a forced tree kill if that does not finish within 10 seconds. Otherwise
 * rebuild the frontend when web sources are newer than dist/, start the gateway in
 * this terminal (Ctrl+C stops it), and open the page once it answers.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { API_VERSION } from "../shared/api.ts";
import { OMP_LAYOUT } from "../shared/omp/conventions.ts";

const root = path.resolve(import.meta.dir, "..");
const test = process.argv.includes("--test");
const noOpen = process.argv.includes("--no-open");
const restart = process.argv.includes("--restart");
const port = Number(process.env.OMP_WEB_PORT ?? (test ? 30191 : 30190));
const url = `http://127.0.0.1:${port}/`;
/** The profile this launch would serve, spelled the way `server/config.ts` does. */
const profileDir = process.env.OMP_WEB_AGENT_DIR
	? path.resolve(process.env.OMP_WEB_AGENT_DIR)
	: test
		? path.join(root, ".data", "omp-agent")
		: path.join(os.homedir(), ...OMP_LAYOUT.defaultAgentDir);

interface Health {
	api?: number;
	pid?: number;
	startedAt?: number;
}

async function health(): Promise<Health | undefined> {
	try {
		const res = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(800) });
		return res.ok ? ((await res.json()) as Health) : undefined;
	} catch {
		return undefined;
	}
}

async function healthy(): Promise<boolean> {
	return (await health()) !== undefined;
}

function openBrowser(target = url): void {
	if (noOpen) return;
	const cmd = process.platform === "win32" ? ["cmd", "/c", "start", "", target] : process.platform === "darwin" ? ["open", target] : ["xdg-open", target];
	Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

/**
 * A gateway that already owns this profile on another port. A just-created lock may appear
 * before its listener, so a live pid inside the startup window is also enough to reuse it.
 */
const PROFILE_LOCK_STARTUP_MS = 10_000;

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * A gateway that already owns this profile on another port. The lock only counts when that
 * port answers with the recorded pid, except for the short startup window described above.
 */
async function profileOwner(): Promise<{ pid: number; port: number } | undefined> {
	try {
		const value = (await Bun.file(path.join(profileDir, "web-gateway.lock")).json()) as { pid?: number; port?: number; startedAt?: number };
		if (typeof value.pid !== "number" || typeof value.port !== "number" || value.port === port) return undefined;
		try {
			const res = await fetch(`http://127.0.0.1:${value.port}/api/health`, { signal: AbortSignal.timeout(900) });
			if (res.ok) {
				const health = (await res.json()) as { pid?: unknown };
				if (health.pid === value.pid) return { pid: value.pid, port: value.port };
			}
		} catch {
			// The owner may have written the lock just before binding its listener.
		}
		if (pidAlive(value.pid) && typeof value.startedAt === "number" && Date.now() - value.startedAt <= PROFILE_LOCK_STARTUP_MS) {
			return { pid: value.pid, port: value.port };
		}
	} catch {
		// No lock, malformed JSON, or a profile that has not been created yet.
	}
	return undefined;
}

/** Newest mtime under `dir`, skipping nothing (web sources are small). */
async function newest(dir: string): Promise<number> {
	let max = 0;
	for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue;
		const stat = await fs.stat(path.join(entry.parentPath, entry.name));
		max = Math.max(max, stat.mtimeMs);
	}
	return max;
}

async function needsBuild(): Promise<boolean> {
	try {
		const built = (await fs.stat(path.join(root, "dist", "index.html"))).mtimeMs;
		const sources = Math.max(await newest(path.join(root, "web")), await newest(path.join(root, "shared")));
		return sources > built;
	} catch {
		return true;
	}
}

/** Newest source of the gateway itself; a process older than this lacks the latest routes. */
async function newestServerSource(): Promise<number> {
	return Math.max(await newest(path.join(root, "server")), await newest(path.join(root, "shared")));
}

/** True when the running gateway predates this checkout (or another API version). */
async function isStaleServer(current: Health): Promise<boolean> {
	if (current.api !== API_VERSION) return true;
	if (!current.startedAt) return true;
	return (await newestServerSource()) > current.startedAt;
}

/**
 * The token the running gateway wrote into `<dataDir>/gateway.json`. Only a process that may
 * read this user's data directory can produce it, which is the difference between the launcher
 * restarting the gateway and any page on the machine stopping it.
 */
async function shutdownToken(): Promise<string | undefined> {
	try {
		const res = await fetch(`${url}api/about`, { signal: AbortSignal.timeout(1500) });
		if (!res.ok) return undefined;
		const dataDir = ((await res.json()) as { dataDir?: string }).dataDir;
		if (!dataDir) return undefined;
		const entry = (await Bun.file(path.join(dataDir, "gateway.json")).json()) as { token?: string };
		return typeof entry.token === "string" && entry.token ? entry.token : undefined;
	} catch {
		return undefined;
	}
}

async function stopRunning(current: Health): Promise<void> {
	// Graceful first: the gateway drains its omp children and exits itself. Killing it from
	// here is TerminateProcess on Windows, which skips that and leaves the children alive and
	// holding the session files they were mid-way through writing.
	const token = await shutdownToken();
	if (token) {
		try {
			await fetch(`${url}api/shutdown`, { method: "POST", headers: { "x-omp-web-token": token }, signal: AbortSignal.timeout(3000) });
		} catch {
			// The response is a courtesy; the port going quiet is the proof it worked.
		}
		for (let i = 0; i < 50; i++) {
			await Bun.sleep(200);
			if (!(await healthy())) {
				console.log(`已停止旧服务（pid ${current.pid}），正在启动新的…`);
				return;
			}
		}
		console.error("优雅停止超时（子进程可能卡住），改用强制结束…");
	}
	if (!current.pid) {
		console.error("这个服务没有报告进程号，无法自动重启：请在它的终端按 Ctrl+C，然后重新运行 ompweb");
		process.exit(1);
	}
	if (process.platform === "win32") {
		// /T takes the omp children with it; process.kill alone would orphan them on the files.
		const kill = Bun.spawn(["taskkill", "/PID", String(current.pid), "/T", "/F"], { stdout: "ignore", stderr: "pipe" });
		const text = await new Response(kill.stderr).text();
		if ((await kill.exited) !== 0) {
			console.error(`停止旧服务失败：${text.trim() || "taskkill 返回非零"}`);
			process.exit(1);
		}
	} else {
		try {
			process.kill(current.pid);
		} catch (error) {
			console.error(`停止旧服务失败：${(error as Error).message}`);
			process.exit(1);
		}
	}
	for (let i = 0; i < 25; i++) {
		await Bun.sleep(200);
		if (!(await healthy())) {
			console.log(`已停止旧服务（pid ${current.pid}），正在启动新的…`);
			return;
		}
	}
	console.error("旧服务还在监听该端口，请手动停止后重试");
	process.exit(1);
}

const owner = await profileOwner();
if (owner) {
	// A second gateway on this profile would open its own omp for the same session files, and
	// omp resolves that by copying the conversation; serve the one that already owns it.
	console.log(`这个 OMP 配置目录已由另一个网关服务：http://127.0.0.1:${owner.port}/（pid ${owner.pid}）`);
	console.log(`要换端口就得换配置目录（OMP_WEB_AGENT_DIR），否则两个网关会抢同一批会话文件。`);
	openBrowser(`http://127.0.0.1:${owner.port}/`);
	process.exit(0);
}

const running = await health();
if (running && !(await isStaleServer(running))) {
	console.log(`OMP Web 已在运行：${url}`);
	openBrowser();
	process.exit(0);
}
if (running) {
	if (!restart) {
		console.log(`OMP Web 已在运行，但服务端是旧版本（server/ 或 shared/ 有更新）：${url}`);
		console.log(`重启后即可用上新接口：ompweb${test ? " --test" : ""} --restart`);
		process.exit(1);
	}
	await stopRunning(running);
}

if (await needsBuild()) {
	console.log("前端有更新，正在构建…");
	const build = Bun.spawn(["bun", "run", "build"], { cwd: root, stdout: "inherit", stderr: "inherit" });
	if ((await build.exited) !== 0) {
		console.error("构建失败，请在 04_Web 目录运行 bun run build 查看错误");
		process.exit(1);
	}
}

process.env.OMP_WEB_PORT = String(port);
void (async () => {
	for (let i = 0; i < 50; i++) {
		await Bun.sleep(200);
		if (await healthy()) {
			openBrowser();
			console.log("按 Ctrl+C 停止服务");
			return;
		}
	}
	console.error(`服务未在 10 秒内就绪，请检查上面的输出（端口 ${port} 是否被占用）`);
})();
await import("./serve.ts");
