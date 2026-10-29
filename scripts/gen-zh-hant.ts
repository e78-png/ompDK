/**
 * 產生 `shared/zh-hant.generated.ts`：介面文案由簡體轉繁體（台灣用語）的對照表。
 *
 * 為什麼要自己產生這張表：直接在前端呼叫 OpenCC 要把整份字典送進瀏覽器，太重；
 * 而這份介面的文案都寫死在原始碼裡，所以只要把「原始碼出現過的字串」預先轉好、
 * 執行期查表，既省體積又保證用語一致。
 *
 * 為什麼要連「詞」也收錄：像「补充说明（可选）」這種文案是由幾段字串接起來的，
 * 整句查不到，但只要「补充说明」在表裡就能逐詞換掉；所以除了整句，也收錄
 * 2～4 字的詞片段，讓執行期的最長匹配能把它接回來。
 *
 * 執行期怎麼用：`shared/zh-hant.ts` 的 `toZhHant()`——整句先查表，查不到就以最長
 * 匹配逐詞替換，再查不到就原樣輸出（寧可簡體，也不要丟例外）。
 *
 * 這支腳本冪等：同一份原始碼跑幾次都得到同一個檔案。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Converter } from "opencc-js";

const ROOT = path.resolve(import.meta.dir, "..");
const OUT = path.join(ROOT, "shared", "zh-hant.generated.ts");

/** 轉換目標：台灣常用的繁體用語（軟體、預設、快取）。 */
const toTraditional = Converter({ from: "cn", to: "twp" });

/** 含有漢字的字串才值得收錄；片段詞的長度下限與上限。 */
const HAN = /\p{Script=Han}/u;
const PHRASE_MIN = 2;
const PHRASE_MAX = 4;

/** 產生器自己寫出來的檔案不再掃一次，免得把繁體原文當成簡體來源。 */
const SELF = path.join(ROOT, "shared", "zh-hant.generated.ts");

/** 要掃的原始碼：介面片段、伺服器、共享表。 */
const TARGETS = ["web/src/lib/i18n", "server", "shared"];

/**
 * 常用詞彙表：原始碼裡未必出現「單獨一個」的詞，但介面文案常把它們組成句子
 * （例如「软件更新」）。把這些詞也收進表，執行期的逐詞替換才不會漏掉台灣用語。
 *
 * 刻意不收語意有歧義的詞：「程序」在台灣是「程式」，但這個介面裡的「程序」
 * 也可能指行程，所以不收，交給原始碼自己的整句對照表決定。
 */
const VOCABULARY = [
	"会话", "软件", "默认", "网络", "设置", "归档", "缓存", "视频", "鼠标", "打印",
	"文件", "目录", "硬件", "内存", "服务器", "客户端", "数据库", "账户", "密码", "插件",
	"模板", "提示词", "上下文", "压缩", "搜索", "复制", "粘贴", "下载", "上传", "导入",
	"导出", "保存", "删除", "撤销", "窗口", "界面", "主题", "字体", "标签", "状态",
	"任务", "后台", "语音", "麦克风", "摄像头", "剪贴板", "快捷键", "截图", "日志", "调试",
	"项目", "分支", "仓库", "远程", "本地", "同步", "备份", "恢复", "列表", "面板",
	"侧栏", "图标", "颜色", "提示", "警告", "错误", "成功", "失败", "质量", "反馈",
	"队列", "索引", "变量", "参数", "版本", "更新", "安装", "卸载", "启动", "停止",
	"结束", "继续", "取消", "确定", "打开", "关闭", "新建", "编辑", "查看", "预览",
	"刷新", "重试", "发送", "接收", "消息", "通知", "设备", "屏幕", "分辨率", "网站",
	"网页", "链接", "收藏", "历史", "记录", "统计", "账号", "登录", "退出", "帮助",
	"技能", "命令", "输入", "输出", "表格", "文件夹", "使用者", "资讯",
];

/**
 * 走訪檔案系統，收集目標目錄底下的 `.ts` 檔（跳過產物與生成檔本身）。
 * 回傳路徑依字典序，讓每次產生都從同一個順序開始。
 */
function collect(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) collect(full, out);
		else if (entry.name.endsWith(".ts") && path.resolve(full) !== SELF) out.push(full);
	}
	return out;
}

/**
 * 把一個檔案裡的字串常值拆出來。
 *
 * 為什麼自己掃而不是用一行 regex：註解裡的中文不該進表，而字串裡又常有
 * `//`（網址）與 `/*`；照著語法逐字走才能分清楚程式碼、註解與字串。
 * Template literal 只取 `${}` 之外純文字的部分——佔位符裡是變數，不是文案。
 */
