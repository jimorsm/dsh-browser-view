/**
 * A browser session the tests can talk to: a real {@link TabManager} and the
 * real {@link BrowserViewService} over the scripted transport.
 *
 * Only the process boundary is faked (no Chrome, no socket); everything above
 * it — tab creation, the ref map, action dispatch, broadcast, dispose order —
 * is the production code path, which is what makes these tests worth anything.
 *
 * @module tests/helpers/fake-browser
 */

import { BrowserViewService, type BrowserSession, type FrameRelay } from '../../src/host/service.ts'
import { TabManager } from '../../src/core/tabs.ts'
import { FakeTransport } from './fake-cdp.ts'

/** One raw snapshot node the fake page reports. */
const FAKE_NODES = [
  { tag: 'body', depth: 0, selector: 'body' },
  { tag: 'h1', depth: 1, selector: 'body > h1', text: 'ok', role: 'heading', name: 'ok' },
  { tag: 'button', depth: 1, selector: 'body > button', role: 'button', name: 'Go' },
]

/** What the fake session exposes to a test. */
export interface FakeBrowser {
  service: BrowserViewService
  transport: FakeTransport
  /** Whether the fake session was disposed. */
  disposed: () => boolean
  /** How many times a session was opened. */
  opens: () => number
}

/**
 * Build a service wired to the scripted transport.
 * @param options - fail the launch, or override the clock.
 * @returns the service plus its test hooks.
 */
export function createFakeBrowser(options: {
  failLaunch?: () => Error | undefined
  now?: () => number
  /** Re-enable the frame-interval budget when the budget itself is under test. */
  frameIntervalMs?: { idle?: number; interactive?: number }
  /** Replace the WebRTC relay, which needs a real peer connection otherwise. */
  createRelay?: () => FrameRelay
} = {}): FakeBrowser {
  const transport = new FakeTransport()
  let tabCounter = 0
  let opens = 0
  let disposed = false

  transport.responses.set('Target.createTarget', () => ({ targetId: `tab-${++tabCounter}` }))
  transport.responses.set('Target.attachToTarget', () => ({ sessionId: `session-${tabCounter}` }))
  transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BYTES' })
  transport.responses.set('Runtime.evaluate', (params: Record<string, unknown>) => {
    const expression = String(params.expression ?? '')
    if (expression.includes('document.querySelector')) {
      return { result: { value: { ok: true, x: 12, y: 34, tag: 'button', name: 'Go' } } }
    }
    if (expression.includes('JSON.stringify({ url')) {
      return { result: { value: JSON.stringify({ url: 'https://a.test/', title: 'A' }) } }
    }
    return { result: { value: { url: 'https://a.test/', title: 'A', nodes: FAKE_NODES, truncated: false } } }
  })
  transport.onSend = (call) => {
    // A navigation settles immediately in the fake, so no test waits on the
    // manager's load grace period.
    if (call.method === 'Page.navigate') transport.emit('Page.loadEventFired', {}, call.sessionId)
  }

  const service = new BrowserViewService({
    now: options.now ?? (() => 500),
    // The default clock here never advances, so the frame-interval budget would
    // suppress every frame after the first. Tests about anything else turn it
    // off; the budget itself is covered in service.spec.ts with a moving clock
    // and by the real defaults.
    frameIntervalMs: options.frameIntervalMs ?? { idle: 0, interactive: 0 },
    ...(options.createRelay === undefined ? {} : { createRelay: options.createRelay }),
    openSession: async (opts): Promise<BrowserSession> => {
      opens += 1
      const failure = options.failLaunch?.()
      if (failure !== undefined) throw failure
      const tabs = new TabManager({
        transport,
        onFrame: opts.onFrame,
        onTabsChanged: opts.onTabsChanged,
      })
      return {
        transport,
        tabs,
        async dispose() { disposed = true },
      }
    },
  })

  return {
    service,
    transport,
    disposed: () => disposed,
    opens: () => opens,
  }
}
