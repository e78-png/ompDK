/**
 * plugins.ts against the stub omp binary: the disabled-skill merge (omp hides
 * them), the metadata cache that gives them a description, name-only display for
 * skills never seen before, path-only file reads, and plugin listing/switching.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeStubBin } from "./fixtures/stub-bin.ts";
import { removeTempDir } from "./fixtures/cleanup.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-plugins-${process.pid}-${Date.now()}`));
const agentDir = path.join(dir, "agent");
const dataDir = path.join(dir, "web");
const projectDir = path.join(dir, "project");
const configFile = path.join(dir, "config.json");
const skillsFile = path.join(dir, "skills.json");
const pluginsFile = path.join(dir, "plugins.json");
const pluginLog = path.join(dir, "plugin-calls.log");
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
const previous = { bin: process.env.OMP_WEB_OMP_BIN, agent: process.env.OMP_WEB_AGENT_DIR, cfg: process.env.STUB_CONFIG_FILE };

let mod: typeof import("../server/plugins.ts");
let HttpError: typeof import("../server/http-error.ts")["HttpError"];

function skill(name: string): Record<string, unknown> {
	const file = path.join(projectDir, name, "SKILL.md");
	fs.mkdirSync(path.join(projectDir, name), { recursive: true });
	fs.writeFileSync(file, `# ${name}\n\n${name} 的说明正文。\n`);
	return { name, description: `${name} 的描述`, filePath: file, baseDir: path.join(projectDir, name), source: "agents:user", hide: false };
}

function writeConfig(disabled: string[]): void {
	fs.writeFileSync(configFile, JSON.stringify({ disabledExtensions: { value: disabled, type: "array", description: "" } }));
}

function statusOf(e: unknown): number {
	return (e as { status?: number }).status ?? 0;
}

beforeAll(async () => {
	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(dataDir, { recursive: true });
	fs.mkdirSync(projectDir, { recursive: true });
	writeConfig([]);
	fs.writeFileSync(skillsFile, JSON.stringify([skill("alpha"), skill("beta"), skill("gamma")]));
	fs.writeFileSync(pluginsFile, JSON.stringify({ npm: [{ package: "some-skill", version: "1.2.3" }], marketplace: [{ name: "pack", marketplace: "omp-hub", enabled: true }] }));
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");

	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = agentDir;
	process.env.STUB_CONFIG_FILE = configFile;
	process.env.STUB_SKILLS_FILE = skillsFile;
	process.env.STUB_PLUGINS_FILE = pluginsFile;
	process.env.STUB_PLUGIN_LOG = pluginLog;

	// bun shares one module registry across test files; pin config explicitly.
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = agentDir;
	config.dataDir = dataDir;
	mod = await import("../server/plugins.ts");
	({ HttpError } = await import("../server/http-error.ts"));
});

afterAll(() => {
	if (previous.bin === undefined) delete process.env.OMP_WEB_OMP_BIN;
	else process.env.OMP_WEB_OMP_BIN = previous.bin;
	if (previous.agent === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previous.agent;
	if (previous.cfg === undefined) delete process.env.STUB_CONFIG_FILE;
	else process.env.STUB_CONFIG_FILE = previous.cfg;
	removeTempDir(dir);
});

describe("listSkills", () => {
	test("全部列出时都是启用状态", async () => {
		writeConfig([]);
		fs.rmSync(path.join(dataDir, "skills-seen.json"), { force: true });
		mod.invalidate();
		const skills = await mod.listSkills(projectDir);
		expect(skills.map(s => s.name)).toEqual(["alpha", "beta", "gamma"]);
		expect(skills.every(s => s.enabled)).toBe(true);
	});

	test("停用的技能仍在列表里，且带 enabled: false 和原有元数据", async () => {
		writeConfig([]);
		mod.invalidate();
		await mod.listSkills(projectDir);
		await mod.setSkillEnabled("beta", false);
		const skills = await mod.listSkills(projectDir);
		expect(skills.map(s => s.name)).toEqual(["alpha", "beta", "gamma"]);
		const beta = skills.find(s => s.name === "beta");
		expect(beta?.enabled).toBe(false);
		expect(beta?.description).toBe("beta 的描述");
		expect(beta?.filePath).toContain(path.join("project", "beta", "SKILL.md"));
		await mod.setSkillEnabled("beta", true);
	});

	test("缓存里没有的停用技能只显示名称", async () => {
		writeConfig(["skill:ghost"]);
		fs.rmSync(path.join(dataDir, "skills-seen.json"), { force: true });
		mod.invalidate();
		const ghost = (await mod.listSkills(projectDir)).find(s => s.name === "ghost");
		expect(ghost?.enabled).toBe(false);
		expect(ghost?.description).toContain("无详细信息");
		expect(ghost?.filePath).toBeUndefined();
		writeConfig([]);
		mod.invalidate();
	});
});

describe("readSkillFile", () => {
	test("已知技能读得到正文", async () => {
		writeConfig([]);
		mod.invalidate();
		const text = await mod.readSkillFile("alpha", projectDir);
		expect(text).toContain("alpha 的说明正文");
	});

	test("未知技能名被拒，不接受前端传的路径", async () => {
		// Path-shaped names fail the name validator, so the client never reaches the path at all.
		const e = await mod.readSkillFile("../../etc/passwd", projectDir).then(() => undefined, (err: unknown) => err);
		expect(e).toBeInstanceOf(HttpError);
		expect(statusOf(e)).toBe(400);
		const e2 = await mod.readSkillFile("never-seen", projectDir).then(() => undefined, (err: unknown) => err);
		expect(statusOf(e2)).toBe(404);
	});
});

describe("listPlugins / setPluginEnabled", () => {
	test("两组插件都带规范化的 id/name/kind", async () => {
		mod.invalidate();
		const { npm, marketplace } = await mod.listPlugins();
		expect(npm[0]?.name).toBe("some-skill");
		expect(npm[0]?.kind).toBe("npm");
		expect(marketplace[0]?.id).toBe("pack@omp-hub");
		expect(marketplace[0]?.kind).toBe("marketplace");
	});

	test("enable/disable 转给 omp，失败转成 400", async () => {
		fs.rmSync(pluginLog, { force: true });
		await mod.setPluginEnabled("pack@omp-hub", false);
		expect(fs.readFileSync(pluginLog, "utf8")).toBe("disable pack@omp-hub\n");
		const e = await mod.setPluginEnabled("boom", true).then(() => undefined, (err: unknown) => err);
		expect(e).toBeInstanceOf(HttpError);
		expect(statusOf(e)).toBe(400);
		const bad = await mod.setPluginEnabled("bad id;rm -rf", true).then(() => undefined, (err: unknown) => err);
		expect(statusOf(bad)).toBe(400);
	});
});
