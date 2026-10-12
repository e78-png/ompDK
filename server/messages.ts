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
export type Lang = "zh" | "en";
export type Msg = readonly [zh: string, en: string];

/** One message in `lang`, with `{name}` placeholders filled in. */
export function msg(lang: Lang, m: Msg, params?: Record<string, string | number>): string {
	let text = lang === "en" ? m[1] : m[0];
	if (!params) return text;
	for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
	return text;
}

/** The language of a request: only an explicit `en` asks for English, anything else reads Chinese. */
export function langOf(header: string | null | undefined): Lang {
	return header?.trim().toLowerCase() === "en" ? "en" : "zh";
}
