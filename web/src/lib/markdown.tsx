import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { Marked } from "marked";
import type { Token, TokensList } from "marked";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { KATEX_ALLOWED_ATTRS, KATEX_ALLOWED_TAGS, mathExtensions, mathTokenizer } from "./math.ts";
import { copyText } from "./clipboard.ts";

function markdownParser(highlight: boolean): Marked {
	const parser = new Marked({
		gfm: true,
		breaks: false,
		renderer: {
			code({ text, lang }) {
				const language = (lang ?? "").trim().split(/\s+/)[0];
				const html = highlight && language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
				const label = language ? `<span class="code-lang">${escapeHtml(language)}</span>` : "";
				return `<div class="code-block"><div class="code-head">${label}<button class="code-copy" type="button" data-copy>复制</button></div><pre><code class="hljs">${html}</code></pre></div>`;
			},
			link({ href, text }) {
				return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${text}</a>`;
			},
		},
	});
	parser.use({ extensions: mathExtensions, tokenizer: mathTokenizer });
	return parser;
}

const marked = markdownParser(true);
const streamingMarked = markdownParser(false);

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

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
export function renderMarkdown(text: string, breaks = false): string {
	return sanitize(marked.parse(text, { async: false, breaks }) as string);
}

function sanitize(html: string): string {
	return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-copy", ...KATEX_ALLOWED_ATTRS], ADD_TAGS: KATEX_ALLOWED_TAGS });
}

/** Completed blocks retain their HTML; an unfinished table/list/code block is parsed again. */
class StreamingMarkdown {
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
			return { key, html: sanitize(streamingMarked.parser(block, parserOptions)) };
		});
		return this.#blocks.map(block => block.html).join("");
	}
}

function onClick(e: React.MouseEvent<HTMLDivElement>): void {
	const btn = (e.target as HTMLElement).closest("[data-copy]");
	if (!btn) return;
	const code = btn.closest(".code-block")?.querySelector("code")?.textContent ?? "";
	void copyText(code).then(ok => {
		if (!ok) return;
		btn.textContent = "已复制";
		setTimeout(() => (btn.textContent = "复制"), 1200);
	});
}

export const Markdown = memo(function Markdown({ text, className, live, breaks }: { text: string; className?: string; live?: boolean; breaks?: boolean }) {
	const [sample, setSample] = useState(text);
	const latest = useRef(text);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const stream = useRef<StreamingMarkdown | undefined>(undefined);
	latest.current = text;
	useEffect(() => {
		if (!live) {
			clearTimeout(timer.current);
			timer.current = undefined;
			stream.current = undefined;
			setSample(text);
			return;
		}
		if (timer.current) return;
		timer.current = setTimeout(() => {
			timer.current = undefined;
			setSample(latest.current);
		}, 120);
	}, [text, live]);
	useEffect(() => () => clearTimeout(timer.current), []);
	const html = useMemo(() => {
		if (!live) return renderMarkdown(text, breaks);
		stream.current ??= new StreamingMarkdown();
		return stream.current.render(sample, breaks);
	}, [live ? sample : text, live, breaks]);
	return <div className={`md ${className ?? ""}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});
