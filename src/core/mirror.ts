/**
 * The DOM mirror: rrweb's recorder, injected into a tab, and the recording it
 * streams back.
 *
 * Why this exists beside the screencast. CDP screencast frames are pictures:
 * a heavy text page costs megabytes per second and small type arrives blurry,
 * because the picture is scaled into a capture box. The same page serialized as
 * DOM costs one full snapshot and then an event per mutation — measured with
 * rrweb at roughly an eighth of the pixels on an animated page and almost
 * nothing on a static one — and the panel renders it as real DOM, so text stays
 * crisp at any panel size. The pixel lane stays for what a DOM cannot show:
 * `<video>`, canvas, native UI, DRM.
 *
 * Injection. Two calls, because one is not enough: `Page.addScriptToEvaluateOnNewDocument`
 * registers the recorder for every document this target loads next, and a
 * `Runtime.evaluate` of the same source starts it in the document that is
 * already loaded. Both run one self-contained script (see
 * {@link buildMirrorInjection}) that is idempotent, so a page that somehow gets
 * both never records twice.
 *
 * Session. Every one of those calls is a page-domain method, and this repo's
 * CDP client runs in flat session mode against the browser-level socket, where
 * `Runtime.*` and `Page.*` are rejected with `-32601 'Runtime.enable' wasn't
 * found`. The collector therefore rides the tab session {@link TabManager}
 * already attached (`TabManager.sessionOf`), not a second attach of its own:
 * one session per tab is what keeps the console, the network table and the
 * mirror talking about the same execution context, and it is one less attach to
 * leak on close.
 *
 * Backpressure. Recording is not free for the page being watched, so nothing
 * here starts on its own: {@link DomMirror.start} is called when a panel asks
 * for the mirror, and {@link DomMirror.stop} removes both the new-document
 * registration and the running recorder. A tab nobody watches never records.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/mirror
 */

import type { CdpTransport } from './cdp.ts'

/**
 * Global the binding is installed as, and the name `Runtime.bindingCalled`
 * reports. Named after the plugin rather than something short: it lands on the
 * watched page's `window`, which may be a page the agent does not own.
 */
export const MIRROR_BINDING_NAME = 'dshBrowserViewDomMirror'

/** Private global holding the bundled rrweb build, and the live recording. */
const RECORDER_KEY = '__dshBrowserViewRrweb'
const RECORDING_KEY = '__dshBrowserViewMirror'

/** rrweb's Meta event type; carries the recorded document's dimensions. */
const RRWEB_META = 4

/** rrweb's FullSnapshot event type; a fresh replayer can start from one. */
const RRWEB_FULL_SNAPSHOT = 2

/**
 * Events kept per tab between checkpoints, and the byte ceiling beside it.
 *
 * The buffer exists so a panel that attaches late, or comes back from being
 * hidden, can rebuild its replayer from the start of the current recording
 * instead of showing a page whose first half it never saw. rrweb emits a fresh
 * full snapshot on a timer (five minutes by default) and every navigation
 * produces one too, so the buffer normally stays small; these bounds are the
 * safety net for a page that mutates without pause.
 */
export const MIRROR_BUFFER_EVENT_LIMIT = 4_000

/** Byte ceiling for one tab's retained recording history. */
export const MIRROR_BUFFER_BYTE_LIMIT = 4 * 1024 * 1024

/** One tab's recording as the panel needs it. */
export interface MirrorRecording {
  /**
   * Events from the last full snapshot (and the Meta event before it) onward,
   * in recording order.
   */
  events: unknown[]
  /**
   * Bumped whenever `events` stops being a continuation of what it was — a
   * checkpoint that dropped the history, or the byte ceiling doing the same.
   * A sink whose cursor carries another generation is sent the whole array.
   */
  generation: number
}

/** One rrweb event as the mirror needs it: only its checkpoint type matters. */
function eventType(event: unknown): number | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const type = (event as Record<string, unknown>).type
  return typeof type === 'number' ? type : undefined
}

/**
 * Payload the injected script sends when it could not start recording.
 *
 * The recorder runs inside the watched page, where a throw cannot reject any
 * command this side issued (the bootstrap already returned by then, and a
 * navigation runs the injected script long after the host looked). Reporting
 * through the binding's own payload is what turns that silence into the
 * panel's explanation instead of a viewer that never fills in.
 */
