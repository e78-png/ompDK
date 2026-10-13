/**
 * View model: group the flat message list into turns and flatten each turn's
 * assistant output into ordered steps (thinking / text / tool call / notes).
 */
import type { AgentMessage } from "../../../shared/api.ts";
import { CUSTOM_TYPES, MESSAGE_ROLES, SKILL_COMMAND_PREFIX, SUMMARY_ROLES, skillNameOf } from "../../../shared/omp/conventions.ts";
import { imagesOf, numberOr, textOf } from "../../../shared/omp/wire.ts";
import { t } from "./i18n/index.ts";
import type { Block, Draft, ToolExec } from "./session-store.ts";

/** One tool call as the transcript rendered it. */
export interface ToolStep {
	kind: "tool";
	key: string;
	call: Block;
	exec?: ToolExec;
	result?: ToolResult;
	live: boolean;
}

export type Step =
	| { kind: "thinking"; key: string; text: string; live: boolean }
	| { kind: "text"; key: string; text: string; live: boolean }
	| ToolStep
	/** Two or more adjacent calls of the same tool inside one assistant message, folded into one row. */
	| { kind: "tools"; key: string; name: string; items: ToolStep[] }
	| { kind: "steer"; key: string; text: string }
	| { kind: "bash"; key: string; command: string; output: string; exitCode?: number }
	| { kind: "skill"; key: string; name: string }
	| { kind: "note"; key: string; text: string; tone: "info" | "error" };

/** One slash command and what it answered. */
export interface CommandItem {
	key: string;
	/** The text the user submitted; absent when the frame never named one. */
	command?: string;
	text: string;
}

function isSkillPrompt(m: Msg): boolean {
	return m.role === MESSAGE_ROLES.custom && m.customType === CUSTOM_TYPES.skillPrompt;
}

export interface ToolResult {
	content?: { type: string; text?: string }[];
	details?: unknown;
	isError?: boolean;
}

export interface Turn {
	key: string;
	user?: { text: string; images: number; timestamp: number };
	messages: AgentMessage[];
	/** Slash commands run while this turn was the current one; rendered after it. */
	commands?: CommandItem[];
	/** Divider rendered above the turn (compaction, branch summary). */
	divider?: string;
}

type Msg = AgentMessage & { role: string; [k: string]: unknown };

/** The gateway's own records of a slash command: its answer, or a line for having none. */
function commandOf(m: Msg, key: string): CommandItem | undefined {
	if (m.role !== MESSAGE_ROLES.custom || (m.customType !== CUSTOM_TYPES.commandOutput && m.customType !== CUSTOM_TYPES.commandEcho)) return undefined;
	return { key, command: (m.details as { command?: string } | undefined)?.command, text: textOf(m.content) };
}

export function buildTurns(messages: readonly AgentMessage[]): Turn[] {
	const turns: Turn[] = [];
	let current: Turn | undefined;
	messages.forEach((raw, index) => {
		const m = raw as Msg;
		if (m.role === MESSAGE_ROLES.user && !m.steering && !m.synthetic) {
			current = { key: `t${index}`, user: { text: textOf(m.content), images: imagesOf(m.content).length, timestamp: numberOr(m.timestamp) }, messages: [] };
			turns.push(current);
			return;
		}
		// A skill run has no user message of its own — this expanded prompt is what the
		// user sent, so it opens the turn. Only when nothing is current: after a real
		// message it belongs to that turn instead of splitting it in two.
		if (!current && isSkillPrompt(m)) {
			const name = skillNameOf(m);
			if (name) {
				current = { key: `t${index}`, user: { text: `${SKILL_COMMAND_PREFIX}${name}`, images: 0, timestamp: numberOr(m.timestamp) }, messages: [] };
				turns.push(current);
			}
		}
		if (m.role === SUMMARY_ROLES.compaction || m.role === SUMMARY_ROLES.branch) {
			current = { key: `t${index}`, messages: [], divider: m.role === SUMMARY_ROLES.compaction ? t("chat.dividerCompacted") : t("chat.dividerBranched") };
			turns.push(current);
			return;
		}
		// A command joins the turn that was running when it arrived, after its answer, and
		// never becomes `current` itself: the messages that follow still belong to that turn.
		const command = commandOf(m, `c${index}`);
		if (command) {
			if (!current) {
				current = { key: `t${index}`, messages: [], commands: [] };
				turns.push(current);
			}
			(current.commands ??= []).push(command);
			return;
		}
		if (!current) {
			current = { key: `t${index}`, messages: [] };
			turns.push(current);
		}
		current.messages.push(raw);
	});
	return turns;
}

