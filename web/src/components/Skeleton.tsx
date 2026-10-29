/**
 * 骨架屏。
 *
 * 為什麼要骨架而不是一行「載入中」：清單還沒回來時，一行字讓版面突然從空變滿；
 * 骨架讓版面先長出該有的形狀，內容回來時再填進去，視線不會被拉走。
 *
 * 為什麼動畫用 CSS 而不是 JS：骨架只是一個提示，瀏覽器就能畫，
 * 不需要每幀重繪。
 */
import { t } from "../lib/i18n/index.ts";

/** One placeholder line. */
function Line({ width }: { width: string }) {
	return <span className="sk-line" style={{ width }} />;
}

/**
 * A list-shaped skeleton.
 *
 * `rows` decides how many placeholder rows there are; the widths vary so the
 * placeholder does not look like a table.
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
	const widths = ["72%", "54%", "66%", "48%", "60%", "42%"];
	return (
		<div className="skeleton" role="status" aria-label={t("chrome.empty.loadingList")}>
			{Array.from({ length: rows }, (_, i) => (
				<div key={i} className="sk-row">
					<Line width={widths[i % widths.length]} />
					{widths[(i + 2) % widths.length] && <Line width={widths[(i + 2) % widths.length]} />}
				</div>
			))}
		</div>
	);
}

/**
 * The sidebar's own skeleton.
 *
 * 為什麼不放成 `ListSkeleton` 的參數：側欄的每一列有固定的形狀（圓點、標題、
 * 時間），用同一個模組畫會讓兩邊長得一模一樣，看不出是同一個元件。
 */
export function SidebarSkeleton() {
	return (
		<div className="skeleton" role="status" aria-label={t("chrome.empty.loadingList")}>
			{Array.from({ length: 6 }, (_, i) => (
				<div key={i} className="sk-row sk-sess">
					<span className="sk-dot" />
					<Line width={`${58 + ((i * 7) % 26)}%`} />
				</div>
			))}
		</div>
	);
}
