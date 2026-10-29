/**
 * 測試用的假 omp 執行檔。
 *
 * 為什麼需要這個 helper：測試要在**任何平台**上都能跑，但 `Bun.spawn` 不能直接
 * 執行 Windows 的批次檔（`.cmd`／`.bat` 要經過 `cmd.exe /c`），而 POSIX 上
 * 執行一個沒有 shebang、沒有執行權限的檔案會得到 EACCES。
 *
 * 所以這個 helper 依平台寫出「能讓這個平台直接執行」的假身：
 * - Windows：`.cmd` 批次檔，內容是 `@bun "<stub>" %*`。
 * - 其他：帶 `#!/usr/bin/env bun` shebang 的檔案，並設上執行權限（0o755）。
 *
 * 兩邊呼叫的都是同一支 stub（`tests/fixtures/omp-stub.ts`），行為一致。
 */
import * as fs from "node:fs";
import * as path from "node:path";

const IS_WINDOWS = process.platform === "win32";

/**
 * 寫出一個假的 omp 執行檔，回傳它的路徑。
 *
 * @param dir      放檔案的目錄
 * @param stubPath stub 腳本（`.ts`）的路徑
 * @param name     檔名（不含副檔名）
 */
export function writeStubBin(dir: string, stubPath: string, name = "omp"): string {
	const script = path.resolve(stubPath);
	if (IS_WINDOWS) {
		const file = path.join(dir, `${name}.cmd`);
		fs.writeFileSync(file, `@bun "${script}" %*\r\n`);
		return file;
	}
	const file = path.join(dir, name);
	// 這裡必須是 shell 腳本而不是 bun 腳本：`"$@"` 是 shell 的參數轉發，
	// bun 的 shebang 會把整個檔案當 TypeScript 解析而報語法錯誤。
	fs.writeFileSync(file, `#!/bin/sh\nexec bun "${script}" "$@"\n`);
	fs.chmodSync(file, 0o755);
	return file;
}
