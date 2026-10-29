import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ImageContent } from "../../../shared/api.ts";
import { app, useApp, useSession } from "../lib/app-store.ts";
import { locale, t } from "../lib/i18n/index.ts";
import { Icon, Spinner } from "../lib/icons.tsx";
import type { SessionStore } from "../lib/session-store.ts";
import { baseName, type Step, type Turn as TurnModel, turnSteps } from "../lib/turns.ts";
import { ThreadCache } from "../lib/thread-cache.ts";
import { useNarrow, useOverlayPanel } from "../lib/viewport.ts";
import { gateway } from "../lib/ws.ts";
import { Composer, type SendMode } from "./Composer.tsx";
import { Inspector } from "./Inspector.tsx";
import { type ModelChoice, ModelMenu, ModelPicker } from "./ModelMenu.tsx";
import { SidebarToggle } from "./SidebarToggle.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { OutgoingMessage } from "./OutgoingMessage.tsx";
import { Turn } from "./Turn.tsx";
import { UiCard } from "./UiCard.tsx";

export function SessionView({ sessionKey }: { sessionKey: string }) {
	const a = useApp();
	const store = useSession(app.store(sessionKey));
	const summary = a.sessions.find(s => s.path.toLowerCase() === store.key.toLowerCase());
	const title = store.state?.sessionName || summary?.title || t("chat.newSession");
	const cwd = store.state?.cwd || summary?.cwd || "";
	const running = store.isRunning;
	const [showJump, setShowJump] = useState(false);
	const jumpRef = useRef<() => void>(undefined);
	const openSubagent = useCallback((id: string) => app.showSubagent(id), []);
	const fork = useCallback((turn: TurnModel) => void forkTurn(store, turn), [store]);
	/** Below 1100px the panel floats over the conversation, so it needs the scrim a drawer has. */
	const overlaid = useOverlayPanel();
	/** Under 760px the panel is a full-screen sheet: there is no "outside" left to tap. */
	const narrow = useNarrow();
	const closeInspector = useCallback(() => app.setPrefs({ inspectorOpen: false }), []);

	useEffect(() => {
		document.title = `${title} · ompDK`;
	}, [title]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && running && !document.querySelector(".pop, .scrim, .drawer-scrim, .ins-scrim")) void stop(store);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [running, store]);

	return (
		<div className="main">
			<div className="main-col">
				<header className="header">
					<SidebarToggle />
					<span className="title">{title}</span>
					{cwd && (
						<span className="crumb" title={cwd}>
							<Icon name="folder" size={13} />
							{baseName(cwd)}
						</span>
					)}
					<span className="spacer" />
					<button className={`icon-btn ${a.prefs.inspectorOpen ? "active" : ""}`} title={t("chat.sessionInfo")} onClick={() => app.setPrefs({ inspectorOpen: !a.prefs.inspectorOpen })}>
						<Icon name="panelRight" />
					</button>
				</header>
				{store.status === "starting" && store.messages.length === 0 ? (
					<div className="center-state">
						<div>
							<Spinner size={18} />
							<div style={{ marginTop: 12 }}>{t("chat.opening")}</div>
						</div>
					</div>
				) : store.status === "exited" && store.messages.length === 0 ? (
					<div className="center-state">
						<div>
							{store.lostModel ? (
								<ReopenWithModel store={store} lost={store.lostModel} />
							) : store.ownedBy ? (
								<>
									<div>{t("chat.busyElsewhere")}</div>
									<div className="hint">{t("chat.busyElsewhereHint", { pid: store.ownedBy })}</div>
									<div className="reopen-row">
										<button className="btn" onClick={() => reconnectSession(store, undefined, true)}>
											{t("chat.openAnyway")}
										</button>
									</div>
								</>
							) : (
								<>
									<div>{t("chat.sessionGone")}</div>
									{store.error && <div className="err">{store.error}</div>}
									<button className="btn" onClick={() => reconnectSession(store)}>
										{t("chat.reopen")}
									</button>
								</>
							)}
						</div>
					</div>
				) : (
					<Thread store={store} onJumpChange={setShowJump} jumpRef={jumpRef} onOpenSubagent={openSubagent} onFork={fork} />
				)}
				<div className="dock">
					{showJump && (
						<button className="jump" onClick={() => jumpRef.current?.()}>
							<Icon name="chevronDown" size={14} />
							{t("chat.backToBottom")}
						</button>
					)}
					<div className="col composer-wrap">
						<BottomStack store={store} />
					</div>
				</div>
				<StatusBar store={store} />
			</div>
			{a.prefs.inspectorOpen && overlaid && !narrow && <div className="ins-scrim" onPointerDown={closeInspector} />}
			{a.prefs.inspectorOpen && <Inspector store={store} onClose={closeInspector} />}
		</div>
	);
}

