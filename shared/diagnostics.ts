/**
 * 行程診斷的契約：閘道器回報這台機器上正在跑的 omp 行程，瀏覽器照著顯示。
 *
 * 為什麼要有這一份共用的形狀：使用者看到「這個 session 被另一個行程寫著」時，
 * 只知道被佔著，不知道是誰。行程的 pid、父行程、還開著哪個 session 檔，
 * 兩邊都要看得懂同一份資料。
 */
export interface OmpProcessInfo {
	/** 行程 id。 */
	pid: number;
	/** 父行程 id；父行程已經沒了就是孤兒。 */
	parent: number;
	/** 命令列（完整）。 */
	commandLine: string;
	/** 這個行程開著的 session 檔（從命令列的 resume 參數解析）；沒有就是 undefined。 */
	session?: string;
	/** 是不是這個閘道器的子行程。 */
	ownedByGateway: boolean;
	/** 父行程還活著嗎。 */
	parentAlive: boolean;
}

/** `GET /api/diagnostics` 的回應。 */
export interface OmpProcessList {
	/** 這台機器上正在跑的 omp 行程。 */
	processes: OmpProcessInfo[];
}
