/**
 * The tab-capture lane: the watched tab's own compositor output, recorded in the
 * page and streamed to the panel.
 *
 * Why this exists beside the other two lanes. The pixel lane draws a `<video>`
 * but at still-frame cost (measured on this repository's own fixtures: 1472 kbps
 * for the same page the capture records at 400-713 kbps), and the DOM mirror
 * draws a `<video>` element as an empty box. The obvious answer - capture the
 * element with `HTMLMediaElement.captureStream()` - is refused by the browser for
 * exactly the case that matters: a page's media is normally on a cross-origin
 * CDN, and `captureStream()` on a cross-origin (tainted) element throws
 * `SecurityError`; so does `file://`, which is an opaque origin even next to its
 * own page. Tab capture asks the browser for the tab's surface instead of asking
 * the element for its decoded frames, so the origin of the media inside it never
 * enters into it.
 *
 * The recipe is not obvious and every part of it is load-bearing:
 *
 * 1. Chromium is launched with `--auto-select-tab-capture-source-by-title=<sentinel>`
 *    plus `--use-fake-ui-for-media-stream` and `--enable-usermedia-screen-capturing`
 *    (see src/core/chrome.ts). The first skips the source picker by title; the
 *    other two make `getDisplayMedia` answer without a user prompt, which a
 *    headless browser could never satisfy.
 * 2. The flag matches the title **at capture time**, not at launch. So the host
 *    renames the watched tab to the sentinel immediately before asking for the
 *    stream ({@link buildCaptureRename}) and restores it when the lane stops.
 *    This is what makes the lane work on pages nobody knew about at launch.
 * 3. The request must carry a user gesture: `Runtime.evaluate` with
 *    `userGesture: true`. Without it `getDisplayMedia` is rejected as if it were
 *    an unsolicited popup.
 * 4. Audio is asked for as `false` and the container has no audio codec. This is
 *    a product decision, not a limitation: browser-view has no audio path
 *    anywhere (the browser runs with `--mute-audio`), so capturing it would only
 *    add bytes and a second failure mode.
 *
 * Forwarding. `MediaRecorder` emits chunks every 200 ms; the page converts each
 * to base64 and pushes it into a `Runtime.addBinding` binding, exactly like the
 * DOM mirror ships recording events. Chunks carry the recording's token, so a
 * chunk still in flight when a recording is replaced is dropped instead of being
 * spliced into its successor.
 *
 * Backpressure. A binding call is synchronous page-side, so the pressure is in
 * the host and in the panel socket, not in a promise queue - but a page whose
 * host has stopped reading must not grow either. The injected recorder serializes
 * conversions through one promise chain and counts the blobs waiting in it; when
 * that count passes a small ceiling it **pauses the recorder** and resumes it
 * once the chain drains. The host applies the other half of the bound on the way
 * out (see `BrowserViewSink.bufferedAmount` in src/host/service.ts): a panel
 * whose socket is already holding more than a fixed ceiling is skipped rather
 * than queued for.
 *
 * Session. Like the mirror, every call here is a page-domain call (`Runtime.*`),
 * and this repository's CDP client runs flat against the browser-level socket
 * where those are rejected with `-32601`. The collector therefore rides the
 * per-tab session `TabManager` already attached (`TabManager.sessionOf`).
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/capture
 */

import type { CdpTransport } from './cdp.ts'
import { CAPTURE_MIME } from './protocol.ts'

/**
 * Title the watched tab is given while it is being captured.
 *
 * A fixed sentinel, not the page's own title: the launch switch names this
 * string, and the host sets the tab's title to it a moment before asking for the
 * stream. It is deliberately unlikely to collide with a real page title (the
 * runbook's spike used this exact string).
 */
export const TAB_CAPTURE_SENTINEL_TITLE = 'BV-SENTINEL-7f3a'

/**
 * Global the binding is installed as. Named after the plugin rather than
 * something short: it lands on the watched page's `window`, which may be a page
 * the agent does not own.
 */
