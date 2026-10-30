/**
 * Live sessions: one omp process per opened session file, shared by every
 * attached browser tab.
 *
 * Each live session keeps a mirror of settled messages plus the frames of the
 * drafts and tool calls of the current run, so a tab attaching mid-run gets
 * `snapshot.messages` + `snapshot.inflight` and replays the latter through the
 * same reducer it uses for live frames.
 */
import * as path from "node:path";
import type { ServerWebSocket } from "bun";
import type { AgentMessage, AvailableSlashCommand, ExtensionUiRequest, RpcServerFrame, ServerMsg, SessionState, SubagentLifecyclePayload, SubagentProgressPayload, SubagentSnapshot } from "../shared/api.ts";
import { commandEchoMessage, commandOutputMessage } from "../shared/command-output.ts";
import { CONFIG_KEYS, CUSTOM_TYPES, DIALOG_METHODS as UI_DIALOG_METHODS } from "../shared/omp/conventions.ts";
import type { OmpFrame } from "../shared/omp/wire.ts";
import { applySubagentLifecycle, applySubagentProgress } from "../shared/subagents.ts";
import { rememberCommands } from "./command-catalog.ts";
import { config } from "./config.ts";
import { HISTORY_PAGE, HISTORY_WINDOW, isTransportOverflow } from "./history-window.ts";
import { type Lang, type Msg, msg } from "./messages.ts";
import { readSettings } from "./omp-config.ts";
import { findOwner } from "./orphans.ts";
import { OmpProcess } from "./omp-process.ts";
import { markMessagesPage } from "./omp/capabilities.ts";
import { classifyOmpError, isUnknownCommand } from "./omp/errors.ts";
import { summarizeXdevNotice } from "./omp/notices.ts";
import { ompEnv, ompOneShotArgs } from "./omp/cli.ts";
import { branchEntries, changesTranscript, resolveHistoryImages, transcriptMessages } from "./omp/transcript.ts";
import type { HistoryEntry } from "./omp/transcript.ts";
import { PersistedSubagents } from "./omp/persisted-subagents.ts";
import { sessionLeaseOccupied } from "./omp/session-owner.ts";
import { samePath, titleFromText } from "./session-index.ts";

/** Any frame omp wrote. Fields we do not model pass through to the browser untouched. */
type Frame = OmpFrame;

export type Socket = ServerWebSocket<{ id: number; remote: boolean; lang: Lang }>;

const DIALOG_METHODS = new Set<string>(UI_DIALOG_METHODS);
/** Events after which `get_state` is re-read and pushed to tabs. */
const STATE_EVENTS = new Set([
	"agent_start",
	"agent_end",
	"prompt_result",
	"session_settled",
	"model_changed",
	"thinking_level_changed",
	"auto_compaction_end",
	"queue_update",
	"session_info_update",
	"goal_updated",
]);

function trimState(raw: Record<string, unknown>, cwd: string): SessionState {
	const { systemPrompt: _s, dumpTools: _d, ...rest } = raw;
	return { ...(rest as unknown as SessionState), cwd };
}

/** Commands that move this conversation to another session file because we asked them to. */
const MOVE_COMMANDS = new Set(["new_session", "fork", "switch_session", "branch"]);
/** Commands after which the state and the sidebar index have to be re-read. */
const REFRESH_COMMANDS = new Set([...MOVE_COMMANDS, "set_model", "set_thinking_level", "set_session_name", "compact"]);

const TITLE_TIMEOUT_MS = 45_000;
/**
 * Grace each omp child gets when the gateway exits. Longer than an idle stop because a running
 * turn must finish writing its closing record — that write is what a hard kill used to interrupt
 * before the child went on holding the file, and the next gateway then copied the session to a
 * sibling. Kept under the launcher's 10 s wait so a stuck child still ends in one forced kill.
 */
const SHUTDOWN_GRACE_MS = 5000;

/** Raised for every start attempted while the gateway is draining. */
const SHUTTING_DOWN = ["网关正在关闭", "The gateway is shutting down"] as const satisfies Msg;

/**
 * One-shot `omp -p` call that writes a short title for the first exchange. A
 * separate ephemeral session keeps the summarizer out of the conversation; the
 * caller passes the tiny role's model when configured, else the session's own.
 */
