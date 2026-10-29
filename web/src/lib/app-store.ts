/** App routing and business data; preference and session lifetimes live in their own modules. */
import { useSyncExternalStore } from "react";
import type { AgentSettings, AvailableSlashCommand, CompatCheckResult, ImageContent, LanInfo, ModelOption, OmpHealth, OmpUpdateStatus, PluginItem, ProjectInfo, SessionSummary, SkillItem } from "../../../shared/api.ts";
import { API_VERSION } from "../../../shared/api.ts";
import type { SessionStore } from "./session-store.ts";
import { applyPrefs, loadPrefs, savePrefs } from "./preferences.ts";
import type { InspectorTab, Prefs, ProjectFilter } from "./preferences.ts";
import { t } from "./i18n/index.ts";
import { PENDING_PREFIX, SessionRegistry } from "./session-registry.ts";
import { ApiError, api, gateway } from "./ws.ts";

export type { Theme, InspectorTab, ProjectFilter, UiFont, CodeFont, ColWidth } from "./preferences.ts";
export type SettingsPage = "general" | "agent" | "providers" | "archived" | "mobile" | "about";
/** Which full-page view the main area shows; `route` only carries the session key. */
export type View = "home" | "session" | "plugins";

export interface AppNotice {
	id: number;
	level: "info" | "warning" | "error";
	text: string;
}

let noticeSeq = 1;

/** Subset of omp's `ModelInfo` the picker needs. */
interface RawModel {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	contextWindow?: number | null;
	/** RPC `get_available_models` nests efforts; `omp models --json` gives the list itself. */
	thinking?: { efforts?: string[] } | string[];
}

interface RawModels {
	models?: RawModel[];
}

/** Last known model list, so the home screen can offer a picker without a session. */
function loadCachedModels(): ModelOption[] {
	try {
		const parsed = JSON.parse(localStorage.getItem("omp-web:models") ?? "[]") as unknown;
		return Array.isArray(parsed) ? (parsed as ModelOption[]) : [];
	} catch {
		return [];
	}
}

class AppStore {
	projects: ProjectInfo[] = [];
	sessions: SessionSummary[] = [];
	/** Sessions hidden from the sidebar (web-only archive). */
	archived: SessionSummary[] = [];
	indexLoaded = false;
	/** Open settings page, or undefined when the settings window is closed. */
	settingsPage: SettingsPage | undefined;
	/** Selected session key (session file path) or undefined for the home composer. */
	route: string | undefined = undefined;
	/** Which full-page view the main area shows. */
	view: View = "home";
	/** LAN mode information for the settings page, from a loopback-only endpoint. */
	lan: LanInfo | undefined;
	/** False once `/api/lan` refused: this browser is not on the machine running the gateway. */
	lanLocal: boolean | undefined;
	/** Narrow screens only: the sidebar is a drawer. Never persisted — a rotation should not keep it open. */
	drawerOpen = false;
	/** File the "改动" page should show, set by a change card's jump button. */
	inspectFile: string | undefined;
	/** Subagent selected on the right panel's "子代理" page. */
	selectedSubagent: string | undefined;
	/** Skill whose detail sheet is open, and the project its file is read from. */
	inspectSkill: { name: string; cwd: string } | undefined;
	/** Toasts that are not tied to one session (rename, export, trash). */
	notices: AppNotice[] = [];
	/** Text of a new session that failed to start; the home composer takes it back once. */
	homeRestore: string | undefined;
	/** Project chosen for the next new session on the home screen. */
	draftProject: string | undefined;
	/** Slash commands of the home draft project; the gateway caches a list per directory. */
	homeCommands: AvailableSlashCommand[] = [];
	/** Which project `homeCommands` belongs to, and only when it is that project's own list. */
	homeCommandsCwd: string | undefined;
	/** Bumped when something asks to open the model picker (the `/model` guidance row). */
	modelMenuSignal = 0;
	/** Session whose sidebar menu should open (the `/rename` and `/export` guidance rows). */
	sessionMenuFor: string | undefined;
	#homeRestated = 0;
	/** Model picked on the home screen for the next new session only; OMP's default role is untouched. */
	draftModel: { provider: string; id: string; level?: string } | undefined;
	prefs: Prefs = loadPrefs();
	models: ModelOption[] = loadCachedModels();
	/** `provider/model` the gateway forces every session onto (test profile); set from `/api/health`. */
	modelLock?: { provider: string; model: string };
	/** API version the running gateway reports; `undefined` when it predates the check. */
	serverApi: number | undefined;
	/** What the gateway's startup check found about the installed omp; `undefined` until it answers. */
	omp?: OmpHealth;
	/** The banner can be closed for this page; the settings page still states the verdict. */
	ompBannerClosed = false;
	/**
	 * 「未驗證」提示的關閉旗標，跟錯誤橫幅分開。
	 * 為什麼要分開：兩者性質不同——錯誤橫幅是壞了要人處理，關掉就不該再提醒；
	 * 「未驗證」只是「這個版本沒人測過」，使用者可能只是不想看，之後換了版本
	 * 又會出現。用同一個旗標的話，先關掉錯誤橫幅就會連未驗證提示也一起關掉。
	 */
	ompNoticeClosed = false;
	/** 上游的更新狀態；設定頁開啟時才去問一次，不是每次重繪都打 API。 */
	ompUpdate: OmpUpdateStatus | undefined;
	/** 更新正在安裝中；同一時間只准一個更新。 */
	ompUpdating = false;
	/** 完整相容性檢查的結果；跑過才有。 */
	ompCheck: CompatCheckResult | undefined;
	/** 檢查正在跑；這支檢查要幾秒，跑完前按鈕要disable。 */
	ompChecking = false;
	/** OMP's model roles / subagent overrides / plan default, for the agent settings page. */
	agentSettings: AgentSettings | undefined;
	/** Skills of `skillsCwd`; the gateway reconstructs the disabled ones. */
	skills: SkillItem[] | undefined;
	plugins: PluginItem[] | undefined;
	/** Which list the 插件 page shows. */
	pluginsTab: "skills" | "plugins" = "skills";
	/** Project the skill list was loaded for; skills are per-project. */
	skillsCwd: string | undefined;
	#staleWarned = false;
	#ompRetried = false;
	version = 0;
	#listeners = new Set<() => void>();
	#registry = new SessionRegistry(gateway, store => this.#wireStore(store));

