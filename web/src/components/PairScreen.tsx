/**
 * The card a phone sees before it has a device cookie. It is the whole page: there is no
 * session list to show behind it, and no WebSocket is open while it is up.
 */
import { useEffect, useRef, useState } from "react";
import { Icon, Spinner } from "../lib/icons.tsx";
import { t } from "../lib/i18n/index.ts";
import { ApiError, api } from "../lib/ws.ts";

/** A number field of a JSON error body, without trusting its shape. */
function numberField(body: unknown, key: string): number | undefined {
	if (!body || typeof body !== "object") return undefined;
	const entry = Object.entries(body).find(([name]) => name === key);
	return typeof entry?.[1] === "number" ? entry[1] : undefined;
}

function pairError(e: unknown): string {
	if (!(e instanceof ApiError)) return t("chrome.pairFailed");
	const lockedFor = numberField(e.body, "retryAfterMs");
	if (lockedFor) return t("chrome.pairTooMany", { minutes: Math.ceil(lockedFor / 60_000) });
	const left = numberField(e.body, "left");
	if (typeof left === "number") return t("chrome.pairWrongCode", { left });
	return e.message;
}

export function PairScreen({ initialCode, onPaired }: { initialCode?: string; onPaired: () => void }) {
	const [code, setCode] = useState("");
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const field = useRef<HTMLInputElement>(null);
	/** The value already on its way to the gateway, so a re-render cannot send it twice. */
	const sent = useRef<string | undefined>(undefined);

	const submit = async (value: string) => {
		if (busy || sent.current === value) return;
		sent.current = value;
		setBusy(true);
		setError(undefined);
		try {
			await api("/api/pair", { method: "POST", body: JSON.stringify({ code: value }) });
			onPaired();
		} catch (e) {
			sent.current = undefined;
			setBusy(false);
			setCode("");
			field.current?.focus();
			setError(pairError(e));
		}
	};

	useEffect(() => {
		field.current?.focus();
		// Scanned from the settings page's QR: the fragment carried the code, so type it in.
		if (initialCode?.length === 6) {
			setCode(initialCode);
			void submit(initialCode);
		}
		// Runs once: the code is only ever handed over on the first render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div className="pair-page">
			<div className="pair-card">
				<div className="pair-brand" aria-hidden="true">
					π
				</div>
				<h1>{t("chrome.pairTitle")}</h1>
				<p className="pair-lead">{t("chrome.pairLead")}</p>
				<input
					ref={field}
					className="pair-input"
					value={code}
					disabled={busy}
					inputMode="numeric"
					autoComplete="one-time-code"
					maxLength={6}
					placeholder="······"
					aria-label={t("chrome.accessCode")}
					onChange={e => {
						const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
						setCode(digits);
						setError(undefined);
						if (digits.length === 6) void submit(digits);
					}}
					onKeyDown={e => {
						if (e.key === "Enter") void submit(code);
					}}
				/>
				{error ? (
					<div className="pair-error">
						<Icon name="alert" size={13} />
						{error}
					</div>
				) : (
					<div className="pair-note">{t("chrome.pairNote")}</div>
				)}
				<button className="btn primary pair-go" disabled={busy || code.length !== 6} onClick={() => void submit(code)}>
					{busy ? <Spinner size={12} /> : t("chrome.pairEnter")}
				</button>
			</div>
		</div>
	);
}
