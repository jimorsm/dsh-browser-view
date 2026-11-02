/**
 * Service tests: laziness, per-session tab binding, the broadcast fan-out, the
 * panel commands, and the shutdown order. The browser itself is the fake
 * session from tests/helpers/fake-browser.ts.
 */

import { describe, expect, it } from 'vitest'
import type { BrowserViewEvent } from '../../src/core/protocol.ts'
import type { BrowserViewSink } from '../../src/host/service.ts'
import { createFakeBrowser } from '../helpers/fake-browser.ts'

/**
 * A sink that records every event it is handed.
 * @param bufferedAmount - transport backlog the sink reports, when a test is
 * about the capture lane's queue bound rather than about delivery.
 */
function recordingSink(
  bufferedAmount?: () => number,
): { sink: BrowserViewSink; events: BrowserViewEvent[]; closed: () => boolean } {
  const events: BrowserViewEvent[] = []
  let closed = false
  return {
    events,
    closed: () => closed,
    sink: {
      send: (event: BrowserViewEvent) => { events.push(event) },
      close: () => { closed = true },
      ...(bufferedAmount === undefined ? {} : { bufferedAmount }),
    },
  }
}

describe('lazy start', () => {
  it('operator opens the panel before any tool runs and no browser is started', async () => {
    // Given a fake browser that has never been asked for anything
    // When the panel lists tabs
    // Then the list is empty and no browser process was opened
    const browser = createFakeBrowser()
    await expect(browser.service.listTabs()).resolves.toEqual({ tabs: [], activeTabId: null })
    expect(browser.opens()).toBe(0)
  })

  it('operator runs a tool when Chrome cannot start and both the panel and the tool report it', async () => {
    // Given a fake browser whose launch fails
    // When a tool call runs
    // Then the tool rejects, the panel receives a browser-launch-failed event and the state carries the message
    const browser = createFakeBrowser({ failLaunch: () => new Error('No Chrome binary found.') })
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    await expect(browser.service.console(undefined)).rejects.toThrow(/No Chrome binary found/)
    expect(events.at(-1)).toEqual({ v: 1, kind: 'error', code: 'browser-launch-failed', message: 'No Chrome binary found.' })
    expect(browser.service.state().message).toBe('No Chrome binary found.')
  })
})

describe('session binding', () => {
  it('operator asks for a tab twice in one session and each session keeps its own tab', async () => {
    // Given two sessions asking for tabs
    // When the first session asks twice and the second once
    // Then the repeat returns the same tab, the second session gets a different one and the list reports two tabs with their sessions
    const browser = createFakeBrowser()
    const first = await browser.service.ensureTab('session-a')
    const again = await browser.service.ensureTab('session-a')
    const other = await browser.service.ensureTab('session-b')
    expect(again.id).toBe(first.id)
    expect(other.id).not.toBe(first.id)
    expect((await browser.service.listTabs()).tabs).toHaveLength(2)
    expect((await browser.service.listTabs()).tabs[0]?.sessionId).toBe('session-a')
  })

  it('operator issues two concurrent first calls and both land on one tab', async () => {
    // Given two concurrent first calls for one session
    // When both resolve
    // Then they share one tab and only one create-target call reached the browser
    const browser = createFakeBrowser()
    const [first, second] = await Promise.all([
      browser.service.ensureTab('session-a'),
      browser.service.ensureTab('session-a'),
    ])
    expect(second.id).toBe(first.id)
    expect(browser.transport.callsOf('Target.createTarget')).toHaveLength(1)
  })

  it('operator names another tab and the caller is rebound to it', async () => {
    // Given two sessions with one tab each
    // When the first session names the second session's tab
    // Then that tab is returned, later calls resolve to it and the two tabs stay distinct
    const browser = createFakeBrowser()
    const a = await browser.service.ensureTab('session-a')
    const b = await browser.service.ensureTab('session-b')
    const picked = await browser.service.tabFor('session-a', b.id)
    expect(picked.id).toBe(b.id)
    expect((await browser.service.tabFor('session-a')).id).toBe(b.id)
    expect(a.id).not.toBe(b.id)
  })

  it('operator names a tab that does not exist and the error asks for browser_tabs', async () => {
    // Given a session with no tabs
    // When it names a tab that does not exist
    // Then the call rejects and the message points at browser_tabs
    const browser = createFakeBrowser()
    await expect(browser.service.tabFor('session-a', 'tab-nope')).rejects.toThrow(/call browser_tabs/)
  })
})

describe('panel commands', () => {
  it('operator attaches the panel and receives a hello carrying the current state', async () => {
    // Given a fake browser and one panel
    // When the panel attaches
    // Then the first event is a hello with no tabs, no active tab and nothing running, and no browser was opened
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    expect(events[0]).toEqual({
      v: 1,
      kind: 'hello',
      state: { tabs: [], activeTabId: null, running: false },
    })
    expect(browser.opens()).toBe(0)
  })

  it('operator selects a real tab from the panel and the active tab follows', async () => {
    // Given two tabs and one attached panel
    // When the panel selects the first tab
    // Then the active tab is the first one and the last state event lists both tabs
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    const first = await browser.service.ensureTab('session-a')
    const second = await browser.service.ensureTab('session-b')
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'select-tab', tabId: first.id })
    expect(browser.service.state().activeTabId).toBe(first.id)
    const states = events.filter(event => event.kind === 'state')
    expect(states.at(-1)?.state.tabs).toHaveLength(2)
    expect(second.id).not.toBe(first.id)
  })

  it('operator requests a frame and every attached panel receives it', async () => {
    // Given two attached panels and one tab
    // When one panel requests a frame
    // Then both panels receive exactly one frame carrying the tab id and the JPEG bytes
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const bob = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.service.attach(bob.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    const frames = alice.events.filter(event => event.kind === 'frame')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ tabId: 'tab-1', data: 'JPEG-BYTES' })
    expect(bob.events.filter(event => event.kind === 'frame')).toHaveLength(1)
  })

  it('operator closes a tab and the next request opens a fresh one', async () => {
    // Given a session holding one tab
    // When the panel closes that tab
    // Then the tab list is empty and the next request opens a different tab
    const browser = createFakeBrowser()
    const { sink } = recordingSink()
    const tab = await browser.service.ensureTab('session-a')
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'close-tab', tabId: tab.id })
    expect((await browser.service.listTabs()).tabs).toHaveLength(0)
    const reopened = await browser.service.ensureTab('session-a')
    expect(reopened.id).not.toBe(tab.id)
  })
})