export const MIRROR_ERROR_FIELD = '__dshMirrorError'

/**
 * The error a payload reports, or undefined when the payload is a recording
 * event.
 * @param payload - one decoded binding payload.
 * @returns the error text when the script reported one.
 */
export function mirrorErrorMessage(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const reported = (payload as Record<string, unknown>)[MIRROR_ERROR_FIELD]
  return typeof reported === 'string' ? reported : undefined
}

/**
 * Build the one script that installs rrweb and starts recording.
 *
 * Self-contained on purpose: the same string is handed to
 * `Page.addScriptToEvaluateOnNewDocument` (where it runs at document start,
 * before the page has any markup) and to `Runtime.evaluate` (where the document
 * is already loaded), and both cases have to work without a second call.
 *
 * - rrweb is read from a private global and only assigned to `window.rrweb`
 *   when the page has none of its own, so the mirror never clobbers a recorder
 *   the observed page is using.
 * - `expose` is the private global, not `window.rrweb`, so a page that swaps
 *   `window.rrweb` between the two calls cannot break the recording.
 * - Only the top-level frame records. This is not tidiness, it is what keeps
 *   the injection from recursing without bound: rrweb's `record()` appends a
 *   hidden iframe of its own to probe for an untainted `Array.from`, and a
 *   registration that runs in every document makes that probe's document start
 *   a second recorder, whose own probe starts a third — measured at 500 frames
 *   in 1.2 seconds, with the renderer wedged and `Runtime.bindingCalled` under a
 *   flood. Nested frames need no recorder anyway: rrweb serializes same-origin
 *   iframes inside the top document's snapshot.
 * - Every call into the page is wrapped: a mirror that throws into the watched
 *   page's own error handlers would be worse than no mirror.
 * - The return value is the only synchronous channel back to the host, so it
 *   says exactly what happened: `ok`, `already` (this document is already
 *   recording), `sub-frame` (a nested document declined), `no-recorder` (the
 *   bundle did not define `record`) or `error`.
 * @param umdSource - rrweb's UMD bundle, read from the published artifact.
 * @param bindingName - binding the recorder emits into.
 * @returns the script to evaluate.
 */
