import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { API_VERSION, type ClientMsg, type LanInfo, type OmpCheck, type PairState, type ServerMsg } from "../shared/api.ts";
import { archivedKeys, archiveKey, setArchived } from "./archive.ts";
import { getCommands, warmCommands } from "./command-catalog.ts";
import { config } from "./config.ts";
import { contentTypeFor, gitDiff, gitStatus, inside, listTree, readFileView, resolveStaticFile } from "./files.ts";
import { HttpError } from "./http-error.ts";
import { invalidateModels, listModels, warmModels } from "./models.ts";
import { readAgentSettings, setAgentOverride, setPlanDefault, setRole } from "./agent-settings.ts";
import { readAllSettings, writeSettingValue } from "./omp-config.ts";
import { addProject, listDir, listProjects, removeProject } from "./projects.ts";
import { invalidate as dropPluginCaches, listPlugins, listSkills, readSkillFile, setPluginEnabled, setSkillEnabled, skillFilePath } from "./plugins.ts";
import { type ProviderConfig, type ProvidersView, assertProviderId, modelsFile, readProviders, removeProvider, writeProvider } from "./providers.ts";
import { cleanOrphanSessions } from "./orphans.ts";
import { claimProfileLock, gatewayPid, releaseProfileLock } from "./profile-lock.ts";
import { type LiveSession, ModelUnavailableError, SessionHub, SessionOwnedError, type Socket } from "./session-hub.ts";
import { listSessions, samePath } from "./session-index.ts";
import { isKnownProject } from "./project-scope.ts";
import { sessionLeaseOccupied } from "./omp/session-owner.ts";
import { ObservedSession } from "./observed-session.ts";
import { ompVersionArgs, runOmp } from "./omp/cli.ts";
import { capabilities } from "./omp/capabilities.ts";
import { checkOmp } from "./omp/compat.ts";
import { runCompatCheck } from "./omp/check.ts";
import { checkUpdate, installUpdate } from "./omp/update.ts";
import { listMcpServers } from "./omp/mcp.ts";
import { code, devices, isLoopback, lanUrls, pairCookie, revokeAll, rotate, tokenFromCookie, tryPair, verify } from "./lan-auth.ts";
import { type Lang, langOf, msg, text } from "./messages.ts";
import { allowedHosts, checkRequest } from "./request-guard.ts";
import { installResilienceHandlers } from "./resilience.ts";

const hub = new SessionHub();

/**
 * 未處理的 promise rejection 不該讓整個 gateway 結束。
 *
 * 守門人的說明與理由在 `server/resilience.ts`（拆成獨立模組是為了能測它）。
 */
installResilienceHandlers();

/** When this process booted; the launcher compares it with source mtimes. */
const startedAt = Date.now();
/** Sessions each socket is attached to, for cleanup on close. */
const attachments = new WeakMap<Socket, Set<LiveSession | ObservedSession>>();
const observations = new Map<string, ObservedSession>();
/**
 * When each socket last said anything: a message, or the pong the browser sends back for a
 * ping. The keep-alive sweep below is the only reader.
 */
const lastSeen = new Map<Socket, number>();
let nextSocketId = 1;

/**
 * The names this gateway answers under. Read once at boot, then re-read when a request
 * arrives with a Host we do not know: the machine may have joined another network, been
 * handed a new address by DHCP, or started before its Wi-Fi did. At most once per
 * `HOST_REFRESH_MS`, so a run of rejected requests cannot turn into a scan of the NICs.
 */
let hostAllowList = allowedHosts({ lan: config.lan, extra: config.allowedHosts, interfaces: os.networkInterfaces() });
let hostsReadAt = Date.now();
const HOST_REFRESH_MS = 10_000;

function guardRequest(req: Request): string | undefined {
	const reason = checkRequest(req, hostAllowList);
	if (!reason) return undefined;
	if (Date.now() - hostsReadAt < HOST_REFRESH_MS) return reason;
	hostsReadAt = Date.now();
	hostAllowList = allowedHosts({ lan: config.lan, extra: config.allowedHosts, interfaces: os.networkInterfaces() });
	return checkRequest(req, hostAllowList);
}

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
	for (const observer of observations.values()) observer.close();
	await hub.shutdown().catch(error => console.error(`[shutdown] 子程序清理失敗：${String((error as Error)?.message ?? error)}`));
	await releaseProfileLock();
	process.exit(0);
}

/**
 * 每個回應都帶上的安全標頭。
 *
 * 為什麼需要 `frame-ancestors 'none'`：這個 gateway 跑在 loopback 上，任何網站都能
 * 用 `<iframe src="http://127.0.0.1:30190/">` 把它鑲進去——而 iframe 導覽**不會**帶
 * Origin 標頭（Origin 只在 CORS 與非 GET 請求送出），所以 request-guard 擋不住。
 * 結果是攻擊者可以把 App 疊在自己的頁面上，用透明按鈕誘導使用者按到
 * 「刪除會話」「改寫 models.yml」「安裝更新」這些按鈕。使用者在 frame 裡完全看不出來。
 * `frame-ancestors 'none'` 讓任何頁面都不能把這個 App 鑲進 frame。
 *
 * 為什麼還要有 `X-Frame-Options: DENY`：老瀏覽器不認 CSP 的 frame-ancestors。
 *
 * 為什麼 `nosniff`：讓瀏覽器不要猜內容型別——不然 `text/plain` 帶的內容可能被
 * 當成 HTML 執行。
 *
 * 為什麼 `Referrer-Policy: no-referrer`：頁面裡的路徑（工作階段檔名、專案路徑）
 * 不該跟著使用者被導到別的網站。
 */
