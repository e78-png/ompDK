import type { ReactNode } from "react";

/** Shared building blocks of the settings pages: a titled card, a labelled row, a segmented control and a switch. */

export function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="set-section">
			<h3>{title}</h3>
			<div className="set-card">{children}</div>
		</section>
	);
}

export function Row({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
	return (
		<div className="set-row">
			<div className="set-text">
				<div className="set-name">{title}</div>
				{desc && <div className="set-desc">{desc}</div>}
			</div>
			{children && <div className="set-control">{children}</div>}
		</div>
	);
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
	return (
		<div className="seg set-seg">
			{options.map(([v, label]) => (
				<button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
					{label}
				</button>
			))}
		</div>
	);
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
	return <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} />;
}
