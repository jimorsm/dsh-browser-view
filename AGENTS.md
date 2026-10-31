# AGENTS.md - dsh-browser-view

Standalone community plugin repository. This file carries only what is specific
to this package; the upstream dsh-web monorepo rules do not apply here.

## 本包要点

- 双半区职责：`src/index.ts` + `src/host/` 掌管 Chrome 进程、CDP 会话、标签页与
  WebSocket 分发；`src/client/` 只画帧与状态，不解析 devtools 协议。
- `src/core/protocol.ts` 是两侧唯一的线上契约（事件、命令、数据结构、版本号与
  校验函数）。改它等于同时改两侧：先改契约，再让两侧对齐，不要各自加字段。
- 席位：`sidebar.right.pane.tab`（keyed/session，标签页内容）、
  `sidebar.right.pane.tab.title`（keyed/session，chip 文字与图标）。会话头部
  **不再**有入口；不要再加回来。
- 标签页类型经 `ctx.sidebarRightTabs.register` 注册，`kind` 固定为
  `browser-view`。**禁止**改成 `browser`：官方
  `@deepseek-ai/dsh-client-ui-sidebar-browser` 占用该 kind。
- **禁止**注册 `rightbar` / `rightbar.session`（那一栏本身的单占位，已被官方占用）。
- 面板是右栏标签页，不是浮层也不是中央页面：不要引入 `position: fixed`、自管显隐或
  `main` / `sidebar.panellist` 注册；`keepMounted` 必须保持开启，切 chip 不能断 socket。
- 面板承载的是**帧**，不是 iframe。
- 帧预算与暂停：`service.withinFrameBudget` 限制帧间隔（空闲 66ms ≈15fps，任一 `input`
  后 3 秒内 33ms ≈30fps）；面板不可见时发 `stream{enabled:false}`，宿主把该 sink 移入
  `paused`（不广播），最后一个可见 sink 离开即 `stopScreencast`，恢复时补一帧。改动
  这两个阈值或暂停语义时，`tests/host/service.spec.ts` 的「stream budget and idle panels」
  是契约面。测试用固定时钟必须注入 `frameIntervalMs`，否则第一帧之后全被预算吞掉。
- 帧编码与采集盒：默认 WebP + 质量 50，采集 1024×640（视口仍 1280×800）；
  `TabManager.toViewport` 负责把面板来的帧坐标放大回视口坐标——**改采集盒必须同时保有
  这个换算**，否则点击会整体偏移。
- 帧分块：`chunkFrame`（`src/host/rtc.ts`）与 `FrameAssembler`（`src/client/frame-assembly.ts`）
  是同一份 `[u32 seq][u8 idx][u8 count]` 契约的两半，`tests/host/rtc.spec.ts` 用两者互相验证。
  DataChannel 单条消息上限 64 KiB，超过单块上限的帧必须分块；`sendFrame` 返回 false 时
  `broadcast` 只降级该帧到 WS 并 dispose 该 relay，**绝不删除 sink**（删 sink 会让面板永久冻结）。
- 帧传输双路：WS（JSON+base64）是保底，面板发起 WebRTC DataChannel（不可靠不保序）
  提升后走二进制帧（4 字节 seq + JPEG）；host 侧实现在 `src/host/rtc.ts`（werift，
  零原生依赖），service 按 sink 过滤 frame 事件，relay 打开即不走 WS。控制面永远在
  WS 上；任何失败自动回退，不新增开关。
- 输入回传：面板可把指针/键盘/滚轮手势经 `input` 命令回传（host 转 CDP `Input.*`，
  判定在 `TabManager.dispatchInput`）。契约新增命令类型时版本号保持不变的前提是
  旧面板不会发新命令、新面板对旧 host 只会换来单帧 invalid-command 错误；破坏该
  前提才递增 `BROWSER_VIEW_API_VERSION`。能连 socket 即能发输入，安全模型随围栏。
- 构建：`build/tsdown.client.ts` 与 `build/web-platform.ts` 是从上游 dsh-web 的
  `shared/` 逐字 vendored 的构建预设（本仓不依赖上游 monorepo 检出，见 NOTICE）。
  改这两个文件等于把上游预设本地分叉，同步上游时要显式对齐。

## 安全语义

- 面板 socket 默认只允许 loopback；非本机请求在升级前即拒绝。
  `DSH_BROWSER_VIEW_ALLOWED_CIDRS`（逗号分隔 IPv4 CIDR）是显式放宽：命中的
  远端地址按同一组请求级门禁放行（转发头依旧一票否决，跨站与跨源依旧拒绝）；
  未设置或留空即逐字节保持原行为，解析失败的条目要报错而不是静默忽略
  （`src/host/cidr.ts` 组合 `src/host/loopback.ts`）。
- 可信反代是第二条独立放宽，三个变量缺一不开：
  `DSH_BROWSER_VIEW_TRUSTED_PROXY_CIDRS`（代理 socket 网段）+
  `DSH_BROWSER_VIEW_ALLOWED_CIDRS`（约束 XFF 最后一节的客户端地址）+
  `DSH_BROWSER_VIEW_PUBLIC_ORIGIN`（逗号分隔多来源，Origin 必须与其一全等，替代被代理改写的
  Host 同源校验）。判定在 `requestAllowedThroughProxy`；跨站依旧拒绝，任一
  变量缺失时转发请求照旧一票否决。改这条路径必须同步 README 双语「安全模型」
  与本节，并保持「默认全关、显式才开」的姿态。
- 拉起模式（默认）：Chrome 用系统临时目录下的一次性 `--user-data-dir` 与随机
  调试端口启动；不得改为接管用户已登录的浏览器配置目录。
- 附着模式（`DSH_BROWSER_VIEW_ATTACH_PORT` 设为非空端口）：插件不拉起
  Chromium，改为向 `http://127.0.0.1:<port>/json/version` 取
  `webSocketDebuggerUrl` 走既有 CDP 路径（`src/core/browser.ts` 的
  `resolveBrowserHandle` 是唯一分岔点）。失败信息必须带端口与最后的具体原因。
  附着模式下 dispose 绝不杀浏览器、绝不碰任何 profile：只关闭本插件经
  `Target.createTarget` 创建的标签页与自己的 CDP 会话。
- 附着模式下的工具范围：每个会话只能操作它自己创建的标签页（allowlist 即
  TabManager 记录的 ownerSessionId），外来目标报错并列出可用标签页；
  `browser_close` 只关本会话创建的标签页，无任何回落路径。
- 插件 dispose 时必须按模式收尾：拉起模式杀掉 Chromium 子进程并停掉投屏，
  附着模式只关自己的标签页与会话。
- 截图只经宿主附件服务（`ctx.get('attachments').saveImage`）落盘；除此之外不得把
  截图副本、页面文本或控制台内容写进插件自有目录、日志或缓存。附件服务缺席时
  `browser_screenshot` 必须报错，不得伪造图片或改走临时文件。
- 鉴权补票（`src/host/auth.ts`）：只对 loopback 目标、且文档确实是 DSH 自己的鉴权页
  时才向 `ctx.connection.authenticatedUrl` 取令牌，每次导航最多补一次；无 connection
  服务、取票抛错、补票后仍是鉴权页都必须**静默退化**。令牌只经内存流转，不落盘。

## 提交前检查

```sh
pnpm typecheck
pnpm test
pnpm build
```
