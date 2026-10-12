/**
 * The header's sidebar control, shared by the three full-page views.
 *
 * Wide screens collapse and expand the docked sidebar. Narrow ones open the drawer instead,
 * and leave `sidebarCollapsed` alone: that preference belongs to the desktop layout, and a
 * phone should not rewrite it just because the drawer came and went.
 */
import { app, useApp } from "../lib/app-store.ts";
import { Icon } from "../lib/icons.tsx";
import { t } from "../lib/i18n/index.ts";
import { useNarrow } from "../lib/viewport.ts";

export function SidebarToggle() {
	const a = useApp();
	const narrow = useNarrow();
	if (!narrow && !a.prefs.sidebarCollapsed) return null;
	return (
		<button className="icon-btn" title={narrow ? t("chrome.openSidebar") : t("chrome.expandSidebar")} onClick={() => (narrow ? app.openDrawer() : app.setPrefs({ sidebarCollapsed: false }))}>
			<Icon name="panelLeft" />
		</button>
	);
}
