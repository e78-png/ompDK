/**
 * 命令面板：⌘/Ctrl+K 叫出來的快速動作列表。
 *
 * 為什麼要一個面板：這是「像應用」與「像網頁」最明顯的差別。網頁把功能藏在
 * 選單裡，應用把功能放在一個鍵盤隨手可達的地方。面板裡的每個動作都是
 * `lib/commands.ts` 描述出來的資料加一個回呼，所以加功能不必改面板本身。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type CommandAction, comboOf, filterCommands } from "../lib/commands.ts";
import { type ShortcutSpec, formatCombo, isMacPlatform } from "../lib/shortcuts.ts";
import { Icon } from "../lib/icons.tsx";
import { t } from "../lib/i18n/index.ts";

/** One row in the list. */
interface Row {
	action: CommandAction;
	/** Index into the action list, so the highlighted row maps back to its action. */
	index: number;
	/** The key combination this row shows, if the action has one. */
	combo?: string;
}

/**
 * 命令面板。
 *
 * 焦點陷阱是必要的：面板是一個 modal，如果 Tab 可以跑到後面的頁面上，
 * 使用者會以為面板關掉了。`onKeyDown` 把 Tab 留在面板內。
 */
export function CommandPalette({
	actions,
	shortcuts,
	showShortcuts,
	onShowShortcuts,
	onClose,
}: {
	actions: CommandAction[];
	/** 全域快捷鍵；面板的「快捷鍵說明」頁會列出它們。 */
	shortcuts: readonly ShortcutSpec[];
	/** 目前是否在「快捷鍵說明」頁。 */
	showShortcuts: boolean;
	/** 切換「快捷鍵說明」頁。 */
	onShowShortcuts: (show: boolean) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const filtered = useMemo(() => filterCommands(actions, query), [actions, query]);
	/** Rows are grouped, but the highlight walks the flat list. */
	const rows = useMemo<Row[]>(() => filtered.map((action, index) => ({ action, index, combo: comboOf(action) })), [filtered]);

	// 篩選結果變短時，原本指向的項目可能已經不存在了。
	useEffect(() => {
		setActive(0);
	}, [query]);

	useEffect(() => {
		input.current?.focus();
	}, []);

	// 選中的項目要留在視野內；面板很長的時候這一段會很長。
	useEffect(() => {
		const el = listRef.current?.querySelector<HTMLElement>(".cmd-p-row.on");
		el?.scrollIntoView({ block: "nearest" });
	}, [active, rows]);

	const run = (action: CommandAction) => {
		// 「快捷鍵說明」是面板自己的一頁，不該把面板關掉。
		if (action.id === "help.shortcuts") {
			onShowShortcuts(true);
			return;
		}
		onClose();
		action.run();
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			// 在說明頁裡，Esc 先回到命令列表，再按一次才關閉面板。
			if (showShortcuts) onShowShortcuts(false);
			else onClose();
			return;
		}
		if (showShortcuts) {
			// 說明頁沒有可選的項目，Enter 只是回到命令列表。
			if (e.key === "Enter") {
				e.preventDefault();
				onShowShortcuts(false);
			}
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive(i => (rows.length ? (i + 1) % rows.length : 0));
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive(i => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
			return;
		}
		if (e.key === "Home") {
			e.preventDefault();
			setActive(0);
			return;
		}
		if (e.key === "End") {
			e.preventDefault();
			setActive(Math.max(0, rows.length - 1));
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			const row = rows[active];
			if (row) run(row.action);
			return;
		}
		if (e.key === "Tab") {
			// 焦點陷阱：面板裡只有輸入框，留住它。
			e.preventDefault();
			input.current?.focus();
		}
	};

	// 分組依照動作自己的 group 欄位，順序是它們在目錄裡出現的順序。
	const groups = useMemo(() => {
		const map = new Map<string, Row[]>();
		for (const row of rows) {
			const list = map.get(row.action.group);
			if (list) list.push(row);
			else map.set(row.action.group, [row]);
		}
		return [...map.entries()];
	}, [rows]);

	return createPortal(
		<div className="cmd-p-scrim" onPointerDown={e => e.target === e.currentTarget && onClose()}>
			<div className="cmd-p" role="dialog" aria-modal="true" aria-label={t("chrome.cmd.title")} onKeyDown={onKeyDown}>
				<div className="cmd-p-head">
					<Icon name="search" size={15} className="muted" />
					<input
						ref={input}
						value={query}
						placeholder={t("chrome.cmd.placeholder")}
						onChange={e => setQuery(e.target.value)}
						aria-label={t("chrome.cmd.placeholder")}
					/>
					{showShortcuts && (
						<button className="cmd-p-back" onClick={() => onShowShortcuts(false)}>
							<Icon name="chevronRight" size={13} className="flip" />
							{t("chrome.cmd.back")}
						</button>
					)}
				</div>
				{showShortcuts ? (
					<div className="cmd-p-list">
						<div className="cmd-p-note">{t("chrome.cmd.shortcutsHint")}</div>
						{shortcuts.map(s => (
							<div key={s.id} className="cmd-p-shortcut">
								<span className="cmd-p-sc-label">{t(s.label)}</span>
								<span className="cmd-p-keys">{formatCombo(s.combo, isMacPlatform())}</span>
							</div>
						))}
					</div>
				) : (
					<div className="cmd-p-list" ref={listRef}>
						{groups.map(([group, list]) => (
							<div key={group} className="cmd-p-group">
								<div className="cmd-p-group-title">{group}</div>
								{list.map(row => (
									<button
										key={row.action.id}
										className={`cmd-p-row ${row.index === active ? "on" : ""}`}
										onMouseEnter={() => setActive(row.index)}
										onClick={() => run(row.action)}
									>
										<span className="cmd-p-label">{row.action.label}</span>
										{row.action.hint && <span className="cmd-p-hint">{row.action.hint}</span>}
										{row.combo && <span className="cmd-p-keys">{formatCombo(row.combo, isMacPlatform())}</span>}
									</button>
								))}
							</div>
						))}
						{rows.length === 0 && <div className="cmd-p-note">{t("chrome.cmd.empty")}</div>}
					</div>
				)}
				<div className="cmd-p-foot">{t("chrome.cmd.hint")}</div>
			</div>
		</div>,
		document.body,
	);
}