async function summarizeTitle(options: {
	task: string;
	reply: string;
	cwd: string;
	model?: { provider: string; id: string };
}): Promise<string | undefined> {
	const task = options.task.replace(/\s+/g, " ").trim().slice(0, 600);
	if (!task) return undefined;
	const prompt =
		`根据下面的任务描述和助手回复的开头，给这次会话起一个不超过 12 个字的中文标题，概括任务主题。` +
		`只输出标题本身：不要引号、句号、前缀或任何解释。\n\n任务描述：${task}${options.reply ? `\n\n回复开头：${options.reply.slice(0, 400)}` : ""}`;
	const proc = Bun.spawn(ompOneShotArgs({ model: options.model, maxTime: "40s" }), {
		cwd: options.cwd,
		env: ompEnv(),
		// 提示走 stdin，不在命令列上：內容是使用者輸入與助理回覆的前幾百字，
		// 放進 argv 會讓走 cmd.exe 的啟動器重新解析引號（詳見 ompOneShotArgs 的註解）。
		stdin: new Blob([prompt]),
		stdout: "pipe",
		stderr: "ignore",
	});
	const timer = setTimeout(() => proc.kill(), TITLE_TIMEOUT_MS);
	try {
		const out = (await new Response(proc.stdout).text()).trim();
		await proc.exited;
		if (proc.exitCode !== 0 || !out) return undefined;
		return titleFromText(
			out
				.replace(/<\/?title>/g, "")
				.replace(/^["'“”「」]+|["'“”「」。.]+$/g, "")
				.replace(/^标题[:：]\s*/, ""),
		);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * 沒有任何分頁盯著的 session 要多久就收掉。
 *
 * 為什麼要有這個：有些 session 只是為了執行一個命令而存在（例如對一個沒開著的
 * session 按重新命名或匯出 HTML，gateway 會 resume 那個檔案、真的起一個 omp 行程）。
 * 那個行程持有使用者真實的 session 檔——不放掉，使用者自己的終端就再也開不了
 * 同一個 session。所以這種 session 用短的逾時：它只是替一個命令撐一下場。
 */
const UNWATCHED_STOP_MS = 30_000;

export class LiveSession {
	key: string;
	readonly cwd: string;
	readonly proc: OmpProcess;
	state: SessionState;
	/**
	 * Language of the text this session produces for a browser: the opener's, then whichever
	 * tab is watching. A session is usually viewed by one tab, and `notices`, `proc.error` and
	 * the command records below are strings by the time they travel.
	 */
	lang: Lang;
	messages: AgentMessage[] = [];
	inflight: Frame[] = [];
	pendingUi = new Map<string, ExtensionUiRequest>();
	/** Last `available_commands_update` payload; replayed to tabs that attach later. */
	commands: AvailableSlashCommand[] = [];
	/** The catalogue as last sent, so an unchanged repeat is not sent again. */
	#commandsJson = "";
	/** Subagents of this session, folded from lifecycle/progress frames. */
	subagents = new Map<string, SubagentSnapshot>();
	readonly persistedSubagents = new PersistedSubagents();
	readonly sockets = new Set<Socket>();
	#idleTimer?: ReturnType<typeof setTimeout>;
	#stateTimer?: ReturnType<typeof setTimeout>;
	#named = false;
	/**
	 * Text of the slash command forwarded last. The `command_output` frame does not say
	 * which command produced it, and labelling it here means every tab agrees.
	 */
	#lastCommand?: string;
	#refreshTranscriptAfterPrompt = false;
	/**
	 * Newest `notice` since a command was sent. A command that prints nothing echoes this
	 * line as its record, so the reason omp only told the terminal survives in the thread.
	 */
	#lastNotice?: string;
	/** First prompt of the auto-named session; the title summarizer consumes it. */
	#titleSource?: string;
	/** The placeholder name this session set, so a user rename wins over the generated one. */
	#autoName?: string;
	#titleDone = false;
	/** Warnings the first tab that attaches gets, once each, then dropped. */
	readonly notices: string[] = [];
	/** Set while a command we sent is the one allowed to move this session to another file. */
	#expectFileChange = false;

	constructor(
		private readonly hub: SessionHub,
		key: string,
		cwd: string,
		resume?: string,
		model?: string,
		lang: Lang = "zh",
	) {
		this.key = key;
		this.cwd = cwd;
		this.lang = lang;
		this.state = { isStreaming: false, isCompacting: false, messageCount: 0, cwd };
		this.proc = new OmpProcess({
			cwd,
			resume,
			model,
			onFrame: frame => this.#onFrame(frame),
			onExit: (code, stderr) => this.hub.onExit(this, code, stderr),
		});
		// 立刻 arm 閒置計時器：有些 session 是「沒有任何分頁掛著」就存在的——
		// 例如使用者對一個沒開著的 session 按重新命名或匯出 HTML，gateway 為了
		// 執行那個命令會 resume 這個檔案（真的起一個 omp 行程）。沒有計時器的話，
		// 那個行程會永遠留著，持有使用者真實的 session 檔，使用者自己的終端
		// 就再也開不了同一個 session。
		//
		// 沒有人盯著的 session 用短的逾時：它只是替一個命令撐一下場，不該佔著
		// 使用者的檔案一分鐘。
		this.#armIdle(UNWATCHED_STOP_MS);
	}

	/**
	 * Settled history through `get_messages_page`, or undefined when this omp does not
	 * have the command. Any other failure throws: a paged read that went wrong must not
	 * look like a session that simply has fewer messages.
	 */
	async #loadPagedMessages(probeOnly = false): Promise<AgentMessage[] | undefined> {
		const messages: AgentMessage[] = [];
		let cursor: string | undefined;
		do {
			const res = await this.proc.request({ type: "get_messages_page", cursor, limit: probeOnly ? 1 : 200 });
			if (!res.success) {
				if (isUnknownCommand(res.error)) return undefined;
				// A page can fail because the session moved under us (`session_busy`,
				// `stale_cursor`) — the cursor is bound to the message count. Upstream's own
				// client drops the partial walk in that case and asks for the legacy
				// snapshot; so do we, and let the caller fall back.
				if (classifyOmpError(String(res.error ?? ""), typeof res.code === "string" ? res.code : undefined).kind === "session_busy") return undefined;
				throw new Error(String(res.error ?? "get_messages_page failed"));
			}
			const data = res.data as { messages: AgentMessage[]; nextCursor?: string };
			messages.push(...(data.messages ?? []));
			if (probeOnly) break;
			cursor = data.nextCursor;
		} while (cursor);
		return messages;
	}

	/** The whole transcript in one answer, the read that predates paging. */
	async #readAllMessages(): Promise<AgentMessage[]> {
		const res = await this.proc.request({ type: "get_messages" });
		if (!res.success) throw new Error(String(res.error ?? "get_messages failed"));
		return (res.data as { messages?: AgentMessage[] } | undefined)?.messages ?? [];
	}

	async #readTranscript(): Promise<AgentMessage[] | undefined> {
		const res = await this.proc.request({ type: "get_entries" });
		if (!res.success) {
			if (isUnknownCommand(res.error)) return undefined;
			// The answer did not fit the transport. `get_entries` carries the whole session in
			// one logical frame, and a 57 MB session is over the 64 MiB ceiling — omp refuses
			// rather than truncating. That is a size, not a failure: the paged read answers
			// the same question, so let the caller fall back to it instead of killing the
			// session. See history-window.ts.
			if (isTransportOverflow(res.error)) return undefined;
			// omp's own words when it gave any; ours only when it did not.
			const failure = res.error ?? msg(this.lang, ["读取会话历史失败", "Could not read the session history"]);
			throw new Error(String(failure));
		}
		const data = res.data as { entries?: HistoryEntry[]; leafId?: string | null };
		if (!Array.isArray(data.entries)) return undefined;
		return resolveHistoryImages(transcriptMessages(branchEntries(data.entries, data.leafId)));
	}

	async init(): Promise<void> {
		await this.proc.ready;
		// A fresh session is keyed by a placeholder until omp names its file; that move is not
		// somebody else owning it. A resume that lands on a different file is.
		if (this.key.startsWith("new:")) await this.#refreshAsked();
		else await this.refreshState();
		this.#named = Boolean(this.state.sessionName);
		// Each page is ≤ 256 messages, and v2 framing keeps a large one lossless.
		const transcript = await this.#readTranscript();
		const paged = await this.#loadPagedMessages(transcript !== undefined);
		markMessagesPage(paged !== undefined);
		const messages = transcript ?? paged ?? (await this.#readAllMessages());
		this.messages = messages;
		// Only sessions that have never had a user message get named from their first prompt.
		if (messages.some(m => (m as { role?: string }).role === "user")) this.#named = true;
		// Subagents that started before this tab (or before the gateway) attached. Skipped
		// when the subscription is not available: a list that can never update would leave
		// the panel and the thread chips half-alive, so the whole surface stays hidden.
		if (this.proc.capabilities?.subagentProgress !== false) {
			const subagents = await this.proc.request({ type: "get_subagents" });
			if (subagents.success) {
				for (const entry of ((subagents.data as { subagents?: SubagentSnapshot[] }).subagents ?? [])) this.subagents.set(entry.id, entry);
			}
		}
		await this.refreshPersistedSubagents();
	}

	async refreshPersistedSubagents(): Promise<void> {
		if (!this.state.sessionFile) return;
		for (const entry of await this.persistedSubagents.list(this.state.sessionFile, this.messages)) {
			// Live frames own their entries; disk recovery only fills historical gaps.
			if (!this.subagents.has(entry.id)) this.subagents.set(entry.id, entry);
		}
	}

	async refreshState(): Promise<SessionState> {
		const res = await this.proc.request({ type: "get_state" });
		if (res.success) {
			this.state = trimState(res.data as Record<string, unknown>, this.cwd);
			await this.#adoptMovedFile();
		}
		return this.state;
	}

	/** `refreshState()` where the session moving to another file is the one we asked for. */
	async #refreshAsked(): Promise<SessionState> {
		this.#expectFileChange = true;
		try {
			return await this.refreshState();
		} finally {
			this.#expectFileChange = false;
		}
	}

	/**
	 * omp moves a session into a file of its own making when it has to rewrite a journal whose
	 * ownership lease another live process holds — after a hard-killed gateway, a forced open, or
	 * simply two writers on one file. Whatever the reason, the tab would keep holding the old
	 * path: the transcript mirror and every later command have to follow the file.
	 */
	async #adoptMovedFile(): Promise<void> {
		const after = this.state.sessionFile;
		if (!after || samePath(after, this.key)) return;
		// An empty mirror has nothing to carry over, and `init()` reads the transcript next.
		if (this.messages.length > 0) {
			this.inflight = [];
			await this.#reloadMessages();
		}
		this.hub.rekey(this, after);
		if (!this.#expectFileChange) this.#notify(["另一个 omp 进程占用了原会话文件，omp 已把这个会话另存为新文件", "Another omp process holds the original session file, so omp saved this session to a new file"]);
		this.hub.indexChanged();
	}

	/** Show a warning in the thread: at once to a watching tab, or to the first one that attaches. */
	#notify(message: Msg, params?: Record<string, string | number>): void {
		const text = msg(this.lang, message, params);
		if (this.sockets.size === 0) this.notices.push(text);
		else this.#broadcastFrame({ type: "notice", level: "warning", message: text } as unknown as Frame);
	}

	snapshot(): ServerMsg {
		const total = this.messages.length;
		const offset = Math.max(0, total - HISTORY_WINDOW);
		return {
			t: "snapshot",
			key: this.key,
			state: this.state,
			// Only the tail: a session with 21,198 messages is 55 MB of JSON, and a browser
			// that parses all of it before showing anything feels broken. The rest is still
			// here — the client asks for it with `history_page`.
			messages: offset === 0 ? this.messages : this.messages.slice(offset),
			inflight: this.inflight as unknown as RpcServerFrame[],
			pendingUi: [...this.pendingUi.values()],
			commands: this.commands,
			subagents: [...this.subagents.values()],
			capabilities: this.proc.capabilities,
			history: { offset, total },
		};
	}

	/**
	 * One page of older messages, for a client that holds only the tail of the transcript.
	 *
	 * `before` is the index the client already holds up to. The page is what comes before
	 * it, so the client can prepend and keep walking backwards.
	 */
	historyPage(before: number, limit = HISTORY_PAGE): ServerMsg {
		const total = this.messages.length;
		const end = Math.min(Math.max(0, Math.trunc(before)), total);
		const start = Math.max(0, end - Math.min(Math.max(1, Math.trunc(limit)), HISTORY_PAGE * 4));
		return { t: "history_page", key: this.key, messages: this.messages.slice(start, end), offset: start, total };
	}

	send(msg: ServerMsg): void {
		const text = JSON.stringify(msg);
		for (const ws of this.sockets) ws.send(text);
	}

	attach(ws: Socket): void {
		this.sockets.add(ws);
		// The tab watching now decides what this session says next; without one, the opener did.
		// The fallback is for a socket put together outside the server, such as a test's stub.
		this.lang = ws.data?.lang ?? this.lang;
		clearTimeout(this.#idleTimer);
		ws.send(JSON.stringify(this.snapshot()));
		for (const message of this.notices) {
			const frame = { type: "notice", level: "warning", message };
			ws.send(JSON.stringify({ t: "frame", key: this.key, frame }));
		}
		this.notices.length = 0;
	}

	detach(ws: Socket): void {
		this.sockets.delete(ws);
		this.#armIdle();
	}

	#armIdle(timeoutMs = config.idleStopMs): void {
		clearTimeout(this.#idleTimer);
		if (this.sockets.size > 0) return;
		this.#idleTimer = setTimeout(() => {
			if (this.sockets.size === 0 && !this.state.isStreaming && this.pendingUi.size === 0) void this.hub.stop(this);
			else this.#armIdle();
		}, timeoutMs);
	}

	/** Forward a browser command, with web-side conveniences around it. */
	async command(cmd: Record<string, unknown>): Promise<Frame> {
		const type = String(cmd.type);
		if (type === "get_subagent_messages") {
			const id = String(cmd.subagentId ?? "");
			if (this.subagents.get(id)?.readOnly && this.persistedSubagents.has(id)) {
				return { type: "response", success: true, data: await this.persistedSubagents.transcript(id, cmd.fromByte) };
			}
		}
		if ((type === "prompt" || type === "abort_and_prompt") && !this.#named && typeof cmd.message === "string") {
			this.#named = true;
			const name = titleFromText(cmd.message);
			this.#titleSource = cmd.message;
			if (name) {
				this.#autoName = name;
				// 失敗就放棄這個自動標題：改名失敗不該影響對話（更不該讓整個
				// gateway 結束——omp 行程在這期間退出時，pending 的請求會被 reject）。
				void this.proc
					.request({ type: "set_session_name", name })
					.then(() => this.hub.indexChanged())
					.catch(() => undefined);
			}
		}
		if (type === "abort" || type === "abort_and_restore_queue" || type === "abort_and_prompt") {
			// A dialog left open would keep the tool blocked; cancel dialogs before aborting.
			this.#cancelDialogs();
		}
		if ((type === "prompt" || type === "abort_and_prompt") && typeof cmd.message === "string" && cmd.message.startsWith("/")) {
			this.#lastCommand = cmd.message;
			this.#refreshTranscriptAfterPrompt = changesTranscript(cmd.message);
			this.#lastNotice = undefined;
		}
		const res = await this.proc.request(cmd);
		if (REFRESH_COMMANDS.has(type)) {
			// A mover lands on a file of omp's choosing and that is not a takeover; anything else
			// that shows a different file after this point is one, and `#adoptMovedFile` says so.
			if (MOVE_COMMANDS.has(type)) await this.#refreshAsked();
			else await this.refreshState();
			if (type === "compact" || MOVE_COMMANDS.has(type)) {
				await this.#reloadMessages();
				if (MOVE_COMMANDS.has(type)) this.subagents.clear();
				await this.refreshPersistedSubagents();
				this.send(this.snapshot());
			}
			this.send({ t: "state", key: this.key, state: this.state });
			this.hub.indexChanged();
		}
		return res;
	}

	answerUi(payload: Record<string, unknown>): void {
		const id = String(payload.id);
		this.pendingUi.delete(id);
		this.proc.write({ ...payload, type: "extension_ui_response" });
		this.#broadcastFrame({ type: "extension_ui_resolved", id });
	}

	#cancelDialogs(): void {
		for (const id of [...this.pendingUi.keys()]) this.answerUi({ id, cancelled: true });
	}

	async #reloadMessages(): Promise<void> {
		const original = [...this.messages];
		// Same order as init(): the whole transcript in one frame when it fits, the paged
		// read when it does not.
		const messages = (await this.#readTranscript()) ?? (await this.#loadPagedMessages()) ?? (await this.#readAllMessages());
		const sameFile = this.state.sessionFile && samePath(this.state.sessionFile, this.key);
		const firstStamp = Number(messages[0]?.timestamp ?? Infinity);
		const commandRecords = sameFile ? original.filter(m => (m.customType === CUSTOM_TYPES.commandOutput || m.customType === CUSTOM_TYPES.commandEcho) && Number(m.timestamp ?? 0) >= firstStamp) : [];
		// These display records exist only in the gateway. Retain them on the same branch.
		for (const record of commandRecords) {
			const next = messages.findIndex(m => Number(m.timestamp ?? 0) > Number(record.timestamp ?? 0));
			messages.splice(next < 0 ? messages.length : next, 0, record);
		}
		if (sameFile) {
			for (const message of this.messages.slice(original.length)) {
				if (!messages.some(m => m.role === message.role && m.timestamp === message.timestamp && m.toolCallId === message.toolCallId)) messages.push(message);
			}
		}
		this.messages = messages;
	}

	#lastReplyText(): string {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const m = this.messages[i] as { role?: string; content?: unknown };
			if (m.role !== "assistant") continue;
			const text = Array.isArray(m.content)
				? (m.content as { type?: string; text?: string }[]).filter(c => c.type === "text").map(c => c.text ?? "").join(" ")
				: "";
			if (text.trim()) return text.trim();
		}
		return "";
	}

	/** After the first exchange, replace the prompt-excerpt placeholder with a model-written title. */
	#maybeSummarizeTitle(): void {
		if (this.#titleDone || !config.autoTitle) return;
		const source = this.#titleSource;
		if (!source) return;
		this.#titleDone = true;
		void this.#runTitleSummary(source);
	}

	/** The tiny role's model when configured (thinking level stripped), else the session's own model. */
	async #titleModel(): Promise<{ provider: string; id: string } | undefined> {
		try {
			const roles = (await readSettings([CONFIG_KEYS.modelRoles]))[CONFIG_KEYS.modelRoles] as Record<string, unknown> | undefined;
			const tiny = typeof roles?.tiny === "string" ? roles.tiny.split(":")[0] : "";
			const slash = tiny.indexOf("/");
			if (slash > 0 && tiny.slice(slash + 1)) return { provider: tiny.slice(0, slash), id: tiny.slice(slash + 1) };
		} catch {
			// unreadable config: fall through to the session model
		}
		return this.state.model ? { provider: this.state.model.provider, id: this.state.model.id } : undefined;
	}

	async #runTitleSummary(source: string): Promise<void> {
		const model = await this.#titleModel();
		const title = await summarizeTitle({ task: source, reply: this.#lastReplyText(), cwd: this.cwd, model }).catch(() => undefined);
		// A user rename between the prompt and now wins over the generated one.
		if (!title || (this.#autoName && this.state.sessionName !== this.#autoName)) return;
		await this.proc
			.request({ type: "set_session_name", name: title })
			.then(() => this.refreshState())
			.then(() => {
				this.send({ t: "state", key: this.key, state: this.state });
				this.hub.indexChanged();
			})
			.catch(() => {
				// keep the placeholder; the summary is best-effort
			});
	}

	#broadcastFrame(frame: Frame): void {
		this.send({ t: "frame", key: this.key, frame: frame as unknown as RpcServerFrame });
	}

	#onFrame(frame: Frame): void {
		switch (frame.type) {
			case "message_start":
			case "message_update":
				this.inflight.push(frame);
				break;
			case "message_end": {
				const id = frame.messageId;
				this.inflight = this.inflight.filter(f => !(f.messageId === id && (f.type === "message_start" || f.type === "message_update")));
				this.messages.push(frame.message as AgentMessage);
				break;
			}
			case "tool_execution_start":
			case "tool_execution_update":
			case "tool_execution_end":
				// The browser retains settled tools until agent_end; replay needs the same lifetime.
				this.inflight.push(frame);
				break;
			case "agent_end":
				this.inflight = [];
				// First exchange settled: upgrade the truncated-prompt placeholder to a
				// model-written title (skipped when the user already renamed the session).
				this.#maybeSummarizeTitle();
				break;
			case "extension_ui_request": {
				const method = String(frame.method);
				if (DIALOG_METHODS.has(method)) this.pendingUi.set(String(frame.id), frame as unknown as ExtensionUiRequest);
				else if (method === "cancel") this.pendingUi.delete(String(frame.targetId));
				else if (method === "setWidget" || method === "setStatus") return; // terminal-only chrome
				break;
			}
			case "available_commands_update": {
				// Kept on the session so a tab attaching later can still complete `/`.
				const next = (frame.commands as AvailableSlashCommand[] | undefined) ?? [];
				// omp pushes the whole catalogue again on every turn — 26 KB each, three
				// times a turn. The list hardly ever changes, so a repeat is not worth the
				// wire: only a real change goes out.
				const json = JSON.stringify(next);
				if (json === this.#commandsJson) return;
				this.#commandsJson = json;
				this.commands = next;
				rememberCommands(this.cwd, this.commands);
				break;
			}
			case "command_output": {
				// omp writes no message for a command: mirror the answer here so it survives
				// a tab switching away and back, and reaches tabs that attach later.
				const timestamp = Date.now();
				const command = this.#lastCommand;
				this.#lastCommand = undefined;
				this.messages.push(commandOutputMessage(String(frame.text ?? ""), command, timestamp));
				this.#broadcastFrame({ ...frame, command, timestamp } as unknown as Frame);
				return;
			}
			case "notice": {
				// A long `xd://` mount notice becomes a count with a sample name before either
				// path sees it: the toast and the command record both carry the reader's version.
				const text = summarizeXdevNotice(String(frame.message ?? ""), this.lang);
				if (text !== frame.message) frame.message = text;
				// Only a command's own notice may become its record; still broadcast as usual.
				if (this.#lastCommand) this.#lastNotice = text;
				break;
			}
			case "subagent_lifecycle":
				// payload 可能是 undefined：上游改了 frame 的形狀時就是這樣。
				// 沒有它就跳過這一則，不要讓整個 session 的 frame 處理中斷。
				if (frame.payload) applySubagentLifecycle(this.subagents, frame.payload as SubagentLifecyclePayload);
				break;
			case "subagent_progress":
				if (frame.payload) applySubagentProgress(this.subagents, frame.payload as SubagentProgressPayload);
				break;
			case "auto_compaction_end":
				void this.#reloadMessages().then(() => this.send(this.snapshot())).catch(error => this.#notify(["历史刷新失败：{error}", "Could not refresh the history: {error}"], { error: (error as Error).message }));
				break;
		}
		this.#broadcastFrame(frame);
		if (STATE_EVENTS.has(frame.type)) this.#scheduleState(frame.type === "agent_start" ? 0 : 120);
		if (frame.type === "prompt_result") {
			if (this.#refreshTranscriptAfterPrompt) {
				this.#refreshTranscriptAfterPrompt = false;
				void this.#reloadMessages().then(() => this.send(this.snapshot())).catch(error => this.#notify(["历史刷新失败：{error}", "Could not refresh the history: {error}"], { error: (error as Error).message }));
			}
			// `command_output` clears the pending command, so one still pending after a result
			// with no agent turn means the command printed nothing: keep a line for it here.
			const command = frame.agentInvoked === false ? this.#lastCommand : undefined;
			if (command) {
				const timestamp = Date.now();
				const text = this.#lastNotice?.trim() || msg(this.lang, ["已执行", "Executed"]);
				this.messages.push(commandEchoMessage(text, command, timestamp));
				this.#broadcastFrame({ type: "command_echo", command, text, timestamp } as unknown as Frame);
			}
			// Commands that expand into a real turn produce no output frame at all.
			this.#lastCommand = undefined;
			this.#lastNotice = undefined;
			this.hub.indexChanged();
		}
	}

	#scheduleState(delay: number): void {
		clearTimeout(this.#stateTimer);
		this.#stateTimer = setTimeout(() => {
			void this.refreshState()
				.then(state => {
					this.send({ t: "state", key: this.key, state });
					this.#armIdle();
				})
				.catch(() => {});
		}, delay);
	}
}

