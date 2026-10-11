/**
 * 智能体与会话: OMP's default model, per-subagent models and the plan-mode
 * default. Everything writes straight into OMP's config, so the terminal's
 * `omp` sees the same values; nothing here is web-only state.
 */
import { useRef, useState } from "react";
import type { ModelOption, RoleValue } from "../../../../shared/api.ts";
import { app, useApp } from "../../lib/app-store.ts";
import { effortName } from "../../lib/format.ts";
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
		? (value.raw ?? "已失效")
		: value.raw
			? `${known?.name ?? value.id ?? value.raw}${value.level ? ` · ${effortName(value.level)}` : ""}`
			: (unsetLabel ?? "未设置");

	return (
		<>
			<button ref={btn} className={`chip ${open ? "active" : ""}`} disabled={disabled || busy} onClick={() => (open ? close() : setOpen(true))}>
				<span className="label">{label}</span>
				{busy ? <Spinner size={13} /> : <Icon name="chevronDown" size={13} />}
			</button>
			{open && (
				<Popover anchor={btn} onClose={close} width={330} align="end" prefer="auto">
					<div className="pop-search">
						<input autoFocus placeholder="搜索模型" value={query} onChange={e => setQuery(e.target.value)} />
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
			<h2 className="set-h2">智能体与会话</h2>
			{locked && <div className="err-text">测试模式：所有会话锁定为 {locked.provider}/{locked.model}，本页只读。</div>}
			{def?.missing && <div className="err-text">默认模型 {def.raw} 已失效，请重新选择；未重选前新会话会回退到第一个可用模型。</div>}
			<Section title="Agent 默认值">
				<Row title="默认模型" desc="新会话都用这个模型">
					<RoleModelSelect value={def ?? {}} disabled={disabled} onPick={setDefault} />
					{def?.missing && <span className="set-warn">已失效，请重新选择</span>}
				</Row>
				<Row title="默认思考强度" desc="只影响之后新建的会话">
					{def?.missing ? (
						<span className="set-warn">默认模型已失效</span>
					) : efforts.length > 0 ? (
						<div className="seg set-seg">
							<button className={(def?.level ?? "follow") === "follow" ? "on" : ""} disabled={disabled || !def?.raw} onClick={() => void setDefaultLevel("follow")}>
								跟随模型
							</button>
							{efforts.map(e => (
								<button key={e} className={def?.level === e ? "on" : ""} disabled={disabled || !def?.raw} onClick={() => void setDefaultLevel(e)}>
									{effortName(e)}
								</button>
							))}
						</div>
					) : (
						<span className="set-warn">{def?.raw ? "该模型不支持思考强度" : "先选默认模型"}</span>
					)}
				</Row>
				<Row title="默认计划模式" desc="新会话启动时进入计划模式">
					<Toggle on={s?.planDefault === true} disabled={disabled} onChange={v => void app.setPlanDefault(v)} />
				</Row>
			</Section>
			<Section title="子代理">
				<Row title="通用子代理（task）" desc="主代理派出的通用子任务">
					<RoleModelSelect value={s?.roles.task ?? {}} unsetLabel="未设置（跟随当前会话）" disabled={disabled} onPick={pickRole("task", s?.roles.task)} />
				</Row>
				<Row title="快速模型（scout、sonic）" desc="侦察、机械性改动等轻量子代理">
					<RoleModelSelect value={s?.roles.smol ?? {}} unsetLabel="未设置（跟随默认模型）" disabled={disabled} onPick={pickRole("smol", s?.roles.smol)} />
				</Row>
				<Row title="强力模型（reviewer）" desc="代码审查等需要强推理的子代理">
					<RoleModelSelect value={s?.roles.slow ?? {}} unsetLabel="未设置（跟随默认模型）" disabled={disabled} onPick={pickRole("slow", s?.roles.slow)} />
				</Row>
				<Row title="按子代理单独指定（高级）" desc="覆盖上面按类别的设定">
					<button className="chip" disabled={disabled} onClick={() => setShowOverrides(v => !v)}>
						<Icon name={showOverrides ? "chevronDown" : "chevronRight"} size={13} />
					</button>
				</Row>
				{showOverrides && (
					<>
						{Object.entries(s?.agentOverrides ?? {}).map(([name, v]) => (
							<Row key={name} title={name} desc={v.missing ? <span className="set-warn">已失效：{v.raw}</span> : (v.raw ?? "")}>
								<RoleModelSelect value={v} unsetLabel="删除此条" disabled={disabled} onPick={m => (m === null ? app.setAgentOverride(name, null) : app.setAgentOverride(name, `${m.provider}/${m.id}${v.level ? `:${v.level}` : ""}`))} />
							</Row>
						))}
						<Row title="＋ 添加" desc="可选 task、sonic、scout、reviewer、security-reviewer，或手填自定义名">
							<input className="text-input" style={{ width: 140 }} value={newAgent} disabled={disabled} onChange={e => setNewAgent(e.target.value)} placeholder="子代理名" />
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
			<Section title="辅助">
				<Row title="小模型（tiny）" desc="自动起标题等杂活；未设置时用默认模型">
					<RoleModelSelect value={s?.roles.tiny ?? {}} unsetLabel="未设置（用默认模型）" disabled={disabled} onPick={pickRole("tiny", s?.roles.tiny)} />
				</Row>
			</Section>
			<div className="set-note">修改写入 OMP 配置，终端里的 omp 同样生效；只影响之后新建的会话。</div>
		</>
	);
}
