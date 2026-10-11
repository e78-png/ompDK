/**
 * omp-config drives a stub `omp` binary (OMP_WEB_OMP_BIN) that keeps the config
 * in a JSON file, so the read-modify-write, serialization and error paths are
 * exercised without a real omp install.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-config-${process.pid}-${Date.now()}`));
const configFile = path.join(dir, "config.json");
const cmdFile = path.join(dir, "omp.cmd");
const previousBin = process.env.OMP_WEB_OMP_BIN;
const previousAgentDir = process.env.OMP_WEB_AGENT_DIR;
const previousStubFile = process.env.STUB_CONFIG_FILE;

let mod: typeof import("../server/omp-config.ts");
let HttpError: typeof import("../server/http-error.ts")["HttpError"];

function seed(): void {
	fs.writeFileSync(
		configFile,
		JSON.stringify({
			modelRoles: { value: { default: "a/one:medium", tiny: "b/two" }, type: "record", description: "" },
			disabledExtensions: { value: ["skill:gone"], type: "array", description: "" },
		}),
	);
}

function stored(): Record<string, { value: unknown }> {
	return JSON.parse(fs.readFileSync(configFile, "utf8"));
}

function statusOf(e: unknown): number {
	return (e as { status?: number }).status ?? 0;
}

beforeAll(async () => {
	seed();
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	fs.writeFileSync(cmdFile, `@bun "${stub}" %*\r\n`);
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = path.join(dir, "agent");
	process.env.STUB_CONFIG_FILE = configFile;
	// bun shares one module registry across test files; pin config explicitly so
	// this file never depends on import order or touches the real agent dir.
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = path.join(dir, "agent");
	mod = await import("../server/omp-config.ts");
	// The read cache is module-global and outlives this file's stub config, so a run that
	// follows another omp-config user can otherwise answer from that file's file.
	mod.invalidateSettings();
	({ HttpError } = await import("../server/http-error.ts"));
});

afterAll(async () => {
	if (previousBin === undefined) delete process.env.OMP_WEB_OMP_BIN;
	else process.env.OMP_WEB_OMP_BIN = previousBin;
	if (previousAgentDir === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previousAgentDir;
	if (previousStubFile === undefined) delete process.env.STUB_CONFIG_FILE;
	else process.env.STUB_CONFIG_FILE = previousStubFile;
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("readSettings", () => {
	test("读得到已设的键，没设的键是 undefined", async () => {
		const got = await mod.readSettings(["modelRoles", "plan.defaultOnStartup"]);
		expect(got.modelRoles).toEqual({ default: "a/one:medium", tiny: "b/two" });
		expect(got["plan.defaultOnStartup"]).toBeUndefined();
	});

	test("写入后缓存作废，再读是新值", async () => {
		await mod.readSettings(["modelRoles"]);
		await mod.patchRecord("modelRoles", "default", "c/three:high");
		const got = await mod.readSettings(["modelRoles"]);
		expect((got.modelRoles as Record<string, string>).default).toBe("c/three:high");
	});

	test("慢读跨过写入：写完之后不能又读回旧值", async () => {
		seed();
		mod.invalidateSettings();
		process.env.STUB_LIST_DELAY_MS = "900";
		try {
			// 读不排在写后面，所以一次读完全可能在写入落地时才返回，手里拿的是旧配置。
			const slow = mod.readSettings(["modelRoles"]);
			await new Promise(r => setTimeout(r, 100));
			delete process.env.STUB_LIST_DELAY_MS;
			await mod.patchRecord("modelRoles", "default", "d/four:low");
			await slow;
			const got = await mod.readSettings(["modelRoles"]);
			expect((got.modelRoles as Record<string, string>).default).toBe("d/four:low");
		} finally {
			delete process.env.STUB_LIST_DELAY_MS;
		}
	});
});

describe("patchRecord", () => {
	test("改一个键不丢其他键", async () => {
		seed();
		mod.invalidateSettings();
		await mod.patchRecord("modelRoles", "default", "c/three:high");
		expect(stored().modelRoles.value).toEqual({ default: "c/three:high", tiny: "b/two" });
	});

	test("value 为 undefined 时删键", async () => {
		await mod.patchRecord("modelRoles", "tiny", undefined);
		expect(stored().modelRoles.value).toEqual({ default: "c/three:high" });
	});
});

describe("toggleInArray", () => {
	test("加元素、重复加去重、再删掉", async () => {
		seed();
		mod.invalidateSettings();
		await mod.toggleInArray("disabledExtensions", "skill:new", true);
		expect(stored().disabledExtensions.value).toEqual(["skill:gone", "skill:new"]);
		await mod.toggleInArray("disabledExtensions", "skill:new", true);
		expect(stored().disabledExtensions.value).toEqual(["skill:gone", "skill:new"]);
		await mod.toggleInArray("disabledExtensions", "skill:new", false);
		expect(stored().disabledExtensions.value).toEqual(["skill:gone"]);
	});
});

describe("串行化", () => {
	test("两个并发写都生效，不互相覆盖", async () => {
		seed();
		mod.invalidateSettings();
		await Promise.all([mod.patchRecord("modelRoles", "default", "x/one"), mod.patchRecord("modelRoles", "slow", "y/two")]);
		expect(stored().modelRoles.value).toEqual({ default: "x/one", tiny: "b/two", slow: "y/two" });
	});
});

describe("白名单", () => {
	test("白名单外的键一律 403", async () => {
		for (const attempt of [
			mod.writeSetting("theme", { dark: "x" }),
			mod.patchRecord("theme", "dark", "x"),
			mod.toggleInArray("composer", "x", true),
		]) {
			const e = await attempt.then(() => undefined, (err: unknown) => err);
			expect(e).toBeInstanceOf(HttpError);
			expect(statusOf(e)).toBe(403);
		}
		expect(stored().theme).toBeUndefined();
	});
});

describe("命令失败", () => {
	test("非 0 退出码转成 400，并带上 stderr 末尾", async () => {
		const e = await mod.writeSetting("modelRoles", { REJECT: true }).then(() => undefined, (err: unknown) => err);
		expect(e).toBeInstanceOf(HttpError);
		expect(statusOf(e)).toBe(400);
		expect((e as Error).message).toContain("rejected by policy");
	});
});
