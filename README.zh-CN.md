# ompDK

**把 `omp`（oh-my-pi）变成浏览器里的 agent 界面：左侧 session 记录，右侧聊天框。**

ompDK 是一个本地 Web 应用，用来操作本机的 [omp](https://github.com/can1357/oh-my-pi) coding agent。
它不重写 agent——所有推理、工具调用、session 存档都还是 omp 自己在做；
ompDK 是一层界面，用 `omp --mode rpc-ui` 的协议把 omp 接到浏览器上。

```
┌──────────────┬──────────────────────────────────┐
│  session 记录 │        聊天框                    │
│  今天 / 昨天  │  流式回复 · 工具调用 · diff      │
│  近 7 天/更早 │  发送 / 中断 / 排队              │
└──────────────┴──────────────────────────────────┘
```

除了聊天框，界面还有：

- **MCP 面板**（插件页的第三个分页）：显示 omp **实际加载**的 MCP server——
  传输类型、启用状态、端点、来源。不是读配置文件，是问上游的 `/mcp list`。
- **命令面板**（`⌘/Ctrl+K`）：搜索所有页面动作。
- **桌面版**（Electron）：可打包成 Windows 安装包。
- **繁体中文 / 简体中文 / English**。

> 英文版见 [README.md](README.md)。

## 快速开始

需要 [Bun](https://bun.sh) 1.4+ 与已安装并登录模型的 `omp`。

```sh
bun install
bun run scripts/launch.ts     # 或 Windows：ompDK.cmd / ompDK.ps1
```

打开 <http://127.0.0.1:30190/>。

Windows 上的启动器：

```sh
ompDK.cmd              # 启动 gateway（前台，Ctrl+C 可停）并开浏览器
ompDK.cmd --no-open    # 不开浏览器
ompDK.cmd --lan        # 同时让局域网也能连进来（背后有配对码）
```

`ompDK.ps1` 是等价的 PowerShell 版本。启动器会在需要时先重新构建前端，
并把主控台切成 UTF-8，让 gateway 的中文消息在中文 Windows 上也读得懂。

开发模式（Vite HMR + 代理到 gateway）：

```sh
bun run scripts/serve.ts      # 终端机 A：gateway :30190
bun run dev                   # 终端机 B：Vite :5190
```

## 功能

- **左侧 session 记录**：时间模式（今天／昨天／近 7 天／更早）与项目模式可切换；
  搜索、重命名、导出 HTML、归档、只读查看被 CLI 占用的 session。
- **右侧聊天框**：流式 markdown、KaTeX 公式、工具调用卡片、文件变更 diff、
  思考摘要折叠、`/` 指令菜单、`@` 文件补全、图片附件、发送／中断／排队。
- **右侧面板**：todos 与 context 用量、subagent 实时进度、文件树与预览、git diff。
- **繁体中文 / 简体中文 / English**。
- **本地优先**：只绑 `127.0.0.1`，凭据留在 omp 自己的 `~/.omp/agent`。

## 兼容性

基底跟着 omp 的版本走。`bun run omp:check` 会对本机安装的 omp 跑一轮自我检查
（不调用模型、不写用户的真实 session），并在只有版本号不符时自己更新 `TESTED_OMP`。

## 安全注意

gateway 默认操作**真实的** omp profile（`~/.omp/agent`）。
「永久删除」会删掉真实的 session 文件，不可逆。
要在隔离环境跑请用 `bun run scripts/serve.ts --test`，
或设 `OMP_WEB_AGENT_DIR` 指向别的 profile。

`--lan` 会让界面开到局域网（纯 HTTP），只在信任的 Wi-Fi 下使用。

详见 [SECURITY.md](SECURITY.md)。

## 文档

- [`docs/PLAN.md`](docs/PLAN.md) — 架构、选型理由、安全边界、验证结果
- [`AGENTS.md`](AGENTS.md) — 给 agent 的操作说明（命令、惯例、陷阱）
- [`CHANGELOG.md`](CHANGELOG.md) — 变更记录
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 参与开发

## 授权

本项目 fork 自 [`klffjbkmhjkndml-arch/omp-web`](https://github.com/klffjbkmhjkndml-arch/omp-web)（MIT，
原作者 Rain），该项目本身对话的是 [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi)（MIT）的 RPC 协议。

本 repo 不含任何 omp 的源代码，只通过其公开的 RPC 协议与本机安装的 `omp` 沟通。

MIT 授权，版权标示同时保留原作者与本 fork 的修改者（见 [`LICENSE`](LICENSE)）。
上游的原始说明文件保留在 [`docs/upstream-README.md`](docs/upstream-README.md) 与
[`docs/upstream-README.zh-CN.md`](docs/upstream-README.zh-CN.md)。
