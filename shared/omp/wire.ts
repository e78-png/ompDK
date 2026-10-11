/**
 * Everything this app assumes about omp's wire format — and deliberately nothing else.
 *
 * omp publishes a generated type file for its RPC transport. It is ~48 KB describing a
 * protocol we read in about a dozen places, and copying it in bought nothing: frames are
 * read field by field, so a renamed field failed at runtime, not at compile time, and an
 * upgrade meant re-copying a file by hand.
 *
 * So the rule here is: declare only what we actually read, require only the discriminator
 * (`type` on a frame, `role` on a message), and give every shape an index signature. A
 * field omp stops sending then reads as `undefined` at the place that used it, and a field
 * omp adds costs nothing. `bun run omp:check` is what catches real incompatibility, not
 * the compiler.
 */

// ── message content ──────────────────────────────────────────────────────────────

/**
 * One content block. omp has more kinds than this (`redactedThinking`, `fallback`,
 * server-side tool blocks); the thread ignores them, so this is one permissive shape
 * keyed on `type` rather than a union that would need extending every time omp grows one.
 */
export interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	/** `toolCall`. */
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
	/** The one-line description of what the call is for, shown while it runs. */
	intent?: string;
	/** `image`. */
	data?: string;
	mimeType?: string;
	[k: string]: unknown;
}

/** Message content: omp sends a bare string for simple messages, blocks otherwise. */
export type MessageContent = string | ContentBlock[];

/** An image a prompt carries. We build these, so the payload fields are required. */
export interface ImageContent {
	type?: "image";
	data: string;
	mimeType: string;
	[k: string]: unknown;
}

// ── messages ────────────────────────────────────────────────────────────────────

/** A prompt. `steering` and `synthetic` messages are inserted mid-turn and open none. */
export interface UserMessage {
	role: "user";
	content?: MessageContent;
	timestamp?: number;
	steering?: boolean;
	synthetic?: boolean;
	[k: string]: unknown;
}

/** One assistant reply. `usage.output` and the timing fields feed the turn footer. */
export interface AssistantMessage {
	role: "assistant";
	content?: ContentBlock[];
	model?: string;
	provider?: string;
	usage?: { input?: number; output?: number; [k: string]: unknown };
	stopReason?: string;
	errorMessage?: string;
	timestamp?: number;
	duration?: number;
	completedAt?: number;
	[k: string]: unknown;
}

/** A tool's answer, matched back to its call by `toolCallId`. */
export interface ToolResultMessage {
	role: "toolResult";
	toolCallId?: string;
	toolName?: string;
	content?: MessageContent;
	isError?: boolean;
	details?: unknown;
	timestamp?: number;
	[k: string]: unknown;
}

/** A `!` shell run, kept in the transcript with its own row. */
export interface BashExecutionMessage {
	role: "bashExecution";
	command?: string;
	output?: string;
	exitCode?: number;
	timestamp?: number;
	[k: string]: unknown;
}

/**
 * Anything omp writes that is not a conversation message: skill prompts, and the
 * command records the gateway mirrors into the list. `customType` picks the renderer.
 */
export interface CustomMessage {
	role: "custom";
	customType?: string;
	content?: MessageContent;
	display?: boolean;
	details?: unknown;
	timestamp?: number;
	[k: string]: unknown;
}

/** The two summaries that split a transcript; each one starts a turn with a divider. */
export interface SummaryMessage {
	role: "compactionSummary" | "branchSummary";
	summary?: string;
	timestamp?: number;
	[k: string]: unknown;
}

/** A role this app has never seen. It still has to be carried without breaking the list. */
export interface UnknownMessage {
	role: string;
	timestamp?: number;
	[k: string]: unknown;
}

/** One entry of a session's transcript, discriminated by `role`. */
export type AgentMessage =
	UserMessage | AssistantMessage | ToolResultMessage | BashExecutionMessage | CustomMessage | SummaryMessage | UnknownMessage;

// ── slash commands ───────────────────────────────────────────────────────────────

/**
 * Where a command came from. Observed values are `builtin`, `skill`, `extension`,
 * `custom`, `mcp_prompt` and `file`; anything new reads as a custom command.
 */
export type SlashCommandSource = string;

export interface SlashCommandInput {
	hint?: string;
}

export interface SlashSubcommand {
	name: string;
	description?: string;
	usage?: string;
}

