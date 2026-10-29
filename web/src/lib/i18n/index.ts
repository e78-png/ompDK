/**
 * UI language.
 *
 * Every string the browser renders comes from here (or from a data table that has its own
 * English variant), so the setting flips the whole interface, `<html lang>` included.
 *
 * A message is a pair `[中文, English]` living in an area fragment; `t()` picks by the active
 * locale and fills `{name}` placeholders. Fragments are separate files on purpose: adding or
 * translating an area touches one file.
 */
import { setCommandLocale } from "../../../../shared/commands.ts";
import { toZhHant } from "../../../../shared/zh-hant.ts";
import { chat } from "./chat.ts";
import { chrome } from "./chrome.ts";
import { panel } from "./panel.ts";
import { settings } from "./settings.ts";
import { shell } from "./shell.ts";

/** One message: the Chinese text first, English second. */
export type Message = readonly [zh: string, en: string];
export type Fragment = Record<string, Message>;

const fragments = { ...chat, ...chrome, ...panel, ...settings, ...shell };

export type Locale = "zh" | "zh-Hant" | "en";
export type LocalePref = "system" | Locale;
export type MessageKey = keyof typeof fragments;

/**
 * Language names for the settings switch: each in its own language, except “follow the system”,
 * which has to read in whichever language is active. Callers resolve it with `pick`.
 */
export const LOCALE_LABELS: Record<LocalePref, Message> = {
	system: ["跟随系统", "Follow system"],
	zh: ["简体中文", "Simplified Chinese"],
	"zh-Hant": ["繁體中文", "繁體中文"],
	en: ["English", "English"],
};

let current: Locale = "zh";

/**
 * 瀏覽器要求的語言：台灣、香港的繁體跟中國大陸的簡體要分開，否則 zh-TW 的讀者
 * 會拿到簡體文案。
 */
function systemLocale(): Locale {
	const lang = (navigator.language || "").toLowerCase();
	if (!lang.startsWith("zh")) return "en";
	return lang.startsWith("zh-tw") || lang.startsWith("zh-hk") ? "zh-Hant" : "zh";
}

export function localeOf(pref: LocalePref): Locale {
	return pref === "system" ? systemLocale() : pref;
}

/** Called from `applyPrefs`; also keeps the document language and the command table in step. */
export function setLocale(locale: Locale): void {
	current = locale;
	document.documentElement.lang = locale === "zh" ? "zh-CN" : locale === "zh-Hant" ? "zh-TW" : "en";
	setCommandLocale(locale);
}

export function locale(): Locale {
	return current;
}

/**
 * 繁體模式的文案由簡體原文查表轉出來；表裡查不到就維持原文（新增文案在重新
 * 產生對照表之前會暫時是簡體，這是刻意的 fallback）。
 */
function localized(text: string): string {
	return current === "zh-Hant" ? toZhHant(text) : text;
}

/** One message, with `{name}` placeholders filled in. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
	// A missing key means a typo in a call site; show it instead of printing nothing.
	const message: Message | undefined = Object.hasOwn(fragments, key) ? fragments[key] : undefined;
	if (!message) return key;
	let text = current === "en" ? message[1] : localized(message[0]);
	if (!params) return text;
	for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
	return text;
}

/** For code that needs the raw pair — tool labels and command names pick a column themselves. */
export function pick(message: Message): string {
	return current === "en" ? message[1] : localized(message[0]);
}

