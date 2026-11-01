/**
 * The DOM mirror at its two seams: the script that is injected into a watched
 * page, and the recording that comes back over `Runtime.bindingCalled`.
 *
 * The transport is the scripted one from tests/helpers/fake-cdp.ts and the
 * recorder source is a stub, because there is no built artifact in a source
 * checkout. What is asserted here is the contract with the page (what the
 * injected script does, and in what order the host arms it) and the contract
 * with the panel (which events a recording keeps, and when a replayer holding
 * it has to be rebuilt).
 */
import { describe, expect, it } from 'vitest'
import { FakeTransport } from '../helpers/fake-cdp.ts'
import {
  DomMirror,
  MIRROR_BINDING_NAME,
  buildMirrorInjection,
  buildMirrorStop,
  mirrorErrorMessage,
} from '../../src/core/mirror.ts'

/** One rrweb Meta event (type 4). */
function meta(timestamp: number): Record<string, unknown> {
  return { type: 4, data: { width: 1280, height: 800 }, timestamp }
}

/** One rrweb FullSnapshot event (type 2). */
function fullSnapshot(timestamp: number): Record<string, unknown> {
  return { type: 2, data: { node: { id: 1 } }, timestamp }
}

/** One rrweb incremental mutation (type 3). */
function incremental(timestamp: number): Record<string, unknown> {
  return { type: 3, data: { source: 0 }, timestamp }
}