describe('panel attach follows, never creates', () => {
  it('operator attaches a panel with no tab of its session and no tab is created', async () => {
    // Given one tab created by an agent session and a panel from another session
    // When that panel attaches
    // Then the tab count is unchanged and the panels still watch the agent tab
    const browser = createFakeBrowser()
    const agentTab = await browser.service.ensureTab('session-agent')
    const { sink } = recordingSink()
    browser.service.attach(sink)

    await browser.service.handleCommand(sink, { v: 1, kind: 'attach', sessionId: 'session-panel' })

    const state = browser.service.state()
    expect(state.tabs.map(tab => tab.id)).toEqual([agentTab.id])
    expect(state.activeTabId).toBe(agentTab.id)
    expect(browser.transport.callsOf('Target.createTarget')).toHaveLength(1)
  })

  it('operator attaches a panel whose session already owns a tab and that tab is shown', async () => {
    // Given a panel session with its own tab and a later agent tab that is watched
    // When the panel attaches
    // Then the watched tab becomes the panel session's own tab
    const browser = createFakeBrowser()
    const panelTab = await browser.service.ensureTab('session-panel')
    const agentTab = await browser.service.ensureTab('session-agent')
    expect(browser.service.state().activeTabId).toBe(agentTab.id)
    const { sink } = recordingSink()

    await browser.service.handleCommand(sink, { v: 1, kind: 'attach', sessionId: 'session-panel' })

    expect(browser.service.state().activeTabId).toBe(panelTab.id)
    expect(panelTab.id).not.toBe(agentTab.id)
  })

  it('operator attaches a following panel and the agent navigating in another session moves the view', async () => {
    // Given a panel following the page the agent drives
    // When the agent navigates in a different session
    // Then the panels watch that session's tab without anyone selecting it
    const browser = createFakeBrowser()
    await browser.service.ensureTab('session-a')
    const second = await browser.service.ensureTab('session-b')
    const { sink } = recordingSink()
    await browser.service.handleCommand(sink, { v: 1, kind: 'attach', sessionId: 'session-panel' })
    expect(browser.service.state().activeTabId).toBe(second.id)

    await browser.service.navigate('session-a', 'https://a.test/')

    expect(browser.service.state().activeTabId).toBe('tab-1')
    expect((await browser.service.listTabs()).tabs).toHaveLength(2)
  })

  it('operator picks a tab in the panel and a later agent navigation elsewhere does not steal the selection', async () => {
    // Given a panel whose operator chose the first tab
    // When an agent opens and navigates a new tab in another session
    // Then the panels keep showing the chosen tab
    const browser = createFakeBrowser()
    const chosen = await browser.service.ensureTab('session-agent')
    const { sink } = recordingSink()
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'select-tab', tabId: chosen.id })

    await browser.service.navigate('session-other', 'https://other.test/', undefined, { newTab: true })

    const state = browser.service.state()
    expect(state.activeTabId).toBe(chosen.id)
    expect(state.tabs.map(tab => tab.id)).toEqual([chosen.id, 'tab-2'])
  })

  it('operator attaches a panel before any tab exists and the browser is not started', async () => {
    // Given no browser and no tab
    // When a panel attaches and sends its attach command
    // Then nothing is created and no browser process is opened
    const browser = createFakeBrowser()
    const { sink } = recordingSink()
    browser.service.attach(sink)

    await browser.service.handleCommand(sink, { v: 1, kind: 'attach', sessionId: 'session-panel' })

    expect(browser.service.state()).toEqual({ tabs: [], activeTabId: null, running: false })
    expect(browser.opens()).toBe(0)
  })
})

describe('agent tab priority', () => {
  it('operator pins the panel to one page and an agent navigation without a tab id still drives the agent own last page', async () => {
    // Given an agent session with its own page and a panel pinned to a different page
    // When the agent navigates without naming a tab
    // Then only the agent page is navigated, the pinned page keeps its url and the panel keeps its selection
    const browser = createFakeBrowser()
    const agentTab = await browser.service.ensureTab('session-agent')
    const watched = await browser.service.ensureTab('session-watcher')
    const { sink } = recordingSink()
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'select-tab', tabId: watched.id })

    const navigated = await browser.service.navigate('session-agent', 'https://agent.test/')

    // Tab creation navigates to about:blank, so the pages that really moved are
    // the non-blank navigations, reported as their tab's CDP session.
    const moved = browser.transport.callsOf('Page.navigate')
      .filter(call => call.params.url !== 'about:blank')
      .map(call => `${call.sessionId}:${String(call.params.url)}`)
    expect(moved).toEqual(['session-1:https://agent.test/'])
    expect(navigated.tab.id).toBe(agentTab.id)
    expect(watched.id).not.toBe(agentTab.id)
    expect(browser.service.state().activeTabId).toBe(watched.id)
  })

  it('operator watches a page one session owns and a second session opens its own tab instead of driving it', async () => {
    // Given a page owned by one session and watched through the panel
    // When a different session navigates without naming a tab
    // Then the watched page is untouched and the newcomer ends up on a tab of its own
    const browser = createFakeBrowser()
    const owned = await browser.service.ensureTab('session-owner')
    const { sink } = recordingSink()
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'select-tab', tabId: owned.id })

    const navigated = await browser.service.navigate('session-newcomer', 'https://new.test/')

    const tabs = (await browser.service.listTabs()).tabs
    const moved = browser.transport.callsOf('Page.navigate')
      .filter(call => call.params.url !== 'about:blank')
      .map(call => `${call.sessionId}:${String(call.params.url)}`)
    // The newcomer drives a session of its own: the watched page is never the
    // tab that received this navigation.
    expect(moved).toEqual(['session-2:https://new.test/'])
    expect(navigated.tab.id).not.toBe(owned.id)
    expect(tabs.map(tab => tab.id)).toEqual([owned.id, navigated.tab.id])
  })
})

