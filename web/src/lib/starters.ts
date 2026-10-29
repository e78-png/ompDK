/**
 * 新會話畫面上的起始提示。
 *
 * 為什麼是這個模組而不是寫在元件裡：這幾句是「產品的一部分」，不是版面的一塊；
 * 把它們放在一個有名字的地方，將來要換成別的語言或依模型調整時，
 * 改的地方是明確的。
 *
 * 為什麼不寫死某個專案：這些提示要對任何 coding agent 都成立，
 * 所以用的是「這個專案」「這個函式」這種指涉當下上下文的說法。
 */
import { type MessageKey, t } from "./i18n/index.ts";
import type { IconName } from "./icons.tsx";

export interface Starter {
	/** Stable id; also the React key. */
	id: string;
	/** The message key of the prompt that lands in the composer. */
	textKey: MessageKey;
	/** The message key of the short label on the chip. */
	labelKey: MessageKey;
	/** The chip's icon. */
	icon: IconName;
}

/**
 * The four starters.
 *
 * 為什麼是這四個：涵蓋 coding agent 最常見的開場——先摸清狀況、找待辦、
 * 補測試、解釋程式碼。每一個都是「按下就能得到東西」的具體動作，
 * 不是「你可以問我任何問題」這種等於沒說的話。
 *
 * 為什麼存的是 key 而不是文字：文字要在渲染的時候翻譯，模組載入時的語言
 * 可能還不是使用者後來選的那個。
 */
const STARTER_SPECS: Starter[] = [
	{ id: "summarize", textKey: "chrome.starter.summarize", labelKey: "chrome.starter.summarizeLabel", icon: "list" },
	{ id: "todos", textKey: "chrome.starter.todos", labelKey: "chrome.starter.todosLabel", icon: "check" },
	{ id: "tests", textKey: "chrome.starter.tests", labelKey: "chrome.starter.testsLabel", icon: "code" },
	{ id: "explain", textKey: "chrome.starter.explain", labelKey: "chrome.starter.explainLabel", icon: "bulb" },
];

/** The starters in the current interface language. */
export function starters(): { id: string; text: string; label: string; icon: IconName }[] {
	return STARTER_SPECS.map(s => ({ id: s.id, text: t(s.textKey), label: t(s.labelKey), icon: s.icon }));
}
