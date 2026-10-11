import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SubagentSnapshot } from "../../../shared/api.ts";
import { iconOfName } from "../../../shared/commands.ts";
import { app } from "../lib/app-store.ts";
import { ansiNodes, ansiToText } from "../lib/ansi.tsx";
import { duration, stepDuration, tokens } from "../lib/format.ts";
import { Icon, Spinner } from "../lib/icons.tsx";
import { Markdown } from "../lib/markdown.tsx";
import { CollapsibleMessage } from "./CollapsibleMessage.tsx";
import {
	type CommandItem,
	type FileChange,
	fileChanges,
	mergeChanges,
	resultText,
	type Step,
	toolLabel,
	toolStatus,
	type Turn as TurnModel,
	turnDuration,
} from "../lib/turns.ts";

type ToolStep = Extract<Step, { kind: "tool" }>;

interface TurnProps {
	turn: TurnModel;
	steps: Step[];
	running: boolean;
	runStartedAt?: number;
	cwd?: string;
	/** Subagents of the session, so a `task` row can list its own. */
	subagents?: Map<string, SubagentSnapshot>;
	onOpenSubagent?: (id: string) => void;
	/** Start a new session from this turn's last assistant message. */
	onFork?: (turn: TurnModel) => void;
	/**
	 * Replace this turn's prompt and resend it, deleting this turn and every later
	 * one. Absent while the session runs. `dropped` is how many turns that deletes.
	 */
	onEdit?: (turn: TurnModel, text: string) => Promise<void>;
	dropped?: number;
	/** Send a slash command again, exactly as written. Absent in a read-only transcript. */
	onRerun?: (command: string) => void;
	/** Start with the step list expanded (read-only transcript dialogs). */
	defaultOpen?: boolean;
	/** Side-panel transcript: steps inline, no prompt bubble, no footer. */
	compact?: boolean;
}

/** Where the "process" ends and the final answer begins: trailing text after the last non-text step. */
function splitFinal(steps: Step[]): { process: Step[]; final: Step[] } {
	let i = steps.length;
	while (i > 0 && steps[i - 1].kind === "text") i--;
	return { process: steps.slice(0, i), final: steps.slice(i) };
}

function turnUsage(turn: TurnModel): number {
	let out = 0;
	for (const m of turn.messages as unknown as { role: string; usage?: { output?: number } }[]) if (m.role === "assistant") out += m.usage?.output ?? 0;
	return out;
}

