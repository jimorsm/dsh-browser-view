// @vitest-environment jsdom
/**
 * Tab body under jsdom: the placeholder states, frame rendering, the error
 * branch, the locale switch, the toolbar (address display, connection marker,
 * refresh), the controlled browser's tab chips, the page title it publishes for
 * its own chip, and the socket lifetime.
 *
 * The body is mounted the way the right sidebar mounts it - directly, with no
 * title bar and no back control of its own, filling the height it is given.
 */
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserViewPanel } from '../../src/client/panel.tsx'
import type { BrowserViewMirrorFactory, BrowserViewMirrorHandle } from '../../src/client/mirror.ts'
import type { BrowserViewCaptureFactory, BrowserViewCaptureHandle } from '../../src/client/capture.ts'
import { createLiveTitleStore } from '../../src/client/live-title.ts'
import { en, zh } from '../../src/client/locales.ts'
import { BROWSER_VIEW_API_VERSION } from '../../src/core/protocol.ts'
import type { BrowserPanelState } from '../../src/core/protocol.ts'
import { actOn, render, type RenderedTree } from './render.tsx'
import { translate } from './translate.ts'
import { createFakeSockets, type FakeSocketFixture } from './fake-socket.ts'

/** One tab as the host publishes it. */
const stateWithTab: BrowserPanelState = {
  tabs: [{ id: 'tab-1', url: 'https://example.test/checkout', title: 'Checkout', loading: false }],
  activeTabId: 'tab-1',
  running: true,
}

/** Two tabs, the first one active. */
const stateWithTwoTabs: BrowserPanelState = {
  tabs: [
    { id: 'tab-1', url: 'https://example.test/a', title: 'First', loading: false },
    { id: 'tab-2', url: 'https://example.test/b', title: 'Second', loading: true },
  ],
  activeTabId: 'tab-1',
  running: true,
}

/** One replayer the panel built, as the fake factory records it. */
interface FakeMirror {
  /** Element the replayer was mounted into. */
  readonly root: HTMLElement
  /** The checkpoint batch it was built from. */
  readonly events: ReadonlyArray<unknown>
  /** Events pushed into it after it was built. */
  readonly appended: unknown[]
  /** Whether the panel tore it down. */
  readonly destroyed: () => boolean
}

/** Recorded replayers and the factory that produced them. */
interface FakeMirrors {
  readonly factory: BrowserViewMirrorFactory
  readonly created: FakeMirror[]
}

/** A replayer factory that builds nothing and records everything. */
function createFakeMirrors(): FakeMirrors {
  const created: FakeMirror[] = []
  return {
    created,
    factory: (root, events): BrowserViewMirrorHandle => {
      let dead = false
      const mirror: FakeMirror = { root, events, appended: [], destroyed: () => dead }
      created.push(mirror)
      return {
        addEvent: (event) => { mirror.appended.push(event) },
        destroy: () => { dead = true },
      }
    },
  }
}

/** One capture player the panel built, as the fake factory records it. */
interface FakeCapture {
  /** Element the player was attached to. */
  readonly video: HTMLVideoElement
  /** Chunks pushed into it after it was built. */
  readonly appended: Uint8Array[]
  /** Whether the panel detached it. */
  readonly destroyed: () => boolean
}

/** Recorded capture players and the factory that produced them. */
interface FakeCaptures {
  readonly factory: BrowserViewCaptureFactory
  readonly created: FakeCapture[]
}

/** A capture factory that plays nothing and records everything. */
function createFakeCaptures(): FakeCaptures {
  const created: FakeCapture[] = []
  return {
    created,
    factory: (video): BrowserViewCaptureHandle => {
      let dead = false
      const player: FakeCapture = { video, appended: [], destroyed: () => dead }
      created.push(player)
      return {
        append: (chunk) => { player.appended.push(chunk) },
        destroy: () => { dead = true },
      }
    },
  }
}

/** Base64 for a short literal, the way the wire carries a recorder chunk. */
function base64(text: string): string {
  return btoa(text)
}

/** Mounted tree shared by one case. */
let tree: RenderedTree | null = null
/** Fake transport fixture shared by one case. */
let sockets: FakeSocketFixture
/** Title channel shared by one case, standing in for the plugin's own. */
let channel: ReturnType<typeof createLiveTitleStore>
/** Replayers built by the panel in one case. */
let mirrors: FakeMirrors
/** Capture players built by the panel in one case. */
let captures: FakeCaptures