export const TAB_CAPTURE_BINDING_NAME = 'dshBrowserViewTabCapture'

/** Private global holding the live recorder and its stream. */
const CAPTURE_KEY = '__dshBrowserViewCapture'

/** Recorder bitrate; the runbook's spike measured ~400-713 kbps of real output. */
export const CAPTURE_BITS_PER_SECOND = 1_500_000

/** Chunk cadence: five chunks a second is smooth enough and small enough. */
export const CAPTURE_TIMESLICE_MS = 200

/**
 * Blobs the page may have queued for conversion before it pauses the recorder.
 *
 * Small on purpose. Each blob is one 200 ms slice (tens of kilobytes), so this
 * bounds the page's own backlog to well under a megabyte; a host that has truly
 * stopped reading gets a paused recorder instead of a growing array.
 */
export const CAPTURE_PAGE_QUEUE_LIMIT = 8

/** Payload field the page uses to report a failure of its own recorder. */
export const CAPTURE_ERROR_FIELD = '__dshCaptureError'

/** One chunk as it arrived from the page, before it is framed for the panel. */
export interface CaptureChunk {
  /** Base64 WebM bytes. */
  readonly data: string
}

/** What one disposal of a capture actually achieved, for diagnostics and tests. */
export interface CaptureStopReport {
  /**
   * Whether a capture was running when stop was asked for. `false` means the
   * document was already gone (a navigation replaces the recorder with it).
   */
  readonly stopped: boolean
  /** Tracks the stream held. */
  readonly tracks: number
  /** Tracks whose `readyState` was `ended` right after the stop, so the
   *  display-capture indicator is gone rather than merely unfed. */
  readonly ended: number
}

/**
 * The error a payload reports, or undefined when the payload carries a chunk.
 * @param payload - one decoded binding payload.
 * @returns the error text when the page reported one.
 */
export function captureErrorMessage(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const reported = (payload as Record<string, unknown>)[CAPTURE_ERROR_FIELD]
  return typeof reported === 'string' ? reported : undefined
}

/** The token a payload belongs to, or undefined when it does not say. */
function payloadToken(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const token = (payload as Record<string, unknown>).token
  return typeof token === 'string' ? token : undefined
}

/** The base64 chunk a payload carries, or undefined when it carries none. */
function payloadChunk(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const chunk = (payload as Record<string, unknown>).chunk
  return typeof chunk === 'string' && chunk.length > 0 ? chunk : undefined
}

/**
 * Rename the watched tab to the sentinel, reporting the title it replaced.
 *
 * One expression rather than two calls: reading `document.title` first and
 * renaming second would leave a window in which the page changes its own title
 * and the restore puts back a value the page has already moved past. The rename
 * is a DOM assignment the browser has processed before the renderer sends the
 * next `getDisplayMedia` request, which is why the tab-source match a moment
 * later sees the sentinel.
 * @param sentinel - title the tab is given while capturing.
 * @returns the expression to evaluate (with `userGesture: true`).
 */
export function buildCaptureRename(sentinel: string = TAB_CAPTURE_SENTINEL_TITLE): string {
  return [
    '(function () {',
    `  var SENTINEL = ${JSON.stringify(sentinel)};`,
    '  var previous = typeof document === "undefined" ? "" : document.title;',
    '  try {',
    '    document.title = SENTINEL;',
    '  } catch (ignored) {',
    '    /* A document that refuses a title change is reported by the caller\'s',
    '       next step, which will not find the sentinel. */',
    '  }',
    '  return previous;',
    '})()',
  ].join('\n')
}

/**
 * Put the page's own title back, but only if the sentinel is still on it.
 *
 * Conditional on purpose: a capture can run for minutes, and a page that renamed
 * itself meanwhile (an SPA route change, a player updating its title) must not
 * have that newer title overwritten by the stale pre-capture one. The sentinel
 * is what must not survive; the page's own title is not this host's to manage.
 * @param original - title the tab had before the sentinel was applied.
 * @param sentinel - the sentinel to strip.
 * @returns the expression to evaluate.
 */
