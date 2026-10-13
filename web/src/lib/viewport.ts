/**
 * The screen-width breakpoints, written once so the stylesheet, the drawers and the right
 * panel all agree on the same numbers: 760px for the one-column shell, 1100px for the right
 * panel floating over the conversation instead of taking a column of its own. `isNarrow` and
 * `isTouch` are for event handlers, which cannot wait for a render.
 */
import { useSyncExternalStore } from "react";

export const NARROW_QUERY = "(max-width: 760px)";
/** A finger, not a mouse: no hover, no reliable Shift/Alt, and a keyboard that covers the page. */
export const TOUCH_QUERY = "(pointer: coarse)";
/**
 * The width below which the right panel stops taking a column of its own and floats over the
 * conversation instead. The stylesheet uses the same number (1100px) for `.inspector`.
 */
export const OVERLAY_QUERY = "(max-width: 1100px)";

const narrow = window.matchMedia(NARROW_QUERY);
const touch = window.matchMedia(TOUCH_QUERY);
const overlay = window.matchMedia(OVERLAY_QUERY);

function subscribe(listener: () => void): () => void {
	narrow.addEventListener("change", listener);
	return () => narrow.removeEventListener("change", listener);
}

function subscribeOverlay(listener: () => void): () => void {
	overlay.addEventListener("change", listener);
	return () => overlay.removeEventListener("change", listener);
}

export function useNarrow(): boolean {
	return useSyncExternalStore(subscribe, () => narrow.matches);
}

export function isNarrow(): boolean {
	return narrow.matches;
}

export function useOverlayPanel(): boolean {
	return useSyncExternalStore(subscribeOverlay, () => overlay.matches);
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