describe('additional tabs', () => {
  it('operator navigates twice and only the second call asks for a new tab so both pages stay open', async () => {
    // Given a session whose first navigation opened one page in its tab
    // When the same session navigates to a second page with newTab
    // Then two tabs are listed, the new one is active and the session is bound to it
    const browser = createFakeBrowser()
    const first = await browser.service.navigate('session-a', 'https://a.test/')
    const second = await browser.service.navigate('session-a', 'https://b.test/', undefined, { newTab: true })
    const state = await browser.service.listTabs()
    expect(state.tabs.map(tab => tab.id)).toEqual([first.tab.id, second.tab.id])
    expect(state.activeTabId).toBe(second.tab.id)
    expect((await browser.service.tabFor('session-a')).id).toBe(second.tab.id)
  })

  it('operator navigates a third time without newTab and the current tab is reused', async () => {
    // Given a session that already opened a second tab on purpose
    // When it navigates again without asking for a new tab
    // Then no third tab appears and the navigation happens in the current one
    const browser = createFakeBrowser()
    await browser.service.navigate('session-a', 'https://a.test/')
    const second = await browser.service.navigate('session-a', 'https://b.test/', undefined, { newTab: true })

    const third = await browser.service.navigate('session-a', 'https://c.test/')

    expect(third.tab.id).toBe(second.tab.id)
    expect((await browser.service.listTabs()).tabs).toHaveLength(2)
  })

  it('operator asks for a new tab and each request really opens one', async () => {
    // Given a session with one tab
    // When two more navigations each ask for a new tab
    // Then three tabs are listed and each has its own id
    const browser = createFakeBrowser()
    await browser.service.ensureTab('session-a')

    await browser.service.navigate('session-a', 'https://a.test/', undefined, { newTab: true })
    await browser.service.navigate('session-a', 'https://b.test/', undefined, { newTab: true })

    const tabs = (await browser.service.listTabs()).tabs
    expect(tabs.map(tab => tab.id)).toEqual(['tab-1', 'tab-2', 'tab-3'])
  })
})

describe('action traces', () => {
  it('operator clicks a ref and one trace is broadcast while the outcome carries its summary', async () => {
    // Given an attached panel and one snapshot
    // When a ref from that snapshot is clicked
    // Then the outcome summary comes from the host and exactly one action trace carries it
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    // A ref only exists after an observation; take one and click its first node.
    await browser.service.snapshot('session-a')
    const outcome = await browser.service.click('session-a', { ref: 0 })
    expect(outcome.summary).toContain('Clicked')
    const traces = events.filter(event => event.kind === 'action')
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      trace: { tool: 'click', summary: outcome.summary, at: 500 },
    })
  })

  it('operator clicks and the panel receives a fresh frame so it cannot show the old state', async () => {
    // Given an attached panel
    // When a click by selector resolves
    // Then at least one frame reaches the panel after the click
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    await browser.service.click('session-a', { selector: 'button' })
    expect(events.filter(event => event.kind === 'frame').length).toBeGreaterThan(0)
  })

  it('operator clicks with no target and the page is never touched', async () => {
    // Given a session with no target named
    // When the click runs
    // Then it rejects naming the accepted targets and no mouse event reaches the page
    const browser = createFakeBrowser()
    await expect(browser.service.click('session-a', {})).rejects.toThrow(/click needs one of/)
    expect(browser.transport.callsOf('Input.dispatchMouseEvent')).toHaveLength(0)
  })

  it('operator clicks a ref no snapshot produced and the error asks for browser_snapshot', async () => {
    // Given a session whose snapshot never produced ref 9
    // When the click names that ref
    // Then it rejects and asks for browser_snapshot first
    const browser = createFakeBrowser()
    await browser.service.ensureTab('session-a')
    await expect(browser.service.click('session-a', { ref: 9 })).rejects.toThrow(/call browser_snapshot first/)
  })

  it('operator navigates, snapshots and screenshots through one bound tab', async () => {
    // Given one bound tab
    // When navigate, snapshot and screenshot run in sequence
    // Then the summary names the url, the snapshot numbers three nodes with Go named, and the screenshot returns that tab's JPEG
    const browser = createFakeBrowser()
    const navigated = await browser.service.navigate('session-a', 'https://a.test/')
    expect(navigated.outcome.summary).toContain('https://a.test/')
    const snapshot = await browser.service.snapshot('session-a')
    expect(snapshot.nodes.map(node => node.ref)).toEqual([0, 1, 2])
    expect(snapshot.nodes[2]?.name).toBe('Go')
    const shot = await browser.service.screenshot('session-a')
    expect(shot.data).toBe('JPEG-BYTES')
    expect(shot.tabId).toBe(navigated.tab.id)
    // And the tool's capture asks for JPEG even though the stream format is WebP
    // (an action's on-demand refresh frame is WebP, hence "some" rather than a
    // fixed index): this tool declares image/jpeg, and the host rejects a body
    // that does not match its declaration ("Declared image type does not match
    // its bytes").
    const captureFormats = browser.transport
      .callsOf('Page.captureScreenshot')
      .map(call => (call.params as { format?: string }).format)
    expect(captureFormats).toContain('jpeg')
  })

  it('operator reads console and network entries and the limit keeps the newest entries', async () => {
    // Given three console lines and one request on the tab session
    // When console is read with a limit of two and network with a limit of ten
    // Then only the newest two console lines survive, the request keeps its url and the tab id is reported
    const browser = createFakeBrowser()
    const tab = await browser.service.ensureTab('session-a')
    for (const text of ['one', 'two', 'three']) {
      browser.transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: text }] }, 'session-1')
    }
    browser.transport.emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://a.test/x', method: 'GET' },
    }, 'session-1')
    const console_ = await browser.service.console('session-a', 2)
    expect(console_.entries.map(entry => entry.text)).toEqual(['two', 'three'])
    const network = await browser.service.network('session-a', 10)
    expect(network.entries[0]?.url).toBe('https://a.test/x')
    expect(console_.tabId).toBe(tab.id)
  })
})