export function buildCaptureRestore(
  original: string,
  sentinel: string = TAB_CAPTURE_SENTINEL_TITLE,
): string {
  return [
    '(function () {',
    `  var SENTINEL = ${JSON.stringify(sentinel)};`,
    `  var ORIGINAL = ${JSON.stringify(original)};`,
    '  if (typeof document === "undefined") return "no-document";',
    '  if (document.title !== SENTINEL) return "kept";',
    '  document.title = ORIGINAL;',
    '  return "restored";',
    '})()',
  ].join('\n')
}

/** Options for {@link buildCaptureStart}. */
export interface CaptureStartOptions {
  /** Binding the recorder pushes chunks into. @default TAB_CAPTURE_BINDING_NAME */
  bindingName?: string
  /** Token stamped on every payload, so a replaced recording's chunks are dropped. */
  token: string
  /** Container/codec to record. @default CAPTURE_MIME */
  mime?: string
  /** Target bitrate. @default CAPTURE_BITS_PER_SECOND */
  bitsPerSecond?: number
  /** Chunk cadence. @default CAPTURE_TIMESLICE_MS */
  timesliceMs?: number
  /** Blobs allowed to queue before the recorder pauses. @default CAPTURE_PAGE_QUEUE_LIMIT */
  queueLimit?: number
}

/**
 * Build the one script that opens the tab capture and starts recording.
 *
 * Self-contained and awaited: the host evaluates it with `awaitPromise: true`
 * and `userGesture: true`, and its return value is the only synchronous channel
 * back, so it says exactly what happened (`ok`, `no-window`, `sub-frame`,
 * `already`, `no-api`, `unsupported`, `failed:<reason>`).
 *
 * - The top-level-frame guard is the mirror's lesson applied here: a
 *   registration that ran in every document of a page full of iframes would ask
 *   for a capture once per frame, and each request would target the same tab.
 * - `isTypeSupported` is checked before constructing the recorder, so a browser
 *   without VP8-in-WebM fails as a readable reason instead of as a
 *   `NotSupportedError` the host would have to guess at.
 * - The recorder's `ended` track listener is the one failure the host cannot see
 *   otherwise: a capture the browser stops on its own (the share was revoked, the
 *   tab was closed) leaves the panel on a frozen last frame. Reporting it through
 *   the binding is what turns that into the pixel-lane fallback and the reason.
 * @param options - binding, token, codec and the backpressure bound.
 * @returns the script to evaluate.
 */