/**
 * One command from `available_commands_update`. `name` is required because everything the
 * menu and the thread do with a command keys off it — one without a name is not a command.
 */
export interface AvailableSlashCommand {
	name: string;
	source?: SlashCommandSource;
	aliases?: string[];
	description?: string;
	input?: SlashCommandInput;
	subcommands?: SlashSubcommand[];
	[k: string]: unknown;
}

// ── extension UI ─────────────────────────────────────────────────────────────────

/**
 * A dialog or notification an extension asks the host to show. `method` picks the card,
 * and the card reads its own fields off the index signature.
 */
export interface ExtensionUiRequest {
	type: "extension_ui_request";
	id: string;
	method: string;
	[k: string]: unknown;
}

// ── subagents ────────────────────────────────────────────────────────────────────

/** A `subagent_lifecycle` payload. Frames are not trustworthy, so nothing is required. */
export interface SubagentLifecyclePayload {
	id?: string;
	agent?: string;
	agentSource?: string;
	status?: string;
	index?: number;
	description?: string;
	sessionFile?: string;
	parentToolCallId?: string;
	detached?: boolean;
	[k: string]: unknown;
}

/** A `subagent_progress` payload; `progress` is omp's own record, read as-is by the panel. */
export interface SubagentProgressPayload {
	index?: number;
	agent?: string;
	agentSource?: string;
	task?: string;
	progress?: Record<string, unknown>;
	parentToolCallId?: string;
	assignment?: string;
	sessionFile?: string;
	detached?: boolean;
	[k: string]: unknown;
}

/**
 * One subagent as the gateway and the browser fold the two frame kinds into one entry.
 * This side builds it, so the fields the panel sorts and filters on are required.
 */
export interface SubagentSnapshot {
	id: string;
	index: number;
	status: "pending" | "running" | "completed" | "failed" | "aborted" | "unknown";
	lastUpdate: number;
	agent?: string;
	agentSource?: string;
	description?: string;
	task?: string;
	assignment?: string;
	sessionFile?: string;
	progress?: Record<string, unknown>;
	parentToolCallId?: string;
	/** Recovered from disk; there is no live RPC registry ref to control. */
	readOnly?: boolean;
}

// ── frames ───────────────────────────────────────────────────────────────────────

/**
 * Any frame omp writes. Unknown types pass through to the browser untouched, so a new
 * event is inert here rather than a parse failure.
 */
export interface OmpFrame {
	type: string;
	[k: string]: unknown;
}

/** The response to a command, correlated by `id`. */
export interface OmpResponse extends OmpFrame {
	type: "response";
	command?: string;
	success?: boolean;
	id?: string;
	data?: unknown;
	error?: string;
	/** Machine-readable failure reason, when omp gives one. */
	code?: string;
}

/** The `ready` frame, whose protocol fields decide whether v2 framing is in use. */
export interface OmpReady extends OmpFrame {
	type: "ready";
	protocolVersion?: number;
	supportedProtocolVersions?: number[];
	maxFrameBytes?: number;
}

/** Any frame from omp's stdout, after `rpc_chunk` reassembly. */
export type RpcServerFrame = OmpFrame | OmpResponse | OmpReady;

/** Narrow a frame by its discriminator: `if (isFrame(f, "message_end")) …`. */
export function isFrame<T extends OmpFrame, U extends string>(frame: T, type: U): frame is T & { type: U } {
	return frame.type === type;
}

// ── readers ──────────────────────────────────────────────────────────────────────

/** The blocks of a message's content, or no blocks when it is plain text. */
export function blocksOf(content: unknown): ContentBlock[] {
	return Array.isArray(content) ? (content as ContentBlock[]).filter(b => b && typeof b === "object") : [];
}

/** All the text a message carries: omp sends a string or blocks, and both reach the thread. */
export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	return blocksOf(content)
		.map(b => (typeof b.text === "string" ? b.text : ""))
		.join("");
}

/** The images attached to a message, so a bubble can say how many there are. */
export function imagesOf(content: unknown): ContentBlock[] {
	return blocksOf(content).filter(b => b.type === "image");
}

/** A number omp may send as a number, a numeric string, or not at all. */
export function numberOr(value: unknown, fallback = 0): number {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** A string field that may be missing or sent as something else. */
export function stringOr(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}
