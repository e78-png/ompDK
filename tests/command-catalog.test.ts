/**
 * 指令目錄的快取：每個專案一份，記到磁碟，重啟後還在。
 *
 * 為什麼要有這個測試：首頁的 `/` 補全靠這份目錄。它壞掉的方式都很安靜——
 * 記錯了目錄（大小寫、���斜線），就會在別的專案拿到別人的技能；
 * 磁碟檔壞了，整個目錄就變成空的，首頁要重新探測一次（慢）。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AvailableSlashCommand } from "../shared/api.ts";
import { removeTempDir } from "./fixtures/cleanup.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-catalog-${process.pid}-`));
const project = path.join(dir, "project");
const other = path.join(dir, "other");

let catalog: typeof import("../server/command-catalog.ts");
let config: typeof import("../server/config.ts")["config"];
let previousData: string | undefined;
let previousAgent: string | undefined;
let dataDir: string;

/**
 * `config` is one shared object in the whole test run, and other files point
 * `dataDir` at their own directory. Claim it back before every step that writes
 * or reads the cache, so this file does not depend on the run order.
 */
function useMyDataDir(): void {
	config.dataDir = dataDir;
	config.agentDir = dir;
}

function command(name: string): AvailableSlashCommand {
	return { name, source: "builtin", description: `${name} description` };
}

beforeAll(async () => {
	fs.mkdirSync(project, { recursive: true });
	fs.mkdirSync(other, { recursive: true });
	previousData = config?.dataDir;
	previousAgent = config?.agentDir;
	({ config } = await import("../server/config.ts"));
	dataDir = path.join(dir, "data");
	useMyDataDir();
	// A probe spawns a real session process to read the catalog. Point the binary at
	// nothing so the probe fails fast instead of starting omp and holding the directory.
	config.ompBin = path.join(dir, "no-such-omp");
	fs.mkdirSync(dataDir, { recursive: true });
	// The disk cache is read exactly once per process, so the broken file has to be in
	// place before anything touches it.
	fs.writeFileSync(path.join(dataDir, "commands-cache.json"), "{ this is not json");
	catalog = await import("../server/command-catalog.ts");
});

afterAll(() => {
	if (config) {
		if (previousData !== undefined) config.dataDir = previousData;
		if (previousAgent !== undefined) config.agentDir = previousAgent;
	}
	removeTempDir(dir);
});

describe("指令目錄的快取", () => {
	test("磁碟上的快取檔壞掉時，整個流程不能爆掉", async () => {
		useMyDataDir();
		// 第一次讀磁碟就會遇到那個壞掉的檔案。讀不到就當沒有，不能讓整個目錄報錯。
		const got = await catalog.getCommands(path.join(dir, "never-seen")).catch(error => {
			throw new Error(`getCommands should not throw on a broken cache: ${String(error)}`);
		});
		expect(Array.isArray(got.commands)).toBe(true);
	});

	test("記進去的目錄讀得回來", async () => {
		useMyDataDir();
		catalog.rememberCommands(project, [command("alpha"), command("beta")]);
		const got = await catalog.getCommands(project);
		expect(got.exact).toBe(true);
		expect(got.commands.map(c => c.name)).toEqual(["alpha", "beta"]);
	});

	test("同一個目錄，大小寫與尾斜線不同也算同一個", async () => {
		useMyDataDir();
		catalog.rememberCommands(project, [command("gamma")]);
		const got = await catalog.getCommands(`${project.toUpperCase()}${path.sep}`);
		expect(got.exact).toBe(true);
		expect(got.commands.map(c => c.name)).toEqual(["gamma"]);
	});

	test("空目錄不會被記下來", async () => {
		useMyDataDir();
		catalog.rememberCommands(other, []);
		const got = await catalog.getCommands(other);
		// 沒有記過就會去探測；探測在測試環境拿不到，回空而且不是精確的。
		expect(got.exact).toBe(false);
	});

	test("寫到磁碟的快取記著自己的 profile", async () => {
		useMyDataDir();
		catalog.rememberCommands(project, [command("delta")]);
		// 寫檔是 fire-and-forget，等它真的寫完再讀。
		const file = path.join(dataDir, "commands-cache.json");
		let saved: { agentDir?: string; dirs?: Record<string, unknown> } | undefined;
		for (let i = 0; i < 50 && !saved; i++) {
			try {
				saved = JSON.parse(fs.readFileSync(file, "utf8")) as { agentDir?: string; dirs?: Record<string, unknown> };
			} catch {
				await Bun.sleep(20);
			}
		}
		expect(saved).toBeDefined();
		expect(saved?.agentDir).toBe(dir);
		expect(Object.keys(saved?.dirs ?? {}).length).toBeGreaterThan(0);
	});
});
