/** Browser preferences and their persistence/appearance boundary. */
import { type LocalePref, localeOf, setLocale } from "./i18n/index.ts";

export type Theme = "system" | "light" | "dark";
export type InspectorTab = "info" | "agents" | "files" | "changes";
export type ProjectFilter = "all" | "manual" | "recent";
export type UiFont = "system" | "yahei" | "harmony";
export type CodeFont = "jetbrains" | "cascadia" | "consolas";
export type ColWidth = "narrow" | "normal" | "wide";

export const PANEL_WIDTHS = {
	sidebar: { min: 220, max: 520, initial: 268, variable: "--sidebar-w" },
	inspector: { min: 300, max: 720, initial: 400, variable: "--inspector-w" },
} as const;

export function panelWidth(panel: keyof typeof PANEL_WIDTHS, value: number): number {
	const limits = PANEL_WIDTHS[panel];
	return Number.isFinite(value) ? Math.min(limits.max, Math.max(limits.min, value)) : limits.initial;
}

const UI_FONTS: Record<UiFont, string> = {
	system: `"Inter", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`,
	yahei: `"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif`,
	harmony: `"HarmonyOS Sans SC", "MiSans", "Microsoft YaHei UI", "PingFang SC", sans-serif`,
};
const CODE_FONTS: Record<CodeFont, string> = {
	jetbrains: `"JetBrains Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace`,
	cascadia: `"Cascadia Code", "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace`,
	consolas: `Consolas, "Courier New", "Microsoft YaHei UI", monospace`,
};
const COL_WIDTHS: Record<ColWidth, string> = { narrow: "680px", normal: "780px", wide: "960px" };

export interface Prefs {
	/** Interface language; `system` follows the browser. */
	locale: LocalePref;
	theme: Theme;
	fontSize: "s" | "m" | "l" | "xl";
	uiFont: UiFont;
	codeFont: CodeFont;
	colWidth: ColWidth;
	/** Browser notification while the tab is in the background. */
	notify: boolean;
	/** What Enter does while a run is active; Alt+Enter does the other. */
	enterWhileRunning: "steer" | "followUp";
	autoOpenAgents: boolean;
	lastProject?: string;
	sidebarCollapsed: boolean;
	sidebarWidth: number;
	inspectorWidth: number;
	inspectorOpen: boolean;
	inspectorTab: InspectorTab;
	collapsedProjects: string[];
	recentCollapsed: boolean;
	dismissedRecent: string[];
	/** Models hidden from pickers, as provider/id. */
	hiddenModels: string[];
	projectFilter: ProjectFilter;
	recentDays: number;
	visibleProjects: string[];
}

export function loadPrefs(): Prefs {
	const fallback: Prefs = {
		// Chinese is the default the app was written in; the setting also offers “follow the
		// system” and English. Picking a locale is explicit, so an upgrade never flips the UI.
		locale: "zh",
		theme: "system",
		fontSize: "m",
		uiFont: "system",
		codeFont: "jetbrains",
		colWidth: "normal",
		notify: false,
		enterWhileRunning: "steer",
		autoOpenAgents: true,
		sidebarCollapsed: false,
			sidebarWidth: PANEL_WIDTHS.sidebar.initial,
			inspectorWidth: PANEL_WIDTHS.inspector.initial,
		inspectorOpen: false,
		inspectorTab: "info",
		collapsedProjects: [],
		recentCollapsed: false,
		dismissedRecent: [],
		hiddenModels: [],
		projectFilter: "all",
		recentDays: 7,
		visibleProjects: [],
	};
	try {
		return { ...fallback, ...(JSON.parse(localStorage.getItem("omp-web:prefs") ?? "{}") as Partial<Prefs>) };
	} catch {
		return fallback;
	}
}

export function savePrefs(prefs: Prefs): void {
	try {
		localStorage.setItem("omp-web:prefs", JSON.stringify(prefs));
	} catch {
		// Disabled or full storage must not prevent an in-memory preference change.
	}
}

export function applyPrefs(prefs: Prefs): void {
	setLocale(localeOf(prefs.locale ?? "system"));
	const root = document.documentElement;
	if (prefs.theme === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", prefs.theme);
	root.setAttribute("data-font", prefs.fontSize);
	root.style.setProperty("--font", UI_FONTS[prefs.uiFont] ?? UI_FONTS.system);
	root.style.setProperty("--mono", CODE_FONTS[prefs.codeFont] ?? CODE_FONTS.jetbrains);
	root.style.setProperty("--col", COL_WIDTHS[prefs.colWidth] ?? COL_WIDTHS.normal);
	root.style.setProperty("--sidebar-w", `${panelWidth("sidebar", prefs.sidebarWidth)}px`);
	root.style.setProperty("--inspector-w", `${panelWidth("inspector", prefs.inspectorWidth)}px`);
}
