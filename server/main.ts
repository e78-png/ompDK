import * as fs from "node:fs/promises";
import * as path from "node:path";
import { API_VERSION, type ClientMsg, type OmpCheck, type ServerMsg } from "../shared/api.ts";
import { archivedKeys, archiveKey, setArchived } from "./archive.ts";
import { getCommands, warmCommands } from "./command-catalog.ts";
import { config } from "./config.ts";
import { contentTypeFor, gitDiff, gitStatus, inside, listTree, readFileView } from "./files.ts";
import { HttpError } from "./http-error.ts";
import { invalidateModels, listModels, warmModels } from "./models.ts";
import { readAgentSettings, setAgentOverride, setPlanDefault, setRole } from "./agent-settings.ts";
import { addProject, listDir, listProjects, removeProject } from "./projects.ts";
import { invalidate as dropPluginCaches, listPlugins, listSkills, readSkillFile, setPluginEnabled, setSkillEnabled, skillFilePath } from "./plugins.ts";
import { type ProviderConfig, type ProvidersView, assertProviderId, modelsFile, readProviders, removeProvider, writeProvider } from "./providers.ts";
import { cleanOrphanSessions } from "./orphans.ts";
import { claimProfileLock, gatewayPid, releaseProfileLock } from "./profile-lock.ts";
import { type LiveSession, ModelUnavailableError, SessionHub, SessionOwnedError, type Socket } from "./session-hub.ts";
import { listSessions, samePath } from "./session-index.ts";
import { ompVersionArgs, runOmp } from "./omp/cli.ts";
import { capabilities } from "./omp/capabilities.ts";
import { checkOmp } from "./omp/compat.ts";

const hub = new SessionHub();
/** When this process booted; the launcher compares it with source mtimes. */
const startedAt = Date.now();
/** Sessions each socket is attached to, for cleanup on close. */
const attachments = new WeakMap<Socket, Set<LiveSession>>();
let nextSocketId = 1;

/**
 * `<dataDir>/gateway.json` — a token only a process that can read this user's data directory
 * can present. Restarting the gateway stops every omp child, so it is not something a page
 * gets to ask for; `launch.ts --restart` reads this file and echoes it back.
 */
const gatewayFile = path.join(config.dataDir, "gateway.json");
const gatewayToken = crypto.randomUUID();

let closing = false;
/**
 * The one way this process leaves: drain every omp child and wait for it to exit, then go.
 * `process.kill` from the launcher is TerminateProcess on Windows and skips this entirely,
 * which is how a restart left children alive and holding the session files they were writing.
 */
