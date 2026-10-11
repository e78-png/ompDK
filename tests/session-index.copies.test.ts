/**
 * D7: omp's saved-as sibling and a session the user branched both point at where they came
 * from, but not in the same way — the save-away re-stamps `parentSession` with the previous
 * session's *id* and carries its prompt cache key, while a branch names the source *file*. That
 * one difference is what lets the sidebar say "copy" about a duplicate without lying about a
 * session somebody made on purpose.
 */
import { describe, expect, test } from "bun:test";
import { findCopies, type SessionHeadFacts } from "../server/session-index.ts";

const ORIGINAL = "E:\\profiles\\agent\\sessions\\p\\2026-10-10T13-14-50-607Z_01a125f3.jsonl";
const COPY = "E:\\profiles\\agent\\sessions\\p\\2026-10-10T13-52-38-181Z_01a12616.jsonl";
const ORIGINAL_ID = "01a125f3";
const COPY_ID = "01a12616";

const head = (path: string, id: string, parent?: string, cacheKey?: string): SessionHeadFacts => ({ path, id, parent, cacheKey });

describe("findCopies", () => {
	test("两个字段都指向同一个已存在的会话：标成副本", () => {
		const found = findCopies([head(ORIGINAL, ORIGINAL_ID), head(COPY, COPY_ID, ORIGINAL_ID, ORIGINAL_ID)]);
		expect(found.get(COPY)).toBe(ORIGINAL);
		expect(found.size).toBe(1);
	});

	test("分叉记录的是路径：不是副本", () => {
		const found = findCopies([head(ORIGINAL, ORIGINAL_ID), head(COPY, COPY_ID, ORIGINAL)]);
		expect(found.size).toBe(0);
	});

	test("父会话有、缓存键指向别处：不猜", () => {
		const found = findCopies([head(ORIGINAL, ORIGINAL_ID), head(COPY, COPY_ID, ORIGINAL_ID, "01a10000")]);
		expect(found.size).toBe(0);
	});

	test("副本的副本也认出来：指向紧邻的前一个", () => {
		const FIRST = "E:\\profiles\\agent\\sessions\\p\\2026-10-10T12-00-00-000Z_01a12000.jsonl";
		const found = findCopies([head(FIRST, "01a12000"), head(ORIGINAL, ORIGINAL_ID, "01a12000", "01a12000"), head(COPY, COPY_ID, ORIGINAL_ID, "01a12000")]);
		expect(found.get(ORIGINAL)).toBe(FIRST);
		expect(found.get(COPY)).toBe(ORIGINAL);
	});

	test("子文件的键和父文件的键不同：不在同一条另存链上", () => {
		const found = findCopies([head(ORIGINAL, ORIGINAL_ID, undefined, "01a10000"), head(COPY, COPY_ID, ORIGINAL_ID, ORIGINAL_ID)]);
		expect(found.size).toBe(0);
	});

	test("缓存键被继承但父文件不在扫描结果里：没有可指的原文件", () => {
		expect(findCopies([head(COPY, COPY_ID, "01a19999", "01a19999")]).size).toBe(0);
	});

	test("头两个字段不一致：不是同一次另存", () => {
		expect(findCopies([head(ORIGINAL, ORIGINAL_ID), head(COPY, COPY_ID, ORIGINAL_ID)]).size).toBe(0);
		expect(findCopies([head(ORIGINAL, ORIGINAL_ID), head(COPY, COPY_ID, undefined, ORIGINAL_ID)]).size).toBe(0);
	});

	test("自己不会是自己的副本", () => {
		expect(findCopies([head(COPY, COPY_ID, COPY_ID, COPY_ID)]).size).toBe(0);
	});

	test("同一次扫描里的无关会话不受影响", () => {
		const other = "E:\\profiles\\agent\\sessions\\p\\2026-10-10T14-00-00-000Z_01a13000.jsonl";
		const found = findCopies([head(ORIGINAL, ORIGINAL_ID), head(COPY, COPY_ID, ORIGINAL_ID, ORIGINAL_ID), head(other, "01a13000")]);
		expect([...found]).toEqual([[COPY, ORIGINAL]]);
	});
});