/** Mount the body the way the sidebar does: as tab content, with no chrome of its own. */
function mountPanel(
  dictionary: Record<string, string> = zh,
  overrides: {
    readonly mirrorFactory?: BrowserViewMirrorFactory
    readonly captureFactory?: BrowserViewCaptureFactory
  } = {},
): RenderedTree {
  sockets = createFakeSockets()
  channel = createLiveTitleStore()
  mirrors = createFakeMirrors()
  captures = createFakeCaptures()
  const mounted = render(
    <BrowserViewPanel
      t={translate(dictionary)}
      sessionId="session-a"
      liveTitle={channel}
      socketFactory={sockets.factory}
      mirrorFactory={overrides.mirrorFactory ?? mirrors.factory}
      captureFactory={overrides.captureFactory ?? captures.factory}
    />,
  )
  tree = mounted
  return mounted
}

/**
 * Mount the body and put it on the capture lane, which takes two presses of the
 * cycling switch (pixels -> dom -> capture). The switch only works once the host
 * has reported a page, so this reports one.
 * @param dictionary - copy to render with.
 * @param overrides - player factory override.
 * @returns the mounted tree, already asking the host for the capture.
 */
function mountPanelOnCaptureLane(
  dictionary: Record<string, string> = zh,
  overrides: { readonly captureFactory?: BrowserViewCaptureFactory } = {},
): RenderedTree {
  const mounted = mountPanel(dictionary, overrides)
  actOn(() => {
    sockets.latest().pushStatus('open')
    sockets.latest().pushState(stateWithTab)
  })
  const mode = mounted.container.querySelector('[data-dsh-part="mode"]') as HTMLButtonElement
  actOn(() => { mode.click() })
  actOn(() => { mode.click() })
  return mounted
}

/** The capture lane's stage element, when the panel drew one. */
function captureStage(mounted: RenderedTree): HTMLVideoElement | null {
  return mounted.container.querySelector('[data-dsh-part="capture"]') as HTMLVideoElement | null
}

/**
 * Mount the body and put it on the mirror lane, which is no longer the default.
 * The switch only works once the host has reported a page, so this reports one.
 * @param dictionary - copy to render with.
 * @param overrides - replayer factory override.
 * @returns the mounted tree, already asking the host for the mirror.
 */
function mountPanelOnMirrorLane(
  dictionary: Record<string, string> = zh,
  overrides: { readonly mirrorFactory?: BrowserViewMirrorFactory } = {},
): RenderedTree {
  const mounted = mountPanel(dictionary, overrides)
  actOn(() => {
    sockets.latest().pushStatus('open')
    sockets.latest().pushState(stateWithTab)
  })
  const mode = mounted.container.querySelector('[data-dsh-part="mode"]') as HTMLButtonElement
  actOn(() => { mode.click() })
  return mounted
}

/** Run a callback inside act() and let the promises it starts settle. */
async function actAsync(run: () => void): Promise<void> {
  await act(async () => { run() })
}

/** Query one toolbar control by its accessible name. */
function toolbarButton(mounted: RenderedTree, label: string): HTMLButtonElement | null {
  return mounted.container.querySelector(`[data-dsh-part="toolbar"] button[aria-label="${label}"]`)
}

afterEach(() => {
  tree?.unmount()
  tree = null
  document.body.innerHTML = ''
})

