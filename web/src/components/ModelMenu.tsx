import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelOption } from "../../../shared/api.ts";
import { app, useApp } from "../lib/app-store.ts";
import { effortName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { t } from "../lib/i18n/index.ts";
import type { SessionStore } from "../lib/session-store.ts";
import { gateway } from "../lib/ws.ts";
import { Popover } from "./Popover.tsx";

export interface ModelChoice {
	provider: string;
	id: string;
	name?: string;
}

/** Grouped, searchable model list shared by the session picker and the settings selects. */
export function ModelList({
	models,
	hidden = [],
	query,
	busy,
	onPick,
	emptyNote = t("chrome.modelsLoading"),
	maxHeight = 360,
}: {
	models: ModelOption[];
	hidden?: string[];
	query: string;
	busy?: boolean;
	onPick: (m: ModelOption) => void;
	emptyNote?: string;
	maxHeight?: number;
}) {
	const usable = hidden.length > 0 ? models.filter(m => !hidden.includes(`${m.provider}/${m.id}`)) : models;
	const q = query.trim().toLowerCase();
	const filtered = usable.filter(m => !q || `${m.provider}/${m.id} ${m.name ?? ""}`.toLowerCase().includes(q));
	const groups = new Map<string, ModelOption[]>();
	for (const m of filtered) {
		let g = groups.get(m.provider);
		if (!g) groups.set(m.provider, (g = []));
		g.push(m);
	}
	return (
		<div className="pop-list" style={{ maxHeight }}>
			{[...groups].map(([provider, list]) => (
				<div key={provider}>
					<div className="pop-title">{provider.toUpperCase()}</div>
					{list.map(m => (
						<button key={`${m.provider}/${m.id}`} className="pop-item" disabled={busy} onClick={() => onPick(m)}>
							<span className="main-label">{m.name ?? m.id}</span>
							<span className="sub">{m.id}</span>
						</button>
					))}
				</div>
			))}
			{groups.size === 0 && <div className="pop-note">{usable.length === 0 ? emptyNote : t("chrome.modelsNoMatch")}</div>}
		</div>
	);
}

/**
 * Model + thinking level in one chip; popover lists the current provider first,
 * "更多模型" shows the rest. Controlled: the caller decides what a pick means
 * (session: rpc + remember; home: remember only) and rethrows to keep it open.
 */
export function ModelPicker({
	current,
	level,
	efforts,
	models,
	lockedTo,
	hidden = [],
	onOpen,
	onPick,
	onLevel,
	openSignal,
}: {
	current?: ModelChoice;
	level?: string;
	efforts: string[];
	models: ModelOption[];
	/** Profile forces one model onto every session: offer it alone, hide "更多模型". */
	lockedTo?: ModelChoice;
	/** `provider/id` keys hidden in settings; the current model always stays offered. */
	hidden?: string[];
	onOpen?: () => void;
	onPick: (m: ModelOption) => void | Promise<void>;
	onLevel: (level: string) => void | Promise<void>;
	/** Bumped by an outside request (the `/model` guidance row) to open the picker. */
	openSignal?: number;
}) {
	const btn = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [more, setMore] = useState(false);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const close = useCallback(() => {
		setOpen(false);
		setMore(false);
		setQuery("");
	}, []);

	const toggle = () => {
		if (!open) onOpen?.();
		setOpen(o => !o);
	};

	useEffect(() => {
		if (openSignal) setOpen(true);
	}, [openSignal]);

	const pick = async (m: ModelOption) => {
		setBusy(true);
		try {
			await onPick(m);
			close();
		} catch {
			// onPick surfaced the error; keep the popover open so a retry is one click away
		} finally {
			setBusy(false);
		}
	};

	const fallback: ModelOption[] = current ? [{ provider: current.provider, id: current.id, name: current.name }] : [];
	const lockedList: ModelOption[] = lockedTo ? [{ provider: lockedTo.provider, id: lockedTo.id, name: lockedTo.name }] : [];
	// Hidden models stay out of every list, but never hide the model in use.
	const usable = hidden.length > 0 ? models.filter(m => !hidden.includes(`${m.provider}/${m.id}`) || `${m.provider}/${m.id}` === (current ? `${current.provider}/${current.id}` : "")) : models;
	const sameProvider = lockedTo
		? lockedList
		: current
			? usable.filter(m => m.provider === current.provider).length
				? usable.filter(m => m.provider === current.provider)
				: fallback
			: [];
	const pool = lockedTo ? lockedList : usable.filter(m => m.provider !== current?.provider);

	// Without a current model the chip is just an entry point into the list.
	const listOnly = more || !current;
	const hasContent = Boolean(current || lockedTo) || usable.length > 0;

	return (
		<>
			<button ref={btn} className={`chip ${open ? "active" : ""}`} onClick={toggle} disabled={!hasContent}>
				<span className="label">{lockedTo ? (lockedTo.name ?? lockedTo.id) : current ? (current.name ?? current.id) : t("chrome.defaultModel")}</span>
				{level && efforts.length > 0 && <span className="effort">· {effortName(level)}</span>}
				<Icon name="chevronDown" size={13} />
			</button>
			{open && hasContent && (
				<Popover anchor={btn} onClose={close} width={330} align="end" prefer="above">
					{!listOnly ? (
						<>
							<div className="pop-title">{current?.provider.toUpperCase()}</div>
							<div className="pop-list">
								{sameProvider.map(m => (
									<button key={m.id} className="pop-item" disabled={busy} onClick={() => m.id !== current?.id && void pick(m)}>
										<span className="check">{m.id === current?.id && <Icon name="check" size={15} />}</span>
										<span className="main-label">{m.name ?? m.id}</span>
									</button>
								))}
							</div>
							{efforts.length > 0 && (
								<>
									<div className="pop-sep" />
									<div className="seg-row">
										<span>{t("chrome.thinking")}</span>
										<div className="seg">
											{efforts.map(e => (
												<button key={e} className={level === e ? "on" : ""} onClick={() => void onLevel(e)}>
													{effortName(e)}
												</button>
											))}
										</div>
									</div>
								</>
							)}
							<div className="pop-note">{t("chrome.modelChangeCache")}</div>
							{!lockedTo && pool.length > 0 && (
								<>
									<div className="pop-sep" />
									<button className="pop-item" onClick={() => setMore(true)}>
										<Icon name="list" size={15} className="muted" />
										<span className="main-label">{t("chrome.moreModels")}</span>
										<Icon name="chevronRight" size={14} className="muted" />
									</button>
								</>
							)}
							{usable.length === 0 && <div className="pop-note">{t("chrome.modelsLoading")}</div>}
						</>
					) : (
						<>
							{more && (
								<div className="pop-search">
									<button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setMore(false)} title={t("chrome.back")}>
										<Icon name="chevronRight" size={14} className="flip" />
									</button>
									<input autoFocus placeholder={t("chrome.searchModels")} value={query} onChange={e => setQuery(e.target.value)} />
								</div>
							)}
							<ModelList models={pool} query={query} busy={busy} onPick={m => void pick(m)} />
						</>
					)}
				</Popover>
			)}
		</>
	);
}

