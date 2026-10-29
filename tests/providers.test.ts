/**
 * `models.yml` writes are checked against omp's own reading of the profile, not just against
 * our YAML parser: the stub answers `models --json` before and after each write, so a write
 * that leaves the file unreadable, drops a provider, or fails to drop the one being removed
 * rolls back to the byte-identical original. `STUB_MODELS_FAIL_AFTER` is what makes the
 * before/after pair observable — the first call answers, the second does not.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OMP_LAYOUT } from "../shared/omp/conventions.ts";
import { writeStubBin } from "./fixtures/stub-bin.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-providers-${process.pid}-${Date.now()}`));
const agentDir = path.join(dir, "agent");
const modelsPath = path.join(agentDir, OMP_LAYOUT.modelsFile);
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
const callsFile = path.join(dir, "calls.txt");
const ENV_KEYS = ["OMP_WEB_OMP_BIN", "OMP_WEB_AGENT_DIR", "STUB_CONFIG_FILE", "STUB_CALLS_FILE", "STUB_MODELS", "STUB_MODELS_FAIL", "STUB_MODELS_FAIL_AFTER", "STUB_MODELS_WARN_AFTER", "STUB_MODELS_WARN"] as const;
const previous: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

/** The file as it stands before every test: a hand-tuned header plus one provider. */
const SEEDED = `# 手写的头部说明，必须一个字节都不动
providers:
  alpha:
    baseUrl: https://alpha.example/v1
    api: openai-completions
    models:
      - id: a1
        name: A1
`;

let mod: typeof import("../server/providers.ts");

/**
 * What the stub answers for `models --json`. The list is static for one call sequence, so a
 * test names every provider it expects omp to still see afterwards.
 */
function stubModels(models: unknown[], options: { fail?: boolean; failAfter?: number; warnAfter?: number; warn?: string } = {}): void {
	process.env.STUB_MODELS = JSON.stringify(models);
	if (options.fail) process.env.STUB_MODELS_FAIL = "1";
	else delete process.env.STUB_MODELS_FAIL;
	if (options.failAfter !== undefined) process.env.STUB_MODELS_FAIL_AFTER = String(options.failAfter);
	else delete process.env.STUB_MODELS_FAIL_AFTER;
	if (options.warnAfter !== undefined) process.env.STUB_MODELS_WARN_AFTER = String(options.warnAfter);
	else delete process.env.STUB_MODELS_WARN_AFTER;
	if (options.warn) process.env.STUB_MODELS_WARN = options.warn;
	else delete process.env.STUB_MODELS_WARN;
	fs.writeFileSync(callsFile, "");
}

function modelsCalls(): number {
	return fs
		.readFileSync(callsFile, "utf8")
		.split("\n")
		.filter(line => line.trim() === "models").length;
}

beforeAll(async () => {
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(modelsPath, SEEDED);
	fs.writeFileSync(path.join(dir, "config.json"), "{}");
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = agentDir;
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	process.env.STUB_CALLS_FILE = callsFile;
	// bun shares one module registry across test files; pin config explicitly.
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = agentDir;
	config.sessionsRoot = path.join(agentDir, OMP_LAYOUT.sessionsDir);
	mod = await import("../server/providers.ts");
});

afterEach(() => {
	fs.writeFileSync(modelsPath, SEEDED);
	delete process.env.STUB_MODELS_FAIL;
	delete process.env.STUB_MODELS_FAIL_AFTER;
	delete process.env.STUB_MODELS_WARN_AFTER;
	delete process.env.STUB_MODELS_WARN;
});

afterAll(() => {
	for (const key of ENV_KEYS) {
		const value = previous[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeProvider 的 omp 回读校验", () => {
	test("omp 写前写后都读得出：写入生效，头部和其它供应商不动", async () => {
		stubModels([{ provider: "alpha", id: "a1" }, { provider: "beta", id: "b1" }]);
		await mod.writeProvider("beta", { id: "beta", baseUrl: "https://beta.example/v1", api: "openai-completions", models: [{ id: "b1", name: "B1" }] });
		const text = fs.readFileSync(modelsPath, "utf8");
		expect(text.startsWith("# 手写的头部说明，必须一个字节都不动\n")).toBe(true);
		expect(text).toContain("  alpha:");
		expect(text).toContain("  beta:");
		// One read for the baseline, one for the written file.
		expect(modelsCalls()).toBe(2);
	});

	test("omp 写后读不出：回滚成原文件", async () => {
		stubModels([{ provider: "alpha", id: "a1" }, { provider: "beta", id: "b1" }], { failAfter: 1 });
		await expect(mod.writeProvider("beta", { id: "beta", baseUrl: "https://beta.example/v1", models: [{ id: "b1" }] })).rejects.toThrow("omp 写入后读不出 models.yml");
		expect(fs.readFileSync(modelsPath, "utf8")).toBe(SEEDED);
	});

	test("omp 写后不再列出新供应商：回滚并说清是哪个", async () => {
		stubModels([{ provider: "alpha", id: "a1" }]);
		await expect(mod.writeProvider("beta", { id: "beta", baseUrl: "https://beta.example/v1", models: [{ id: "b1" }] })).rejects.toThrow("omp 写入后不再列出供应商 beta");
		expect(fs.readFileSync(modelsPath, "utf8")).toBe(SEEDED);
	});

	// Measured on the real binary: a provider without apiKey makes omp disable every custom
	// provider and still exit 0, so the reason has to come back in our message.
	test("omp 拒绝这份文件（缺 apiKey）：回滚并转述 omp 的原因", async () => {
		stubModels([{ provider: "alpha", id: "a1" }, { provider: "beta", id: "b1" }], {
			warnAfter: 1,
			warn: 'Provider beta: "apiKey" is required when defining custom models unless auth is "none" or "oauth".',
		});
		const error = await mod.writeProvider("beta", { id: "beta", baseUrl: "https://beta.example/v1", models: [{ id: "b1" }] }).then(() => undefined, (caught: unknown) => caught as Error);
		expect(error?.message).toContain("omp 拒绝写入后的 models.yml");
		expect(error?.message).toContain('Provider beta: "apiKey" is required');
		expect(fs.readFileSync(modelsPath, "utf8")).toBe(SEEDED);
	});

	test("omp 写前就读不出：这条标准对它不存在，写入照常", async () => {
		stubModels([], { fail: true });
		await mod.writeProvider("beta", { id: "beta", baseUrl: "https://beta.example/v1", models: [{ id: "b1" }] });
		expect(fs.readFileSync(modelsPath, "utf8")).toContain("  beta:");
	});
});

describe("removeProvider 的 omp 回读校验", () => {
	test("omp 移除后仍列出该供应商：回滚成原文件", async () => {
		stubModels([{ provider: "alpha", id: "a1" }]);
		await expect(mod.removeProvider("alpha")).rejects.toThrow("omp 写入后仍列出供应商 alpha");
		expect(fs.readFileSync(modelsPath, "utf8")).toBe(SEEDED);
	});

	test("omp 不再列出它，其它供应商还在：删除生效", async () => {
		stubModels([{ provider: "alpha", id: "a1" }, { provider: "beta", id: "b1" }]);
		await mod.writeProvider("beta", { id: "beta", baseUrl: "https://beta.example/v1", models: [{ id: "b1" }] });
		stubModels([{ provider: "alpha", id: "a1" }]);
		await mod.removeProvider("beta");
		const text = fs.readFileSync(modelsPath, "utf8");
		expect(text).toContain("  alpha:");
		expect(text).not.toContain("  beta:");
	});
});