describe('browser view tab body', () => {
  it('user sees the empty placeholder in a tab that carries no page title bar of its own', () => {
    // Given a body mounted with nothing pushed yet
    // When it renders with the Chinese dictionary
    // Then one plugin root carries the panel part, no heading or back control is drawn, the address field is empty and the placeholder explains what will appear
    const mounted = mountPanel()

    expect(mounted.container.querySelectorAll('[data-dsh-plugin="browser-view"]')).toHaveLength(1)
    expect(mounted.container.querySelectorAll('[data-dsh-part="panel"]')).toHaveLength(1)
    expect(mounted.container.querySelector('h1,h2,h3')).toBeNull()
    const emptyField = mounted.container.querySelector('[data-dsh-part="address"] input') as HTMLInputElement
    expect(emptyField.value).toBe('')
    expect(emptyField.getAttribute('placeholder')).toBe(zh['panel.url.empty'])
    expect(mounted.container.querySelector('[data-dsh-part="trace"]')?.textContent).toContain(zh['panel.trace.idle'])
    const empty = mounted.container.querySelector('[data-dsh-part="empty"]')
    expect(empty?.textContent).toContain(zh['panel.empty.title'])
    expect(empty?.textContent).toContain(zh['panel.empty.hint'])
    expect(mounted.container.querySelector('img')).toBeNull()
  })

  it('user sees the pushed JPEG frame replace the empty placeholder', () => {
    // Given a mounted body with a state push and one JPEG frame
    // When the frame arrives over the fake socket
    // Then one image carries the data url, the frame size, the localized alt text and the frame part, and the placeholder is gone
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState(stateWithTab)
      sockets.latest().pushFrame({ tabId: 'tab-1', seq: 4, width: 1280, height: 800, data: '/9j/4AAQSkZJRg==' })
    })

    const image = mounted.container.querySelector('img')
    expect(image?.getAttribute('alt')).toBe(zh['panel.frame.alt'])
    expect(image?.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==')
    expect(image?.getAttribute('width')).toBe('1280')
    expect(image?.getAttribute('height')).toBe('800')
    expect(mounted.container.querySelector('[data-dsh-part="empty"]')).toBeNull()
    expect(mounted.container.querySelectorAll('[data-dsh-part="frame"]')).toHaveLength(1)
  })

  it('user sees the host error instead of a stale frame', () => {
    // Given a mounted body that already painted a frame
    // When the host pushes an error code and message
    // Then the alert block carries the message and the code and no image stays on screen
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState(stateWithTab)
      sockets.latest().pushFrame({ tabId: 'tab-1', seq: 1, width: 1280, height: 800, data: 'AAAA' })
      sockets.latest().pushError('chrome-missing', 'Chrome could not be started')
    })

    const error = mounted.container.querySelector('[data-dsh-part="error"]')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(error?.textContent).toContain(zh['panel.error.title'])
    expect(error?.textContent).toContain('Chrome could not be started')
    expect(error?.textContent).toContain('chrome-missing')
    expect(mounted.container.querySelector('img')).toBeNull()
  })

  it('user sees the message a state push substitutes for the frame', () => {
    // Given a mounted body with no frame painted
    // When a state push carries a message
    // Then the alert block shows that message and renders no error code span
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState({ ...stateWithTab, message: 'The browser process exited' })
    })

    const error = mounted.container.querySelector('[data-dsh-part="error"]')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(error?.querySelectorAll('span')).toHaveLength(2)
    expect(error?.textContent).toContain('The browser process exited')
  })

  it('user sees the action trace of the running tool', () => {
    // Given a mounted body with an idle trace
    // When an action trace for a click arrives
    // Then the trace region shows the tool name and its summary
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushAction({ tool: 'click', summary: 'Clicked the submit button', at: 1_700_000_000_000 })
    })

    const trace = mounted.container.querySelector('[data-dsh-part="trace"]')
    expect(trace?.textContent).toContain('click')
    expect(trace?.textContent).toContain('Clicked the submit button')
  })

  it('user reads the current URL of the streaming tab in a read-only address field', () => {
    // Given a mounted body and one page opened by the agent
    // When the state push names that page
    // Then the address field shows the address read-only, keeps the whole string on its title, and the empty-state hint is gone
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState(stateWithTab)
    })

    const field = mounted.container.querySelector('[data-dsh-part="address"] input') as HTMLInputElement
    expect(field.value).toBe('https://example.test/checkout')
    expect(field.readOnly).toBe(true)
    expect(field.getAttribute('title')).toBe('https://example.test/checkout')
    expect(field.getAttribute('aria-label')).toBe(zh['panel.address.label'])
    expect(mounted.container.textContent).not.toContain(zh['panel.url.empty'])
  })

  it('user clicks the address field and the whole address is selected for copying', () => {
    // Given a mounted body showing one page
    // When the read-only address field is clicked
    // Then its whole value is selected, so the address is one copy gesture away
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState(stateWithTab)
    })

    const field = mounted.container.querySelector('[data-dsh-part="address"] input') as HTMLInputElement
    actOn(() => { field.click() })

    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe('https://example.test/checkout'.length)
  })

  it('operator refreshes the captured frame and the host is asked for a new one', () => {
    // Given a mounted body streaming a page
    // When the refresh control is clicked
    // Then the host receives one request-frame command
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState(stateWithTab)
    })

    const refresh = toolbarButton(mounted, zh['panel.toolbar.refresh'])
    expect(refresh?.disabled).toBe(false)

    actOn(() => { refresh?.click() })

    expect(sockets.latest().sent).toContainEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'request-frame' })
  })

  it('operator cannot refresh before the host reported a page', () => {
    // Given a mounted body with no page
    // When the toolbar is drawn
    // Then the refresh control is disabled and clicking it sends no command
    const mounted = mountPanel()
    const refresh = toolbarButton(mounted, zh['panel.toolbar.refresh'])

    expect(refresh?.disabled).toBe(true)
    actOn(() => { refresh?.click() })

    expect(sockets.latest().sent).toEqual([])
  })

  it('user sees only the capabilities this tab has in its toolbar', () => {
    // Given a mounted body streaming a page
    // When the toolbar is drawn
    // Then its controls are the lane switch and the frame refresh - no back, forward, page reload or external-open control
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState(stateWithTab)
    })

    const labels = Array.from(mounted.container.querySelectorAll('[data-dsh-part="toolbar"] button'))
      .map((button) => button.getAttribute('aria-label'))
    expect(labels).toEqual([zh['panel.mode.switch'], zh['panel.toolbar.refresh']])
  })

  it('user reads the connection state of the panel in the toolbar marker', () => {
    // Given a mounted body that has not reached the host yet
    // When the socket reports an open connection and then a loading page
    // Then the marker names connecting, live and loading in turn from the existing status copy, and the product state dot follows the same three phases
    const mounted = mountPanel()
    const marker = (): string =>
      mounted.container.querySelector('[data-dsh-part="status"]')?.textContent ?? ''
    const dot = (): string | null =>
      mounted.container.querySelector('[data-dsh-part="status"] [data-state]')?.getAttribute('data-state') ?? null

    expect(marker()).toContain(zh['panel.status.connecting'])
    expect(dot()).toBe('idle')

    actOn(() => { sockets.latest().pushStatus('open') })
    expect(marker()).toContain(zh['panel.status.live'])
    expect(dot()).toBe('done')

    actOn(() => { sockets.latest().pushState(stateWithTwoTabs) })
    expect(marker()).toContain(zh['panel.status.live'])
    expect(dot()).toBe('done')

    actOn(() => {
      sockets.latest().pushState({ ...stateWithTab, tabs: [{ ...stateWithTab.tabs[0], loading: true }] })
    })
    expect(marker()).toContain(zh['panel.status.loading'])
    expect(dot()).toBe('ongoing')
  })

  it('user switches language and every string of the tab follows', () => {
    // Given a body mounted with the Chinese dictionary
    // When it re-renders with the English dictionary
    // Then the English copy is present and the Chinese one is gone
    const mounted = mountPanel(zh)
    expect(mounted.container.textContent).toContain(zh['panel.empty.title'])

    mounted.rerender(
      <BrowserViewPanel t={translate(en)} sessionId="session-a" liveTitle={channel} socketFactory={sockets.factory} />,
    )

    expect(mounted.container.textContent).toContain(en['panel.empty.title'])
    expect(mounted.container.textContent).not.toContain(zh['panel.empty.title'])
  })

  it('user clicks a tab chip and the host is asked to stream that page', () => {
    // Given a mounted body that received two pages
    // When the second chip is clicked
    // Then a select-tab command names the second page and the first chip stays the selected one
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState(stateWithTwoTabs)
    })

    const tabs = mounted.container.querySelectorAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    actOn(() => { (tabs[1] as HTMLButtonElement).click() })

    expect(sockets.latest().sent).toContainEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'select-tab', tabId: 'tab-2' })
  })

  it('user sees no chip row when the agent drives a single page', () => {
    // Given a mounted body streaming one page
    // When the toolbar and the body are drawn
    // Then no chip row appears, so the tab keeps the shipped browser tab's structure
    const mounted = mountPanel()

    actOn(() => {
      sockets.latest().pushState(stateWithTab)
    })

    expect(mounted.container.querySelector('[role="tablist"]')).toBeNull()
    expect(mounted.container.querySelectorAll('[data-dsh-part="panel"] > *')).toHaveLength(3)
  })

  it('user sees the chip name the page, published by the body that streams it', () => {
    // Given a mounted body whose chip channel holds nothing yet
    // When the page title arrives and the tab is later unmounted
    // Then the channel carries the page title while mounted and nothing after the tab is gone
    const mounted = mountPanel()

    actOn(() => { sockets.latest().pushState(stateWithTab) })
    expect(channel.get('session-a')).toBe('Checkout')

    mounted.unmount()
    tree = null

    expect(channel.get('session-a')).toBeUndefined()
  })

  it('operator closes the tab and the body closes its socket', () => {
    // Given a mounted body with an open connection
    // When the sidebar unmounts the tab because another chip was selected and this one was closed
    // Then that connection is closed and no socket is left behind
    const mounted = mountPanel()
    expect(sockets.sockets).toHaveLength(1)

    mounted.unmount()
    tree = null

    expect(sockets.latest().closed()).toBe(true)
  })
})