export const Turn = memo(function Turn({ turn, steps, running, runStartedAt, cwd, subagents, onOpenSubagent, onFork, onEdit, dropped, onRerun, defaultOpen, compact }: TurnProps) {
	const [open, setOpen] = useState(Boolean(defaultOpen));
	const { process, final } = running ? { process: steps, final: [] as Step[] } : splitFinal(steps);
	const commands = turn.commands ?? [];
	if (compact) {
		return (
			<div className="turn compact">
				{turn.divider && <div className="divider">{turn.divider}</div>}
				<div className="steps">
					<StepList steps={process} subagents={subagents} onOpenSubagent={onOpenSubagent} />
				</div>
				{final.length > 0 && (
					<div className="answer">
						<CollapsibleMessage defaultExpanded>
							{final.map(s => s.kind === "text" && <Markdown key={s.key} text={s.text} />)}
						</CollapsibleMessage>
					</div>
				)}
				{commands.map(c => (
					<CommandEntry key={c.key} item={c} />
				))}
			</div>
		);
	}
	const toolCount = steps.reduce((n, s) => n + (s.kind === "tool" ? 1 : s.kind === "tools" ? s.items.length : 0), 0);
	// Kept out of the collapsed process: a skill row hidden behind 处理过程 looks like nothing ran.
	const skillSteps = steps.filter(s => s.kind === "skill");
	const shown = process.filter(s => s.kind !== "skill");
	const changes = running ? [] : mergeChanges(steps, cwd);
	const ms = turnDuration(turn);
	const answerText = final.map(s => (s.kind === "text" ? s.text : "")).join("\n\n");

	return (
		<div className="turn">
			{turn.divider && <div className="divider">{turn.divider}</div>}
			{turn.user && <UserMessage turn={turn} onEdit={onEdit} dropped={dropped ?? 1} />}
			{skillSteps.map(s => s.kind === "skill" && <SkillRow key={s.key} name={s.name} cwd={cwd} />)}
			{running ? (
				<LiveSteps steps={shown} runStartedAt={runStartedAt} subagents={subagents} onOpenSubagent={onOpenSubagent} />
			) : (
				shown.length > 0 && (
					<>
						<button className={`process-head ${open ? "open" : ""}`} onClick={() => setOpen(o => !o)}>
							<span>
								{ms ? `已处理 ${duration(ms)}` : "处理过程"}
								{toolCount > 0 && ` · ${toolCount} 次工具调用`}
							</span>
							<Icon name="chevronRight" size={13} className="chev" />
						</button>
						{open && (
							<div className="process-body">
								<StepList steps={shown} subagents={subagents} onOpenSubagent={onOpenSubagent} />
							</div>
						)}
					</>
				)
			)}
			{final.length > 0 && (
				<div className="answer">
					<CollapsibleMessage defaultExpanded>
						{final.map(s => s.kind === "text" && <Markdown key={s.key} text={s.text} />)}
					</CollapsibleMessage>
				</div>
			)}
			{changes.length > 0 && <ChangesCard changes={changes} />}
			{!running && answerText && <TurnFoot text={answerText} ms={ms} outTokens={turnUsage(turn)} onFork={onFork ? () => onFork(turn) : undefined} />}
			{commands.map(c => (
				<CommandEntry key={c.key} item={c} onRerun={onRerun} />
			))}
		</div>
	);
});

function LiveSteps({ steps, runStartedAt, subagents, onOpenSubagent }: { steps: Step[]; runStartedAt?: number; subagents?: Map<string, SubagentSnapshot>; onOpenSubagent?: (id: string) => void }) {
	const last = steps[steps.length - 1];
	const pending = (s: ToolStep): boolean => toolStatus(s) === "running" || toolStatus(s) === "pending";
	const waiting =
		!last ||
		(last.kind === "tool" && !pending(last)) ||
		(last.kind === "tools" && !last.items.some(pending)) ||
		(last.kind !== "tool" && last.kind !== "tools" && !("live" in last && last.live));
	return (
		<div className="steps">
			<StepList steps={steps} live subagents={subagents} onOpenSubagent={onOpenSubagent} />
			{waiting && <Working since={runStartedAt} />}
		</div>
	);
}

/** One line for a skill the run loaded. With a project directory it opens that skill's SKILL.md. */
function SkillRow({ name, cwd }: { name: string; cwd?: string }) {
	const label = (
		<>
			<Icon name="puzzle" size={13} />
			<span>已加载技能 {name}</span>
		</>
	);
	if (!cwd) return <div className="skill-row muted">{label}</div>;
	return (
		<button className="skill-row" title="查看 SKILL.md" onClick={() => app.openSkillDetail(name, cwd)}>
			{label}
		</button>
	);
}

function Working({ since }: { since?: number }) {
	const [, tick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => tick(x => x + 1), 1000);
		return () => clearInterval(t);
	}, []);
	return (
		<div className="think-head" style={{ cursor: "default" }}>
			<Spinner size={12} />
			<span className="shimmer">正在处理{since ? ` · ${duration(Date.now() - since)}` : ""}</span>
		</div>
	);
}

