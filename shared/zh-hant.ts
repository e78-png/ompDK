/**
 * 執行期的簡→繁轉換：把介面文案從簡體中文換成繁體中文（台灣用語）。
 *
 * 為什麼查表而不是直接呼叫 OpenCC：OpenCC 的字典在瀏覽器裡太重，而這份介面的
 * 文案都寫死在原始碼裡，`scripts/gen-zh-hant.ts` 已經把用得到的字串預先轉好。
 *
 * 為什麼整句查不到還要逐詞替換：像「补充说明（可选）」這種文案是由幾段字串
 * 接起來的，整句不在表裡，但只要「补充说明」在表裡就能換掉。
 *
 * 為什麼查不到就原樣輸出：轉換只是加值，失敗時寧可讓讀者看到簡體，也不要讓
 * 整個介面因為一句新文案就炸掉。
 */
import { ZH_HANT } from "./zh-hant.generated.ts";

/** 含漢字的字串才值得逐詞替換。 */
const HAN = /\p{Script=Han}/u;

/** 最長可比對的片段長度：詞片段最多 4 字，更長的整句在前面已經查過。 */
const MAX_MATCH = 8;

/** 表是物件字面值，用 `hasOwn` 才不會撞到 `constructor` 這種原型上的鍵。 */
function lookup(text: string): string | undefined {
	return Object.hasOwn(ZH_HANT, text) ? ZH_HANT[text] : undefined;
}

/** 一段簡體中文的繁體（台灣用語）版本；沒有對應就原樣回傳。 */
export function toZhHant(text: string): string {
	const direct = lookup(text);
	if (direct !== undefined) return direct;
	if (!HAN.test(text)) return text;
	let out = "";
	let i = 0;
	while (i < text.length) {
		const limit = Math.min(MAX_MATCH, text.length - i);
		let matched = false;
		for (let len = limit; len >= 2; len--) {
			const hit = lookup(text.slice(i, i + len));
			if (hit !== undefined) {
				out += hit;
				i += len;
				matched = true;
				break;
			}
		}
		if (!matched) {
			out += text[i];
			i++;
		}
	}
	return out;
}
