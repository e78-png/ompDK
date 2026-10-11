/**
 * Composer completion menu for `@` file paths (from the gateway's project file
 * search). Slash commands have their own grouped menu; see `CommandMenu.tsx`.
 */
import { Icon } from "../lib/icons.tsx";
import { api } from "../lib/ws.ts";

export interface SuggestItem {
	key: string;
	label: string;
	sub?: string;
	/** Replaces the trigger text; already ends with a space. */
	insert: string;
}

/** Project files matching `query`, as `@path ` insertions. Never throws: an unknown cwd just yields none. */
export async function searchFiles(cwd: string, query: string): Promise<SuggestItem[]> {
	try {
		const data = await api<{ files: string[] }>(`/api/files/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`);
		return data.files.map(p => ({ key: p, label: p, insert: `@${p} ` }));
	} catch {
		return [];
	}
}

export function SuggestMenu({ items, active, onHover, onPick }: { items: SuggestItem[]; active: number; onHover: (index: number) => void; onPick: (item: SuggestItem) => void }) {
	return (
		<div className="suggest" role="listbox">
			{items.map((item, i) => (
				<button
					key={item.key}
					role="option"
					aria-selected={i === active}
					className={`suggest-item ${i === active ? "on" : ""}`}
					// Keep focus (and the caret) in the textarea.
					onMouseDown={e => e.preventDefault()}
					onMouseEnter={() => onHover(i)}
					onClick={() => onPick(item)}
				>
					<span className="main-label">{item.label}</span>
					{item.sub && (
						<span className="sub">
							<Icon name="list" size={12} className="muted" />
							{item.sub}
						</span>
					)}
				</button>
			))}
		</div>
	);
}