function StepList({ steps, live, subagents, onOpenSubagent }: { steps: Step[]; live?: boolean; subagents?: Map<string, SubagentSnapshot>; onOpenSubagent?: (id: string) => void }) {
	return (
		<>
			{steps.map((s, i) => {
				const isLast = i === steps.length - 1;
				switch (s.kind) {
					case "thinking":
						return <Thinking key={s.key} text={s.text} active={Boolean(live && isLast && s.live)} />;
					case "text":
						return (
							<div key={s.key} className={`step-text ${live && isLast && s.live ? "" : "dim"}`}>
								<Markdown text={s.text} live={Boolean(live && isLast && s.live)} className={live && isLast && s.live ? "caret" : ""} />
							</div>
						);
					case "tool":
						return <ToolRow key={s.key} step={s} subagents={subagents} onOpenSubagent={onOpenSubagent} />;
					case "tools":
						return <ToolGroup key={s.key} name={s.name} items={s.items} subagents={subagents} onOpenSubagent={onOpenSubagent} />;
					case "steer":
						return (
							<div key={s.key} className="steer-chip">
								插入：{s.text}
							</div>
						);
					case "bash":
						return <BashRow key={s.key} command={s.command} output={s.output} exitCode={s.exitCode} />;
					case "skill":
						return <SkillRow key={s.key} name={s.name} />;
					case "note":
						return (
							<div key={s.key} className={`note ${s.tone}`}>
								{s.text}
							</div>
						);
				}
			})}
		</>
	);
}