export function scanStrings(source: string): string[] {
	const out: string[] = [];
	let i = 0;
	const n = source.length;
	while (i < n) {
		const c = source[i];
		if (c === "/" && source[i + 1] === "/") {
			while (i < n && source[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && source[i + 1] === "*") {
			i += 2;
			while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		if (c === '"' || c === "'") {
			const quote = c;
			i++;
			let buf = "";
			while (i < n && source[i] !== quote) {
				if (source[i] === "\\") {
					buf += decodeEscape(source, i);
					i += escapeLength(source, i);
					continue;
				}
				buf += source[i];
				i++;
			}
			i++;
			out.push(buf);
			continue;
		}
		if (c === "`") {
			i++;
			let buf = "";
			while (i < n && source[i] !== "`") {
				if (source[i] === "\\") {
					buf += decodeEscape(source, i);
					i += escapeLength(source, i);
					continue;
				}
				if (source[i] === "$" && source[i + 1] === "{") {
					out.push(buf);
					buf = "";
					i = skipExpression(source, i + 2);
					continue;
				}
				buf += source[i];
				i++;
			}
			i++;
			out.push(buf);
			continue;
		}
		i++;
	}
	return out;
}

function escapeLength(source: string, i: number): number {
	return source[i + 1] === "x" ? 4 : source[i + 1] === "u" ? 6 : 2;
}

function decodeEscape(source: string, i: number): string {
	const next = source[i + 1];
	switch (next) {
		case "n": return "\n";
		case "t": return "\t";
		case "r": return "\r";
		case "\\": return "\\";
		case '"': return '"';
		case "'": return "'";
		case "`": return "`";
		case "0": return "\0";
		default: return source.slice(i, i + escapeLength(source, i));
	}
}

/** 跳過 `${}` 裡的表達式（含巢狀括號與字串），回傳收尾的 `}` 之後的位置。 */
function skipExpression(source: string, start: number): number {
	let i = start;
	let depth = 1;
	const n = source.length;
	while (i < n && depth > 0) {
		const c = source[i];
		if (c === "{") { depth++; i++; continue; }
		if (c === "}") { depth--; i++; continue; }
		if (c === '"' || c === "'" || c === "`") {
			const quote = c;
			i++;
			while (i < n && source[i] !== quote) {
				if (source[i] === "\\") i++;
				i++;
			}
			i++;
			continue;
		}
		i++;
	}
	return i;
}

/** 漢字連續段裡的詞片段：2～4 字，讓執行期能逐詞替換。 */
function phrasesOf(text: string): string[] {
	const out: string[] = [];
	for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
		const chars = Array.from(run);
		for (let len = PHRASE_MIN; len <= PHRASE_MAX; len++) {
			for (let start = 0; start + len <= chars.length; start++) out.push(chars.slice(start, start + len).join(""));
		}
	}
	return out;
}

/** 檔案清單：目標目錄底下的所有 `.ts`，依路徑排序。 */
function sourceFiles(): string[] {
	const files: string[] = [];
	for (const target of TARGETS) collect(path.join(ROOT, target), files);
	return files.sort();
}

/** 整份對照表：鍵是原始簡體字串，值是繁體。 */
export function buildTable(): Map<string, string> {
	const table = new Map<string, string>();
	const add = (text: string) => {
		if (!HAN.test(text) || table.has(text)) return;
		const converted = toTraditional(text);
		if (converted !== text) table.set(text, converted);
	};
	for (const file of sourceFiles()) {
		for (const chunk of scanStrings(readFileSync(file, "utf8"))) {
			if (!HAN.test(chunk)) continue;
			add(chunk);
			for (const phrase of phrasesOf(chunk)) add(phrase);
		}
	}
	for (const word of VOCABULARY) add(word);
	return table;
}

/** 產生器輸出的檔案內容；鍵依碼位排序，重跑一定得到同一份。 */
export function render(table: Map<string, string>): string {
	const keys = [...table.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const lines = keys.map(k => `\t${JSON.stringify(k)}: ${JSON.stringify(table.get(k))},`);
	return [
		"/** 自動產生，勿手改；改文案後跑 `bun run gen:zh-hant` 重新產生。 */",
		"export const ZH_HANT: Record<string, string> = {",
		...lines,
		"};",
		"",
	].join("\n");
}

if (import.meta.main) {
	const table = buildTable();
	writeFileSync(OUT, render(table), "utf8");
	console.log(`wrote ${path.relative(ROOT, OUT)} with ${table.size} entries`);
}
