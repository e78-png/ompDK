/**
 * The `/` menu: commands grouped by what they do, the ones used recently first, a
 * details strip for the selected row, and a second level for subcommands.
 * `buildRows` returns the rows; the composer only moves an index through the
 * selectable ones, so the keyboard handling stays in one place.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AvailableSlashCommand, SessionState, SlashSubcommand } from "../../../shared/api.ts";
import { type RankedCommand, commandKey, groupLabel, guidanceOf, hintText, iconOf, isHidden, rankCommands, recentCommands, slashNameOf, subTitleOf, titleOf } from "../../../shared/commands.ts";
import { COMMAND_SOURCES } from "../../../shared/omp/conventions.ts";
import { t } from "../lib/i18n/index.ts";
import { Icon } from "../lib/icons.tsx";

export type MenuRow =
	| { key: string; kind: "group"; text: string }
	| { key: string; kind: "head"; text: string; note?: string }
	| { key: string; kind: "command"; rank: RankedCommand; hint?: string; tail: string }
	| { key: string; kind: "sub"; command: AvailableSlashCommand; sub: SlashSubcommand; title?: string; current?: boolean }
	| { key: string; kind: "warn"; text: string }
	| { key: string; kind: "guide"; name: string; text: string; action: GuideAction };

/** What the app offers instead of a hidden command. */
export type GuideAction = "model-menu" | "plugins-page" | "session-menu";

/** `name` is the fragment after `/`; `sub` exists once the user typed the space after a command name. */
export interface MenuQuery {
	name: string;
	sub?: string;
}

/** Rows an arrow key can stop on, as opposed to headings and the unknown-command note. */
export type SelectableRow = Extract<MenuRow, { kind: "command" } | { kind: "sub" } | { kind: "guide" }>;

export function isSelectable(row: MenuRow): row is SelectableRow {
	return row.kind === "command" || row.kind === "sub" || row.kind === "guide";
}

/** Only the two modes the session state actually reports get a current value. */
function flagOf(state: SessionState | null | undefined, name: string): boolean | undefined {
	const key = name === "fast" ? "fastModeEnabled" : name === "slow" ? "slowModeEnabled" : undefined;
	if (!key) return undefined;
	const value = state?.[key];
	return typeof value === "boolean" ? value : undefined;
}

const ON = new Set(["on"]);
const OFF = new Set(["off"]);

/** Which subcommand reflects the state we can read, so the list can check it. */
function isCurrent(command: string, sub: SlashSubcommand, enabled: boolean | undefined): boolean {
	if (enabled === undefined) return false;
	return enabled ? ON.has(sub.name) : OFF.has(sub.name);
}

/** Any name omp advertised, hidden ones and aliases included, with or without the skill prefix. */
function isKnownName(commands: AvailableSlashCommand[], word: string): boolean {
	const q = word.toLowerCase();
	return commands.some(c => c.name.toLowerCase() === q || commandKey(c).toLowerCase() === q || (c.aliases ?? []).some(a => a.toLowerCase() === q));
}

