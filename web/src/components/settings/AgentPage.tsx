/**
 * 智能体与会话: OMP's default model, per-subagent models and the plan-mode
 * default. Everything writes straight into OMP's config, so the terminal's
 * `omp` sees the same values; nothing here is web-only state.
 */
import { useRef, useState } from "react";
import type { ModelOption, RoleValue } from "../../../../shared/api.ts";
import { app, useApp } from "../../lib/app-store.ts";
import { effortName } from "../../lib/format.ts";
import { t } from "../../lib/i18n/index.ts";
import { Icon, Spinner } from "../../lib/icons.tsx";
import { ModelList } from "../ModelMenu.tsx";
import { Popover } from "../Popover.tsx";
import { Row, Section, Toggle } from "./controls.tsx";

/** Model dropdown for one role: the shared grouped list plus an optional 未设置 entry. */
function RoleModelSelect({
	value,
	unsetLabel,
	disabled,
	onPick,
}: {
	value: RoleValue;
	unsetLabel?: string;
	disabled?: boolean;
	onPick: (m: ModelOption | null) => void | Promise<unknown>;
}) {
	const a = useApp();
	const btn = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	// A role write answers with a fresh model list, which can take ~10s.
	const [busy, setBusy] = useState(false);
	const pick = async (m: ModelOption | null) => {
		setBusy(true);
		try {
			await onPick(m);
		} catch {
			// app-store already surfaced it
		} finally {
			setBusy(false);
		}
	};
	const close = () => {
		setOpen(false);
		setQuery("");
	};
	const known = value.provider && value.id ? a.models.find(m => m.provider === value.provider && m.id === value.id) : undefined;
	const label = value.missing
		? (value.raw ?? t("set.stale"))
		: value.raw
			? `${known?.name ?? value.id ?? value.raw}${value.level ? ` · ${effortName(value.level)}` : ""}`
			: (unsetLabel ?? t("set.unset"));

	return (
		<>
			<button ref={btn} className={`chip ${open ? "active" : ""}`} disabled={disabled || busy} onClick={() => (open ? close() : setOpen(true))}>
				<span className="label">{label}</span>
				{busy ? <Spinner size={13} /> : <Icon name="chevronDown" size={13} />}
			</button>
			{open && (
				<Popover anchor={btn} onClose={close} width={330} align="end" prefer="auto">
					<div className="pop-search">
						<input autoFocus placeholder={t("set.searchModels")} value={query} onChange={e => setQuery(e.target.value)} />
					</div>
					{unsetLabel && (
						<button
							className="pop-item"
							onClick={() => {
								close();
								void pick(null);
							}}
						>
							<span className="check">{!value.raw && <Icon name="check" size={15} />}</span>
							<span className="main-label">{unsetLabel}</span>
						</button>
					)}
					<ModelList
						models={a.models}
						hidden={a.prefs.hiddenModels}
						query={query}
						maxHeight={300}
						onPick={m => {
							close();
							void pick(m);
						}}
					/>
				</Popover>
			)}
		</>
	);
}

