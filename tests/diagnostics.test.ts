/**
 * 行程診斷：把行程表翻成頁面要顯示的樣子。
 *
 * 為什麼要有這個測試：使用者看到「這個 session 被另一個行程寫著」時，唯一的
 * 線索就是這一頁。如果它把持有者漏掉、把孤兒排在前面、或者把別人閘道器的行程
 * 說成自己的，使用者就找不到該結束哪一個行程——這一頁存在的意義就沒了。
 */
import { describe, expect, test } from "bun:test";
import { describeOmpProcesses } from "../server/diagnostics.ts";
import type { OmpProcessTable } from "../server/orphans.ts";

const SELF = 100;

function table(processes: { pid: number; parent: number; commandLine: string }[], live: number[]): OmpProcessTable {
	return { processes, live: new Set(live) };
}

describe("行程診斷", () => {
	test("沒有行程時回空陣列", () => {
		expect(describeOmpProcesses(table([], []), SELF)).toEqual([]);
	});

	test("本閘道器的行程排在最上面", () => {
		const rows = describeOmpProcesses(
			table(
				[
					{ pid: 3, parent: 9, commandLine: '"omp.exe" --resume C:\\a.jsonl' },
					{ pid: 4, parent: SELF, commandLine: '"omp.exe" --mode rpc-ui --resume C:\\b.jsonl' },
				],
				[9, SELF],
			),
			SELF,
		);
		expect(rows[0].pid).toBe(4);
		expect(rows[0].ownedByGateway).toBe(true);
	});

	test("父行程已經沒了就是孤兒", () => {
		const rows = describeOmpProcesses(table([{ pid: 7, parent: 8, commandLine: '"omp.exe" --resume C:\\c.jsonl' }], []), SELF);
		expect(rows[0].parentAlive).toBe(false);
		expect(rows[0].ownedByGateway).toBe(false);
	});

	test("命令列裡的 --resume 路徑被解析出來", () => {
		const rows = describeOmpProcesses(table([{ pid: 5, parent: SELF, commandLine: '"omp.exe" --mode rpc-ui --resume C:\\work\\s.jsonl' }], [SELF]), SELF);
		expect(rows[0].session).toBe("C:\\work\\s.jsonl");
	});

	test("沒有 --resume 的行程就沒有 session", () => {
		const rows = describeOmpProcesses(table([{ pid: 6, parent: SELF, commandLine: '"omp.exe"' }], [SELF]), SELF);
		expect(rows[0].session).toBeUndefined();
	});

	test("命令列原樣帶回來，讓使用者自己對照", () => {
		const commandLine = '"omp.exe" --mode rpc-ui --resume "C:\\work dir\\s.jsonl"';
		const rows = describeOmpProcesses(table([{ pid: 8, parent: SELF, commandLine }], [SELF]), SELF);
		expect(rows[0].commandLine).toBe(commandLine);
	});
});
