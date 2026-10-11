import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import * as path from "node:path";

/** A local fake gateway verifies the script exits; no OMP process or model call is involved. */
async function run(mode: "success" | "error" | "aborted" | "closed"): Promise<{ code: number | null; timedOut: boolean; output: string }> {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, server) {
			const route = new URL(request.url).pathname;
			if (route === "/ws" && server.upgrade(request)) return;
			if (route === "/api/sessions") return Response.json({ key: "fixture" });
			if (route === "/api/index") return Response.json({ projects: [{ name: "fixture", sessionCount: 1 }], sessions: [{ title: "fixture", live: "idle" }] });
			return new Response("Not found", { status: 404 });
		},
		websocket: {
			message(socket, raw) {
				const msg = JSON.parse(String(raw));
				if (msg.t === "attach") socket.send(JSON.stringify({ t: "snapshot", messages: [], state: { model: { id: "fixture" }, sessionFile: "fixture" } }));
				if (msg.t === "rpc") {
					if (mode === "closed") socket.close();
					else socket.send(JSON.stringify({ t: "frame", frame: { type: "prompt_result", status: mode === "success" ? "completed" : mode, error: mode === "error" ? "fixture failure" : undefined } }));
				}
			},
		},
	});
	const child = spawn(process.execPath, ["run", path.resolve(import.meta.dir, "../scripts/smoke.ts")], {
		windowsHide: true,
		env: { ...process.env, OMP_WEB_PORT: String(server.port) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	let timedOut = false;
	child.stdout.on("data", chunk => { output += String(chunk); });
	child.stderr.on("data", chunk => { output += String(chunk); });
	const exited = new Promise<number | null>((resolve, reject) => {
		child.once("close", resolve);
		child.once("error", reject);
	});
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, 4000);
	try {
		return { code: await exited, timedOut, output };
	} finally {
		clearTimeout(timer);
		server.stop(true);
	}
}

describe("smoke 脚本生命周期", () => {
	test("成功后立即清理兜底计时器并退出", async () => {
		const result = await run("success");
		expect(result.timedOut).toBe(false);
		expect(result.code).toBe(0);
		expect(result.output).toContain("seen");
		expect(result.output).not.toContain("TIMEOUT");
	}, 10000);

	for (const [mode, label, error] of [
		["error", "prompt_result 失败", "fixture failure"],
		["aborted", "prompt_result 被中断", "请求未完成：aborted"],
		["closed", "WebSocket 提前关闭", "连接已关闭"],
	] as const) {
		test(`${label}时结束等待并返回非零退出码`, async () => {
			const result = await run(mode);
			expect(result.timedOut).toBe(false);
			expect(result.code).not.toBe(0);
			expect(result.output).toContain(error);
		}, 10000);
	}
});