export function buildMirrorInjection(umdSource: string, bindingName: string = MIRROR_BINDING_NAME): string {
  return [
    '(function () {',
    `  var BINDING = ${JSON.stringify(bindingName)};`,
    `  var EXPOSE = ${JSON.stringify(RECORDER_KEY)};`,
    `  var RECORDING = ${JSON.stringify(RECORDING_KEY)};`,
    '  var scope = typeof window === "undefined" ? null : window;',
    '  if (scope === null) return "no-window";',
    '  if (scope.top !== scope) return "sub-frame";',
    '  var existing = scope[RECORDING];',
    '  if (existing && existing.stop) return "already";',
    '  if (!scope[EXPOSE] || typeof scope[EXPOSE].record !== "function") {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    '    var define;',
    // The bundle's own trailing sourceMappingURL comment is stripped: it would
    // point the browser at a map file relative to the watched page's URL, which
    // is a request this host never intends to make. Anchored to the end of the
    // whole bundle and never line-based, because rrweb's bundle carries that
    // same comment *inside* one of its strings (the inline worker source), where
    // it is data and must survive verbatim.
    umdSource.replace(/\/\/# sourceMappingURL=\S+\s*$/, ''),
    '    scope[EXPOSE] = module.exports;',
    '    if (!scope.rrweb) scope.rrweb = scope[EXPOSE];',
    '  }',
    '  var recorder = scope[EXPOSE];',
    '  if (!recorder || typeof recorder.record !== "function") return "no-recorder";',
    '  var emit = function (event) {',
    '    try {',
    '      scope[BINDING](JSON.stringify(event));',
    '    } catch (ignored) {',
    '      /* The binding is absent when the host stopped listening; a mirror',
    '         must never throw into the page it is watching. */',
    '    }',
    '  };',
    '  try {',
    '    scope[RECORDING] = { stop: recorder.record({ emit: emit }) };',
    '    return "ok";',
    '  } catch (error) {',
    '    scope[RECORDING] = undefined;',
    '    try {',
    `      scope[BINDING](JSON.stringify({ ${JSON.stringify(MIRROR_ERROR_FIELD)}: String((error && error.message) || error) }));`,
    '    } catch (ignored) {',
    '      /* Reported through the return value as well; nothing left to do. */',
    '    }',
    '    return "error";',
    '  }',
    '})()',
  ].join('\n')
}

/**
 * Stop the recorder running in the current document.
 *
 * Best-effort by design: the document that was recording may already be gone
 * (a navigation replaces it and the injected script's own recorder with it),
 * and a failed stop must not stop the host from removing the new-document
 * registration that is the actual promise being withdrawn.
 * @param bindingName - binding the recorder emits into.
 * @returns the script to evaluate.
 */
export function buildMirrorStop(bindingName: string = MIRROR_BINDING_NAME): string {
  return [
    '(function () {',
    `  var scope = typeof window === "undefined" ? null : window;`,
    '  if (scope === null) return "no-window";',
    `  var recording = scope[${JSON.stringify(RECORDING_KEY)}];`,
    '  if (!recording) return "idle";',
    '  try {',
    '    if (typeof recording.stop === "function") recording.stop();',
    '  } catch (ignored) {',
    '    /* A recorder that already died has nothing left to stop. */',
    '  }',
    `  scope[${JSON.stringify(RECORDING_KEY)}] = undefined;`,
    '  return "stopped";',
    '})()',
  ].join('\n')
}

/** Why a mirror never started, as the panel is told. */
export type MirrorFailureReporter = (tabId: string, reason: string) => void

/** Construction options. */
export interface DomMirrorOptions {
  /** The protocol transport the tabs share. */
  transport: CdpTransport
  /**
   * Reads the bundled recorder. Called once per recording, never at
   * construction, so a host that never mirrors never touches the file and a
   * missing artifact fails exactly the call that needed it.
   */
  source: () => string
  /** Binding the recorder emits into. @default MIRROR_BINDING_NAME */
  bindingName?: string
  /** Receives one tab id whenever that tab's recording changed. */
  onEvent?: (tabId: string) => void
  /** Receives a mirror that could not start, or died, with the reason. */
  onFailure?: MirrorFailureReporter
}

/** One tab's recording plus the bookkeeping that keeps it correct. */
interface MirrorSession {
  /** Flat CDP session of the tab, from the tab manager. */
  sessionId: string
  /** Identifier of the new-document registration, the handle that withdraws it. */
  scriptId: string | undefined
  /** Bumped whenever the retained history stops being a continuation. */
  generation: number
  /** Events from the latest checkpoint onward. */
  events: unknown[]
  /** Approximate JSON size of `events`, for the byte ceiling. */
  bytes: number
  /** Per-event sizes, so the ceiling can drop the oldest without re-measuring. */
  sizes: number[]
}

/**
 * One browser's DOM mirror.
 */
export class DomMirror {
  private readonly transport: CdpTransport
  private readonly source: () => string
  private readonly bindingName: string
  private onEvent: ((tabId: string) => void) | undefined
  private onFailure: MirrorFailureReporter | undefined
  private readonly sessions = new Map<string, MirrorSession>()
  /** Session whose binding payloads currently belong to which tab. */
  private readonly tabBySession = new Map<string, string>()
  /** In-flight starts, so two panels asking at once attach once. */
  private readonly starting = new Map<string, Promise<void>>()
  private readonly unsubscribers: Array<() => void> = []
  private disposed = false

  /**
   * @param options - transport, recorder source, and the two sinks.
   */
  constructor(options: DomMirrorOptions) {
    this.transport = options.transport
    this.source = options.source
    this.bindingName = options.bindingName ?? MIRROR_BINDING_NAME
    this.onEvent = options.onEvent
    this.onFailure = options.onFailure
    this.subscribe()
  }

  /** Replace the event sink. */
  setEventSink(sink: ((tabId: string) => void) | undefined): void {
    this.onEvent = sink
  }

  /** Replace the failure sink. */
  setFailureSink(sink: MirrorFailureReporter | undefined): void {
    this.onFailure = sink
  }

  /** Whether a tab is currently recording. */
  isRecording(tabId: string): boolean {
    return this.sessions.has(tabId)
  }

  /** The tabs currently recording. */
  recordingTabs(): string[] {
    return [...this.sessions.keys()]
  }

  /**
   * The retained recording of one tab, for a panel that needs it from the top.
   * @param tabId - target tab.
   * @returns the recording, or undefined when the tab is not mirrored.
   */
  recording(tabId: string): MirrorRecording | undefined {
    const session = this.sessions.get(tabId)
    if (session === undefined) return undefined
    return { events: session.events, generation: session.generation }
  }

  /**
   * Start mirroring one tab. Idempotent, and safe to call concurrently: two
   * panels asking at the same moment share one injection.
   * @param tabId - target tab.
   * @param sessionId - the tab's flat CDP session.
   * @throws Error when the recorder could not be armed, with the reason to show.
   */
  async start(tabId: string, sessionId: string): Promise<void> {
    if (this.disposed) throw new Error('the DOM mirror is disposed')
    if (this.sessions.has(tabId)) return
    const running = this.starting.get(tabId)
    if (running !== undefined) return await running
    const attempt = this.arm(tabId, sessionId).finally(() => { this.starting.delete(tabId) })
    this.starting.set(tabId, attempt)
    return await attempt
  }

  /**
   * Stop mirroring one tab and forget its recording.
   * @param tabId - target tab.
   */
  async stop(tabId: string): Promise<void> {
    const session = this.sessions.get(tabId)
    if (session === undefined) return
    this.sessions.delete(tabId)
    this.tabBySession.delete(session.sessionId)
    // The new-document registration goes first: it is the promise that a future
    // page will start recording, and withdrawing it is what makes "nobody
    // watches this tab" true for the next navigation as well.
    if (session.scriptId !== undefined) {
      await this.transport.send(
        'Page.removeScriptToEvaluateOnNewDocument',
        { identifier: session.scriptId },
        session.sessionId,
      ).catch(() => undefined)
    }
    await this.transport.send('Runtime.evaluate', {
      expression: buildMirrorStop(this.bindingName),
      returnByValue: true,
    }, session.sessionId).catch(() => undefined)
  }

  /** Stop every recording and detach the protocol listener. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    const tabIds = [...this.sessions.keys()]
    for (const tabId of tabIds) await this.stop(tabId).catch(() => undefined)
    this.sessions.clear()
    this.tabBySession.clear()
  }

  /** Inject the recorder and start it in the document that is loaded. */
  private async arm(tabId: string, sessionId: string): Promise<void> {
    // Read before anything is registered: a missing artifact must fail the
    // start, not leave a new-document registration behind that never records.
    const injection = buildMirrorInjection(this.source(), this.bindingName)
    const registered = await this.transport.send<{ identifier?: unknown }>(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: injection },
      sessionId,
    )
    // The binding exists before the recorder does: the recorder emits from
    // inside its own constructor, and an emit into a missing binding is a
    // TypeError inside the observed page.
    await this.transport.send('Runtime.addBinding', { name: this.bindingName }, sessionId)
    const result = await this.transport.send<{
      exceptionDetails?: { text?: unknown; exception?: { description?: unknown } }
      result?: { value?: unknown }
    }>('Runtime.evaluate', {
      expression: injection,
      returnByValue: true,
      awaitPromise: false,
    }, sessionId)
    const failure = describeInjection(result)
    if (failure !== undefined) {
      if (typeof registered.identifier === 'string') {
        await this.transport.send(
          'Page.removeScriptToEvaluateOnNewDocument',
          { identifier: registered.identifier },
          sessionId,
        ).catch(() => undefined)
      }
      throw new Error(failure)
    }
    const session: MirrorSession = {
      sessionId,
      scriptId: typeof registered.identifier === 'string' ? registered.identifier : undefined,
      generation: 1,
      events: [],
      bytes: 0,
      sizes: [],
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
      // trusted: half an event is worse than a missing one.
      return
    }
    const reported = mirrorErrorMessage(decoded)
    if (reported !== undefined) {
      // A recorder that threw is torn down here rather than left alone: its
      // new-document registration would re-arm the same failure on every
      // navigation, and the panel is about to be told why it fell back.
      this.sessions.delete(tabId)
      this.tabBySession.delete(sessionId)
      if (session.scriptId !== undefined) {
        void this.transport.send(
          'Page.removeScriptToEvaluateOnNewDocument',
          { identifier: session.scriptId },
          session.sessionId,
        ).catch(() => undefined)
      }
      this.onFailure?.(tabId, `the recorder stopped inside the page: ${reported}`)
      return
    }
    this.append(session, decoded, payload.length)
    this.onEvent?.(tabId)
  }

  /**
   * Append one event, keeping the buffer anchored on the newest checkpoint.
   *
   * Anchoring matters for whoever attaches late: an rrweb replayer cannot start
   * from the middle of an incremental stream, so the retained history begins at
   * the last full snapshot (and the Meta event that carries its dimensions).
   * Truncating is why `generation` exists — every sink holding the old array is
   * told to rebuild instead of being fed a hole.
   * @param session - the tab's recording.
   * @param event - one decoded rrweb event.
   * @param bytes - its serialized size, for the byte ceiling.
   */
  private append(session: MirrorSession, event: unknown, bytes: number): void {
    session.events.push(event)
    session.sizes.push(bytes)
    session.bytes += bytes
    if (eventType(event) === RRWEB_FULL_SNAPSHOT) {
      // Anchored after the push, so the anchor is the checkpoint that just
      // arrived rather than the one it replaces.
      const start = snapshotAnchor(session.events)
      if (start > 0) {
        for (const size of session.sizes.splice(0, start)) session.bytes -= size
        session.events.splice(0, start)
        session.generation += 1
      }
    }
    while (
      session.events.length > MIRROR_BUFFER_EVENT_LIMIT
      || session.bytes > MIRROR_BUFFER_BYTE_LIMIT
    ) {
      // Bounded either way: an unbounded mirror turns a chatty page into an
      // unbounded leak in the host process, exactly like the console ring.
      session.events.shift()
      session.bytes -= session.sizes.shift() ?? 0
      session.generation += 1
    }
  }

  /** Register the binding listener. */
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
  }
}

