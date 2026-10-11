# Oh My Pi Web

English: [README.md](README.md)

[Oh My Pi（omp）](https://github.com/canmi/oh-my-pi) 的本机 Web 端，只监听 `127.0.0.1`。

一个 Bun 网关为每个打开的会话起一个 `omp --mode rpc-ui` 子进程，把协议帧通过 WebSocket 推给前端；Vite + React 客户端负责渲染对话。所有知道 omp 细节的代码都收在 `server/omp/` 和 `shared/omp/`，其它地方只跟这两个目录说话。不用组件库：手写 CSS，带浅色和深色两套主题。

## 截图

首页——项目和模型选择器；omp 进程在发出第一条消息时才启动。浅色与深色：

![首页，浅色主题](docs/screenshots/01_light_home.png)

![首页，深色主题](docs/screenshots/01_dark_home.png)

设置——通用页：主题、字体大小、字体、对话宽度、通知和 Enter 行为。

![设置窗口](docs/screenshots/02_settings.png)

## 开始使用

```sh
bun install
bun run build
bun run scripts/serve.ts            # http://127.0.0.1:30190 —— 连你真实的 ~/.omp/agent
bun run scripts/serve.ts --test     # http://127.0.0.1:30191 —— 隔离测试配置
```

`--test` 用 `.data/omp-agent` 作为 omp 的配置目录，并往里播种一个示例供应商和模型（由 `scripts/setup-test-profile.ts` 完成，已有的 `models.yml` 不会被覆盖）——改这个文件，或者去设置 → 模型供应商，把它指向你自己的端点。密钥可以只写环境变量名。

方便起见，在 `PATH` 上放一个叫 `ompweb` 的入口，内容就是 `bun run scripts/launch.ts`。没有网关在跑时它先启动网关（`web/` 源码更新过会先构建），然后打开页面；已经有在跑的网关就只打开页面——除非那个网关比 `server/` 还旧，这时它会说明情况并等你加 `--restart`。也支持 `--test` 和 `--no-open`。

- 只改 `web/`：`bun run build` 之后刷新页面即可。改了 `server/` 或 `shared/`：需要重启。
- `--restart` 是优雅的：先请正在跑的网关自己关闭，而那个网关会先等自己的 omp 子进程写完收尾退出（最多 5 秒），免得留下子进程占住会话文件；端口 10 秒还没让开才去强制结束那棵进程树。硬杀网关正是 omp 下次打开同一个文件时把整段对话另存成副本的原因。
- 一个 omp 配置目录只服务一个网关：目录里的 `web-gateway.lock` 以独占方式占用，内容是 `{pid, port, startedAt}`。`ompweb` 撞到同一配置目录上的别的网关时，直接打开那个地址；硬起的第二个网关会拒绝启动。网关启动时还会先结束「父进程已经不在、且 `--resume` 的文件属于本目录」的 omp 遗留进程，并在日志里写清清了几个。

## 功能

| 区域 | 内容 |
| --- | --- |
| 侧栏 | 按项目分组的会话列表，可搜索；会话菜单里有重命名、导出 HTML、归档；omp 因为原文件被别的进程占用而另存出来的那条，带灰色「副本」标记——不自动隐藏也不自动删除，留给你归档；「插件」页入口；左下角是设置入口，只有断线时才显示「连接中断」 |
| 首页 | 选择项目；模型芯片选的是**这条**新会话用的模型，默认取配置里的默认模型，不按会话记忆；发出第一条消息时才启动会话进程；这里输入 `/` 也有命令菜单，列表按项目缓存，所以没有会话时一样能用 |
| 对话 | 流式回复；思考过程可折叠；紧凑工具行（失败显示在行内）；技能调用折成一行「已加载技能 X」，点开在右侧栏看它的 `SKILL.md`；整轮完成后折叠成「已处理 · 用时」；文件改动卡片和 diff；从任意一轮分叉；复制自己发的消息，或原地编辑后重新发送（这条之后的对话会删除）；斜杠命令自成一排——右对齐的命令标签加它的输出（一行直接显示、多行卡片、超长先折叠）；超过十二行的自己发的消息先折给前六行；回到底部与渐隐 |
| 输入框 | 斜杠命令菜单：按用途分组、最近使用置顶、底部一行讲清当前选中项、二级子命令、参数提示、`/fast` 这类开关显示当前值；界面已有控件的命令改成引导过去，破坏性子命令先确认；`@` 文件补全；图片附件（粘贴、拖拽、选择文件）；停止；运行中插入或排队，排队的消息可以撤回；模型与思考等级 |
| 交互 | 审批、选择、输入、编辑器、`ask` 多题卡片；进程退出后显示可重新连接的卡片；会话文件正被别的 omp 进程占用时不再悄悄产生副本，页面给出那个进程号，由你决定「仍然打开（可能另存为副本）」；omp 自己另存了新文件时界面跟着换到新路径，并在对话里说明原因 |
| 右侧栏 | 信息（待办、上下文用量、会话）、子代理（列表、实时进度和过程、追加指令、停止）、文件（目录树和预览）、改动（git 状态和 diff） |
| 插件 | 技能卡片按来源排序（用户 / 项目 / 插件提供 / 自动学习 / 其他），停用的收在折叠区里，可搜索，列的是你打开该页时所在项目的技能；点卡片能看 `SKILL.md`、启停、复制路径、在资源管理器中显示、或预填 `/skill:<名称>` 去新会话；插件标签只读列出已装插件 |
| 设置 | 通用（主题、字体大小、字体、对话宽度、通知、Enter 行为、子代理侧栏）、智能体与会话（默认模型与思考强度、默认计划模式、子代理模型、小模型）、模型供应商（自定义供应商可增删改、隐藏不想看见的模型、只读查看已装模型）、已归档的会话（恢复、彻底删除）、关于 |

首轮问答结束后会话会自动取标题（多一次模型调用，`OMP_WEB_AUTO_TITLE=0` 可以关掉）。

## 检查

```sh
bunx tsc --noEmit -p tsconfig.json   # 类型
bun test                             # 单元测试（视图模型逻辑 + 真实录制帧）
bun run build                        # 生产构建
bun run lint:omp                     # omp 的细节有没有跑出 server/omp/ 和 shared/omp/
```

## 结构

| 路径 | 作用 |
| --- | --- |
| `server/main.ts` | HTTP `/api/*` + WebSocket `/ws`：会话索引、重命名、导出、归档、删除、about、reveal |
| `server/orphans.ts` | 读操作系统进程表：只结束「父进程已经不在、且会话文件属于本配置目录」的 omp 子进程；也回答「这个会话正被别的活进程占用吗」 |
| `server/profile-lock.ts` | 一个 omp 配置目录只允许一个网关：`web-gateway.lock` 原子占用、启动窗口与健康检查判定归属、接管与安全摘除 |
| `server/omp-process.ts` | 一个 `omp --mode rpc-ui` 子进程：JSONL 分帧、v2 分片重组、按 id 关联请求与响应、能力握手 |
| `server/session-hub.ts` | 每个打开的会话一个进程；消息镜像 + 进行中帧回放；对话框、命令列表、命令输出记录、子代理、改名、以及重定位到 omp 另存出来的新文件 |
| `server/command-catalog.ts` | 首页要用的斜杠命令列表：按项目缓存各会话推过的 `available_commands_update`，stale-while-revalidate，没有缓存就起一个 `--no-session` 探测进程；落盘 `<dataDir>/commands-cache.json` |
| `server/session-index.ts` | 直接读 omp 会话文件头部生成侧栏列表；靠头部的 `parentSession` + `providerPromptCacheKey` 认出「omp 从被占用的文件另存出来的那一份」，并指向原文件 |
| `server/archive.ts` | 只属于 Web 端的归档列表 `<dataDir>/archived.json`（只隐藏，不动会话文件） |
| `server/providers.ts` | 设置页的 `models.yml` 编辑：按块改写、写前备份、其它字节原样保留；写完让 omp 自己回读，它解析不出某个供应商、少列了模型或报 schema 错误就回滚，并把 omp 的原因带回界面 |
| `server/omp-config.ts` | 通过 `omp config list/get/set --json` 读写 omp 配置：30 秒缓存、按 key 白名单与取值校验、读-改-写只动指定的那个键 |
| `server/agent-settings.ts` | 模型角色（default / task / smol / slow / tiny）、按子代理覆盖、默认计划模式；测试配置下拒绝写入 |
| `server/models.ts` | 没有会话时的模型列表（`omp models --json`）与角色取值的有效性判断 |
| `server/plugins.ts` | 技能与插件：按项目列出技能、把 `disabledExtensions` 里停用的技能补回列表、`<dataDir>/skills-seen.json` 元数据缓存、读 `SKILL.md` |
| `server/files.ts` | 右侧栏的文件树、文件预览、git 状态和 diff（限制在项目目录内） |
| `server/projects.ts` | 项目（工作目录）列表、文件夹浏览 |
| `server/omp/` | **唯一知道 omp 的地方**：`cli.ts` 环境变量与子命令参数、`errors.ts` 错误文本分类、`handshake.ts` + `capabilities.ts` 逐项能力协商、`session-file.ts` 会话文件头部、`compat.ts` 已验证版本号与启动自检 |
| `shared/commands.ts` | 斜杠命令的一张表：名称、分组、图标、匹配排序、参数提示、破坏性判断、已被界面控件取代的命令 |
| `shared/command-output.ts` | 命令输出与「已执行」记录的消息形状，网关和浏览器共用；剥除终端转义 |
| `shared/omp/wire.ts` | 只声明本项目真正读取的那些 omp 帧字段，以及读字段的工具函数 |
| `shared/omp/conventions.ts` | 散在协议里的常量：配置键、模型角色、customType、消息角色、技能前缀、标题槽、目录布局 |
| `shared/subagents.ts` | 子代理生命周期与进度帧的合并逻辑，网关和浏览器共用 |
| `web/src/lib/session-store.ts` | 不依赖 React 的会话状态；流式增量按帧合并 |
| `web/src/lib/app-store.ts` | 视图与路由（首页 / 会话 / 插件）、偏好、会话索引、归档、设置窗口、通知、智能体设置、技能与插件 |
| `web/src/lib/skills.ts` | 技能来源分组、头像取色、`SKILL.md` 头部剥离，列表和抽屉共用 |
| `web/src/lib/ansi.tsx` | 命令输出里的 SGR 颜色 → 主题色片段；256 色与直接色就近折算，解析不出就退回纯文本 |
| `web/src/lib/turns.ts` | 消息 → 回合 / 步骤 / 命令项 / 工具标签 / 文件改动 / 用时 |
| `web/src/components/` | 侧栏、首页、对话、输入框、命令菜单、模型菜单、项目选择、审批卡、右侧栏（含 `AgentsPanel`）、插件页与技能抽屉、设置窗口（`SettingsDialog` + `settings/` 各页） |
| `tests/` | 回合分组、命令项与命令菜单、命令目录缓存、工具标签、分片解码、ANSI、会话索引、配置读写、技能与插件、能力协商的单元测试；`fixtures/omp-stub.ts` 是替代 `omp` 的桩脚本；`fixtures/web-qa-extension.js` 提供不调用模型的弹窗测试命令；`fixtures/omp-frames/<版本>/basic.jsonl` 是从真实 omp 录下的帧，由 `session-store.replay.test.ts` 逐个回放 |

## 数据位置

| 路径 | 内容 |
| --- | --- |
| `~/.omp/agent`（测试时为 `.data/omp-agent`） | omp 自己的配置和会话。Web 端读写会话名称，并以独占方式写一个 `web-gateway.lock`（`{pid, port, startedAt}`）占用该配置目录，干净退出时摘掉；只有进程号已不在且超过启动窗口的残留锁才会被接管。只有「彻底删除」会删除会话文件。 |
| `.data/web`（测试时为 `.data/web-test`） | 项目列表、归档列表、导出的 HTML、按项目的斜杠命令列表缓存 `commands-cache.json`，以及启动时写下的 `gateway.json`——`ompweb --restart` 用它证明重启请求来自本机 |

## 升级 omp

针对一个 omp 版本的工作只有两件事：**先跑一条自检命令知道哪里不兼容，再只改一个目录**。不需要从 omp 源码复制任何文件进来。

1. 升级 omp。
2. `bun run omp:check`——起一个真实的 `omp --mode rpc-ui` 进程，加上它的 CLI 子命令，按九组逐项验证：版本、进程与握手、`get_state` 字段、命令列表、命令输出与会话文件头部、`models` / `config list` / `skill list` / `plugin list`、配置目录的环境变量隔离。全部通过时退出码 0；有失败项时逐条打印原因，并指出只应该改 `server/omp/` 与 `shared/omp/`。它跑在隔离配置目录（默认 `.data/omp-agent`），不会写到你的 `~/.omp/agent`。
3. 全部通过，且唯一没过的就是版本那一行 → 这条命令会**自己**把 `server/omp/compat.ts` 里的 `TESTED_OMP` 改成装着的这个版本，读回核对写入成功，然后提示你提交那一行；只想问不想改就加 `--no-bump`。还有别的能力警告时它不动那个常量——界面会自行降级的版本，值得先看清楚再认。改完之后网关启动时的轻量检查变成「已验证」，设置 → 关于 里也不再提示。
4. 有失败 → 只改 `server/omp/` 和 `shared/omp/` 里的文件（帧字段读不到就补 `shared/omp/wire.ts` 的声明，参数或错误文本变了就改 `cli.ts` / `errors.ts`，能力协商变化改 `handshake.ts`），然后重跑第 2 步。改完跑 `bun run lint:omp`，确认没有把 omp 细节散回业务代码。
5. `bun run omp:record` 把一轮真实会话录成帧，写到 `tests/fixtures/omp-frames/<新版本>/basic.jsonl`。**这会调用一次模型**，所以和 `--test` 一样需要环境里准备好密钥，也因此只在升级时手动跑。它跑在隔离配置目录，内容是一轮问答 + 一次工具调用 + 一条本地 `/fast status`，进程带 `--no-session` 所以不会留下会话文件；写盘前会抹掉那个临时工作目录和配置目录里的技能清单，帧里出现任何凭据形状的字符串就放弃写文件。旧版本那份保留，`bun test` 会每一份都跑——新版本挂在这里，说明前端的帧处理需要调整，这比 `omp:check` 更早暴露问题。

可选的开发辅助：`bun run omp:wire-diff <omp 生成类型文件路径>` 打印我们声明的字段在新版生成类型里是否还在，只作参考，不参与构建。

## 许可

MIT。

Oh My Pi 采用 MIT 许可——Copyright (c) 2025 Mario Zechner、Copyright (c) 2025-2026 Can Bölük、Copyright (c) 2026 Stencil Labs, Inc. 本项目通过 omp 公开的 RPC 传输与它通信，不含任何 omp 源码。
