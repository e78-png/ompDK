/**
 * 行程診斷：這台機器上正在跑哪些 omp 行程、各自開著哪一個 session 檔。
 *
 * 為什麼需要這一頁：使用者看到「某個 session 被另一個 OMP 行程寫著」時，手上只有
 * 「被佔著」這件事，沒有「是誰」。租約知道檔案被別人佔著，行程表卻對不到持有者——
 * 互動式的 omp 命令列上沒有檔案路徑，它寫的是自己剛開的那一個 session。把行程全部
 * 列出來，使用者就能自己對照哪一個行程才是那個持有者。
 *
 * 這裡只回報，不動手：使用者要自己決定該結束哪一個行程，閘道器不替他選。
 */
import type { OmpProcessInfo } from "../shared/diagnostics.ts";
import { type OmpProcessTable, readOmpProcessTable, resumedFile } from "./orphans.ts";

export type { OmpProcessInfo };

/**
 * 把一張行程表翻成這頁要顯示的樣子。
 *
 * 行程表是參數而不是自己去讀，所以測試不必真的掃一次行程。
 */
export function describeOmpProcesses(table: OmpProcessTable, self: number): OmpProcessInfo[] {
	const rows: OmpProcessInfo[] = [];
	for (const proc of table.processes) {
		rows.push({
			pid: proc.pid,
			parent: proc.parent,
			commandLine: proc.commandLine,
			session: resumedFile(proc.commandLine),
			ownedByGateway: proc.parent === self,
			parentAlive: table.live.has(proc.parent),
		});
	}
	// 閘道器自己的行程最上面（使用者預期看到的是那些），再來是父行程還活著的，
	// 最後 pid 由小到大——孤兒行程落在最後，因為那才是要處理的情況。
	rows.sort((a, b) => Number(b.ownedByGateway) - Number(a.ownedByGateway) || Number(b.parentAlive) - Number(a.parentAlive) || a.pid - b.pid);
	return rows;
}

/** 這台機器上正在跑的 omp 行程。 */
export async function listOmpProcesses(self: number): Promise<OmpProcessInfo[]> {
	return describeOmpProcesses(await readOmpProcessTable(), self);
}
