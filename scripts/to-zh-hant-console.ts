/**
 * `bun scripts/to-zh-hant-console.ts` — 把終端機輸出裡的簡體中文改成繁體。
 *
 * 為什麼要單獨一支腳本，而不是直接手改：server/ 與 scripts/ 裡的 `console.*`
 * 訊息有五十幾處，是啟動 gateway 時使用者真正會讀到的文字（連接埠被占用、
 * 手機存取網址、清理孤兒行程…）。介面已經是繁體中文，終端機卻還吐簡體，
 * 兩邊不一致。這支腳本用 opencc-js 做機械式轉換，避免手改時漏字。
 *
 * **只轉換 console.* 引數裡的字面值**：其他字串不碰。特別是
 * `msg(lang, ["簡體", "English"])`——第一欄是 `zh`（簡體）這個語言選項的
 * 內容，也是繁體對照表的來源；繁體是執行期查表換出來的。把 msg() 也轉成
 * 繁體，簡體介面就消失了。
 *
 * 冪等：已轉成繁體的字串再跑一次不會變。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { Converter } from "opencc-js";

const ROOT = path.resolve(import.meta.dir, "..");
const toTraditional = Converter({ from: "cn", to: "twp" });

/** 含漢字才算需要轉換。 */
const HAN = /\p{Script=Han}/u;

/** 要掃的目錄。 */
const TARGETS = ["server", "scripts"];

const EXT = /\.ts$/;

/** 只轉換這些呼叫的引數。 */
const CONSOLE_CALL = /\bconsole\s*\.\s*(?:log|error|warn)\s*\(/g;

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (entry.isFile() && EXT.test(entry.name)) yield full;
	}
}

/** 一個字字面值在檔案中的位置。 */
interface Literal {
	start: number;
	end: number;
	body: string;
}

/**
 * 找出檔案裡所有字字面值（跳過註解），位置精確到不含引號的內容。
 *
 * template literal 的 `${…}` 是程式碼，不在字面值裡，所以插值不算內容。
 */
function findLiterals(text: string): Literal[] {
	const out: Literal[] = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		if (ch !== '"' && ch !== "'" && ch !== "`") {
			i++;
			continue;
		}
		const quote = ch;
		const bodyStart = i + 1;
		let j = bodyStart;
		while (j < text.length) {
			if (text[j] === "\\") {
				j += 2;
				continue;
			}
			if (quote === "`" && text[j] === "$" && text[j + 1] === "{") {
				let braces = 1;
				j += 2;
				while (j < text.length && braces > 0) {
					if (text[j] === "{") braces++;
					else if (text[j] === "}") braces--;
					j++;
				}
				continue;
			}
			if (text[j] === quote) break;
			j++;
		}
		out.push({ start: bodyStart, end: j, body: text.slice(bodyStart, j) });
		i = j + 1;
	}
	return out;
}

/**
 * 找出每個 console.* 呼叫的引數範圍 [開頭, 結尾)。
 *
 * 範圍結尾是配對的右括號；掃描時字串與註解不算括號。
 */
function consoleArgRanges(text: string): [number, number][] {
	const ranges: [number, number][] = [];
	CONSOLE_CALL.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = CONSOLE_CALL.exec(text))) {
		const open = m.index + m[0].length - 1;
		let i = open;
		let depth = 0;
		while (i < text.length) {
			const ch = text[i];
			if (ch === '"' || ch === "'" || ch === "`") {
				const quote = ch;
				i++;
				while (i < text.length) {
					if (text[i] === "\\") {
						i += 2;
						continue;
					}
					if (quote === "`" && text[i] === "$" && text[i + 1] === "{") {
						let braces = 1;
						i += 2;
						while (i < text.length && braces > 0) {
							if (text[i] === "{") braces++;
							else if (text[i] === "}") braces--;
							i++;
						}
						continue;
					}
					if (text[i] === quote) {
						i++;
						break;
					}
					i++;
				}
				continue;
			}
			if (ch === "/" && text[i + 1] === "/") {
				while (i < text.length && text[i] !== "\n") i++;
				continue;
			}
			if (ch === "/" && text[i + 1] === "*") {
				i += 2;
				while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
				i += 2;
				continue;
			}
			if (ch === "(") depth++;
			else if (ch === ")") {
				depth--;
				if (depth === 0) break;
			}
			i++;
		}
		ranges.push([open + 1, i]);
	}
	return ranges;
}

/** 這支腳本自己不在轉換範圍內（避免自我引用）。 */
const SKIP = new Set([path.join(ROOT, "scripts", "to-zh-hant-console.ts")]);

let changed = 0;
for (const target of TARGETS) {
	const dir = path.join(ROOT, target);
	if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
	for (const file of walk(dir)) {
		if (SKIP.has(file)) continue;
		const before = readFileSync(file, "utf8");
		const ranges = consoleArgRanges(before);
		if (!ranges.length) continue;
		const edits: Literal[] = [];
		for (const literal of findLiterals(before)) {
			if (!ranges.some(([a, b]) => literal.start >= a && literal.end <= b)) continue;
			if (!HAN.test(literal.body)) continue;
			edits.push(literal);
		}
		if (!edits.length) continue;
		let after = before;
		// 從後往前取代，前面的位置才不會被後面的取代結果推擠。
		for (const edit of edits.sort((a, b) => b.start - a.start)) {
			after = after.slice(0, edit.start) + toTraditional(edit.body) + after.slice(edit.end);
		}
		writeFileSync(file, after, "utf8");
		changed++;
		console.log(`converted ${path.relative(ROOT, file)}`);
	}
}
console.log(`\n${changed} 個檔案已轉換。`);
