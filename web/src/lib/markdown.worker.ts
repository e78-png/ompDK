/**
 * Markdown → HTML for long sources, off the main thread.
 *
 * `marked` costs a couple of hundred milliseconds on a 50 KB answer, and the streaming view asks
 * for the whole draft several times a second: on the page that is a frozen conversation. The page
 * hands the text and its locale over and gets HTML back. Sanitizing stays on the page, because
 * DOMPurify needs a document.
 */
import { type Locale, setLocale } from "./i18n/index.ts";
import { escapeHtml, renderText } from "./markdown-render.ts";

interface Request {
	id: number;
	text: string;
	breaks: boolean;
	locale: Locale;
}

interface Reply {
	id: number;
	html: string;
}

/** The worker global, typed locally instead of pulling the whole `webworker` lib into the project. */
interface WorkerScope {
	onmessage: ((event: MessageEvent<Request>) => void) | null;
	postMessage: (message: Reply) => void;
}

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = event => {
	const { id, text, breaks, locale } = event.data;
	setLocale(locale);
	try {
		scope.postMessage({ id, html: renderText(text, breaks) });
	} catch (error) {
		// One bad answer must not blank the paragraph it arrived in.
		console.error("markdown render failed", error);
		scope.postMessage({ id, html: `<p>${escapeHtml(text)}</p>` });
	}
};