export function buildCaptureStart(options: CaptureStartOptions): string {
  const bindingName = options.bindingName ?? TAB_CAPTURE_BINDING_NAME
  const mime = options.mime ?? CAPTURE_MIME
  const bits = options.bitsPerSecond ?? CAPTURE_BITS_PER_SECOND
  const timeslice = options.timesliceMs ?? CAPTURE_TIMESLICE_MS
  const queueLimit = options.queueLimit ?? CAPTURE_PAGE_QUEUE_LIMIT
  return [
    '(async function () {',
    `  var BINDING = ${JSON.stringify(bindingName)};`,
    `  var KEY = ${JSON.stringify(CAPTURE_KEY)};`,
    `  var TOKEN = ${JSON.stringify(options.token)};`,
    `  var MIME = ${JSON.stringify(mime)};`,
    `  var BITS = ${bits};`,
    `  var TIMESLICE = ${timeslice};`,
    `  var QUEUE_LIMIT = ${queueLimit};`,
    '  var scope = typeof window === "undefined" ? null : window;',
    '  if (scope === null) return "no-window";',
    '  if (scope.top !== scope) return "sub-frame";',
    '  if (scope[KEY] && scope[KEY].token === TOKEN) return "already";',
    '  if (!scope.navigator || !scope.navigator.mediaDevices',
    '      || typeof scope.navigator.mediaDevices.getDisplayMedia !== "function") return "no-api";',
    '  if (typeof scope.MediaRecorder !== "function") return "no-api";',
    '  if (typeof scope.MediaRecorder.isTypeSupported === "function"',
    '      && !scope.MediaRecorder.isTypeSupported(MIME)) return "unsupported";',
    '  var report = function (message) {',
    '    try {',
    '      scope[BINDING](JSON.stringify({ ' + JSON.stringify(CAPTURE_ERROR_FIELD) + ': String(message), token: TOKEN }));',
    '    } catch (ignored) {',
    '      /* The binding is absent when the host stopped listening; a capture',
    '         must never throw into the page it is watching. */',
    '    }',
    '  };',
    '  var toBase64 = function (blob) {',
    '    return new Promise(function (resolve, reject) {',
    '      var reader = new FileReader();',
    '      reader.onerror = function () { reject(reader.error || new Error("could not read a recorder chunk")) };',
    '      reader.onload = function () {',
    '        var text = String(reader.result);',
    '        var comma = text.indexOf(",");',
    '        resolve(comma < 0 ? "" : text.slice(comma + 1));',
    '      };',
    '      reader.readAsDataURL(blob);',
    '    });',
    '  };',
    '  try {',
    '    var stream = await scope.navigator.mediaDevices.getDisplayMedia({',
    '      video: { displaySurface: "browser" },',
    // No audio, ever: this product has no audio path, and the browser is
    // launched with --mute-audio, so an audio track could only be silence.
    '      audio: false,',
    '      preferCurrentTab: true,',
    '      selfBrowserSurface: "include",',
    '    });',
    '    var recorder = new scope.MediaRecorder(stream, { mimeType: MIME, videoBitsPerSecond: BITS });',
    '    var chain = Promise.resolve();',
    '    var queued = 0;',
    '    var paused = false;',
    '    var release = function () {',
    '      if (!paused || queued > 0) return;',
    '      paused = false;',
    '      try { if (typeof recorder.resume === "function") recorder.resume() } catch (ignored) {}',
    '    };',
    '    recorder.ondataavailable = function (event) {',
    '      if (!event || !event.data || event.data.size === 0) return;',
    '      var blob = event.data;',
    '      queued += 1;',
    // The bound: past the ceiling the recorder is paused, so a host that has
    // stopped reading parks the page instead of growing a queue in it.
    '      if (queued > QUEUE_LIMIT && !paused) {',
    '        paused = true;',
    '        try { if (typeof recorder.pause === "function") recorder.pause() } catch (ignored) {}',
    '      }',
    '      chain = chain.then(function () { return toBase64(blob) }).then(function (base64) {',
    '        queued -= 1;',
    '        release();',
    '        if (base64.length === 0) return;',
    '        try {',
    '          scope[BINDING](JSON.stringify({ chunk: base64, token: TOKEN }));',
    '        } catch (ignored) {}',
    '      }).catch(function (error) {',
    '        queued -= 1;',
    '        release();',
    '        report((error && error.message) || error);',
    '      });',
    '    };',
    '    recorder.onerror = function (event) {',
    '      report((event && event.error && event.error.message) || "the recorder failed");',
    '    };',
    '    var video = stream.getVideoTracks()[0];',
    '    if (video) {',
    '      video.addEventListener("ended", function () { report("the tab capture ended") });',
    '    }',
    '    scope[KEY] = { token: TOKEN, recorder: recorder, stream: stream };',
    '    recorder.start(TIMESLICE);',
    '    return "ok";',
    '  } catch (error) {',
    '    var name = (error && error.name) ? error.name + ": " : "";',
    '    return "failed:" + name + String((error && error.message) || error);',
    '  }',
    '})()',
  ].join('\n')
}