/** Ordered steps of a turn. `drafts`/`tools` are only passed for the live (last) turn. */
export function turnSteps(turn: Turn, drafts?: Iterable<Draft>, tools?: Map<string, ToolExec>): Step[] {
	const results = new Map<string, ToolResult>();
	for (const raw of turn.messages) {
		const m = raw as Msg;
		if (m.role === MESSAGE_ROLES.toolResult) results.set(String(m.toolCallId), m as unknown as ToolResult);
	}
	const steps: Step[] = [];
	const pushBlocks = (blocks: Block[], prefix: string, live: boolean) => {
		let run: ToolStep[] = [];
		let runName = "";
		const flush = () => {
			if (run.length === 1) steps.push(run[0]);
			else if (run.length > 1) steps.push({ kind: "tools", key: run[0].key, name: runName, items: run });
			run = [];
			runName = "";
		};
		blocks.forEach((b, i) => {
			if (!b) return;
			const key = `${prefix}:${i}`;
			if (b.type === "thinking" && b.thinking?.trim()) {
				flush();
				steps.push({ kind: "thinking", key, text: b.thinking, live });
			} else if (b.type === "text" && b.text?.trim()) {
				flush();
				steps.push({ kind: "text", key, text: b.text, live });
			} else if (b.type === "toolCall") {
				const id = b.id ?? "";
				const step: ToolStep = { kind: "tool", key: id || key, call: b, exec: id ? tools?.get(id) : undefined, result: id ? results.get(id) : undefined, live };
				const name = b.name ?? step.exec?.name ?? "";
				// Only a same-name run inside this one message folds: two reads in two
				// phases are two facts, and an unnamed call is still streaming.
				if (run.length && name !== runName) flush();
				if (name) {
					run.push(step);
					runName = name;
					return;
				}
				steps.push(step);
			}
		});
		flush();
	};
	turn.messages.forEach((raw, index) => {
		const m = raw as Msg;
		switch (m.role) {
			case MESSAGE_ROLES.assistant: {
				pushBlocks((m.content as Block[]) ?? [], `${turn.key}:${index}`, false);
				if (m.stopReason === "error" && m.errorMessage) steps.push({ kind: "note", key: `${turn.key}:${index}:err`, text: String(m.errorMessage), tone: "error" });
				if (m.stopReason === "aborted") steps.push({ kind: "note", key: `${turn.key}:${index}:abort`, text: t("chat.stopped"), tone: "info" });
				break;
			}
			case MESSAGE_ROLES.user:
				if (m.steering) steps.push({ kind: "steer", key: `${turn.key}:${index}`, text: textOf(m.content) });
				break;
			case MESSAGE_ROLES.bashExecution:
				steps.push({ kind: "bash", key: `${turn.key}:${index}`, command: String(m.command), output: String(m.output ?? ""), exitCode: m.exitCode as number | undefined });
				break;
			case MESSAGE_ROLES.custom: {
				const text = textOf(m.content);
				const skill = m.customType === CUSTOM_TYPES.skillPrompt ? skillNameOf(m) : undefined;
				// Unparseable skill prompts stay visible as text: never drop a message.
				if (skill) steps.push({ kind: "skill", key: `${turn.key}:${index}`, name: skill });
				else if (m.display || m.customType === CUSTOM_TYPES.skillPrompt) steps.push({ kind: "note", key: `${turn.key}:${index}`, text, tone: "info" });
				break;
			}
			default: {
				// A role this build has never seen — omp grows them, and `wire.ts` carries them on
				// purpose. Show what it says, or at least that it arrived, instead of dropping it
				// silently: an upgrade that starts emitting `reflection` must be visible here.
				const text = textOf(m.content).trim();
				steps.push({ kind: "note", key: `${turn.key}:${index}`, text: text || t("chat.unknownRole", { role: String(m.role) }), tone: "info" });
				break;
			}
			case MESSAGE_ROLES.toolResult:
				// Read into `results` above: the output belongs to its call's row, not one of its own.
				break;
		}
	});
	for (const d of drafts ?? []) pushBlocks(d.content, `draft:${d.messageId}`, true);
	// Live executions whose call block is not visible yet (should be rare). Only a
	// still-running one qualifies: a settled execution was already rendered by the
	// turn that owns its call block, so it must never leak into a later turn.
	if (tools) {
		const shown = new Set(steps.flatMap(s => (s.kind === "tool" ? [s.key] : s.kind === "tools" ? s.items.map(i => i.key) : [])));
		for (const t of tools.values()) {
			if (t.status !== "running" || shown.has(t.id) || results.has(t.id)) continue;
			steps.push({ kind: "tool", key: t.id, call: { type: "toolCall", id: t.id, name: t.name, arguments: t.args }, exec: t, live: true });
		}
	}
	return steps;
}

