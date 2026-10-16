import { useState } from "react";
import { copyText } from "../lib/clipboard.ts";
import { t } from "../lib/i18n/index.ts";
import { Icon, Spinner } from "../lib/icons.tsx";
import type { OutgoingMessage as Receipt } from "../lib/session-store.ts";
import { CollapsibleMessage } from "./CollapsibleMessage.tsx";
import "./outgoing.css";

/** A receipt is visible before OMP admits the prompt, without changing its transcript. */
export function OutgoingMessage({ receipt, onDismiss }: { receipt: Receipt; onDismiss: () => void }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="turn outgoing-message">
			<div className="user-row">
				<div className="user-bubble">
					<CollapsibleMessage>{receipt.text}</CollapsibleMessage>
					{receipt.images.length > 0 && <span className="att">{t("chat.images", { n: receipt.images.length })}</span>}
				</div>
				<div className="outgoing-status" role="status">
					{!receipt.error && <Spinner size={11} />}
					<span title={receipt.error}>{receipt.error ? t("chat.sendUnconfirmed") : receipt.accepted ? t("chat.waitingForEcho") : t("chat.sending")}</span>
					{receipt.error && (
						<button className="icon-btn" title={t("chat.copy")} onClick={() => void copyText(receipt.text).then(() => setCopied(true)).catch(() => {})}>
							<Icon name={copied ? "check" : "copy"} size={13} />
						</button>
					)}
					{receipt.error && <button className="icon-btn" title={t("chat.dismissSend")} onClick={onDismiss}><Icon name="x" size={13} /></button>}
				</div>
			</div>
		</div>
	);
}
