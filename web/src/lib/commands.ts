/**
 * 命令面板的動作目錄。
 *
 * 為什麼獨立成一個沒有 DOM 依賴的模組：命令面板的正確性（每個動作有代號、
 * 有標籤、搜尋找得到、快捷鍵不重複）是可以用單元測試驗證的，不需要開瀏覽器。
 * 真正把畫面接上的是 `components/CommandPalette.tsx`。
 *
 * 為什麼動作用「資料 + 回呼」描述而不是 switch：面板的內容會隨著功能增加，
 * switch 每加一個功能就要改一個地方；目錄式的描述只要多一筆就多一個動作。
 */
import type { MessageKey } from "./i18n/index.ts";
import { type ShortcutCombo, shortcutById } from "./shortcuts.ts";

/** 一個面板動作。 */
export interface CommandAction {
	/** 穩定代號；同一次執行裡不可重複。 */
	id: string;
	/** 顯示文字（已經翻譯）。 */
	label: string;
	/** 次要說明，顯示在標籤下面。 */
	hint?: string;
	/** 分組標題；同一組的動作排在一起。 */
	group: string;
	/**
	 * 快捷鍵的代號（`lib/shortcuts.ts` 裡的 `id`）。
	 *
	 * 為什麼不直接寫按法：按法只該在那一張表裡定義一次，否則面板顯示的
	 * 和實際按的會慢慢不一樣。
	 */
	shortcutId?: string;
	/** 額外關鍵字；搜尋時一併比對。 */
	keywords?: string[];
	/** 執行。 */
	run: () => void;
}

/**
 * 面板需要觸碰的外部功能。
 *
 * 為什麼用介面注入而不是直接 import app-store：app-store 會在模組載入時
 * 讀 localStorage，單元測試跑不起來；而且這個面板將來也不一定只服務 app-store。
 */
export interface CommandContext {
	/** 翻譯。 */
	translate: (key: MessageKey, params?: Record<string, string | number>) => string;
	/** 側欄的會話清單（用來做「跳到某個會話」）。 */
	sessions: { path: string; title: string }[];
	/** 新會話。 */
	newChat: () => void;
	/** 開啟插件頁。 */
	openPlugins: () => void;
	/** 開啟設定。 */
	openSettings: () => void;
	/** 切換側欄的收合。 */
	toggleSidebar: () => void;
	/** 切換側欄模式（時間／項目）。 */
	toggleSidebarMode: () => void;
	/** 切換主題（亮／暗）。 */
	toggleTheme: () => void;
	/** 重新讀取會話清單。 */
	refresh: () => void;
	/** 跳到某個會話。 */
	gotoSession: (path: string) => void;
	/**
	 * 切到「快捷鍵說明」。
	 *
	 * 為什麼是選用的：面板自己帶著這個說明頁，全域快捷鍵的綁定則不需要它，
	 * 所以沒有面板的呼叫端不必提供。
	 */
	showShortcuts?: () => void;
}

/** 最多列出幾個「跳到最近會話」；再多面板就變成清單了。 */
const JUMP_LIMIT = 8;

/**
 * 建立面板的動作目錄。
 *
 * 為什麼把「跳到會話」做成動態的：使用者找會話的頻率比找設定高，
 * 而面板就是「鍵盤的快速跳轉」該有的樣子。
 */