/** The session's saved model and the default role are both unavailable. */
export class ModelUnavailableError extends Error {
	constructor(readonly lostModel: string, lang: Lang = "zh") {
		super(msg(lang, ["此会话保存的模型 {model} 已不可用", "The model saved for this session, {model}, is no longer available"], { model: lostModel }));
	}
}

/**
 * A live omp process outside this gateway owns the session file. Letting a second one start here
 * would put two writers on one journal, and omp answers that by moving the session to a sibling
 * file the next time it has to rewrite a journal whose ownership lease it cannot take — leaving
 * this tab holding a path nobody writes to any more.
 */
export class SessionOwnedError extends Error {
	constructor(readonly ownerPid?: number, lang: Lang = "zh") {
		super(ownerPid === undefined
			? msg(lang, ["这个会话正在另一个 omp 进程里运行", "This session is running in another omp process"])
			: msg(lang, ["这个会话正在另一个 omp 进程里运行（pid {pid}）", "This session is running in another omp process (pid {pid})"], { pid: ownerPid }));
	}
}

/** The `modelRoles` default, via the shared config reader, or undefined when unset/unreadable. */
async function defaultRoleModel(): Promise<string | undefined> {
	try {
		const roles = (await readSettings([CONFIG_KEYS.modelRoles]))[CONFIG_KEYS.modelRoles] as Record<string, unknown> | undefined;
		return typeof roles?.default === "string" && roles.default.trim() ? roles.default.trim() : undefined;
	} catch {
		return undefined;
	}
}

