# dsh-browser-view · DSH Web GUI 的实时浏览器视图

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-BSD--3--Clause-blue?style=flat-square" alt="License">
</p>

> agent 驱动的那个浏览器，从对话旁边的标签页里看着。宿主半区用 devtools 协议掌管一个独立 Chromium，浏览器半区贡献一个右侧栏标签页类型，于是页面在验证的当下就在眼前。

本包是 DeepSeek Harness（DSH）的外部插件，形态是 cordis bundle：`src/index.ts` 是宿主半区（Chrome 进程、CDP 会话、标签页登记、WebSocket 分发、agent 工具），`src/client/` 是浏览器半区（右栏标签页内容与它的 chip）。

## 它能做什么

- **实时标签页，不是定时截图**：面板用三种方式画同一个页面，由你选：像素帧（`Page.startScreencast`，默认，也是另外两条的回退）、实时 DOM 镜像（页面里跑 rrweb 录制器，面板里跑 rrweb 重放器，文字清晰、流量按事件计）、标签页录制（把标签页自己的合成器表面录成 VP8、面板用 MSE 播放——跨域 `<video>` 只有这条有真画面）。标签页显示当前页面、URL 与标题，以及 agent 最近做了什么。
- **十一个 agent 工具**：`browser_navigate`、`browser_click`、`browser_type`、`browser_press`、`browser_scroll`、`browser_snapshot`、`browser_screenshot`、`browser_console`、`browser_network`、`browser_tabs`、`browser_close`（只关本会话自己打开的标签页）。
- **证据留在对话里**：每次 `browser_screenshot` 的结果都带图，于是对话记录保留的是 agent 真正看到的那一屏，而不只是一句转述。
- **一个专用浏览器**：插件自己拉起 Chromium，用一次性 profile。除非你用 `DSH_BROWSER_VIEW_ATTACH_PORT` 显式开启附着模式（见安全模型），它不会接管你已经登录的浏览器。
- **能进这台机器自己的 GUI**：全新 profile 没有会话 cookie，本来只会看到 401 提示页。当导航落在 loopback 上的那页提示时，插件向宿主的连接服务要一条与 `dsh web` 启动时打印的同样的带票 URL，补一次。种下的 cookie 只活在这个一次性 profile 里，随它一起销毁。

## 工作原理

```text
agent 工具调用 ──► 宿主半区 ──► CDP ──► 专用 Chromium
                       │
                       └─ 投屏帧 ──► WebSocket ──► 右栏标签页内容
```

宿主半区在第一次工具调用或第一次挂载标签页时才懒启动 Chrome，钉住视口尺寸，并按标签页保留控制台与网络请求的环形记录，因此一次验证不必重跑页面就能回读。顶层文档被替换时两份记录都会清空；同文档导航（hash、query、SPA pushState）则保留。

## 画面传输与带宽

