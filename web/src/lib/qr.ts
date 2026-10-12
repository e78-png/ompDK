/**
 * The QR for a pairing link, as a boolean grid: the settings page draws it as an SVG.
 *
 * Error correction M with an automatic type number — the link is short, and M is what the
 * scanner in a phone camera expects to find without difficulty.
 */
import qrcode from "qrcode-generator";

export function qrMatrix(text: string): boolean[][] {
	const qr = qrcode(0, "M");
	qr.addData(text);
	qr.make();
	const count = qr.getModuleCount();
	return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => qr.isDark(row, col)));
}
