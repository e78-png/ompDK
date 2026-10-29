/**
 * 韌性：單一 session 的問題不該升級成全域 outage。
 *
 * 為什麼要有這個測試：gateway 裡有十幾處 fire-and-forget 的 promise，
 * 而 Bun 對未處理的 rejection 會**直接結束整個 process**——連 Bun.serve 一起死，
 * 所有分頁斷線、所有 omp 子行程變成孤兒（還在跑、還持有使用者真實的 session 檔）。
 *
 * 這裡守住三件事：
 * 1. 沒有任何一處 fire-and-forget 會把錯誤送出去。
 * 2. frame 的形狀變了（上游一天一版）時，壞掉的是「那一則 frame」，不是整條連線。
 * 3. subagent 的 payload 沒有欄位時不會拋錯。
 */
import { describe, expect, test } from "bun:test";
import { applySubagentLifecycle, applySubagentProgress } from "../shared/subagents.ts";
import { installResilienceHandlers, reportUnhandled } from "../server/resilience.ts";
import type { SubagentSnapshot } from "../shared/api.ts";

describe("subagent 的 frame 形狀變了也不會拋錯", () => {
	test("payload 是 undefined 時安靜地跳過", () => {
		const all = new Map<string, SubagentSnapshot>();
		expect(() => applySubagentLifecycle(all, undefined as never)).not.toThrow();
		expect(() => applySubagentProgress(all, undefined as never)).not.toThrow();
		expect(all.size).toBe(0);
	});

	test("payload 沒有 id 時不建立任何東西", () => {
		const all = new Map<string, SubagentSnapshot>();
		applySubagentLifecycle(all, {} as never);
		applySubagentProgress(all, { progress: {} } as never);
		expect(all.size).toBe(0);
	});

	test("正常的 payload 還是會建立", () => {
		const all = new Map<string, SubagentSnapshot>();
		applySubagentLifecycle(all, { id: "sub-1", status: "running" } as never);
		expect(all.get("sub-1")?.id).toBe("sub-1");
	});
});

describe("gateway 對未處理的 rejection 的處理", () => {
	test("安裝之後 process 有掛 unhandledRejection 的守門人", () => {
		// 這個 handler 是「單一 session 的問題不會升級成全域 outage」的最後一道防線。
		// 少了它，Bun 會直接結束整個 process（實測：連計時器都不會再跑）。
		const before = process.listeners("unhandledRejection").length;
		installResilienceHandlers();
		expect(process.listeners("unhandledRejection").length).toBe(before + 1);
	});

	test("守門人本身不會再拋錯", () => {
		// 守門人被丟一個奇怪的 rejection 也不能死——那正是它存在的理由。
		expect(() => reportUnhandled(undefined)).not.toThrow();
		expect(() => reportUnhandled(new Error("boom"))).not.toThrow();
		expect(() => reportUnhandled({ weird: true })).not.toThrow();
	});
});
