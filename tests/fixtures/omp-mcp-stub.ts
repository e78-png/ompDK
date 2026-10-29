/**
 * Stand-in for `omp` in the MCP tests: it speaks just enough of the RPC transport to
 * answer a `/mcp list` prompt with a fixed table.
 *
 * 為什麼要這個假身：真的 omp 會把使用者機器上所有的 MCP server 拉起來——測試不該
 * 動到真的設定檔，也不該讓真的 server 跑起來。所以這個 stub 讀一行 stdin、印一個
 * `command_output` 影格就結束。
 *
 * `STUB_MCP_TEXT` 決定印出什麼（預設是 omp 真的會印的那種表格）；`STUB_MCP_EXIT`
 * 讓它以非零碼結束，用來測失敗的路徑。
 */
export {};

const send = (frame: unknown): void => {
	process.stdout.write(`${JSON.stringify(frame)}\n`);
};

const text = process.env.STUB_MCP_TEXT ?? "";
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });

if (process.env.STUB_MCP_EXIT) {
	process.stderr.write("stub: refusing the command\n");
	process.exit(Number(process.env.STUB_MCP_EXIT));
}

// Read until the prompt arrives, answer it, and stop.
for await (const chunk of process.stdin) {
	const line = chunk.toString();
	if (!line.includes('"type":"prompt"')) continue;
	send({ type: "command_output", text });
	send({ id: "m1", type: "response", command: "prompt", success: true, data: { agentInvoked: false } });
	break;
}
process.exit(0);