export function buildRows(commands: AvailableSlashCommand[], query: MenuQuery, recent: string[], state?: SessionState | null, guides: GuideAction[] = []): MenuRow[] {
	const warn = (word: string): MenuRow[] => [{ key: "warn", kind: "warn", text: t("chat.menuUnknown", { word }) }];
	if (query.sub !== undefined) {
		const q = query.name.toLowerCase();
		const command = commands.find(c => c.name.toLowerCase() === q || commandKey(c).toLowerCase() === q);
		if (!command) return warn(query.name);
		const subs = command?.subcommands ?? [];
		if (!command || subs.length === 0) return [];
		const enabled = flagOf(state, commandKey(command));
		const suffix = enabled === undefined ? "" : t("chat.menuCurrent", { state: enabled ? t("chat.menuOn") : t("chat.menuOff") });
		const head = `${slashNameOf(command)}${t("chat.menuSep")}${titleOf(command)}${suffix}`;
		const needle = query.sub.toLowerCase();
		const rows: MenuRow[] = [{ key: "head", kind: "head", text: head, note: hintText(command.input?.hint) }];
		for (const sub of subs) {
			const title = subTitleOf(commandKey(command), sub.name, sub.description) ?? (sub.description ?? "").replace(/\s+/g, " ");
			// Match the name only: descriptions hold English words that collide with what is typed.
			if (needle && !sub.name.toLowerCase().includes(needle)) continue;
			rows.push({ key: `s:${sub.name}`, kind: "sub", command, sub, title, current: isCurrent(commandKey(command), sub, enabled) });
		}
		return rows;
	}
	const ranked = rankCommands(commands, query.name, recent);
	if (query.name) {
		const word = query.name.toLowerCase();
		const hidden = commands.find(c => isHidden(c) && (c.name.toLowerCase() === word || (c.aliases ?? []).some(a => a.toLowerCase() === word)));
		if (hidden) {
			const g = guidanceOf(hidden.name);
			if (!g || !guides.includes(g.action)) return [];
			return [{ key: "guide", kind: "guide", name: hidden.name, text: g.text, action: g.action }];
		}
		if (ranked.length === 0) return warn(query.name);
		return ranked.map(r => rowFor(r, groupLabel(r.group), "q"));
	}
	const rows: MenuRow[] = [];
	const recents = recentCommands(commands, recent);
	if (recents.length > 0) {
		rows.push({ key: "g:recent", kind: "group", text: t("chat.menuRecent") });
		for (const r of recents) rows.push(rowFor(r, r.command.input?.hint, "r"));
	}
	let last: string | undefined;
	for (const r of ranked) {
		if (last !== r.group) {
			last = r.group;
			rows.push({ key: `g:${r.group}`, kind: "group", text: groupLabel(r.group) });
		}
		rows.push(rowFor(r, r.command.input?.hint, "c"));
	}
	return rows;
}

function rowFor(rank: RankedCommand, tail: string | undefined, prefix: string): MenuRow {
	return { key: `${prefix}:${rank.command.name}`, kind: "command", rank, hint: hintText(rank.command.input?.hint), tail: tail ?? "" };
}

/** Rows the arrow keys can stop on, with their position in the full list. */
export function selectableOf(rows: MenuRow[]): { row: SelectableRow; at: number }[] {
	const out: { row: SelectableRow; at: number }[] = [];
	rows.forEach((row, at) => {
		if (isSelectable(row)) out.push({ row, at });
	});
	return out;
}

/** What Enter does on a row: run it at once, complete it and keep typing, or open a control. */
export function pickAction(row: SelectableRow): "run" | "complete" | "guide" {
	if (row.kind === "guide") return "guide";
	if (row.kind === "sub") return row.sub.usage ? "complete" : "run";
	return !row.rank.command.input && (row.rank.command.subcommands?.length ?? 0) === 0 ? "run" : "complete";
}

/** The details strip: the full explanation of the selected row, in the active language. */
export function detailOf(rows: MenuRow[], active: number): { main: string; sub: string } {
	const selectable = selectableOf(rows);
	const row = selectable[Math.min(active, Math.max(selectable.length - 1, 0))]?.row;
	// 沒有可選的項目（認不得的命令、沒有子命令的命令）：說明欄不能是空白，
	// 否則下面那條空白的欄位看起來像畫壞了。
	if (!row) return { main: t("chat.menuNoSelection"), sub: t("chat.menuKeys") };
	if (row.kind === "guide") return { main: t("chat.menuGuideMain", { name: row.name, text: row.text }), sub: t("chat.menuGuideSub") };
	if (row.kind === "sub") {
		const description = row.sub.description ?? "";
		return { main: t("chat.menuSub", { cmd: slashNameOf(row.command), sub: row.sub.name, title: row.title ?? description }), sub: row.sub.usage ? t("chat.menuUsage", { hint: row.sub.usage }) : t("chat.menuEnterRun") };
	}
	const c = row.rank.command;
	const description = (c.description ?? "").replace(/\s+/g, " ");
	const main = c.source === COMMAND_SOURCES.builtin ? t("chat.menuBuiltin", { title: row.rank.title, desc: description }) : description || row.rank.title;
	return { main, sub: c.input?.hint ? t("chat.menuUsage", { hint: row.hint ?? "" }) : t("chat.menuNoArgs") };
}

