/**
 * 命令列注入的防護。
 *
 * 為什麼要測這個：Windows 上 `cmd.exe /c` 會重新解析引號與 `& | < >`。
 * Bun 對引號的跳脫用的是 C runtime 的規則（`\"`），cmd.exe 不認這一套——
 * 奇數個引號會讓後面的 metachar 掉出引號外，變成一條真的命令。
 * 實測 `hello "x & echo INJECTED` 會印出 `INJECTED`。
 *
 * 兩道防護：
 * 1. 提示文字走 stdin，不在命令列上（`ompOneShotArgs` 不再收 prompt）。
 * 2. 模型識別字過形狀檢查（`safeModelId`），不合法就當沒給。
 */
import { describe, expect, test } from "bun:test";
import { ompOneShotArgs, ompRpcUiArgs, safeModelId } from "../server/omp/cli.ts";

describe("模型識別字的形狀檢查", () => {
	test("真的模型名放行", () => {
		expect(safeModelId("minimax-code/MiniMax-M3.1-Flash-Preview")).toBe("minimax-code/MiniMax-M3.1-Flash-Preview");
		expect(safeModelId("gpt-5.2")).toBe("gpt-5.2");
		expect(safeModelId("  anthropic/claude-opus-4  ")).toBe("anthropic/claude-opus-4");
	});

	test("供應商真的會用的形狀也要放行", () => {
		// 這些是 OpenRouter 之類供應商實際在用的 id（實測自其 API）：
		// 供應商／模型，可能還有 `:free`、`:batch` 這種後綴。
		// 擋掉它們的後果是 `--model` 被**靜默地**略過，工作階段用預設模型開啟——
		// 使用者選了 A、實際跑的是 B，而且沒有任何錯誤。
		expect(safeModelId("recursive/flint-v1.0:free")).toBe("recursive/flint-v1.0:free");
		expect(safeModelId("openai/gpt-6.1-terra-pro:batch")).toBe("openai/gpt-6.1-terra-pro:batch");
		expect(safeModelId("meta-llama/llama-3.1-405b-instruct")).toBe("meta-llama/llama-3.1-405b-instruct");
		expect(safeModelId("qwen2.5-coder:7b")).toBe("qwen2.5-coder:7b");
		expect(safeModelId("openrouter/anthropic/claude-sonnet-4")).toBe("openrouter/anthropic/claude-sonnet-4");
	});

	test("帶 metachar 的一律拒絕", () => {
		// 這些字串若進到命令列就是注入。
		expect(safeModelId('x" & echo INJECTED')).toBeUndefined();
		expect(safeModelId("x & echo INJECTED")).toBeUndefined();
		expect(safeModelId("x|y")).toBeUndefined();
		expect(safeModelId("x>y")).toBeUndefined();
		expect(safeModelId("x`y")).toBeUndefined();
		expect(safeModelId("x$(y)")).toBeUndefined();
		expect(safeModelId("x%PATH%")).toBeUndefined();
		expect(safeModelId("x y")).toBeUndefined();
		expect(safeModelId("x\ny")).toBeUndefined();
		expect(safeModelId("x(y)")).toBeUndefined();
	});

	test("空值與空白都當沒給", () => {
		expect(safeModelId(undefined)).toBeUndefined();
		expect(safeModelId("")).toBeUndefined();
		expect(safeModelId("   ")).toBeUndefined();
	});
});

describe("命令列裡沒有使用者文字", () => {
	test("一次性呼叫不收 prompt 參數", () => {
		const args = ompOneShotArgs({ maxTime: "40s" });
		// `-p` 是 omp 的 print 模式開關，必須留著；被移除的是「提示文字本身」。
		expect(args).toContain("-p");
		expect(args).toContain("--no-session");
		// 提示走 stdin，所以命令列上沒有任何使用者文字。
		expect(args.filter(a => a.includes("INJECTED"))).toHaveLength(0);
		expect(args.length).toBe(6);
	});

	test("一次性呼叫的模型參數也過檢查", () => {
		const args = ompOneShotArgs({ model: { provider: 'p" & echo INJECTED', id: "m" } });
		expect(args.join(" ")).not.toContain("INJECTED");
		expect(args.join(" ")).not.toContain("--provider");
	});

	test("rpc-ui 的模型參數也過檢查", () => {
		const args = ompRpcUiArgs({ model: 'x" & echo INJECTED' });
		expect(args.join(" ")).not.toContain("INJECTED");
		expect(args.join(" ")).not.toContain("--model");
	});

	test("正常的模型參數照樣傳出去", () => {
		const args = ompRpcUiArgs({ model: "gpt-5.2" });
		expect(args).toContain("--model");
		expect(args).toContain("gpt-5.2");
	});
});
