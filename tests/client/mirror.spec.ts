// @vitest-environment jsdom
/**
 * The production mirror factory: rrweb's own replayer, wired the way a live
 * recording needs.
 *
 * The panel tests inject a fake factory (jsdom cannot host a real replay), so
 * this is the only place the shipped wiring is asserted: rrweb is mocked at the
 * module boundary, and what is checked is the contract the panel depends on -
 * built empty, started live, fed through `addEvent`, destroyed on request.
 *
 * The replay itself is verified against a real browser, in the host harness;
 * what a mock can prove is only that the calls are the documented ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** What the mocked rrweb recorded, hoisted because vi.mock runs before imports. */
const rrwebMock = vi.hoisted(() => ({
  /** Every call the replayer received, in order. */
  calls: [] as string[],
  /**
   * The images the replayed document reports; tests push fake <img> records
   * shaped like HTMLImageElement (src, complete, naturalWidth, dataset).
   */
  images: [] as Array<{ src: string; complete: boolean; naturalWidth: number; referrerPolicy: string; dataset: Record<string, string> }>,
  /** Config the replayer was constructed with. */
  config: undefined as { root?: unknown; liveMode?: unknown } | undefined,
  /** Events the replayer was constructed with. */
  eventsAtBuild: [] as unknown[],
  /** Baseline the live replay was started from. */
  baseline: undefined as unknown,
}))

vi.mock('rrweb', () => ({
  Replayer: class {
    iframe = {
      contentDocument: {
        images: rrwebMock.images,
      },
    }

    constructor(events: unknown[], config: { root?: unknown; liveMode?: unknown }) {
      rrwebMock.calls.push('construct')
      rrwebMock.config = config
      rrwebMock.eventsAtBuild = events
    }

    addEvent(event: { type?: number }): void {
      rrwebMock.calls.push(`add:${String(event?.type)}`)
    }

    startLive(baselineTime?: number): void {
      rrwebMock.calls.push('startLive')
      rrwebMock.baseline = baselineTime
    }

    destroy(): void {
      rrwebMock.calls.push('destroy')
    }
  },
}))

import { createRrwebMirror, liveBaseline } from '../../src/client/mirror.ts'

beforeEach(() => {
  rrwebMock.calls.length = 0
  rrwebMock.images.length = 0
  rrwebMock.config = undefined
  rrwebMock.eventsAtBuild = []
  rrwebMock.baseline = undefined
})

describe('rrweb replayer wiring', () => {
  it('the panel builds a live replayer over its own root and feeds it the checkpoint', async () => {
    // Given a root element and one checkpoint batch
    const root = document.createElement('div')

    // When the mirror factory builds a replayer
    const handle = await createRrwebMirror(root, [{ type: 4, timestamp: 1_700_000_000_000 }, { type: 2, timestamp: 1_700_000_000_010 }])

    // Then it was built empty for live mode over that root, started live FROM
    // THE RECORDING'S OWN CLOCK, and the batch travelled through addEvent - the
    // only path a live player applies
    expect(rrwebMock.config).toEqual({ root, liveMode: true })
    expect(rrwebMock.eventsAtBuild).toEqual([])
    expect(rrwebMock.baseline).toBe(1_700_000_000_000)
    expect(rrwebMock.calls).toEqual(['construct', 'startLive', 'add:4', 'add:2'])
    expect(handle).toBeDefined()
  })

  it('the replayed images are refitted to no-referrer, and a failed one is re-requested', async () => {
    // Given a CDN that hotlink-protects: a foreign origin as Referer is a 403
    // while an empty one is a 200 (measured on bilibili's). One image already
    // failed under the panel's origin; one has not loaded yet.
    vi.useFakeTimers()
    try {
      const broken = { src: 'https://cdn.test/a.png', complete: true, naturalWidth: 0, referrerPolicy: '', dataset: {} as Record<string, string> }
      const fresh = { src: 'https://cdn.test/b.png', complete: false, naturalWidth: 0, referrerPolicy: '', dataset: {} as Record<string, string> }
      rrwebMock.images.push(broken, fresh)

      // When a checkpoint batch is applied
      const handle = await createRrwebMirror(document.createElement('div'), [{ type: 2, timestamp: 1_700_000_000_000 }])
      await vi.advanceTimersByTimeAsync(400)

      // Then both carry the no-referrer policy and the already-failed one was
      // re-requested - an image stays broken until it is asked for again
      expect(broken.referrerPolicy).toBe('no-referrer')
      expect(broken.dataset.refit).toBe('1')
      expect(broken.src).toBe('https://cdn.test/a.png')
      expect(fresh.referrerPolicy).toBe('no-referrer')
      expect(fresh.dataset.refit).toBe('1')

      // And teardown releases the pending refit without throwing
      handle.destroy()
      await vi.advanceTimersByTimeAsync(400)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a live event reaches the running player and teardown destroys it', async () => {
    // Given a built mirror
    const handle = await createRrwebMirror(document.createElement('div'), [{ type: 2, timestamp: 1_700_000_000_000 }])

    // When a live event is pushed and the panel tears the mirror down
    handle.addEvent({ type: 3 })
    handle.destroy()

    // Then the event went to the same player and the player released its DOM
    expect(rrwebMock.calls).toEqual(['construct', 'startLive', 'add:2', 'add:3', 'destroy'])
  })
})

describe('live replay baseline', () => {
  it('the panel starts a replay from the recording\'s own first event, not from now', () => {
    // Given a checkpoint batch recorded in the past
    const events = [{ type: 4, timestamp: 1_700_000_000_000 }, { type: 2, timestamp: 1_700_000_000_010 }]

    // When the baseline is resolved
    // Then it is the recording's first timestamp: rrweb drops increments fed
    // behind a baseline of "now" (staged in a virtual tree that never flushes)
    expect(liveBaseline(events)).toBe(1_700_000_000_000)
  })

  it('the panel starts an empty replay from now, so the first batch still draws', () => {
    // Given no checkpoint yet
    const before = Date.now()

    // When the baseline is resolved
    const baseline = liveBaseline([])

    // Then it falls back to the wall clock
    expect(baseline).toBeGreaterThanOrEqual(before)
    expect(baseline).toBeLessThanOrEqual(Date.now())
  })
})
