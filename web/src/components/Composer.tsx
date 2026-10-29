import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AvailableSlashCommand, ImageContent, SessionState } from "../../../shared/api.ts";
import { commandKey, hintText, isDestructive, subTitleOf } from "../../../shared/commands.ts";
import { t } from "../lib/i18n/index.ts";
import { Icon } from "../lib/icons.tsx";
import { isTouch } from "../lib/viewport.ts";
import { buildRows, CommandMenu, type GuideAction, type MenuRow, pickAction, selectableOf } from "./CommandMenu.tsx";
import { searchFiles, SuggestMenu, type SuggestItem } from "./SuggestMenu.tsx";

export type SendMode = "prompt" | "steer" | "followUp";

/** One pending image: `dataUrl` drives the thumbnail, `image` is what omp receives. */
interface Attachment {
	id: string;
	dataUrl: string;
	image: ImageContent;
}

interface Trigger {
	kind: "command" | "sub" | "file";
	/** Text the menu filters by. */
	query: string;
	/** Command name for the two command levels. */
	name?: string;
	/** Subcommand fragment once the user typed the space after a command name. */
	sub?: string;
	/** Identifies this trigger to the Esc-to-dismiss guard. */
	key: string;
	/** Range of the trigger text (`/query` or `@query`) to replace on pick. */
	start: number;
	end: number;
}

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Slash commands the user ran lately; the menu puts them in their own section. */
const RECENTS_KEY = "omp-web:recent-commands";
const RECENTS_MAX = 12;

function readRecents(): string[] {
	try {
		const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
		return Array.isArray(raw) ? raw.map(String).slice(0, RECENTS_MAX) : [];
	} catch {
		return [];
	}
}

function rememberRecent(name: string): string[] {
	const next = [name, ...readRecents().filter(n => n !== name)].slice(0, RECENTS_MAX);
	try {
		localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
	} catch {
		// unavailable
	}
	return next;
}

/** First word of a `/...` message, as stored in the recent list. */
function commandWord(text: string): string | undefined {
	const m = /^\/(\S+)/.exec(text.trim());
	return m ? m[1].toLowerCase() : undefined;
}

/**
 * Input box. Enter sends; Shift+Enter newline. While a run is active, Enter
 * steers the current run and Alt+Enter queues a follow-up (same as the TUI).
 * With a menu open, Enter/Tab pick an item instead of sending. Images come in
 * by paste, drag-and-drop, or the + button.
 */
