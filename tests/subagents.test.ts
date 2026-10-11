/**
 * The subagent fold both the gateway and the browser run on the same frames. What matters
 * here is that a frame which omits a field never loses what is already known about that
 * subagent, and that an unplaceable frame is dropped rather than filed under a made-up key.
 */
import { describe, expect, test } from "bun:test";
import { applySubagentLifecycle, applySubagentProgress, progressKey } from "../shared/subagents.ts";
import type { SubagentSnapshot } from "../shared/omp/wire.ts";

const map = (...entries: SubagentSnapshot[]) => new Map(entries.map(s => [s.id, s]));
const snapshot = (over: Partial<SubagentSnapshot>): SubagentSnapshot => ({ id: "a1", index: 0, status: "running", lastUpdate: 1, ...over });

describe("applySubagentLifecycle", () => {
	test("started 是我们的 running，索引用来吃掉进度帧留下的占位", () => {
		const all = map(snapshot({ id: progressKey(2), index: 2 }));
		applySubagentLifecycle(all, { id: "a1", index: 2, status: "started", agent: "explore" });
		expect([...all.keys()]).toEqual(["a1"]);
		expect(all.get("a1")).toMatchObject({ index: 2, status: "running", agent: "explore" });
	});

	test("没有 id 的帧直接丢掉，认不出的状态按运行中处理", () => {
		const all = new Map<string, SubagentSnapshot>();
		applySubagentLifecycle(all, { index: 1, status: "started" });
		expect(all.size).toBe(0);
		applySubagentLifecycle(all, { id: "a2", index: 1, status: "succeeded" });
		expect(all.get("a2")?.status).toBe("running");
	});

	test("帧里没带的字段沿用已知的值，而不是抹成空", () => {
		const all = map(snapshot({ id: "a1", index: 1, agent: "explore", description: "找文件", sessionFile: "/tmp/s.jsonl", parentToolCallId: "call1" }));
		applySubagentLifecycle(all, { id: "a1", index: 1, status: "completed" });
		expect(all.get("a1")).toMatchObject({ status: "completed", agent: "explore", description: "找文件", sessionFile: "/tmp/s.jsonl", parentToolCallId: "call1" });
	});
});

describe("applySubagentProgress", () => {
	test("进度帧按 progress.id 归位，并换掉索引键的占位条目", () => {
		const all = map(snapshot({ id: progressKey(0), index: 0 }));
		applySubagentProgress(all, { index: 0, agent: "worker", task: "读代码", progress: { id: "a1", status: "running" } });
		expect([...all.keys()]).toEqual(["a1"]);
		expect(all.get("a1")).toMatchObject({ index: 0, agent: "worker", task: "读代码" });
	});

	test("同一索引下绑到最近更新的那一条，不再造第三个条目", () => {
		const all = map(snapshot({ id: "old", index: 3, lastUpdate: 10 }), snapshot({ id: "new", index: 3, lastUpdate: 20 }));
		applySubagentProgress(all, { index: 3, task: "继续", progress: { status: "running" } });
		expect(all.size).toBe(2);
		expect(all.get("new")?.task).toBe("继续");
		expect(all.get("old")?.task).toBeUndefined();
	});

	test("终态由生命周期帧决定，进度帧不能把它改回运行中", () => {
		const all = map(snapshot({ id: "a1", index: 0, status: "completed" }));
		applySubagentProgress(all, { index: 0, task: "迟到的一步", progress: { status: "running" } });
		expect(all.get("a1")?.status).toBe("completed");
	});

	test("缺字段的帧不覆盖已有的值；既没有 id 也没有索引的帧被丢掉", () => {
		const all = map(snapshot({ id: "a1", index: 0, task: "原任务", assignment: "分工", progress: { tokens: 12 } }));
		applySubagentProgress(all, { index: 0 });
		expect(all.get("a1")).toMatchObject({ task: "原任务", assignment: "分工", progress: { tokens: 12 } });
		applySubagentProgress(all, { agent: "worker" });
		expect(all.size).toBe(1);
	});
});
