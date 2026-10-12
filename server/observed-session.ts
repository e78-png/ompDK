/** Read-only view of a CLI-owned session. Never starts OMP or writes its profile. */
import type { ServerMsg, SessionState } from "../shared/api.ts";
import { type Lang, msg } from "./messages.ts";
import { PersistedSubagents } from "./omp/persisted-subagents.ts";
import { TranscriptReader } from "./omp/transcript.ts";
import type { Socket } from "./session-hub.ts";

export class ObservedSession {
	readonly sockets = new Set<Socket>();
	readonly subagents = new PersistedSubagents();
	#reader = new TranscriptReader();
	#timer?: ReturnType<typeof setTimeout>;
	#closed = false;
	#signature = "";
	#snapshot?: ServerMsg;

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
				console.error(`[observe] 读取会话失败：${(error as Error).message}`);
			}).finally(() => {
				if (!this.#closed) this.#schedule();
			});
		}, 1500);
	}

	async #refresh(): Promise<void> {
		const history = await this.#reader.read(this.key);
		let alive = this.ownerPid !== undefined;
		try { if (this.ownerPid !== undefined) process.kill(this.ownerPid, 0); } catch { alive = false; }
		const subagents = await this.subagents.list(this.key, history.messages, alive);
		const header = history.entries.find(e => e.type === "session");
		const slot = history.entries.find(e => e.type === "title");
		const state: SessionState = { cwd: this.cwd, sessionFile: this.key, sessionId: header?.id, sessionName: String(slot?.title ?? header?.title ?? ""), isStreaming: false, isCompacting: false, messageCount: history.messages.length, readOnly: true, externalOwnerPid: alive ? this.ownerPid : undefined };
		const signature = JSON.stringify([history.stamp, state, subagents]);
		if (signature === this.#signature) return;
		this.#signature = signature;
		this.#snapshot = { t: "snapshot", key: this.key, state, messages: history.messages, inflight: [], pendingUi: [], commands: [], subagents };
		if (this.#closed) return;
		const text = JSON.stringify(this.#snapshot);
		for (const ws of this.sockets) ws.send(text);
	}
}
