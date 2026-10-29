/**
 * The model list cache against the stub omp binary. Each test imports a fresh module
 * instance (`?n` cache-buster) because the cache lives in module state, drives expiry
 * through the disk file's `fetchedAt` instead of faking the clock, and counts spawns in
 * its own file — a background refresh started by an earlier test outlives that test.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeStubBin } from "./fixtures/stub-bin.ts";
import { removeTempDir } from "./fixtures/cleanup.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-models-${process.pid}-${Date.now()}`));
const dataDir = path.join(dir, "web");
const agentDir = path.join(dir, "agent");
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
const cacheFile = path.join(dataDir, "models-cache.json");
const previous = { bin: process.env.OMP_WEB_OMP_BIN, agent: process.env.OMP_WEB_AGENT_DIR, cfg: process.env.STUB_CONFIG_FILE };

type ModelsModule = typeof import("../server/models.ts");
let instance = 0;
let callsFile = path.join(dir, "calls-0.log");

async function freshModels(): Promise<ModelsModule> {
	instance++;
	return await import(`../server/models.ts?case=${instance}`);
}

/** Start counting from zero for this test, in a file no other test writes to. */
function useCalls(name: string): void {
	callsFile = path.join(dir, `calls-${name}.log`);
	fs.rmSync(callsFile, { force: true });
	process.env.STUB_CALLS_FILE = callsFile;
}

function calls(): number {
	try {
		return fs.readFileSync(callsFile, "utf8").split("\n").filter(Boolean).length;
	} catch {
		return 0;
	}
}

/** The count is written by a child process, so waiting for it is the assertion. */
async function waitCalls(n: number, timeoutMs = 3000): Promise<void> {
	const t0 = Date.now();
	while (calls() < n) {
		if (Date.now() - t0 > timeoutMs) throw new Error(`等了 ${timeoutMs}ms，只记录了 ${calls()} 次调用，期望 ${n} 次`);
		await new Promise(r => setTimeout(r, 25));
	}
}

function writeDisk(models: unknown[], ageMs: number, agent = agentDir): void {
	fs.mkdirSync(dataDir, { recursive: true });
	fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now() - ageMs, agentDir: agent, models }));
}

const MODELS_OLD = [{ provider: "p1", id: "m1", name: "M1", kind: "chat" }];

beforeAll(async () => {
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = agentDir;
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	// bun shares one module registry across test files; pin config explicitly.
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = agentDir;
	config.dataDir = dataDir;
});

afterAll(() => {
	if (previous.bin === undefined) delete process.env.OMP_WEB_OMP_BIN;
	else process.env.OMP_WEB_OMP_BIN = previous.bin;
	if (previous.agent === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previous.agent;
	if (previous.cfg === undefined) delete process.env.STUB_CONFIG_FILE;
	else process.env.STUB_CONFIG_FILE = previous.cfg;
	delete process.env.STUB_MODELS;
	delete process.env.STUB_MODELS_DELAY_MS;
	delete process.env.STUB_MODELS_FAIL;
	delete process.env.STUB_CALLS_FILE;
	removeTempDir(dir);
});

describe("stale-while-revalidate", () => {
	test("磁盘上有旧列表时立即返回，后台只补一次加载", async () => {
		useCalls("stale");
		writeDisk(MODELS_OLD, 61_000);
		const m = await freshModels();
		m.warmModels();
		const got = await m.listModels();
		expect(got.stale).toBe(true);
		expect(got.models).toEqual(MODELS_OLD);
		await waitCalls(1); // 预热发起的那一发
		await new Promise(r => setTimeout(r, 400));
		expect(calls()).toBe(1); // 请求复用了它，没有再补一发
	});

	test("并发请求只启动一个 omp models", async () => {
		useCalls("merge");
		fs.rmSync(cacheFile, { force: true });
		process.env.STUB_MODELS_DELAY_MS = "300";
		const m = await freshModels();
		const three = await Promise.all([m.listModels(), m.listModels(), m.listModels()]);
		delete process.env.STUB_MODELS_DELAY_MS;
		expect(three.every(r => r.models.length === 1 && !r.stale)).toBe(true);
		await waitCalls(1);
		await new Promise(r => setTimeout(r, 300));
		expect(calls()).toBe(1);
	});

	test("刷新失败时继续用旧列表，不把错误抛给调用方", async () => {
		useCalls("fail");
		writeDisk(MODELS_OLD, 61_000);
		process.env.STUB_MODELS_FAIL = "1";
		const m = await freshModels();
		m.warmModels();
		const got = await m.listModels();
		expect(got.models).toEqual(MODELS_OLD);
		expect(got.stale).toBe(true);
		await waitCalls(1); // 确实试过刷新
		delete process.env.STUB_MODELS_FAIL;
	});
});

describe("缓存作废", () => {
	test("加载中途作废以后，这个结果不回填也不落盘", async () => {
		useCalls("invalidate-mid");
		fs.rmSync(cacheFile, { force: true });
		process.env.STUB_MODELS_DELAY_MS = "400";
		const m = await freshModels();
		const started = m.listModels();
		await waitCalls(1);
		m.invalidateModels();
		await started; // 调用方仍然拿到这一次的结果
		delete process.env.STUB_MODELS_DELAY_MS;
		await new Promise(r => setTimeout(r, 600));
		expect(m.cachedModelSelectors()).toBeUndefined();
		expect(fs.existsSync(cacheFile)).toBe(false);
	});

	test("作废以后 cachedModelSelectors 不再判失效", async () => {
		useCalls("invalidate");
		fs.rmSync(cacheFile, { force: true });
		const m = await freshModels();
		await m.listModels();
		expect(m.cachedModelSelectors()?.has("p1/m1")).toBe(true);
		m.invalidateModels();
		expect(m.cachedModelSelectors()).toBeUndefined();
	});
});

describe("磁盘缓存", () => {
	test("冷启动读磁盘，不启动进程就能回答", async () => {
		useCalls("disk-hit");
		writeDisk([{ provider: "p9", id: "fresh", name: "F", kind: "chat" }], 1_000);
		const m = await freshModels();
		m.warmModels();
		const got = await m.listModels();
		expect(got.stale).toBe(false);
		expect(got.models).toEqual([{ provider: "p9", id: "fresh", name: "F", kind: "chat" }]);
		await waitCalls(1); // 只有后台刷新那一发
	});

	test("agentDir 不一致的磁盘文件被忽略", async () => {
		useCalls("disk-other");
		writeDisk(MODELS_OLD, 1_000, path.join(dir, "other-agent"));
		const m = await freshModels();
		m.warmModels();
		const got = await m.listModels();
		expect(got.models).toEqual(MODELS_OLD); // 来自后台刷新，不是磁盘那一份
		await waitCalls(1);
	});

	test("写成功的列表会落到磁盘上", async () => {
		useCalls("disk-write");
		fs.rmSync(cacheFile, { force: true });
		const m = await freshModels();
		await m.listModels();
		await waitCalls(1);
		await new Promise(r => setTimeout(r, 200));
		const onDisk = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as { agentDir: string; models: unknown[] };
		expect(onDisk.agentDir).toBe(agentDir);
		expect(onDisk.models).toEqual(MODELS_OLD);
	});
});