/** A mirror over one scripted transport, with everything it reported. */
function mirrorHarness(): {
  transport: FakeTransport
  mirror: DomMirror
  events: string[]
  failures: Array<{ tabId: string; reason: string }>
} {
  const transport = new FakeTransport()
  transport.responses.set('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: 'mirror-script' }))
  // The bootstrap normally answers with its verdict string; a scripted ok is
  // what a page that accepted the recorder reports.
  transport.responses.set('Runtime.evaluate', () => ({ result: { value: 'ok' } }))
  const events: string[] = []
  const failures: Array<{ tabId: string; reason: string }> = []
  const mirror = new DomMirror({
    transport,
    source: () => '/* RECORDER */',
    onEvent: tabId => { events.push(tabId) },
    onFailure: (tabId, reason) => { failures.push({ tabId, reason }) },
  })
  return { transport, mirror, events, failures }
}

/** Deliver one recorder payload as the browser would. */
function emit(transport: FakeTransport, event: unknown, sessionId = 'session-1', name = MIRROR_BINDING_NAME): void {
  transport.emit('Runtime.bindingCalled', { name, payload: JSON.stringify(event), executionContextId: 1 }, sessionId)
}

describe('injection source assembly', () => {
  it('host injects a script that carries the recorder, emits into the binding, and reports its verdict', () => {
    // Given a recorder bundle and a binding name
    // When the injection source is assembled
    // Then it embeds the bundle, emits into that binding, refuses to record twice and answers ok
    const source = buildMirrorInjection('/* RECORDER BUNDLE */', 'theBinding')

    expect(source).toContain('/* RECORDER BUNDLE */')
    expect(source).toContain('"theBinding"')
    expect(source).toContain('recorder.record({ emit: emit })')
    expect(source).toContain('return "already"')
    expect(source).toContain('return "ok"')
    // The bundle's own trailing source map would otherwise be fetched relative
    // to the watched page's URL, which is a request the host never intends.
    expect(buildMirrorInjection('var x = 1;\n//# sourceMappingURL=rrweb.umd.cjs.map\n')).not.toContain('sourceMappingURL')
  })

  it('host injects a bundle that carries that comment inside one of its own strings', () => {
    // Given a bundle shaped like rrweb's, whose inline worker source contains
    // the same comment as text rather than as a comment (this is exactly what
    // broke the injection once: a line-based strip ate the closing quote)
    const bundle = 'const worker = "(function(){\\n'
      + '//# sourceMappingURL=image-bitmap-data-url-worker.js.map\\n";\n'
      + '//# sourceMappingURL=rrweb.umd.cjs.map\n'

    // When it is injected
    const source = buildMirrorInjection(bundle)

    // Then only the trailing comment is gone and the string body survives intact
    expect(source).toContain('//# sourceMappingURL=image-bitmap-data-url-worker.js.map')
    expect(source).toContain('";')
    expect(source.trimEnd().endsWith('})()')).toBe(true)
    expect(source).not.toContain('//# sourceMappingURL=rrweb.umd.cjs.map')
    // And the result is a script, which is the property the real browser
    // check caught: it has to parse.
    expect(() => { new Function(source) }).not.toThrow()
  })

  it('host injects a script that declines to record in a nested frame', () => {
    // Given the injection source
    // When it is read for what it does in a document that is not the mirrored one
    // Then it returns before loading the recorder, which is what keeps rrweb's
    // own probe iframe from starting a second recorder inside itself (measured
    // at 500 frames in 1.2 seconds before this guard existed)
    const source = buildMirrorInjection('/* RECORDER BUNDLE */')

    expect(source).toContain('if (scope.top !== scope) return "sub-frame"')
    expect(source.indexOf('scope.top !== scope')).toBeLessThan(source.indexOf('RECORDER BUNDLE'))
  })

  it('host injects the recorder into a page that already has rrweb and the page keeps its own copy', () => {
    // Given the injection source
    // When it is read for how it publishes the recorder
    // Then it stores the bundle under a private global and only mirrors it onto window.rrweb when the page has none
    const source = buildMirrorInjection('/* RECORDER BUNDLE */')

    expect(source).toContain('__dshBrowserViewRrweb')
    expect(source).toContain('if (!scope.rrweb) scope.rrweb = scope[EXPOSE]')
    expect(source).toContain('__dshBrowserViewMirror')
  })

  it('host stops a recording and the page keeps whatever else it was doing', () => {
    // Given the stop script
    // When a page has no recording
    // Then the script reports idle rather than throwing, because the document it was aimed at may be gone
    const stop = buildMirrorStop()

    expect(stop).toContain('__dshBrowserViewMirror')
    expect(stop).toContain('return "idle"')
    expect(stop).toContain('recording.stop()')
  })

  it('host reads a recorder that threw inside the page out of the payload stream', () => {
    // Given two payloads, one a recording event and one an error report
    // When each is inspected
    // Then only the error report yields a reason to show
    expect(mirrorErrorMessage({ type: 3, data: {} })).toBeUndefined()
    expect(mirrorErrorMessage({ __dshMirrorError: 'boom' })).toBe('boom')
    expect(mirrorErrorMessage('not an object')).toBeUndefined()
  })
})

describe('arming the recorder', () => {
  it('host asks for the mirror and the tab is armed on its existing page session', () => {
    // Given a mirror over one scripted transport
    // When one tab is mirrored
    // Then the new-document registration, the binding and the bootstrap reach that tab's flat session, in that order
    const { transport, mirror } = mirrorHarness()

    return mirror.start('tab-1', 'session-1').then(() => {
      expect(mirror.isRecording('tab-1')).toBe(true)
      const methods = transport.calls.map(call => `${call.method}:${call.sessionId}`)
      expect(methods).toEqual([
        'Page.addScriptToEvaluateOnNewDocument:session-1',
        'Runtime.addBinding:session-1',
        'Runtime.evaluate:session-1',
      ])
      expect(transport.lastCall('Runtime.addBinding')?.params.name).toBe(MIRROR_BINDING_NAME)
      // The bootstrap carries the same source the new-document registration got.
      const registered = String(transport.lastCall('Page.addScriptToEvaluateOnNewDocument')?.params.source)
      expect(String(transport.lastCall('Runtime.evaluate')?.params.expression)).toBe(registered)
    })
  })

  it('host is asked twice for one tab and the page is injected once', async () => {
    // Given a tab that is already mirrored
    // When a second panel asks for the same tab
    // Then nothing is injected again
    const { transport, mirror } = mirrorHarness()
    await mirror.start('tab-1', 'session-1')
    transport.calls.length = 0

    await mirror.start('tab-1', 'session-1')

    expect(transport.calls).toHaveLength(0)
  })

  it('host cannot inject the recorder and the failure names the page error', async () => {
    // Given a transport whose bootstrap reports a throw from the page
    const { transport, mirror } = mirrorHarness()
    transport.responses.set('Runtime.evaluate', () => ({
      exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: the page forbids eval' } },
    }))

    // When the tab is mirrored
    await expect(mirror.start('tab-1', 'session-1')).rejects.toThrow(/the page forbids eval/)

    // Then nothing is left recording and the new-document registration is withdrawn
    expect(mirror.isRecording('tab-1')).toBe(false)
    expect(transport.callsOf('Page.removeScriptToEvaluateOnNewDocument')).toHaveLength(1)
  })

  it('host cannot read the recorder source and the tab is left untouched', async () => {
    // Given a mirror whose artifact is missing
    const transport = new FakeTransport()
    const mirror = new DomMirror({
      transport,
      source: () => { throw new Error('rrweb.umd.cjs is missing; run pnpm build') },
    })

    // When the tab is mirrored
    await expect(mirror.start('tab-1', 'session-1')).rejects.toThrow(/run pnpm build/)

    // Then no registration was left behind for a future document to trip over
    expect(transport.calls).toHaveLength(0)
  })

  it('host stops a mirror and the registration is withdrawn with the recorder', async () => {
    // Given a mirrored tab
    const { transport, mirror } = mirrorHarness()
    await mirror.start('tab-1', 'session-1')
    transport.calls.length = 0

    // When it is stopped
    await mirror.stop('tab-1')

    // Then the new-document registration and the live recorder are both released
    expect(mirror.isRecording('tab-1')).toBe(false)
    expect(transport.callsOf('Page.removeScriptToEvaluateOnNewDocument')[0]?.params.identifier).toBe('mirror-script')
    expect(transport.callsOf('Runtime.evaluate')).toHaveLength(1)
  })
})

describe('collecting a recording', () => {
  it('host receives a page event and it is appended to that tab in order', async () => {
    // Given a mirrored tab
    const { transport, mirror, events } = mirrorHarness()
    await mirror.start('tab-1', 'session-1')

    // When the recorder emits a meta, a snapshot and one mutation
    emit(transport, meta(1))
    emit(transport, fullSnapshot(2))
    emit(transport, incremental(3))

    // Then the recording is those three, in order, and each append reported the tab
    expect(mirror.recording('tab-1')?.events).toEqual([meta(1), fullSnapshot(2), incremental(3)])
    expect(events).toEqual(['tab-1', 'tab-1', 'tab-1'])
  })

  it('host receives payloads for another binding and they are not part of the recording', async () => {
    // Given a mirrored tab
    const { transport, mirror } = mirrorHarness()
    await mirror.start('tab-1', 'session-1')

    // When a payload arrives for a different binding, a different session and a broken one
    emit(transport, fullSnapshot(1), 'session-1', 'someOtherBinding')
    emit(transport, fullSnapshot(2), 'session-9')
    transport.emit('Runtime.bindingCalled', { name: MIRROR_BINDING_NAME, payload: '{not json' }, 'session-1')

    // Then the recording is still empty of events
    expect(mirror.recording('tab-1')?.events).toEqual([])
  })

  it('host records across a navigation and the retained history starts at the newer snapshot', async () => {
    // Given a recording with a checkpoint and mutations after it
    const { transport, mirror } = mirrorHarness()
    await mirror.start('tab-1', 'session-1')
    emit(transport, meta(1))
    emit(transport, fullSnapshot(2))
    emit(transport, incremental(3))
    const before = mirror.recording('tab-1')

    // When a second document checkpoints
    emit(transport, meta(10))
    emit(transport, fullSnapshot(11))

    // Then the old history is dropped, the Meta travels with its snapshot, and
    // holders of the old array are told to rebuild
    const after = mirror.recording('tab-1')
    expect(after?.events).toEqual([meta(10), fullSnapshot(11)])
    expect(after?.generation).toBeGreaterThan(before?.generation ?? 0)
  })

  it('host recording is bounded and dropping history makes holders rebuild', async () => {
    // Given a mirrored tab
    const { transport, mirror } = mirrorHarness()
    await mirror.start('tab-1', 'session-1')
    emit(transport, fullSnapshot(1))
    const before = mirror.recording('tab-1')?.generation ?? 0

    // When far more mutations arrive than the buffer keeps
    for (let index = 0; index < 4_200; index += 1) emit(transport, incremental(index + 2))

    // Then the buffer is bounded and the generation moved with the drop
    const after = mirror.recording('tab-1')
    expect(after?.events.length).toBeLessThanOrEqual(4_000)
    expect(after?.generation).toBeGreaterThan(before)
  })

  it('host recorder throws inside the page and the mirror reports it instead of going silent', async () => {
    // Given a mirrored tab
    const { transport, mirror, failures } = mirrorHarness()
    await mirror.start('tab-1', 'session-1')
    transport.calls.length = 0

    // When the recorder reports its own failure through the binding
    emit(transport, { __dshMirrorError: 'the page hung' })

    // Then the panel is told why, the recording is forgotten and the
    // registration that would re-arm it on the next document is withdrawn
    expect(failures).toEqual([{ tabId: 'tab-1', reason: 'the recorder stopped inside the page: the page hung' }])
    expect(mirror.isRecording('tab-1')).toBe(false)
    expect(transport.callsOf('Page.removeScriptToEvaluateOnNewDocument')).toHaveLength(1)
  })
})