async function stop(store: SessionStore): Promise<void> {
	try {
		await gateway.rpc(store.key, { type: "abort" });
	} catch (e) {
		store.notify("error", t("chat.stopFailed", { error: (e as Error).message }));
	}
}

/** Run a command from the thread again: same text, same path the composer takes. */
async function rerunCommand(store: SessionStore, command: string): Promise<void> {
	store.markCommand(command);
	try {
		await gateway.rpc(store.key, { type: "prompt", message: command, streamingBehavior: "steer" });
	} catch (e) {
		store.notify("error", t("chat.sendFailed", { error: (e as Error).message }));
	}
}

/** Re-attach after the process exited: the gateway spawns a fresh one from the session file. */
function reconnectSession(store: SessionStore, model?: string, force?: boolean): void {
	store.markReconnecting();
	gateway.attach(store.key, model, force);
}

/**
 * The session's saved model no longer exists (provider removed or renamed) and
 * the default role did not start either. Preselect the same model id under
 * another provider, else the profile's default model, else the first one listed.
 */
function ReopenWithModel({ store, lost }: { store: SessionStore; lost: string }) {
	const a = useApp();
	const lostId = lost.slice(lost.indexOf("/") + 1);
	const def = a.agentSettings?.roles.default;
	const initial =
		a.models.find(m => m.id === lostId) ??
		(def?.provider && def?.id ? a.models.find(m => m.provider === def.provider && m.id === def.id) : undefined) ??
		a.models[0];
	const [picked, setPick] = useState<ModelChoice | undefined>();
	const pick = picked ?? initial;

	useEffect(() => {
		void app.loadModelsWithoutSession();
	}, []);

	return (
		<>
			<div>{t("chat.modelStale")}</div>
			<div className="hint">{t("chat.modelStaleHint", { model: lost })}</div>
			<div className="reopen-row">
				<ModelPicker current={pick} efforts={[]} models={a.models} hidden={a.prefs.hiddenModels} onPick={m => setPick(m)} onLevel={() => {}} />
				<button className="btn" disabled={!pick} onClick={() => pick && reconnectSession(store, `${pick.provider}/${pick.id}`)}>
					{t("chat.openWithModel")}
				</button>
			</div>
		</>
	);
}

/**
 * Fork from the turn's last assistant message: `get_entries` gives the stored
 * entry ids, and `fork` writes a new session the gateway then rekeys onto.
 */
async function forkTurn(store: SessionStore, turn: TurnModel): Promise<void> {
	try {
		const { entries } = await gateway.rpc<{ entries: Record<string, unknown>[] }>(store.key, { type: "get_entries" });
		const last = [...turn.messages].reverse().find(m => (m as { role?: string }).role === "assistant") as { timestamp?: number } | undefined;
		const entry = entries.find(
			e =>
				e.type === "message" &&
				(e.message as { role?: string } | undefined)?.role === "assistant" &&
				(e.message as { timestamp?: number } | undefined)?.timestamp === last?.timestamp,
		);
		if (!entry) {
			store.notify("error", t("chat.noForkPoint"));
			return;
		}
		await gateway.rpc(store.key, { type: "fork", entryId: String(entry.id) });
	} catch (e) {
		store.notify("error", t("chat.forkFailed", { error: (e as Error).message }));
	}
}

/**
 * Edit-and-resend: find the prompt's entry, let the gateway branch to just before
 * it and delete the old file (`web_rewind`), then send the edited text with the
 * original images. Errors are reported and rethrown so the editor stays open.
 */
async function editTurn(store: SessionStore, turn: TurnModel, text: string): Promise<void> {
	try {
		const { entries } = await gateway.rpc<{ entries: Record<string, unknown>[] }>(store.key, { type: "get_entries" });
		const entry = entries.find(e => {
			const m = e.message as { role?: string; timestamp?: number } | undefined;
			return e.type === "message" && m?.role === "user" && m.timestamp === turn.user?.timestamp;
		});
		if (!entry) throw new Error(t("chat.messageGone"));
		const content = (entry.message as { content?: unknown }).content;
		const images = Array.isArray(content) ? (content.filter(c => (c as { type?: string })?.type === "image") as ImageContent[]) : [];
		const res = await gateway.rpc<{ cancelled?: boolean }>(store.key, { type: "web_rewind", entryId: String(entry.id) });
		if (res?.cancelled) throw new Error(t("chat.rewindCancelled"));
		// The rewind rekeyed this store onto the branch file before its reply arrived.
		await gateway.rpc(store.key, { type: "prompt", message: text, images: images.length > 0 ? images : undefined });
	} catch (e) {
		store.notify("error", t("chat.editFailed", { error: (e as Error).message }));
		throw e;
	}
}