export class SessionHub {
	readonly sessions = new Map<string, LiveSession>();
	readonly #starting = new Map<string, Promise<LiveSession>>();
	/**
	 * Paths whose process is still exiting. `stop()` removes the session from `sessions`
	 * *before* the process is gone, and that window is exactly when a browser reopening the
	 * same file would start a second owner for it — which is how a saved-as copy appeared
	 * without any restart involved.
	 */
	readonly #stopping = new Map<string, Promise<void>>();
	/** Every constructed child, including one that has not finished `init()` yet. */
	readonly #processes = new Set<LiveSession>();
	readonly #stopPromises = new Map<LiveSession, Promise<void>>();
	#shuttingDown = false;
	#shutdownPromise?: Promise<void>;
	readonly clients = new Set<Socket>();
	#indexTimer?: ReturnType<typeof setTimeout>;

	find(key: string): LiveSession | undefined {
		const direct = this.sessions.get(key);
		if (direct) return direct;
		for (const s of this.sessions.values()) if (samePath(s.key, key)) return s;
		return undefined;
	}

	/** The process still shutting down on this path, however the path was spelled. */
	#stoppingFor(file: string): Promise<void> | undefined {
		const direct = this.#stopping.get(file);
		if (direct) return direct;
		for (const [key, done] of this.#stopping) if (samePath(key, file)) return done;
		return undefined;
	}
	/** A start in flight may use a different slash or case spelling of the same file. */
	#startingFor(file: string): Promise<LiveSession> | undefined {
		const direct = this.#starting.get(file);
		if (direct) return direct;
		for (const [key, starting] of this.#starting) if (samePath(key, file)) return starting;
		return undefined;
	}

