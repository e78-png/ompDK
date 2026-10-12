/**
 * The one narrow-screen breakpoint.
 *
 * The stylesheet, the drawer and the right panel all have to agree on it, so it is written
 * once here and the CSS uses the same number (760px). `isNarrow` is for event handlers,
 * which cannot wait for a render.
 */
import { useSyncExternalStore } from "react";

export const NARROW_QUERY = "(max-width: 760px)";
/** A finger, not a mouse: no hover, no reliable Shift/Alt, and a keyboard that covers the page. */
export const TOUCH_QUERY = "(pointer: coarse)";

const narrow = window.matchMedia(NARROW_QUERY);
const touch = window.matchMedia(TOUCH_QUERY);

function subscribe(listener: () => void): () => void {
	narrow.addEventListener("change", listener);
	return () => narrow.removeEventListener("change", listener);
}

export function useNarrow(): boolean {
	return useSyncExternalStore(subscribe, () => narrow.matches);
}

export function isNarrow(): boolean {
	return narrow.matches;
}

/** Read at the moment a key or pointer event arrives, not at render time. */
export function isTouch(): boolean {
	return touch.matches;
}

/**
 * iOS Safari leaves the layout viewport at its full height when the software keyboard opens,
 * so the composer would sit behind the keyboard. `visualViewport` is the part actually on
 * screen: publish it as `--app-h` and scroll back to the top after every change, since Safari
 * also pushes the whole page up and takes the header with it.
 *
 * Android does not need this: `interactive-widget=resizes-content` in the viewport meta
 * already shrinks the layout viewport there.
 */
export function watchViewportHeight(): () => void {
	const view = window.visualViewport;
	if (!touch.matches || !view) return () => undefined;
	const apply = () => {
		document.documentElement.style.setProperty("--app-h", `${Math.round(view.height)}px`);
		window.scrollTo(0, 0);
	};
	apply();
	view.addEventListener("resize", apply);
	view.addEventListener("scroll", apply);
	return () => {
		view.removeEventListener("resize", apply);
		view.removeEventListener("scroll", apply);
		document.documentElement.style.removeProperty("--app-h");
	};
}