/**
 * Build the script that releases a capture: the recorder, every track, and the
 * private global.
 *
 * Stopping every track is what closes the display-capture indicator; there is no
 * separate "stop sharing" call. The report comes back through this expression's
 * return value because the tracks are unreadable from the host once the global
 * is cleared.
 * @returns the script to evaluate.
 */
export function buildCaptureStop(): string {
  return [
    '(function () {',
    `  var scope = typeof window === "undefined" ? null : window;`,
    '  if (scope === null) return { stopped: false, tracks: 0, ended: 0 };',
    `  var capture = scope[${JSON.stringify(CAPTURE_KEY)}];`,
    '  if (!capture) return { stopped: false, tracks: 0, ended: 0 };',
    '  try {',
    '    if (capture.recorder && capture.recorder.state !== "inactive") capture.recorder.stop();',
    '  } catch (ignored) {',
    '    /* A recorder that already died has nothing left to stop. */',
    '  }',
    '  var tracks = 0;',
    '  var ended = 0;',
    '  try {',
    '    var list = capture.stream ? capture.stream.getTracks() : [];',
    '    tracks = list.length;',
    '    for (var index = 0; index < list.length; index += 1) {',
    '      try {',
    '        list[index].stop();',
    '        if (list[index].readyState === "ended") ended += 1;',
    '      } catch (ignored) {}',
    '    }',
    '  } catch (ignored) {}',
    `  scope[${JSON.stringify(CAPTURE_KEY)}] = undefined;`,
    '  return { stopped: true, tracks: tracks, ended: ended };',
    '})()',
  ].join('\n')
}

/** Why a capture never started, as the panel is told. */
export type CaptureFailureReporter = (tabId: string, reason: string) => void

/**
 * A capture whose document went away, as the host is told.
 *
 * Distinct from {@link CaptureFailureReporter} on purpose. A navigation is not
 * a failure of the lane: the recorder died with its document and nothing can be
 * stopped or restored (the new document never had the sentinel), so the honest
 * move is a fresh recording in the new document rather than the pixel-lane
 * fallback a real failure earns.
 */
export type CaptureLossReporter = (tabId: string, reason: string) => void

/** Construction options. */
export interface TabCaptureOptions {
  /** The protocol transport the tabs share. */
  transport: CdpTransport
  /** Binding the page pushes chunks into. @default TAB_CAPTURE_BINDING_NAME */
  bindingName?: string
  /** Receives one base64 chunk whenever the page's recorder emits one. */
  onChunk?: (tabId: string, chunk: CaptureChunk) => void
  /** Receives a capture that could not start, or died, with the reason to show. */
  onFailure?: CaptureFailureReporter
  /** Receives a capture whose document was replaced by a navigation. */
  onLost?: CaptureLossReporter
}

/** One tab's recording plus the bookkeeping that keeps a restart honest. */
interface CaptureSession {
  /** Flat CDP session of the tab, from the tab manager. */
  sessionId: string
  /** Token stamped on this recording's payloads; another token is a stale chunk. */
  token: string
  /** Title the tab had before the sentinel was applied. */
  originalTitle: string
}

/**
 * One browser's tab capture.
 */
export class TabCapture {
  private readonly transport: CdpTransport
  private readonly bindingName: string
  private onChunk: ((tabId: string, chunk: CaptureChunk) => void) | undefined
  private onFailure: CaptureFailureReporter | undefined
  private onLost: CaptureLossReporter | undefined
  private readonly sessions = new Map<string, CaptureSession>()
  /** Session whose binding payloads currently belong to which tab. */
  private readonly tabBySession = new Map<string, string>()
  /** In-flight starts, so two callers asking at once start once. */
  private readonly starting = new Map<string, Promise<void>>()
  private readonly unsubscribers: Array<() => void> = []
  /** Counter behind every recording's token. */
  private nextToken = 0
  private disposed = false

  /**
   * @param options - transport, binding name and the two sinks.
   */
  constructor(options: TabCaptureOptions) {
    this.transport = options.transport
    this.bindingName = options.bindingName ?? TAB_CAPTURE_BINDING_NAME
    this.onChunk = options.onChunk
    this.onFailure = options.onFailure
    this.onLost = options.onLost
    this.subscribe()
  }