const SECURITY_HEADERS = {
	"content-security-policy": "frame-ancestors 'none'",
	"x-frame-options": "DENY",
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
} as const;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS } });
}

/**
 * 把錯誤訊息裡的路徑換掉。
 *
 * 為什麼要處理：這個 App 自己的錯誤訊息是給人看的散文（「路径越界」「不是文件」），
 * 但作業系統的錯誤會帶著絕對路徑——`ENOTDIR: not a directory, scandir
 * 'C:\Users\e7896\.omp\agent\...'`。把它原樣送回瀏覽器，會把使用者的家目錄
 * 結構與內部路徑洩漏出去。路徑對使用者沒有用（他們看的是畫面，不是路徑），
 * 所以換成佔位符。
 */
function redactPaths(text: string): string {
	return text
		// Windows 的絕對路徑（含 UNC 與磁碟機代號）
		.replace(/[A-Za-z]:\\[^\s"']*/g, "<路徑>")
		// UNC 路徑 \\server\share\...
		.replace(/\\\\[^\s"']+/g, "<路徑>")
		// POSIX 的絕對路徑（至少要有兩段，避免吃掉一般的斜線文字）
		.replace(/(?<![\w])\/(?:[\w.-]+\/)+[\w.-]*/g, "<路徑>");
}

/**
 * 產生給瀏覽器看的錯誤訊息。
 *
 * 應用自己產生的訊息（`msg()` 的散文）原樣保留——它們已經是給人看的。
 * 其他（作業系統、bun 內部）先去掉路徑再送出，詳細內容留在伺服器的 log。
 */
function errorText(error: unknown): string {
	if (!(error instanceof Error)) return redactPaths(String(error));
	// 應用自己寫的訊息不含路徑，也沒有堆疊；系統錯誤則帶著 errno 樣式的前綴。
	const systemLike = /^(E[A-Z]{2,}|ENOENT|EACCES|EISDIR|ENOTDIR|EPERM|EEXIST|ENOTEMPTY|ECONN|EIO)\b/.test(error.message);
	return systemLike ? redactPaths(error.message) : error.message;
}

function fail(error: unknown, status = 400): Response {
	return json({ error: errorText(error) }, status);
}

async function sessionIndex(lang: Lang) {
	const all = await listSessions(lang);
	// Live sessions not yet persisted (fresh, before first message) are omitted by the scan.
	for (const s of all) s.live = hub.liveStatus(s.path);
	const hidden = await archivedKeys();
	const sessions = all.filter(s => !hidden.has(archiveKey(s.path)));
	const archived = all.filter(s => hidden.has(archiveKey(s.path)));
	const projects = await listProjects(sessions);
	return { projects, sessions, archived };
}

async function ensureLive(key: string, model: string | undefined, force: boolean | undefined, lang: Lang): Promise<LiveSession> {
	const live = hub.find(key);
	if (live) return live;
	const summary = (await listSessions()).find(s => samePath(s.path, key));
	if (!summary) throw new Error(msg(lang, ["会话不存在或尚未保存", "No such session, or it has not been saved yet"]));
	return hub.open(summary.path, summary.cwd || path.dirname(summary.path), model, force, lang);
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
	// The titles in this index are never shown here, so it is read in the default language.
	const { projects, sessions } = await sessionIndex("zh");
	return isKnownProject(cwd, {
		pinned: projects,
		sessions,
		liveCwds: [...hub.sessions.values()].map(l => l.cwd),
	});
}

/** Rename through the gateway: the session may not be running yet, and the hub refreshes the index. */
async function renameSession(file: string, name: string, lang: Lang): Promise<{ key: string }> {
	const live = await ensureLive(file, undefined, undefined, lang);
	const res = await live.command({ type: "set_session_name", name });
	if (!res.success) throw new HttpError(String(res.error ?? msg(lang, ["重命名失败", "Rename failed"])), 400);
	return { key: live.key };
}

/** Write the transcript as standalone HTML under `<dataDir>/exports` and hand back its file name. */
async function exportSession(file: string, lang: Lang): Promise<{ name: string }> {
	const live = await ensureLive(file, undefined, undefined, lang);
	const name = `${path.basename(file).replace(/\.jsonl$/i, "")}.html`;
	const dir = path.join(config.dataDir, "exports");
	await fs.mkdir(dir, { recursive: true });
	const res = await live.command({ type: "export_html", outputPath: path.join(dir, name) });
	if (!res.success) throw new HttpError(String(res.error ?? msg(lang, ["导出失败", "Export failed"])), 400);
	return { name };
}

/** Hide (or unhide) a session in the web UI. The file itself is not touched. */
async function archiveSession(file: string, archived: boolean, lang: Lang): Promise<{ ok: true }> {
	const source = path.resolve(file);
	if (!inside(config.sessionsRoot, source)) throw new HttpError(msg(lang, ["不是会话文件", "Not a session file"]), 400);
	await setArchived(source, archived);
	hub.indexChanged();
	return { ok: true };
}

/**
 * Permanently delete an archived session: its transcript and the artifact
 * directory next to it. Only archived sessions qualify (two deliberate steps),
 * and never one that is still running.
 */
async function deleteSession(file: string, lang: Lang): Promise<{ ok: true }> {
	const source = path.resolve(file);
	if (!inside(config.sessionsRoot, source) || !source.toLowerCase().endsWith(".jsonl")) throw new HttpError(msg(lang, ["不是会话文件", "Not a session file"]), 400);
	if (!(await archivedKeys()).has(archiveKey(source))) throw new HttpError(msg(lang, ["只能删除已归档的会话", "Only archived sessions can be deleted"]), 409);
	const live = hub.find(source);
	if (live?.state.isStreaming) throw new HttpError(msg(lang, ["会话正在运行，先停止再删除", "The session is running; stop it first"]), 409);
	// 使用者終端裡開著的同一個 session：刪掉檔案會讓那個終端繼續寫進一個已經
	// 被 unlink 的 inode——對話從磁碟上消失，但終端還看得到（POSIX），或者刪除
	// 直接失敗（Windows）。兩種都不是乾淨的失敗，所以要先問系統有沒有別人持有它。
	const occupied = await sessionLeaseOccupied(source);
	if (occupied) {
		throw new HttpError(msg(lang, ["这个会话正在另一个 omp 进程中使用，请先在那边结束再删除", "Another omp process is using this session; end it there before deleting"]), 409);
	}
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
async function rewindSession(live: LiveSession, entryId: string, lang: Lang): Promise<Record<string, unknown> & { type: string }> {
	if (live.state.isStreaming) throw new Error(msg(lang, ["会话正在运行，先停止再编辑", "The session is running; stop it before editing"]));
	const old = live.state.sessionFile;
	const oldName = live.state.sessionName;
	const res = await live.command({ type: "branch", entryId });
	if (!res.success || (res.data as { cancelled?: boolean } | undefined)?.cancelled) return res;
	const now = live.state.sessionFile;
	if (oldName && !live.state.sessionName) await live.command({ type: "set_session_name", name: oldName });
	if (old && now && !samePath(old, now) && inside(config.sessionsRoot, old) && !hub.find(old)) {
		// 跟永久刪除一樣的顧慮：使用者終端裡可能正開著這個 session。
		// 檔案被 unlink 掉（POSIX）時，那個終端會繼續寫進一個已經沒有名字的
		// inode——對話從磁碟上消失，但終端還看得到。
		const occupied = await sessionLeaseOccupied(path.resolve(old));
		if (occupied) {
			throw new HttpError(msg(lang, ["这个会话正在另一个 omp 进程中使用，请先在那边结束再编辑", "Another omp process is using this session; end it there before editing"]), 409);
		}
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
async function revealAt(file: string, select: boolean, lang: Lang): Promise<{ ok: true }> {
	if (process.platform !== "win32") throw new HttpError(msg(lang, ["仅支持 Windows", "Windows only"]), 400);
	const exists = await fs.stat(file).then(() => true, () => false);
	const args = select && exists ? ["explorer.exe", `/select,${file}`] : ["explorer.exe", exists ? file : path.dirname(file)];
	Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
	return { ok: true };
}

async function reveal(target: string, lang: Lang): Promise<{ ok: true }> {
	const info = await about();
	const map: Record<string, { path: string; select: boolean }> = {
		models: { path: info.modelsFile, select: true },
		agent: { path: info.agentDir, select: false },
		data: { path: info.dataDir, select: false },
	};
	const entry = map[target];
	if (!entry) throw new HttpError(msg(lang, ["未知位置", "Unknown location"]), 400);
	return revealAt(entry.path, entry.select, lang);
}

/** Provider edits touch a file the user also edits by hand: never write when it does not parse. */
async function providersView(lang: Lang): Promise<ProvidersView> {
	try {
		return await readProviders();
	} catch (error) {
		throw new HttpError(msg(lang, ["models.yml 解析失败，未做任何改动：{error}", "Could not parse models.yml; nothing was changed: {error}"], { error: (error as Error).message }), 409);
	}
}

/** Resolve the `cwd` query parameter of a panel endpoint, or refuse it. */
async function cwdParam(url: URL, lang: Lang): Promise<string> {
	return checkedCwd(url.searchParams.get("cwd") ?? "", lang);
}

/** Shared by query and body callers: only directories the app already knows are readable. */
async function checkedCwd(raw: string, lang: Lang): Promise<string> {
	if (!raw) throw new HttpError(msg(lang, ["缺少 cwd", "Missing cwd"]), 400);
	const cwd = path.resolve(raw);
	if (!(await knownCwd(cwd))) throw new HttpError(msg(lang, ["未知项目目录", "Unknown project directory"]), 403);
	return cwd;
}

function sendTo(ws: Socket, message: ServerMsg): void {
	ws.send(JSON.stringify(message));
}

async function observeSession(ws: Socket, key: string, ownerPid?: number): Promise<void> {
	const summary = (await listSessions()).find(s => samePath(s.path, key));
	if (!summary) throw new Error(msg(ws.data.lang, ["会话文件不存在", "The session file does not exist"]));
	let observer = [...observations.values()].find(s => samePath(s.key, summary.path));
	if (!observer) {
		observer = new ObservedSession(summary.path, summary.cwd, ownerPid, () => observations.delete(summary.path));
		observations.set(summary.path, observer);
	}
	if (!attachments.has(ws)) attachments.set(ws, new Set());
	attachments.get(ws)!.add(observer);
	await observer.attach(ws);
}

async function onClientMessage(ws: Socket, message: ClientMsg): Promise<void> {
	const lang = ws.data.lang;
	switch (message.t) {
		case "attach": {
			for (const observer of [...observations.values()]) {
				if (samePath(observer.key, message.key)) {
					observer.detach(ws);
					attachments.get(ws)?.delete(observer);
				}
			}
			sendTo(ws, { t: "proc", key: message.key, status: "starting" });
			try {
				if (message.observe) {
					const live = hub.find(message.key);
					live?.detach(ws);
					if (live) attachments.get(ws)?.delete(live);
					await observeSession(ws, message.key);
					return;
				}
				const live = await ensureLive(message.key, typeof message.model === "string" && message.model ? message.model : undefined, message.force === true, lang);
				if (!samePath(live.key, message.key)) sendTo(ws, { t: "rekey", from: message.key, to: live.key });
				let set = attachments.get(ws);
				if (!set) attachments.set(ws, (set = new Set()));
				set.add(live);
				sendTo(ws, { t: "proc", key: live.key, status: "ready" });
				live.attach(ws);
				hub.indexChanged();
			} catch (error) {
				if (error instanceof SessionOwnedError) {
					try {
						await observeSession(ws, message.key, error.ownerPid);
						return;
					} catch (readError) { error = readError; }
				}
				const lostModel = error instanceof ModelUnavailableError ? error.lostModel : undefined;
				const ownedBy = error instanceof SessionOwnedError ? error.ownerPid : undefined;
				const code = error instanceof SessionOwnedError ? "session_owned_elsewhere" : undefined;
				sendTo(ws, { t: "proc", key: message.key, status: "exited", error: (error as Error).message, code, lostModel, ownedBy });
			}
			return;
		}
		case "detach": {
			for (const observer of [...observations.values()]) {
				if (samePath(observer.key, message.key)) {
					observer.detach(ws);
					attachments.get(ws)?.delete(observer);
				}
			}
			const live = hub.find(message.key);
			if (!live) return;
			live.detach(ws);
			attachments.get(ws)?.delete(live);
			return;
		}
		case "rpc": {
			try {
				const observed = [...observations.values()].find(s => samePath(s.key, message.key) && s.sockets.has(ws));
				if (observed) {
					sendTo(ws, { t: "rpc_res", rid: message.rid, ok: true, data: await observed.command(message.cmd, lang) });
					return;
				}
				const live = hub.find(message.key);
				if (!live) {
					throw new Error(msg(lang, ["会话未运行", "The session is not running"]));
				}
				const res = message.cmd.type === "web_rewind" ? await rewindSession(live, String(message.cmd.entryId), lang) : await live.command(message.cmd);
				sendTo(ws, res.success ? { t: "rpc_res", rid: message.rid, ok: true, data: res.data } : { t: "rpc_res", rid: message.rid, ok: false, error: String(res.error ?? msg(lang, ["失败", "Failed"])) });
			} catch (error) {
				sendTo(ws, { t: "rpc_res", rid: message.rid, ok: false, error: (error as Error).message });
			}
			return;
		}
		case "history_page": {
			const observed = [...observations.values()].find(s => samePath(s.key, message.key) && s.sockets.has(ws));
			if (observed) {
				sendTo(ws, observed.historyPage(message.before, message.limit));
				return;
			}
			const live = hub.find(message.key);
			if (!live) {
				sendTo(ws, { t: "history_page", key: message.key, messages: [], offset: 0, total: 0 });
				return;
			}
			sendTo(ws, live.historyPage(message.before, message.limit));
			return;
		}
		case "ui": {
			hub.find(message.key)?.answerUi(message.payload);
			return;
		}
	}
}

async function api(req: Request, url: URL): Promise<Response> {
	const route = `${req.method} ${url.pathname}`;
	const peer = server.requestIP(req)?.address;
	const remote = !isLoopback(peer);
	const lang = langOf(req.headers.get("x-omp-web-lang"));
	// Pairing is the one conversation an unpaired phone is allowed to have: without the code
	// there is no cookie, and without a cookie every other route is closed to it.
	if (route === "GET /api/pair") {
		const paired = !remote || (await verify(tokenFromCookie(req.headers.get("cookie"))));
		const state: PairState = { required: remote, paired };
		return json(state);
	}
	if (route === "POST /api/pair") {
		if (!remote) return json({ ok: true });
		const body = (await req.json()) as { code?: string };
		const result = await tryPair(peer ?? "unknown", String(body.code ?? ""), req.headers.get("user-agent") ?? undefined, lang);
		if (result.ok) {
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json; charset=utf-8", "set-cookie": pairCookie(result.token) },
			});
		}
		if ("lockedFor" in result) return json({ error: "locked", retryAfterMs: result.lockedFor }, 429);
		return json({ error: "wrong_code", left: result.left }, 401);
	}
	// The launcher's restart. Loopback and the on-disk token both have to check out: this
	// stops every omp child, so it must not be reachable by a page or another machine.
	if (route === "POST /api/shutdown") {
		if (remote) return fail(msg(lang, ["只能由本机停止", "Only this machine can stop the gateway"]), 403);
		if (req.headers.get("x-omp-web-token") !== gatewayToken) return fail(msg(lang, ["停止令牌不符", "Stop token mismatch"]), 403);
		const draining = hub.sessions.size;
		// Answer first: the launcher waits for the port to free, and a socket closed under a
		// pending response would look like a crash instead of a restart.
		setTimeout(() => void closeGateway(), 150);
		return json({ ok: true, sessions: draining });
	}
	// Exported transcripts: read by file name out of `<dataDir>/exports`.
	if (route.startsWith("GET /api/exports/")) {
		const name = decodeURIComponent(url.pathname.slice("/api/exports/".length));
		if (!/^[A-Za-z0-9._-]+$/.test(name)) return fail(msg(lang, ["非法文件名", "Invalid file name"]));
		const file = Bun.file(path.join(config.dataDir, "exports", name));
		if (!(await file.exists())) return fail(msg(lang, ["导出文件不存在", "The exported file does not exist"]), 404);
		// 匯出的 HTML 是 omp 產生的，內容不受我們控制。用 `sandbox` 給它一個獨立的
		// opaque origin：裡面的 script 不能跑，就算能跑也碰不到這個 App 的 /api/*。
		return new Response(file, {
			headers: {
				"content-type": "text/html; charset=utf-8",
				...SECURITY_HEADERS,
				"content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
			},
		});
	}
	try {
		switch (route) {
			case "GET /api/index":
				return json(await sessionIndex(lang));
			case "POST /api/projects": {
				const body = (await req.json()) as { path: string };
				return json({ path: await addProject(body.path, lang) });
			}
			case "DELETE /api/projects": {
				await removeProject(url.searchParams.get("path") ?? "");
				return json({ ok: true });
			}
			case "GET /api/fs":
				return json(await listDir(url.searchParams.get("path") ?? ""));
			case "GET /api/files/search":
				return json(await searchFiles(await cwdParam(url, lang), url.searchParams.get("q") ?? ""));
			case "GET /api/fs/tree":
				return json(await listTree(await cwdParam(url, lang), url.searchParams.get("path") ?? "", lang));
			case "GET /api/fs/file":
				return json(await readFileView(await cwdParam(url, lang), url.searchParams.get("path") ?? "", lang));
			case "GET /api/fs/raw": {
				const { file, type } = contentTypeFor(await cwdParam(url, lang), url.searchParams.get("path") ?? "", lang);
				const body = Bun.file(file);
				if (!(await body.exists())) return fail(msg(lang, ["文件不存在", "The file does not exist"]), 404);
				// `sandbox` 讓預覽到的檔案落在獨立的 opaque origin：SVG 內的 script
				// 不會在這個 App 的 origin 上執行，也碰不到 /api/*。
				// 介面裡的預覽是走 <img>，本來就不執行 script；這裡擋的是「直接開
				// 這個網址」的情況。
				return new Response(body, { headers: { "content-type": type, "cache-control": "no-store", ...SECURITY_HEADERS, "content-security-policy": "sandbox; default-src 'none'" } });
			}
			case "GET /api/git/status":
				return json(await gitStatus(await cwdParam(url, lang)));
			case "GET /api/git/diff":
				return json(await gitDiff(await cwdParam(url, lang), url.searchParams.get("path") ?? "", lang));
			case "POST /api/sessions": {
				const body = (await req.json()) as { cwd: string };
				// cwd 必須是已知的專案（使用者釘選的，或已經有工作階段的）。
				// 少了這個檢查，任何客戶端都能指定任意目錄開一個工作階段——那個目錄
				// 立刻變成「已知項目目錄」，於是 /api/fs/* 就能讀它。這等於把
				// 「未知項目目錄」那個 403 變成沒有作用。
				//
				// 順帶也擋掉另一件更笨的事：在隨便一個目錄裡開工作階段，會在使用者
				// 真正的 profile 底下生出一個 session 檔與它的目錄（留下垃圾）。
				const cwd = path.resolve(body.cwd);
				if (!(await knownCwd(cwd))) {
					throw new HttpError(msg(lang, ["未知项目目录，请先把它加入项目", "Unknown project directory; add it as a project first"]), 403);
				}
				const live = await hub.create(cwd, lang);
				return json({ key: live.key, cwd: live.cwd });
			}
			case "POST /api/sessions/rename": {
				const body = (await req.json()) as { path: string; name: string };
				return json(await renameSession(path.resolve(body.path), body.name, lang));
			}
			case "POST /api/sessions/export":
				return json(await exportSession(path.resolve(((await req.json()) as { path: string }).path), lang));
			case "POST /api/sessions/archive": {
				const body = (await req.json()) as { path: string; archived: boolean };
				return json(await archiveSession(body.path, body.archived !== false, lang));
			}
			case "POST /api/sessions/delete":
				return json(await deleteSession(((await req.json()) as { path: string }).path, lang));
			case "GET /api/models":
				return json(await listModels(lang));
			case "GET /api/commands":
				return json(await getCommands(await cwdParam(url, lang)));
			case "GET /api/agent-settings":
				return json(await readAgentSettings(lang));
			case "GET /api/omp-config":
				// Every setting OMP reports, so the settings page can show what there is
				// and not only the handful the app happens to know about.
				return json({ entries: await readAllSettings(lang) });
			case "POST /api/omp-config": {
				const body = (await req.json()) as { key?: string; value?: string };
				if (typeof body.key !== "string" || typeof body.value !== "string") throw new HttpError(msg(lang, ["缺少 key 或 value", "Missing key or value"]), 400);
				await writeSettingValue(body.key, body.value, lang);
				return json({ ok: true });
			}
			case "POST /api/agent-settings/role": {
				const body = (await req.json()) as { role: string; value: string | null };
				return json(await setRole(body.role, body.value ?? null, lang));
			}
			case "POST /api/agent-settings/agent-override": {
				const body = (await req.json()) as { agent: string; value: string | null };
				return json(await setAgentOverride(body.agent, body.value ?? null, lang));
			}
			case "POST /api/agent-settings/plan-default": {
				const body = (await req.json()) as { enabled: boolean };
				return json(await setPlanDefault(body.enabled === true, lang));
			}
			case "GET /api/skills":
				return json({ skills: await listSkills(await cwdParam(url, lang), lang) });
			case "POST /api/skills/enabled": {
				const body = (await req.json()) as { name: string; enabled: boolean };
				await setSkillEnabled(body.name, body.enabled === true, lang);
				return json({ ok: true });
			}
			case "GET /api/skills/file":
				return json({ text: await readSkillFile(url.searchParams.get("name") ?? "", await cwdParam(url, lang), lang) });
			case "GET /api/plugins":
				return json(await listPlugins(lang));
			case "GET /api/omp/mcp": {
				// The MCP list is what omp actually loaded, so it needs the project
				// directory: a project's own MCP config is only discovered from there.
				// The cwd check throws its own 403, so it stays outside the try below.
				const raw = url.searchParams.get("cwd") || undefined;
				const cwd = raw ? await checkedCwd(raw, lang) : undefined;
				try {
					return json(await listMcpServers(cwd));
				} catch (error) {
					return fail(msg(lang, ["读取 MCP 列表失败：{reason}", "Could not read the MCP list: {reason}"], { reason: (error as Error).message }), 500);
				}
			}
			case "POST /api/plugins/enabled": {
				const body = (await req.json()) as { id: string; enabled: boolean };
				await setPluginEnabled(body.id, body.enabled === true, lang);
				return json({ ok: true });
			}
			case "POST /api/plugins/refresh": {
				const body = (await req.json()) as { cwd: string };
				const cwd = await checkedCwd(body.cwd, lang);
				dropPluginCaches();
				return json({ skills: await listSkills(cwd, lang), plugins: await listPlugins(lang) });
			}
			case "GET /api/about":
				return json(await about());
			case "GET /api/omp/update":
				return json(await checkUpdate());
			case "POST /api/omp/update/install": {
				// 換版會動到本機的執行檔，但這是設定頁的一部分：遠端（已配對的手機）
				// 也走同一條路，比「只有本機可以」更符合這個 fork 的用法。
				const result = await installUpdate();
				if (!result.ok) {
					const reason = result.reason === "locked"
						? msg(lang, ["有 omp 进程正在执行，Windows 上无法覆盖正在运行的程序；请关闭所有会话后重试", "An omp process is running and Windows cannot overwrite a running program; close every session and retry"])
						: result.reason === "timeout"
							? msg(lang, ["更新超时", "The update timed out"])
							: msg(lang, ["更新失败：{reason}", "The update failed: {reason}"], { reason: result.detail ?? "" });
					return fail(reason, 400);
				}
				return json({ ok: true, version: result.version, needsRestart: true });
			}
			case "POST /api/omp/check": {
				// 檢查會起一個臨時行程、不呼叫模型，但會花幾秒；逾時就回報逾時，不吊著請求。
				const result = await Promise.race([runCompatCheck(), Bun.sleep(200_000).then(() => null)]);
				if (!result) return fail(msg(lang, ["检查超时", "The check timed out"]), 504);
				// 每一項的說明是程式裡本來就有的中文，沒有英文對照；繁體使用者看得到繁體。
				return json(lang === "zh-Hant" ? { ...result, items: result.items.map(item => ({ ...item, what: text(lang, item.what), why: text(lang, item.why) })) } : result);
			}
			case "GET /api/providers":
				return json(await providersView(lang));
			case "POST /api/providers": {
				const body = (await req.json()) as ProviderConfig;
				if (!body?.id) return fail(msg(lang, ["缺少供应商 ID", "Missing provider ID"]));
				try {
					assertProviderId(body.id, lang);
				} catch (error) {
					throw new HttpError((error as Error).message, 400);
				}
				try {
					const view = await writeProvider(body.id, body, lang);
					invalidateModels();
					return json(view);
				} catch (error) {
					throw new HttpError(msg(lang, ["写入 models.yml 失败，未做改动：{error}", "Could not write models.yml; nothing was changed: {error}"], { error: (error as Error).message }), 409);
				}
			}
			case "DELETE /api/providers": {
				const view = await removeProvider(url.searchParams.get("id") ?? "", lang);
				invalidateModels();
				return json(view);
			}
			case "POST /api/reveal": {
				const body = (await req.json()) as { target: string; name?: string; cwd?: string };
				if (body.target === "skill") return json(await revealAt(await skillFilePath(body.name ?? "", await checkedCwd(body.cwd ?? "", lang), lang), true, lang));
				return json(await reveal(body.target, lang));
			}
			case "GET /api/lan": {
				const info: LanInfo = {
					enabled: config.lan,
					port: config.port,
					urls: lanUrls(os.networkInterfaces(), config.port),
					code: code(),
					devices: await devices(),
				};
				return json(info);
			}
			case "POST /api/lan/rotate":
				return json({ code: rotate() });
			case "POST /api/lan/revoke-all": {
				await revokeAll();
				// The tokens are gone, but a socket already open would keep streaming. Phones
				// only: this machine's own tabs stay connected.
				let closed = 0;
				for (const ws of hub.clients) {
					if (!ws.data.remote) continue;
					ws.close();
					closed++;
				}
				return json({ ok: true, closed });
			}
			case "GET /api/health":
				return json({
					ok: true,
					api: API_VERSION,
					pid: process.pid,
					startedAt,
					live: hub.sessions.size,
					lan: config.lan,
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

async function staticFile(url: URL, lang: Lang): Promise<Response> {
	// 路徑的解碼與邊界檢查都在 `resolveStaticFile()` 裡（附測試）：
	// 前綴比對沒有目錄邊界時，`dist-evil\x` 會被 `dist` 開頭比對命中，
	// 用 `%2e%2e%2f` 編碼的 `..` 就能讀到 web root 以外的檔案。
	const file = resolveStaticFile(config.distDir, url.pathname);
	if (file) {
		const rel = url.pathname.replace(/^\/+/, "");
		const f = Bun.file(file);
		if (await f.exists()) {
			const immutable = rel.startsWith("assets/");
			// `f.type` covers what a browser actually needs (the manifest included); Bun only
			// fills it in on its own in some of these branches.
			return new Response(f, {
				headers: { "content-type": f.type || "application/octet-stream", ...(immutable ? { "cache-control": "public, max-age=31536000, immutable" } : {}), ...SECURITY_HEADERS },
			});
		}
	}
	const index = Bun.file(path.join(config.distDir, "index.html"));
	if (await index.exists()) return new Response(index, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...SECURITY_HEADERS } });
	return new Response(msg(lang, ["前端未构建：请运行 bun run build，或使用 bun run dev。", "The front end is not built: run bun run build, or use bun run dev."]), { status: 503, headers: SECURITY_HEADERS });
}

// Our own port first: claiming the profile and then crashing on EADDRINUSE would leave a lock
// pointing at a pid that never served, and the next start would treat it as stale and take over
// while the real owner is still running.
const onMyPort = await gatewayPid(config.port);
if (onMyPort !== undefined) {
	console.error(`埠 ${config.port} 上已經有閘道器在執行（pid ${onMyPort}）。請先停掉它，或用 OMP_WEB_PORT 換一個埠。`);
	process.exit(1);
}

// One gateway per profile. Two of them would each open their own omp for the same session
// file, and omp settles that by copying the conversation — so refuse before doing anything
// else, and before the orphan pass, which would otherwise retire the running gateway's children.
const taken = await claimProfileLock();
if (taken.owner) {
	console.error(`這個 OMP 配置目錄已有閘道器在執行：http://127.0.0.1:${taken.owner.port}/（pid ${taken.owner.pid}）`);
	console.error(`請先在那個閘道器的終端按 Ctrl+C，或給這個閘道器指定別的 OMP_WEB_AGENT_DIR。`);
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
if (orphans.length) console.log(`清理了 ${orphans.length} 個遺留的 omp 程序（${orphans.map(o => `${o.pid} → ${path.basename(o.file)}`).join("；")}）`);

const server = Bun.serve<{ id: number; remote: boolean; lang: Lang }>({
	hostname: config.host,
	port: config.port,
	idleTimeout: 120,
	async fetch(req, srv) {
		// Every request, including the WebSocket upgrade and the static files: a page on
		// another site must not reach this gateway at all, not merely fail an API call.
		const refused = guardRequest(req);
		const url = new URL(req.url);
		// The page states its language on every request; a tab opening a socket cannot send a
		// header, so the upgrade carries it in the query instead.
		const lang = langOf(url.searchParams.get("lang") ?? req.headers.get("x-omp-web-lang"));
		if (refused) return new Response(msg(lang, ["来源不被允许", "This origin is not allowed"]), { status: 403 });
		// A phone has to pair once and then carries a device cookie. Static files and the
		// pairing endpoints are all an unpaired client may reach, so the page can ask.
		const remote = !isLoopback(srv.requestIP(req)?.address);
		if (remote) {
			// The code, the addresses and the paired devices belong to the machine the gateway
			// runs on, so these answer 403 to a phone whether or not it has paired.
			if (url.pathname === "/api/lan" || url.pathname === "/api/lan/rotate" || url.pathname === "/api/lan/revoke-all") {
				return new Response(msg(lang, ["只能由本机操作", "Only this machine can do that"]), { status: 403 });
			}
			if (url.pathname !== "/api/pair" && !(await verify(tokenFromCookie(req.headers.get("cookie"))))) {
				if (url.pathname === "/ws") return new Response(msg(lang, ["需要访问码", "Access code required"]), { status: 401 });
				if (url.pathname.startsWith("/api/")) return json({ error: "pair_required" }, 401);
			}
		}
		if (url.pathname === "/ws") {
			if (srv.upgrade(req, { data: { id: nextSocketId++, remote, lang } })) return undefined;
			return new Response("upgrade failed", { status: 400 });
		}
		if (url.pathname.startsWith("/api/")) return api(req, url);
		return staticFile(url, lang);
	},
	websocket: {
		maxPayloadLength: 32 * 1024 * 1024,
		/**
		 * A tab that cannot keep up is closed here instead of queueing without limit: Bun drops
		 * frames silently once the limit is passed, and a browser that lost the middle of a run
		 * has no way to resynchronise. Reconnecting re-attaches and gets a fresh snapshot.
		 */
		backpressureLimit: 4 * 1024 * 1024,
		closeOnBackpressureLimit: true,
		open(ws) {
			hub.clients.add(ws);
			lastSeen.set(ws, Date.now());
		},
		message(ws, raw) {
			lastSeen.set(ws, Date.now());
			let message: ClientMsg;
			try {
				message = JSON.parse(String(raw)) as ClientMsg;
			} catch {
				return;
			}
			// 每則訊息各自處理：某一則失敗（對話已刪、模型沒了、session 檔損毀）
			// 只該影響那一則，不該讓整個 gateway 結束。
			const key = "key" in message ? message.key : "";
			void onClientMessage(ws, message).catch(error => {
				console.error("[ws] message failed:", (error as Error).message);
				if (key) sendTo(ws, { t: "proc", key, status: "exited", error: (error as Error).message });
			});
		},
		/** The browser answers `ws.ping()` by itself: the one sign of life a frozen tab still gives. */
		pong(ws) {
			lastSeen.set(ws, Date.now());
		},
		close(ws) {
			lastSeen.delete(ws);
			hub.clients.delete(ws);
			for (const live of attachments.get(ws) ?? []) live.detach(ws);
			attachments.delete(ws);
		},
	},
});

// Bound to 0.0.0.0 in LAN mode; the line people click on the machine itself stays loopback.
console.log(`OMP Web  http://127.0.0.1:${server.port}/`);

/**
 * Keep-alive. Bun only counts traffic that actually arrives, so a page parked on a long answer,
 * a phone with its screen off, or any hop between them that expires at 30–60 s all ended the same
 * way: a socket the server had already dropped and the page still believed in. A protocol ping
 * every 30 s is answered by the browser with no page code at all, and holds the mapping open
 * through NAT; `lastSeen` then tells the two halves apart — a socket silent for three beats is
 * gone, so it is dropped here and the page's own watchdog reconnects instead of waiting forever.
 */
const HEARTBEAT_MS = 30_000;
const HEARTBEAT_DEAD_MS = 3 * HEARTBEAT_MS;
const PING_TEXT = JSON.stringify({ t: "ping" } satisfies ServerMsg);
const heartbeat = setInterval(() => {
	const now = Date.now();
	for (const ws of hub.clients) {
		if (now - (lastSeen.get(ws) ?? now) >= HEARTBEAT_DEAD_MS) {
			lastSeen.delete(ws);
			ws.terminate();
			continue;
		}
		try {
			ws.ping();
			// The same beat in the page's own protocol: `readyState` lies on a half-open socket.
			ws.send(PING_TEXT);
		} catch {
			// Closing under us; the close handler owns the bookkeeping.
		}
	}
}, HEARTBEAT_MS);
// A timer is never a reason for the process to stay alive.
heartbeat.unref();
if (config.lan) {
	for (const address of lanUrls(os.networkInterfaces(), config.port)) console.log(`手機訪問：${address}`);
	console.log(`訪問碼：${code()}（本次啟動有效，也可以在 設定 → 手機訪問 裡檢視和掃碼）`);
}
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
		if (result.problems.length) console.log(`omp ${result.version ?? "?"} 不相容：${result.problems.join("；")}`);
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