export function createCommands(ctx: CommandContext): CommandAction[] {
	const t = ctx.translate;
	const jumps = ctx.sessions.slice(0, JUMP_LIMIT).map<CommandAction>(s => ({
		id: `session.open:${s.path}`,
		label: s.title,
		hint: t("chrome.cmd.jumpToHint"),
		group: t("chrome.cmd.group.sessions"),
		keywords: [s.path],
		run: () => ctx.gotoSession(s.path),
	}));

	return [
		{
			id: "session.new",
			label: t("chrome.cmd.newChat"),
			group: t("chrome.cmd.group.navigate"),
			keywords: ["new", "chat", "session", "新", "会话"],
			run: ctx.newChat,
		},
		...jumps,
		{
			id: "view.plugins",
			label: t("chrome.cmd.plugins"),
			group: t("chrome.cmd.group.navigate"),
			keywords: ["plugin", "skill", "插件", "技能"],
			run: ctx.openPlugins,
		},
		{
			id: "view.settings",
			label: t("chrome.cmd.settings"),
			group: t("chrome.cmd.group.navigate"),
			shortcutId: "open-settings",
			keywords: ["settings", "preferences", "设置"],
			run: ctx.openSettings,
		},
		{
			id: "view.sidebar",
			label: t("chrome.cmd.toggleSidebar"),
			group: t("chrome.cmd.group.view"),
			shortcutId: "toggle-sidebar",
			keywords: ["sidebar", "collapse", "侧栏", "收起"],
			run: ctx.toggleSidebar,
		},
		{
			id: "view.sidebarMode",
			label: t("chrome.cmd.toggleSidebarMode"),
			group: t("chrome.cmd.group.view"),
			shortcutId: "sidebar-mode",
			keywords: ["mode", "time", "project", "模式", "时间", "项目"],
			run: ctx.toggleSidebarMode,
		},
		{
			id: "view.theme",
			label: t("chrome.cmd.toggleTheme"),
			group: t("chrome.cmd.group.view"),
			shortcutId: "toggle-theme",
			keywords: ["theme", "dark", "light", "主题", "深色", "浅色"],
			run: ctx.toggleTheme,
		},
		{
			id: "app.refresh",
			label: t("chrome.cmd.refresh"),
			group: t("chrome.cmd.group.app"),
			shortcutId: "refresh",
			keywords: ["reload", "refresh", "重整", "重新载入"],
			run: ctx.refresh,
		},
		{
			id: "help.shortcuts",
			label: t("chrome.cmd.showShortcuts"),
			group: t("chrome.cmd.group.help"),
			keywords: ["shortcut", "key", "help", "快捷键", "说明"],
			run: () => ctx.showShortcuts?.(),
		},
	];
}

/** 動作的按鍵組合；沒有綁快捷鍵的動作回傳 undefined。 */
export function comboOf(action: CommandAction): ShortcutCombo | undefined {
	return action.shortcutId ? shortcutById(action.shortcutId)?.combo : undefined;
}

/**
 * 依關鍵字過濾動作。
 *
 * 為什麼標籤、說明、關鍵字都比對：使用者記得的是「关掉侧栏」而不是某個 id，
 * 但偶爾也會記得檔名路徑。
 */
export function filterCommands(actions: CommandAction[], query: string): CommandAction[] {
	const q = query.trim().toLowerCase();
	if (!q) return actions;
	return actions.filter(a => {
		const haystack = [a.label, a.hint ?? "", ...(a.keywords ?? [])].join(" ").toLowerCase();
		return haystack.includes(q);
	});
}

/**
 * 把動作綁到快捷鍵上；同一組組合只綁第一個。
 *
 * 為什麼要有這個：面板裡的動作和全域快捷鍵是兩份來源，如果不小心重複，
 * 按一次會觸發兩個動作。所以衝突時保留先出現的那個，後面的就不綁。
 */
export function bindShortcuts(actions: CommandAction[]): Map<ShortcutCombo, CommandAction> {
	const bound = new Map<ShortcutCombo, CommandAction>();
	for (const action of actions) {
		const combo = comboOf(action);
		if (!combo) continue;
		if (bound.has(combo)) continue;
		bound.set(combo, action);
	}
	return bound;
}

/** 找出被重複使用的快捷鍵代號（給測試與除錯用）。 */
export function shortcutConflicts(actions: CommandAction[]): string[] {
	const seen = new Set<string>();
	const dupes = new Set<string>();
	for (const action of actions) {
		if (!action.shortcutId) continue;
		if (seen.has(action.shortcutId)) dupes.add(action.shortcutId);
		seen.add(action.shortcutId);
	}
	return [...dupes];
}