  /** Replace the chunk sink. */
  setChunkSink(sink: ((tabId: string, chunk: CaptureChunk) => void) | undefined): void {
    this.onChunk = sink
  }

  /** Replace the failure sink. */
  setFailureSink(sink: CaptureFailureReporter | undefined): void {
    this.onFailure = sink
  }

  /** Replace the navigation-loss sink. */
  setLossSink(sink: CaptureLossReporter | undefined): void {
    this.onLost = sink
  }

  /** Whether a tab is currently recording. */
  isCapturing(tabId: string): boolean {
    return this.sessions.has(tabId)
  }

  /** The tabs currently recording. */
  capturingTabs(): string[] {
    return [...this.sessions.keys()]
  }

  /**
   * Start capturing one tab.
   *
   * Idempotent and safe to call concurrently: two callers asking at the same
   * moment share one recording. A tab that is already recording is stopped
   * first, because a second `start` must produce a fresh header (the caller is
   * re-anchoring a panel) rather than re-adopting a stream whose chunks carry the
   * previous token and would be dropped.
   * @param tabId - target tab.
   * @param sessionId - the tab's flat CDP session.
   * @throws Error when the capture could not start, with the reason to show.
   */
  async start(tabId: string, sessionId: string): Promise<void> {
    if (this.disposed) throw new Error('the tab capture is disposed')
    const running = this.starting.get(tabId)
    if (running !== undefined) return await running
    const attempt = this.begin(tabId, sessionId).finally(() => { this.starting.delete(tabId) })
    this.starting.set(tabId, attempt)
    return await attempt
  }

  /**
   * Stop capturing one tab, release the capture and put the title back.
   *
   * Every step is best-effort by design: the document that was recording may
   * already be gone (a navigation replaces it and its recorder with it), and a
   * failed stop must not stop the host from forgetting the session.
   * @param tabId - target tab.
   * @returns what the stop achieved, for diagnostics and the real-browser check.
   */
  async stop(tabId: string): Promise<CaptureStopReport> {
    const session = this.sessions.get(tabId)
    if (session === undefined) return { stopped: false, tracks: 0, ended: 0 }
    this.sessions.delete(tabId)
    this.tabBySession.delete(session.sessionId)
    const report = await this.transport.send<{ result?: { value?: unknown } }>(
      'Runtime.evaluate',
      { expression: buildCaptureStop(), returnByValue: true },
      session.sessionId,
    ).then(result => readStopReport(result)).catch(() => ({ stopped: false, tracks: 0, ended: 0 }))
    // The title goes back whether or not the recorder was still there: the
    // sentinel is what this host put on the page, so the sentinel is what this
    // host must take off it.
    await this.transport.send('Runtime.evaluate', {
      expression: buildCaptureRestore(session.originalTitle, undefined),
      returnByValue: true,
    }, session.sessionId).catch(() => undefined)
    return report
  }

