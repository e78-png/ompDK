/**
 * Which names a request may arrive under.
 *
 * A page on any site can reach a gateway on loopback: WebSockets ignore the same-origin
 * policy, and a DNS name that resolves to 127.0.0.1 (DNS rebinding) arrives with a Host of
 * the attacker's own choosing. So the Host header has to name something this machine
 * actually answers on, and when the browser sends an Origin it has to agree.
 *
 * Requests without an Origin are allowed: curl, the launcher's health check and
 * `profile-lock.ts`'s probe never send one, and a page always does.
 */
import type { NetworkInterfaceInfo } from "node:os";
import { langOf, msg } from "./messages.ts";

/** Names that are this machine whatever the network looks like. */
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

export interface GuardOptions {
	/** LAN mode answers on every interface, so the machine's own addresses are allowed too. */
	lan: boolean;
	/** `OMP_WEB_ALLOWED_HOSTS`: room for a reverse proxy in front of the gateway. */
	extra: string[];
	interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
}

/**
 * `example.com:30190` → `example.com`, `[::1]:30190` → `::1`, `192.168.1.5` unchanged.
 * IPv6 without brackets has several colons and no port, so only a lone colon is a port.
 */
export function bareHost(value: string): string {
	let host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		return end < 0 ? host.slice(1) : host.slice(1, end);
	}
	const colon = host.lastIndexOf(":");
	if (colon >= 0 && host.indexOf(":") === colon) host = host.slice(0, colon);
	return host;
}

/** Every name this gateway accepts, lowercased. */
export function allowedHosts(options: GuardOptions): Set<string> {
	const hosts = new Set(LOOPBACK_HOSTS);
	if (options.lan) {
		for (const list of Object.values(options.interfaces)) {
			for (const info of list ?? []) if (info.family === "IPv4" && !info.internal) hosts.add(info.address.toLowerCase());
		}
	}
	for (const name of options.extra) {
		const host = bareHost(name);
		if (host) hosts.add(host);
	}
	return hosts;
}

/** The reason to refuse this request, or `undefined` to let it through. */
export function checkRequest(req: Request, hosts: Set<string>): string | undefined {
	const lang = langOf(req.headers.get("x-omp-web-lang"));
	const header = req.headers.get("host");
	if (!header) return msg(lang, ["缺少 Host 头", "Missing Host header"]);
	const host = bareHost(header);
	if (!hosts.has(host)) return msg(lang, ["Host {host} 不被允许", "Host {host} is not allowed"], { host });

	const origin = req.headers.get("origin");
	if (origin === null) return undefined;
	// A sandboxed frame or a `file://` page sends "null" and names no host we can check.
	if (!origin.trim() || origin.trim().toLowerCase() === "null") return msg(lang, ["Origin 为 null", "Origin is null"]);
	let originHost: string;
	try {
		originHost = bareHost(new URL(origin).host);
	} catch {
		return msg(lang, ["Origin 无法解析：{origin}", "Unparsable Origin: {origin}"], { origin });
	}
	if (!originHost || !hosts.has(originHost)) return msg(lang, ["Origin {origin} 不被允许", "Origin {origin} is not allowed"], { origin: originHost || origin });
	return undefined;
}
