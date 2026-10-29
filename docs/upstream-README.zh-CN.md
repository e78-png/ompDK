# Oh My Pi Web

English: [README.md](README.md)

[Oh My Pi（omp）](https://github.com/can1357/oh-my-pi) 的本机 Web 端，只监听 `127.0.0.1`。

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

## 开发

在两个终端分别启动网关与 Vite：

```sh
bun run scripts/serve.ts   # 网关：http://127.0.0.1:30190
```

```sh
bun run dev               # 前端：http://127.0.0.1:5190
```

Vite 将 `/api` 与 `/ws` 转发给网关。使用端口 30191 的隔离 `--test` 网关时，在 Vite 所在终端先设置 `OMP_WEB_PORT=30191`，再执行 `bun run dev`（PowerShell 写法：`$env:OMP_WEB_PORT = "30191"`）。前端修改由 Vite 自动刷新；改了 `server/` 或 `shared/` 后重启网关。

## 在手机上用

手机和电脑连同一个 Wi-Fi，启动时多带一个参数：

```sh
bun run scripts/serve.ts --lan      # 或 PATH 上的 ompweb --lan
```

终端会打印手机地址与这一次的访问码；「设置 → 手机访问」显示同一份信息，还带二维码，手机扫码即可登录，不用手输。这个设置页只在本机打开时出现。手机页面就是同一套前端：760px 以下换成抽屉侧栏、右侧面板铺满、按钮常显且更大、回车只换行靠按钮发送。

- 访问码每次启动换一个，6 位数字；输对一次后那台手机 30 天内不用再输，输错 5 次锁 10 分钟，累计错够 20 次自动换码；所有已登录的手机可以在设置页一起退出。
- 不想要时去掉 `--lan` 重启，回到只监听 `127.0.0.1`。
- 系统通知在 `http://` 下不可用（通知 API 要求安全上下文），设置页会说明原因并禁用开关。
- 地址列表里 `Meta`、`vEthernet` 这类虚拟网卡的地址手机连不上，只试 WLAN 那条。

**只在家里或可信的 Wi-Fi 下开启。** 这里走 HTTP、没有证书：同一个网络里的人抓包就能拿到登录凭据和对话内容。

手机提示「无法访问」时按这个顺序查，每条都有判定标准：

| 步骤 | 怎么做 | 判定 |
| --- | --- | --- |
| 1. 代理软件 | 退出电脑上的代理客户端（例如 Clash Verge / mihomo，整个退出而不是只关 TUN），再从手机打开 | 若恢复，继续检查该客户端的路由、TUN 与过滤配置 |
| 2. 网段 | 手机 Wi-Fi 里看 IP 地址（iPhone：设置 → Wi-Fi → ⓘ；Android：Wi-Fi → 详情） | 必须和电脑同一个网段；落在别的段说明两台机器不在同一个网络 |
| 3. 手机侧 VPN | 关掉手机上的 VPN / 代理 App，或把局域网设成直连 | 若恢复，就是手机的隧道把内网地址也带走了 |
| 4. 更换网络 | 手机开热点、电脑连该热点，用设置页新出现的地址访问 | 若恢复，继续检查原 Wi-Fi 的客户端隔离、路由与防火墙策略 |

## 功能

历史压缩后保留全文、CLI 子代理恢复、流式 Markdown 和侧栏拖动的使用方式见 [会话显示与侧栏](docs/session-display.md)。本次更新需要重启服务并刷新页面（接口版本 6）。

| 区域 | 内容 |
| --- | --- |
| 侧栏 | 按项目分组的会话列表，可搜索；会话菜单里有重命名、导出 HTML、归档；omp 因为原文件被别的进程占用而另存出来的那条，带灰色「副本」标记——不自动隐藏也不自动删除，留给你归档；「插件」页入口；左下角是设置入口，只有断线时才显示「连接中断」 |
| 首页 | 选择项目；模型芯片选的是**这条**新会话用的模型，默认取配置里的默认模型，不按会话记忆；发出第一条消息时才启动会话进程；这里输入 `/` 也有命令菜单，列表按项目缓存，所以没有会话时一样能用 |
| 对话 | 流式回复，公式用 KaTeX 离线排版（`\[ … \]`、`\( … \)`、`$$…$$`、`$…$`；认不出的宏只降级那一个式子，价格和代码不算公式）；思考过程可折叠，正文按 markdown 渲染，摘要一行一条；紧凑工具行——失败时把原因首行显示在行下，同一条消息里连续的同名调用并成一行「读取 ×15」，点开看逐条；技能调用折成一行「已加载技能 X」，点开在右侧栏看它的 `SKILL.md`；整轮完成后折叠成「已处理 · 用时」，计数含折叠组里的每一次调用，用时精确到零点一秒；文件改动卡片和 diff；从任意一轮分叉；复制自己发的消息，或原地编辑后重新发送（这条之后的对话会删除）；斜杠命令自成一排——右对齐的命令标签加它的输出（一行直接显示、多行卡片、超长先折叠）；自己发的消息超过十二个显示行时默认显示前六行，已完成的长回复可手动折叠；展开与收起不影响复制或编辑全文；回到底部与渐隐 |
| 输入框 | 斜杠命令菜单：按用途分组、最近使用置顶、底部一行讲清当前选中项、二级子命令、参数提示、`/fast` 这类开关显示当前值；界面已有控件的命令改成引导过去，破坏性子命令先确认；`@` 文件补全；图片附件（粘贴、拖拽、选择文件）；停止；运行中插入或排队，排队的消息可以撤回；模型与思考等级 |
| 交互 | 审批、选择、输入、编辑器、`ask` 多题卡片；进程退出后显示可重新连接的卡片；识别到其他 omp 进程占用时自动只读查看历史和子代理，CLI 新会话也可从会话菜单进入只读查看；omp 自己另存了新文件时界面跟着换到新路径，并在对话里说明原因 |
| 右侧栏 | 信息（待办、上下文用量、会话）、子代理（列表、实时进度和过程、追加指令、停止）、文件（目录树和预览）、改动（git 状态和 diff）；下半部预览可独立关闭，关闭后列表填满侧栏 |
| 插件 | 技能卡片按来源排序（用户 / 项目 / 插件提供 / 自动学习 / 其他），停用的收在折叠区里，可搜索，列的是你打开该页时所在项目的技能；点卡片能看 `SKILL.md`、启停、复制路径、在资源管理器中显示、或预填 `/skill:<名称>` 去新会话；插件标签只读列出已装插件 |
| 设置 | 通用（界面语言、主题、字体大小、字体、对话宽度、通知、Enter 行为、子代理侧栏）、智能体与会话（默认模型与思考强度、默认计划模式、子代理模型、小模型）、模型供应商（自定义供应商可增删改、隐藏不想看见的模型、只读查看已装模型）、已归档的会话（恢复、彻底删除）、手机访问（只在本机显示：局域网地址、访问码、二维码、换码、让所有手机退出）、关于 |
| 手机 | `--lan` 开启后手机才能连上，首次打开要输访问码（终端或设置页里看），扫码可免输；760px 以下换成手机布局：侧栏变抽屉、右侧面板铺满、触屏按钮常显且更大、软键盘不挡输入框、展开的处理过程表头钉在滚动区顶部 |

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
| `server/request-guard.ts` | 只接受以本机名字（回环、本机网卡地址、`OMP_WEB_ALLOWED_HOSTS`）到达的请求，并核对 `Origin`：挡掉跨站页面与 DNS 重绑定 |
| `server/lan-auth.ts` | 局域网访问的配对：每次启动一个 6 位访问码、按 IP 与全局的输错限速、只存摘要的设备令牌、`<dataDir>/lan-devices.json`、可开放的手机地址排序 |
| `server/omp/` | **唯一知道 omp 的地方**：`cli.ts` 环境变量与子命令参数、`errors.ts` 错误文本分类、`handshake.ts` + `capabilities.ts` 逐项能力协商、`session-file.ts` 会话文件头部、`notices.ts` 长挂载通知摘要、`compat.ts` 已验证版本号与启动自检 |
| `shared/commands.ts` | 斜杠命令的一张表：名称、分组、图标、匹配排序、参数提示、破坏性判断、已被界面控件取代的命令 |
| `shared/command-output.ts` | 命令输出与「已执行」记录的消息形状，网关和浏览器共用；剥除终端转义 |
| `shared/omp/wire.ts` | 只声明本项目真正读取的那些 omp 帧字段，以及读字段的工具函数 |
| `shared/omp/conventions.ts` | 散在协议里的常量：配置键、模型角色、customType、消息角色、技能前缀、标题槽、目录布局 |
| `shared/subagents.ts` | 子代理生命周期与进度帧的合并逻辑，网关和浏览器共用 |
| `web/src/lib/session-store.ts` | 不依赖 React 的会话状态；流式增量按帧合并 |
| `web/src/lib/app-store.ts` | 视图与路由（首页 / 会话 / 插件）、会话索引、归档、设置窗口、通知、智能体设置、技能与插件 |
| `web/src/lib/session-registry.ts` | 会话标识、临时会话激活、换键，以及连接与脱离的生命周期 |
| `web/src/lib/preferences.ts` | 浏览器偏好默认值、持久化、主题、字体与对话宽度 |
| `web/src/lib/skills.ts` | 技能来源分组、头像取色、`SKILL.md` 头部剥离，列表和抽屉共用 |
| `web/src/lib/ansi.tsx` | 命令输出里的 SGR 颜色 → 主题色片段；256 色与直接色就近折算，解析不出就退回纯文本 |
| `web/src/lib/markdown.tsx` + `math.ts` | 回答的渲染管线：marked → KaTeX 公式（`math.ts` 是它的分词与渲染扩展）→ DOMPurify；流式期间先给转义纯文本，落定后才排 markdown 与公式 |
| `web/src/lib/turns.ts` | 消息 → 回合 / 步骤 / 命令项 / 工具标签 / 文件改动 / 用时 |
| `web/src/lib/i18n/` | 界面语言：`index.ts` 提供 `t(key, params?)` 与 `pick([zh, en])`，`chat/chrome/panel/settings/shell.ts` 各存一个区域的消息对；默认中文，可切跟随系统或 English |
| `web/src/lib/viewport.ts` | 唯一的窄屏断点（760px）与触屏判断；iOS 上把 `visualViewport` 高度写进 `--app-h`，让输入框不被软键盘盖住 |
| `web/src/lib/clipboard.ts` | 复制文本：安全上下文用 `navigator.clipboard`，HTTP 页面退回 `execCommand`（手机上只有这条路） |
| `web/src/lib/qr.ts` | 把配对链接编成二维码点阵，设置页把它画成 SVG |
| `web/src/components/` | 侧栏、首页、对话、输入框、命令菜单、模型菜单、项目选择、审批卡、右侧栏（含 `AgentsPanel`）、插件页与技能抽屉、设置窗口（`SettingsDialog` + `settings/` 各页） |
| `tests/` | 回合分组、命令项与命令菜单、命令目录缓存、工具标签、公式分词、用时格式化、分片解码、ANSI、会话索引、配置读写、技能与插件、能力协商的单元测试；`fixtures/omp-stub.ts` 是替代 `omp` 的桩脚本；`fixtures/web-qa-extension.js` 提供不调用模型的弹窗测试命令；`fixtures/omp-frames/<版本>/{basic,interrupt}.jsonl` 是从真实 omp 录下的帧，由 `session-store.replay.test.ts` 逐个回放 |

维护记录见 [docs/maintenance.md](docs/maintenance.md)。回归测试还覆盖 WebSocket 重连、会话标识、偏好存储、快照回放与 smoke 脚本退出行为。

## 数据位置

| 路径 | 内容 |
| --- | --- |
| `~/.omp/agent`（测试时为 `.data/omp-agent`） | omp 自己的配置和会话。Web 端读写会话名称，并以独占方式写一个 `web-gateway.lock`（`{pid, port, startedAt}`）占用该配置目录，干净退出时摘掉；只有进程号已不在且超过启动窗口的残留锁才会被接管。只有「彻底删除」会删除会话文件。 |
| `.data/web`（测试时为 `.data/web-test`） | 项目列表、归档列表、导出的 HTML、按项目的斜杠命令列表缓存 `commands-cache.json`、启动时写下的 `gateway.json`——`ompweb --restart` 用它证明重启请求来自本机，以及 `lan-devices.json`（已配对的手机：令牌摘要、最近使用时间、设备类型，原文不落盘） |

## 升级 omp

针对一个 omp 版本的工作只有两件事：**先跑一条自检命令知道哪里不兼容，再只改一个目录**。不需要从 omp 源码复制任何文件进来。

1. 升级 omp。
2. `bun run omp:check`——起一个真实的 `omp --mode rpc-ui` 进程，加上它的 CLI 子命令，按九组逐项验证：版本、进程与握手、`get_state` 字段、命令列表、命令输出与会话文件头部、`models` / `config list` / `skill list` / `plugin list`、配置目录的环境变量隔离。全部通过时退出码 0；有失败项时逐条打印原因，并指出只应该改 `server/omp/` 与 `shared/omp/`。它跑在隔离配置目录（默认 `.data/omp-agent`），不会写到你的 `~/.omp/agent`。
3. 全部通过，且唯一没过的就是版本那一行 → 这条命令会**自己**把 `server/omp/compat.ts` 里的 `TESTED_OMP` 改成装着的这个版本，读回核对写入成功，然后提示你提交那一行；只想问不想改就加 `--no-bump`。还有别的能力警告时它不动那个常量——界面会自行降级的版本，值得先看清楚再认。改完之后网关启动时的轻量检查变成「已验证」，设置 → 关于 里也不再提示。
4. 有失败 → 只改 `server/omp/` 和 `shared/omp/` 里的文件（帧字段读不到就补 `shared/omp/wire.ts` 的声明，参数或错误文本变了就改 `cli.ts` / `errors.ts`，能力协商变化改 `handshake.ts`），然后重跑第 2 步。改完跑 `bun run lint:omp`，确认没有把 omp 细节散回业务代码。
5. `bun run omp:record` 把真实会话录成帧，写到 `tests/fixtures/omp-frames/<新版本>/basic.jsonl` 与 `interrupt.jsonl`。**这会调用两轮模型**，所以和 `--test` 一样需要环境里准备好密钥，也因此只在升级时手动跑。它跑在隔离配置目录：一轮问答 + 一次工具调用 + 一条本地 `/fast status`，再一轮被中途打断的长回答。进程带 `--no-session` 所以不会留下会话文件；写盘前会抹掉那个临时工作目录和配置目录里的技能清单，帧里出现任何凭据形状的字符串就放弃写文件。旧版本那份保留，`bun test` 会把每一份都跑——新版本挂在这里，说明前端的帧处理需要调整，这比 `omp:check` 更早暴露问题。

可选的开发辅助：`bun run omp:wire-diff <omp 生成类型文件路径>` 打印我们声明的字段在新版生成类型里是否还在，只作参考，不参与构建。

## 许可

MIT。

Oh My Pi 采用 MIT 许可——Copyright (c) 2025 Mario Zechner、Copyright (c) 2025-2026 Can Bölük、Copyright (c) 2026 Stencil Labs, Inc. 本项目通过 omp 公开的 RPC 传输与它通信，不含任何 omp 源码。
