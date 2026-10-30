/** Read-only view of a CLI-owned session. Never starts OMP or writes its profile. */
import type { AgentMessage, ServerMsg, SessionState } from "../shared/api.ts";
import { HISTORY_PAGE, HISTORY_WINDOW } from "./history-window.ts";
import { type Lang, msg } from "./messages.ts";
import { PersistedSubagents } from "./omp/persisted-subagents.ts";
import { TranscriptReader } from "./omp/transcript.ts";
import { sessionLeaseOccupied } from "./omp/session-owner.ts";
import type { Socket } from "./session-hub.ts";

export class ObservedSession {
	readonly sockets = new Set<Socket>();
	readonly subagents = new PersistedSubagents();
	#reader = new TranscriptReader();
	#timer?: ReturnType<typeof setTimeout>;
	#closed = false;
	#signature = "";
	#snapshot?: ServerMsg;
	/** The whole transcript, kept so `history_page` can serve what the snapshot left out. */
	#messages: AgentMessage[] = [];
	#leaseCheckedAt = 0;
	#leaseAlive = false;

	constructor(readonly key: string, readonly cwd: string, readonly ownerPid: number | undefined, private readonly onEmpty: () => void) {}

	async attach(ws: Socket): Promise<void> {
		this.sockets.add(ws);
		try {
			const signature = this.#signature;
			await this.#refresh();
			if (this.#snapshot && signature === this.#signature && this.sockets.has(ws)) ws.send(JSON.stringify(this.#snapshot));
			if (!this.#timer && !this.#closed) this.#schedule();
		} catch (error) {
			this.detach(ws);
			throw error;
		}
	}

	detach(ws: Socket): void {
		this.sockets.delete(ws);
		if (this.sockets.size === 0) {
			this.close();
			this.onEmpty();
		}
	}

	close(): void {
		this.#closed = true;
		clearTimeout(this.#timer);
	}

	async command(cmd: Record<string, unknown>, lang: Lang = "zh"): Promise<unknown> {
		if (cmd.type === "get_subagent_messages") return this.subagents.transcript(String(cmd.subagentId ?? ""), cmd.fromByte);
		throw new Error(msg(lang, ["这个会话正在只读查看，请在 CLI 中操作或退出 CLI 后重新连接", "This session is open read-only; use it from the CLI, or quit the CLI and reconnect"]));
	}

	#schedule(): void {
		this.#timer = setTimeout(() => {
			void this.#refresh().catch(error => {
				console.error(`[observe] 讀取會話失敗：${(error as Error).message}`);
			}).finally(() => {
				if (!this.#closed) this.#schedule();
			});
		}, 1500);
	}

	async #refresh(): Promise<void> {
		const history = await this.#reader.read(this.key);
		if (this.ownerPid === undefined && Date.now() - this.#leaseCheckedAt >= 5000) {
			this.#leaseAlive = (await sessionLeaseOccupied(this.key)) === true;
			this.#leaseCheckedAt = Date.now();
		}
		let alive = this.ownerPid !== undefined || this.#leaseAlive;
		try { if (this.ownerPid !== undefined) process.kill(this.ownerPid, 0); } catch { alive = false; }
		const subagents = await this.subagents.list(this.key, history.messages, alive);
		const header = history.entries.find(e => e.type === "session");
		const slot = history.entries.find(e => e.type === "title");
		// 模型在 session 檔裡有記錄（`model_change`），唯讀模式不會起 omp 行程，
		// 所以從檔案裡讀回來——不然狀態列只能顯示「未知」，等於沒有這條資訊。
		const modelChange = history.entries.findLast(e => e.type === "model_change");
		const modelName = typeof modelChange?.model === "string" ? modelChange.model : undefined;
		const [modelProvider, modelId] = modelName?.split("/") ?? [];
		const state: SessionState = {
			cwd: this.cwd,
			sessionFile: this.key,
			sessionId: header?.id,
			sessionName: String(slot?.title ?? header?.title ?? ""),
			// 只放有 provider/id 的那一筆：部分名稱沒有斜線（例如本地模型），
			// 那種就當成沒記錄，狀態列照舊顯示「未知」而不是顯示半截的名稱。
			model: modelProvider && modelId ? { provider: modelProvider, id: modelId } : undefined,
			isStreaming: false,
			isCompacting: false,
			messageCount: history.messages.length,
			readOnly: true,
			externalOwnerPid: alive ? this.ownerPid : undefined,
		};
		const signature = JSON.stringify([history.stamp, state, subagents]);
		if (signature === this.#signature) return;
		this.#signature = signature;
		this.#messages = history.messages;
		const total = history.messages.length;
		const offset = Math.max(0, total - HISTORY_WINDOW);
		// Only the tail goes out. A 57 MB session is 21,198 messages: sending all of it
		// every time the file changes makes the browser parse 55 MB per change.
		this.#snapshot = { t: "snapshot", key: this.key, state, messages: offset === 0 ? history.messages : history.messages.slice(offset), inflight: [], pendingUi: [], commands: [], subagents, history: { offset, total } };
		if (this.#closed) return;
		const text = JSON.stringify(this.#snapshot);
		for (const ws of this.sockets) ws.send(text);
	}

	/** One page of older messages, for a client that holds only the tail of the transcript. */
	historyPage(before: number, limit = HISTORY_PAGE): ServerMsg {
		const messages = this.#messages;
		const total = messages.length;
		const end = Math.min(Math.max(0, Math.trunc(before)), total);
		const start = Math.max(0, end - Math.min(Math.max(1, Math.trunc(limit)), HISTORY_PAGE * 4));
		return { t: "history_page", key: this.key, messages: messages.slice(start, end), offset: start, total };
	}
}
