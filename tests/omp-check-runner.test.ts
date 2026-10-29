/**
 * 相容性檢查的結果結構：計數怎麼算、哪一種警告是「版本號」哪一种是「能力」。
 *
 * 為什麼分成兩塊測：`summarizeCheck()` 是純函式，把檢查項目整理成結果；這裡用
 * 構造出來的項目餵它，於是「版本號警告」與「能力警告」分得開這件事不需要真的
 * 起行程就能驗證。而 `runCompatCheck()` 對著 stub 跑一次，驗證它真的回傳這個
 * 結構（項目、計數、版本）而不是別的形狀。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CompatCheckItem } from "../shared/api.ts";
import { runCompatCheck, summarizeCheck } from "../server/omp/check.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-check-runner-"));
const cmdFile = path.join(dir, "omp.cmd");
const previous = { bin: process.env.OMP_WEB_OMP_BIN, agent: process.env.OMP_WEB_AGENT_DIR, cfg: process.env.STUB_CONFIG_FILE };

beforeAll(async () => {
	fs.mkdirSync(path.join(dir, "agent"), { recursive: true });
	const stub = path.resolve(import.meta.dir, "fixtures/omp-stub.ts");
	fs.writeFileSync(cmdFile, `@bun "${stub}" %*\r\n`);
	process.env.OMP_WEB_OMP_BIN = cmdFile;
	process.env.OMP_WEB_AGENT_DIR = path.join(dir, "agent");
	process.env.STUB_CONFIG_FILE = path.join(dir, "config.json");
	// 動態匯入：config 在載入時就讀了環境變數，靜態匯入會讀到假的預設值。
	const { config } = await import("../server/config.ts");
	config.ompBin = cmdFile;
	config.agentDir = path.join(dir, "agent");
	config.dataDir = dir;
});

afterAll(async () => {
	const restore = (key: string, value: string | undefined) => {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	};
	restore("OMP_WEB_OMP_BIN", previous.bin);
	restore("OMP_WEB_AGENT_DIR", previous.agent);
	restore("STUB_CONFIG_FILE", previous.cfg);
	for (let i = 0; i < 40; i++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			await Bun.sleep(50);
		}
	}
});

/** 一個項目；預設給一個 ok 的版本項目。 */
function item(over: Partial<CompatCheckItem> = {}): CompatCheckItem {
	return { section: "version", mark: "ok", what: "項目", why: "", ...over };
}

describe("結果的計數", () => {
	test("每一種記號都算進去，通過數是 ok 加 note", () => {
		const result = summarizeCheck(
			[item({ mark: "ok" }), item({ mark: "ok" }), item({ mark: "note" }), item({ mark: "warn" }), item({ mark: "fail" })],
			["version"],
			"18.13.3",
			"18.13.3",
		);
		expect(result.counts).toEqual({ ok: 2, warn: 1, fail: 1, note: 1 });
		expect(result.passed).toBe(3);
		expect(result.warned).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.items).toHaveLength(5);
	});

	test("版本號與已驗證版本相同時不建議改動", () => {
		const result = summarizeCheck([item()], ["version"], "18.13.3", "18.13.3");
		expect(result.suggestedVersion).toBeNull();
		expect(result.versionWarning).toBeNull();
	});

	test("只有版本號不同時，建議新的版本號", () => {
		const warning = item({ mark: "warn", why: "本应用验证过的是别的版本" });
		const result = summarizeCheck([item(), warning], ["version"], "18.14.0", "18.13.3");
		expect(result.suggestedVersion).toBe("18.14.0");
		expect(result.versionWarning).toBe(warning);
		expect(result.capabilityWarnings).toHaveLength(0);
	});

	test("有能力警告时不建议改版本号", () => {
		const versionWarning = item({ section: "version", mark: "warn" });
		const capability = item({ section: "handshake", mark: "warn", what: "增量更新" });
		const result = summarizeCheck([versionWarning, capability], ["version", "handshake"], "18.14.0", "18.13.3");
		expect(result.capabilityWarnings).toEqual([capability]);
		expect(result.versionWarning).toBe(versionWarning);
		expect(result.suggestedVersion).toBeNull();
	});

	test("有失败项时不建议改版本号", () => {
		const result = summarizeCheck([item({ section: "state", mark: "fail" }), item({ section: "version", mark: "warn" })], ["version", "state"], "18.14.0", "18.13.3");
		expect(result.failed).toBe(1);
		expect(result.suggestedVersion).toBeNull();
	});

	test("回传已验证版本，界面才知道该拿哪个当标准", () => {
		const result = summarizeCheck([item()], ["version"], "18.14.0", "18.13.3");
		expect(result.testedVersion).toBe("18.13.3");
		expect(result.version).toBe("18.14.0");
	});
});

describe("runCompatCheck 回传的结构", () => {
	test("对着 stub 跑一次，回传项目、计數与版本", async () => {
		const result = await runCompatCheck();
		expect(Array.isArray(result.items)).toBe(true);
		expect(result.items.length).toBeGreaterThan(0);
		expect(result.sections.length).toBeGreaterThan(0);
		// 每一项的记号都要能被计数。
		const counted = result.items.filter(item => item.mark === "fail").length;
		expect(result.counts.fail).toBe(counted);
		expect(result.failed).toBe(counted);
		expect(result.passed + result.failed + result.warned).toBe(result.items.length);
		// 版本警告与能力警告不能混在一起。
		for (const warning of result.capabilityWarnings) expect(warning.section).not.toBe("version");
		if (result.versionWarning) expect(result.versionWarning.section).toBe("version");
	}, 120_000);
});
