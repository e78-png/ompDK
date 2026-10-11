/**
 * Who owns a profile. The predicate is deliberately two facts — the recorded pid exists *and*
 * that port answers `/api/health` with exactly that pid — because a lock left by a crashed
 * gateway, or a pid Windows handed to somebody else, must not be able to hold a profile hostage
 * (or, worse, let a second gateway start while a live one is still serving the same files).
 * The "live owner" cases run against a real helper process and a real listener, not a mock.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Subprocess } from "bun";
import { pathToFileURL } from "node:url";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-lock-${process.pid}-${Date.now()}`));
const agentDir = path.join(dir, "agent");
const helperFile = path.join(dir, "helper.ts");
const claimFile = path.join(dir, "claim.ts");
const previous = { agent: process.env.OMP_WEB_AGENT_DIR };

let mod: typeof import("../server/profile-lock.ts");
/** The helper's own pid, and the port it listens on. */
let helper = { pid: 0, port: 0 };
let helperProc: ReturnType<typeof Bun.spawn> | undefined;

function lockPath(): string {
	return path.join(agentDir, "web-gateway.lock");
}

function writeLock(value: { pid: number; port: number; startedAt?: number }): void {
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(lockPath(), JSON.stringify({ startedAt: 1, ...value }));
}

async function readPort(): Promise<number> {
	for (let i = 0; i < 60; i++) {
		const text = fs.existsSync(path.join(dir, "helper-port.txt")) ? fs.readFileSync(path.join(dir, "helper-port.txt"), "utf8") : "";
		if (text.trim()) return Number(text.trim());
		await Bun.sleep(50);
	}
	throw new Error("helper 没有报告端口");
}
async function firstLine<T extends Uint8Array>(stream: ReadableStream<T>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) throw new Error("子进程没有输出 claim 结果");
		text += decoder.decode(value, { stream: true });
		const end = text.indexOf("\n");
		if (end < 0) continue;
		reader.releaseLock();
		return text.slice(0, end);
	}
}

beforeAll(async () => {
	fs.writeFileSync(
		helperFile,
		`const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ pid: process.pid }) });
		await Bun.write(process.argv[2], String(server.port));
		await new Promise(() => undefined);`,
	);
	const moduleUrl = pathToFileURL(path.resolve(import.meta.dir, "../server/profile-lock.ts")).href;
	fs.writeFileSync(
		claimFile,
		`process.env.OMP_WEB_AGENT_DIR = process.argv[2];
process.env.OMP_WEB_PORT = process.argv[3];
const { claimProfileLock, releaseProfileLock } = await import(${JSON.stringify(moduleUrl)});
const result = await claimProfileLock();
console.log(JSON.stringify({ pid: process.pid, claimed: !result.owner, owner: result.owner?.pid ?? null }));
if (!result.owner) {
	for await (const _ of process.stdin) {}
	await releaseProfileLock(result.file);
}`,
	);
	const proc = Bun.spawn([process.execPath, "run", helperFile, path.join(dir, "helper-port.txt")], { stdout: "ignore", stderr: "ignore" });
	helperProc = proc;
	helper = { pid: proc.pid, port: await readPort() };
	process.env.OMP_WEB_AGENT_DIR = agentDir;
	const { config } = await import("../server/config.ts");
	config.agentDir = agentDir;
	config.sessionsRoot = path.join(agentDir, "sessions");
	mod = await import("../server/profile-lock.ts");
});

afterAll(() => {
	helperProc?.kill();
	if (previous.agent === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previous.agent;
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("profile 占用判定", () => {
	test("锁记的 pid 已经不在了：过期记录，可以接管", async () => {
		writeLock({ pid: 999_999, port: helper.port });
		expect(await mod.activeOwner()).toBeUndefined();
	});

	test("pid 活着但那个端口不以这个 pid 应答：不算占用者", async () => {
		// The recycled-pid guard: a live process that is not the gateway the lock describes.
		writeLock({ pid: helper.pid, port: helper.port + 1 });
		expect(await mod.activeOwner()).toBeUndefined();
	});

	test("pid 活着且那个端口就是它答的：占用者", async () => {
		writeLock({ pid: helper.pid, port: helper.port });
		const owner = await mod.activeOwner();
		expect(owner).toMatchObject({ pid: helper.pid, port: helper.port });
	});

	test("claim 遇到活的占用者就不写自己的记录", async () => {
		writeLock({ pid: helper.pid, port: helper.port });
		const taken = await mod.claimProfileLock();
		expect(taken.owner?.pid).toBe(helper.pid);
		expect(JSON.parse(fs.readFileSync(lockPath(), "utf8")).pid).toBe(helper.pid);
	});

	test("claim 遇到过期记录时接管，写下自己的 pid 和端口", async () => {
		writeLock({ pid: 999_999, port: 1 });
		const taken = await mod.claimProfileLock();
		expect(taken.owner).toBeUndefined();
		expect(JSON.parse(fs.readFileSync(lockPath(), "utf8")).pid).toBe(process.pid);
	});

	test("第二个进程不能覆盖刚创建但尚未监听的锁", async () => {
		fs.rmSync(lockPath(), { force: true });
		let first: Subprocess<"pipe", "pipe", "ignore"> | undefined;
		let second: Subprocess<"pipe", "pipe", "ignore"> | undefined;
		try {
			first = Bun.spawn([process.execPath, "run", claimFile, agentDir, "0"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
			const firstResult = JSON.parse(await firstLine(first.stdout));
			second = Bun.spawn([process.execPath, "run", claimFile, agentDir, "0"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
			const secondResult = JSON.parse(await firstLine(second.stdout));
			expect(firstResult.claimed).toBe(true);
			expect(secondResult.claimed).toBe(false);
			expect(secondResult.owner).toBe(firstResult.pid);
			first.stdin.end();
			second.stdin.end();
			await Promise.all([first.exited, second.exited]);
		} finally {
			first?.kill();
			second?.kill();
		}
	});

	test("release 只摘自己那份，别人的记录留着", async () => {
		await mod.claimProfileLock();
		await mod.releaseProfileLock();
		expect(fs.existsSync(lockPath())).toBe(false);
		writeLock({ pid: helper.pid, port: helper.port });
		await mod.releaseProfileLock();
		expect(JSON.parse(fs.readFileSync(lockPath(), "utf8")).pid).toBe(helper.pid);
	});
});
