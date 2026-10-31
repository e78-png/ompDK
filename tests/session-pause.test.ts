/**
 * 凍結：訊息攢著不送，解除時依序送出。
 *
 * 為什麼要有這個測試：凍結是「先把訊息攢在某裡」——攢錯地方（送出去了）、或解除
 * 時漏送、順序亂掉，使用者只會覺得「我按了凍結，訊息不見了」。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SessionStore } from "../web/src/lib/session-store.ts";

// The store schedules its notifications on an animation frame; there is no browser here.
// The stand-in runs the callback on the microtask queue, so no test waits on wall-clock time.
const previousRaf = globalThis.requestAnimationFrame;
const previousCancel = globalThis.cancelAnimationFrame;
beforeAll(() => {
	globalThis.requestAnimationFrame = callback => {
		queueMicrotask(() => callback(performance.now()));
		return 0;
	};
	globalThis.cancelAnimationFrame = () => undefined;
});
afterAll(() => {
	globalThis.requestAnimationFrame = previousRaf;
	globalThis.cancelAnimationFrame = previousCancel;
});

describe("凍結", () => {
	test("凍結中攢下的訊息依序留著", () => {
		const store = new SessionStore("k");
		store.setPaused(true);
		expect(store.paused).toBe(true);
		store.holdPaused("第一則");
		store.holdPaused("第二則");
		expect(store.pausedMessages.map(m => m.text)).toEqual(["第一則", "第二則"]);
	});

	test("解除凍結時把攢著的訊息依序取出，並且清空", () => {
		const store = new SessionStore("k");
		store.setPaused(true);
		store.holdPaused("第一則");
		store.holdPaused("第二則");
		store.setPaused(false);
		const held = store.takePaused();
		expect(held.map(m => m.text)).toEqual(["第一則", "第二則"]);
		expect(store.pausedMessages).toEqual([]);
	});

	test("沒有攢著訊息時取出來是空的", () => {
		const store = new SessionStore("k");
		expect(store.takePaused()).toEqual([]);
	});
});