describe('dispose', () => {
  it('operator disposes the service and every panel socket closes with one session dispose', async () => {
    // Given two attached panels and one open tab
    // When the service is disposed twice
    // Then both panels are closed and the browser session reports disposed
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const bob = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.service.attach(bob.sink)

    await browser.service.dispose()

    expect(alice.closed()).toBe(true)
    expect(bob.closed()).toBe(true)
    expect(browser.disposed()).toBe(true)
    await browser.service.dispose()
    expect(browser.disposed()).toBe(true)
  })

  it('operator broadcasts after dispose and no panel receives it', async () => {
    // Given one attached panel and a disposed service
    // When an error is broadcast
    // Then the panel receives nothing new
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(sink)
    const seen = events.length
    await browser.service.dispose()
    browser.service.broadcast({ v: 1, kind: 'error', code: 'ignored', message: 'ignored' })
    expect(events).toHaveLength(seen)
  })
})
describe('stream budget and idle panels', () => {
  it('a panel that reports itself hidden stops receiving frames while another keeps them', async () => {
    // Given two panels watching one tab
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const bob = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.service.attach(bob.sink)
    alice.events.length = 0
    bob.events.length = 0
    // When one of them says its tab left the screen
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: false })
    await browser.service.handleCommand(bob.sink, { v: 1, kind: 'request-frame' })
    // Then only the watching panel pays for the picture
    expect(alice.events.filter(event => event.kind === 'frame')).toHaveLength(0)
    expect(bob.events.filter(event => event.kind === 'frame')).toHaveLength(1)
  })

  it('the last hidden panel stops the screencast itself', async () => {
    // Given one panel watching one tab with a running screencast
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(browser.transport.callsOf('Page.startScreencast')).toHaveLength(1)
    browser.transport.calls.length = 0
    // When it reports itself hidden
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: false })
    // Then the host stops capturing entirely, so an idle page costs nothing
    expect(browser.transport.callsOf('Page.stopScreencast')).toHaveLength(1)
  })

  it('a panel that comes back gets the screencast and one fresh frame', async () => {
    // Given a hidden panel
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: false })
    browser.transport.calls.length = 0
    alice.events.length = 0
    // When it becomes visible again
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: true })
    // Then the screencast restarts and a fresh frame replaces the stale picture
    expect(browser.transport.callsOf('Page.startScreencast')).toHaveLength(1)
    expect(alice.events.filter(event => event.kind === 'frame')).toHaveLength(1)
  })

  it('frames are budgeted while idle and loosened for a moment after input', async () => {
    // Given a panel watching a tab and a clock the test controls
    let clock = 1_000
    const browser = createFakeBrowser({ now: () => clock, frameIntervalMs: { idle: 66, interactive: 33 } })
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    alice.events.length = 0
    const frames = () => alice.events.filter(event => event.kind === 'frame').length
    // When frames are asked for 100 ms, then 10 ms, then 70 ms apart
    clock = 1_100
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    expect(frames()).toBe(1)
    clock = 1_110
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    clock = 1_180
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    // Then the idle budget (66 ms) dropped exactly the frame that came too soon
    expect(frames()).toBe(2)
    // When the person interacts and another frame follows 40 ms later
    await browser.service.handleCommand(alice.sink, {
      v: 1,
      kind: 'input',
      input: { kind: 'wheel', x: 10, y: 10, deltaX: 0, deltaY: 100 },
    })
    expect(frames()).toBe(2)
    clock = 1_220
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    // Then input bought the interactive rate back: 40 ms is now soon enough
    expect(frames()).toBe(3)
  })

  it('a relay that cannot send falls back to the socket instead of dropping the panel', async () => {
    // Given a panel whose relay reports itself open but fails every send -
    // which is what an oversized frame used to do, freezing the panel for good
    const browser = createFakeBrowser({
      createRelay: () => ({
        open: true,
        async acceptOffer() { return '{"type":"answer","sdp":"v=0"}' },
        sendFrame: () => false,
        dispose: () => undefined,
      }),
    })
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'rtc-offer', sdp: '{"type":"offer","sdp":"v=0"}' })
    alice.events.length = 0
    // When two frames are pushed
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    // Then both arrive over the socket and the panel is still attached
    expect(alice.events.filter(event => event.kind === 'frame')).toHaveLength(2)
  })
})

