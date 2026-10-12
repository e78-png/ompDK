import { useEffect, useState } from "react";
import type { ExtensionUiRequest } from "../../../shared/api.ts";
import { t } from "../lib/i18n/index.ts";
import { Icon } from "../lib/icons.tsx";

type Answer = Record<string, unknown>;

/** Inline card for an omp dialog request (approval, select, input, editor, ask). */
export function UiCard({ req, onAnswer }: { req: ExtensionUiRequest; onAnswer: (payload: Answer) => void }) {
	const r = req as ExtensionUiRequest & Record<string, unknown>;
	const cancel = () => onAnswer({ id: r.id, cancelled: true });
	const timeout = typeof r.timeout === "number" ? r.timeout : undefined;

	let body: React.ReactNode;
	switch (r.method) {
		case "confirm":
			body = (
				<>
					<div className="q-title">{String(r.title ?? t("panel.card.confirm"))}</div>
					{r.message ? <div className="q-msg">{String(r.message)}</div> : null}
					<div className="ui-actions">
						<Countdown ms={timeout} />
						<span className="grow" />
						<button className="btn ghost" onClick={() => onAnswer({ id: r.id, confirmed: false })}>
							{t("panel.card.reject")}
						</button>
						<button className="btn primary" autoFocus onClick={() => onAnswer({ id: r.id, confirmed: true })}>
							{t("panel.card.allow")}
						</button>
					</div>
				</>
			);
			break;
		case "select":
			body = <SelectBody r={r} onAnswer={onAnswer} onCancel={cancel} timeout={timeout} />;
			break;
		case "input":
		case "editor":
			body = <TextBody r={r} onAnswer={onAnswer} onCancel={cancel} />;
			break;
		case "ask":
			body = <AskBody r={r} onAnswer={onAnswer} onCancel={cancel} timeout={timeout} />;
			break;
		default:
			return null;
	}
	return <div className="ui-card">{body}</div>;
}

function Countdown({ ms }: { ms?: number }) {
	const [left, setLeft] = useState(ms);
	useEffect(() => {
		if (!ms) return;
		const end = Date.now() + ms;
		const timer = setInterval(() => setLeft(Math.max(0, end - Date.now())), 1000);
		return () => clearInterval(timer);
	}, [ms]);
	if (!left) return null;
	return <span className="timeout">{t("panel.card.countdown", { n: Math.ceil(left / 1000) })}</span>;
}

function SelectBody({ r, onAnswer, onCancel, timeout }: { r: Record<string, unknown>; onAnswer: (p: Answer) => void; onCancel: () => void; timeout?: number }) {
	const options = (r.options as string[]) ?? [];
	const details = (r.optionDetails as { description?: string }[] | undefined) ?? [];
	return (
		<>
			<div className="q-title">{String(r.title ?? t("panel.card.select"))}</div>
			<div className="ui-options">
				{options.map((o, i) => (
					<button key={o} className="ui-opt" onClick={() => onAnswer({ id: r.id, value: o })}>
						<span className="k">{i + 1}</span>
						<span>
							{o}
							{details[i]?.description && <span className="d">{details[i].description}</span>}
						</span>
					</button>
				))}
			</div>
			<div className="ui-actions">
				<Countdown ms={timeout} />
				<span className="grow" />
				<button className="btn ghost" onClick={onCancel}>
					{t("panel.card.cancel")}
				</button>
			</div>
		</>
	);
}

function TextBody({ r, onAnswer, onCancel }: { r: Record<string, unknown>; onAnswer: (p: Answer) => void; onCancel: () => void }) {
	const [value, setValue] = useState(String(r.prefill ?? ""));
	return (
		<>
			<div className="q-title">{String(r.title ?? t("panel.card.input"))}</div>
			<textarea autoFocus value={value} placeholder={String(r.placeholder ?? "")} onChange={e => setValue(e.target.value)} />
			<div className="ui-actions">
				<span className="grow" />
				<button className="btn ghost" onClick={onCancel}>
					{t("panel.card.cancel")}
				</button>
				<button className="btn primary" onClick={() => onAnswer({ id: r.id, value })}>
					{t("panel.card.submit")}
				</button>
			</div>
		</>
	);
}

interface AskQuestion {
	id: string;
	question: string;
	header?: string;
	options: { label: string; description?: string }[];
	multi?: boolean;
	recommended?: number;
}

function AskBody({ r, onAnswer, onCancel, timeout }: { r: Record<string, unknown>; onAnswer: (p: Answer) => void; onCancel: () => void; timeout?: number }) {
	const questions = (r.questions as AskQuestion[]) ?? [];
	const [sel, setSel] = useState<Record<string, string[]>>({});
	const [custom, setCustom] = useState<Record<string, string>>({});
	const toggle = (q: AskQuestion, label: string) =>
		setSel(s => {
			const cur = s[q.id] ?? [];
			const next = q.multi ? (cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label]) : cur[0] === label ? [] : [label];
			return { ...s, [q.id]: next };
		});
	const submit = () =>
		onAnswer({
			id: r.id,
			answers: questions.map(q => {
				const text = custom[q.id]?.trim();
				const picked = sel[q.id] ?? [];
				return !q.multi && text ? { id: q.id, selectedOptions: [], customInput: text } : { id: q.id, selectedOptions: picked, ...(text ? { customInput: text } : {}) };
			}),
		});
	return (
		<>
			{questions.map(q => (
				<div key={q.id} className="ui-q">
					<div className="q-title">{q.question}</div>
					<div className="ui-options">
						{q.options.map((o, i) => {
							const on = (sel[q.id] ?? []).includes(o.label);
							return (
								<button key={o.label} className={`ui-opt ${on ? "on" : ""}`} onClick={() => toggle(q, o.label)}>
									<span className="k">{on ? <Icon name="check" size={12} /> : i + 1}</span>
									<span>
										{o.label}
										{q.recommended === i && <span className="muted">{t("panel.card.recommended")}</span>}
										{o.description && <span className="d">{o.description}</span>}
									</span>
								</button>
							);
						})}
					</div>
					<input className="text-input" style={{ width: "100%" }} placeholder={t("panel.card.customPlaceholder")} value={custom[q.id] ?? ""} onChange={e => setCustom(c => ({ ...c, [q.id]: e.target.value }))} />
				</div>
			))}
			<div className="ui-actions" style={{ marginTop: 10 }}>
				<Countdown ms={timeout} />
				<span className="grow" />
				<button className="btn ghost" onClick={onCancel}>
					{t("panel.card.skip")}
				</button>
				<button className="btn primary" onClick={submit}>
					{t("panel.card.submit")}
				</button>
			</div>
		</>
	);
}