  /** Stop every recording and detach the protocol listener. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    for (const tabId of [...this.sessions.keys()]) await this.stop(tabId).catch(() => undefined)
    this.sessions.clear()
    this.tabBySession.clear()
  }

  /** Rename, bind, and ask the page for the tab's surface. */
  private async begin(tabId: string, sessionId: string): Promise<void> {
    if (this.sessions.has(tabId)) await this.stop(tabId)
    const token = `capture-${++this.nextToken}`
    // The rename goes first and in its own call: the source flag matches the
    // title at capture time, so the browser must have the sentinel before the
    // next `getDisplayMedia` reaches it.
    const renamed = await this.transport.send<{
      exceptionDetails?: { text?: unknown; exception?: { description?: unknown } }
      result?: { value?: unknown }
    }>('Runtime.evaluate', {
      expression: buildCaptureRename(),
      returnByValue: true,
      userGesture: true,
    }, sessionId)
    const failure = describeEvaluate(renamed, 'the watched tab refused to take the capture title')
    if (failure !== undefined) throw new Error(failure)
    const originalTitle = typeof renamed.result?.value === 'string' ? renamed.result.value : ''
    const session: CaptureSession = { sessionId, token, originalTitle }
    try {
      // The binding exists before the recorder does: the recorder emits from
      // inside its own start, and an emit into a missing binding is a TypeError
      // inside the observed page.
      await this.transport.send('Runtime.addBinding', { name: this.bindingName }, sessionId)
      const started = await this.transport.send<{
        exceptionDetails?: { text?: unknown; exception?: { description?: unknown } }
        result?: { value?: unknown }
      }>('Runtime.evaluate', {
        expression: buildCaptureStart({ bindingName: this.bindingName, token }),
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      }, sessionId)
      const reason = describeCaptureStart(started)
      if (reason !== undefined) throw new Error(reason)
    } catch (error) {
      // A half-started capture must not leave the sentinel on the page or a
      // recorder running behind a panel that has already fallen back.
      await this.transport.send('Runtime.evaluate', {
        expression: buildCaptureStop(),
        returnByValue: true,
      }, sessionId).catch(() => undefined)
      await this.transport.send('Runtime.evaluate', {
        expression: buildCaptureRestore(originalTitle, undefined),
        returnByValue: true,
      }, sessionId).catch(() => undefined)
      throw error
    }
    this.sessions.set(tabId, session)
    this.tabBySession.set(sessionId, tabId)
  }

  /** Route one binding payload into the tab that owns its session. */
  private ingest(sessionId: string | undefined, params: Record<string, unknown>): void {
    if (sessionId === undefined) return
    if (params.name !== this.bindingName) return
    const tabId = this.tabBySession.get(sessionId)
    if (tabId === undefined) return
    const session = this.sessions.get(tabId)
    if (session === undefined) return
    const payload = params.payload
    if (typeof payload !== 'string') return
    let decoded: unknown
    try {
      decoded = JSON.parse(payload)
    } catch {
      // A payload the recorder could not have produced is dropped rather than
      // trusted: half a chunk is worse than a missing one.
      return
    }
    // A chunk from a recording that was replaced while it was in flight belongs
    // to nobody: splicing it into its successor corrupts the panel's decoder.
    if (payloadToken(decoded) !== session.token) return
    const reported = captureErrorMessage(decoded)
    if (reported !== undefined) {
      // The recorder or its stream died inside the page: tear the session down
      // here so the failure cannot re-arm on the next start, and tell the host
      // so the panel falls back with the reason.
      this.sessions.delete(tabId)
      this.tabBySession.delete(sessionId)
      void this.transport.send('Runtime.evaluate', {
        expression: buildCaptureRestore(session.originalTitle, undefined),
        returnByValue: true,
      }, session.sessionId).catch(() => undefined)
      this.onFailure?.(tabId, `the tab capture stopped inside the page: ${reported}`)
      return
    }
    const chunk = payloadChunk(decoded)
    if (chunk === undefined) return
    this.onChunk?.(tabId, { data: chunk })
  }

  /** Register the binding and the navigation listeners. */
  private subscribe(): void {
    if (this.disposed) return
    this.unsubscribers.push(this.transport.on('Runtime.bindingCalled', (params, sessionId) => {
      try {
        this.ingest(sessionId, params)
      } catch {
        // A listener failure must not stall protocol delivery for the rest of
        // the client; the owning panel reports through its own state.
      }
    }))
    // A top-level navigation destroys the document the recorder lives in: the
    // stream, the tracks and the sentinel all die with it, and the new document
    // never had them. Sub-frames are ignored, matching how TabManager decides a
    // tab's address changed; a same-document navigation emits a different event
    // and leaves the recorder running.
    this.unsubscribers.push(this.transport.on('Page.frameNavigated', (params, sessionId) => {
      try {
        this.loseToNavigation(sessionId, params)
      } catch {
        // Same reasoning as above: a listener must never break the transport.
      }
    }))
  }