/** Session-bound picker: picking runs rpc and remembers the choice for the next new session. */
export function ModelMenu({ store }: { store: SessionStore }) {
	const a = useApp();
	const model = store.state?.model;
	const level = store.state?.thinkingLevel;
	const efforts = model?.reasoning ? ["off", ...(model.thinking?.efforts ?? [])] : [];
	const current: ModelChoice | undefined = model ? { provider: model.provider, id: model.id, name: model.name } : undefined;

	return (
		<ModelPicker
			current={current}
			level={level}
			efforts={efforts}
			models={a.models}
			hidden={a.prefs.hiddenModels}
			lockedTo={a.modelLock ? { provider: a.modelLock.provider, id: a.modelLock.model } : undefined}
			openSignal={a.modelMenuSignal}
			onOpen={() => {
				if (a.models.length === 0) void app.loadModels(store.key);
			}}
			onPick={async m => {
				try {
					await gateway.rpc(store.key, { type: "set_model", provider: m.provider, modelId: m.id });
				} catch (e) {
					store.notify("error", t("chrome.switchModelFailed", { error: (e as Error).message }));
					throw e;
				}
			}}
			onLevel={async l => {
				try {
					await gateway.rpc(store.key, { type: "set_thinking_level", level: l });
				} catch (e) {
					store.notify("error", (e as Error).message);
					throw e;
				}
			}}
		/>
	);
}