export function Composer({
	onSend,
	onStop,
	onNotice,
	running = false,
	disabled = false,
	placeholder,
	left,
	right,
	above,
	autoFocus,
	draftKey,
	restore,
	onRestored,
	prefill,
	commands = [],
	guidance,
	state,
	fileCwd,
	modelSupportsImages,
}: {
	onSend: (text: string, mode: SendMode, images?: ImageContent[]) => void | Promise<void>;
	onStop?: () => void;
	/** Surfaces attachment problems (too many, too large) through the host's notice channel. */
	onNotice?: (text: string, level?: "info" | "warning" | "error") => void;
	running?: boolean;
	disabled?: boolean;
	placeholder?: string;
	left?: ReactNode;
	right?: ReactNode;
	above?: ReactNode;
	autoFocus?: boolean;
	/** Drafts survive switching sessions (kept per key in sessionStorage). */
	draftKey?: string;
	/** Text to put back into the box (e.g. a send that failed); `onRestored` acknowledges it. */
	restore?: string;
	onRestored?: () => void;
	/**
	 * Text the host drops into the box (the home screen's example prompts).
	 *
	 * 為什麼不跟 `restore` 共用：`restore` 是一次性的、而且主機會把它清掉；
	 * 範例提示是使用者按下去才填的，填完還要能繼續改字，所以這裡只負責「填」，
	 * 不負責「清」。
	 */
	prefill?: string;
	/** Slash commands to complete: the open session's, or the home project's from the gateway cache. */
	commands?: AvailableSlashCommand[];
	/** Controls the host can open in place of a hidden command; absent ones are not offered. */
	guidance?: Partial<Record<GuideAction, () => void>>;
	/** Live session state; only `/fast` and `/slow` have a value the menu can show. */
	state?: SessionState | null;
	/** `@` completion searches this directory. */
	fileCwd?: string;
	/** False when the model takes text only; undefined when that is unknown. */
	modelSupportsImages?: boolean;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const filePicker = useRef<HTMLInputElement>(null);
	const storageKey = draftKey ? `omp-web:draft:${draftKey}` : undefined;
	const [text, setText] = useState(() => (storageKey ? (safeGet(storageKey) ?? "") : ""));
	const composing = useRef(false);
	const [trigger, setTrigger] = useState<Trigger>();
	const [fileItems, setFileItems] = useState<SuggestItem[]>([]);
	/** True once a file search came back; distinguishes "not searched yet" from "no hits". */
	const [fileSearched, setFileSearched] = useState(false);
	const [recents, setRecents] = useState<string[]>(readRecents);
	/** A destructive command waiting for the user to confirm it in the card above the box. */
	const [confirm, setConfirm] = useState<{ text: string; title: string; body: string }>();
	const [active, setActive] = useState(0);
	/** Query the user dismissed with Esc; a new query reopens the menu. */
	const [dismissed, setDismissed] = useState<string>();
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [dragging, setDragging] = useState(false);
	const held = useRef(0);
	held.current = attachments.length;

	useEffect(() => {
		setText(storageKey ? (safeGet(storageKey) ?? "") : "");
		setTrigger(undefined);
	}, [storageKey]);

	useEffect(() => {
		if (storageKey) safeSet(storageKey, text);
	}, [storageKey, text]);

	useEffect(() => {
		if (restore === undefined) return;
		setText(restore);
		onRestored?.();
	}, [restore, onRestored]);

	// 主機把範例提示推進來：填入並把焦點交回輸入框，讓使用者可以立刻改字。
	useEffect(() => {
		if (prefill === undefined) return;
		setText(prefill);
		setTrigger(undefined);
		ref.current?.focus();
	}, [prefill]);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
	}, [text]);

	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus, draftKey]);

	/**
	 * Recompute the trigger from the text before the caret. Reads the DOM value
	 * when none is passed: a `select` event that follows an `input` event would
	 * otherwise see the previous React state and clear the trigger it just set.
	 */
	const detect = (value?: string) => {
		const el = ref.current;
		const current = value ?? el?.value ?? text;
		const caret = el && el.selectionStart !== null ? el.selectionStart : current.length;
		const before = current.slice(0, caret);
		const command = /^\/([^\s/]*)$/.exec(before);
		if (command && commands.length > 0) {
			setTrigger({ kind: "command", query: command[1], name: command[1], key: `c:${command[1]}`, start: 0, end: caret });
			return;
		}
		// `/name ` or `/name re`: the second level, filtered by whatever follows the space.
		const withSub = /^\/([^\s/]*)\s+(\S*)$/.exec(before);
		if (withSub && commands.length > 0) {
			setTrigger({ kind: "sub", query: withSub[2], name: withSub[1], sub: withSub[2], key: `s:${withSub[1]} ${withSub[2]}`, start: 0, end: caret });
			return;
		}
		const file = /(?:^|\s)@([^\s@]*)$/.exec(before);
		if (file && fileCwd) {
			setTrigger({ kind: "file", query: file[1], key: `f:${file[1]}`, start: caret - file[1].length - 1, end: caret });
			return;
		}
		setTrigger(undefined);
	};

	// `@` file search, debounced so typing does not fire a request per keystroke.
	useEffect(() => {
		if (trigger?.kind !== "file" || !fileCwd) return;
		const { query } = trigger;
		let alive = true;
		setFileSearched(false);
		const timer = setTimeout(() => {
			void searchFiles(fileCwd, query).then(items => {
				if (!alive) return;
				setFileItems(items);
				setFileSearched(true);
				setActive(0);
			});
		}, 150);
		return () => {
			alive = false;
			clearTimeout(timer);
		};
	}, [trigger?.kind, trigger?.query, fileCwd]);

	const rows = useMemo(() => (trigger && trigger.kind !== "file" ? buildRows(commands, { name: trigger.name ?? "", sub: trigger.sub }, recents, state, guidance ? (Object.keys(guidance) as GuideAction[]) : []) : []), [trigger, commands, recents, state, guidance]);
	const stops = useMemo(() => selectableOf(rows), [rows]);
	/** What the arrow keys walk through: menu rows for `/`, file hits for `@`. */
	const choices = trigger?.kind === "file" ? fileItems.length : stops.length;
	// 檔案搜尋回來了卻一個都沒有：還是把選單開著，讓使用者知道「找到了 0 個」
	// 而不是「按了沒反應」。
	const noFileMatch = trigger?.kind === "file" && fileSearched && fileItems.length === 0;
	const menuOpen = Boolean(trigger) && (choices > 0 || rows.length > 0 || noFileMatch) && dismissed !== trigger?.key;

	// A new query or another level starts the highlight at the top.
	useEffect(() => setActive(0), [trigger?.kind, trigger?.query]);

	/** What the command still needs, shown in gray after the text until the user types it. */
	const ghost = useMemo(() => {
		const find = (word: string) => commands.find(c => c.name.toLowerCase() === word || commandKey(c).toLowerCase() === word);
		const one = /^\/(\S+) $/.exec(text);
		if (one) return hintText(find(one[1].toLowerCase())?.input?.hint);
		const two = /^\/(\S+)\s+(\S+) $/.exec(text);
		if (two) {
			const sub = find(two[1].toLowerCase())?.subcommands?.find(s => s.name.toLowerCase() === two[2].toLowerCase());
			return sub?.usage ? hintText(sub.usage) : "";
		}
		return "";
	}, [text, commands]);

	const addFiles = (files: Iterable<File>) => {
		const picked = [...files].filter(file => file.type.startsWith("image/"));
		if (picked.length === 0) return;
		let room = MAX_IMAGES - held.current;
		for (const file of picked) {
			if (room <= 0) {
				onNotice?.(t("chat.maxImages", { n: MAX_IMAGES }), "warning");
				break;
			}
			if (file.size > MAX_IMAGE_BYTES) {
				onNotice?.(t("chat.imageTooLarge", { name: file.name || t("chat.unnamed") }), "warning");
				continue;
			}
			room--;
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = String(reader.result ?? "");
				const comma = dataUrl.indexOf(",");
				if (comma < 0) return;
				const attachment: Attachment = {
					id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
					dataUrl,
					image: { type: "image", data: dataUrl.slice(comma + 1), mimeType: file.type || "image/png" },
				};
				setAttachments(current => (current.length >= MAX_IMAGES ? current : [...current, attachment]));
			};
			reader.readAsDataURL(file);
		}
	};

	/** Replace the trigger text and park the caret right after it. */
	const commit = (insert: string) => {
		if (!trigger) return;
		const next = text.slice(0, trigger.start) + insert + text.slice(trigger.end);
		const caret = trigger.start + insert.length;
		setText(next);
		setTrigger(undefined);
		setDismissed(undefined);
		requestAnimationFrame(() => {
			const el = ref.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(caret, caret);
		});
	};

	const chooseFile = (item: SuggestItem) => commit(item.insert);

	const chooseRow = (row: MenuRow) => {
		if (!trigger || row.kind === "group" || row.kind === "head" || row.kind === "warn") return;
		if (row.kind === "guide") {
			setText("");
			if (storageKey) safeSet(storageKey, "");
			setTrigger(undefined);
			guidance?.[row.action]?.();
			return;
		}
		if (pickAction(row) === "run") {
			setTrigger(undefined);
			submit("prompt", row.kind === "sub" ? `/${trigger.name} ${row.sub.name}` : `/${row.rank.command.name}`);
			return;
		}
		commit(row.kind === "sub" ? `/${trigger.name} ${row.sub.name} ` : `/${row.rank.command.name} `);
	};

	const pick = (index: number) => {
		if (trigger?.kind === "file") {
			const item = fileItems[index];
			if (item) chooseFile(item);
			return;
		}
		const stop = stops[index];
		if (stop) chooseRow(stop.row);
	};

	/** A built-in command whose subcommand destroys something; omp runs it without asking, so we do. */
	const destructiveOf = (value: string): { title: string; body: string } | undefined => {
		const m = /^\/(\S+)\s+(\S+)$/.exec(value.trim());
		if (!m) return undefined;
		const word = m[1].toLowerCase();
		const command = commands.find(c => c.name.toLowerCase() === word || commandKey(c).toLowerCase() === word);
		if (!command) return undefined;
		const sub = command.subcommands?.find(s => s.name.toLowerCase() === m[2].toLowerCase());
		if (!sub || !isDestructive(command, sub.name)) return undefined;
		const why = subTitleOf(commandKey(command), sub.name, sub.description) ?? (sub.description ?? "").replace(/\s+/g, " ");
		return { title: t("chat.confirmTitle", { cmd: command.name, sub: sub.name }), body: `${why ? `${why}${t("chat.clauseSep")}` : ""}${t("chat.irreversible")}` };
	};

	const submit = (mode: SendMode, override?: string, forced = false) => {
		const value = (override ?? text).trim();
		if (!value || disabled) return;
		if (!forced) {
			const danger = destructiveOf(value);
			if (danger) {
				setConfirm({ text: value, ...danger });
				return;
			}
		}
		const word = commandWord(value);
		if (word && commands.some(c => c.name.toLowerCase() === word || commandKey(c).toLowerCase() === word)) setRecents(rememberRecent(word));
		const images = attachments.map(a => a.image);
		setConfirm(undefined);
		setText("");
		// Clear the saved draft now: sending can navigate away (home → new session)
		// and unmount this composer before the effect that persists `text` runs.
		if (storageKey) safeSet(storageKey, "");
		setAttachments([]);
		setTrigger(undefined);
		void onSend(value, mode, images.length > 0 ? images : undefined);
	};

	return (
		<div
			className={`composer ${dragging ? "dragging" : ""}`}
			onDragOver={e => {
				if (![...(e.dataTransfer?.items ?? [])].some(i => i.kind === "file")) return;
				e.preventDefault();
				setDragging(true);
			}}
			onDragLeave={e => {
				if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
				setDragging(false);
			}}
			onDrop={e => {
				e.preventDefault();
				setDragging(false);
				addFiles(e.dataTransfer?.files ?? []);
			}}
		>
			{above}
			{attachments.length > 0 && (
				<>
					<div className="attach-row">
						{attachments.map(a => (
							<div key={a.id} className="attach">
								<img src={a.dataUrl} alt="" />
								<button className="rm" title={t("chat.removeImage")} onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}>
									<Icon name="x" size={11} strokeWidth={2.6} />
								</button>
							</div>
						))}
					</div>
					{modelSupportsImages === false && (
						<div className="attach-note">
							<Icon name="alert" size={12} />
							{t("chat.noImageSupport")}
						</div>
					)}
				</>
			)}
			{confirm && (
				<div className="confirm-card">
					<div className="q-title">{confirm.title}</div>
					<div className="q-msg">{confirm.body}</div>
					<div className="foot">
						<button
							className="btn"
							onClick={() => {
								setConfirm(undefined);
								ref.current?.focus();
							}}
						>
							{t("chat.cancel")}
						</button>
						<button className="btn primary" onClick={() => submit("prompt", confirm.text, true)}>
							{t("chat.execute")}
						</button>
					</div>
				</div>
			)}
			{menuOpen && (trigger?.kind === "file" ? <SuggestMenu items={fileItems} active={active} onHover={setActive} onPick={chooseFile} emptyNote={t("chat.noFileMatch")} /> : <CommandMenu rows={rows} active={active} onHover={setActive} onPick={chooseRow} />)}
			{/* A phone has no Shift or Alt and no room for a hint, so the hosts' shortcut-laden
			    placeholder is ignored there in favour of one short label. */}
			<textarea
				ref={ref}
				rows={1}
				value={text}
				disabled={disabled}
				placeholder={isTouch() ? t("chat.placeholderTouch") : placeholder ?? (running ? t("chat.placeholderSteer") : t("chat.placeholderIdle"))}
				onChange={e => {
					setText(e.target.value);
					setConfirm(undefined);
					detect(e.target.value);
				}}
				onSelect={() => detect()}
				onPaste={e => {
					const images = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith("image/"));
					if (images.length === 0) return;
					e.preventDefault();
					addFiles(images);
				}}
				onCompositionStart={() => (composing.current = true)}
				onCompositionEnd={() => (composing.current = false)}
				onKeyDown={e => {
					if (menuOpen && (choices > 0 || e.key === "Escape") && !composing.current && !e.nativeEvent.isComposing) {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setActive(i => (i + 1) % choices);
							return;
						}
						if (e.key === "ArrowUp") {
							e.preventDefault();
							setActive(i => (i - 1 + choices) % choices);
							return;
						}
						if (e.key === "Enter" || e.key === "Tab") {
							e.preventDefault();
							pick(active);
							return;
						}
						if (e.key === "Escape") {
							e.preventDefault();
							setDismissed(trigger?.key);
							return;
						}
					}
					if (e.key !== "Enter" || e.shiftKey || composing.current || e.nativeEvent.isComposing) return;
					// ⌘/Ctrl+Enter 永遠送出：它是唯一在觸控鍵盤上也拿得到的「明確送出」手勢，
					// 而且在輸入框有焦點時會先被輸入框吃掉。
					if (e.metaKey || e.ctrlKey) {
						e.preventDefault();
						submit(running ? (e.altKey ? "followUp" : "steer") : "prompt");
						return;
					}
					// A phone keyboard has no Shift or Alt and no room for a hint: Enter types a
					// newline there, and the send button is the only way to send.
					if (isTouch()) return;
					e.preventDefault();
					submit(running ? (e.altKey ? "followUp" : "steer") : "prompt");
				}}
			/>
			{ghost && (
				<div className="composer-mirror" aria-hidden="true">
					{text}
					<span className="ghost">{ghost}</span>
				</div>
			)}
			<div className="composer-bar">
				{left}
				<span className="grow" />
				<div className="composer-right">{right}</div>
				<button className="icon-btn" title={t("chat.addImage")} onClick={() => filePicker.current?.click()}>
					<Icon name="plus" size={16} />
				</button>
				<input
					ref={filePicker}
					type="file"
					accept="image/*"
					multiple
					hidden
					onChange={e => {
						addFiles(e.target.files ?? []);
						e.target.value = "";
					}}
				/>
				{running && !text.trim() ? (
					<button className="send" onClick={onStop} title={t("chat.stopEsc")}>
						<Icon name="stop" size={13} strokeWidth={2.4} />
					</button>
				) : (
					<button className="send" disabled={!text.trim() || disabled} onClick={() => submit(running ? "steer" : "prompt")} title={t("chat.send")}>
						<Icon name="arrowUp" size={16} strokeWidth={2.2} />
					</button>
				)}
			</div>
		</div>
	);
}

function safeGet(k: string): string | null {
	try {
		return sessionStorage.getItem(k);
	} catch {
		return null;
	}
}

function safeSet(k: string, v: string): void {
	try {
		if (v) sessionStorage.setItem(k, v);
		else sessionStorage.removeItem(k);
	} catch {
		// unavailable
	}
}
