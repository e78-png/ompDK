/**
 * The MCP panel's backend: the parser for omp's `/mcp list` table, and the round trip
 * through a stub omp that answers the same way the real one does.
 *
 * 為什麼不啟動真的 omp：真的那一行會把使用者機器上所有 MCP server 拉起來，而且
 * 讀的是真的設定檔。測試要的是「omp 印出這種表格時我們解析得對」，所以用一個只
 * 印固定 JSONL 的假身——它跑在本機、沒有網路、也不碰真的 profile。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config } from "../server/config.ts";
import { listMcpServers, parseMcpList } from "../server/omp/mcp.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-mcp-${process.pid}-${Date.now()}`));
const agentDir = path.join(dir, "agent");
const cmdFile = path.join(dir, "omp.cmd");
const previous = { bin: process.env.OMP_WEB_OMP_BIN, agent: process.env.OMP_WEB_AGENT_DIR };

/** omp 真的會印出來的那張表（2026-10-29，omp 18.13.3）。 */
const REAL_OUTPUT = [
	"unity | stdio | enabled | C:\\Users\\e7896\\AppData\\Local\\Unity\\bin\\unity.exe [user]",
	"openviking | http | disabled | http://127.0.0.1:1933/mcp [user]",
	"wzimg | stdio | enabled | C:\\MUWORK\\app\\scoop\\apps\\dotnet-sdk\\10.0.401\\dotnet.exe [user]",
	"hermes | stdio | enabled | C:\\Users\\e7896\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe [user]",
].join("\n");

beforeAll(() => {
	fs.mkdirSync(agentDir, { recursive: true });
	const stub = path.resolve(import.meta.dir, "fixtures/omp-mcp-stub.ts");
	fs.writeFileSync(cmdFile, `@bun "${stub}" %*\r\n`);

	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = agentDir;

	// bun shares one module registry across test files; pin config explicitly.
	config.ompBin = cmdFile;
	config.agentDir = agentDir;
});

afterAll(() => {
	if (previous.bin === undefined) delete process.env.OMP_WEB_OMP_BIN;
	else process.env.OMP_WEB_OMP_BIN = previous.bin;
	if (previous.agent === undefined) delete process.env.OMP_WEB_AGENT_DIR;
	else process.env.OMP_WEB_AGENT_DIR = previous.agent;
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("parseMcpList", () => {
	test("真的輸出解析成每個 server 的欄位", () => {
		const result = parseMcpList(REAL_OUTPUT);
		expect(result.servers).toHaveLength(4);
		expect(result.servers[0]).toEqual({
			name: "unity",
			transport: "stdio",
			enabled: true,
			endpoint: "C:\\Users\\e7896\\AppData\\Local\\Unity\\bin\\unity.exe",
			source: "user",
		});
		expect(result.servers[1]).toEqual({
			name: "openviking",
			transport: "http",
			enabled: false,
			endpoint: "http://127.0.0.1:1933/mcp",
			source: "user",
		});
		expect(result.unparsed).toEqual([]);
		expect(result.raw).toBe(REAL_OUTPUT);
	});

	test("每個 server 都對到自己的那一行", () => {
		const result = parseMcpList(REAL_OUTPUT);
		expect(result.servers.map(s => s.name)).toEqual(["unity", "openviking", "wzimg", "hermes"]);
		expect(result.servers.map(s => s.transport)).toEqual(["stdio", "http", "stdio", "stdio"]);
		expect(result.servers.map(s => s.enabled)).toEqual([true, false, true, true]);
	});

	test("端點含空白時，來源標記還是切得開", () => {
		const result = parseMcpList("my server | stdio | enabled | C:\\Program Files\\My App\\server.exe [user]");
		expect(result.servers).toHaveLength(1);
		expect(result.servers[0].endpoint).toBe("C:\\Program Files\\My App\\server.exe");
		expect(result.servers[0].source).toBe("user");
		expect(result.servers[0].name).toBe("my server");
	});

	test("欄位數不對的行進 unparsed，不丟例外", () => {
		const result = parseMcpList("unity | stdio | enabled\nbroken | line");
		expect(result.servers).toEqual([]);
		expect(result.unparsed).toEqual(["unity | stdio | enabled", "broken | line"]);
	});

	test("欄位中有空白的行進 unparsed", () => {
		const result = parseMcpList("unity |  | enabled | cmd.exe [user]");
		expect(result.servers).toEqual([]);
		expect(result.unparsed).toEqual(["unity |  | enabled | cmd.exe [user]"]);
	});

	test("空的輸出回空清單", () => {
		const result = parseMcpList("");
		expect(result.servers).toEqual([]);
		expect(result.unparsed).toEqual([]);
		expect(result.raw).toBe("");
	});

	test("認不出的狀態當成啟用，但那一行仍留在 unparsed", () => {
		const result = parseMcpList("unity | stdio | unknown | cmd.exe [user]");
		expect(result.servers).toHaveLength(1);
		expect(result.servers[0].enabled).toBe(true);
		expect(result.unparsed).toEqual(["unity | stdio | unknown | cmd.exe [user]"]);
	});

	test("沒有來源標記時，來源是空字串", () => {
		const result = parseMcpList("unity | stdio | enabled | cmd.exe");
		expect(result.servers).toHaveLength(1);
		expect(result.servers[0].source).toBe("");
		expect(result.servers[0].endpoint).toBe("cmd.exe");
	});
});

describe("listMcpServers", () => {
	test("問一次 stub omp，拿回解析好的清單", async () => {
		process.env.STUB_MCP_TEXT = REAL_OUTPUT;
		const result = await listMcpServers();
		expect(result.servers.map(s => s.name)).toEqual(["unity", "openviking", "wzimg", "hermes"]);
		expect(result.servers[1].enabled).toBe(false);
		expect(result.unparsed).toEqual([]);
		delete process.env.STUB_MCP_TEXT;
	});

	test("stub 失敗時，錯誤帶著原因", async () => {
		process.env.STUB_MCP_EXIT = "3";
		await expect(listMcpServers()).rejects.toThrow(/stub: refusing the command/);
		delete process.env.STUB_MCP_EXIT;
	});
});
