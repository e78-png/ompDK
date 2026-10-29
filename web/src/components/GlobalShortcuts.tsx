/**
 * 全域快捷鍵與命令面板的掛載點。
 *
 * 為什麼獨立成一個元件：快捷鍵要在任何畫面都有效，所以監聽器必須活得比
 * 單一頁面久。放在 App 裡會讓 App.tsx 混進兩件不相干的事；放在這裡，
 * App 只要掛一個 `<GlobalShortcuts />` 就好。
 *
 * 為什麼 Enter 送出不在這裡：輸入框有自己的送出規則（執行中要決定是插話還是
 * 排隊），那個判斷只有 Composer 知道。面板的說明頁仍然列出這個快捷鍵。
 */
import { useEffect, useMemo, useState } from "react";
import { app, useApp } from "../lib/app-store.ts";
import { type CommandAction, bindShortcuts, createCommands } from "../lib/commands.ts";
import { SHORTCUTS, matchesCombo } from "../lib/shortcuts.ts";
import { t } from "../lib/i18n/index.ts";
import { CommandPalette } from "./CommandPalette.tsx";

export function GlobalShortcuts() {
	const a = useApp();
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);

	const actions = useMemo<CommandAction[]>(
		() =>
			createCommands({
				translate: t,
				sessions: a.sessions.map(s => ({ path: s.path, title: s.title })),
				newChat: () => app.open(undefined),
				openPlugins: () => app.openPlugins(),
				openSettings: () => app.openSettings(),
				toggleSidebar: () => app.setPrefs({ sidebarCollapsed: !a.prefs.sidebarCollapsed }),
				toggleSidebarMode: () => app.setPrefs({ sidebarMode: a.prefs.sidebarMode === "project" ? "time" : "project" }),
				toggleTheme: () => app.setPrefs({ theme: a.prefs.theme === "dark" ? "light" : "dark" }),
				refresh: () => void app.refreshIndex(),
				gotoSession: path => app.open(path),
			}),
		[a.sessions, a.prefs.sidebarCollapsed, a.prefs.sidebarMode, a.prefs.theme],
	);

	// 面板裡的動作自己帶快捷鍵；同一組組合只綁一個。
	const bound = useMemo(() => bindShortcuts(actions), [actions]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			// 面板開著的時候，Esc 先關面板；面板的輸入框裡不需要別的處理。
			if (e.key === "Escape" && paletteOpen) {
				setPaletteOpen(false);
				return;
			}
			// 輸入框裡的按鍵交給輸入框自己處理，除非是面板的快捷鍵。
			const target = e.target as HTMLElement | null;
			const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
			if (typing && !matchesCombo(e, "mod+k")) return;
			for (const spec of SHORTCUTS) {
				if (!matchesCombo(e, spec.combo)) continue;
				if (spec.id === "command-palette") {
					e.preventDefault();
					setPaletteOpen(open => !open);
					return;
				}
				const action = bound.get(spec.combo);
				if (!action) continue;
				e.preventDefault();
				action.run();
				return;
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [bound, paletteOpen]);

	if (!paletteOpen) return null;
	return (
		<CommandPalette
			actions={actions}
			shortcuts={SHORTCUTS}
			showShortcuts={showShortcuts}
			onShowShortcuts={setShowShortcuts}
			onClose={() => setPaletteOpen(false)}
		/>
	);
}
