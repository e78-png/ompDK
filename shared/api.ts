/** Gateway ↔ browser contract. The omp wire types this app depends on live in `./omp/wire.ts`. */
import type { ModelRole } from "./omp/conventions.ts";
import type {
	AgentMessage,
	AvailableSlashCommand,
	ExtensionUiRequest,
	ImageContent,
	RpcServerFrame,
	SlashCommandInput,
	SlashSubcommand,
	SubagentLifecyclePayload,
	SubagentProgressPayload,
	SubagentSnapshot,
} from "./omp/wire.ts";

export type {
	AgentMessage,
	AvailableSlashCommand,
	ExtensionUiRequest,
	ImageContent,
	RpcServerFrame,
	SlashCommandInput,
	SlashSubcommand,
	SubagentLifecyclePayload,
	SubagentProgressPayload,
	SubagentSnapshot,
};

/**
 * Bumped whenever the gateway changes what the browser needs — a new endpoint, or a
 * frame that now carries more than it used to. `/api/health` reports it, so a page
 * built from newer sources can tell the user to restart a server that is still running
 * the old code instead of failing with a raw 404.
 */
export const API_VERSION = 8;

/** `GET /api/pair`: whether this client must pair, and whether it already has. */
export interface PairState {
	required: boolean;
	paired: boolean;
}

/** One paired phone, as the settings page lists it. */
export interface LanDevice {
	label: string;
	/** Epoch ms of its last request. */
	lastSeen: number;
}

/** `GET /api/lan`: loopback only, since the code it carries is the way in. */
export interface LanInfo {
	enabled: boolean;
	port: number;
	/** The addresses a phone can open, most likely one first. Empty when LAN mode is off. */
	urls: string[];
	code: string;
	devices: LanDevice[];
}

export interface ProjectInfo {
	path: string;
	name: string;
	pinned: boolean;
	/** Epoch ms of the newest session (or pin time). */
	lastActive: number;
	sessionCount: number;
}

export interface SessionSummary {
	path: string;
	id: string;
	cwd: string;
	title: string;
	created: number;
	/** File mtime: bumped by omp's own bookkeeping writes, so not a usage signal. */
	modified: number;
	/** Timestamp of the newest real message; what "recently used" means. */
	activeAt: number;
	/** `parentSession`: a branch names the file it came from, a save-away names that session's id. */
	parent?: string;
	/** Set when omp saved this session away from a file it could not write: the original's path. */
	copyOf?: string;
	/** Live process status, when this session has a running omp. */
	live?: "idle" | "running";
}

/** Trimmed `get_state` (systemPrompt/dumpTools removed by the gateway). */
export interface SessionState {
	model?: {
		provider: string;
		id: string;
		name?: string;
		reasoning?: boolean;
		contextWindow?: number;
		/** Accepted input modalities, e.g. `text`, `image`. */
		input?: string[];
		thinking?: { efforts?: string[] };
	};
	thinkingLevel?: string;
	isStreaming: boolean;
	isCompacting: boolean;
	sessionFile?: string;
	sessionId?: string;
	sessionName?: string;
	messageCount: number;
	/** CLI observation never starts another writer for this session. */
	readOnly?: boolean;
	externalOwnerPid?: number;
	queuedMessages?: { steering: string[]; followUp: string[] };
	todoPhases?: { name: string; tasks: { content: string; status: string }[] }[];
	contextUsage?: { tokens: number; contextWindow: number; percent: number };
	tokensPerSecond?: number | null;
	cwd: string;
	[key: string]: unknown;
}

export interface ModelOption {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	contextWindow?: number;
	efforts?: string[];
}

export type ClientMsg =
	/** `model` (`provider/id`) starts the process on that model instead of the session's saved one. */
	| { t: "attach"; key: string; model?: string; /** `force`: open it although another process owns the file, putting two writers on one journal */ force?: boolean; observe?: boolean }
	| { t: "detach"; key: string }
	/** Arbitrary RPC command forwarded to the session's omp. */
	| { t: "rpc"; key: string; rid: string; cmd: Record<string, unknown> }
	/** `extension_ui_response` payload (without `type`). */
	| { t: "ui"; key: string; payload: Record<string, unknown> }
	/**
	 * 往回取更早的訊息。`before` 是前端手上最舊那則訊息在伺服器完整紀錄裡的索引。
	 *
	 * 為什麼需要：大型 session 的 transcript 有兩萬多則，一次全送會讓瀏覽器先 parse
	 * 55 MB 再建兩萬個 DOM 節點。snapshot 只帶最近一窗，其餘靠這個指令往回取。
	 */
	| { t: "history_page"; key: string; before: number; limit?: number }
	/** The page is still there. Sent unprompted after every `ping`, never awaited. */
	| { t: "pong" };

/**
 * What the local omp proved during the handshake, one flag per optional call.
 * `undefined` on the gateway side means nothing has negotiated yet, which is not the
 * same as a feature being missing.
 */
