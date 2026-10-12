/**
 * Copy text, HTTP included.
 *
 * A page served over plain HTTP is not a secure context, so `navigator.clipboard` is simply
 * absent on a phone — that is the whole reason this exists. The fallback is the old
 * `execCommand("copy")` path: it needs a real selection, and on iOS that means an explicit
 * `setSelectionRange` after `select()`.
 *
 * Never rejects: a copy button that cannot copy should leave its "已复制" hint alone rather
 * than throw into a click handler.
 */
export async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Denied or an unfocused document: try the fallback before giving up.
		}
	}
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.position = "fixed";
	area.style.top = "0";
	area.style.left = "-9999px";
	document.body.append(area);
	try {
		area.select();
		area.setSelectionRange(0, text.length);
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		area.remove();
	}
}
