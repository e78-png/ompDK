/**
 * 全域快捷鍵的對照表。
 *
 * 為什麼集中在這裡：命令面板要列���快捷鍵、鍵盤監聽要認得同一組按法，
 * 兩邊各寫一份一定會漂移。這張表是唯一的事實來源，面板與監聽都讀它。
 *
 * 為什麼用純資料（不碰 DOM）：快捷鍵的正確性可以用單元測試驗證，
 * 不必開瀏覽器。`matchesCombo()` 只吃一個形狀像 KeyboardEvent 的物件。
 */
import type { MessageKey } from "./i18n/index.ts";

/** 修飾鍵。`mod` 在 macOS 是 ⌘、在其他平台是 Ctrl。 */
export type Modifier = "mod" | "ctrl" | "alt" | "shift";

/** 修飾鍵的正規順序：`mod+ctrl+alt+shift+<鍵>`。 */
export const MODIFIER_ORDER: readonly Modifier[] = ["mod", "ctrl", "alt", "shift"];

/** 一組按鍵，寫成 "mod+k"、"mod+shift+p"、"escape"。 */
export type ShortcutCombo = string;

/** 快捷鍵條目：代號、組合、說明文字。 */
export interface ShortcutSpec {
	/** 穩定代號；命令面板與測試都靠它辨識。 */
	id: string;
	/** 按鍵組合。 */
	combo: ShortcutCombo;
	/** 說明文字的 i18n key。 */
	label: MessageKey;
}

/**
 * 全域快捷鍵。
 *
 * 只放「在任何畫面都成立」的按法；只在輸入框裡生效的（例如 Enter 送出）
 * 由各自的元件自己處理，但仍列在這裡，因為面板要把它們一起顯示。
 */
export const SHORTCUTS: readonly ShortcutSpec[] = [
	{ id: "command-palette", combo: "mod+k", label: "chrome.shortcut.palette" },
	{ id: "toggle-sidebar", combo: "mod+b", label: "chrome.shortcut.sidebar" },
	{ id: "send-message", combo: "mod+enter", label: "chrome.shortcut.send" },
	{ id: "close-overlay", combo: "escape", label: "chrome.shortcut.close" },
	{ id: "open-settings", combo: "mod+,", label: "chrome.shortcut.settings" },
	{ id: "sidebar-mode", combo: "mod+shift+s", label: "chrome.shortcut.mode" },
	{ id: "toggle-theme", combo: "mod+shift+d", label: "chrome.shortcut.theme" },
	{ id: "refresh", combo: "mod+shift+r", label: "chrome.shortcut.refresh" },
];

/** 按鍵別名：把常見的寫法正規化成 KeyboardEvent.key 的樣子。 */
const KEY_ALIASES: Record<string, string> = {
	esc: "escape",
	del: "delete",
	ins: "insert",
	up: "arrowup",
	down: "arrowdown",
	left: "arrowleft",
	right: "arrowright",
	" ": "space",
	spacebar: "space",
};

/** KeyboardEvent 只需要這幾個欄位，所以測試不必真的造事件。 */
export interface KeyEventLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

/** 分解一組按鍵；格式不對時回傳 null。 */
export function parseCombo(combo: ShortcutCombo): { mods: Modifier[]; key: string } | null {
	const parts = combo
		.trim()
		.toLowerCase()
		.split("+")
		.map(p => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return null;
	const rawKey = parts[parts.length - 1];
	const key = KEY_ALIASES[rawKey] ?? rawKey;
	if (!key) return null;
	// 最後一段必須是按鍵而不是修飾鍵：「mod+」與「mod+shift」都是寫錯了。
	if (MODIFIER_ORDER.includes(rawKey as Modifier)) return null;
	const mods: Modifier[] = [];
	for (const part of parts.slice(0, -1)) {
		if (!MODIFIER_ORDER.includes(part as Modifier)) return null;
		if (!mods.includes(part as Modifier)) mods.push(part as Modifier);
	}
	// 正規順序：mod → ctrl → alt → shift
	mods.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
	return { mods, key };
}

/** 把組合寫回正規形式；格式不對時回傳 null。 */
export function canonicalCombo(combo: ShortcutCombo): ShortcutCombo | null {
	const parsed = parseCombo(combo);
	if (!parsed) return null;
	return [...parsed.mods, parsed.key].join("+");
}

/** 事件裡的鍵名正規化（字母大小寫、空白、別名）。 */
function normalizeKey(key: string): string {
	const lower = key.toLowerCase();
	return KEY_ALIASES[lower] ?? lower;
}

/**
 * 這次按鍵是否命中某一組組合。
 *
 * 為什麼要求「修飾鍵完全相同」：Ctrl+K 與 Ctrl+Shift+K 是兩個不同的動作，
 * 只檢查「有沒有按到 Ctrl」會讓它們互相搶事件。
 */
export function matchesCombo(
	event: KeyEventLike,
	combo: ShortcutCombo,
	options: { mac?: boolean } = {},
): boolean {
	const parsed = parseCombo(combo);
	if (!parsed) return false;
	if (normalizeKey(event.key) !== parsed.key) return false;

	const mac = options.mac ?? false;
	const pressed = new Set<string>();
	if (event.ctrlKey) pressed.add("ctrl");
	if (event.metaKey) pressed.add("meta");
	if (event.altKey) pressed.add("alt");
	if (event.shiftKey) pressed.add("shift");

	const wanted = new Set<string>();
	for (const mod of parsed.mods) {
		if (mod === "mod") wanted.add(mac ? "meta" : "ctrl");
		else wanted.add(mod);
	}
	if (pressed.size !== wanted.size) return false;
	for (const mod of wanted) if (!pressed.has(mod)) return false;
	return true;
}

/** 面板上顯示的按法：macOS 用符號，其他平台用文字。 */
export function formatCombo(combo: ShortcutCombo, mac = false): string {
	const parsed = parseCombo(combo);
	if (!parsed) return combo;
	const symbols: Record<string, string> = mac
		? { mod: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" }
		: { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
	const keys: Record<string, string> = {
		escape: "Esc",
		enter: "Enter",
		space: "Space",
		backspace: "Backspace",
		delete: "Delete",
		arrowup: "↑",
		arrowdown: "↓",
		arrowleft: "←",
		arrowright: "→",
		tab: "Tab",
	};
	const parts = parsed.mods.map(mod => symbols[mod]);
	const key = keys[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
	return mac ? [...parts, key].join("") : [...parts, key].join("+");
}

/** 依代號找一條快捷鍵。 */
export function shortcutById(id: string): ShortcutSpec | undefined {
	return SHORTCUTS.find(s => s.id === id);
}

/**
 * 這台機器是不是 macOS。
 *
 * 為什麼要知道：`mod` 在 macOS 是 ⌘、在其他平台是 Ctrl；面板上顯示的按法
 * 也因此不同。放在這裡是因為「哪個按鍵是 mod」是同一個問題的兩面。
 */
export function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
}
