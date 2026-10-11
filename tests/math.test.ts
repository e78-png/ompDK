/**
 * Math tokenizing, on the same marked instance the browser uses but without DOMPurify:
 * the point is that a formula survives markdown instead of being eaten by it.
 */
import { describe, expect, test } from "bun:test";
import { Marked } from "marked";
import { mathExtensions, mathTokenizer } from "../web/src/lib/math.ts";

const md = new Marked({ gfm: true });
md.use({ extensions: mathExtensions });
const render = (src: string): string => md.parse(src, { async: false }) as string;

/** The emphasis collision only reproduces through marked's own emStrong. */
const full = new Marked({ gfm: true, breaks: true });
full.use({ extensions: mathExtensions, tokenizer: mathTokenizer });
const renderFull = (src: string): string => full.parse(src, { async: false }) as string;

describe("公式渲染", () => {
	test("\\[ … \\] 成块排，反斜杠不再被 markdown 当转义吃掉", () => {
		const html = render("解得：\n\n\\[ R=\\frac{40}{3} \\]\n");
		expect(html).toContain("katex-display");
		expect(html).toContain('<annotation encoding="application/x-tex">');
		expect(html).not.toContain("[ R=");
	});

	test("行内 \\( … \\) 与 $…$ 都排", () => {
		expect(render("答案是 \\(x^2\\) 与 $n=4$ 两个")).toContain("katex");
	});

	test("价格不算公式", () => {
		const html = render("票价 $5 和 $10 之间");
		expect(html).not.toContain("katex");
		expect(html).toContain("$5 和 $10");
	});

	test("认不出的宏只降级那一个式子，不吃掉整段", () => {
		const html = render("见 \\(\\unknownmacro{x}\\) 的说明");
		expect(html).toContain("说明");
		expect(html).toContain("unknownmacro");
	});

	test("代码里的 $ 不当公式", () => {
		const html = render("写成 `\\frac{1}{2}` 或 `$x$`");
		expect(html).not.toContain("katex");
	});

	test("没有内容的一对定界符不产公式", () => {
		expect(render("空 \\[ \\] 占位")).not.toContain("katex");
	});

	test("数字开头的式子照排", () => {
		const html = render("中心性乘以 $100$，每层 $30\\text{s}$，判据 $0.0708 > 0.05$");
		expect(html).toContain("katex");
		expect(html).toContain("<annotation");
		expect(html).not.toContain("$100$");
	});

	test("同一行的正文 $ 不抢走后面公式的配对", () => {
		const html = render("票价 $5 和 $10 之间，全领域 $\\to$ 核心技术");
		expect(html).toContain("katex");
		expect(html).toContain("票价 $5 和 $10 之间");
		expect(html).not.toContain("$\\to$");
	});

	test("表格里的金额不算公式", () => {
		const html = render("| 月份 | 费用 | 说明 |\n| --- | --- | --- |\n| 2026-08 | $241.79 | Codex（gpt-5.x，$196） |\n");
		expect(html).not.toContain("katex");
		expect(html).toContain("$241.79");
	});

	test("转义的 \\$ 保持字面 $", () => {
		const html = render("价格写作 \\$100 \\$200");
		expect(html).not.toContain("katex");
		expect(html).toContain("$100 $200");
	});

	test("加粗里的显著性星号不吃掉公式", () => {
		const html = renderFull("系数 **$0.2676^{***}$** 显著");
		expect(html).toContain("<strong>");
		expect(html).toContain("0.2676^{***}");
		expect(html).not.toContain("<strong>$0.2676");
	});

	test("加粗句子中间的公式照排", () => {
		const html = renderFull("**Anderson-Rubin Wald test: $F(1, 3905) = \\mathbf{16.59}, P = 0.0000\\text{ [***]}$**");
		expect(html).toContain("katex");
		expect(html).toContain("<strong>");
	});

	test("普通加粗与斜体不受影响", () => {
		const html = renderFull("**加粗** 和 *斜体* 以及 2*3*4 个");
		expect(html).toContain("<strong>加粗</strong>");
		expect(html).toContain("<em>斜体</em>");
	});

	test("反引号不配对时不把 shell 正文排成公式", () => {
		const html = renderFull("对它调 `Rule-Parameters $entry.Path $entry.Package ...`，此时 `$entry.Path = $null` 而新逻辑走 `if ($package) {...} else { $p.Program = $program }` → 绑 null 报错");
		expect(html).not.toContain("katex");
	});
});
