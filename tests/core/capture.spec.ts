/**
 * The tab capture at its two seams: the scripts injected into a watched page,
 * and the chunks that come back over `Runtime.bindingCalled`.
 *
 * The transport is the scripted one from tests/helpers/fake-cdp.ts. What is
 * asserted here is the contract with the page (the verified runbook recipe: the
 * flags-only launch, the title renamed at capture time, `getDisplayMedia` with a
 * user gesture and no audio, `MediaRecorder` forwarding chunks) and the contract
 * with the panel (which chunk starts a recording, and which chunks belong to a
 * recording that has already been replaced).
 */
import { describe, expect, it } from 'vitest'
import { FakeTransport, type RecordedCall } from '../helpers/fake-cdp.ts'
import {
  CAPTURE_BITS_PER_SECOND,
  CAPTURE_TIMESLICE_MS,
  TAB_CAPTURE_BINDING_NAME,
  TAB_CAPTURE_SENTINEL_TITLE,
  TabCapture,
  buildCaptureRename,
  buildCaptureRestore,
  buildCaptureStart,
  buildCaptureStop,
  captureErrorMessage,
} from '../../src/core/capture.ts'

/**
 * A capture over one scripted transport, with everything it reported.
 *
 * The `Runtime.evaluate` responder answers the three calls the capture makes in
 * the order it makes them, keyed on the shape of each expression.
 */
function captureHarness(): {
  transport: FakeTransport
  capture: TabCapture
  chunks: Array<{ tabId: string; data: string }>
  failures: Array<{ tabId: string; reason: string }>
  losses: Array<{ tabId: string; reason: string }>
} {
  const transport = new FakeTransport()
  transport.responses.set('Runtime.evaluate', (params: Record<string, unknown>) => {
    const expression = String(params.expression ?? '')
    // The rename reports the title it replaced; the stop reports its tracks.
    if (expression.includes('SENTINEL')) return { result: { value: 'Original title' } }
    if (expression.includes('getDisplayMedia')) return { result: { value: 'ok' } }
    if (expression.includes('capture.recorder')) {
      return { result: { value: { stopped: true, tracks: 1, ended: 1 } } }
    }
    return { result: { value: undefined } }
  })
  const chunks: Array<{ tabId: string; data: string }> = []
  const failures: Array<{ tabId: string; reason: string }> = []
  const losses: Array<{ tabId: string; reason: string }> = []
  const capture = new TabCapture({
    transport,
    onChunk: (tabId, chunk) => { chunks.push({ tabId, data: chunk.data }) },
    onFailure: (tabId, reason) => { failures.push({ tabId, reason }) },
    onLost: (tabId, reason) => { losses.push({ tabId, reason }) },
  })
  return { transport, capture, chunks, failures, losses }
}

/** Every evaluate that asked for the tab's surface. */
function startCalls(transport: FakeTransport): RecordedCall[] {
  return transport.callsOf('Runtime.evaluate').filter(call => String(call.params.expression).includes('getDisplayMedia'))
}

/** Every evaluate that released the capture. */
function stopCalls(transport: FakeTransport): RecordedCall[] {
  return transport.callsOf('Runtime.evaluate').filter(call => String(call.params.expression).includes('capture.recorder'))
}

/** Every evaluate that touched the capture title. */
function titleCalls(transport: FakeTransport): RecordedCall[] {
  return transport.callsOf('Runtime.evaluate').filter(call => String(call.params.expression).includes('SENTINEL'))
}

/** The token the recorder was handed, read out of the expression the page runs. */
function startedToken(transport: FakeTransport): string {
  const call = startCalls(transport).at(-1)
  const match = /var TOKEN = "([^"]+)"/.exec(String(call?.params.expression ?? ''))
  if (match === null) throw new Error('the capture bootstrap carried no token')
  return match[1]
}

/** Deliver one recorder payload as the browser would. */
function emit(transport: FakeTransport, payload: unknown, sessionId = 'session-1'): void {
  transport.emit('Runtime.bindingCalled', {
    name: TAB_CAPTURE_BINDING_NAME,
    payload: JSON.stringify(payload),
    executionContextId: 1,
  }, sessionId)
}

