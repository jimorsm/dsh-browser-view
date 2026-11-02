/**
 * Locale dictionaries for the browser-view plugin. `zh` is the key-set source
 * of truth; `en` keeps a full key-for-key mirror (packages/AGENTS.md bilingual
 * rules). Registered through ctx.locale.register(NS, { zh, en }); the components
 * read every string through the injected `t` seat, so no copy is hardcoded in
 * JSX.
 *
 * The page-title keys are gone with the page header: a right-sidebar tab is
 * named by the shell's chip, and the chip's text comes from the tab type and
 * the published page title instead ('panel.title' / 'panel.close' had no
 * reader left once the "back to the conversation" control was removed).
 *
 * 'panel.tabs.empty' went with the always-drawn tab strip: the controlled
 * browser's chips now appear only when it holds more than one page, so there is
 * no empty strip left to caption.
 *
 * The lane switch needs its own words rather than one label: the control has to
 * name what is on screen now ('panel.mode.dom' / 'panel.mode.pixels' /
 * 'panel.mode.capture'), say what pressing it does ('panel.mode.switch'), and
 * account for a lane that could not start ('panel.mirror.starting' /
 * 'panel.capture.starting' and the two '…unavailable' sentence prefixes, because
 * the host's own reason is appended to each).
 */

/** Simplified Chinese dictionary (key-set source of truth). */
export const zh = {
  'tab.title': '浏览器视图',
  'guide.description': '看 agent 正在操作的网页',
  'panel.tab.untitled': '未命名页面',
  'panel.url.empty': '还没有打开页面',
  'panel.address.label': '页面地址',
  'panel.toolbar.refresh': '刷新画面',
  'panel.mode.dom': '文字',
  'panel.mode.pixels': '像素',
  'panel.mode.capture': '视频',
  'panel.mode.switch': '切换显示模式（像素画面 / 文字镜像 / 标签页视频）',
  'panel.frame.alt': 'agent 正在操作的页面画面',
  'panel.empty.title': '还没有画面',
  'panel.empty.hint': '让 agent 打开一个页面后，这里会实时显示它正在看的网页。',
  'panel.mirror.starting': '正在建立文字镜像…',
  'panel.mirror.unavailable': '文字镜像不可用，已切换到像素画面：',
  'panel.capture.starting': '正在开始标签页录制…',
  'panel.capture.unavailable': '标签页录制不可用，已切换到像素画面：',
  'panel.error.title': '浏览器视图出错',
  'panel.trace.idle': '暂无工具动作',
  'panel.status.connecting': '正在连接',
  'panel.status.loading': '加载中',
  'panel.status.live': '实时',
}

/** The browser-view namespace key union. */
export type BrowserViewKey = keyof typeof zh

/** English dictionary, key-for-key complete against zh. */
export const en: Record<BrowserViewKey, string> = {
  'tab.title': 'Browser view',
  'guide.description': 'Watch the page the agent is driving',
  'panel.tab.untitled': 'Untitled page',
  'panel.url.empty': 'No page open yet',
  'panel.address.label': 'Page address',
  'panel.toolbar.refresh': 'Refresh the frame',
  'panel.mode.dom': 'Text',
  'panel.mode.pixels': 'Pixels',
  'panel.mode.capture': 'Video',
  'panel.mode.switch': 'Switch the view mode (pixel stream, DOM mirror or tab capture)',
  'panel.frame.alt': 'Live view of the page the agent is driving',
  'panel.empty.title': 'No frames yet',
  'panel.empty.hint': 'Once the agent opens a page, this tab shows the page it is looking at.',
  'panel.mirror.starting': 'Building the DOM mirror…',
  'panel.mirror.unavailable': 'The DOM mirror is unavailable; showing the pixel stream instead: ',
  'panel.capture.starting': 'Starting the tab capture…',
  'panel.capture.unavailable': 'The tab capture is unavailable; showing the pixel stream instead: ',
  'panel.error.title': 'Browser view error',
  'panel.trace.idle': 'No tool actions yet',
  'panel.status.connecting': 'Connecting',
  'panel.status.loading': 'Loading',
  'panel.status.live': 'Live',
}
