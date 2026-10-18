/**
 * omp's own notices, said in one line where the original would be dumped verbatim.
 *
 * `xd://: mounted a, b, …` — omp 18.8.6, `src/session/session-tools.ts`
 * (`#notifyXdevMountDelta`) — fires whenever the device set changes: an MCP server
 * connecting, reconnecting, or being reloaded. With a hundred-tool server that is a
 * hundred names on one line, and the web shows notices as toasts — a wall of text
 * covering the chat for as long as the toast lives. The names are the model's tool
 * registry, not something a reader scans in a toast, so a long one is said as counts
 * with a sample device name; a short one is left exactly as written.
 */
import { type Lang, type Msg, msg } from "../messages.ts";

/** The tag omp writes; kept byte for byte so the line still reads as the same subsystem. */
const XDEV_PREFIX = "xd://: ";

/** Long enough to cover two toast lines; below this the original line is already a glance. */
const KEEP_LENGTH = 96;

/** How many names a side lists before it keeps only the first as a sample. */
const SAMPLE_AFTER = 3;

const MOUNTED: Msg = ["新增 {n} 个工具", "{n} tools mounted"];
const UNMOUNTED: Msg = ["移除 {n} 个工具", "{n} tools unmounted"];
const PAREN_ALL: Msg = ["（{names}）", " ({names})"];
const PAREN_MORE: Msg = ["（{names} 等）", " ({names} etc.)"];
const NAME_SEP: Msg = ["、", ", "];
const SIDE_SEP: Msg = ["；", "; "];

interface MountDelta {
	mounted: string[];
	unmounted: string[];
}

/** The two sides omp joins with `; `, names inside one side joined with `, `. */
function parseMountNotice(text: string): MountDelta | undefined {
	if (!text.startsWith(XDEV_PREFIX)) return undefined;
	const mounted: string[] = [];
	const unmounted: string[] = [];
	for (const side of text.slice(XDEV_PREFIX.length).split("; ")) {
		const match = /^(mounted|unmounted) (.+)$/.exec(side);
		if (!match) return undefined;
		const names = match[2].split(", ").filter(Boolean);
		if (names.length === 0) return undefined;
		(match[1] === "mounted" ? mounted : unmounted).push(...names);
	}
	return mounted.length + unmounted.length > 0 ? { mounted, unmounted } : undefined;
}

function mountSide(lang: Lang, label: Msg, names: string[]): string {
	if (names.length === 0) return "";
	const all = names.length <= SAMPLE_AFTER;
	const listed = all ? names.join(msg(lang, NAME_SEP)) : names[0];
	return msg(lang, label, { n: names.length }) + msg(lang, all ? PAREN_ALL : PAREN_MORE, { names: listed });
}

/** The mount notice as one readable line; anything unrecognized passes through untouched. */
export function summarizeXdevNotice(text: string, lang: Lang): string {
	if (text.length <= KEEP_LENGTH) return text;
	const delta = parseMountNotice(text);
	if (!delta) return text;
	const sides = [mountSide(lang, MOUNTED, delta.mounted), mountSide(lang, UNMOUNTED, delta.unmounted)].filter(Boolean);
	return sides.length > 0 ? XDEV_PREFIX + sides.join(msg(lang, SIDE_SEP)) : text;
}