describe('browser view lane switch and DOM mirror', () => {
  it('user opens the panel and the pixel lane is the lane it asks for', () => {
    // Given a mounted body that has not reached the host yet
    const mounted = mountPanel()

    // When the socket reports its connection open
    actOn(() => { sockets.latest().pushStatus('open') })

    // Then the host is asked for the lane that draws any page, not for the
    // mirror nobody asked for, and the switch shows which lane is on
    expect(sockets.latest().sent).toContainEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'pixels' })
    const mode = mounted.container.querySelector('[data-dsh-part="mode"]')
    expect(mode?.getAttribute('data-mode')).toBe('pixels')
    expect(mode?.textContent).toBe(zh['panel.mode.pixels'])
  })

  it('user switches to the mirror lane and the host is told', () => {
    // Given a mounted body on the pixel lane, which is where a panel now starts
    const mounted = mountPanel()
    actOn(() => {
      sockets.latest().pushStatus('open')
      sockets.latest().pushState(stateWithTab)
    })

    // When the lane switch is pressed
    const mode = mounted.container.querySelector('[data-dsh-part="mode"]') as HTMLButtonElement
    actOn(() => { mode.click() })

    // Then the host receives the mirror lane and the switch names it
    expect(sockets.latest().sent).toContainEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'dom' })
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.getAttribute('data-mode')).toBe('dom')
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.textContent).toBe(zh['panel.mode.dom'])
  })

  it('user cannot switch lanes before the host reported a page', () => {
    // Given a mounted body with no page
    const mounted = mountPanel()

    // When the toolbar is drawn and the switch is pressed
    const mode = mounted.container.querySelector('[data-dsh-part="mode"]') as HTMLButtonElement
    expect(mode.disabled).toBe(true)
    actOn(() => { mode.click() })

    // Then no lane command was sent
    expect(sockets.latest().sent.filter(command => command.kind === 'mode')).toEqual([])
  })

  it('a recording arrives and the mirror replaces the pixel stage', async () => {
    // Given a mounted body drawing a frame on the mirror lane
    const mounted = mountPanelOnMirrorLane()
    actOn(() => {
      sockets.latest().pushState(stateWithTab)
      sockets.latest().pushFrame({ tabId: 'tab-1', seq: 1, width: 1280, height: 800, data: 'AAAA' })
    })
    expect(mounted.container.querySelector('[data-dsh-part="frame"]')).not.toBeNull()

    // When a checkpoint batch arrives
    await actAsync(() => {
      sockets.latest().pushDom({ tabId: 'tab-1', seq: 1, reset: true, events: [{ type: 4 }, { type: 2 }] })
    })

    // Then the replayer was built from that batch, mounted into the mirror
    // stage, and the picture it replaces is gone
    expect(mirrors.created).toHaveLength(1)
    expect(mirrors.created[0].events).toEqual([{ type: 4 }, { type: 2 }])
    expect(mirrors.created[0].root).toBe(mounted.container.querySelector('[data-dsh-part="mirror"]'))
    expect(mounted.container.querySelector('[data-dsh-part="frame"]')).toBeNull()
  })

  it('a live event arrives and it is pushed into the running replay without a rebuild', async () => {
    // Given a mounted body whose mirror was built from a checkpoint
    const mounted = mountPanelOnMirrorLane()
    actOn(() => { sockets.latest().pushState(stateWithTab) })
    await actAsync(() => {
      sockets.latest().pushDom({ tabId: 'tab-1', seq: 1, reset: true, events: [{ type: 2 }] })
    })

    // When one incremental batch arrives
    await actAsync(() => {
      sockets.latest().pushDom({ tabId: 'tab-1', seq: 2, reset: false, events: [{ type: 3 }, { type: 3 }] })
    })

    // Then the same replayer received both events and no second one was built
    expect(mirrors.created).toHaveLength(1)
    expect(mirrors.created[0].appended).toEqual([{ type: 3 }, { type: 3 }])
    expect(mounted.container.querySelector('[data-dsh-part="frame"]')).toBeNull()
  })

  it('a batch for a tab the panel already left is ignored', async () => {
    // Given a mounted body watching one page
    const mounted = mountPanelOnMirrorLane()
    actOn(() => { sockets.latest().pushState(stateWithTab) })

    // When a recording arrives for a different tab
    await actAsync(() => {
      sockets.latest().pushDom({ tabId: 'tab-other', seq: 1, reset: true, events: [{ type: 2 }] })
    })

    // Then nothing was built for it
    expect(mirrors.created).toHaveLength(0)
    expect(mounted.container.querySelector('[data-dsh-part="mirror"]')).not.toBeNull()
  })

  it('the host reports the mirror unavailable and the panel moves to pixels with the reason', () => {
    // Given a mounted body on the mirror lane with a page open
    const mounted = mountPanelOnMirrorLane()

    // When the host reports the mirror of that tab as unavailable
    actOn(() => {
      sockets.latest().pushMirror({ tabId: 'tab-1', available: false, reason: 'the page forbids eval' })
    })

    // Then the pixel lane is shown, the reason is on screen, and the host is not
    // asked again - it already moved this panel
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.getAttribute('data-mode')).toBe('pixels')
    expect(mounted.container.querySelector('[data-dsh-part="mirror-notice"]')?.textContent)
      .toContain('the page forbids eval')
    expect(sockets.latest().sent.filter(command => command.kind === 'mode')).toEqual([
      { v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'pixels' },
      { v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'dom' },
    ])
  })

  it('the replayer cannot be built and the panel falls back to pixels with the failure', async () => {
    // Given a mounted body whose replayer throws when it is built
    const mounted = mountPanelOnMirrorLane(zh, { mirrorFactory: () => { throw new Error('rrweb could not be loaded') } })
    actOn(() => { sockets.latest().pushState(stateWithTab) })

    // When a recording arrives
    await actAsync(() => {
      sockets.latest().pushDom({ tabId: 'tab-1', seq: 1, reset: true, events: [{ type: 2 }] })
    })

    // Then the panel tells the host to send pixels again and shows why
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.getAttribute('data-mode')).toBe('pixels')
    expect(mounted.container.querySelector('[data-dsh-part="mirror-notice"]')?.textContent)
      .toContain('rrweb could not be loaded')
    expect(sockets.latest().sent.filter(command => command.kind === 'mode').at(-1))
      .toEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'pixels' })
  })

  it('user switches back to the mirror after a fallback and the notice goes away', () => {
    // Given a body whose mirror the host has just reported unavailable, so it
    // fell back to the pixel lane with a notice
    const mounted = mountPanelOnMirrorLane()
    actOn(() => {
      sockets.latest().pushState(stateWithTab)
      sockets.latest().pushMirror({ tabId: 'tab-1', available: false, reason: 'the page forbids eval' })
    })
    expect(mounted.container.querySelector('[data-dsh-part="mirror-notice"]')).not.toBeNull()

    // When the person asks for the mirror again
    const mode = mounted.container.querySelector('[data-dsh-part="mode"]') as HTMLButtonElement
    actOn(() => { mode.click() })

    // Then the lane is the mirror again, the notice is gone, and the host is asked
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.getAttribute('data-mode')).toBe('dom')
    expect(mounted.container.querySelector('[data-dsh-part="mirror-notice"]')).toBeNull()
    expect(sockets.latest().sent).toContainEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'dom' })
  })

  it('user closes the panel and the running replay is torn down', async () => {
    // Given a mounted body with a running replay
    const mounted = mountPanelOnMirrorLane()
    actOn(() => { sockets.latest().pushState(stateWithTab) })
    await actAsync(() => {
      sockets.latest().pushDom({ tabId: 'tab-1', seq: 1, reset: true, events: [{ type: 2 }] })
    })
    expect(mirrors.created).toHaveLength(1)

    // When the tab is closed
    mounted.unmount()
    tree = null

    // Then the replayer released its DOM
    expect(mirrors.created[0].destroyed()).toBe(true)
  })

  it('user loads the tab body with the English dictionary and the lane switch follows', () => {
    // Given a body mounted with the English dictionary
    const mounted = mountPanel(en)

    // When the toolbar is drawn
    // Then the switch is named in English rather than in the source language
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.textContent).toBe(en['panel.mode.pixels'])
  })
})