describe('the capture scripts', () => {
  it('host injects the recipe: current tab, no audio, user gesture taken by the caller', () => {
    // Given the script the host evaluates to open one tab capture
    // When it is read for the recipe the runbook verified
    // Then it asks for the browser surface of the current tab with no audio,
    // and records it as VP8 WebM at the measured bitrate in 200 ms slices
    const source = buildCaptureStart({ token: 't1' })

    expect(source).toContain('navigator.mediaDevices.getDisplayMedia')
    expect(source).toContain('displaySurface: "browser"')
    expect(source).toContain('audio: false')
    expect(source).toContain('preferCurrentTab: true')
    expect(source).toContain('selfBrowserSurface: "include"')
    expect(source).toContain(`var MIME = ${JSON.stringify('video/webm;codecs=vp8')}`)
    expect(source).toContain(`var BITS = ${CAPTURE_BITS_PER_SECOND}`)
    expect(source).toContain(`var TIMESLICE = ${CAPTURE_TIMESLICE_MS}`)
    expect(source).toContain('recorder.start(TIMESLICE)')
    // No audio codec anywhere: this product has no audio path at all.
    expect(source).not.toContain('opus')
    expect(source).not.toContain('audioTracks')
  })

  it('host injects a bootstrap that declines a nested frame and reports through the binding', () => {
    // Given the injection source
    // When it is read for what it does in a document that is not the watched one
    // Then it returns before asking for a capture, and every outcome travels
    // back as the evaluate verdict or as a binding error report
    const source = buildCaptureStart({ token: 't1' })

    expect(source).toContain('if (scope.top !== scope) return "sub-frame"')
    expect(source.indexOf('scope.top !== scope')).toBeLessThan(source.indexOf('getDisplayMedia'))
    expect(source).toContain('return "already"')
    expect(source).toContain('return "ok"')
    expect(source).toContain('return "failed:"')
    expect(source).toContain('__dshCaptureError')
    // The chunk goes out with the recording's own token, which is what lets a
    // chunk that outlived its recording be dropped rather than spliced.
    expect(source).toContain('{ chunk: base64, token: TOKEN }')
    // And the page bounds its own backlog by pausing the recorder.
    expect(source).toContain('recorder.pause()')
    expect(source).toContain('recorder.resume()')
    // The result is a script, which is the property a real browse catches: it
    // has to parse.
    expect(() => { new Function('return ' + source) }).not.toThrow()
  })

  it('host renames the tab for the capture and puts the page own title back afterwards', () => {
    // Given the rename and restore expressions
    // When a page whose title moved on during the capture is restored
    // Then the sentinel is what is taken off, never a title the page has since
    // written itself, and the pre-capture title is only put back if it still holds
    const rename = buildCaptureRename()
    expect(rename).toContain(JSON.stringify(TAB_CAPTURE_SENTINEL_TITLE))
    expect(rename).toContain('return previous')

    const restore = buildCaptureRestore('Original title')
    expect(restore).toContain('if (document.title !== SENTINEL) return "kept"')
    expect(restore).toContain('document.title = ORIGINAL')
    expect(restore).toContain(JSON.stringify('Original title'))
  })

  it('host stop script releases the recorder and every track and reports them', () => {
    // Given the stop script
    // When a page has a live capture
    // Then it stops the recorder, stops each track, reports how many ended and
    // clears the private global so a restart cannot adopt the old stream
    const stop = buildCaptureStop()

    expect(stop).toContain('capture.recorder.stop()')
    expect(stop).toContain('list[index].stop()')
    expect(stop).toContain('readyState === "ended"')
    expect(stop).toContain('return { stopped: true, tracks: tracks, ended: ended }')
    expect(stop).toContain('= undefined')
  })

  it('host reads a page-reported capture failure out of the payload stream', () => {
    // Given a chunk payload and an error payload
    // When each is inspected
    // Then only the error payload yields a reason to show
    expect(captureErrorMessage({ chunk: 'AAAA', token: 't1' })).toBeUndefined()
    expect(captureErrorMessage({ __dshCaptureError: 'the tab capture ended' })).toBe('the tab capture ended')
    expect(captureErrorMessage('not an object')).toBeUndefined()
  })
})

