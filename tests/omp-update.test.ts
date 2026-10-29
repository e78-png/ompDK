/**
 * 上游更新機制：輸出怎麼解析、換版失敗怎麼回報。
 *
 * 為什麼用假的 omp：`omp update` 會下載並覆蓋執行檔，`omp update --check` 會連網。
 * 測試兩個都不能做，所以這裡用一個 stub 假裝上游，回傳各種真實可能出現的輸出。
 *
 * 解析器最重要的性質是「寬容」：上游改一句文案不該讓設定頁壞掉。認不出來就回
 * `note`，而不是丟例外。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { checkUpdate, installUpdate, parseUpdateOutput } from "../server/omp/update.ts";
import { writeStubBin } from "./fixtures/stub-bin.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-update-"));
const cmdFile = writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-update-stub.ts"));
const marker = path.join(dir, "updated.marker");
const previous = {
	bin: process.env.OMP_WEB_OMP_BIN,
	agent: process.env.OMP_WEB_AGENT_DIR,
	out: process.env.STUB_UPDATE_OUTPUT,
	code: process.env.STUB_UPDATE_CODE,
	err: process.env.STUB_UPDATE_ERROR,
	version: process.env.STUB_OMP_VERSION,
	newVersion: process.env.STUB_OMP_VERSION_NEW,
	marker: process.env.STUB_UPDATE_MARKER,
};

beforeAll(async () => {
	fs.mkdirSync(path.join(dir, "agent"), { recursive: true });
	const stub = path.resolve(import.meta.dir, "fixtures/omp-update-stub.ts");
	writeStubBin(dir, path.resolve(import.meta.dir, "fixtures/omp-update-stub.ts"));
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = path.join(dir, "agent");
	process.env.STUB_UPDATE_MARKER = marker;
	// 動態匯入：config 在載入時就讀了環境變數，靜態匯入會讀到假的預設值。
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = path.join(dir, "agent");
});

afterAll(async () => {
	const restore = (key: string, value: string | undefined) => {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	};
	restore("OMP_WEB_OMP_BIN", previous.bin);
	restore("OMP_WEB_AGENT_DIR", previous.agent);
	restore("STUB_UPDATE_OUTPUT", previous.out);
	restore("STUB_UPDATE_CODE", previous.code);
	restore("STUB_UPDATE_ERROR", previous.err);
	restore("STUB_OMP_VERSION", previous.version);
	restore("STUB_OMP_VERSION_NEW", previous.newVersion);
	restore("STUB_UPDATE_MARKER", previous.marker);
	for (let i = 0; i < 40; i++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			await Bun.sleep(50);
		}
	}
});

beforeEach(() => {
	delete process.env.STUB_UPDATE_OUTPUT;
	delete process.env.STUB_UPDATE_CODE;
	delete process.env.STUB_UPDATE_ERROR;
	process.env.STUB_OMP_VERSION = "18.13.3";
	delete process.env.STUB_OMP_VERSION_NEW;
	try {
		fs.unlinkSync(marker);
	} catch {
		// 沒有標記就是還沒更新過
	}
});

describe("更新輸出的解析", () => {
	test("有新版：讀出目前版本與最新版本", () => {
		const status = parseUpdateOutput("Current version: 18.12.6\nNew version available: 18.13.3\n");
		expect(status.current).toBe("18.12.6");
		expect(status.latest).toBe("18.13.3");
		expect(status.upToDate).toBe(false);
		expect(status.channel).toBe("stable");
		expect(status.note).toBeUndefined();
	});

	test("沒有新版：上游说已经是最新的", () => {
		const status = parseUpdateOutput("Current version: 18.13.3\n✔ Already up to date\n");
		expect(status.current).toBe("18.13.3");
		expect(status.latest).toBeNull();
		expect(status.upToDate).toBe(true);
	});

	test("canary 通道要从输出里认出来", () => {
		const status = parseUpdateOutput("Current version: 18.14.0-beta.1\nNew version available: 18.14.0-beta.2\nCurrent channel: canary\n");
		expect(status.channel).toBe("canary");
		expect(status.latest).toBe("18.14.0-beta.2");
	});

	test("颜色码不影响解析", () => {
		const status = parseUpdateOutput("\x1b[32mCurrent version: 18.12.6\x1b[0m\n\x1b[32mNew version available: 18.13.3\x1b[0m\n");
		expect(status.current).toBe("18.12.6");
		expect(status.latest).toBe("18.13.3");
	});

	test("输出格式变了：不抛异常，标记为看不懂", () => {
		const status = parseUpdateOutput("upstream changed its wording entirely\n");
		expect(status.latest).toBeNull();
		expect(status.upToDate).toBe(false);
		expect(status.note).toBe("unparsed");
	});

	test("空输出也不抛异常", () => {
		const status = parseUpdateOutput("");
		expect(status.note).toBe("unparsed");
		expect(status.latest).toBeNull();
	});
});

describe("checkUpdate 走真的行程", () => {
	test("有新版时把版本读回来", async () => {
		process.env.STUB_UPDATE_OUTPUT = "Current version: 18.12.6\nNew version available: 18.13.3\n";
		const status = await checkUpdate();
		expect(status.current).toBe("18.12.6");
		expect(status.latest).toBe("18.13.3");
		expect(status.upToDate).toBe(false);
	}, 30_000);

	test("上游失败时不抛异常，标记为读不到", async () => {
		process.env.STUB_UPDATE_CODE = "1";
		process.env.STUB_UPDATE_OUTPUT = "Current version: 18.13.3\n";
		const status = await checkUpdate();
		expect(status.note).toBe("check-failed");
		expect(status.latest).toBeNull();
	}, 30_000);
});

describe("换版失败要说清楚原因", () => {
	test("执行档被占用时回报 locked，不是假装成功", async () => {
		process.env.STUB_UPDATE_CODE = "1";
		process.env.STUB_UPDATE_ERROR = "Update failed: EBUSY: resource busy or locked";
		const result = await installUpdate();
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("locked");
		expect(result.detail).toContain("EBUSY");
	}, 30_000);

	test("换版成功时版本真的变了", async () => {
		process.env.STUB_OMP_VERSION = "18.13.3";
		process.env.STUB_OMP_VERSION_NEW = "18.14.0";
		process.env.STUB_UPDATE_OUTPUT = "Updated to 18.14.0\n";
		const result = await installUpdate();
		expect(result.ok).toBe(true);
		expect(result.version).toBe("18.14.0");
		expect(result.previousVersion).toBe("18.13.3");
	}, 30_000);

	test("指令成功但版本没变：不能算成功", async () => {
		process.env.STUB_OMP_VERSION = "18.13.3";
		process.env.STUB_UPDATE_OUTPUT = "Updated to 18.13.3\n";
		const result = await installUpdate();
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("locked");
	}, 30_000);
});
