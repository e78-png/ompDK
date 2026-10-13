import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "./clipboard.ts";
import { locale, t } from "./i18n/index.ts";
import { escapeHtml, renderText, StreamingMarkdown } from "./markdown-render.ts";
import { KATEX_ALLOWED_ATTRS, KATEX_ALLOWED_TAGS } from "./math.ts";

function sanitize(html: string): string {
	return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-copy", ...KATEX_ALLOWED_ATTRS], ADD_TAGS: KATEX_ALLOWED_TAGS });
}

/** One bad answer must not blank the paragraph it arrived in. */
function renderOnPage(text: string, breaks = false): string {
	try {
		return renderText(text, breaks);
	} catch (error) {
		console.error("markdown render failed", error);
		return `<p>${escapeHtml(text)}</p>`;
	}
}

/**
 * Where a thread of its own starts to pay. Below this the lexer is a few milliseconds and the
 * synchronous path keeps the first paint immediate; above it, one pass is already long enough to
 * drop frames, and the streaming view pays that cost on every tick.
 */
const WORKER_MIN_CHARS = 8 * 1024;

interface Pending {
	text: string;
	breaks: boolean;
	resolve: (html: string) => void;
}

let worker: Worker | undefined;
const waiting = new Map<number, Pending>();
let nextRequest = 1;

/** Lex, render and highlight off the main thread, or on it when there is no worker to be had. */
function offThread(text: string, breaks = false): Promise<string> {
	if (typeof Worker === "undefined") return Promise.resolve(renderOnPage(text, breaks));
	const request: Pending = { text, breaks, resolve: () => undefined };
	const id = nextRequest++;
	const promise = new Promise<string>(resolve => {
		request.resolve = resolve;
	});
	waiting.set(id, request);
	const w = worker ?? new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" });
	if (worker !== w) {
		worker = w;
		w.onmessage = event => {
			const reply = event.data as { id: number; html: string };
			waiting.get(reply.id)?.resolve(reply.html);
			waiting.delete(reply.id);
		};
		// A worker that cannot even load would otherwise leave every request pending forever.
		w.onerror = () => {
			for (const stale of waiting.values()) stale.resolve(renderOnPage(stale.text, stale.breaks));
			waiting.clear();
		};
	}
	w.postMessage({ id, text, breaks, locale: locale() });
	return promise;
}

function onClick(e: React.MouseEvent<HTMLDivElement>): void {
	const btn = (e.target as HTMLElement).closest("[data-copy]");
	if (!btn) return;
	const code = btn.closest(".code-block")?.querySelector("code")?.textContent ?? "";
	void copyText(code).then(ok => {
		if (!ok) return;
		btn.textContent = t("panel.md.copied");
		setTimeout(() => (btn.textContent = t("panel.md.copy")), 1200);
	});
}

export const Markdown = memo(function Markdown({ text, className, live, breaks }: { text: string; className?: string; live?: boolean; breaks?: boolean }) {
	const [sample, setSample] = useState(text);
	const [done, setDone] = useState<{ source: string; html: string }>();
	const latest = useRef(text);
	const last = useRef({ source: "", html: "" });
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

	const source = live ? sample : text;
	const heavy = source.length >= WORKER_MIN_CHARS;
	useEffect(() => {
		if (!heavy) return;
		let alive = true;
		void offThread(source, breaks).then(html => {
			if (alive) setDone({ source, html });
		});
		return () => {
			alive = false;
		};
	}, [heavy, source, breaks]);
	const html = useMemo(() => {
		if (heavy) {
			// While the worker is busy, keep the last rendering of this same text: an answer that is
			// still growing never goes blank between two ticks, and neither does one that just ended.
			if (done?.source === source) return sanitize(done.html);
			return last.current.source && source.startsWith(last.current.source) ? last.current.html : "";
		}
		if (!live) return sanitize(renderOnPage(text, breaks));
		stream.current ??= new StreamingMarkdown();
		return sanitize(stream.current.render(sample, breaks));
	}, [heavy, done, source, live, text, sample, breaks]);
	useEffect(() => {
		last.current = { source, html };
	}, [source, html]);
	return <div className={`md ${className ?? ""}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});
