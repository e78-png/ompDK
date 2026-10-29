/**
 * Strings this gateway sends to a browser.
 *
 * Only text a page renders belongs here: an error body from `fail()`/`HttpError`, a
 * session's `proc.error`, a `notice` frame. Terminal output, everything written into a
 * file and whatever omp answers stay exactly as they are.
 *
 * A message is a pair `[中文, English]` — the same shape the front end keeps in its
 * fragments — and `msg()` picks by the caller's language. Callers get that language from
 * the request (`x-omp-web-lang`) or from the socket (`?lang=en` on the WebSocket URL), and
 * always default to Chinese so a client that says nothing sees what it saw before.
 */
import { toZhHant } from "../shared/zh-hant.ts";

export type Lang = "zh" | "zh-Hant" | "en";
export type Msg = readonly [zh: string, en: string];

/** One message in `lang`, with `{name}` placeholders filled in. */
export function msg(lang: Lang, m: Msg, params?: Record<string, string | number>): string {
	// 繁體由簡體原文查表轉出來；表裡查不到就維持原文，不讓一句新文案變成例外。
	let text = lang === "en" ? m[1] : lang === "zh-Hant" ? toZhHant(m[0]) : m[0];
	if (!params) return text;
	for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
	return text;
}

/** The language of a request: `en` asks for English, `zh-Hant` for Traditional Chinese, anything else reads Simplified Chinese. */
export function langOf(header: string | null | undefined): Lang {
	const lang = header?.trim().toLowerCase();
	if (lang === "en") return "en";
	if (lang === "zh-hant") return "zh-Hant";
	return "zh";
}

/**
 * One plain string in `lang`.
 *
 * 為什麼需要：有些文字不是訊息對，而是程式裡本來就有的句子（例如相容性檢查
 * 每一項的說明）。它沒有英文對照，但繁體使用者還是該看到繁體——繁體由查表換出來，
 * 查不到就維持原文，不讓一句新文案變成例外。
 */
export function text(lang: Lang, s: string): string {
	return lang === "zh-Hant" ? toZhHant(s) : s;
}