  /**
   * Forget a capture whose document a navigation replaced, and say so.
   *
   * Nothing is evaluated here on purpose. The document that held the recorder is
   * gone, so there is no recorder to stop, no tracks to release and no sentinel
   * to take off; the new document has a title of its own. What is left is the
   * host's decision, which is why this is reported as a loss rather than a
   * failure.
   * @param sessionId - the session the navigation event arrived on.
   * @param params - the `Page.frameNavigated` params.
   */
  private loseToNavigation(sessionId: string | undefined, params: Record<string, unknown>): void {
    if (sessionId === undefined) return
    const frame = (params as { frame?: { parentId?: unknown } }).frame
    if (frame === undefined) return
    // A sub-frame navigation does not replace the tab's document.
    if (frame.parentId !== undefined) return
    const tabId = this.tabBySession.get(sessionId)
    if (tabId === undefined) return
    const session = this.sessions.get(tabId)
    if (session === undefined) return
    this.sessions.delete(tabId)
    this.tabBySession.delete(sessionId)
    this.onLost?.(tabId, 'the watched page navigated while it was being recorded')
  }
}

/**
 * What a `Runtime.evaluate` result says, as a failure the caller can show.
 * @param result - the evaluate result.
 * @param fallback - message to use when the page threw without a description.
 * @returns the reason, or undefined when the call succeeded.
 */
function describeEvaluate(
  result: { exceptionDetails?: { text?: unknown; exception?: { description?: unknown } } },
  fallback: string,
): string | undefined {
  const thrown = result.exceptionDetails
  if (thrown === undefined) return undefined
  const description = thrown.exception?.description
  if (typeof description === 'string' && description.length > 0) return description
  return typeof thrown.text === 'string' ? thrown.text : fallback
}

/**
 * What the capture bootstrap's return value says, as a failure to show.
 * @param result - the `Runtime.evaluate` result.
 * @returns the reason, or undefined when the recorder is running.
 */
function describeCaptureStart(result: {
  exceptionDetails?: { text?: unknown; exception?: { description?: unknown } }
  result?: { value?: unknown }
}): string | undefined {
  const thrown = describeEvaluate(result, 'the page rejected the capture request')
  if (thrown !== undefined) return `the tab capture could not start: ${thrown}`
  const verdict = result.result?.value
  if (typeof verdict !== 'string') {
    return `the capture bootstrap answered ${String(verdict)} instead of starting`
  }
  if (verdict === 'ok' || verdict === 'already') return undefined
  if (verdict.startsWith('failed:')) {
    return `the tab capture could not start: ${verdict.slice('failed:'.length).trim()}`
  }
  switch (verdict) {
    case 'no-window':
      return 'the tab has no document to capture yet'
    case 'sub-frame':
      return 'the capture was asked to start in a nested frame instead of the watched page'
    case 'no-api':
      return 'this browser exposes no getDisplayMedia or MediaRecorder'
    case 'unsupported':
      return `this browser cannot record ${CAPTURE_MIME}`
    default:
      return `the capture bootstrap answered "${verdict}" instead of starting`
  }
}

/**
 * Read the stop script's report.
 * @param result - the `Runtime.evaluate` result.
 * @returns the report, with zeros when the script could not answer.
 */
function readStopReport(result: { result?: { value?: unknown } }): CaptureStopReport {
  const value = result.result?.value
  if (typeof value !== 'object' || value === null) return { stopped: false, tracks: 0, ended: 0 }
  const candidate = value as Record<string, unknown>
  const count = (field: unknown): number => (typeof field === 'number' && Number.isFinite(field) ? field : 0)
  return {
    stopped: candidate.stopped === true,
    tracks: count(candidate.tracks),
    ended: count(candidate.ended),
  }
}
