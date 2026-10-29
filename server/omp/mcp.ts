/**
 * The MCP servers omp actually loaded.
 *
 * 為什麼走 `/mcp list` 而不是讀設定檔：`~/.omp/agent/mcp.json` 只是十幾個來源
 * 其中一個（專案的 `.omp/mcp.json`、Claude Code、Codex、Gemini CLI、Cursor、
 * Windsurf、VS Code、OpenCode、插件套件……），而且同名時會按優先序去重。
 * 設定檔說的是「使用者寫了什麼」，`/mcp list` 說的是「omp 真正載入了什麼」——
 * 這個頁面要的是後者。
 *
 * 為什麼住在 server/omp/：斜線命令的名字、它回報的格式、欄位的意思，都是 omp 的
 * 事；其他地方不該知道（`bun run lint:omp` 會擋）。
 *
 * 為什麼要起一個行程而不是呼叫模型：`/mcp list` 是本機命令，`agentInvoked` 為
 * false，不會動到模型——但它要真的把 MCP server 連起來，所以要花幾秒。
 */
import type { McpListResult, McpServerInfo } from "../../shared/api.ts";
import { ChunkDecoder } from "../omp-process.ts";
import { terminateProcess } from "../orphans.ts";
import { spawnOmpRpc } from "./cli.ts";

export type { McpListResult, McpServerInfo };

/** 一次 `/mcp list` 的期限；超過就算失敗，不讓一個頁面吊著。 */
const LIST_TIMEOUT_MS = 30_000;

/** 拿到答案之後，給 omp 自己收尾的時間；它通常馬上就退出。 */
const STOP_GRACE_MS = 2_000;

/** `/mcp list` 的斜線命令。 */
const LIST_COMMAND = "/mcp list";

/** 這次請求的 id；回應影格靠它對應。 */
const REQUEST_ID = "mcp-list";

/**
 * `command_output` 影格：斜線命令印出來的東西。
 *
 * 名字和 `shared/omp/conventions.ts` 裡的 `CUSTOM_TYPES.commandOutput` 不是同一個
 * 字串——後者是工作階段裡的 `customType`，這個是 RPC 影格的 `type`。
 */
const COMMAND_OUTPUT_FRAME = "command_output";

/** 回應影格：`success: false` 表示命令沒有被執行。 */
const RESPONSE_FRAME = "response";

/**
 * omp 在一個 MCP server 都沒有時印的整句話（omp 18.13.3）。
 *
 * 這是 omp 自己的散文，所以留在 server/omp/。它在這裡的意義是「沒有 server」，
 * 不是一列看不懂的資料——所以它不進 `unparsed`，免得空清單還帶著一個警告。
 */
const NO_SERVERS = "No MCP servers configured.";

/**
 * 切掉最後一組方括號，取出來源標記。
 *
 * 端點本身可能含空白（路徑有空格），也可能含方括號；所以來源標記取的是「最後
 * 一組方括號」，它前面全部當端點。
 */
function splitSource(rest: string): { endpoint: string; source: string } {
	let last: RegExpExecArray | null = null;
	for (const match of rest.matchAll(/\[([^[\]]*)\]/g)) last = match;
	if (!last) return { endpoint: rest.trim(), source: "" };
	return { endpoint: rest.slice(0, last.index).trim(), source: last[1].trim() };
}

/**
 * 把 `/mcp list` 的輸出拆成一張表。
 *
 * 每行一個 server：`名稱 | 傳輸型別 | 狀態 | 端點 [來源]`。看不懂的行不丟掉，
 * 收回 `unparsed`，讓使用者看得到原文——格式變了時，這比一片空白有用。
 */