async function closeGateway(): Promise<void> {
	if (closing) return;
	closing = true;
	await hub.shutdown().catch(error => console.error(`[shutdown] 子进程清理失败：${String((error as Error)?.message ?? error)}`));
	await releaseProfileLock();
	process.exit(0);
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function fail(error: unknown, status = 400): Response {
	return json({ error: error instanceof Error ? error.message : String(error) }, status);
}

async function sessionIndex() {
	const all = await listSessions();
	// Live sessions not yet persisted (fresh, before first message) are omitted by the scan.
	for (const s of all) s.live = hub.liveStatus(s.path);
	const hidden = await archivedKeys();
	const sessions = all.filter(s => !hidden.has(archiveKey(s.path)));
	const archived = all.filter(s => hidden.has(archiveKey(s.path)));
	const projects = await listProjects(sessions);
	return { projects, sessions, archived };
}

async function ensureLive(key: string, model?: string, force?: boolean): Promise<LiveSession> {
	const live = hub.find(key);
	if (live) return live;
	const summary = (await listSessions()).find(s => samePath(s.path, key));
	if (!summary) throw new Error("会话不存在或尚未保存");
	return hub.open(summary.path, summary.cwd || path.dirname(summary.path), model, force);
}

const MAX_SEARCH_RESULTS = 50;
/** Own files considered before giving up, so one query never walks a whole monorepo. */
const MAX_SCANNED_FILES = 3000;
/** Hard stop over everything visited, including skipped folders such as node_modules. */
const MAX_VISITED_PATHS = 20_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

/** Substring search over a project's files for the composer's `@` completion. */
async function searchFiles(cwd: string, query: string): Promise<{ files: string[]; truncated: boolean }> {
	const needle = query.toLowerCase();
	const files: string[] = [];
	let scanned = 0;
	let visited = 0;
	for await (const entry of new Bun.Glob("**/*").scan({ cwd, onlyFiles: true, dot: false, followSymlinks: false })) {
		const rel = entry.replace(/\\/g, "/");
		if (++visited > MAX_VISITED_PATHS) return { files, truncated: true };
		if (rel.split("/").some(part => SKIP_DIRS.has(part))) continue;
		if (++scanned > MAX_SCANNED_FILES) return { files, truncated: true };
		if (needle && !rel.toLowerCase().includes(needle)) continue;
		files.push(rel);
		if (files.length >= MAX_SEARCH_RESULTS) return { files, truncated: true };
	}
	return { files, truncated: false };
}

/** `@` completion may only look inside a directory the app already knows: a project or a session cwd. */
async function knownCwd(cwd: string): Promise<boolean> {
	if (!cwd) return false;
	const { projects, sessions } = await sessionIndex();
	return (
		projects.some(p => samePath(p.path, cwd)) ||
		sessions.some(s => s.cwd && samePath(s.cwd, cwd)) ||
		(hub.sessions.size > 0 && [...hub.sessions.values()].some(l => samePath(l.cwd, cwd)))
	);
}

/** Rename through the gateway: the session may not be running yet, and the hub refreshes the index. */
async function renameSession(file: string, name: string): Promise<{ key: string }> {
	const live = await ensureLive(file);
	const res = await live.command({ type: "set_session_name", name });
	if (!res.success) throw new HttpError(String(res.error ?? "重命名失败"), 400);
	return { key: live.key };
}

/** Write the transcript as standalone HTML under `<dataDir>/exports` and hand back its file name. */
async function exportSession(file: string): Promise<{ name: string }> {
	const live = await ensureLive(file);
	const name = `${path.basename(file).replace(/\.jsonl$/i, "")}.html`;
	const dir = path.join(config.dataDir, "exports");
	await fs.mkdir(dir, { recursive: true });
	const res = await live.command({ type: "export_html", outputPath: path.join(dir, name) });
	if (!res.success) throw new HttpError(String(res.error ?? "导出失败"), 400);
	return { name };
}

/** Hide (or unhide) a session in the web UI. The file itself is not touched. */
async function archiveSession(file: string, archived: boolean): Promise<{ ok: true }> {
	const source = path.resolve(file);
	if (!inside(config.sessionsRoot, source)) throw new HttpError("不是会话文件", 400);
	await setArchived(source, archived);
	hub.indexChanged();
	return { ok: true };
}

/**
 * Permanently delete an archived session: its transcript and the artifact
 * directory next to it. Only archived sessions qualify (two deliberate steps),
 * and never one that is still running.
 */
async function deleteSession(file: string): Promise<{ ok: true }> {
	const source = path.resolve(file);
	if (!inside(config.sessionsRoot, source) || !source.toLowerCase().endsWith(".jsonl")) throw new HttpError("不是会话文件", 400);
	if (!(await archivedKeys()).has(archiveKey(source))) throw new HttpError("只能删除已归档的会话", 409);
	const live = hub.find(source);
	if (live?.state.isStreaming) throw new HttpError("会话正在运行，先停止再删除", 409);
	if (live) await hub.stop(live);
	await removeSessionFiles(source);
	hub.indexChanged();
	return { ok: true };
}

/** The `.jsonl` and its same-named artifact directory. Callers check the path and that nothing runs on it. */
async function removeSessionFiles(source: string): Promise<void> {
	await fs.rm(source, { force: true });
	const artifacts = source.replace(/\.jsonl$/i, "");
	if (inside(config.sessionsRoot, artifacts) && !samePath(artifacts, config.sessionsRoot)) await fs.rm(artifacts, { recursive: true, force: true });
	await setArchived(source, false);
}

/**
 * Edit-and-resend: move the live session onto a branch that ends just before the
 * user message `entryId` (omp `branch`), keep its title, then delete the old file —
 * the user chose to drop the abandoned turns (forking first keeps them). Returns
 * omp's branch payload; the browser sends the edited prompt after the rekey.
 */
async function rewindSession(live: LiveSession, entryId: string): Promise<Record<string, unknown> & { type: string }> {
	if (live.state.isStreaming) throw new Error("会话正在运行，先停止再编辑");
	const old = live.state.sessionFile;
	const oldName = live.state.sessionName;
	const res = await live.command({ type: "branch", entryId });
	if (!res.success || (res.data as { cancelled?: boolean } | undefined)?.cancelled) return res;
	const now = live.state.sessionFile;
	if (oldName && !live.state.sessionName) await live.command({ type: "set_session_name", name: oldName });
	if (old && now && !samePath(old, now) && inside(config.sessionsRoot, old) && !hub.find(old)) {
		await removeSessionFiles(path.resolve(old));
		hub.indexChanged();
	}
	return res;
}

let ompVersion: string | undefined;
/** Result of the light startup check; null until it finishes (about a second after boot). */
let ompCheck: OmpCheck | null = null;

/** Versions and data locations for the settings "关于" page. */
async function about() {
	if (ompVersion === undefined) {
		try {
			ompVersion = (await runOmp(ompVersionArgs())).stdout.trim();
		} catch {
			ompVersion = "";
		}
	}
	const agentDir = path.dirname(config.sessionsRoot);
	return {
		ompVersion,
		agentDir,
		sessionsRoot: config.sessionsRoot,
		modelsFile: modelsFile(),
		dataDir: config.dataDir,
		testProfile: Boolean(config.agentDir),
		modelLock: config.modelLock ?? null,
	};
}

/** Show a location in the OS file manager. Callers pass a server-resolved path, never a client-supplied one. */
async function revealAt(file: string, select: boolean): Promise<{ ok: true }> {
	if (process.platform !== "win32") throw new HttpError("仅支持 Windows", 400);
	const exists = await fs.stat(file).then(() => true, () => false);
	const args = select && exists ? ["explorer.exe", `/select,${file}`] : ["explorer.exe", exists ? file : path.dirname(file)];
	Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
	return { ok: true };
}

async function reveal(target: string): Promise<{ ok: true }> {
	const info = await about();
	const map: Record<string, { path: string; select: boolean }> = {
		models: { path: info.modelsFile, select: true },
		agent: { path: info.agentDir, select: false },
		data: { path: info.dataDir, select: false },
	};
	const entry = map[target];
	if (!entry) throw new HttpError("未知位置", 400);
	return revealAt(entry.path, entry.select);
}

/** Provider edits touch a file the user also edits by hand: never write when it does not parse. */
async function providersView(): Promise<ProvidersView> {
	try {
		return await readProviders();
	} catch (error) {
		throw new HttpError(`models.yml 解析失败，未做任何改动：${(error as Error).message}`, 409);
	}
}

/** Resolve the `cwd` query parameter of a panel endpoint, or refuse it. */
async function cwdParam(url: URL): Promise<string> {
	return checkedCwd(url.searchParams.get("cwd") ?? "");
}

/** Shared by query and body callers: only directories the app already knows are readable. */
async function checkedCwd(raw: string): Promise<string> {
	if (!raw) throw new HttpError("缺少 cwd", 400);
	const cwd = path.resolve(raw);
	if (!(await knownCwd(cwd))) throw new HttpError("未知项目目录", 403);
	return cwd;
}

function sendTo(ws: Socket, msg: ServerMsg): void {
	ws.send(JSON.stringify(msg));
}

async function onClientMessage(ws: Socket, msg: ClientMsg): Promise<void> {
	switch (msg.t) {
		case "attach": {
			sendTo(ws, { t: "proc", key: msg.key, status: "starting" });
			try {
				const live = await ensureLive(msg.key, typeof msg.model === "string" && msg.model ? msg.model : undefined, msg.force === true);
				if (!samePath(live.key, msg.key)) sendTo(ws, { t: "rekey", from: msg.key, to: live.key });
				let set = attachments.get(ws);
				if (!set) attachments.set(ws, (set = new Set()));
				set.add(live);
				sendTo(ws, { t: "proc", key: live.key, status: "ready" });
				live.attach(ws);
				hub.indexChanged();
			} catch (error) {
				const lostModel = error instanceof ModelUnavailableError ? error.lostModel : undefined;
				const ownedBy = error instanceof SessionOwnedError ? error.ownerPid : undefined;
				const code = error instanceof SessionOwnedError ? "session_owned_elsewhere" : undefined;
				sendTo(ws, { t: "proc", key: msg.key, status: "exited", error: (error as Error).message, code, lostModel, ownedBy });
			}
			return;
		}
		case "detach": {
			const live = hub.find(msg.key);
			if (!live) return;
			live.detach(ws);
			attachments.get(ws)?.delete(live);
			return;
		}
		case "rpc": {
			try {
				const live = hub.find(msg.key);
				if (!live) throw new Error("会话未运行");
				const res = msg.cmd.type === "web_rewind" ? await rewindSession(live, String(msg.cmd.entryId)) : await live.command(msg.cmd);
				sendTo(ws, res.success ? { t: "rpc_res", rid: msg.rid, ok: true, data: res.data } : { t: "rpc_res", rid: msg.rid, ok: false, error: String(res.error ?? "失败") });
			} catch (error) {
				sendTo(ws, { t: "rpc_res", rid: msg.rid, ok: false, error: (error as Error).message });
			}
			return;
		}
		case "ui": {
			hub.find(msg.key)?.answerUi(msg.payload);
			return;
		}
	}
}

async function api(req: Request, url: URL): Promise<Response> {
	const route = `${req.method} ${url.pathname}`;
	// The launcher's restart. Loopback and the on-disk token both have to check out: this
	// stops every omp child, so it must not be reachable by a page or another machine.
	if (route === "POST /api/shutdown") {
		const peer = server.requestIP(req)?.address;
		if (peer && peer !== "::1" && !peer.startsWith("127.")) return fail("只能由本机停止", 403);
		if (req.headers.get("x-omp-web-token") !== gatewayToken) return fail("停止令牌不符", 403);
		const draining = hub.sessions.size;
		// Answer first: the launcher waits for the port to free, and a socket closed under a
		// pending response would look like a crash instead of a restart.
		setTimeout(() => void closeGateway(), 150);
		return json({ ok: true, sessions: draining });
	}
	// Exported transcripts: read by file name out of `<dataDir>/exports`.
	if (route.startsWith("GET /api/exports/")) {
		const name = decodeURIComponent(url.pathname.slice("/api/exports/".length));
		if (!/^[A-Za-z0-9._-]+$/.test(name)) return fail("非法文件名");
		const file = Bun.file(path.join(config.dataDir, "exports", name));
		if (!(await file.exists())) return fail("导出文件不存在", 404);
		return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
	}
	try {
		switch (route) {
			case "GET /api/index":
				return json(await sessionIndex());
			case "POST /api/projects": {
				const body = (await req.json()) as { path: string };
				return json({ path: await addProject(body.path) });
			}
			case "DELETE /api/projects": {
				await removeProject(url.searchParams.get("path") ?? "");
				return json({ ok: true });
			}
			case "GET /api/fs":
				return json(await listDir(url.searchParams.get("path") ?? ""));
			case "GET /api/files/search":
				return json(await searchFiles(await cwdParam(url), url.searchParams.get("q") ?? ""));
			case "GET /api/fs/tree":
				return json(await listTree(await cwdParam(url), url.searchParams.get("path") ?? ""));
			case "GET /api/fs/file":
				return json(await readFileView(await cwdParam(url), url.searchParams.get("path") ?? ""));
			case "GET /api/fs/raw": {
				const { file, type } = contentTypeFor(await cwdParam(url), url.searchParams.get("path") ?? "");
				const body = Bun.file(file);
				if (!(await body.exists())) return fail("文件不存在", 404);
				return new Response(body, { headers: { "content-type": type, "cache-control": "no-store" } });
			}
			case "GET /api/git/status":
				return json(await gitStatus(await cwdParam(url)));
			case "GET /api/git/diff":
				return json(await gitDiff(await cwdParam(url), url.searchParams.get("path") ?? ""));
			case "POST /api/sessions": {
				const body = (await req.json()) as { cwd: string };
				const live = await hub.create(path.resolve(body.cwd));
				return json({ key: live.key, cwd: live.cwd });
			}
			case "POST /api/sessions/rename": {
				const body = (await req.json()) as { path: string; name: string };
				return json(await renameSession(path.resolve(body.path), body.name));
			}
			case "POST /api/sessions/export":
				return json(await exportSession(path.resolve(((await req.json()) as { path: string }).path)));
			case "POST /api/sessions/archive": {
				const body = (await req.json()) as { path: string; archived: boolean };
				return json(await archiveSession(body.path, body.archived !== false));
			}
			case "POST /api/sessions/delete":
				return json(await deleteSession(((await req.json()) as { path: string }).path));
			case "GET /api/models":
				return json(await listModels());
			case "GET /api/commands":
				return json(await getCommands(await cwdParam(url)));
			case "GET /api/agent-settings":
				return json(await readAgentSettings());
			case "POST /api/agent-settings/role": {
				const body = (await req.json()) as { role: string; value: string | null };
				return json(await setRole(body.role, body.value ?? null));
			}
			case "POST /api/agent-settings/agent-override": {
				const body = (await req.json()) as { agent: string; value: string | null };
				return json(await setAgentOverride(body.agent, body.value ?? null));
			}
			case "POST /api/agent-settings/plan-default": {
				const body = (await req.json()) as { enabled: boolean };
				return json(await setPlanDefault(body.enabled === true));
			}
			case "GET /api/skills":
				return json({ skills: await listSkills(await cwdParam(url)) });
			case "POST /api/skills/enabled": {
				const body = (await req.json()) as { name: string; enabled: boolean };
				await setSkillEnabled(body.name, body.enabled === true);
				return json({ ok: true });
			}
			case "GET /api/skills/file":
				return json({ text: await readSkillFile(url.searchParams.get("name") ?? "", await cwdParam(url)) });
			case "GET /api/plugins":
				return json(await listPlugins());
			case "POST /api/plugins/enabled": {
				const body = (await req.json()) as { id: string; enabled: boolean };
				await setPluginEnabled(body.id, body.enabled === true);
				return json({ ok: true });
			}
			case "POST /api/plugins/refresh": {
				const body = (await req.json()) as { cwd: string };
				const cwd = await checkedCwd(body.cwd);
				dropPluginCaches();
				return json({ skills: await listSkills(cwd), plugins: await listPlugins() });
			}
			case "GET /api/about":
				return json(await about());
			case "GET /api/providers":
				return json(await providersView());
			case "POST /api/providers": {
				const body = (await req.json()) as ProviderConfig;
				if (!body?.id) return fail("缺少供应商 ID");
				try {
					assertProviderId(body.id);
				} catch (error) {
					throw new HttpError((error as Error).message, 400);
				}
				try {
					const view = await writeProvider(body.id, body);
					invalidateModels();
					return json(view);
				} catch (error) {
					throw new HttpError(`写入 models.yml 失败，未做改动：${(error as Error).message}`, 409);
				}
			}
			case "DELETE /api/providers": {
				const view = await removeProvider(url.searchParams.get("id") ?? "");
				invalidateModels();
				return json(view);
			}
			case "POST /api/reveal": {
				const body = (await req.json()) as { target: string; name?: string; cwd?: string };
				if (body.target === "skill") return json(await revealAt(await skillFilePath(body.name ?? "", await checkedCwd(body.cwd ?? "")), true));
				return json(await reveal(body.target));
			}
			case "GET /api/health":
				return json({
					ok: true,
					api: API_VERSION,
					pid: process.pid,
					startedAt,
					live: hub.sessions.size,
					agentDir: config.agentDir ?? null,
					modelLock: config.modelLock ?? null,
					omp: {
						version: ompCheck?.version ?? ompVersion ?? null,
						capabilities: ompCheck?.capabilities ?? capabilities() ?? null,
						compat: ompCheck?.compat ?? null,
						problems: ompCheck?.problems ?? [],
					},
				});
		}
		return fail("not found", 404);
	} catch (error) {
		return fail(error, error instanceof HttpError ? error.status : 400);
	}
}

async function staticFile(url: URL): Promise<Response> {
	const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
	const file = path.join(config.distDir, rel);
	if (rel && file.startsWith(config.distDir)) {
		const f = Bun.file(file);
		if (await f.exists()) {
			const immutable = rel.startsWith("assets/");
			return new Response(f, { headers: immutable ? { "cache-control": "public, max-age=31536000, immutable" } : {} });
		}
	}
	const index = Bun.file(path.join(config.distDir, "index.html"));
	if (await index.exists()) return new Response(index, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
	return new Response("前端未构建：请运行 bun run build，或使用 bun run dev。", { status: 503 });
}

// Our own port first: claiming the profile and then crashing on EADDRINUSE would leave a lock
// pointing at a pid that never served, and the next start would treat it as stale and take over
// while the real owner is still running.
const onMyPort = await gatewayPid(config.port);
if (onMyPort !== undefined) {
	console.error(`端口 ${config.port} 上已经有网关在运行（pid ${onMyPort}）。请先停掉它，或用 OMP_WEB_PORT 换一个端口。`);
	process.exit(1);
}

// One gateway per profile. Two of them would each open their own omp for the same session
// file, and omp settles that by copying the conversation — so refuse before doing anything
// else, and before the orphan pass, which would otherwise retire the running gateway's children.
const taken = await claimProfileLock();
if (taken.owner) {
	console.error(`这个 OMP 配置目录已有网关在运行：http://127.0.0.1:${taken.owner.port}/（pid ${taken.owner.pid}）`);
	console.error(`请先在那个网关的终端按 Ctrl+C，或给这个网关指定别的 OMP_WEB_AGENT_DIR。`);
	process.exit(1);
}
// Only the process that won the profile claim may replace the shared restart token. A rejected
// second gateway must not make the running gateway look impossible to restart gracefully.
await fs.mkdir(config.dataDir, { recursive: true });
await fs.writeFile(gatewayFile, JSON.stringify({ token: gatewayToken, pid: process.pid, port: config.port, startedAt }));

// Before anything can open a session: children of a gateway that died without draining still
// own the files they were writing, and a second process on the same file makes omp save the
// conversation to a sibling copy. Costs about a second, so it happens once, here, not per attach.
const orphans = await cleanOrphanSessions(config.sessionsRoot);
if (orphans.length) console.log(`清理了 ${orphans.length} 个遗留的 omp 进程（${orphans.map(o => `${o.pid} → ${path.basename(o.file)}`).join("；")}）`);

const server = Bun.serve<{ id: number }>({
	hostname: config.host,
	port: config.port,
	idleTimeout: 120,
	async fetch(req, srv) {
		const url = new URL(req.url);
		if (url.pathname === "/ws") {
			if (srv.upgrade(req, { data: { id: nextSocketId++ } })) return undefined;
			return new Response("upgrade failed", { status: 400 });
		}
		if (url.pathname.startsWith("/api/")) return api(req, url);
		return staticFile(url);
	},
	websocket: {
		maxPayloadLength: 32 * 1024 * 1024,
		open(ws) {
			hub.clients.add(ws);
		},
		message(ws, raw) {
			let msg: ClientMsg;
			try {
				msg = JSON.parse(String(raw)) as ClientMsg;
			} catch {
				return;
			}
			void onClientMessage(ws, msg);
		},
		close(ws) {
			hub.clients.delete(ws);
			for (const live of attachments.get(ws) ?? []) live.detach(ws);
			attachments.delete(ws);
		},
	},
});

console.log(`OMP Web  http://${server.hostname}:${server.port}/`);
// The first `omp models` takes ~11s and gates every picker and role write; restore the
// last good list from disk and refresh it in the background instead of on first use.
warmModels();
// Same for the slash-command catalog: read the last good lists from disk at boot so the
// first home screen answers at once.
warmCommands();
// Then what the installed omp actually is: version, one ephemeral process, the
// handshake. In the background, because it costs about a second and must not delay
// the first paint; `/api/health` carries the verdict and the settings page shows it.
void checkOmp().then(
	result => {
		ompCheck = result;
		if (result.problems.length) console.log(`omp ${result.version ?? "?"} 不兼容：${result.problems.join("；")}`);
	},
	error => {
		ompCheck = { compat: "broken", version: null, problems: [String((error as Error)?.message ?? error)], capabilities: null };
	},
);
if (config.agentDir) console.log(`  profile: ${config.agentDir}`);
if (config.modelLock) console.log(`  model lock: ${config.modelLock.provider}/${config.modelLock.model}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => void closeGateway());
}
