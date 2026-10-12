/**
 * Pairing for LAN access.
 *
 * One 6-digit code per gateway start, typed once on each phone; the phone then keeps a
 * 32-byte device token in a cookie for 30 days, so restarting the gateway does not log it
 * out — a new code only gates new devices. Loopback never pairs: the machine the gateway
 * runs on is already the one typing.
 *
 * The code never reaches the log, the token is stored as a SHA-256 digest, and every
 * comparison is a digest comparison, so neither a wrong guess nor a stolen file tells
 * anything about the real value.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import type { NetworkInterfaceInfo } from "node:os";
import * as path from "node:path";
import { config } from "./config.ts";
import { type Lang, msg } from "./messages.ts";

export const COOKIE_NAME = "omp_web_device";
/** Ten digits per code would be safer and unusable on a phone keyboard; the limits below pay for six. */
const CODE_DIGITS = 6;
const PAIR_FAIL_LIMIT = 5;
const PAIR_LOCK_MS = 10 * 60_000;
/** Wrong guesses across every device since the last code change: past this the code is burnt. */
const GLOBAL_FAIL_LIMIT = 20;
const DEVICE_TTL_MS = 30 * 24 * 60 * 60_000;
/** `lastSeen` is written at most this often; every attach would otherwise touch the disk. */
const LAST_SEEN_WRITE_MS = 60 * 60_000;

export const DEVICE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** One paired phone. The token itself is never kept. */
export interface Device {
	hash: string;
	createdAt: number;
	lastSeen: number;
	label: string;
}

export interface PublicDevice {
	label: string;
	lastSeen: number;
}

export type PairResult = { ok: true; token: string } | { ok: false; left: number } | { ok: false; lockedFor: number };

let current = randomCode();
const failures = new Map<string, { count: number; lockedUntil: number }>();
let globalFails = 0;
let cache: Device[] | undefined;