describe('arming the capture', () => {
  it('host asks for the lane and the tab is renamed before the surface is requested', async () => {
    // Given one scripted transport
    // When one tab is captured
    // Then the rename, the binding and the getDisplayMedia bootstrap reach that
    // tab's flat session in that order, and both page calls carry a user gesture
    const { transport, capture } = captureHarness()

    await capture.start('tab-1', 'session-1')

    expect(capture.isCapturing('tab-1')).toBe(true)
    const methods = transport.calls.map(call => `${call.method}:${call.sessionId}`)
    expect(methods).toEqual([
      'Runtime.evaluate:session-1',
      'Runtime.addBinding:session-1',
      'Runtime.evaluate:session-1',
    ])
    // The rename is the first call: the launch flag matches the title at
    // capture time, so the browser must have the sentinel before the request.
    expect(String(transport.calls[0]?.params.expression)).toContain(TAB_CAPTURE_SENTINEL_TITLE)
    expect(transport.calls[0]?.params.userGesture).toBe(true)
    expect(transport.lastCall('Runtime.addBinding')?.params.name).toBe(TAB_CAPTURE_BINDING_NAME)
    expect(transport.calls[2]?.params.userGesture).toBe(true)
    expect(transport.calls[2]?.params.awaitPromise).toBe(true)
    expect(transport.calls[2]?.params.expression).toBe(buildCaptureStart({ token: startedToken(transport) }))
  })

  it('host is asked for one tab twice and the older recording is released first', async () => {
    // Given a tab that is already capturing
    const { transport, capture } = captureHarness()
    await capture.start('tab-1', 'session-1')
    transport.calls.length = 0

    // When the host re-anchors it, which is what a late-joining panel triggers
    await capture.start('tab-1', 'session-1')

    // Then the old recorder and its tracks are released before a fresh header is
    // requested, and the new recording carries a token of its own
    expect(stopCalls(transport).length).toBeGreaterThan(0)
    expect(startCalls(transport)).toHaveLength(1)
    expect(startedToken(transport)).toBe('capture-2')
  })

  it('host cannot open the surface and the failure names the page error and cleans up', async () => {
    // Given a transport whose capture bootstrap throws the SecurityError a
    // page that refuses the capture would produce
    const { transport, capture } = captureHarness()
    transport.responses.set('Runtime.evaluate', (params: Record<string, unknown>) => {
      const expression = String(params.expression ?? '')
      if (expression.includes('SENTINEL')) return { result: { value: 'Original title' } }
      if (expression.includes('getDisplayMedia')) {
        return { exceptionDetails: { text: 'Uncaught', exception: { description: 'NotAllowedError: permission denied' } } }
      }
      if (expression.includes('capture.recorder')) {
        return { result: { value: { stopped: false, tracks: 0, ended: 0 } } }
      }
      return { result: { value: undefined } }
    })

    // When the tab is captured
    await expect(capture.start('tab-1', 'session-1')).rejects.toThrow(/permission denied/)

    // Then nothing is left recording, the recorder is released and the sentinel
    // is taken off the page even though the capture never started
    expect(capture.isCapturing('tab-1')).toBe(false)
    expect(stopCalls(transport).length).toBeGreaterThan(0)
    expect(titleCalls(transport).length).toBeGreaterThanOrEqual(2)
  })

  it('host stops a capture and the recorder, the tracks and the title are all released', async () => {
    // Given a capturing tab
    const { transport, capture } = captureHarness()
    await capture.start('tab-1', 'session-1')
    transport.calls.length = 0

    // When it is stopped
    const report = await capture.stop('tab-1')

    // Then the page released one recorder and one track, the title went back and
    // the tab is no longer capturing
    expect(report).toEqual({ stopped: true, tracks: 1, ended: 1 })
    expect(capture.isCapturing('tab-1')).toBe(false)
    expect(stopCalls(transport)).toHaveLength(1)
    expect(titleCalls(transport)).toHaveLength(1)
    expect(String(titleCalls(transport)[0]?.params.expression)).toContain('Original title')
  })

  it('host stops a tab that was never capturing and nothing is evaluated', async () => {
    // Given a tab with no capture
    const { transport, capture } = captureHarness()

    // When it is stopped anyway, which every cleanup path does unconditionally
    const report = await capture.stop('tab-1')

    // Then the call is a no-op that says so rather than an error
    expect(report).toEqual({ stopped: false, tracks: 0, ended: 0 })
    expect(transport.calls).toHaveLength(0)
  })
})

