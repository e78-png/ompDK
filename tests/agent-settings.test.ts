/**
 * agent-settings against the stub omp binary. The stub answers `config list|set` but
 * not `models --json`, which is exactly the case that matters: the model list only
 * decides the 已失效 flag, so a missing or failing list must not slow the page down,
 * raise a false alarm, or turn the read into a 500.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeStubBin } from "./fixtures/stub-bin.ts";
import { removeTempDir } from "./fixtures/cleanup.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-agent-${process.pid}-${Date.now()}`));
const configFile = path.join(dir, "config.json");
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
const previous = { bin: process.env.OMP_WEB_OMP_BIN, agent: process.env.OMP_WEB_AGENT_DIR, cfg: process.env.STUB_CONFIG_FILE };

let mod: typeof import("../server/agent-settings.ts");
let cfg: typeof import("../server/omp-config.ts");

function seed(roles: Record<string, string>): void {
	fs.writeFileSync(configFile, JSON.stringify({ modelRoles: { value: roles, type: "record", description: "" } }));
	cfg.invalidateSettings();
}

function stored(): Record<string, unknown> {
	return (JSON.parse(fs.readFileSync(configFile, "utf8")) as { modelRoles: { value: Record<string, unknown> } }).modelRoles.value;
}

beforeAll(async () => {
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = path.join(dir, "agent");
	process.env.STUB_CONFIG_FILE = configFile;
	// bun shares one module registry across test files; pin config explicitly.
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = path.join(dir, "agent");
	mod = await import("../server/agent-settings.ts");
	cfg = await import("../server/omp-config.ts");
	seed({ default: "ghost/nope", tiny: "b/two:low" });
});

afterAll(() => {
	if (previous.bin === undefined) delete process.env.OMP_WEB_OMP_BIN;
	else process.env.OMP_WEB_OMP_BIN = previous.bin;
	if (previous.agent === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previous.agent;
	if (previous.cfg === undefined) delete process.env.STUB_CONFIG_FILE;
	else process.env.STUB_CONFIG_FILE = previous.cfg;
	// The read cache is module-global and lives 30s: leave it standing and the next file
	// that shares this module reads this file's stub config as if it were its own.
	cfg.invalidateSettings();
	removeTempDir(dir);
});

describe("readAgentSettings", () => {
	test("读不到模型列表时照常返回，并且不误报已失效", async () => {
		const s = await mod.readAgentSettings();
		expect(s.roles.default).toMatchObject({ raw: "ghost/nope", provider: "ghost", id: "nope", missing: false });
		expect(s.roles.tiny).toMatchObject({ raw: "b/two:low", level: "low", missing: false });
		expect(s.locked).toBeUndefined();
	});

	test("缺斜杠或空值不会崩，按未设置处理", async () => {
		seed({ default: "noseparator", tiny: "  " });
		const s = await mod.readAgentSettings();
		expect(s.roles.default).toMatchObject({ raw: "noseparator", missing: true });
		expect(s.roles.tiny).toEqual({});
	});
});

describe("setRole", () => {
	test("写一个角色不丢其他角色", async () => {
		seed({ default: "ghost/nope", tiny: "b/two:low" });
		const s = await mod.setRole("default", "a/one:high");
		expect(s.roles.default).toMatchObject({ raw: "a/one:high", level: "high", missing: false });
		expect(stored()).toEqual({ default: "a/one:high", tiny: "b/two:low" });
	});

	test("值写成 null 就是删掉这个角色", async () => {
		const s = await mod.setRole("tiny", null);
		expect(s.roles.tiny).toEqual({});
		expect(stored()).toEqual({ default: "a/one:high" });
	});

	test("格式不对的值直接 400，不落盘", async () => {
		const before = fs.readFileSync(configFile, "utf8");
		const err = await mod.setRole("default", "not-a-selector").then(() => undefined, (e: unknown) => e);
		expect((err as { status?: number }).status).toBe(400);
		expect(fs.readFileSync(configFile, "utf8")).toBe(before);
	});
});