function randomCode(): string {
	// Leading zeros are part of the code: it is a string of six digits, not a number.
	return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

/** The code shown in the terminal and on the settings page. */
export function code(): string {
	return current;
}

/** A new code. Only the settings button and a wrong-code flood do this. */
export function rotate(): string {
	current = randomCode();
	return current;
}

function digest(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** Digest comparison: equal length always, so the timing says nothing about the value. */
function sameDigest(left: string, right: string): boolean {
	const a = Buffer.from(left, "hex");
	const b = Buffer.from(right, "hex");
	return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** Requests from the machine itself, IPv4, IPv6 and the mapped form Bun reports. */
export function isLoopback(ip: string | undefined): boolean {
	if (!ip) return false;
	const text = ip.toLowerCase();
	if (text.startsWith("::ffff:")) return isLoopback(text.slice(7));
	return text === "::1" || text.startsWith("127.");
}

/** Only a hint for the settings page; a phone is free to lie about it. */
export function deviceLabel(userAgent: string | undefined, lang: Lang = "zh"): string {
	const ua = userAgent ?? "";
	if (/iphone|ipad|ipod/i.test(ua)) return "iPhone / iPad";
	if (/android/i.test(ua)) return "Android";
	return msg(lang, ["其他", "Other"]);
}

/** Devices nobody used for a month are gone; exported so the rule is testable on its own. */
export function dropExpired(list: Device[], now = Date.now()): Device[] {
	return list.filter(device => now - device.lastSeen <= DEVICE_TTL_MS);
}

async function load(): Promise<Device[]> {
	if (cache) return cache;
	let list: Device[] = [];
	try {
		const parsed = JSON.parse(await fs.readFile(path.join(config.dataDir, "lan-devices.json"), "utf8")) as { devices?: unknown };
		if (Array.isArray(parsed.devices)) list = dropExpired((parsed.devices as Device[]).filter(d => d && typeof d.hash === "string"));
	} catch {
		// no device has paired yet, or the file is unreadable: nobody is paired
	}
	cache = list;
	return list;
}

async function save(list: Device[]): Promise<void> {
	cache = list;
	try {
		await fs.mkdir(config.dataDir, { recursive: true });
		await fs.writeFile(path.join(config.dataDir, "lan-devices.json"), JSON.stringify({ devices: list }, null, 1));
	} catch {
		// a device that cannot be remembered only has to pair again
	}
}

async function issue(userAgent: string | undefined, lang: Lang): Promise<string> {
	const token = randomBytes(32).toString("base64url");
	const list = await load();
	const now = Date.now();
	list.push({ hash: digest(token), createdAt: now, lastSeen: now, label: deviceLabel(userAgent, lang) });
	await save(list);
	return token;
}

/**
 * One attempt at the code. A locked address is refused before the comparison, so a correct
 * code does not shorten its own lockout.
 */
export async function tryPair(ip: string, input: string, userAgent?: string, lang: Lang = "zh"): Promise<PairResult> {
	const now = Date.now();
	let entry = failures.get(ip);
	if (entry && entry.lockedUntil && entry.lockedUntil <= now) {
		failures.delete(ip);
		entry = undefined;
	}
	if (entry?.lockedUntil && entry.lockedUntil > now) return { ok: false, lockedFor: entry.lockedUntil - now };

	if (sameDigest(digest(input.trim()), digest(current))) {
		failures.delete(ip);
		globalFails = 0;
		return { ok: true, token: await issue(userAgent, lang) };
	}

	const count = (entry?.count ?? 0) + 1;
	globalFails++;
	const locked = count >= PAIR_FAIL_LIMIT;
	failures.set(ip, { count, lockedUntil: locked ? now + PAIR_LOCK_MS : 0 });
	// Guessing is spread over addresses as well as over time, so the pile has a ceiling too.
	if (globalFails >= GLOBAL_FAIL_LIMIT) {
		globalFails = 0;
		console.log(`访问码已自动更换：${rotate()}`);
	}
	return locked ? { ok: false, lockedFor: PAIR_LOCK_MS } : { ok: false, left: PAIR_FAIL_LIMIT - count };
}

/** Is this cookie from a paired device? */
export async function verify(token: string | undefined): Promise<boolean> {
	if (!token) return false;
	const list = await load();
	const wanted = digest(token);
	const found = list.find(device => sameDigest(device.hash, wanted));
	if (!found) return false;
	const now = Date.now();
	if (now - found.lastSeen > LAST_SEEN_WRITE_MS) {
		found.lastSeen = now;
		await save(list);
	}
	return true;
}

/** Every paired phone, for the settings page. */
export async function devices(): Promise<PublicDevice[]> {
	const list = await load();
	return list.map(device => ({ label: device.label, lastSeen: device.lastSeen })).sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Forget every phone. Existing sockets are closed by the caller. */
export async function revokeAll(): Promise<void> {
	await save([]);
}

/** No `Secure`: this is plain HTTP, and a Secure cookie would simply not be stored. */
export function pairCookie(token: string): string {
	return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE}`;
}

export function tokenFromCookie(header: string | null): string | undefined {
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const cut = part.indexOf("=");
		if (cut < 0 || part.slice(0, cut).trim() !== COOKIE_NAME) continue;
		return decodeURIComponent(part.slice(cut + 1).trim());
	}
	return undefined;
}

/** 192.168.* first, then 10.*, then 172.16–31.*, then anything else. */
function privateRank(address: string): number {
	if (address.startsWith("192.168.")) return 0;
	if (address.startsWith("10.")) return 1;
	const second = Number(address.split(".")[1]);
	if (address.startsWith("172.") && second >= 16 && second <= 31) return 2;
	return 3;
}

/** Hypervisor switches answer too, but nobody carries a phone onto one. */
const VIRTUAL_ADAPTER = /vethernet|vmware|virtualbox|wsl|hyper-v|docker/i;

/** The addresses a phone can actually open, most likely one first. */
export function lanUrls(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, port: number): string[] {
	const found: { url: string; rank: number; virtual: boolean }[] = [];
	for (const [name, list] of Object.entries(interfaces)) {
		for (const info of list ?? []) {
			if (info.family !== "IPv4" || info.internal) continue;
			found.push({ url: `http://${info.address}:${port}`, rank: privateRank(info.address), virtual: VIRTUAL_ADAPTER.test(name) });
		}
	}
	found.sort((a, b) => Number(a.virtual) - Number(b.virtual) || a.rank - b.rank || a.url.localeCompare(b.url));
	return found.map(entry => entry.url);
}