describe('browser view lane switch and tab capture', () => {
  it('user presses the switch twice and the host is asked for the tab capture', () => {
    // Given a mounted body on the pixel lane, which is where a panel starts
    const mounted = mountPanel()
    actOn(() => {
      sockets.latest().pushStatus('open')
      sockets.latest().pushState(stateWithTab)
    })
    const mode = mounted.container.querySelector('[data-dsh-part="mode"]') as HTMLButtonElement

    // When the switch is pressed twice, cycling through the mirror
    actOn(() => { mode.click() })
    actOn(() => { mode.click() })

    // Then the host receives both lanes in order and the switch names the capture
    expect(sockets.latest().sent.filter(command => command.kind === 'mode')).toEqual([
      { v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'pixels' },
      { v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'dom' },
      { v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'capture' },
    ])
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.getAttribute('data-mode')).toBe('capture')
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.textContent).toBe(zh['panel.mode.capture'])
  })

  it('user presses the switch once more and it wraps back to the pixel lane', () => {
    // Given a body on the capture lane
    const mounted = mountPanelOnCaptureLane()

    // When the switch is pressed again
    const mode = mounted.container.querySelector('[data-dsh-part="mode"]') as HTMLButtonElement
    actOn(() => { mode.click() })

    // Then the lane is the one that draws any page, and the host is told
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.getAttribute('data-mode')).toBe('pixels')
    expect(sockets.latest().sent.filter(command => command.kind === 'mode').at(-1))
      .toEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'pixels' })
  })

  it('a recording header arrives and the capture player replaces the pixel stage', async () => {
    // Given a body on the capture lane still showing the pixel picture
    const mounted = mountPanelOnCaptureLane()
    actOn(() => {
      sockets.latest().pushState(stateWithTab)
      sockets.latest().pushFrame({ tabId: 'tab-1', seq: 1, width: 1280, height: 800, data: 'AAAA' })
    })
    expect(mounted.container.querySelector('[data-dsh-part="frame"]')).not.toBeNull()

    // When a reset chunk arrives
    await actAsync(() => {
      sockets.latest().pushCaptureChunk({
        tabId: 'tab-1', seq: 1, reset: true, mime: 'video/webm;codecs=vp8', data: base64('HEADER'),
      })
    })

    // Then the player was built over the capture stage, the header was appended
    // to it, and the picture it replaces is gone
    expect(captures.created).toHaveLength(1)
    expect(captures.created[0].video).toBe(captureStage(mounted))
    expect(Array.from(captures.created[0].appended[0] ?? [])).toEqual(Array.from(new TextEncoder().encode('HEADER')))
    expect(mounted.container.querySelector('[data-dsh-part="frame"]')).toBeNull()
  })

  it('a live chunk arrives and it is appended without a rebuild', async () => {
    // Given a body whose player was built from a header chunk
    const mounted = mountPanelOnCaptureLane()
    actOn(() => { sockets.latest().pushState(stateWithTab) })
    await actAsync(() => {
      sockets.latest().pushCaptureChunk({
        tabId: 'tab-1', seq: 1, reset: true, mime: 'video/webm;codecs=vp8', data: base64('HEADER'),
      })
    })

    // When one more chunk arrives
    await actAsync(() => {
      sockets.latest().pushCaptureChunk({
        tabId: 'tab-1', seq: 2, reset: false, mime: 'video/webm;codecs=vp8', data: base64('CLUSTER'),
      })
    })

    // Then the same player received both and no second one was built
    expect(captures.created).toHaveLength(1)
    expect(captures.created[0].appended).toHaveLength(2)
    expect(Array.from(captures.created[0].appended[1] ?? [])).toEqual(Array.from(new TextEncoder().encode('CLUSTER')))
  })

  it('a chunk for a tab the panel already left is ignored', async () => {
    // Given a body on the capture lane watching one page
    const mounted = mountPanelOnCaptureLane()
    actOn(() => { sockets.latest().pushState(stateWithTab) })

    // When a recording arrives for a different tab
    await actAsync(() => {
      sockets.latest().pushCaptureChunk({
        tabId: 'tab-other', seq: 1, reset: true, mime: 'video/webm;codecs=vp8', data: base64('HEADER'),
      })
    })

    // Then nothing was built for it and the stage is still there for its own tab
    expect(captures.created).toHaveLength(0)
    expect(captureStage(mounted)).not.toBeNull()
  })

  it('the host reports the capture unavailable and the panel moves to pixels with the reason', () => {
    // Given a body on the capture lane with a page open
    const mounted = mountPanelOnCaptureLane()

    // When the host reports the capture of that tab as unavailable
    actOn(() => {
      sockets.latest().pushCapture({ tabId: 'tab-1', available: false, reason: 'permission denied' })
    })

    // Then the pixel lane is shown, the reason is on screen, and the host is not
    // asked again - it already moved this sink
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.getAttribute('data-mode')).toBe('pixels')
    expect(mounted.container.querySelector('[data-dsh-part="capture-notice"]')?.textContent)
      .toContain('permission denied')
    expect(sockets.latest().sent.filter(command => command.kind === 'mode').at(-1))
      .toEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'capture' })
  })

  it('the capture player cannot be built and the panel falls back to pixels with the failure', async () => {
    // Given a body whose player throws when it is built
    const mounted = mountPanelOnCaptureLane(zh, {
      captureFactory: () => { throw new Error('this browser cannot play video/webm;codecs=vp8 through MSE') },
    })
    actOn(() => { sockets.latest().pushState(stateWithTab) })

    // When a recording header arrives
    await actAsync(() => {
      sockets.latest().pushCaptureChunk({
        tabId: 'tab-1', seq: 1, reset: true, mime: 'video/webm;codecs=vp8', data: base64('HEADER'),
      })
    })

    // Then the panel tells the host to send pixels again and shows why
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.getAttribute('data-mode')).toBe('pixels')
    expect(mounted.container.querySelector('[data-dsh-part="capture-notice"]')?.textContent)
      .toContain('cannot play video/webm;codecs=vp8')
    expect(sockets.latest().sent.filter(command => command.kind === 'mode').at(-1))
      .toEqual({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'pixels' })
  })

  it('user switches lanes after a capture fallback and the notice goes away', () => {
    // Given a body whose capture the host has just reported unavailable
    const mounted = mountPanelOnCaptureLane()
    actOn(() => {
      sockets.latest().pushState(stateWithTab)
      sockets.latest().pushCapture({ tabId: 'tab-1', available: false, reason: 'permission denied' })
    })
    expect(mounted.container.querySelector('[data-dsh-part="capture-notice"]')).not.toBeNull()

    // When the person presses the switch again
    const mode = mounted.container.querySelector('[data-dsh-part="mode"]') as HTMLButtonElement
    actOn(() => { mode.click() })

    // Then the notice is gone, because it described a lane that is no longer chosen
    expect(mounted.container.querySelector('[data-dsh-part="capture-notice"]')).toBeNull()
  })

  it('user closes the panel and the running capture player is torn down', async () => {
    // Given a mounted body with a running player
    const mounted = mountPanelOnCaptureLane()
    actOn(() => { sockets.latest().pushState(stateWithTab) })
    await actAsync(() => {
      sockets.latest().pushCaptureChunk({
        tabId: 'tab-1', seq: 1, reset: true, mime: 'video/webm;codecs=vp8', data: base64('HEADER'),
      })
    })
    expect(captures.created).toHaveLength(1)

    // When the tab is closed
    mounted.unmount()
    tree = null

    // Then the player released its element
    expect(captures.created[0].destroyed()).toBe(true)
  })

  it('user loads the tab body with the English dictionary and the capture label follows', () => {
    // Given a body mounted with the English dictionary
    const mounted = mountPanelOnCaptureLane(en)

    // When the switch is drawn on the capture lane
    // Then it is named in English rather than in the source language
    expect(mounted.container.querySelector('[data-dsh-part="mode"]')?.textContent).toBe(en['panel.mode.capture'])
  })
})
