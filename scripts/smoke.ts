// End-to-end gateway check: create session → attach → prompt → wait for prompt_result → reopen from index.
const base = `http://127.0.0.1:${process.env.OMP_WEB_PORT ?? 30191}`;
const cwd = `${import.meta.dir}/../.data/sandbox`;
const created = await (await fetch(`${base}/api/sessions`, { method: "POST", body: JSON.stringify({ cwd }) })).json();
console.log("created", created);
const ws = new WebSocket(base.replace("http", "ws") + "/ws");
const seen: Record<string, number> = {};
const { promise: finished, resolve, reject } = Promise.withResolvers<void>();
let completed = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
const timeout = setTimeout(() => {
	console.error("TIMEOUT");
	reject(new Error("等待 prompt_result 超时"));
}, 60000);
ws.onmessage = ev => {
	const m = JSON.parse(String(ev.data));
	const k = m.t === "frame" ? `frame:${m.frame.type}` : m.t;
	seen[k] = (seen[k] ?? 0) + 1;
	if (m.t === "snapshot") {
		console.log("snapshot msgs", m.messages.length, "model", m.state.model?.id, "file", m.state.sessionFile);
		ws.send(JSON.stringify({ t: "rpc", key: created.key, rid: "r1", cmd: { type: "prompt", message: "只回复两个字：你好" } }));
	}
	if (m.t === "rpc_res") {
		console.log("rpc_res", m);
		if (!m.ok) reject(new Error(m.error ?? "RPC 失败"));
	}
	if (m.t === "frame" && m.frame.type === "message_update" && seen[k] === 1) console.log("delta sample", JSON.stringify(m.frame).slice(0, 300));
	if (m.t === "frame" && m.frame.type === "prompt_result") {
		clearTimeout(timeout);
		if (m.frame.status !== "completed") reject(new Error(m.frame.error ?? `请求未完成：${m.frame.status ?? "unknown"}`));
		else {
			completed = true;
			settleTimer = setTimeout(resolve, 800);
		}
	}
};
ws.onopen = () => ws.send(JSON.stringify({ t: "attach", key: created.key }));
ws.onerror = () => reject(new Error("WebSocket 连接失败"));
ws.onclose = () => completed ? resolve() : reject(new Error("WebSocket 连接已关闭"));
try {
	await finished;
	console.log("seen", seen);
	const index = await (await fetch(`${base}/api/index`)).json();
	console.log("projects", index.projects.map((p: any) => `${p.name}:${p.sessionCount}`).join(", "));
	console.log("sessions", index.sessions.slice(0, 3).map((s: any) => `${s.title} [${s.live}]`));
} finally {
	clearTimeout(timeout);
	clearTimeout(settleTimer);
	ws.close();
}