describe('dom mirror lane', () => {
  /** One rrweb event as the recorder would emit it. */
  const recorded = (type: number, timestamp: number): Record<string, unknown> => ({ type, timestamp })

  /** Deliver one recorder payload the way the browser does. */
  function emitDom(
    transport: ReturnType<typeof createFakeBrowser>['transport'],
    event: unknown,
    sessionId: string,
  ): void {
    transport.emit('Runtime.bindingCalled', {
      name: 'dshBrowserViewDomMirror',
      payload: JSON.stringify(event),
      executionContextId: 1,
    }, sessionId)
  }

  /** Take one snapshot's worth of recording on the tab's session. */
  function recordSnapshot(
    transport: ReturnType<typeof createFakeBrowser>['transport'],
    sessionId: string,
    stamp = 1,
  ): void {
    emitDom(transport, recorded(4, stamp), sessionId)
    emitDom(transport, recorded(2, stamp + 1), sessionId)
  }

  it('a panel asks for the DOM lane and the tab is armed on its own session', async () => {
    // Given one open tab and an attached panel
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const tab = await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.transport.calls.length = 0

    // When the panel asks for the mirror
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })

    // Then the recorder is armed on the tab's page session, and only then
    expect(browser.transport.callsOf('Page.addScriptToEvaluateOnNewDocument')[0]?.sessionId).toBe('session-1')
    expect(browser.transport.callsOf('Runtime.addBinding')[0]?.sessionId).toBe('session-1')
    expect(tab.id).toBe('tab-1')
  })

  it('a panel that never asks for a lane records nothing', async () => {
    // Given one open tab and an attached panel that says nothing about lanes
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await new Promise(resolve => setTimeout(resolve, 0))

    // When the panel models the default behaviour
    // Then no recorder was ever injected, so a panel from before the mirror
    // existed costs the page nothing
    expect(browser.transport.callsOf('Runtime.addBinding')).toHaveLength(0)
    expect(browser.transport.callsOf('Page.addScriptToEvaluateOnNewDocument')).toHaveLength(0)
  })

  it('a mirroring panel receives the recording and stops paying for frames', async () => {
    // Given a panel watching the DOM lane with a recorded snapshot
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })
    recordSnapshot(browser.transport, 'session-1')
    alice.events.length = 0

    // When one more mutation arrives
    emitDom(browser.transport, recorded(3, 5), 'session-1')

    // Then it travels as one non-reset batch and the screencast is stopped,
    // because this panel no longer renders pixels
    const dom = alice.events.filter(event => event.kind === 'dom')
    expect(dom).toHaveLength(1)
    // No `reset`: a batch that continues the recording is the default reading.
    expect(dom[0]).toEqual({
      v: 1,
      kind: 'dom',
      tabId: 'tab-1',
      seq: expect.any(Number),
      events: [recorded(3, 5)],
    })
    expect(browser.transport.callsOf('Page.stopScreencast')).toHaveLength(1)
  })

  it('a panel that attaches late gets the recording from its checkpoint', async () => {
    // Given a tab that is already recording for one panel
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const bob = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })
    recordSnapshot(browser.transport, 'session-1')

    // When a second panel asks for the same mirror
    browser.service.attach(bob.sink)
    bob.events.length = 0
    await browser.service.handleCommand(bob.sink, { v: 1, kind: 'mode', mode: 'dom' })
    emitDom(browser.transport, recorded(3, 9), 'session-1')

    // Then that panel does not have to have been there from the start: the
    // first batch it receives is the whole recording and says so
    const first = bob.events.find(event => event.kind === 'dom')
    expect(first).toMatchObject({ reset: true, tabId: 'tab-1' })
    expect((first as { events: unknown[] }).events.length).toBeGreaterThanOrEqual(3)
  })

  it('a hidden panel receives no mirror traffic while another keeps it', async () => {
    // Given two mirroring panels on one tab
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const bob = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.service.attach(bob.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })
    await browser.service.handleCommand(bob.sink, { v: 1, kind: 'mode', mode: 'dom' })
    recordSnapshot(browser.transport, 'session-1')
    alice.events.length = 0
    bob.events.length = 0

    // When one of them reports its tab left the screen
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: false })
    emitDom(browser.transport, recorded(3, 6), 'session-1')

    // Then only the watching panel pays for the event
    expect(alice.events.filter(event => event.kind === 'dom')).toHaveLength(0)
    expect(bob.events.filter(event => event.kind === 'dom')).toHaveLength(1)
  })

  it('the last hidden panel stops the recorder itself', async () => {
    // Given one mirroring panel
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })
    browser.transport.calls.length = 0

    // When it reports itself hidden
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: false })

    // Then the recorder is stopped and its registration withdrawn: a page
    // nobody watches records nothing, on this document or the next
    expect(browser.transport.callsOf('Runtime.evaluate').length).toBeGreaterThan(0)
    expect(browser.transport.callsOf('Page.removeScriptToEvaluateOnNewDocument')).toHaveLength(1)
  })

  it('a panel that comes back rebuilds from a fresh recording', async () => {
    // Given a mirroring panel that went hidden after a snapshot
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })
    recordSnapshot(browser.transport, 'session-1')
    emitDom(browser.transport, recorded(3, 4), 'session-1')
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: false })
    alice.events.length = 0

    // When it becomes visible again
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: true })

    // Then the recorder is armed again and the pixel lane covers the moment in
    // between, so the stage is never empty while the page re-snapshots
    expect(browser.transport.callsOf('Page.addScriptToEvaluateOnNewDocument').length).toBeGreaterThan(0)
    expect(alice.events.filter(event => event.kind === 'frame')).toHaveLength(1)

    // And when the page snapshots, the batch carries the whole fresh recording
    recordSnapshot(browser.transport, 'session-1', 20)
    emitDom(browser.transport, recorded(3, 30), 'session-1')
    const dom = alice.events.filter(event => event.kind === 'dom')
    expect(dom[0]).toMatchObject({ reset: true })
    expect((dom[0] as { events: unknown[] }).events).toEqual([recorded(4, 20), recorded(2, 21)])
    expect(dom[1]).toMatchObject({ events: [recorded(3, 30)] })
  })

  it('a panel switches back to pixels and frames start flowing again', async () => {
    // Given a mirroring panel whose mirror is live
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })
    recordSnapshot(browser.transport, 'session-1')
    emitDom(browser.transport, recorded(3, 3), 'session-1')
    alice.events.length = 0

    // When it asks for pixels
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'pixels' })

    // Then the screencast runs again and a fresh frame arrives immediately
    expect(browser.transport.callsOf('Page.startScreencast').length).toBeGreaterThan(0)
    expect(alice.events.filter(event => event.kind === 'frame')).toHaveLength(1)
    expect(browser.transport.callsOf('Page.removeScriptToEvaluateOnNewDocument')).toHaveLength(1)
  })

  it('the mirror cannot be injected and the panel is moved to pixels with the reason', async () => {
    // Given a transport whose bootstrap reports the page rejected the recorder
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.transport.responses.set('Runtime.evaluate', () => ({
      exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: eval is blocked' } },
    }))
    alice.events.length = 0

    // When the panel asks for the mirror
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })

    // Then it is told why, moved to pixels, and a frame follows so the stage is
    // never empty
    const notice = alice.events.find(event => event.kind === 'mirror')
    expect(notice).toMatchObject({ v: 1, kind: 'mirror', tabId: 'tab-1', available: false })
    expect((notice as { reason: string }).reason).toMatch(/eval is blocked/)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    expect(alice.events.filter(event => event.kind === 'frame').length).toBeGreaterThan(0)
  })

  it('the mirror cannot be injected and the host does not retry it on every state change', async () => {
    // Given a mirror whose injection always fails
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.transport.responses.set('Runtime.evaluate', () => ({
      exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: eval is blocked' } },
    }))
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'dom' })
    const bootstraps = (): number => browser.transport
      .callsOf('Runtime.evaluate')
      .filter(call => String(call.params.expression).includes('dshBrowserViewDomMirror'))
      .length
    const attempts = bootstraps()

    // When the tab changes state repeatedly
    await browser.transport.emit('Page.frameStartedLoading', {}, 'session-1')
    await browser.transport.emit('Page.loadEventFired', {}, 'session-1')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then no second doomed injection was attempted
    expect(bootstraps()).toBe(attempts)
  })

  it('a tab nobody watches records nothing even when a panel wants the mirror', async () => {
    // Given two tabs and a panel watching the first
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const first = await browser.service.ensureTab('session-a')
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'attach' })
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'select-tab', tabId: first.id })
    browser.transport.calls.length = 0

    // When the agent opens a second tab while the panel stays on the first
    await browser.service.ensureTab('session-b')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then the recorder followed the watched tab: it was stopped for the first
    // and never armed for the tab nobody is rendering
    expect(browser.transport.callsOf('Page.addScriptToEvaluateOnNewDocument')).toHaveLength(0)
    expect(browser.transport.callsOf('Runtime.addBinding')).toHaveLength(0)
  })
})

