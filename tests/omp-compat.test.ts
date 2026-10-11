/**
 * The startup verdict, against the stub binary.
 *
 * The stub answers the handshake but has never heard of `--version`, which is exactly the
 * case worth pinning: an omp this app cannot even name must come back `broken`, not
 * quietly degrade, because every later step of the check would otherwise look fine.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkOmp, parseVersion } from "../server/omp/compat.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-compat-"));
const cmdFile = path.join(dir, "omp.cmd");
const agentDir = path.join(dir, "agent");
const previous = { bin: process.env.OMP_WEB_OMP_BIN, agent: process.env.OMP_WEB_AGENT_DIR, cfg: process.env.STUB_CONFIG_FILE };

beforeAll(async () => {
	fs.mkdirSync(agentDir, { recursive: true });
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	fs.writeFileSync(cmdFile, `@bun "${stub}" %*\r\n`);
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = agentDir;
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = agentDir;
	config.dataDir = dir;
});

afterAll(async () => {
	if (previous.bin === undefined) delete process.env.OMP_WEB_OMP_BIN;
	else process.env.OMP_WEB_OMP_BIN = previous.bin;
	if (previous.agent === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previous.agent;
	if (previous.cfg === undefined) delete process.env.STUB_CONFIG_FILE;
	else process.env.STUB_CONFIG_FILE = previous.cfg;
	for (let i = 0; i < 40; i++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			await Bun.sleep(50);
		}
	}
});

describe("启动自检", () => {
	test("版本号解析：omp/18.8.6 与带后缀的预发布", () => {
		expect(parseVersion("omp/18.8.6\n")).toBe("18.8.6");
		expect(parseVersion("omp/19.0.0-beta.2")).toBe("19.0.0-beta.2");
		expect(parseVersion("")).toBeUndefined();
		expect(parseVersion("no numbers here")).toBeUndefined();
	});

	test("读不出版本时判定为 broken，即使握手全部成功", async () => {
		const result = await checkOmp(8_000);
		expect(result.compat).toBe("broken");
		expect(result.version).toBeNull();
		expect(result.problems.join(" ")).toContain("版本");
		// The stub does answer the handshake, so the capabilities still reach the UI.
		expect(result.capabilities?.deltaUpdates).toBe(true);
	}, 30_000);
});