function firstLine(text: string): string {
	const line = text.split("\n").find(l => l.trim()) ?? "";
	return line.replace(/[#*_`>]/g, "").trim();
}

function tidy(text: string): string {
	return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function Thinking({ text, active }: { text: string; active: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="think">
			<button className={`think-head ${open ? "open" : ""}`} onClick={() => setOpen(o => !o)}>
				<Icon name="bulb" size={14} />
				{active ? <span className="label shimmer">思考中</span> : <span className="label">思考</span>}
				{!open && <span className="summary">{firstLine(text)}</span>}
				<Icon name="chevronRight" size={12} className="chev" />
			</button>
			{open && <div className="think-body"><Markdown text={tidy(text)} live={active} breaks /></div>}
		</div>
	);
}

const ICONS = { file: "file", search: "search", terminal: "terminal", edit: "edit", agent: "agent", globe: "globe", list: "list", code: "code", wait: "wait", ask: "ask", tool: "tool", check: "check" } as const;

function elapsed(step: ToolStep): string {
	const e = step.exec;
	if (!e?.endedAt) return "";
	return stepDuration(e.endedAt - e.startedAt);
}

function ToolRow({ step, subagents, onOpenSubagent }: { step: ToolStep; subagents?: Map<string, SubagentSnapshot>; onOpenSubagent?: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const status = toolStatus(step);
	const args = step.call.arguments ?? step.exec?.args ?? {};
	const label = toolLabel(step.call.name ?? step.exec?.name, args);
	const changes = fileChanges(step);
	const add = changes.reduce((n, c) => n + c.stat.added, 0);
	const del = changes.reduce((n, c) => n + c.stat.removed, 0);
	const intent = step.call.intent ?? step.exec?.intent;
	const mine = step.call.id ? [...(subagents?.values() ?? [])].filter(s => s.parentToolCallId === step.call.id) : [];
	// Collapsed rows carry the reason inline; expanded ones already show the full output.
	const errLine = status === "error" ? firstLine(resultText(step)) : "";
	return (
		<div className="tool">
			<button className="tool-head" onClick={() => setOpen(o => !o)} title={intent}>
				{status === "running" || status === "pending" ? <Spinner size={13} /> : <Icon name={ICONS[label.icon]} size={14} />}
				<span className="verb">{label.verb}</span>
				{label.target && <span className="target">{label.target}</span>}
				<span className="meta">
					{status === "error" && <span className="tag-err">失败</span>}
					{(add > 0 || del > 0) && (
						<span>
							<span className="stat-add">+{add}</span> <span className="stat-del">−{del}</span>
						</span>
					)}
					{elapsed(step)}
				</span>
			</button>
			{errLine && !open && <div className="tool-err">{errLine}</div>}
			{open && <ToolDetail step={step} status={status} changes={changes} />}
			{mine.length > 0 && (
				<div className="subagents">
					{mine.map(s => (
						<button key={s.id} className="subagent" onClick={() => onOpenSubagent?.(s.id)} title={s.task ?? s.description}>
							{s.status === "running" || s.status === "pending" ? <Spinner size={11} /> : <span className={`dot ${s.status}`} />}
							<span className="agent">{s.agent}</span>
							{s.description && <span className="desc">{s.description}</span>}
							<span className={`state ${s.status}`}>{SUBAGENT_STATE[s.status] ?? s.status}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** One row for a run of the same tool called back to back; expand it for the individual calls. */
function ToolGroup({ name, items, subagents, onOpenSubagent }: { name: string; items: ToolStep[]; subagents?: Map<string, SubagentSnapshot>; onOpenSubagent?: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const label = toolLabel(name, items[0].call.arguments ?? items[0].exec?.args ?? {});
	const busy = items.some(s => toolStatus(s) === "running" || toolStatus(s) === "pending");
	const errors = items.filter(s => toolStatus(s) === "error").length;
	const changes = items.flatMap(s => fileChanges(s));
	const add = changes.reduce((n, c) => n + c.stat.added, 0);
	const del = changes.reduce((n, c) => n + c.stat.removed, 0);
	return (
		<div className="tool">
			<button className="tool-head" onClick={() => setOpen(o => !o)}>
				{busy ? <Spinner size={13} /> : <Icon name={ICONS[label.icon]} size={14} />}
				<span className="verb">{label.verb}</span>
				<span className="count">×{items.length}</span>
				<span className="meta">
					{errors > 0 && <span className="tag-err">失败 {errors}</span>}
					{(add > 0 || del > 0) && (
						<span>
							<span className="stat-add">+{add}</span> <span className="stat-del">−{del}</span>
						</span>
					)}
				</span>
			</button>
			{open && (
				<div className="group-rows">
					{items.map(s => (
						<ToolRow key={s.key} step={s} subagents={subagents} onOpenSubagent={onOpenSubagent} />
					))}
				</div>
			)}
		</div>
	);
}

const SUBAGENT_STATE: Record<string, string> = { pending: "等待", running: "运行中", completed: "完成", failed: "失败", aborted: "已停止" };

function ToolDetail({ step, status, changes }: { step: ToolStep; status: string; changes: FileChange[] }) {
	const args = { ...(step.call.arguments ?? step.exec?.args ?? {}) };
	delete args.i;
	const name = step.call.name ?? step.exec?.name;
	const out = resultText(step);
	const diff = changes.map(c => c.diff).filter(Boolean).join("\n");
	let input: string;
	if (name === "bash") input = String(args.command ?? "");
	else if (name === "edit" && typeof args.input === "string") input = args.input;
	else if (!step.call.name && step.call.partialJson) input = step.call.partialJson;
	else input = JSON.stringify(args, null, 2);
	return (
		<div className="tool-body">
			{diff ? (
				<Diff text={diff} />
			) : (
				input &&
				input !== "{}" && (
					<>
						<div className="label">{name === "bash" ? "命令" : "参数"}</div>
						<pre className="tool-pre">{input}</pre>
					</>
				)
			)}
			{out && !(diff && status === "done") && (
				<>
					<div className="label">{status === "error" ? "错误" : "输出"}</div>
					<pre className={`tool-pre ${status === "error" ? "err" : ""}`}>{out.length > 20000 ? `${out.slice(0, 20000)}\n…（已截断）` : out}</pre>
				</>
			)}
		</div>
	);
}

/** Unified diff renderer, shared with the inspector's "改动" page. */
export function Diff({ text }: { text: string }) {
	const lines = text.split("\n").slice(0, 1500);
	return (
		<div className="diff">
			{lines.map((l, i) => (
				<div key={i} className={l.startsWith("+++") || l.startsWith("---") || l.startsWith("@@") ? "h" : l.startsWith("+") ? "a" : l.startsWith("-") ? "d" : ""}>
					{l || " "}
				</div>
			))}
		</div>
	);
}

function BashRow({ command, output, exitCode }: { command: string; output: string; exitCode?: number }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="tool">
			<button className="tool-head" onClick={() => setOpen(o => !o)}>
				<Icon name="terminal" size={14} />
				<span className="verb">本地命令</span>
				<span className="target">{command}</span>
				<span className="meta">{exitCode ? <span className="tag-err">退出码 {exitCode}</span> : null}</span>
			</button>
			{open && (
				<div className="tool-body">
					<pre className="tool-pre">{output || "（无输出）"}</pre>
				</div>
			)}
		</div>
	);
}

/** A terminal table this long is not something you wanted to scroll past blind. */
const OUTPUT_FOLD_AT = 16;
const OUTPUT_PREVIEW = 12;

/**
 * A slash command as its own entry. omp writes its answer for a terminal, so the text
 * keeps its spacing and alignment instead of being re-flowed as prose.
 */
function CommandEntry({ item, onRerun }: { item: CommandItem; onRerun?: (command: string) => void }) {
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState<"cmd" | "out">();
	const command = item.command;
	// A command's output ends with a line break of its own; that is not a blank row.
	const body = item.text.replace(/\s+$/, "");
	const lines = body ? body.split("\n") : [];
	const folded = lines.length >= OUTPUT_FOLD_AT && !expanded;
	const word = /^\/(\S+)/.exec(command ?? "")?.[1] ?? "";

	const copy = (what: "cmd" | "out", value: string) => {
		void navigator.clipboard.writeText(value).then(() => {
			setCopied(what);
			setTimeout(() => setCopied(c => (c === what ? undefined : c)), 1200);
		});
	};

	return (
		<div className="cmd-entry">
			<div className="cmd-line">
				<span className="cmd-tag">
					<Icon name={word ? iconOfName(word) : "terminal"} size={13} className="muted" />
					<bdi>{command ?? "斜杠命令"}</bdi>
				</span>
				<span className="cmd-acts">
					{command && (
						<button className="icon-btn" title="复制命令" onClick={() => copy("cmd", command)}>
							<Icon name={copied === "cmd" ? "check" : "copy"} size={13} />
						</button>
					)}
					{command && onRerun && (
						<button className="icon-btn" title="再次执行" onClick={() => onRerun(command)}>
							<Icon name="refresh" size={13} />
						</button>
					)}
				</span>
			</div>
			{lines.length <= 1 ? (
				<div className="cmd-flat">{lines[0] ? ansiNodes(lines[0]) : "（无输出）"}</div>
			) : (
				<div className="cmd-card">
					<div className="cmd-card-head">
						<span className="cmd-card-label">输出 · {lines.length} 行</span>
						<button className="icon-btn" title="复制输出" onClick={() => copy("out", ansiToText(body))}>
							<Icon name={copied === "out" ? "check" : "copy"} size={13} />
						</button>
					</div>
					<pre className="cmd-pre">{ansiNodes((folded ? lines.slice(0, OUTPUT_PREVIEW) : lines).join("\n"))}</pre>
					{folded && (
						<div className="cmd-more">
							<button className="btn" onClick={() => setExpanded(true)}>
								展开全部（{lines.length} 行）
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function ChangesCard({ changes }: { changes: FileChange[] }) {
	const [openPath, setOpenPath] = useState<string>();
	const add = changes.reduce((n, c) => n + c.stat.added, 0);
	const del = changes.reduce((n, c) => n + c.stat.removed, 0);
	return (
		<div className="changes">
			<div className="changes-head">
				<Icon name="edit" size={15} className="muted" />
				<b>已编辑 {changes.length} 个文件</b>
				<span className="stat-add">+{add}</span>
				<span className="stat-del">−{del}</span>
			</div>
			{changes.map(c => (
				<div key={c.path}>
					<div className="change-line">
						<button className="change-row" onClick={() => setOpenPath(p => (p === c.path ? undefined : c.path))} title={c.path}>
							<span className="path">
								<bdi>{c.path}</bdi>
							</span>
							<span className="stat-add">+{c.stat.added}</span>
							<span className="stat-del">−{c.stat.removed}</span>
						</button>
						<button className="icon-btn" title="在改动中查看" onClick={() => app.openInChanges(c.path)}>
							<Icon name="panelRight" size={14} />
						</button>
					</div>
					{openPath === c.path && c.diff && (
						<div className="change-diff">
							<Diff text={c.diff} />
						</div>
					)}
				</div>
			))}
		</div>
	);
}

/** The prompt bubble, with copy and edit-and-resend on hover. */
function UserMessage({ turn, onEdit, dropped }: { turn: TurnModel; onEdit?: (turn: TurnModel, text: string) => Promise<void>; dropped: number }) {
	const user = turn.user;
	const [copied, setCopied] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const box = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
	}, [draft, editing]);

	useEffect(() => {
		const el = box.current;
		if (!editing || !el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}, [editing]);

	if (!user) return null;

	const body = user.text.replace(/\s+$/, "");

	const startEdit = () => {
		setDraft(user.text);
		setEditing(true);
	};
	const send = async () => {
		const text = draft.trim();
		if (!text || busy || !onEdit) return;
		setBusy(true);
		try {
			await onEdit(turn, text);
			setEditing(false);
		} catch {
			// onEdit surfaced the error; keep the editor open with the text
		} finally {
			setBusy(false);
		}
	};

	if (editing) {
		return (
			<div className="user-row editing">
				<div className="user-edit">
					<textarea
						ref={box}
						value={draft}
						disabled={busy}
						onChange={e => setDraft(e.target.value)}
						onKeyDown={e => {
							if (e.key === "Escape") {
								e.preventDefault();
								setEditing(false);
							} else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								void send();
							}
						}}
					/>
					{user.images > 0 && <div className="att">附图 {user.images} 张，重新发送时保留</div>}
					<div className="user-edit-foot">
						<span className="warn">发送后会删除这条及之后的 {dropped} 轮对话，无法恢复；要保留请先分叉</span>
						<button className="btn" disabled={busy} onClick={() => setEditing(false)}>
							取消
						</button>
						<button className="btn primary" disabled={busy || !draft.trim()} onClick={() => void send()}>
							{busy ? <Spinner size={12} /> : "发送"}
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="user-row">
			<div className="user-bubble">
				<CollapsibleMessage>{body}</CollapsibleMessage>
				{user.images > 0 && <span className="att">附图 {user.images} 张</span>}
			</div>
			<div className="user-actions">
				<button
					className="icon-btn"
					title="复制"
					onClick={() =>
						void navigator.clipboard.writeText(user.text).then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 1200);
						})
					}
				>
					<Icon name={copied ? "check" : "copy"} size={14} />
				</button>
				{onEdit && (
					<button className="icon-btn" title="编辑并重新发送" onClick={startEdit}>
						<Icon name="edit" size={14} />
					</button>
				)}
			</div>
		</div>
	);
}

function TurnFoot({ text, ms, outTokens, onFork }: { text: string; ms?: number; outTokens: number; onFork?: () => void }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="turn-foot">
			<button
				className="icon-btn"
				title="复制回答"
				onClick={() =>
					void navigator.clipboard.writeText(text).then(() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 1200);
					})
				}
			>
				<Icon name={copied ? "check" : "copy"} size={14} />
			</button>
			{onFork && (
				<button className="icon-btn" title="从这里分叉（新会话）" onClick={onFork}>
					<Icon name="branch" size={14} />
				</button>
			)}
			{ms ? <span className="sep">{duration(ms)}</span> : null}
			{outTokens > 0 && <span className="sep">输出 {tokens(outTokens)} tokens</span>}
		</div>
	);
}