export interface OmpCapabilities {
	/** Framing version omp accepted (`negotiate_protocol`); 2 is what makes `rpc_chunk` arrive. */
	protocol: 1 | 2;
	/** `set_event_filter` with `messageUpdates: "delta"` was accepted, so text streams in pieces. */
	deltaUpdates: boolean;
	/** `set_ask_dialog`, one rich card per `ask` instead of a card per question. */
	askDialog: boolean;
	/** `set_subagent_subscription`, the frames the subagent panel reads. */
	subagentProgress: boolean;
	/** `get_messages_page` answered; otherwise the history comes from one `get_messages`. */
	messagesPage: boolean;
}

/**
 * How the installed omp compares with the build this app was verified against.
 * `tested` is the pinned version, `untested` behaves but is not the pinned version,
 * `broken` failed something required and the UI says so out loud.
 */
export type OmpCompat = "tested" | "untested" | "broken";

/** The gateway's light boot check, as `/api/health` publishes it. */
export interface OmpCheck {
	compat: OmpCompat;
	version: string | null;
	/** What failed, in the words the banner shows. Empty unless `compat` is `broken`. */
	problems: string[];
	capabilities: OmpCapabilities | null;
}

/** The `omp` block of `/api/health`. */
export interface OmpHealth {
	/** From the startup check, or from the About page's own probe; null when neither has answered. */
	version: string | null;
	capabilities: OmpCapabilities | null;
	/** Null until the gateway's startup check has finished. */
	compat: OmpCompat | null;
	/** What failed, in the words the banner shows. */
	problems: string[];
}

/**
 * `GET /api/omp/update`：上游的更新機制看到什麼。
 * `latest` 是上游最新的版本，沒有新版（或是讀不到）時是 null。
 */
export interface OmpUpdateStatus {
	/** 本機裝著的版本，例如 "18.12.6"；讀不到是空字串。 */
	current: string;
	/** 上游最新的版本；沒有新版或讀不到是 null。 */
	latest: string | null;
	/** 上游的更新通道。 */
	channel: "stable" | "canary" | "unknown";
	/** 本機已經是最新。 */
	upToDate: boolean;
	/** 為什麼 latest 是 null：輸出看不懂（unparsed）或命令失敗（check-failed）。 */
	note?: "unparsed" | "check-failed";
}

/** 相容性檢查的分組；CLI 與介面都靠它把結果歸位。 */
export type CompatCheckSection = "target" | "version" | "handshake" | "state" | "commands" | "commandOutput" | "session" | "cli" | "isolation";

/** 一項相容性檢查的結果。 */
export interface CompatCheckItem {
	/** 檢查分組。 */
	section: CompatCheckSection;
	mark: "ok" | "warn" | "fail" | "note";
	/** 檢查了什麼。 */
	what: string;
	/** 為什麼是這個結果；沒有就空字串。 */
	why: string;
}

/**
 * `POST /api/omp/check`：完整相容性檢查的結果。
 * server 端只回報，不會改寫 `server/omp/compat.ts` 裡的版本常數。
 */
export interface CompatCheckResult {
	items: CompatCheckItem[];
	/**
	 * 依檢查順序走過的分組；沒有項目的分組也在裡面，
	 * 因為 CLI 要照原樣印出每個標題。
	 */
	sections: CompatCheckSection[];
	/** 每種記號各有幾項。 */
	counts: { ok: number; warn: number; fail: number; note: number };
	/** 通過的項數（ok 與 note 都算通過，與 CLI 的「項通過」同義）。 */
	passed: number;
	/** 失敗的項數。 */
	failed: number;
	/** 警告的項數。 */
	warned: number;
	/** 版本號以外的警告：真正會讓介面降級的那些。 */
	capabilityWarnings: CompatCheckItem[];
	/** 版本與本應用驗證的版本不同時的那一條警告。 */
	versionWarning: CompatCheckItem | null;
	/** 建議驗證的版本；只有版本號是唯一差異時才有值。 */
	suggestedVersion: string | null;
	/** 本機裝著的版本。 */
	version: string | null;
	/** 這個應用程式驗證過的版本。 */
	testedVersion: string;
}