const MENU_MAX = 360;
const MENU_MIN = 180;
const MENU_GAP = 16;

export function CommandMenu({ rows, active, onHover, onPick }: { rows: MenuRow[]; active: number; onHover: (index: number) => void; onPick: (row: MenuRow) => void }) {
	const list = useRef<HTMLDivElement>(null);
	const root = useRef<HTMLDivElement>(null);
	const [maxHeight, setMaxHeight] = useState(MENU_MAX);
	const detail = detailOf(rows, active);

	// The panel sits above the composer: never taller than the room between it and the window top.
	useLayoutEffect(() => {
		const host = root.current?.offsetParent as HTMLElement | null;
		if (!host) return;
		setMaxHeight(Math.max(MENU_MIN, Math.min(MENU_MAX, host.getBoundingClientRect().top - MENU_GAP)));
	}, [rows.length]);

	useEffect(() => {
		const el = list.current?.querySelector(`[data-pos="${active}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [active]);

	let pos = -1;
	return (
		<div className="cmd-menu" role="listbox" ref={root} style={{ maxHeight }}>
			<div className="cmd-list" ref={list}>
				{rows.map(row => {
					if (!isSelectable(row)) {
						if (row.kind === "warn")
							return (
								<div key={row.key} className="cmd-warn">
									<Icon name="alert" size={13} />
									{row.text}
								</div>
							);
						if (row.kind === "head")
							return (
								<div key={row.key} className="cmd-head">
									<span>{row.text}</span>
									{row.note && <span className="note">{row.note}</span>}
								</div>
							);
						return (
							<div key={row.key} className="cmd-group">
								{row.text}
							</div>
						);
					}
					pos++;
					const on = pos === active;
					return (
						<button
							key={row.key}
							data-pos={pos}
							role="option"
							aria-selected={on}
							className={`cmd-row ${on ? "on" : ""}`}
							// Keep focus (and the caret) in the textarea.
							onMouseDown={e => e.preventDefault()}
							onMouseEnter={() => onHover(pos)}
							onClick={() => onPick(row)}
						>
							<span className="mark">{on ? "▸" : ""}</span>
							<RowCells row={row} />
						</button>
					);
				})}
			</div>
			<div className="cmd-detail">
				<div className="desc">{detail.main}</div>
				<div className="foot">
					<span className="hint-text">{detail.sub}</span>
					<span className="keys">{t("chat.menuKeys")}</span>
				</div>
			</div>
		</div>
	);
}

function RowCells({ row }: { row: SelectableRow }) {
	if (row.kind === "guide")
		return (
			<>
				<Icon name="info" size={13} className="muted" />
				<span className="name">{`/${row.name}`}</span>
				<span className="title">{row.text}</span>
			</>
		);
	if (row.kind === "sub")
		return (
			<>
				<Icon name="chevronRight" size={13} className="muted" />
				<span className="name">{row.sub.name}</span>
				<span className="title">{row.title ?? ""}</span>
				{row.sub.usage && <span className="tail">{row.sub.usage}</span>}
				{row.current && <Icon name="check" size={13} className="tick" />}
			</>
		);
	return (
		<>
			<Icon name={iconOf(row.rank.command)} size={13} className="muted" />
			<span className="name">{slashNameOf(row.rank.command)}</span>
			<span className="title">{row.rank.title}</span>
			{row.tail && <span className="tail">{row.tail}</span>}
		</>
	);
}
