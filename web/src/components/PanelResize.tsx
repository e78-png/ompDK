import { useEffect, useRef } from "react";
import { app, useApp } from "../lib/app-store.ts";
import { PANEL_WIDTHS, panelWidth } from "../lib/preferences.ts";

/** Pointer moves update only CSS; persist once on release so chat rendering stays smooth. */
export function PanelResize({ panel }: { panel: "sidebar" | "inspector" }) {
	const a = useApp();
	const drag = useRef<{ x: number; width: number; current: number } | undefined>(undefined);
	const limits = PANEL_WIDTHS[panel];
	const field = panel === "sidebar" ? "sidebarWidth" : "inspectorWidth";
	const commit = (width: number) => app.setPrefs({ [field]: panelWidth(panel, width) });
	useEffect(() => () => document.documentElement.classList.remove("panel-resizing"), []);
	return (
		<div
			className={`panel-resize panel-resize-${panel}`}
			role="separator"
			tabIndex={0}
			aria-label={panel === "sidebar" ? "调整左侧栏宽度" : "调整右侧栏宽度"}
			aria-orientation="vertical"
			aria-valuemin={limits.min}
			aria-valuemax={limits.max}
			aria-valuenow={a.prefs[field]}
			title="拖动调整宽度，双击恢复默认"
			onPointerDown={e => {
				if (e.button !== 0) return;
				e.preventDefault();
				const width = e.currentTarget.parentElement!.getBoundingClientRect().width;
				drag.current = { x: e.clientX, width, current: width };
				e.currentTarget.setPointerCapture(e.pointerId);
				document.documentElement.classList.add("panel-resizing");
			}}
			onPointerMove={e => {
				const active = drag.current;
				if (!active) return;
				const delta = (e.clientX - active.x) * (panel === "sidebar" ? 1 : -1);
				active.current = panelWidth(panel, active.width + delta);
				document.documentElement.style.setProperty(limits.variable, `${active.current}px`);
			}}
			onLostPointerCapture={() => {
				if (!drag.current) return;
				commit(drag.current.current);
				drag.current = undefined;
				document.documentElement.classList.remove("panel-resizing");
			}}
			onDoubleClick={() => commit(limits.initial)}
			onKeyDown={e => {
				if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home") return;
				e.preventDefault();
				const delta = (e.key === "ArrowRight" ? 16 : -16) * (panel === "sidebar" ? 1 : -1);
				commit(e.key === "Home" ? limits.initial : a.prefs[field] + delta);
			}}
		/>
	);
}