export function AgentPage() {
	const a = useApp();
	const s = a.agentSettings;
	const [showOverrides, setShowOverrides] = useState(false);
	const [newAgent, setNewAgent] = useState("");
	const locked = s?.locked;
	const disabled = Boolean(locked);

	const def = s?.roles.default;
	const defModel = def?.provider && def?.id ? a.models.find(m => m.provider === def.provider && m.id === def.id) : undefined;
	const efforts = defModel?.reasoning ? ["off", ...(defModel.efforts ?? [])] : [];
	const setDefault = (m: ModelOption | null) => {
		if (m === null) return app.setRole("default", null);
		return app.setRole("default", `${m.provider}/${m.id}${def?.level ? `:${def.level}` : ""}`);
	};
	const setDefaultLevel = (level: string) => {
		if (!def?.provider || !def?.id) return;
		return app.setRole("default", `${def.provider}/${def.id}${level === "follow" ? "" : `:${level}`}`);
	};
	/** Subagent and helper roles keep whatever thinking level their raw value carries. */
	const pickRole = (role: string, prev?: RoleValue) => (m: ModelOption | null) => app.setRole(role, m === null ? null : `${m.provider}/${m.id}${prev?.level ? `:${prev.level}` : ""}`);

	return (
		<>
			<h2 className="set-h2">{t("set.navAgent")}</h2>
			{locked && <div className="err-text">{t("set.testModeLocked", { provider: locked.provider, model: locked.model })}</div>}
			{def?.missing && <div className="err-text">{t("set.defaultMissing", { raw: def.raw ?? "" })}</div>}
			<Section title={t("set.agentDefaults")}>
				<Row title={t("set.defaultModel")} desc={t("set.defaultModelDesc")}>
					<RoleModelSelect value={def ?? {}} disabled={disabled} onPick={setDefault} />
					{def?.missing && <span className="set-warn">{t("set.staleReselect")}</span>}
				</Row>
				<Row title={t("set.defaultEffort")} desc={t("set.defaultEffortDesc")}>
					{def?.missing ? (
						<span className="set-warn">{t("set.defaultModelStale")}</span>
					) : efforts.length > 0 ? (
						<div className="seg set-seg">
							<button className={(def?.level ?? "follow") === "follow" ? "on" : ""} disabled={disabled || !def?.raw} onClick={() => void setDefaultLevel("follow")}>
								{t("set.followModel")}
							</button>
							{efforts.map(e => (
								<button key={e} className={def?.level === e ? "on" : ""} disabled={disabled || !def?.raw} onClick={() => void setDefaultLevel(e)}>
									{effortName(e)}
								</button>
							))}
						</div>
					) : (
						<span className="set-warn">{def?.raw ? t("set.noEffortSupport") : t("set.pickModelFirst")}</span>
					)}
				</Row>
				<Row title={t("set.planDefault")} desc={t("set.planDefaultDesc")}>
					<Toggle on={s?.planDefault === true} disabled={disabled} onChange={v => void app.setPlanDefault(v)} />
				</Row>
			</Section>
			<Section title={t("set.subagents")}>
				<Row title={t("set.subagentTask")} desc={t("set.subagentTaskDesc")}>
					<RoleModelSelect value={s?.roles.task ?? {}} unsetLabel={t("set.unsetFollowSession")} disabled={disabled} onPick={pickRole("task", s?.roles.task)} />
				</Row>
				<Row title={t("set.subagentFast")} desc={t("set.subagentFastDesc")}>
					<RoleModelSelect value={s?.roles.smol ?? {}} unsetLabel={t("set.unsetFollowDefault")} disabled={disabled} onPick={pickRole("smol", s?.roles.smol)} />
				</Row>
				<Row title={t("set.subagentStrong")} desc={t("set.subagentStrongDesc")}>
					<RoleModelSelect value={s?.roles.slow ?? {}} unsetLabel={t("set.unsetFollowDefault")} disabled={disabled} onPick={pickRole("slow", s?.roles.slow)} />
				</Row>
				<Row title={t("set.perSubagent")} desc={t("set.perSubagentDesc")}>
					<button className="chip" disabled={disabled} onClick={() => setShowOverrides(v => !v)}>
						<Icon name={showOverrides ? "chevronDown" : "chevronRight"} size={13} />
					</button>
				</Row>
				{showOverrides && (
					<>
						{Object.entries(s?.agentOverrides ?? {}).map(([name, v]) => (
							<Row key={name} title={name} desc={v.missing ? <span className="set-warn">{t("set.staleRaw", { raw: v.raw ?? "" })}</span> : (v.raw ?? "")}>
								<RoleModelSelect value={v} unsetLabel={t("set.deleteEntry")} disabled={disabled} onPick={m => (m === null ? app.setAgentOverride(name, null) : app.setAgentOverride(name, `${m.provider}/${m.id}${v.level ? `:${v.level}` : ""}`))} />
							</Row>
						))}
						<Row title={t("set.addOverride")} desc={t("set.addOverrideDesc")}>
							<input className="text-input" style={{ width: 140 }} value={newAgent} disabled={disabled} onChange={e => setNewAgent(e.target.value)} placeholder={t("set.agentNamePlaceholder")} />
							<RoleModelSelect
								value={{}}
								disabled={disabled || !newAgent.trim()}
								onPick={m => {
									const done = m ? app.setAgentOverride(newAgent.trim(), `${m.provider}/${m.id}`) : undefined;
									setNewAgent("");
									return done;
								}}
							/>
						</Row>
					</>
				)}
			</Section>
			<Section title={t("set.helper")}>
				<Row title={t("set.subagentTiny")} desc={t("set.subagentTinyDesc")}>
					<RoleModelSelect value={s?.roles.tiny ?? {}} unsetLabel={t("set.unsetUseDefault")} disabled={disabled} onPick={pickRole("tiny", s?.roles.tiny)} />
				</Row>
			</Section>
			<div className="set-note">{t("set.writeNote")}</div>
		</>
	);
}
