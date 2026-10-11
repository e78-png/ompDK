/**
 * omp writes command output for a terminal, and some of it only reads in colour:
 * `/context`'s usage bar is the same block characters in eight greys. So the escapes
 * survive into the message and are parsed here into runs the theme can palette.
 * Anything this parser cannot reproduce falls back to the plain stripped text.
 */
import type { ReactNode } from "react";
import { stripAnsi } from "../../../shared/command-output.ts";

/** Built from codes rather than literals: an escape byte in a source file is invisible. */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

interface Style {
	fg?: number;
	bg?: number;
	bold?: boolean;
	dim?: boolean;
}

export interface AnsiRun {
	text: string;
	style: Style;
}

/** xterm's base 16, used only to fold 256-colour and truecolour codes onto it. */
const BASE16: [number, number, number][] = [
	[0, 0, 0],
	[205, 49, 49],
	[0, 188, 0],
	[205, 205, 0],
	[0, 120, 205],
	[205, 0, 205],
	[0, 205, 205],
	[229, 229, 229],
	[127, 127, 127],
	[255, 0, 0],
	[0, 255, 0],
	[255, 255, 0],
	[0, 0, 255],
	[255, 0, 255],
	[0, 255, 255],
	[255, 255, 255],
];

const CUBE = [0, 95, 135, 175, 215, 255];

/** The 256-colour palette as rgb: a 6×6×6 cube, then a 24-step grey ramp. */
function palette256(n: number): [number, number, number] {
	if (n < 16) return BASE16[n];
	if (n >= 232) {
		const v = 8 + (n - 232) * 10;
		return [v, v, v];
	}
	const i = n - 16;
	return [CUBE[Math.floor(i / 36)], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]];
}

function nearest16(rgb: [number, number, number]): number {
	let best = 0;
	let dist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < 16; i++) {
		const b = BASE16[i];
		const d = (b[0] - rgb[0]) ** 2 + (b[1] - rgb[1]) ** 2 + (b[2] - rgb[2]) ** 2;
		if (d < dist) {
			dist = d;
			best = i;
		}
	}
	return best;
}

/** One SGR parameter list folded into the running style; unknown codes leave it alone. */
function applySgr(prev: Style, params: number[]): Style {
	const next = { ...prev };
	for (let i = 0; i < params.length; i++) {
		const p = params[i];
		if (p === 0) return {};
		if (p === 1) next.bold = true;
		else if (p === 2) next.dim = true;
		else if (p === 22) next.bold = undefined;
		else if (p === 23) next.dim = undefined;
		else if (p > 29 && p < 38) next.fg = p - 30;
		else if (p > 89 && p < 98) next.fg = p - 90 + 8;
		else if (p === 39) next.fg = undefined;
		else if (p > 39 && p < 48) next.bg = p - 40;
		else if (p > 99 && p < 108) next.bg = p - 100 + 8;
		else if (p === 49) next.bg = undefined;
		else if ((p === 38 || p === 48) && params[i + 1] === 5) {
			const c = nearest16(palette256(params[i + 2] ?? 0));
			if (p === 38) next.fg = c;
			else next.bg = c;
			i += 2;
		} else if ((p === 38 || p === 48) && params[i + 1] === 2) {
			const c = nearest16([params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0]);
			if (p === 38) next.fg = c;
			else next.bg = c;
			i += 4;
		}
	}
	return next;
}

/** Read the escape at `at` (an ESC byte) and say where it ends; `sgr` is set for a colour code. */
function readEscape(text: string, at: number): { end: number; sgr?: string } {
	const kind = text[at + 1];
	if (kind === "[") {
		let i = at + 2;
		const start = i;
		while (i < text.length && text[i] >= "0" && text[i] <= "?") i++;
		const params = text.slice(start, i);
		while (i < text.length && text[i] >= " " && text[i] <= "/") i++;
		return text[i] === "m" ? { end: i + 1, sgr: params } : { end: Math.min(i + 1, text.length) };
	}
	if (kind === "]") {
		for (let i = at + 2; i < text.length; i++) {
			if (text[i] === BEL) return { end: i + 1 };
			if (text[i] === ESC && text[i + 1] === "\\") return { end: i + 2 };
		}
		return { end: text.length };
	}
	return { end: Math.min(at + 2, text.length) };
}

/** Split terminal text into styled runs. Colour state carries across runs, as a terminal keeps it. */
export function ansiRuns(text: string): AnsiRun[] {
	const runs: AnsiRun[] = [];
	let style: Style = {};
	let buf = "";
	let i = 0;
	while (i < text.length) {
		if (text[i] !== ESC) {
			buf += text[i];
			i++;
			continue;
		}
		if (buf) {
			runs.push({ text: buf, style });
			buf = "";
		}
		const e = readEscape(text, i);
		if (e.sgr !== undefined) style = applySgr(style, e.sgr.split(";").map(n => (n === "" ? 0 : Number(n))));
		i = e.end;
	}
	if (buf) runs.push({ text: buf, style });
	return runs;
}

function classOf(s: Style): string | undefined {
	const out: string[] = [];
	if (s.fg !== undefined) out.push(`a-fg-${s.fg}`);
	if (s.bg !== undefined) out.push(`a-bg-${s.bg}`);
	if (s.bold) out.push("a-b");
	if (s.dim) out.push("a-d");
	return out.length ? out.join(" ") : undefined;
}

/** The same text with no terminal markup at all: what the clipboard gets, and the worst case. */
export function ansiToText(text: string): string {
	return stripAnsi(text).replace(new RegExp("[" + ESC + BEL + "]", "g"), "");
}

/** The runs as spans, or the plain text whenever parsing and stripping disagree. */
export function ansiNodes(text: string): ReactNode {
	if (!text.includes(ESC)) return text;
	const plain = ansiToText(text);
	const runs = ansiRuns(text);
	if (runs.map(r => r.text).join("") !== plain) return plain;
	return runs.map((r, i) => (
		<span key={i} className={classOf(r.style)}>
			{r.text}
		</span>
	));
}
