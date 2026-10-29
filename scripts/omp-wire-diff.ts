/**
 * Compare the omp wire contract we declare (`shared/omp/wire.ts`) against omp's own
 * generated types, and report what no longer lines up.
 *
 *   bun run omp:wire-diff <path to omp's generated rpc-wire types>
 *   bun run omp:wire-diff ~/omp/src/modes/rpc/wire/index.ts
 *
 * Reference only: nothing in the build or the tests depends on it, and it needs omp's
 * sources, which are not installed here. Run it after an omp upgrade when
 * `bun run omp:check` says a field is missing — it is the one check that can say *why*,
 * since our own contract deliberately does not name the fields we never read.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const OURS = path.resolve(import.meta.dir, "../shared/omp/wire.ts");

interface Shape {
	name: string;
	fields: string[];
}

/**
 * Names this contract invents rather than mirrors: a permissive block, the summary and
 * catch-all message roles, and the frame shapes. omp has no interface of these names, so
 * their absence means nothing.
 */
const OURS_ONLY = ["ContentBlock", "SummaryMessage", "UnknownMessage", "OmpFrame", "OmpResponse", "OmpReady"];

/** Top-level `export interface X { … }` blocks, with the property names each one declares. */
function shapesOf(source: string): Map<string, Shape> {
	const out = new Map<string, Shape>();
	for (const block of source.matchAll(/^export interface (\w+)[^{]*\{([\s\S]*?)^\}/gm)) {
		const fields = new Set<string>();
		for (const line of block[2].split("\n")) {
			const field = /^\t([A-Za-z_]\w*)\??\s*[?:]/.exec(line);
			// An index signature (`[k: string]: unknown`) is not a field we read.
			if (field) fields.add(field[1]);
		}
		out.set(block[1], { name: block[1], fields: [...fields] });
	}
	return out;
}

/** Names omp declares as unions (`export type X = A | B`); we read their common fields off one loose shape. */
function aliasesOf(source: string): Set<string> {
	return new Set([...source.matchAll(/^export type (\w+)\s*=/gm)].map(m => m[1]));
}

function report(ours: Shape, theirs: Shape | undefined, alias: boolean, oursOnly: boolean): { line: string; bad: boolean } {
	const name = ours.name.padEnd(24);
	if (oursOnly) return { line: `· ${name} 我们自己定义的形状`, bad: false };
	if (!theirs) {
		if (alias) return { line: `≈ ${name} omp 里是联合类型，我们按一个宽松形状读它`, bad: false };
		return { line: `? ${name} omp 的类型里没有这个名字`, bad: true };
	}
	const missing = ours.fields.filter(f => !theirs.fields.includes(f));
	const extra = theirs.fields.filter(f => !ours.fields.includes(f));
	if (missing.length) return { line: `✗ ${name} 这些字段已不在：${missing.join(", ")}`, bad: true };
	if (extra.length) return { line: `⚠ ${name} omp 另有 ${extra.length} 个字段未声明（不读，无妨）`, bad: false };
	return { line: `✓ ${name} ${ours.fields.length} 个字段都在`, bad: false };
}

const arg = process.argv[2];
if (!arg) {
	console.error("用法：bun run omp:wire-diff <omp 生成型別檔案路徑>");
	process.exit(2);
}
const target = arg.startsWith("~") ? path.join(os.homedir(), arg.slice(1)) : path.resolve(arg);
if (!fs.existsSync(target)) {
	console.error(`找不到 ${target}`);
	process.exit(2);
}

const ours = shapesOf(fs.readFileSync(OURS, "utf8"));
const theirsSource = fs.readFileSync(target, "utf8");
const theirs = shapesOf(theirsSource);
const theirAliases = aliasesOf(theirsSource);
let broken = false;
for (const [name, shape] of ours) {
	const r = report(shape, theirs.get(name), theirAliases.has(name), OURS_ONLY.includes(name));
	broken ||= r.bad;
	console.log(r.line);
}
const unmatched = [...theirs.keys()].filter(n => !ours.has(n));
console.log(`\n我們聲明瞭 ${ours.size} 個形狀，${target} 裡有 ${theirs.size} 個（${unmatched.length} 個我們沒有用到）。`);
process.exit(broken ? 1 : 0);
