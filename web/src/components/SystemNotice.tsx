import { Icon } from "../lib/icons.tsx";

/** A display-only wrapper: the original message stays intact in the transcript. */
export function SystemNotice({ text, tone }: { text: string; tone: "info" | "error" }) {
	const wrapped = text.trim().match(/^<system-notice(?:\s[^>]*)?>([\s\S]*?)<\/system-notice>$/i);
	if (!wrapped) return <div className={`note ${tone}`}>{text}</div>;
	const body = wrapped[1].trim();
	const summary = body.split("\n").find(line => line.trim())?.trim() ?? "查看详情";
	return (
		<details className={`system-notice ${tone}`}>
			<summary>
				<Icon name="info" size={14} />
				<span className="notice-label">系统提示</span>
				<span className="notice-summary">{summary}</span>
				<Icon name="chevronRight" size={12} className="chev" />
			</summary>
			<div className="notice-body">{body}</div>
		</details>
	);
}
