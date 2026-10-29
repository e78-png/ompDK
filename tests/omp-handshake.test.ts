/**
 * The handshake, against the stub omp.
 *
 * What is being proved is the tolerance, not the numbers: a build that answers
 * `Unknown command` to one of the optional calls must lose exactly that capability and
 * still open the session, because every feature here has a fallback the app can render.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { OmpCapabilities } from "../shared/api.ts";
import { OmpProcess } from "../server/omp-process.ts";
import { capabilities } from "../server/omp/capabilities.ts";
import { writeStubBin } from "./fixtures/stub-bin.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-handshake-"));
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-stub.ts"));
const agentDir = path.join(dir, "agent");
const previous = { bin: process.env.OMP_WEB_OMP_BIN, agent: process.env.OMP_WEB_AGENT_DIR, cfg: process.env.STUB_CONFIG_FILE };

/** A process whose handshake omp has not been told about; the caller stops it. */
function start(): OmpProcess {
	return new OmpProcess({ cwd: dir, onFrame: () => undefined, onExit: () => undefined });
}

beforeAll(async () => {
	fs.mkdirSync(agentDir, { recursive: true });
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = agentDir;
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	// bun shares one module registry across test files; pin the singleton explicitly.
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = agentDir;
	config.dataDir = dir;
});

afterAll(async () => {
	delete process.env.STUB_FAIL_COMMANDS;
	if (previous.bin === undefined) delete process.env.OMP_WEB_OMP_BIN;
	else process.env.OMP_WEB_OMP_BIN = previous.bin;
	if (previous.agent === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previous.agent;
	if (previous.cfg === undefined) delete process.env.STUB_CONFIG_FILE;
	else process.env.STUB_CONFIG_FILE = previous.cfg;
	// The child holds the directory on Windows until it is really gone.
	for (let i = 0; i < 40; i++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			await Bun.sleep(50);
		}
	}
});

async function negotiateAgainst(refusal: string[]): Promise<OmpCapabilities> {
	if (refusal.length) process.env.STUB_FAIL_COMMANDS = refusal.join(",");
	else delete process.env.STUB_FAIL_COMMANDS;
	const proc = start();
	await proc.ready;
	const found = proc.capabilities;
	await proc.stop(500);
	expect(found).toBeDefined();
	return found!;
}

describe("握手逐项协商", () => {
	test("全部接受时每一项能力都为真，v2 协商成功", async () => {
		const caps = await negotiateAgainst([]);
		expect(caps).toEqual({ protocol: 2, deltaUpdates: true, askDialog: true, subagentProgress: true, messagesPage: true });
	});

	test("子代理订阅失败只关掉那一项，进程照常就绪", async () => {
		const caps = await negotiateAgainst(["set_subagent_subscription"]);
		expect(caps.subagentProgress).toBe(false);
		expect(caps.deltaUpdates).toBe(true);
		expect(caps.askDialog).toBe(true);
		expect(caps.protocol).toBe(2);
	});

	test("被拒绝的功能不会拖垮会话：就绪之后仍能正常收发命令", async () => {
		process.env.STUB_FAIL_COMMANDS = "set_subagent_subscription,set_ask_dialog";
		const proc = start();
		await proc.ready;
		const state = await proc.request({ type: "get_state" });
		await proc.stop(500);
		delete process.env.STUB_FAIL_COMMANDS;
		expect(proc.capabilities?.askDialog).toBe(false);
		expect(state.success).toBe(true);
	});

	test("协议协商被拒绝就停在 1，因为 v2 的分帧并没有真正生效", async () => {
		const caps = await negotiateAgainst(["negotiate_protocol"]);
		expect(caps.protocol).toBe(1);
	});

	test("网关对外发布一份能力表", async () => {
		await negotiateAgainst([]);
		const published = capabilities();
		expect(published).toBeDefined();
		for (const key of ["deltaUpdates", "askDialog", "subagentProgress", "messagesPage"] as const) expect(typeof published![key]).toBe("boolean");
	});
});