export type ServerMsg =
	| {
			t: "snapshot";
			key: string;
			state: SessionState;
			messages: AgentMessage[];
			/** Frames needed to restore drafts and tools of the current run; replay in order. */
			inflight: RpcServerFrame[];
			pendingUi: ExtensionUiRequest[];
			/** Slash commands omp last advertised for this session. */
			commands: AvailableSlashCommand[];
			/** Subagents this session spawned, still listed after they finish. */
			subagents: SubagentSnapshot[];
			/** What this session's omp negotiated; absent from an older gateway. */
			capabilities?: OmpCapabilities;
			/**
			 * 這份 snapshot 只帶了完整紀錄的一段。
			 *
			 * `offset` 是 `messages[0]` 在完整紀錄裡的索引，`total` 是完整紀錄的長度。
			 * `offset > 0` 表示前面還有訊息，前端要拿就送 `history_page`。
			 */
			history?: { offset: number; total: number };
	  }
	| { t: "frame"; key: string; frame: RpcServerFrame }
	/** 一頁更早的訊息。`offset` 是 `messages[0]` 在完整紀錄裡的索引。 */
	| { t: "history_page"; key: string; messages: AgentMessage[]; offset: number; total: number }
	| { t: "state"; key: string; state: SessionState }
	| { t: "rpc_res"; rid: string; ok: boolean; data?: unknown; error?: string }
	/** `lostModel`: the session's saved model no longer exists; reopen with an explicit model. */
	/** `ownedBy`: a live omp process outside this gateway holds this file; opening it here would mean two writers. */
	| { t: "proc"; key: string; status: "starting" | "ready" | "exited"; error?: string; code?: "session_owned_elsewhere"; lostModel?: string; ownedBy?: number }
	/** The session moved to another file (fork/new/switch); re-attach under `to`. */
	| { t: "rekey"; from: string; to: string }
	| { t: "index" }
	/**
	 * Keep-alive beat, every 30 s on every socket. Carries nothing: it exists so a page can
	 * tell a sleeping socket from a live one, and it counts as traffic for the idle timeout.
	 */
	| { t: "ping" };

export interface DirListing {
	path: string;
	parent: string | null;
	dirs: string[];
}

/** One directory level of the file panel. */
export interface FsTree {
	path: string;
	entries: { name: string; dir: boolean }[];
}

/** Preview of one file: text (maybe clipped), an image marker, or a binary marker. */
export interface FileView {
	/** Relative to the project, forward slashes. */
	path: string;
	text?: string;
	truncated?: boolean;
	binary?: boolean;
	image?: boolean;
	size: number;
}

export interface GitStatus {
	/** Set when `cwd` is not inside a git work tree. */
	notRepo?: boolean;
	/** Absolute work-tree root; `files[].path` is relative to it, like `git status`. */
	root?: string;
	files?: { path: string; x: string; y: string }[];
}

export interface GitDiff {
	diff: string;
	/** The file is not tracked yet, so the whole body is rendered as additions. */
	untracked?: boolean;
	truncated?: boolean;
}

/** One model row of a custom provider in `models.yml`. */
export interface ProviderModel {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	[key: string]: unknown;
}

/**
 * A provider as written in `models.yml`. Only the fields the settings form owns
 * are typed; everything else the file carries is preserved untouched.
 */
export interface ProviderConfig {
	id: string;
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	/** `undefined` leaves the field out, so omp's own default applies. */
	authHeader?: boolean;
	models?: ProviderModel[];
	[key: string]: unknown;
}

export interface ProvidersView {
	/** Absolute path of the `models.yml` the edits apply to. */
	path: string;
	exists: boolean;
	providers: ProviderConfig[];
}

/** One model role's value, parsed out of `provider/id[:level]`. */
export interface RoleValue {
	/** Raw config value, e.g. `cctq/gpt-6.1-sol:medium`; undefined when unset. */
	raw?: string;
	provider?: string;
	id?: string;
	level?: string;
	/** A raw value exists but the model is not in the `/api/models` list. */
	missing?: boolean;
}

export interface AgentSettings {
	roles: Record<ModelRole, RoleValue>;
	agentOverrides: Record<string, RoleValue>;
	planDefault: boolean;
	/** Set in test mode, where the page is read-only. */
	locked?: { provider: string; model: string };
}

/** One `omp skill list` entry, plus the enabled flag the gateway reconstructs. */
export interface SkillItem {
	name: string;
	description: string;
	/** Absolute path of the skill's SKILL.md; the client reads it back by name, never sends it. */
	filePath?: string;
	baseDir?: string;
	/** omp's origin, e.g. `agents:user`; the page groups by its prefix. */
	source: string;
	/** Hidden from the model's own list, so only an explicit `/skill:<name>` reaches it. */
	hide: boolean;
	enabled: boolean;
}

/** `omp plugin list --json` entry with the fields the page needs normalized. */
export interface PluginItem {
	[key: string]: unknown;
	id: string;
	name: string;
	kind: "npm" | "marketplace";
}

/** 一個 MCP server，由 omp 自己回報的實際載入結果。 */
export interface McpServerInfo {
	name: string;
	/** 傳輸型別：`stdio`、`http`、`sse`，或 omp 將來新增的別種。 */
	transport: string;
	enabled: boolean;
	/** 端點或指令；stdio 是指令路徑，http/sse 是網址。 */
	endpoint: string;
	/** 來源，例如 `user`、`project`；由 omp 標在最後的方括號裡。 */
	source: string;
}

/** `/mcp list` 的完整結果：解析後的清單，加上原文與認不出來的行。 */
export interface McpListResult {
	servers: McpServerInfo[];
	/** 原始輸出；解析失敗時使用者要能自己看到 omp 說了什麼。 */
	raw: string;
	/** 解析器認不出的行（原文）。 */
	unparsed: string[];
}