	constructor() {
		this.draftProject = this.prefs.lastProject;
		({ view: this.view, route: this.route } = this.#parseHash());
		void this.loadHealth();
		void this.loadAgentSettings();
		if (this.view === "plugins") void this.loadPlugins();
		window.addEventListener("hashchange", () => {
			const next = this.#parseHash();
			if (next.view !== this.view || next.route !== this.route) this.#go(next.view, next.route, false);
		});
		gateway.on(msg => {
			this.#registry.handle(msg);
			if (msg.t === "index") {
				void this.refreshIndex();
				return;
			}
			if (msg.t === "rekey" && this.route === msg.from) this.#go("session", msg.to, true);
		});
		applyPrefs(this.prefs);
	}

	subscribe = (l: () => void) => {
		this.#listeners.add(l);
		return () => this.#listeners.delete(l);
	};
	getVersion = () => this.version;

	emit(): void {
		this.version++;
		for (const l of this.#listeners) l();
	}

	#parseHash(): { view: View; route: string | undefined } {
		if (location.hash === "#/plugins") return { view: "plugins", route: undefined };
		const m = location.hash.match(/^#\/s\/(.+)$/);
		const key = m ? decodeURIComponent(m[1]) : undefined;
		// A session that was still starting does not survive a reload: land on home.
		if (!key || (key.startsWith(PENDING_PREFIX) && !this.#registry.has(key))) return { view: "home", route: undefined };
		return { view: "session", route: key };
	}

	#go(view: View, key: string | undefined, replace: boolean): void {
		const prev = this.route;
		this.view = view;
		this.route = view === "session" ? key : undefined;
		// The sheet belongs to the view that raised it, not to the app.
		this.inspectSkill = undefined;
		const hash = view === "plugins" ? "#/plugins" : key ? `#/s/${encodeURIComponent(key)}` : "#/";
		if (location.hash !== hash) {
			if (replace) history.replaceState(null, "", hash);
			else history.pushState(null, "", hash);
		}
		if (prev && prev !== key) this.#registry.releaseIdle(prev);
		if (view === "home") void this.loadAgentSettings();
		if (view === "plugins") void this.loadPlugins(this.#defaultSkillsCwd(prev));
		// Whatever brought the user here, they are done with the drawer on a narrow screen.
		// Set directly: this method emits anyway, and a second notification is waste.
		this.drawerOpen = false;
		this.emit();
	}

	open(key: string | undefined): void {
		this.#go(key ? "session" : "home", key, false);
	}

	observe(key: string): void {
		this.#registry.get(key, true);
		this.#go("session", key, false);
	}

	openPlugins(): void {
		this.#go("plugins", undefined, false);
	}

	openDrawer(): void {
		if (this.drawerOpen) return;
		this.drawerOpen = true;
		this.emit();
	}

	closeDrawer(): void {
		if (!this.drawerOpen) return;
		this.drawerOpen = false;
		this.emit();
	}

	/** Ask the composer's model picker to open itself. */
	requestModelMenu(): void {
		this.modelMenuSignal++;
		this.emit();
	}

	/** Ask the sidebar to open one session's "⋯" menu. */
	requestSessionMenu(key: string): void {
		this.sessionMenuFor = key;
		this.emit();
	}

	clearSessionMenuRequest(): void {
		if (this.sessionMenuFor === undefined) return;
		this.sessionMenuFor = undefined;
	}

	store(key: string): SessionStore {
		return this.#registry.get(key);
	}

	#wireStore(store: SessionStore): void {
		// A newly dispatched subagent opens the panel on it, unless the user is following another live one.
		store.onSubagentStarted = id => {
			if (this.route !== store.key || !this.prefs.autoOpenAgents) return;
			const current = this.selectedSubagent ? store.subagents.get(this.selectedSubagent) : undefined;
			const followingLive = this.prefs.inspectorOpen && this.prefs.inspectorTab === "agents" && (current?.status === "running" || current?.status === "pending");
			if (!followingLive) this.showSubagent(id);
		};
		store.onAttention = (kind, detail) => this.#attention(store, kind, detail);
	}

	async refreshIndex(): Promise<void> {
		try {
			const data = await api<{ projects: ProjectInfo[]; sessions: SessionSummary[]; archived?: SessionSummary[] }>("/api/index");
			this.projects = data.projects;
			this.sessions = data.sessions;
			this.archived = data.archived ?? [];
			this.indexLoaded = true;
			if (!this.draftProject && data.projects[0]) this.draftProject = data.projects[0].path;
			// A cold load straight onto #/plugins has no index to pick a project from yet.
			if (this.view === "plugins" && !this.skillsCwd) void this.loadPlugins();
			this.emit();
		} catch {
			// gateway restarting; the next index event retries
		}
	}

	setPrefs(patch: Partial<Prefs>): void {
		this.prefs = { ...this.prefs, ...patch };
		savePrefs(this.prefs);
		applyPrefs(this.prefs);
		this.emit();
	}

	setDraftProject(path: string): void {
		this.draftProject = path;
		this.setPrefs({ lastProject: path });
	}

	/** Model for the next new session; `undefined` falls back to OMP's default role. Not persisted. */
	setDraftModel(model: { provider: string; id: string; level?: string } | undefined): void {
		this.draftModel = model;
		this.emit();
	}

	/** Open the right panel on the "改动" page with one file selected. */
	openInChanges(path: string): void {
		this.inspectFile = path;
		this.setPrefs({ inspectorOpen: true, inspectorTab: "changes" });
	}

	/** Show one skill's SKILL.md in the side sheet; available from the list and from a conversation. */
	openSkillDetail(name: string, cwd: string): void {
		this.inspectSkill = { name, cwd };
		this.emit();
	}

	closeSkillDetail(): void {
		this.inspectSkill = undefined;
		this.emit();
	}

	selectInspectFile(path: string | undefined): void {
		this.inspectFile = path;
		this.emit();
	}

	/** Open the right panel on the "子代理" page with one subagent selected (Codex / Claude Code style). */
	showSubagent(id: string): void {
		this.selectedSubagent = id;
		this.setPrefs({ inspectorOpen: true, inspectorTab: "agents" });
	}

	selectSubagent(id: string | undefined): void {
		this.selectedSubagent = id;
		this.emit();
	}

	/**
	 * Hide one entry from the home screen's recent list, or bring them all back.
	 * Reads the live prefs, so two clicks in one tick cannot drop an update.
	 */
	dismissRecent(path: string): void {
		this.setPrefs({ dismissedRecent: [...this.prefs.dismissedRecent, path] });
	}

	restoreRecent(): void {
		this.setPrefs({ dismissedRecent: [] });
	}

	/** Show or hide one model in the pickers; also reads the live list. */
	setModelVisible(key: string, visible: boolean): void {
		const current = this.prefs.hiddenModels;
		this.setPrefs({ hiddenModels: visible ? current.filter(k => k !== key) : [...current, key] });
	}

	/**
	 * Switch the sidebar's project filter. Manual mode keeps whatever was picked
	 * before; the first time it starts empty, so the list is chosen deliberately.
	 */
	setProjectFilter(filter: ProjectFilter): void {
		this.setPrefs({ projectFilter: filter });
	}

	/** Tick or untick one project in the "manual" filter. */
	setProjectVisible(path: string, visible: boolean): void {
		const current = this.prefs.visibleProjects;
		this.setPrefs({ visibleProjects: visible ? [...current, path] : current.filter(p => p !== path) });
	}

	/** App-level toast; session-scoped messages use `SessionStore.notify` instead. */
	notify(level: AppNotice["level"], text: string): void {
		const notice = { id: noticeSeq++, level, text };
		this.notices = [...this.notices, notice].slice(-4);
		this.emit();
		setTimeout(() => this.dismiss(notice.id), level === "error" ? 9000 : 5000);
	}

	dismiss(id: number): void {
		this.notices = this.notices.filter(n => n.id !== id);
		this.emit();
	}

	openSettings(page: SettingsPage = "general"): void {
		this.settingsPage = page;
		this.closeDrawer();
		this.emit();
	}

	closeSettings(): void {
		this.settingsPage = undefined;
		this.emit();
	}

	/**
	 * Read the LAN panel. Only this machine may ask, so a 403 is the answer that says "hide
	 * the page" — a phone keeps working with the same code path, just without the page.
	 */
	async loadLan(): Promise<void> {
		try {
			this.lan = await api<LanInfo>("/api/lan");
			this.lanLocal = true;
		} catch (error) {
			if (error instanceof ApiError && error.status === 403) this.lanLocal = false;
		}
		this.emit();
	}

	async rotateLanCode(): Promise<void> {
		try {
			await api("/api/lan/rotate", { method: "POST" });
		} catch (error) {
			this.notify("error", t("chrome.rotateCodeFailed", { error: (error as Error).message }));
		}
		await this.loadLan();
	}

	/** Forget every paired phone; their sockets are closed by the gateway. */
	async revokeLanDevices(): Promise<void> {
		try {
			await api("/api/lan/revoke-all", { method: "POST" });
		} catch (error) {
			this.notify("error", t("chrome.revokeFailed", { error: (error as Error).message }));
		}
		await this.loadLan();
	}

	/** Hide or restore a session; leaving the open one when it gets archived. */
	async setArchived(path: string, archived: boolean): Promise<void> {
		await api("/api/sessions/archive", { method: "POST", body: JSON.stringify({ path, archived }) });
		if (archived && this.route && this.route.toLowerCase() === path.toLowerCase()) this.open(undefined);
		await this.refreshIndex();
	}

	async deleteArchived(path: string): Promise<void> {
		await api("/api/sessions/delete", { method: "POST", body: JSON.stringify({ path }) });
		await this.refreshIndex();
	}

	/** Background-tab notification for a finished turn or a pending question. */
	#attention(store: SessionStore, kind: "done" | "ask", detail: string): void {
		if (!this.prefs.notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
		if (!document.hidden) return;
		const title = store.state?.sessionName || this.sessions.find(s => s.path.toLowerCase() === store.key.toLowerCase())?.title || "ompDS";
		const n = new Notification(kind === "ask" ? t("chrome.notifyAsk", { title }) : t("chrome.notifyDone", { title }), { body: detail.slice(0, 120), tag: store.key });
		n.onclick = () => {
			window.focus();
			this.open(store.key);
			n.close();
		};
	}

	/** Create a session in `cwd` and send its first prompt. */
	async startSession(cwd: string, message: string, images?: ImageContent[]): Promise<void> {
		this.setDraftProject(cwd);
		// Starting omp takes a second or more. Move to the conversation at once with
		// the message echoed locally; the real session takes over this store below.
		const store = this.#registry.pending(message, images);
		const temp = store.key;
		this.open(temp);
		try {
			const { key } = await api<{ key: string }>("/api/sessions", { method: "POST", body: JSON.stringify({ cwd }) });
			this.#registry.activate(store, key);
			if (this.route === temp) this.#go("session", key, true);
			await waitFor(store, () => store.status !== "starting");
			if (store.status !== "ready") throw new Error(store.error ?? t("chrome.sessionExited"));
		} catch (e) {
			store.endPending();
			this.#registry.remove(store.key);
			// Hand the text back to the home composer so nothing typed is lost.
			this.homeRestore = message;
			if (this.route === temp || this.route === store.key) this.open(undefined);
			this.notify("error", t("chrome.newSessionFailed", { error: (e as Error).message }));
			return;
		}
		// The session exists from here on: a failed send stays in it and keeps the text as its draft.
		try {
			await this.#applyDraftModel(store);
			if (message.startsWith("/")) store.markCommand(message);
			await gateway.rpc(store.key, { type: "prompt", message, images });
		} catch (e) {
			store.endPending();
			try {
				localStorage.setItem(`omp-web:draft:${store.key}`, message);
			} catch {
				// storage unavailable
			}
			store.notify("error", t("chrome.sendFailed", { error: (e as Error).message }));
		}
		void this.refreshIndex();
	}

	/** Read the profile-wide model lock once; the home picker needs it to narrow the list. */
	async loadHealth(): Promise<void> {
		try {
			const health = await api<{ api?: number; modelLock?: { provider: string; model: string } | null; omp?: OmpHealth }>("/api/health");
			this.modelLock = health.modelLock ?? undefined;
			this.serverApi = health.api;
			this.omp = health.omp;
			this.emit();
			// The startup check runs behind the page: a null verdict means "still running",
			// so ask once more shortly. An older gateway simply never answers that field,
			// which is why this cannot become a poll.
			if (this.omp && this.omp.compat === null && !this.#ompRetried) {
				this.#ompRetried = true;
				setTimeout(() => void this.loadHealth(), 4_000);
			}
			// This page was built from newer sources than the running gateway: say so
			// instead of letting every new route fail with a bare 404.
			if (this.serverStale && !this.#staleWarned) {
				this.#staleWarned = true;
				this.notify("error", t("chrome.serverStale"));
			}
		} catch {
			// gateway not up yet; the picker just shows the full list
		}
	}

	/** True when the running gateway predates this bundle (or reports another API version). */
	get serverStale(): boolean {
		return this.serverApi !== API_VERSION;
	}

	/** Hide the broken-omp banner until the page reloads; the verdict stays in settings. */
	closeOmpBanner(): void {
		this.ompBannerClosed = true;
		this.emit();
	}

	/** Hide the "untested version" notice; independent of the broken-omp banner. */
	closeOmpNotice(): void {
		this.ompNoticeClosed = true;
		this.emit();
	}

	/**
	 * 問上游有沒有新版。
	 *
	 * 為什麼不是自動輪詢：上游的更新檢查要連網，而且設定頁開著就一直在問是浪費。
	 * 所以只在設定頁打開時問一次，回答留著給人看。
	 */
	async loadOmpUpdate(): Promise<void> {
		try {
			this.ompUpdate = await api<OmpUpdateStatus>("/api/omp/update");
		} catch (error) {
			this.ompUpdate = undefined;
			this.notify("error", t("chrome.ompUpdateCheckFailed", { error: (error as Error).message }));
		}
		this.emit();
	}

	/**
	 * 叫上游把本機那份換掉。
	 *
	 * 失敗就是失敗：Windows 上有工作階段在跑就換不掉，那種情況要把原因說清楚，
	 * 不能假裝成功。
	 */
	async installOmpUpdate(): Promise<void> {
		if (this.ompUpdating) return;
		this.ompUpdating = true;
		this.emit();
		try {
			const result = await api<{ ok: boolean; version: string }>("/api/omp/update/install", { method: "POST" });
			this.notify("info", t("chrome.ompUpdated", { version: result.version }));
			await this.loadOmpUpdate();
			// 換完之後版本變了，重新問一次 gateway 的看法，讓相容性狀態跟上。
			await this.loadHealth();
		} catch (error) {
			this.notify("error", t("chrome.ompUpdateFailed", { error: (error as Error).message }));
		}
		this.ompUpdating = false;
		this.emit();
	}

	/**
	 * 跑完整相容性檢查。
	 *
	 * 這支檢查會起一個臨時行程、不呼叫模型，但要好幾秒；所以結果留在 store，
	 * 設定頁與主畫面的橫幅看的是同一份。
	 */
	async runOmpCheck(): Promise<void> {
		if (this.ompChecking) return;
		this.ompChecking = true;
		this.emit();
		try {
			this.ompCheck = await api<CompatCheckResult>("/api/omp/check", { method: "POST" });
			this.notify(this.ompCheck.failed ? "error" : "info", t(this.ompCheck.failed ? "chrome.ompCheckFailed" : "chrome.ompCheckPassed", { count: this.ompCheck.failed || this.ompCheck.passed }));
		} catch (error) {
			this.notify("error", t("chrome.ompCheckError", { error: (error as Error).message }));
		}
		this.ompChecking = false;
		this.emit();
	}

	consumeHomeRestore(): void {
		this.homeRestore = undefined;
	}

	/** Go home with the composer prefilled; the same one-shot channel a failed send uses. */
	prefillHome(text: string): void {
		this.homeRestore = text;
		this.open(undefined);
	}

	/** Apply the home pick to the session that just started; consumed once, never persisted. */
	async #applyDraftModel(store: SessionStore): Promise<void> {
		const want = this.draftModel;
		this.draftModel = undefined;
		if (!want || this.modelLock) return;
		const current = store.state?.model;
		const sameModel = current?.provider === want.provider && current?.id === want.id;
		const sameLevel = !want.level || store.state?.thinkingLevel === want.level;
		if (sameModel && sameLevel) return;
		try {
			if (!sameModel) await gateway.rpc(store.key, { type: "set_model", provider: want.provider, modelId: want.id });
			if (want.level) await gateway.rpc(store.key, { type: "set_thinking_level", level: want.level });
		} catch (e) {
			store.notify("error", t("chrome.switchModelFailed", { error: (e as Error).message }));
		}
	}

	async loadModels(key: string): Promise<void> {
		try {
			// omp answers with `{ models }`; tolerate a bare array from older builds.
			const result = await gateway.rpc<RawModels | RawModel[]>(key, { type: "get_available_models" });
			this.#setModels(Array.isArray(result) ? result : (result?.models ?? []));
		} catch {
			// keep the previous list
		}
	}

	/** Same list without a live session (the gateway runs `omp models --json`). */
	async loadModelsWithoutSession(): Promise<void> {
		try {
			this.#setModels((await api<RawModels>("/api/models")).models ?? []);
		} catch {
			// keep the previous list
		}
	}

	/**
	 * Slash commands for the home composer, from the gateway's per-directory cache. When
	 * the answer is another project's stand-in, ask twice more so a project opened for the
	 * first time ends up with its own list.
	 */
	async loadHomeCommands(cwd?: string): Promise<void> {
		if (!cwd) {
			this.homeCommands = [];
			this.homeCommandsCwd = undefined;
			this.emit();
			return;
		}
		if (this.homeCommandsCwd === cwd) return;
		try {
			const { commands, exact } = await api<{ commands: AvailableSlashCommand[]; exact: boolean }>(`/api/commands?cwd=${encodeURIComponent(cwd)}`);
			if (this.draftProject !== cwd) return;
			this.homeCommands = commands;
			this.homeCommandsCwd = exact ? cwd : undefined;
			if (!exact && this.#homeRestated < 2) {
				this.#homeRestated++;
				setTimeout(() => void this.loadHomeCommands(cwd), 1500);
			} else if (exact) this.#homeRestated = 0;
		} catch {
			// no completion is better than a wrong one: the composer just will not open a menu
		}
		this.emit();
	}

	async loadAgentSettings(): Promise<void> {
		try {
			this.agentSettings = await api<AgentSettings>("/api/agent-settings");
			this.emit();
		} catch (e) {
			this.notify("error", t("chrome.loadAgentSettingsFailed", { error: (e as Error).message }));
		}
	}

	async #writeAgentSettings(request: Promise<AgentSettings>): Promise<void> {
		try {
			this.agentSettings = await request;
			this.emit();
		} catch (e) {
			this.notify("error", (e as Error).message);
			throw e;
		}
	}

	setRole(role: string, value: string | null): Promise<void> {
		return this.#writeAgentSettings(api<AgentSettings>("/api/agent-settings/role", { method: "POST", body: JSON.stringify({ role, value }) }));
	}

	setAgentOverride(agent: string, value: string | null): Promise<void> {
		return this.#writeAgentSettings(api<AgentSettings>("/api/agent-settings/agent-override", { method: "POST", body: JSON.stringify({ agent, value }) }));
	}

	setPlanDefault(enabled: boolean): Promise<void> {
		return this.#writeAgentSettings(api<AgentSettings>("/api/agent-settings/plan-default", { method: "POST", body: JSON.stringify({ enabled }) }));
	}

	/** Skills of one project plus every installed plugin; skills depend on the project directory. */
	async loadPlugins(cwd?: string): Promise<void> {
		const dir = cwd ?? this.skillsCwd ?? this.#defaultSkillsCwd();
		this.skillsCwd = dir;
		try {
			const [skills, groups] = await Promise.all([
				dir ? api<{ skills: SkillItem[] }>(`/api/skills?cwd=${encodeURIComponent(dir)}`).then(r => r.skills) : Promise.resolve([] as SkillItem[]),
				api<{ npm: PluginItem[]; marketplace: PluginItem[] }>("/api/plugins"),
			]);
			this.skills = skills;
			this.plugins = [...groups.npm, ...groups.marketplace];
		} catch (e) {
			this.notify("error", t("chrome.loadPluginsFailed", { error: (e as Error).message }));
		}
		this.emit();
	}

	/** Project to list: the session the page was opened from, else the home draft, else the most recent. */
	#defaultSkillsCwd(fromRoute?: string): string | undefined {
		const session = fromRoute ? this.sessions.find(s => s.path === fromRoute) : undefined;
		return session?.cwd ?? this.draftProject ?? this.sessions[0]?.cwd ?? this.projects[0]?.path;
	}

