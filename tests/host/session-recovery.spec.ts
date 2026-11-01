/**
 * A browser can die while it is idle: a crashed renderer, an operator killing
 * the process, the machine reclaiming memory. These tests pin the recovery
 * contract - the service forgets a session whose connection ended, tells the
 * panels, and starts a fresh browser on the next call instead of failing
 * forever against a corpse.
 *
 * The fixture gives every session its own transport, as production does: one
 * Chromium and one DevTools socket per session. Reusing a closed transport here
 * would model a browser that is dead the moment it starts, which is a different
 * (and much rarer) failure than the one under test.
 */

import { describe, expect, it, vi } from 'vitest'
import { TabManager } from '../../src/core/tabs.ts'
import type { BrowserViewEvent } from '../../src/core/protocol.ts'
import { BrowserViewService, type BrowserSession, type BrowserViewSink } from '../../src/host/service.ts'
import { FakeTransport } from '../helpers/fake-cdp.ts'

/** One raw snapshot node the fake page reports. */
const FAKE_NODES = [
  { tag: 'body', depth: 0, selector: 'body' },
  { tag: 'h1', depth: 1, selector: 'body > h1', text: 'ok', role: 'heading', name: 'ok' },
]

/** Script one transport the way tests/helpers/fake-browser.ts does. */
function scriptTransport(
  transport: FakeTransport,
  nextTab: () => { tabId: string; sessionId: string },
): void {
  let current = { tabId: 'tab-0', sessionId: 'session-0' }
  transport.responses.set('Target.createTarget', () => {
    current = nextTab()
    return { targetId: current.tabId }
  })
  transport.responses.set('Target.attachToTarget', () => ({ sessionId: current.sessionId }))
  transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BYTES' })
  transport.responses.set('Runtime.evaluate', () => ({
    result: { value: { url: 'https://a.test/', title: 'A', nodes: FAKE_NODES, truncated: false } },
  }))
  transport.onSend = (call) => {
    if (call.method === 'Page.navigate') transport.emit('Page.loadEventFired', {}, call.sessionId)
  }
}

/**
 * A service whose every session is a fresh scripted transport.
 * @returns the service and the test hooks for connection loss.
 */
function createRecoverableBrowser(): {
  service: BrowserViewService
  /** The transport of the session that is currently alive, when there is one. */
  live: () => FakeTransport | undefined
  opens: () => number
  disposals: () => number
} {
  const transports: FakeTransport[] = []
  let opens = 0
  let disposals = 0
  // Ids stay unique across sessions, so "the replacement built its own tab"
  // remains a real assertion rather than one every fake happens to satisfy.
  let tabCounter = 0
  const service = new BrowserViewService({
    now: () => 500,
    frameIntervalMs: { idle: 0, interactive: 0 },
    openSession: async (opts): Promise<BrowserSession> => {
      opens += 1
      const transport = new FakeTransport()
      scriptTransport(transport, () => {
        tabCounter += 1
        return { tabId: `tab-${tabCounter}`, sessionId: `session-${tabCounter}` }
      })
      transports.push(transport)
      const tabs = new TabManager({ transport, onFrame: opts.onFrame, onTabsChanged: opts.onTabsChanged })
      return {
        transport,
        tabs,
        async dispose() { disposals += 1 },
      }
    },
  })
  return {
    service,
    live: () => transports.at(-1)?.closed === false ? transports.at(-1) : undefined,
    opens: () => opens,
    disposals: () => disposals,
  }
}

/** A sink that records every event it is handed. */
function recordingSink(): { sink: BrowserViewSink; events: BrowserViewEvent[] } {
  const events: BrowserViewEvent[] = []
  return {
    events,
    sink: {
      send: (event: BrowserViewEvent) => { events.push(event) },
      close: () => undefined,
    },
  }
}

describe('connection loss', () => {
  it('operator loses the DevTools connection and the next call starts a fresh browser', async () => {
    // Given a running browser with one bound tab and a panel watching
    const browser = createRecoverableBrowser()
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    const tab = await browser.service.ensureTab('session-a')
    expect(browser.opens()).toBe(1)
    expect(browser.service.state().running).toBe(true)

    // When the connection ends under the service
    browser.live()?.close()

    // Then the dead session is forgotten, its tab list is gone, and the panels
    // were told - a viewer that keeps showing the last frame of a dead browser
    // is worse than one that says the connection dropped
    expect(browser.service.state().running).toBe(false)
    expect(browser.service.state().tabs).toEqual([])
    expect(browser.service.state().activeTabId).toBeNull()
    expect(browser.service.state().message).toBe('the browser connection dropped')
    expect(events.at(-1)).toMatchObject({ v: 1, kind: 'state' })

    // And the old session was released exactly once
    await vi.waitFor(() => { expect(browser.disposals()).toBe(1) })

    // And the next call starts a new browser rather than failing against the corpse
    const fresh = await browser.service.ensureTab('session-b')
    expect(browser.opens()).toBe(2)
    expect(fresh.id).not.toBe(tab.id)

    // And a successful start clears the message the panels were shown
    expect(browser.service.state().message).toBeUndefined()
    expect(browser.service.state().running).toBe(true)
  })

  it('operator loses a second connection and recovery stays one session per loss', async () => {
    // Given a browser that was already replaced after one loss
    const browser = createRecoverableBrowser()
    await browser.service.ensureTab('session-a')
    browser.live()?.close()
    await browser.service.ensureTab('session-a')
    expect(browser.opens()).toBe(2)

    // When the replacement dies as well
    browser.live()?.close()

    // Then recovery is not confused by the earlier one: still stopped, still one
    // clear message, and the replacement is released once
    expect(browser.service.state().running).toBe(false)
    expect(browser.service.state().message).toBe('the browser connection dropped')
    await vi.waitFor(() => { expect(browser.disposals()).toBe(2) })
  })

  it('operator closes a healthy session and no recovery is attempted afterwards', async () => {
    // Given a running browser the service shuts down deliberately
    const browser = createRecoverableBrowser()
    await browser.service.ensureTab('session-a')
    await browser.service.dispose()

    // When the transport ends as part of that shutdown
    browser.live()?.close()

    // Then disposal is not confused with a crash: nothing is restarted and the
    // service reports itself disposed rather than resurrecting a browser
    expect(browser.service.running).toBe(false)
    await expect(browser.service.ensureTab('session-a')).rejects.toThrow(/disposed/)
    expect(browser.opens()).toBe(1)
  })
})