describe('collecting a capture', () => {
  it('host receives a chunk and it is handed to the tab in order', async () => {
    // Given a capturing tab
    const { transport, capture, chunks } = captureHarness()
    await capture.start('tab-1', 'session-1')

    // When the recorder emits two chunks
    emit(transport, { chunk: 'HEADER', token: startedToken(transport) })
    emit(transport, { chunk: 'CLUSTER', token: startedToken(transport) })

    // Then both arrive under that tab, unmodified and in order
    expect(chunks).toEqual([
      { tabId: 'tab-1', data: 'HEADER' },
      { tabId: 'tab-1', data: 'CLUSTER' },
    ])
  })

  it('host receives a chunk from a replaced recording and it is dropped', async () => {
    // Given a tab whose first recording was replaced
    const { transport, capture, chunks } = captureHarness()
    await capture.start('tab-1', 'session-1')
    const first = startedToken(transport)
    await capture.start('tab-1', 'session-1')
    const second = startedToken(transport)
    expect(first).not.toBe(second)

    // When a chunk of the old recording arrives late
    emit(transport, { chunk: 'STALE', token: first })
    emit(transport, { chunk: 'FRESH', token: second })

    // Then only the chunk of the recording that is actually running is delivered
    expect(chunks).toEqual([{ tabId: 'tab-1', data: 'FRESH' }])
  })

  it('host receives payloads for another binding, another session or a broken one and they are ignored', async () => {
    // Given a capturing tab
    const { transport, capture, chunks } = captureHarness()
    await capture.start('tab-1', 'session-1')
    const token = startedToken(transport)

    // When a payload arrives for a different binding, from a different session,
    // untagged, and one that is not JSON at all
    emit(transport, { chunk: 'OTHER', token })
    transport.emit('Runtime.bindingCalled', { name: 'someOtherBinding', payload: '{"chunk":"X"}', executionContextId: 1 }, 'session-1')
    emit(transport, { chunk: 'OTHER-SESSION', token }, 'session-9')
    emit(transport, { chunk: 'UNTAGGED' })
    transport.emit('Runtime.bindingCalled', { name: TAB_CAPTURE_BINDING_NAME, payload: '{not json', executionContextId: 1 }, 'session-1')

    // Then none of them reached the panel
    expect(chunks).toEqual([{ tabId: 'tab-1', data: 'OTHER' }])
  })

  it('host recorder dies inside the page and the capture reports it instead of going silent', async () => {
    // Given a capturing tab
    const { transport, capture, failures } = captureHarness()
    await capture.start('tab-1', 'session-1')
    const token = startedToken(transport)
    transport.calls.length = 0

    // When the page reports that its stream ended
    emit(transport, { __dshCaptureError: 'the tab capture ended', token })

    // Then the panel is told why, the tab is forgotten and the title went back
    expect(failures).toEqual([{ tabId: 'tab-1', reason: 'the tab capture stopped inside the page: the tab capture ended' }])
    expect(capture.isCapturing('tab-1')).toBe(false)
    expect(titleCalls(transport)).toHaveLength(1)
  })

  it('host sees the watched page navigate and reports a loss instead of a failure', async () => {
    // Given a capturing tab
    const { transport, capture, failures, losses } = captureHarness()
    await capture.start('tab-1', 'session-1')
    transport.calls.length = 0

    // When the top-level document is replaced
    transport.emit('Page.frameNavigated', { frame: { url: 'https://b.test/', loaderId: 'loader-2' } }, 'session-1')

    // Then the recording is forgotten and the loss is reported as a loss: there
    // is nothing to stop or restore in a document that no longer exists, and the
    // host gets to arm a new recorder instead of falling back to pixels
    expect(losses).toEqual([{ tabId: 'tab-1', reason: 'the watched page navigated while it was being recorded' }])
    expect(failures).toEqual([])
    expect(capture.isCapturing('tab-1')).toBe(false)
    expect(transport.calls).toHaveLength(0)
  })

  it('host sees a nested frame navigate and the recording is left alone', async () => {
    // Given a capturing tab
    const { transport, capture, losses } = captureHarness()
    await capture.start('tab-1', 'session-1')

    // When a sub-frame navigates, which does not replace the tab's document
    transport.emit('Page.frameNavigated', {
      frame: { url: 'https://ad.test/', loaderId: 'loader-9', parentId: 'frame-1' },
    }, 'session-1')

    // Then the recorder keeps running and nothing was reported
    expect(losses).toEqual([])
    expect(capture.isCapturing('tab-1')).toBe(true)
  })

  it('host disposes the capture and every recording is released first', async () => {
    // Given two capturing tabs
    const { transport, capture } = captureHarness()
    await capture.start('tab-1', 'session-1')
    await capture.start('tab-2', 'session-1')
    expect(capture.capturingTabs().sort()).toEqual(['tab-1', 'tab-2'])
    transport.calls.length = 0

    // When the transport is being torn down
    await capture.dispose()

    // Then each recording was stopped before the listener was detached, so no
    // sentinel title is left on either page
    expect(capture.capturingTabs()).toEqual([])
    expect(stopCalls(transport)).toHaveLength(2)
    transport.calls.length = 0
    expect(() => { emit(transport, { chunk: 'AFTER', token: 'capture-1' }) }).not.toThrow()
  })
})