	setPluginsTab(tab: "skills" | "plugins"): void {
		this.pluginsTab = tab;
		this.emit();
	}

	/** Drop the gateway's caches too, so a skill added in the terminal shows up. */
	async refreshPlugins(): Promise<void> {
		try {
			const r = await api<{ skills: SkillItem[]; plugins: { npm: PluginItem[]; marketplace: PluginItem[] } }>("/api/plugins/refresh", {
				method: "POST",
				body: JSON.stringify({ cwd: this.skillsCwd }),
			});
			this.skills = r.skills;
			this.plugins = [...r.plugins.npm, ...r.plugins.marketplace];
		} catch (e) {
			this.notify("error", (e as Error).message);
		}
		this.emit();
	}

	async setSkillEnabled(name: string, enabled: boolean): Promise<void> {
		try {
			await api("/api/skills/enabled", { method: "POST", body: JSON.stringify({ name, enabled }) });
		} catch (e) {
			this.notify("error", (e as Error).message);
		}
		await this.loadPlugins();
	}

	#setModels(list: RawModel[]): void {
		this.models = list.map(m => ({
			provider: m.provider,
			id: m.id,
			name: m.name,
			reasoning: m.reasoning,
			contextWindow: m.contextWindow ?? undefined,
			efforts: Array.isArray(m.thinking) ? m.thinking : m.thinking?.efforts,
		}));
		try {
			localStorage.setItem("omp-web:models", JSON.stringify(this.models));
		} catch {
			// storage unavailable
		}
		this.emit();
	}
}

function waitFor(store: SessionStore, done: () => boolean): Promise<void> {
	if (done()) return Promise.resolve();
	const { promise, resolve } = Promise.withResolvers<void>();
	const off = store.subscribe(() => {
		if (done()) {
			off();
			resolve();
		}
	});
	return promise;
}

export const app = new AppStore();

export function useApp(): AppStore {
	useSyncExternalStore(app.subscribe, app.getVersion);
	return app;
}

export function useSession(store: SessionStore): SessionStore {
	useSyncExternalStore(store.subscribe, store.getVersion);
	return store;
}