帧默认走 WebSocket（JSON + base64）。面板挂载后会额外向宿主发起一次 WebRTC 握手：面板创建**不可靠、不保序**的 DataChannel（丢帧不重传，正适合画面流），宿主以 [werift](https://github.com/shinyoshiaki/werift-webrtc)（纯 TypeScript WebRTC 实现，零原生依赖）应答；通道打开后二进制帧改走 DataChannel，控制面（状态、动作、命令、输入）仍走 WebSocket。任何环节失败——包括单帧发送失败——都自动回退 WebSocket 流，且**只损失这一帧，不会把面板踢出广播**。

单帧按 ≤60 KiB 分块，每块前置 `[u32 序号][u8 块序][u8 总块数]`，面板按序号重组完整帧后再解码。这一步是必须的：DataChannel 单条消息上限 64 KiB，而真实页面的帧经常更大（实测 1280×800、质量 70 时，维基文章页 111 KB、重 DOM 页 250 KB），不分块就会每帧必抛。

带宽按「偶尔看一眼、需要时介入」来设计，而不是按连续看视频：

| 措施 | 说明 |
| --- | --- |
| 帧编码 | WebP + 质量 50（原为 JPEG + 70），同等观感下体积明显更小 |
| 采集盒 | 捕获为 1024×640（浏览器视口仍是 1280×800），指针坐标按比例回放大到视口，点击依旧精准 |
| 帧率预算 | 无人交互时最高约 15 fps，任一输入后 3 秒内放宽到约 30 fps |
| 不可见即停 | 侧边栏收起、切到别的 chip、或浏览器标签页被隐藏时，面板会告知宿主；**最后一个**在看的panel 离开即停掉投屏，此时不抓帧、不编码、不传输，重新可见时恢复并补一帧最新画面 |

## 三条通道：像素、文字镜像与标签页录制

面板可以**用三种方式**呈现同一个页面，由你选：

| 通道 | 做法 | 适用 |
| --- | --- | --- |
| 像素画面（默认） | CDP `Page.startScreencast` 帧，与从前完全一致 | 一切画面——`<video>`、canvas、原生 UI、DRM——同时也是另外两条通道的自动回退 |
| 文字镜像 | 宿主把 rrweb 录制器注入标签页（对之后的文档用 `Page.addScriptToEvaluateOnNewDocument`，对已加载的文档用 `Runtime.evaluate`），逐条记录变更并推给面板，面板用 rrweb 自带的重放器以 live 模式还原 | 文字与 UI 页面：任何面板宽度下都清晰，流量跟着「改了多少」走，而不是跟着「重绘多频繁」走 |
| 标签页录制 | Chromium 启动时带 `--auto-select-tab-capture-source-by-title=<哨兵>`、`--use-fake-ui-for-media-stream`、`--enable-usermedia-screen-capturing`；抓之前宿主把当前标签页标题改成哨兵（该 flag 按**捕获时刻**的标题匹配），再让页面 `getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true })`；页面用 `MediaRecorder`（`video/webm;codecs=vp8`、约 1.5 Mbps、每 200 ms 一片）把分片经 `Runtime.addBinding` 回传，面板用 MSE 播放 | 跨域媒体的**真画面**。文字镜像里 `<video>` 只有一个空元素，而元素级 `captureStream()` 对跨域 CDN 会抛 `SecurityError`——页面的媒体恰恰几乎都在 CDN 上。标签页录制走浏览器自己的合成器表面，媒体来自哪个源根本不参与判定 |

切换开关在工具栏上，开关上写的就是当前这条通道；连按即 像素 → 镜像 → 录制 循环。镜像与录制都是**只读**的：点击镜像里的节点、或点击录制画面，都不会映射成 CDP 动作，因为两者都不是页面自己的元素树。输入仍只在像素通道上。

两条非像素通道的开销有两点是刻意设计：

- **有人看才跑**。可见面板点了这条通道才注入录制器/开始录制；最后一个在看的面板不看了（或隐藏了）就停掉，并且只跟当前显示的标签页，后台标签页永远不录制。录制停止时还会把页面原标题放回去、停掉所有采集轨道（关掉系统的「正在共享」指示）。
- **新通道能画之前，像素通道不关**。第一份全量快照（镜像）或第一个分片（录制）送到面板之前帧照常发，所以切换通道不会拿一张活的画面去换一块空舞台。任一条起不来时（页面拒绝注入、录制器抛错、打包产物缺失、共享被拒绝、录制中途死掉）面板自动回退到像素画面，**并把原因显示出来**，而不是留一个没有任何解释的空窗口。

用本仓自带的 fixture 实测（各 5 秒窗口、通道分开跑、无头 Chromium 1280×800）：静态页 `grid.html` 像素与镜像在首帧之后都没有流量；`heavy.html`（4000 个绝对定位节点、每 50 ms 改 400 处行内样式）像素 1169 KiB/s、镜像 1093 KiB/s。这个 fixture 恰好是镜像的最坏情况——它每秒二十次重写文档里大部分行内样式。「更省」是页面的性质而不是通道的性质：改动少的页面镜像几乎不花流量，改动无处不在的页面不是。录制这条通道与像素同日对比：动画页 `av.html` 的 800×500 真画面录制约 320–500 kbps 的真实 VP8，而像素静帧约 1472 kbps；而且它是标签页合成器的输出（30 fps），不是约 10 fps 的静帧。

打包：`rrweb` 是运行时依赖，宿主注入的是**本包自己发布的 UMD 产物**——`lib/rrweb.umd.cjs`，由 `pnpm build` 从 rrweb 的 dist 复制而来；宿主的运行时绝不猜 `node_modules` 路径，因为实际安装布局并不等于本仓布局。面板的重放器走常规客户端 bundle（懒加载，且 bundle 被钉成单文件，模块加载器才拿得到它）。录制通道不需要任何产物：它的两段脚本就在 `src/core/capture.ts` 里现拼，面板播放器自己建 `MediaSource`。

## 界面席位

| 席位 | 类型 | 放什么 |
| --- | --- | --- |
| `sidebar.right.pane.tab` | keyed，session | 标签页内容 |
| `sidebar.right.pane.tab.title` | keyed，session | chip 的文字与图标 |

会话头部不再为该标签页提供入口：右栏自己的 tab strip 与 guide 胶囊已经能打开它，再加第三个入口只是挤占那一行。

标签页类型经 `ctx.sidebarRightTabs.register` 注册，用 `ctx.sidebarRight.openTabIn` 打开。它的 kind 是 `browser-view`，**刻意不是** `browser`：官方 `@deepseek-ai/dsh-client-ui-sidebar-browser` 占用了那个 kind，而 extension 档位会接管同名 kind，复用等于把官方那个标签页顶掉。

单占位的 `rightbar` / `rightbar.session` 仍然不碰：它们属于那一栏本身，不属于栏里的标签页。

## 安全模型

- **仅限 loopback**：面板 socket 以 loopback 围栏，非本机来源在升级之前就被拒绝。能建立 socket 的一方便能向被控页面发送输入（点击、键盘、滚轮），因此围栏与 CIDR 白名单的收敛原则是「只放行真正服务 GUI 的最小范围」。
- **CIDR 放宽是显式选项**：把 `DSH_BROWSER_VIEW_ALLOWED_CIDRS` 设为逗号分隔的 IPv4 CIDR 列表（例如 `192.168.1.0/24`）后，socket 地址落在列表范围内的请求可以进入面板 socket。放宽不豁免其余请求级门禁：带转发头（宿主前有代理或隧道）的请求仍然拒绝，跨站请求以及 Origin 与 Host 不匹配的请求同样拒绝。未设置或留空即维持原样，仅限 loopback。列出的范围意味着该网络可以驱动浏览器工具，因此只列真正服务 GUI 的最小范围；`::1` 始终允许，列表永远不会放行纯 IPv6 地址。
- **可信反代是独立且更窄的显式选项**：宿主前有反向代理时，转发头一票否决会让上面的 CIDR 放宽失效（代理会追加转发头并改写 Host）。三个变量全部设置才打开这条路：`DSH_BROWSER_VIEW_TRUSTED_PROXY_CIDRS` 声明代理的 socket 地址网段（例如 `127.0.0.1/32`），`DSH_BROWSER_VIEW_ALLOWED_CIDRS` 约束 `X-Forwarded-For` 最后一节的客户端地址，`DSH_BROWSER_VIEW_PUBLIC_ORIGIN` 声明浏览器实际使用的公开来源（逗号分隔可列多个，例如 `https://100.64.0.10:30082,https://10.76.144.1:30082`），请求的 Origin 必须与其一全等。缺任何一个变量这条路都保持关闭；跨站请求依旧拒绝。信任边界是真实的：信任网段内的主机可以伪造 `X-Forwarded-For` 冒充列表内的客户端，因此只把代理本体所在的最小网段列入信任，并确保代理到宿主的路径不出本机。
- **一次性 profile**：Chrome 跑在系统临时目录下全新的 `--user-data-dir` 上，调试端口随机，用户真实浏览器的 cookie、会话与扩展都够不着。
- **附着模式是显式选项且不碰你的浏览器**：把 `DSH_BROWSER_VIEW_ATTACH_PORT` 设为一个 DevTools 调试端口，插件就改为驱动那个已在运行的浏览器，而不是自己拉起一个。插件不会替你打开远程调试；需要操作者自己用 `--remote-debugging-port=<端口>` 在 loopback 地址上启动浏览器。附着模式下插件不会杀浏览器、不会碰任何 profile——dispose 只关闭插件自己创建的标签页和它自己的协议会话。代价是真实的：agent 开动的将是一个载着你登录态的浏览器，因此附着模式下每个 agent 工具只能操作调用会话经工具创建的标签页；外来目标（你自己的页面）会被拒绝并附上可用标签页列表，`browser_close` 只关本会话创建的标签页、绝不回落到其他动作。只为一个你接受 agent 在其中工作的浏览器 profile 开启附着模式。
- **默认无头**：桌面上不会弹出窗口，标签页是唯一的可见视图。
- **进程寿命**：拉起模式下插件卸载时杀掉 Chromium 子进程，会话关掉之后不会留下还在跑的东西；附着模式下浏览器本来就是你的，按设计比插件活得久。
- **令牌处理**：启动令牌每次导航现取、只在内存里，从不落盘；补票只发生在 loopback 目标且文档确实是 DSH 自己的鉴权页时，因此令牌不会被交给别的本地服务。

## 已知限制

- 标签页是**可交互视图**：点击、拖拽、滚轮与键盘会经面板回传到被控页面（宿主侧 Chromium），你的输入不经过任何 agent 会话；地址栏仍是只读的，导航依旧由 agent 工具或你在标签页选择里完成。
- 标签页住在右侧栏里，因此需要那一栏存在；布局把栏收起来时它也一起不可见。
- 帧在页面变化时才产生，静态页面停留在最后一帧，而不是重复推流。
- 切换 chip 时内容保持挂载（`keepMounted`），socket 不会断；画面仍等下一次变化。
- 补票只覆盖站点根地址，因为 DSH 只在 `GET /` 时以 303 回应鉴权提示。
- 一个宿主一个浏览器进程；标签页是相互隔离的 CDP target，不是独立 profile。
- Chrome 需装在标准位置，或用 `CHROME_PATH` 指定。
- 音频在三条通道上都是非目标：镜像只录 DOM，标签页录制只取视频（`audio: false`，容器里没有音频编码），所以 `<video>` 的声音永远不会被采集——浏览器还带着 `--mute-audio`。

## 安装

本仓是自包含 bundle，可直接从 GitHub 安装：

```sh
dsh plugin --profile web add git+https://github.com/jimorsm/dsh-browser-view
```

`lib/` 随仓库提交，安装期不跑任何构建脚本、无需 `allowBuilds` 放行；要冻结到某个
提交或 tag 就加 `#<ref>`。本地开发时改为克隆后链接检出目录：

```sh
dsh plugin --profile web add link:<本地检出目录>
```

插件行只在启动时读取，因此安装或改动之后需要重启一次 DSH。

未发布到 npm。上游项目以 `@linxin666/dsh-client-ui-browser-view` 发布同一插件，
**两者不可同时安装**——它们占用同一个插件行 id（`ui-browser-view`）与同一个右侧标签页
kind（`browser-view`），后装入 roster 的那个会静默生效。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 来源

Fork 自 [dsh-web](https://github.com/zhu1090093659/dsh-web) 的插件
`packages/dsh-browser-view`（上游包名 `@linxin666/dsh-client-ui-browser-view`，
版本 0.4.10），外加本 fork 自己的功能：面板输入回传、可选的可信反代 socket 围栏、
WebRTC DataChannel 画面传输。署名与许可见 [NOTICE](NOTICE)；上游包名与 npm scope
属于上游项目，本仓不使用。