function Thread({
	store,
	onJumpChange,
	jumpRef,
	onOpenSubagent,
	onFork,
}: {
	store: SessionStore;
	onJumpChange: (visible: boolean) => void;
	jumpRef: React.RefObject<(() => void) | undefined>;
	onOpenSubagent: (id: string) => void;
	onFork: (turn: TurnModel) => void;
}) {
	const scroller = useRef<HTMLDivElement>(null);
	const atBottom = useRef(true);
	const lastSent = store.outgoing.at(-1)?.id;
	useLayoutEffect(() => {
		if (lastSent === undefined) return;
		atBottom.current = true;
		onJumpChange(false);
		const el = scroller.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [lastSent]);
	jumpRef.current = () => {
		atBottom.current = true;
		onJumpChange(false);
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
	};
	const cache = useMemo(() => new ThreadCache(), [store, locale()]);
	const turns = useMemo(() => cache.update(store.messages), [cache, store.messages]);
	const subagents = useMemo(() => new Map(store.subagents), [store.subagents, store.subagentVersion]);
	const running = store.isRunning;
	const onEdit = useCallback((turn: TurnModel, text: string) => editTurn(store, turn, text), [store]);
	const onRerun = useCallback((command: string) => void rerunCommand(store, command), [store]);
	const canEdit = !running && store.status === "ready" && !store.state?.readOnly;
	// Turns an edit at index i deletes: that prompt's turn and every later prompt.
	const dropped = useMemo(() => {
		const out: number[] = new Array(turns.length).fill(0);
		let n = 0;
		for (let i = turns.length - 1; i >= 0; i--) {
			if (turns[i].user) n++;
			out[i] = n;
		}
		return out;
	}, [turns]);

	// Settled turns keep stable step arrays so memoized <Turn> skips re-rendering during streams.
	const settled = useMemo(() => {
		const map = new Map<string, Step[]>();
		turns.forEach((turn, i) => {
			if (i < turns.length - 1) map.set(turn.key, cache.steps(turn));
		});
		return map;
	}, [turns, cache]);
	const last = turns[turns.length - 1];
	const lastSteps = last ? running ? turnSteps(last, store.drafts.values(), store.tools) : cache.steps(last) : [];

	useLayoutEffect(() => {
		const el = scroller.current;
		if (el && atBottom.current) el.scrollTop = el.scrollHeight;
	});

	useLayoutEffect(() => {
		atBottom.current = true;
		const el = scroller.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [store.key]);

	const onScroll = () => {
		const el = scroller.current;
		if (!el) return;
		const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
		atBottom.current = near;
		onJumpChange(!near);
	};

	return (
		<div className="scroll" ref={scroller} onScroll={onScroll}>
			<div className="col thread">
				{turns.length === 0 && !running && <div className="center-state" style={{ minHeight: "40vh" }}>{t("chat.startChat")}</div>}
				{turns.map((turn, i) =>
					i < turns.length - 1 ? (
						<Turn
							key={turn.key}
							turn={turn}
							steps={settled.get(turn.key) ?? []}
							running={false}
							cwd={store.state?.cwd}
							subagents={subagents}
							onOpenSubagent={onOpenSubagent}
				onFork={store.state?.readOnly ? undefined : onFork}
							onEdit={canEdit ? onEdit : undefined}
							dropped={dropped[i]}
				onRerun={store.status === "ready" && !store.state?.readOnly ? onRerun : undefined}
						/>
					) : (
						<Turn
							key={turn.key}
							turn={turn}
							steps={lastSteps}
							running={running}
							runStartedAt={store.runStartedAt}
							cwd={store.state?.cwd}
							subagents={subagents}
							onOpenSubagent={onOpenSubagent}
				onFork={store.state?.readOnly ? undefined : onFork}
							onEdit={canEdit ? onEdit : undefined}
							dropped={dropped[i]}
				onRerun={store.status === "ready" && !store.state?.readOnly ? onRerun : undefined}
						/>
					),
				)}
				{store.outgoing.map(receipt => <OutgoingMessage key={receipt.id} receipt={receipt} onDismiss={() => store.dismissSend(receipt.id)} />)}
			</div>
		</div>
	);
}

function BottomStack({ store }: { store: SessionStore }) {
	const running = store.isRunning;
	const queued = store.state?.queuedMessages;
	const queueItems = [...(queued?.steering ?? []).map(text => ({ text, q: "steering" as const })), ...(queued?.followUp ?? []).map(text => ({ text, q: "followUp" as const }))];
	const usage = store.state?.contextUsage;
	/** Controls a hidden `/command` can be replaced by on this screen. */
	const guidance = useMemo(
		() => ({ "model-menu": () => app.requestModelMenu(), "plugins-page": () => app.openPlugins(), "session-menu": () => app.requestSessionMenu(store.key) }),
		[store.key],
	);

	const send = async (text: string, mode: SendMode, images?: ImageContent[]) => {
		// Always `prompt`: omp decides. Idle → a normal turn; busy → queued per streamingBehavior.
		// (A client-side guess about "running" must never turn a fresh message into a steer.)
		// Enter sends "steer" and Alt+Enter "followUp"; the setting can swap the two.
		const queued = (mode === "followUp") !== (app.prefs.enterWhileRunning === "followUp");
		if (text.startsWith("/")) store.markCommand(text);
		const cmd = { type: "prompt", message: text, images, streamingBehavior: queued ? "followUp" : "steer" };
		const receipt = store.beginSend(text, images);
		try {
			await gateway.rpc(store.key, cmd);
			store.finishSend(receipt.id);
		} catch (e) {
			store.finishSend(receipt.id, (e as Error).message);
			store.notify("error", t("chat.sendFailed", { error: (e as Error).message }));
		}
	};

	// Re-attaching makes the gateway spawn a fresh process for this session file.
	const reconnect = () => reconnectSession(store);

	return (
		<>
			{store.pendingUi.map(r => (
				<UiCard key={r.id} req={r} onAnswer={p => gateway.ui(store.key, p)} />
			))}
			<Composer
				draftKey={store.key}
				autoFocus
				running={running}
				placeholder={
					running
						? app.prefs.enterWhileRunning === "followUp"
							? t("chat.placeholderQueue")
							: t("chat.placeholderSteer")
						: undefined
				}
			disabled={store.status !== "ready" || Boolean(store.state?.readOnly)}
				onSend={send}
				onStop={() => void stop(store)}
				onNotice={(text, level) => store.notify(level ?? "info", text)}
				commands={store.commands}
				guidance={guidance}
				state={store.state}
				fileCwd={store.state?.cwd}
				modelSupportsImages={store.state?.model?.input?.includes("image")}
				above={
					<>
					{store.state?.readOnly === true && (
						<div className="reconnect">
							<div className="reconnect-text">
								<b>{t("chat.readOnlyCli")}</b>
								<span className="why">{t("chat.readOnlyWhy")}</span>
							</div>
							<button className="btn" onClick={reconnect}>{t("chat.reconnect")}</button>
						</div>
					)}
						{store.status === "exited" && store.messages.length > 0 && (
							<div className="reconnect">
								<div className="reconnect-text">
									<b>{t("chat.sessionEnded")}</b>
									{store.error && (
										<span className="why" title={store.error}>
											{errorSummary(store.error)}
										</span>
									)}
								</div>
								<button className="btn primary" onClick={reconnect}>
									{t("chat.reconnect")}
								</button>
							</div>
						)}
						{queueItems.length > 0 && (
							<div className="queue">
								{queueItems.map(({ text, q }, i) => (
									<div key={`${q}${i}`} className="queue-item">
										<span className="kind">{q === "steering" ? t("chat.queuedSteer") : t("chat.queuedFollowUp")}</span>
										<span className="txt">{text}</span>
										<button className="icon-btn" style={{ width: 24, height: 24 }} title={t("chat.withdraw")} onClick={() => void gateway.rpc(store.key, { type: "remove_queued_message", message: text, queue: q }).catch(() => {})}>
											<Icon name="x" size={13} />
										</button>
									</div>
								))}
							</div>
						)}
					</>
				}
			right={store.state?.readOnly ? undefined : <ModelMenu store={store} />}
			/>
			<div className="composer-hint">
				<span className="activity">
					{store.activity && (
						<>
							<Spinner size={11} />
							{store.activity}
						</>
					)}
				</span>
				<span>{usage && usage.contextWindow ? t("chat.contextUsage", { percent: Math.round(usage.percent) }) : ""}</span>
			</div>
		</>
	);
}

/** Last non-empty line of the exit error, trimmed for the card; the whole text stays in `title`. */
function errorSummary(error: string): string {
	const line = error.split("\n").map(s => s.trim()).filter(Boolean).pop() ?? error;
	return line.length > 140 ? `${line.slice(0, 140)}…` : line;
}
