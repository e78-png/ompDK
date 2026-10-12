import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "../lib/i18n/index.ts";
import { Icon } from "../lib/icons.tsx";

/** Measure rendered height so wrapped paragraphs and rich text can fold too. */
export function CollapsibleMessage({ children, defaultExpanded = false }: { children: ReactNode; defaultExpanded?: boolean }) {
	const content = useRef<HTMLDivElement>(null);
	const id = useId();
	const [long, setLong] = useState(false);
	const [expanded, setExpanded] = useState(defaultExpanded);

	useLayoutEffect(() => {
		const el = content.current;
		if (!el) return;
		const measure = () => {
			const style = getComputedStyle(el);
			const limit = Number(style.getPropertyValue("--message-fold-lines"));
			setLong(el.getBoundingClientRect().height > parseFloat(style.lineHeight) * limit + 1);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return (
		<div className={`message-fold ${long && !expanded ? "folded" : ""}`}>
			<div className="message-clip" id={id}>
				<div className="message-content" ref={content}>{children}</div>
			</div>
			{long && (
				<button className="message-toggle" type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
					<Icon name={expanded ? "chevronUp" : "chevronDown"} size={13} />
					{expanded ? t("panel.fold.collapse") : t("panel.fold.expand")}
				</button>
			)}
		</div>
	);
}