/**
 * How many leading events can be dropped while keeping a usable checkpoint:
 * everything before the last Meta event at or before the last full snapshot.
 * @param events - the retained recording.
 * @returns the index the recording should start at.
 */
function snapshotAnchor(events: unknown[]): number {
  let snapshot = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (eventType(events[index]) === RRWEB_FULL_SNAPSHOT) {
      snapshot = index
      break
    }
  }
  if (snapshot < 0) return 0
  // The Meta event carries the recorded document's dimensions; a replayer
  // builds its iframe from it, so it travels with its snapshot.
  for (let index = snapshot - 1; index >= 0; index -= 1) {
    if (eventType(events[index]) === RRWEB_META) return index
  }
  return snapshot
}

/**
 * What the bootstrap's return value says, as a failure the caller can show.
 * @param result - the `Runtime.evaluate` result.
 * @returns the reason, or undefined when the recorder is armed.
 */
function describeInjection(result: {
  exceptionDetails?: { text?: unknown; exception?: { description?: unknown } }
  result?: { value?: unknown }
}): string | undefined {
  const thrown = result.exceptionDetails
  if (thrown !== undefined) {
    const description = thrown.exception?.description
    if (typeof description === 'string' && description.length > 0) return `the recorder could not be injected: ${description}`
    return `the recorder could not be injected: ${typeof thrown.text === 'string' ? thrown.text : 'the page rejected the injected script'}`
  }
  const verdict = result.result?.value
  switch (verdict) {
    case 'ok':
    case 'already':
      return undefined
    case 'no-window':
      return 'the tab has no document to mirror yet'
    case 'sub-frame':
      return 'the recorder was asked to start in a nested frame instead of the mirrored page'
    case 'no-recorder':
      return 'the bundled rrweb build did not define a recorder'
    case 'error':
      return 'the recorder threw while starting; see the tab console'
    default:
      return `the injected recorder answered "${String(verdict)}" instead of starting`
  }
}