	/** Stop each child at most once and keep it tracked until the OS reports exit. */
	#stopProcess(live: LiveSession, graceMs = 3000): Promise<void> {
		const existing = this.#stopPromises.get(live);
		if (existing) return existing;
		const done = live.proc.stop(graceMs).then(
			() => {
				this.#processes.delete(live);
				this.#stopPromises.delete(live);
			},
			error => {
				this.#processes.delete(live);
				this.#stopPromises.delete(live);
				throw error;
			},
		);
		this.#stopPromises.set(live, done);
		return done;
	}

	/** Open (or reuse) the live process for an existing session file. */
	async open(file: string, cwd: string, model?: string, force = false, lang: Lang = "zh"): Promise<LiveSession> {
		const existing = this.find(file);
		if (existing) return existing;
		if (this.#shuttingDown) throw new Error(msg(lang, SHUTTING_DOWN));
		const starting = this.#startingFor(file);
		if (starting) return starting;
		const stopping = this.#stoppingFor(file);
		if (stopping) {
			await stopping.catch(() => undefined);
			// Waiting is not owning: a second tab may have opened it while we waited.
			const reopened = this.find(file) ?? this.#startingFor(file);
			if (reopened) return reopened;
			if (this.#shuttingDown) throw new Error(msg(lang, SHUTTING_DOWN));
		}
		const promise = (async () => {
			if (this.#shuttingDown) throw new Error(msg(lang, SHUTTING_DOWN));
			// The OS lease also finds bare CLI processes that resumed through the selector.
			// A confirmed lease cannot be overridden by an old browser's force-open request.
			const occupied = await sessionLeaseOccupied(file);
			if (occupied || !force) {
				const owner = await findOwner(config.sessionsRoot, process.pid, file);
				if (occupied || owner) throw new SessionOwnedError(owner?.pid, lang);
			}
			// True when the session's saved model was gone and we substituted the default role's:
			// that choice has to be written into the session, unlike one the browser picked.
			let fellBack = false;
			let live = await this.#start(file, cwd, model, lang);
			if (live instanceof Error) {
				if (this.#shuttingDown) throw new Error(msg(lang, SHUTTING_DOWN));
				// rpc-ui refuses to resume when the saved model is gone (provider removed or
				// renamed) instead of falling back. Retry once on the default role; failing
				// that, the browser asks which model to reopen with. The failure only exists
				// as text on stderr, which also echoes omp's source line.
				const classified = classifyOmpError(live.message);
				if (classified.kind !== "model_unavailable" || !classified.detail || model || config.modelLock) throw live;
				const lost = classified.detail;
				// A role name is not accepted here, so pass the default role's model itself.
				const fallback = await defaultRoleModel();
				const retry = fallback ? await this.#start(file, cwd, fallback, lang) : undefined;
				if (!retry || retry instanceof Error) throw new ModelUnavailableError(lost, lang);
				live = retry;
				live.notices.push(msg(lang, ["原模型 {lost} 已不可用，已改用默认模型 {fallback}", "The original model {lost} is no longer available; using the default model {fallback}"], { lost, fallback: String(fallback) }));
				fellBack = true;
			}
			// A model given on the command line is not saved to the session, so the next
			// resume would fail the same way. `set_model` records it.
			const chosen = live.state.model;
			if ((model || fellBack) && chosen) {
				await live.proc.request({ type: "set_model", provider: chosen.provider, modelId: chosen.id }).catch(() => undefined);
			}
			if (this.#shuttingDown) {
				await this.#stopProcess(live, SHUTDOWN_GRACE_MS);
				throw new Error(msg(lang, SHUTTING_DOWN));
			}
			this.sessions.set(live.key, live);
			return live;
		})().finally(() => this.#starting.delete(file));
		this.#starting.set(file, promise);
		return promise;
	}

	async #start(file: string, cwd: string, model: string | undefined, lang: Lang): Promise<LiveSession | Error> {
		const live = new LiveSession(this, file, cwd, file, model, lang);
		this.#processes.add(live);
		try {
			await live.init();
			return live;
		} catch (error) {
			await this.#stopProcess(live, 500);
			return error instanceof Error ? error : new Error(String(error));
		}
	}

	/** Start a fresh session in `cwd`. Its key is the session file omp assigned. */
	async create(cwd: string, lang: Lang = "zh"): Promise<LiveSession> {
		if (this.#shuttingDown) throw new Error(msg(lang, SHUTTING_DOWN));
		const live = new LiveSession(this, `new:${crypto.randomUUID()}`, cwd, undefined, undefined, lang);
		this.#processes.add(live);
		try {
			await live.init();
		} catch (error) {
			await this.#stopProcess(live, 500);
			throw error;
		}
		if (this.#shuttingDown) {
			await this.#stopProcess(live, SHUTDOWN_GRACE_MS);
			throw new Error(msg(lang, SHUTTING_DOWN));
		}
		this.sessions.set(live.key, live);
		return live;
	}

	rekey(live: LiveSession, to: string): void {
		const from = live.key;
		// A move found during `init()` concerns a session nobody can reach yet: `open()` and
		// `create()` register it once its transcript is read, so putting it in the map here would
		// hand out a session with an empty thread.
		const registered = this.sessions.get(from) === live;
		if (registered) this.sessions.delete(from);
		live.key = to;
		if (registered) this.sessions.set(to, live);
		live.send({ t: "rekey", from, to });
		live.send(live.snapshot());
	}

	async stop(live: LiveSession): Promise<void> {
		const key = live.key;
		this.sessions.delete(key);
		const done = this.#stopProcess(live);
		this.#stopping.set(key, done);
		try {
			await done;
		} finally {
			if (this.#stopping.get(key) === done) this.#stopping.delete(key);
		}
	}

	onExit(live: LiveSession, code: number | null, stderr: string): void {
		this.#processes.delete(live);
		if (this.sessions.get(live.key) === live) this.sessions.delete(live.key);
		const error = code === 0 || code === null ? undefined : stderr.trim().split("\n").slice(-3).join("\n") || `exit ${code}`;
		live.send({ t: "proc", key: live.key, status: "exited", error });
		this.indexChanged();
	}

	liveStatus(file: string): "idle" | "running" | undefined {
		const live = this.find(file);
		if (!live) return undefined;
		return live.state.isStreaming ? "running" : "idle";
	}

	indexChanged(): void {
		clearTimeout(this.#indexTimer);
		this.#indexTimer = setTimeout(() => {
			const text = JSON.stringify({ t: "index" } satisfies ServerMsg);
			for (const ws of this.clients) ws.send(text);
		}, 250);
	}

	/**
	 * Drain each child; see SHUTDOWN_GRACE_MS for why this is longer than an idle stop. New
	 * starts are rejected while draining, and every constructed child remains in #processes
	 * until its OS exit promise settles.
	 */
	async shutdown(): Promise<void> {
		if (this.#shutdownPromise) {
			await this.#shutdownPromise;
			return;
		}
		this.#shuttingDown = true;
		this.#shutdownPromise = (async () => {
			while (this.#processes.size > 0 || this.#starting.size > 0 || this.#stopping.size > 0 || this.#stopPromises.size > 0) {
				const waits: Promise<unknown>[] = [...this.#starting.values(), ...this.#stopping.values()];
				for (const live of this.#processes) {
					if (this.sessions.get(live.key) === live) this.sessions.delete(live.key);
					waits.push(this.#stopProcess(live, SHUTDOWN_GRACE_MS));
				}
				if (waits.length === 0) break;
				await Promise.allSettled(waits);
			}
		})();
		await this.#shutdownPromise;
	}
}
