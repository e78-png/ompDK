/**
 * The request guard: which Host (and Origin) this gateway answers to. Without it any page
 * on the machine could drive the gateway over loopback — WebSockets ignore the same-origin
 * policy — and a DNS name pointing at 127.0.0.1 would arrive under a Host of its own.
 */
import { describe, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { allowedHosts, bareHost, checkRequest } from "../server/request-guard.ts";

function iface(address: string, family: "IPv4" | "IPv6", internal = false): NetworkInterfaceInfo {
	const common = { address, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", internal, cidr: `${address}/24` };
	return family === "IPv6" ? { ...common, family, scopeid: 0 } : { ...common, family };
}

const interfaces = {
	以太网: [iface("192.168.1.5", "IPv4")],
	Hyper_V: [iface("172.20.80.1", "IPv4")],
	Loopback: [iface("127.0.0.1", "IPv4", true), iface("::1", "IPv6", true)],
};

const hosts = (lan: boolean, extra: string[] = []) => allowedHosts({ lan, extra, interfaces });
const req = (headers: Record<string, string>) => new Request("http://127.0.0.1:30190/api/health", { headers });
/** `undefined` means the request was let through. */
const refused = (headers: Record<string, string>, list = hosts(false)) => checkRequest(req(headers), list) !== undefined;

describe("bareHost", () => {
	test("去掉端口、方括号和大小写", () => {
		expect(bareHost("Example.COM:30190")).toBe("example.com");
		expect(bareHost("[::1]:30190")).toBe("::1");
		expect(bareHost("[fe80::1]")).toBe("fe80::1");
	});

	test("没有方括号的 IPv6 不是「地址加端口」", () => {
		expect(bareHost("::1")).toBe("::1");
		expect(bareHost("fe80::1")).toBe("fe80::1");
	});
});

describe("Host 头", () => {
	test("回环地址放行，别的名字拒绝", () => {
		expect(refused({ host: "127.0.0.1:30190" })).toBe(false);
		expect(refused({ host: "localhost" })).toBe(false);
		expect(refused({ host: "[::1]:30190" })).toBe(false);
		expect(refused({ host: "evil.example:30190" })).toBe(true);
	});

	test("没有 Host 头就拒绝", () => {
		expect(refused({})).toBe(true);
	});

	test("局域网关闭时，本机网卡地址不算自己", () => {
		expect(refused({ host: "192.168.1.5:30190" }, hosts(false))).toBe(true);
		expect(refused({ host: "192.168.1.5:30190" }, hosts(true))).toBe(false);
		// 网卡上的内部地址与虚拟网卡照样列进来，它们仍然属于这台机器
		expect(refused({ host: "172.20.80.1:30190" }, hosts(true))).toBe(false);
	});

	test("OMP_WEB_ALLOWED_HOSTS 里的名字总是放行，忽略大小写和空白", () => {
		expect(refused({ host: "omp.lan:30190" }, hosts(false, ["omp.lan"]))).toBe(false);
		expect(refused({ host: "OMP.LAN:30190" }, hosts(false, [" omp.lan "]))).toBe(false);
		expect(refused({ host: "omp.lan:30190" }, hosts(false, ["", "  "]))).toBe(true);
	});
});

describe("Origin 头", () => {
	test("浏览器带的 Origin 必须和 Host 同源名单", () => {
		expect(refused({ host: "127.0.0.1:5190", origin: "http://127.0.0.1:5190" })).toBe(false);
		expect(refused({ host: "localhost:5190", origin: "http://localhost:5190" })).toBe(false);
		// Host 认得，Origin 报的是另一个名字：页面不在这个网关上
		expect(refused({ host: "127.0.0.1:30190", origin: "http://my-other-box.lan:30190" })).toBe(true);
		expect(refused({ host: "127.0.0.1:30190", origin: "https://evil.example" })).toBe(true);
	});

	test("Origin: null 一律拒绝，认不出的也拒绝", () => {
		expect(refused({ host: "127.0.0.1:30190", origin: "null" })).toBe(true);
		expect(refused({ host: "127.0.0.1:30190", origin: "http://" })).toBe(true);
	});

	test("没有 Origin 的请求放行：curl、启动脚本和锁探测都不带", () => {
		expect(refused({ host: "127.0.0.1:30190" })).toBe(false);
	});
});
