/**
 * LAN pairing: a six-digit code per start, an attempt limit per address plus a global one that
 * burns the code, and a device token that survives a restart but not a revocation.
 *
 * The attempt counting is cumulative by design, so the second describe block spells out how
 * many failures each case contributes and every case uses its own address.
 */
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config } from "../server/config.ts";
import * as lan from "../server/lan-auth.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-web-lan-${process.pid}-${Date.now()}`));
// Read while pairing rather than at import, so pointing it at a temp directory here is enough
// to keep the real one untouched.
config.dataDir = dir;

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A code that is certainly not the current one. */
const wrongCode = () => (lan.code() === "000000" ? "111111" : "000000");

describe("访问码", () => {
	test("总是 6 位数字，前导零也算数", () => {
		expect(lan.code()).toMatch(/^[0-9]{6}$/);
		expect(lan.rotate()).toMatch(/^[0-9]{6}$/);
		expect(lan.code()).toMatch(/^[0-9]{6}$/);
	});

	test("同一个地址错 5 次后被锁，锁定期内输对也不行", async () => {
		// 5 failures, counted against the global limit below.
		for (let attempt = 0; attempt < 4; attempt++) {
			expect(await lan.tryPair("192.168.1.50", wrongCode())).toMatchObject({ ok: false, left: 4 - attempt });
		}
		expect(await lan.tryPair("192.168.1.50", wrongCode())).toMatchObject({ ok: false, lockedFor: 10 * 60_000 });
		expect(await lan.tryPair("192.168.1.50", lan.code())).toMatchObject({ ok: false, lockedFor: 10 * 60_000 });
	});

	test("少数几个地址怎么猜都不会换码：单点猜不爆访问码", async () => {
		const before = lan.code();
		// Four addresses, five guesses each. Their own lockouts cap them there, and the code the
		// owner is reading off the terminal has to keep working while they fail.
		for (const ip of ["192.168.1.51", "192.168.1.52", "192.168.1.53", "192.168.1.54"]) {
			expect(await lan.tryPair(ip, wrongCode())).toMatchObject({ ok: false, left: 4 });
			for (let attempt = 0; attempt < 4; attempt++) await lan.tryPair(ip, wrongCode());
		}
		expect(lan.code()).toBe(before);
	});

	test("足够多的地址一起猜，才会自动换码", async () => {
		const before = lan.code();
		for (let host = 1; host <= 20; host++) await lan.tryPair(`10.0.0.${host}`, wrongCode());
		expect(lan.code()).not.toBe(before);
		expect(lan.code()).toMatch(/^[0-9]{6}$/);
	});
});

describe("设备令牌", () => {
	test("配对成功后令牌有效，别的字符串无效，落盘的是摘要", async () => {
		const result = await lan.tryPair("192.168.1.60", lan.code(), "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
		expect(result.ok).toBe(true);
		const token = result.ok ? result.token : "";
		expect(token.length).toBeGreaterThan(20);
		expect(await lan.verify(token)).toBe(true);
		expect(await lan.verify(`${token}x`)).toBe(false);
		expect(await lan.verify(undefined)).toBe(false);
		expect(await lan.devices()).toEqual([expect.objectContaining({ label: "iPhone / iPad" })]);

		const written = fs.readFileSync(path.join(dir, "lan-devices.json"), "utf8");
		expect(written).not.toContain(token);
		const parsed: unknown = JSON.parse(written);
		const stored = parsed && typeof parsed === "object" && "devices" in parsed ? parsed.devices : undefined;
		const first: unknown = Array.isArray(stored) ? stored[0] : undefined;
		const hash = first && typeof first === "object" && "hash" in first ? first.hash : undefined;
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	test("revokeAll 之后旧令牌失效", async () => {
		const result = await lan.tryPair("192.168.1.61", lan.code(), "Mozilla/5.0 (Linux; Android 14)");
		const token = result.ok ? result.token : "";
		expect(await lan.verify(token)).toBe(true);
		await lan.revokeAll();
		expect(await lan.verify(token)).toBe(false);
		expect(await lan.devices()).toEqual([]);
	});
});

describe("过期与地址判断", () => {
	test("超过 30 天没用的设备被丢掉", () => {
		const now = Date.UTC(2026, 9, 12);
		const device = (lastSeen: number) => ({ hash: "a".repeat(64), createdAt: lastSeen, lastSeen, label: "其他" });
		expect(lan.dropExpired([device(now - 1000)], now)).toHaveLength(1);
		expect(lan.dropExpired([device(now - 31 * 24 * 60 * 60_000)], now)).toHaveLength(0);
	});

	test("isLoopback 认得 IPv4、IPv6 和映射写法", () => {
		expect(lan.isLoopback("127.0.0.1")).toBe(true);
		expect(lan.isLoopback("127.8.1.9")).toBe(true);
		expect(lan.isLoopback("::1")).toBe(true);
		expect(lan.isLoopback("::ffff:127.0.0.1")).toBe(true);
		expect(lan.isLoopback("192.168.1.5")).toBe(false);
		expect(lan.isLoopback("::ffff:192.168.1.5")).toBe(false);
		expect(lan.isLoopback(undefined)).toBe(false);
	});
});
