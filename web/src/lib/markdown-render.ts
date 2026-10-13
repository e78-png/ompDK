/**
 * The Markdown → HTML pipeline, with no DOM and no React: `marked`, the code and math
 * renderers, and the streaming block cache.
 *
 * It lives apart from `markdown.tsx` because the same pipeline runs in a worker. DOMPurify
 * cannot go with it — it needs a document — so the sanitizing step stays on the page, and
 * everything above it can be handed a thread of its own when the source is long enough to
 * matter (a 50 KB answer costs hundreds of milliseconds of lexing on the main thread).
 */
import hljs from "highlight.js/lib/common";
import { Marked } from "marked";
import type { Token, TokensList } from "marked";
import { mathExtensions, mathTokenizer } from "./math.ts";
import { t } from "./i18n/index.ts";

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function markdownParser(highlight: boolean): Marked {
	const parser = new Marked({
		gfm: true,
		breaks: false,
		renderer: {
			code({ text, lang }) {
				const language = (lang ?? "").trim().split(/\s+/)[0];
				const html = highlight && language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
				const label = language ? `<span class="code-lang">${escapeHtml(language)}</span>` : "";
				return `<div class="code-block"><div class="code-head">${label}<button class="code-copy" type="button" data-copy>${copyLabel()}</button></div><pre><code class="hljs">${html}</code></pre></div>`;
			},
			link({ href, text }) {
				return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${text}</a>`;
			},
		},
	});
	parser.use({ extensions: mathExtensions, tokenizer: mathTokenizer });
	return parser;
}

/** The copy button's own label; the page and the worker share the same catalog. */
function copyLabel(): string {
	return t("panel.md.copy");
}

const marked = markdownParser(true);
const streamingMarked = markdownParser(false);

const EXT_LANGUAGES: Record<string, string> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascript",
	json: "json",
	jsonc: "json",
	md: "markdown",
	markdown: "markdown",
	css: "css",
	scss: "scss",
	less: "less",
	html: "xml",
	htm: "xml",
	xml: "xml",
	svg: "xml",
	yml: "yaml",
	yaml: "yaml",
	py: "python",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	ps1: "powershell",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	hpp: "cpp",
	cs: "csharp",
	rb: "ruby",
	php: "php",
	sql: "sql",
	toml: "ini",
	ini: "ini",
	diff: "diff",
	patch: "diff",
};

/** highlight.js language for a file path, by extension. */
export function languageForFile(file: string): string | undefined {
	const ext = file.split(".").pop()?.toLowerCase();
	return ext ? EXT_LANGUAGES[ext] : undefined;
}

/** Highlight a whole file body; unknown languages fall back to escaped text. */
export function highlightCode(text: string, language?: string): string {
	return language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
}

/** `breaks` keeps line-oriented sources (thinking summaries) one source line per rendered line. */
export function renderText(text: string, breaks = false): string {
	return marked.parse(text, { async: false, breaks }) as string;
}

/** Completed blocks retain their HTML; an unfinished table/list/code block is parsed again. */
export class StreamingMarkdown {
	#blocks: { key: string; html: string }[] = [];
	#options = "";

	render(text: string, breaks = false): string {
		const parserOptions = { ...streamingMarked.defaults, breaks };
		const tokens = streamingMarked.lexer(text, parserOptions);
		const options = JSON.stringify([breaks, tokens.links]);
		if (options !== this.#options) this.#blocks = [];
		this.#options = options;
		this.#blocks = tokens.map((token, index) => {
			const key = JSON.stringify(token);
			const previous = this.#blocks[index];
			if (previous?.key === key) return previous;
			const block = [token] as Token[] as TokensList;
			block.links = tokens.links;
			return { key, html: streamingMarked.parser(block, parserOptions) };
		});
		return this.#blocks.map(block => block.html).join("");
	}
}