/** Where the "process" ends and the final answer begins: trailing text after the last non-text step. */
export function splitFinal(steps: Step[]): { process: Step[]; final: Step[] } {
	let i = steps.length;
	while (i > 0 && steps[i - 1].kind === "text") i--;
	return { process: steps.slice(0, i), final: steps.slice(i) };
}

export function toolStatus(step: Extract<Step, { kind: "tool" }>): "pending" | "running" | "done" | "error" {
	if (step.result) return step.result.isError ? "error" : "done";
	if (step.exec) return step.exec.status;
	return step.call.name ? "running" : "pending";
}

export function resultText(step: Extract<Step, { kind: "tool" }>): string {
	const r = step.result ?? step.exec?.result;
	if (r) return textOf(r.content);
	return step.exec?.partial ?? "";
}

/** Gaps longer than this between consecutive events are idle time, not work. */
export const MAX_ACTIVE_GAP_MS = 10 * 60_000;

/** Active time of a turn: sum of gaps between its events, each capped, so idle pauses never count. */
export function turnDuration(turn: Turn): number | undefined {
	if (!turn.user) return undefined;
	const points = [turn.user.timestamp];
	for (const m of turn.messages as unknown as { timestamp?: number; completedAt?: number; duration?: number }[]) {
		if (m.timestamp) points.push(m.timestamp);
		const end = m.completedAt ?? (m.timestamp && m.duration ? m.timestamp + m.duration : undefined);
		if (end) points.push(end);
	}
	points.sort((a, b) => a - b);
	let total = 0;
	for (let i = 1; i < points.length; i++) total += Math.min(points[i] - points[i - 1], MAX_ACTIVE_GAP_MS);
	return total > 0 ? total : undefined;
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

/** Shell line continuations (backslash + newline) read as one command line. */
function joinContinuations(cmd: string): string {
	return cmd.replace(/\\\r?\n\s*/g, " ");
}

function short(text: string, max = 80): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function baseName(p: string): string {
	const parts = p.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
	return parts[parts.length - 1] || p;
}

/** Paths an edit/write call touches (hashline/apply_patch inputs carry them inline). */
export function editPaths(name: string, args: Record<string, unknown>): string[] {
	if (name === "write" || name === "ast_edit") return str(args.path) ? [str(args.path)] : [];
	if (name !== "edit") return [];
	if (str(args.path)) return [str(args.path)];
	const input = str(args.input);
	const out = new Set<string>();
	for (const m of input.matchAll(/^\[(.+?)#[0-9A-Fa-f]{4}\]/gm)) out.add(m[1]);
	for (const m of input.matchAll(/^\*\*\* (?:Edit|Add|Update|Delete) File:\s*(.+?)(?:\s+all)?$/gm)) out.add(m[1].trim());
	return [...out];
}

export interface ToolLabel {
	icon: "file" | "search" | "terminal" | "edit" | "agent" | "globe" | "list" | "code" | "wait" | "ask" | "tool" | "check";
	verb: string;
	target: string;
}

export function toolLabel(name: string | undefined, args: Record<string, unknown> = {}): ToolLabel {
	switch (name) {
		case undefined:
			return { icon: "tool", verb: t("chat.tool.preparing"), target: "" };
		case "read":
			return { icon: "file", verb: t("chat.tool.read"), target: baseName(str(args.path)) };
		case "grep":
			return { icon: "search", verb: t("chat.tool.search"), target: `${short(str(args.pattern), 48)}${str(args.path) ? ` · ${baseName(str(args.path))}` : ""}` };
		case "glob":
			// omp's glob takes the pattern in `path`.
			return { icon: "search", verb: t("chat.tool.glob"), target: short(str(args.path) || str(args.pattern), 60) };
		case "yield":
			return { icon: "check", verb: t("chat.tool.submit"), target: "" };
		case "find":
			return { icon: "search", verb: t("chat.tool.find"), target: short(str(args.query) || str(args.pattern), 60) };
		case "bash":
			return { icon: "terminal", verb: str(args.name) ? t("chat.tool.serve") : t("chat.tool.run"), target: short(str(args.name) || joinContinuations(str(args.command)), 90) };
		case "edit": {
			const paths = editPaths(name, args);
			return { icon: "edit", verb: t("chat.tool.edit"), target: paths.length > 1 ? t("chat.tool.files", { n: paths.length }) : baseName(paths[0] ?? "") };
		}
		case "write": {
			const p = str(args.path);
			if (p.startsWith("xd://")) return { icon: "tool", verb: t("chat.tool.call"), target: p.slice(5) };
			if (p.startsWith("proc://")) return { icon: "terminal", verb: p.endsWith("/kill") ? t("chat.tool.kill") : t("chat.tool.writeProcess"), target: p.slice(7).replace(/\/kill$/, "") };
			if (p.startsWith("agent://")) return { icon: "agent", verb: t("chat.tool.send"), target: p.slice(8) };
			return { icon: "edit", verb: t("chat.tool.write"), target: baseName(p) };
		}
		case "ast_grep":
			return { icon: "search", verb: t("chat.tool.astSearch"), target: short(str(args.pattern), 60) };
		case "ast_edit":
			return { icon: "edit", verb: t("chat.tool.astEdit"), target: baseName(str(args.path)) };
		case "task": {
			const tasks = Array.isArray(args.tasks) ? args.tasks.length : 0;
			return { icon: "agent", verb: t("chat.tool.subagent"), target: tasks > 1 ? t("chat.tool.tasks", { n: tasks }) : short(str(args.name) || str(args.task), 60) };
		}
		case "wait":
			return { icon: "wait", verb: t("chat.tool.wait"), target: "" };
		case "web_search":
			return { icon: "globe", verb: t("chat.tool.web"), target: short(str(args.query), 60) };
		case "todo":
			return { icon: "list", verb: t("chat.tool.todo"), target: "" };
		case "ask":
			return { icon: "ask", verb: t("chat.tool.ask"), target: "" };
		case "eval":
			return { icon: "code", verb: t("chat.tool.code"), target: str(args.language) || str(args.lang) };
		case "lsp":
			return { icon: "code", verb: t("chat.tool.lsp"), target: short(str(args.action) || str(args.op), 40) };
		case "github":
			return { icon: "globe", verb: "GitHub", target: short(str(args.op) || str(args.action), 40) };
		case "debug":
			return { icon: "code", verb: t("chat.tool.debug"), target: short(str(args.action), 40) };
		default:
			return { icon: "tool", verb: name, target: "" };
	}
}

export interface DiffStat {
	added: number;
	removed: number;
}

export function diffStat(diff: string): DiffStat {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

export interface FileChange {
	path: string;
	diff: string;
	stat: DiffStat;
	op: string;
}

/** Display path relative to `cwd` when inside it, with forward slashes. */
export function displayPath(p: string, cwd?: string): string {
	const norm = p.replace(/\\/g, "/");
	if (!cwd) return norm;
	const base = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	if (norm.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return norm.slice(base.length + 1);
	return norm.replace(/^\.\//, "");
}

/** Per-file changes from a successful edit/write result; paths are made relative to `cwd`. */
export function fileChanges(step: Extract<Step, { kind: "tool" }>, cwd?: string): FileChange[] {
	return rawFileChanges(step).map(c => ({ ...c, path: displayPath(c.path, cwd) }));
}

/** A turn's file changes merged by path, so relative and absolute spellings of one file collapse into one entry. */
export function mergeChanges(steps: Step[], cwd?: string): FileChange[] {
	const map = new Map<string, FileChange>();
	for (const s of steps) {
		const calls = s.kind === "tool" ? [s] : s.kind === "tools" ? s.items : [];
		for (const step of calls) {
			for (const c of fileChanges(step, cwd)) {
				const prev = map.get(c.path.toLowerCase());
				if (prev)
					map.set(c.path.toLowerCase(), {
						...c,
						diff: [prev.diff, c.diff].filter(Boolean).join("\n"),
						stat: { added: prev.stat.added + c.stat.added, removed: prev.stat.removed + c.stat.removed },
					});
				else map.set(c.path.toLowerCase(), c);
			}
		}
	}
	return [...map.values()];
}

function rawFileChanges(step: Extract<Step, { kind: "tool" }>): FileChange[] {
	const name = step.call.name;
	if (name !== "edit" && name !== "write" && name !== "ast_edit") return [];
	if (toolStatus(step) !== "done") return [];
	const details = ((step.result ?? step.exec?.result)?.details ?? {}) as {
		diff?: string;
		path?: string;
		op?: string;
		perFileResults?: { path: string; diff?: string; op?: string }[];
	};
	const args = step.call.arguments ?? {};
	if (name === "write") {
		const p = str(args.path);
		if (!p || /^[a-z]+:\/\//.test(p)) return [];
		const lines = str(args.content).replace(/\n$/, "").split("\n").length;
		return [{ path: p, diff: "", stat: { added: lines, removed: 0 }, op: "write" }];
	}
	if (details.perFileResults?.length) {
		return details.perFileResults.map(f => ({ path: f.path, diff: f.diff ?? "", stat: diffStat(f.diff ?? ""), op: f.op ?? "update" }));
	}
	const p = details.path ?? editPaths(name, args)[0];
	if (!p) return [];
	return [{ path: p, diff: details.diff ?? "", stat: diffStat(details.diff ?? ""), op: details.op ?? "update" }];
}
