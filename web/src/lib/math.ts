/**
 * Math in model answers: `\[ … \]`, `\( … \)`, `$$…$$` and `$…$` typeset with KaTeX.
 *
 * Without this the markdown lexer eats the delimiters — `\[` is an escaped bracket to
 * marked, so `\[ x^2 \]` arrives as the literal text `[ x^2 ]` and the reader sees a
 * mangled source instead of either math or its source. Tokenizing before markdown sees
 * it keeps the expression intact, and KaTeX runs offline from the bundle: no CDN, no
 * second network round trip in what is otherwise a 127.0.0.1-only app.
 *
 * A KaTeX failure returns the original source in place rather than throwing, because one
 * unsupported macro in a long answer must not blank the paragraph around it.
 */
import katex from "katex";
import { Tokenizer } from "marked";
import type { TokenizerAndRendererExtension, TokenizerObject, Tokens } from "marked";

/** KaTeX's own classes and inline styles carry the layout, so the sanitizer must keep them. */
export const KATEX_ALLOWED_ATTRS = ["style", "aria-hidden", "xmlns", "encoding", "mathvariant", "display"];

/** The MathML wrapper that keeps the original LaTeX source, which DOMPurify does not allow by default. */
export const KATEX_ALLOWED_TAGS = ["semantics", "annotation", "annotation-xml"];

function typeset(tex: string, display: boolean): string {
	try {
		// strict:"ignore" — answers put CJK and typographic dashes inside math
		// ($2009—t$), and KaTeX warns about each one. The typesetting is right and
		// there is nobody in a local web UI to act on a console warning.
		return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", output: "htmlAndMathml" });
	} catch {
		return `<code>${tex.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)}</code>`;
	}
}

/**
 * Inline `$…$` needs a guard of its own because the same character also marks money.
 * The rule is about whitespace, not about the first character: a formula may not open
 * followed by whitespace nor close preceded by it, which is exactly what 「票价 $5 和
 * $10 之间」 looks like and never what a model writes on purpose. Rejecting digits at
 * the opening instead would drop the common numeric formula (`$100$`, `$2.2$`,
 * `$30\text{s}$`) to save one prose case, so money is handled by the spacing rule, ` | `
 * marks a span straddling two cells of a table row, and a backtick marks a span that
 * jumped over inline code whose own backticks did not pair.
 */
const INLINE_DOLLAR = /^\$(?![\s$])([^$\n]{1,400}?)\$(?!\d)/;

function isProse(text: string): boolean {
	return /\s$/.test(text) || text.includes(" | ") || text.includes("`");
}

function mathToken(type: string, raw: string, text: string, display: boolean): Tokens.Generic {
	return { type, raw, text: text.trim(), display };
}

const blockMath: TokenizerAndRendererExtension = {
	name: "mathBlock",
	level: "block",
	start(src) {
		const i = src.search(/^\\\[|^(\$\$|\\\()[\s\S]*(\]\]|\\\)|\$\$)/m);
		return i < 0 ? undefined : i;
	},
	tokenizer(src) {
		const m = /^\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/.exec(src) ?? /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
		if (!m || !m[1]?.trim()) return undefined;
		return mathToken("mathBlock", m[0], m[1], true);
	},
	renderer(token) {
		return typeset(String(token.text), true);
	},
};

/** The three delimiter shapes a model uses, matched at the very start of `src`. */
function matchMath(src: string): Tokens.Generic | undefined {
	// marked reaches its strong and em rules before the text cut that would land us on
	// the `$`, so `**$0.2676^{***}$**` gets shredded into emphasis around half a
	// formula. A run that wraps exactly one formula has to be claimed here.
	const run = /^\*{1,3}/.exec(src)?.[0];
	if (run) {
		const inner = matchMath(src.slice(run.length));
		if (!inner || !src.slice(run.length + inner.raw.length).startsWith(run)) return undefined;
		return { ...inner, raw: run + inner.raw + run, emphasis: run };
	}
	const escaped = /^\\\(([\s\S]+?)\\\)/.exec(src) ?? /^\\\[([\s\S]+?)\\\]/.exec(src);
	if (escaped?.[1]?.trim()) return mathToken("mathInline", escaped[0], escaped[1], false);
	const dollars = /^\$\$([\s\S]+?)\$\$/.exec(src);
	if (dollars?.[1]?.trim()) return mathToken("mathInline", dollars[0], dollars[1], true);
	const one = INLINE_DOLLAR.exec(src);
	if (one?.[1]?.trim() && !isProse(one[1])) return mathToken("mathInline", one[0], one[1], false);
	return undefined;
}

const inlineMath: TokenizerAndRendererExtension = {
	name: "mathInline",
	level: "inline",
	start(src) {
		// marked cuts the text in front of the index returned here and then hands the
		// tokenizer exactly that slice. Pointing at a `$` the tokenizer rejects — a
		// price, a shell variable — puts the cut inside a later formula and the rest
		// of the line loses its pairing, which is how `全领域 $\to$ 核心技术` lost its
		// arrow to a `$5` further up. So only offer an index that actually tokenizes.
		for (const m of src.matchAll(/\\\(|\\\[|\$|\*{1,3}/g)) {
			const at = m.index ?? -1;
			if (at > 0 && src[at - 1] === "\\") continue;
			if (matchMath(src.slice(at))) return at;
		}
		return undefined;
	},
	tokenizer(src) {
		return matchMath(src);
	},
	renderer(token) {
		const html = typeset(String(token.text), Boolean(token.display));
		const run = token.emphasis ? String(token.emphasis) : "";
		if (run.length >= 3) return `<strong><em>${html}</em></strong>`;
		return run.length === 2 ? `<strong>${html}</strong>` : run.length === 1 ? `<em>${html}</em>` : html;
	},
};

/** Any of the four delimiter shapes, well enough for masking: the tokenizer has the final say. */
const MATH_SPAN = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|(?<!\\)\$([^$\n]+?)\$/g;

/**
 * marked consults its emphasis rule before it asks us about a position, and emphasis
 * pairs with the asterisks inside `$F = 11.47^{***}$`, which shreds the formula into
 * `<strong>$F = 11.47^{</strong>…`. Blanking only the spans that actually carry a `*`,
 * in the copy emStrong reads, leaves every other flanking decision as marked wrote it;
 * the length is preserved because emStrong slices it against the source.
 */
function maskMathStars(src: string): string {
	if (!src.includes("$") && !src.includes("\\(") && !src.includes("\\[")) return src;
	return src.replace(MATH_SPAN, span => (span.includes("*") ? "a".repeat(span.length) : span));
}

// emStrong is tried at every inline position, so the masked copy is kept per source.
let maskKey = "";
let maskValue = "";

/** Pass to `marked.use()` as `tokenizer`: keeps emphasis from eating the stars inside a formula. */
export const mathTokenizer: Pick<TokenizerObject, "emStrong"> = {
	emStrong(src, maskedSrc, prevChar) {
		const masked = maskedSrc === maskKey ? maskValue : (maskKey = maskedSrc, maskValue = maskMathStars(maskedSrc));
		// false hands the call back to marked's own rule, unchanged.
		if (masked === maskedSrc) return false;
		return Tokenizer.prototype.emStrong.call(this, src, masked, prevChar);
	},
};

/** Extensions for `marked.use()`, in block-then-inline order. */
export const mathExtensions: TokenizerAndRendererExtension[] = [blockMath, inlineMath];
