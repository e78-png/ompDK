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
export const API_VERSION = 4;

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
	| { t: "attach"; key: string; model?: string; /** `force`: open it although another process owns the file, putting two writers on one journal */ force?: boolean }
	| { t: "detach"; key: string }
	/** Arbitrary RPC command forwarded to the session's omp. */
	| { t: "rpc"; key: string; rid: string; cmd: Record<string, unknown> }
	/** `extension_ui_response` payload (without `type`). */
	| { t: "ui"; key: string; payload: Record<string, unknown> };

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

export type ServerMsg =
	| {
			t: "snapshot";
			key: string;
			state: SessionState;
			messages: AgentMessage[];
			/** Frames of the in-flight run that have not settled into `messages` yet; replay in order. */
			inflight: RpcServerFrame[];
			pendingUi: ExtensionUiRequest[];
			/** Slash commands omp last advertised for this session. */
			commands: AvailableSlashCommand[];
			/** Subagents this session spawned, still listed after they finish. */
			subagents: SubagentSnapshot[];
			/** What this session's omp negotiated; absent from an older gateway. */
			capabilities?: OmpCapabilities;
	  }
	| { t: "frame"; key: string; frame: RpcServerFrame }
	| { t: "state"; key: string; state: SessionState }
	| { t: "rpc_res"; rid: string; ok: boolean; data?: unknown; error?: string }
	/** `lostModel`: the session's saved model no longer exists; reopen with an explicit model. */
	/** `ownedBy`: a live omp process outside this gateway holds this file; opening it here would mean two writers. */
	| { t: "proc"; key: string; status: "starting" | "ready" | "exited"; error?: string; code?: "session_owned_elsewhere"; lostModel?: string; ownedBy?: number }
	/** The session moved to another file (fork/new/switch); re-attach under `to`. */
	| { t: "rekey"; from: string; to: string }
	| { t: "index" };

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