describe('tab capture lane', () => {
  /** Binding the injected recorder pushes chunks into. */
  const BINDING = 'dshBrowserViewTabCapture'

  /** Every evaluate whose expression contains one string. */
  function evaluates(
    transport: ReturnType<typeof createFakeBrowser>['transport'],
    needle: string,
  ): ReturnType<typeof transport.callsOf> {
    return transport.callsOf('Runtime.evaluate').filter(call => String(call.params.expression).includes(needle))
  }

  /** Every evaluate that asked the page for the tab's surface. */
  const startCalls = (transport: ReturnType<typeof createFakeBrowser>['transport']): ReturnType<typeof transport.callsOf> =>
    evaluates(transport, 'getDisplayMedia')

  /** Every evaluate that released a capture. */
  const stopCalls = (transport: ReturnType<typeof createFakeBrowser>['transport']): ReturnType<typeof transport.callsOf> =>
    evaluates(transport, 'capture.recorder')

  /** Every evaluate that touched the capture title. */
  const titleCalls = (transport: ReturnType<typeof createFakeBrowser>['transport']): ReturnType<typeof transport.callsOf> =>
    evaluates(transport, 'SENTINEL')

  /** The token the recorder running now was handed, read off the page expression. */
  function startedToken(transport: ReturnType<typeof createFakeBrowser>['transport']): string {
    const call = startCalls(transport).at(-1)
    const match = /var TOKEN = "([^"]+)"/.exec(String(call?.params.expression ?? ''))
    if (match === null) throw new Error('the capture bootstrap carried no token')
    return match[1]
  }

  /** Deliver one recorder chunk the way the page's binding does. */
  function emitChunk(
    transport: ReturnType<typeof createFakeBrowser>['transport'],
    data: string,
    sessionId = 'session-1',
  ): void {
    transport.emit('Runtime.bindingCalled', {
      name: BINDING,
      payload: JSON.stringify({ chunk: data, token: startedToken(transport) }),
      executionContextId: 1,
    }, sessionId)
  }

  /** The capture chunks one sink received, in order. */
  function chunksOf(sink: { events: BrowserViewEvent[] }): Array<{ data: string; reset?: boolean }> {
    return sink.events.filter(event => event.kind === 'capture-chunk') as Array<{ data: string; reset?: boolean }>
  }

  /** Make the page refuse the capture, leaving every other evaluate answer alone. */
  function refuseCapture(
    transport: ReturnType<typeof createFakeBrowser>['transport'],
    description: string,
  ): void {
    const base = transport.responses.get('Runtime.evaluate')
    transport.responses.set('Runtime.evaluate', (params: Record<string, unknown>) => {
      if (String(params.expression ?? '').includes('getDisplayMedia')) {
        return { exceptionDetails: { text: 'Uncaught', exception: { description } } }
      }
      return typeof base === 'function' ? base(params) : base
    })
  }

  it('a panel asks for the capture lane and the watched tab is renamed then armed on its own session', async () => {
    // Given one open tab and an attached panel
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.transport.calls.length = 0

    // When the panel asks for the capture
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })

    // Then the title is changed to the sentinel before the surface is asked
    // for, both calls ride the tab's own page session and both take the user
    // gesture getDisplayMedia requires
    expect(titleCalls(browser.transport)).toHaveLength(1)
    expect(browser.transport.calls.indexOf(titleCalls(browser.transport)[0] as never))
      .toBeLessThan(browser.transport.calls.indexOf(startCalls(browser.transport)[0] as never))
    expect(startCalls(browser.transport)[0]?.params.userGesture).toBe(true)
    expect(startCalls(browser.transport)[0]?.params.awaitPromise).toBe(true)
    expect(evaluates(browser.transport, 'SENTINEL')[0]?.sessionId).toBe('session-1')
    expect(browser.transport.callsOf('Runtime.addBinding')[0]?.params.name).toBe(BINDING)
    expect(startCalls(browser.transport)).toHaveLength(1)
  })

  it('a panel that never asks for a lane captures nothing', async () => {
    // Given one open tab and an attached panel that says nothing about lanes
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await new Promise(resolve => setTimeout(resolve, 0))

    // When the panel models the default behaviour
    // Then no capture was ever requested, so a panel that never wanted one
    // costs the page no display-capture permission and no recorder
    expect(startCalls(browser.transport)).toHaveLength(0)
    expect(titleCalls(browser.transport)).toHaveLength(0)
  })

  it('a capturing panel receives a header chunk and stops paying for frames', async () => {
    // Given a panel on the capture lane
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    alice.events.length = 0

    // When the recorder emits its first chunk and then a following one
    emitChunk(browser.transport, 'HEADER')
    await new Promise(resolve => setTimeout(resolve, 0))
    emitChunk(browser.transport, 'CLUSTER')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then the first carries `reset` - it is a stream header, not a fragment -
    // and the second continues the recording without one
    expect(chunksOf(alice)).toEqual([
      { v: 1, kind: 'capture-chunk', tabId: 'tab-1', seq: expect.any(Number), mime: 'video/webm;codecs=vp8', reset: true, data: 'HEADER' },
      { v: 1, kind: 'capture-chunk', tabId: 'tab-1', seq: expect.any(Number), mime: 'video/webm;codecs=vp8', data: 'CLUSTER' },
    ])
    // And the pixel lane stopped once the panel had a picture of its own
    expect(browser.transport.callsOf('Page.stopScreencast')).toHaveLength(1)
  })

  it('a panel that attaches late restarts the recording so it gets a header of its own', async () => {
    // Given one panel already drawing the capture
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const bob = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    emitChunk(browser.transport, 'HEADER')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(chunksOf(alice)).toHaveLength(1)

    // When a second panel asks for the same lane
    browser.service.attach(bob.sink)
    await browser.service.handleCommand(bob.sink, { v: 1, kind: 'mode', mode: 'capture' })
    emitChunk(browser.transport, 'HEADER-2')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then the recorder was restarted rather than continued, because a media
    // stream cannot be joined from the middle: the late panel's first chunk
    // starts a recording
    expect(startCalls(browser.transport).length).toBeGreaterThanOrEqual(2)
    expect(chunksOf(bob)[0]).toMatchObject({ reset: true, data: 'HEADER-2' })
  })

  it('no capture runs while every sink is paused', async () => {
    // Given one panel capturing a tab
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    emitChunk(browser.transport, 'HEADER')
    await new Promise(resolve => setTimeout(resolve, 0))
    const token = startedToken(browser.transport)
    browser.transport.calls.length = 0
    alice.events.length = 0

    // When it reports itself hidden, the only watcher gone
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: false })

    // Then the capture is released in the page and the sentinel comes off the
    // title: nobody is looking, and a capture running for nobody is also a tab
    // wearing a title it did not choose
    expect(stopCalls(browser.transport).length).toBeGreaterThan(0)
    expect(titleCalls(browser.transport).length).toBeGreaterThan(0)

    // And a chunk the page still had in flight is not delivered to it
    browser.transport.emit('Runtime.bindingCalled', {
      name: BINDING,
      payload: JSON.stringify({ chunk: 'LATE', token }),
      executionContextId: 1,
    }, 'session-1')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(chunksOf(alice)).toHaveLength(0)
  })

  it('a panel that comes back starts a fresh recording instead of a fragment', async () => {
    // Given a hidden panel that was on the capture lane before
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    emitChunk(browser.transport, 'HEADER')
    await new Promise(resolve => setTimeout(resolve, 0))
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: false })
    browser.transport.calls.length = 0
    alice.events.length = 0

    // When it becomes visible again
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'stream', enabled: true })
    emitChunk(browser.transport, 'FRESH')

    // Then a recorder was armed again - the stream it missed cannot be resumed
    // mid-way - and its first chunk is marked as the start of a recording
    expect(startCalls(browser.transport).length).toBeGreaterThan(0)
    expect(chunksOf(alice)[0]).toMatchObject({ reset: true, data: 'FRESH' })
  })

  it('the capture cannot start and the panel is moved to pixels with the reason', async () => {
    // Given a page that refuses the display-capture request
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    refuseCapture(browser.transport, 'NotAllowedError: permission denied')
    alice.events.length = 0

    // When the panel asks for the capture lane
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })

    // Then it is told why, the host moves it to pixels and a frame follows so
    // the stage is never empty, and the sentinel was taken back off the page
    const notice = alice.events.find(event => event.kind === 'capture')
    expect(notice).toMatchObject({ v: 1, kind: 'capture', tabId: 'tab-1', available: false })
    expect((notice as { reason: string }).reason).toMatch(/permission denied/)
    expect(titleCalls(browser.transport).length).toBeGreaterThanOrEqual(2)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    expect(alice.events.filter(event => event.kind === 'frame').length).toBeGreaterThan(0)
  })

  it('the capture cannot start and the host does not retry it on every state change', async () => {
    // Given a capture whose start always fails
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    refuseCapture(browser.transport, 'NotAllowedError: permission denied')
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    const attempts = startCalls(browser.transport).length

    // When the tab changes state repeatedly
    await browser.transport.emit('Page.frameStartedLoading', {}, 'session-1')
    await browser.transport.emit('Page.loadEventFired', {}, 'session-1')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then no second doomed request was made
    expect(startCalls(browser.transport)).toHaveLength(attempts)
  })

  it('a panel switches back to pixels and the capture is released', async () => {
    // Given a capturing panel
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    emitChunk(browser.transport, 'HEADER')
    await new Promise(resolve => setTimeout(resolve, 0))
    browser.transport.calls.length = 0
    alice.events.length = 0

    // When it asks for pixels
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'pixels' })

    // Then the recorder and the tracks are released, the title goes back and a
    // fresh frame follows so the panel has a picture immediately
    expect(stopCalls(browser.transport).length).toBeGreaterThan(0)
    expect(titleCalls(browser.transport).length).toBeGreaterThan(0)
    expect(browser.transport.callsOf('Page.startScreencast').length).toBeGreaterThan(0)
    expect(alice.events.filter(event => event.kind === 'frame')).toHaveLength(1)
  })

  it('the recorder dies inside the page and the panel falls back with the reason', async () => {
    // Given a panel drawing a live capture
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    emitChunk(browser.transport, 'HEADER')
    await new Promise(resolve => setTimeout(resolve, 0))
    alice.events.length = 0

    // When the page reports that its capture stopped
    browser.transport.emit('Runtime.bindingCalled', {
      name: BINDING,
      payload: JSON.stringify({ __dshCaptureError: 'the tab capture ended', token: startedToken(browser.transport) }),
      executionContextId: 1,
    }, 'session-1')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then the panel is moved to pixels with that reason rather than left on a
    // frozen last frame, and the title is restored
    expect(alice.events.find(event => event.kind === 'capture'))
      .toMatchObject({ v: 1, kind: 'capture', tabId: 'tab-1', available: false })
    expect((alice.events.find(event => event.kind === 'capture') as { reason: string }).reason)
      .toMatch(/the tab capture ended/)
    expect(titleCalls(browser.transport).length).toBeGreaterThanOrEqual(2)
  })

  it('the watched page navigates and the capture is re-armed instead of falling back', async () => {
    // Given a panel drawing a live capture
    const browser = createFakeBrowser()
    const alice = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    emitChunk(browser.transport, 'HEADER')
    await new Promise(resolve => setTimeout(resolve, 0))
    alice.events.length = 0

    // When the page navigates, which destroys the document the recorder lives in
    browser.transport.emit('Page.frameNavigated', { frame: { url: 'https://b.test/', loaderId: 'loader-2' } }, 'session-1')
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then a fresh recorder was armed in the new document, the panel was not
    // demoted to pixels - the lane is still what the person asked for - and the
    // pixel lane covered the gap while it armed
    expect(startCalls(browser.transport).length).toBeGreaterThanOrEqual(2)
    expect(alice.events.filter(event => event.kind === 'capture')).toHaveLength(0)

    // And the next chunk from the new recording starts one
    emitChunk(browser.transport, 'HEADER-2')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(chunksOf(alice).at(-1)).toMatchObject({ reset: true, data: 'HEADER-2' })
  })

  it('a sink whose transport is already backed up is skipped instead of queued for', async () => {
    // Given one panel whose socket is already holding more than the ceiling and
    // one that is keeping up
    const browser = createFakeBrowser()
    const slow = recordingSink(() => 8 * 1024 * 1024)
    const fast = recordingSink(() => 0)
    await browser.service.ensureTab('session-a')
    browser.service.attach(slow.sink)
    browser.service.attach(fast.sink)
    await browser.service.handleCommand(slow.sink, { v: 1, kind: 'mode', mode: 'capture' })
    await browser.service.handleCommand(fast.sink, { v: 1, kind: 'mode', mode: 'capture' })
    slow.events.length = 0
    fast.events.length = 0

    // When the recorder emits a chunk
    emitChunk(browser.transport, 'HEADER')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then the backed-up panel is not handed another byte - a slow reader must
    // not make the host buffer without bound - while the healthy one still gets it
    expect(chunksOf(slow)).toHaveLength(0)
    expect(chunksOf(fast)).toHaveLength(1)
  })

  it('a tab nobody watches is not captured even when a panel wants the lane', async () => {
    // Given two tabs and a panel pinned to the first while on the capture lane
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const first = await browser.service.ensureTab('session-a')
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'attach' })
    browser.service.attach(alice.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'select-tab', tabId: first.id })
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'mode', mode: 'capture' })
    browser.transport.calls.length = 0

    // When the agent opens a second tab while the panel stays on the first
    await browser.service.ensureTab('session-b')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Then no capture was armed for the tab nobody is rendering
    expect(startCalls(browser.transport)).toHaveLength(0)
  })
})
