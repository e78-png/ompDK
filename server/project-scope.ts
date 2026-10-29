/**
 * 專案邊界：哪些目錄算「已知專案」。
 *
 * 為什麼要獨立成一個模組：這是**授權邊界**，不是隨便的檢查——
 * 它決定一個客戶端能不能在某個目錄底下開工作階段，而開了之後那個目錄
 * 就能被 `/api/fs/*` 讀取。把規則放在這裡（而不是埋在路由裡）是為了能直接
 * 測它：邊界規則不該只能靠端到端測試才驗得到。
 */

/** 比對用的 key：去掉結尾斜線、轉小寫——Windows 的大小寫不敏感。 */
export function projectKey(path: string): string {
	return path.replace(/[\\/]+$/, "").toLowerCase();
}

/** 判斷目錄是否已知的三種來源。 */
export interface ProjectScope {
	/** 使用者釘選的專案。 */
	pinned: { path: string }[];
	/** 既有工作階段的 cwd（CLI 開過的目錄也算）。 */
	sessions: { cwd?: string }[];
	/** 這個 gateway 正在開著的工作階段的 cwd。 */
	liveCwds: string[];
}

/**
 * 這個目錄是不是已知專案。
 *
 * 已知 = 使用者釘選過、或已經有工作階段在那裡。用戶想加入新專案時，
 * 那是 `POST /api/projects` 的事（那是「新增」，要使用者明確的動作）；
 * 這裡只回答「能不能用」。
 */
export function isKnownProject(cwd: string, scope: ProjectScope): boolean {
	if (!cwd) return false;
	const key = projectKey(cwd);
	if (scope.pinned.some(p => projectKey(p.path) === key)) return true;
	if (scope.sessions.some(s => s.cwd && projectKey(s.cwd) === key)) return true;
	return scope.liveCwds.some(c => projectKey(c) === key);
}