export function parseMcpList(text: string): McpListResult {
	const servers: McpServerInfo[] = [];
	const unparsed: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (line === NO_SERVERS) continue;
		const parts = line.split("|").map(part => part.trim());
		if (parts.length !== 4 || parts.some(part => !part)) {
			unparsed.push(line);
			continue;
		}
		const [name, transport, status, rest] = parts;
		const { endpoint, source } = splitSource(rest);
		if (!endpoint) {
			unparsed.push(line);
			continue;
		}
		// 狀態認不出來時仍當成啟用，但把這行留下來，讓使用者知道格式變了。
		const known = status === "enabled" || status === "disabled";
		if (!known) unparsed.push(line);
		servers.push({ name, transport, enabled: status !== "disabled", endpoint, source });
	}
	return { servers, raw: text, unparsed };
}

/** 收掉子行程：先關 stdin 讓它自己走，它不走就連同它開的 MCP server 一起收掉。 */
async function stopChild(proc: { stdin: { end(): void }; exited: Promise<number | null>; pid: number }): Promise<void> {
	try {
		proc.stdin.end();
	} catch {
		// already closed
	}
	const exited = await Promise.race([proc.exited.then(() => true), Bun.sleep(STOP_GRACE_MS).then(() => false)]);
	if (exited) return;
	// Bun 的 kill 只殺得到第一層；omp 拉起來的 MCP server 會變成孤兒行程。
	await terminateProcess(proc.pid);
	await proc.exited;
}

/**
 * 問 omp 要它實際載入的 MCP server 清單。
 *
 * 走的路徑和介面上敲 `/mcp list` 完全一樣：一個 `omp --mode rpc` 的行程、送一則
 * 斜線命令、收 `command_output` 影格。差別只在這裡不開介面，而且命令結束後就把
 * 行程收掉——不留孤兒行程，也不在 profile 裡留下工作階段檔。
 */
export async function listMcpServers(cwd?: string): Promise<McpListResult> {
	const proc = spawnOmpRpc(cwd);
	let stderr = "";
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of proc.stderr) stderr += decoder.decode(chunk as Uint8Array, { stream: true });
	})();

	// 問一次 `/mcp list`：一則 prompt 影格，跟在終端機裡敲的一樣。
	proc.stdin.write(`${JSON.stringify({ id: REQUEST_ID, type: "prompt", message: LIST_COMMAND })}\n`);

	// 逾時就直接收掉行程：stdout 隨之收尾，讀取迴圈自然結束。
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		void terminateProcess(proc.pid);
	}, LIST_TIMEOUT_MS);

	let text: string | undefined;
	let failure: string | undefined;
	try {
		const decoder = new TextDecoder();
		const chunks = new ChunkDecoder();
		let buffer = "";
		for await (const chunk of proc.stdout) {
			buffer += decoder.decode(chunk as Uint8Array, { stream: true });
			let nl = buffer.indexOf("\n");
			while (nl >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				nl = buffer.indexOf("\n");
				if (!line) continue;
				let frame: Record<string, unknown> | undefined;
				try {
					frame = chunks.push(JSON.parse(line) as Record<string, unknown> & { type: string });
				} catch {
					continue;
				}
				if (!frame) continue;
				if (frame.type === COMMAND_OUTPUT_FRAME && typeof frame.text === "string") {
					text = frame.text;
				} else if (frame.type === RESPONSE_FRAME && frame.success === false) {
					failure = String(frame.error ?? "the command failed");
				}
				if (text !== undefined || failure !== undefined) break;
			}
			if (text !== undefined || failure !== undefined) break;
		}
	} finally {
		clearTimeout(timer);
		await stopChild(proc);
	}

	if (text === undefined) {
		const reason = timedOut ? `no answer within ${LIST_TIMEOUT_MS / 1000}s` : (failure ?? "omp closed the connection before answering");
		// omp 把原因放在 stderr 的第一行（後面是它建議的下一步），所以取第一行。
		const detail = stderr.trim().split("\n").map(line => line.trim()).filter(Boolean)[0];
		throw new Error(detail ? `${reason}: ${detail}` : reason);
	}
	return parseMcpList(text);
}
