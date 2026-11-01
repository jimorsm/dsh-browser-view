/**
 * The host-side browser service: one lazy Chrome, one tab per agent session,
 * and the fan-out that keeps every attached panel in sync.
 *
 * Lifecycle. Chrome is not started when the plugin mounts — a plugin that
 * launches a browser the moment the GUI loads spends a process on a feature
 * nobody has opened. The first tool call or socket attach starts it, and a
 * failed start is remembered as a panel message instead of being retried in a
 * loop on every keystroke.
 *
 * Binding. `sessionId -> tabId` is the reason two agents never fight over one
 * page: a tool call from session A reuses A's tab, creates one on first use, and
 * leaves B's tab alone. Tab ids stay explicit arguments too, so a caller can
 * address any open tab on purpose.
 *
 * Broadcast. Paths, once a socket is attached, are push-only: frames, state
 * changes, and action traces go to every attached panel. The service never
 * lets one dead socket break the fan-out — a throwing send drops that sink.
 *
 * Lanes. A panel declares which lane it renders (`mode`): the DOM mirror, whose
 * events come from src/core/mirror.ts, or the screencast. The declaration is
 * per sink, so one person can watch pixels while another watches DOM, and it is
 * what keeps a panel from before the mirror existed on exactly the frames it
 * always got. The recorder runs only while some visible sink asks for it, and
 * the screencast runs only while some visible sink still needs pixels — which
 * includes a mirror that has not delivered its first snapshot yet, so switching
 * lanes never shows an empty stage.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/host/service
 */

import { CdpClient } from '../core/cdp.ts'
import { RtcFrameRelay } from './rtc.ts'
import type { CdpTransport } from '../core/cdp.ts'
import { ChromeProcess } from '../core/chrome.ts'
import { resolveBrowserHandle, type ResolvedBrowser } from '../core/browser.ts'
import { TabManager, type ScreencastFrame } from '../core/tabs.ts'
import { DomMirror, type MirrorRecording } from '../core/mirror.ts'
import { readMirrorSource } from './mirror-source.ts'
import { buildSnapshot, type SnapshotResult } from '../core/snapshot.ts'
import { DOCUMENT_TEXT_EXPRESSION, isAuthChallengeText, isLoopbackTarget } from './auth.ts'
import {
  clickElement,
  navigateTo,
  pressKey,
  scrollBy,
  typeText,
  type ActionOutcome,
  type ElementTarget,
} from '../core/actions.ts'
import {
  DEFAULT_CAPTURE_MAX,
  DEFAULT_FRAME_FORMAT,
  DEFAULT_VIEW_LANE,
  type BrowserViewLane,
  type FrameImageFormat,
  DEFAULT_JPEG_QUALITY,
  DEFAULT_VIEWPORT,
  type BrowserActionTrace,
  type BrowserConsoleEntry,
  type BrowserNetworkEntry,
  type BrowserPanelState,
  type BrowserSnapshot,
  type BrowserTabView,
  type BrowserViewCommand,
  type BrowserViewEvent,
} from '../core/protocol.ts'

/**
 * Smallest gap between two frames pushed to the panels, while nobody is
 * interacting: about 15 fps. A screencast follows the compositor and reaches
 * 60 fps on an animated page, where the picture is worth far less than the
 * bandwidth - a heavy page measured 4.4-5.2 MB/s at full rate.
 */
const FRAME_MIN_INTERVAL_MS = 66

/**
 * Smallest gap right after input: about 30 fps. Someone who just clicked is
 * watching the result, so the extra frames are bought back for a moment.
 */
const INTERACTIVE_FRAME_INTERVAL_MS = 33

/** How long one input gesture keeps the interactive frame rate. */
const INTERACTIVE_WINDOW_MS = 3_000

/** rrweb's FullSnapshot event type; a fresh replayer can start from one. */
const RRWEB_FULL_SNAPSHOT = 2

/** The checkpoint type of one rrweb event, when it carries one. */
function eventTypeOf(event: unknown): number | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const type = (event as Record<string, unknown>).type
  return typeof type === 'number' ? type : undefined
}

/** One attached panel socket as the service sees it. */
export interface BrowserViewSink {
  /** Deliver one event; a throw means the sink is gone. */
  send(event: BrowserViewEvent): void
  /** Close the underlying transport. */
  close(): void
}

/**
 * What one panel asked to render, and how much of the mirror it already has.
 *
 * The cursor is per sink because the mirror's traffic is per sink: a panel that
 * attaches late, or comes back from being hidden, gets the recording from its
 * latest checkpoint instead of the increments it never saw.
 */
interface SinkLane {
  /** Lane the panel asked for. Absent means {@link DEFAULT_VIEW_LANE}. */
  lane: BrowserViewLane
  /** Tab the cursor describes. */
  tabId: string | undefined
  /** Mirror generation the panel's replayer was built from, if any. */
  generation: number | undefined
  /** Events of that generation the panel already received. */
  offset: number
}

/** What the route layer needs from the service; tests stub this instead. */
export interface BrowserViewBackend {
  /** The state the status route reports; safe to call before a browser exists. */
  state(): BrowserPanelState
  /**
   * Register one panel socket.
   * @param sink - the socket adapter.
   * @returns the detach function, called when the socket closes.
   */
  attach(sink: BrowserViewSink): () => void
  /**
   * Run one validated panel command.
   * @param sink - the socket that sent it.
   * @param command - an already validated command.
   */
  handleCommand(sink: BrowserViewSink, command: BrowserViewCommand): Promise<void>
}

/** One running browser plus the tab manager over it. */
export interface BrowserSession {
  /** Protocol transport the tabs and the actions share. */
  transport: CdpTransport
  /** Tabs of this browser. */
  tabs: TabManager
  /**
   * Whether the plugin spawned this browser (`spawn`, the default) or attached
   * to one the operator runs (`attach`). An omitted value means spawn: every
   * session this plugin opened before attach mode existed was spawned.
   */
  mode?: 'spawn' | 'attach'
  /** The Chrome process; absent when a test supplied its own session or the browser is attached. */
  chrome?: ChromeProcess
  /** Stop everything this session owns. */
  dispose(): Promise<void>
}

/** What the service needs from one sink's frame relay. */
export interface FrameRelay {
  /** Whether the channel is open and frames may travel over it. */
  readonly open: boolean
  /**
   * Accept a panel's offer.
   * @param offerSdpJson - the panel's description as JSON.
   * @param onClosed - called when the connection dies.
   * @returns the answer description as JSON.
   */
  acceptOffer(offerSdpJson: string, onClosed: () => void): Promise<string>
  /**
   * Hand one frame to the channel.
   * @returns whether the whole frame travelled.
   */
  sendFrame(seq: number, image: Buffer): boolean
  /** Release the connection. */
  dispose(): void
}

/** Construction options. */
export interface BrowserViewServiceOptions {
  /** JPEG quality for frames and screenshots. @default DEFAULT_JPEG_QUALITY */
  jpegQuality?: number
  /** Viewport pinned on every tab. @default DEFAULT_VIEWPORT */
  viewport?: { width: number; height: number }
  /** Frame encoding requested from CDP. @default DEFAULT_FRAME_FORMAT */
  frameFormat?: FrameImageFormat
  /** Capture box the frame is fitted into. @default DEFAULT_CAPTURE_MAX */
  captureMax?: { width: number; height: number }
  /**
   * Smallest gap between two frames pushed to a panel, in milliseconds, idle
   * and just after input. Injected because a test clock that never advances
   * would otherwise treat every frame after the first as too soon.
   * @default { idle: FRAME_MIN_INTERVAL_MS, interactive: INTERACTIVE_FRAME_INTERVAL_MS }
   */
  frameIntervalMs?: { idle?: number; interactive?: number }
  /**
   * Builds one sink's frame relay. Replaced by tests, which cannot negotiate a
   * real peer connection; the production value is {@link RtcFrameRelay}.
   * @default () => new RtcFrameRelay()
   */
  createRelay?: () => FrameRelay
  /** Clock for action traces. @default Date.now */
  now?: () => number
  /**
   * Reads the bundled rrweb recorder the mirror injects. Injected by tests,
   * which have no built artifact; the production value reads the copy that
   * ships beside the host half ({@link readMirrorSource}).
   */
  mirrorSource?: () => string
  /**
   * Mints the process launch-token URL for one clean URL, or returns
   * undefined when the host mounts no such seam. Resolved per navigation by
   * the loader from `ctx.get('connection')`; absent here means no auth top-up.
   */
  authenticatedUrl?: (url: string) => string | undefined
  /** Browser factory, replaced by tests. */
  openSession?: (options: {
    jpegQuality: number
    frameFormat: FrameImageFormat
    captureMax: { width: number; height: number }
    viewport: { width: number; height: number }
    onFrame: (frame: ScreencastFrame) => void
    onTabsChanged: () => void
  }) => Promise<BrowserSession>
}

/**
 * Close the tabs a session created, for an attached browser.
 *
 * An attached browser is the operator's process and profile: dispose closes
 * only what the plugin created — the tabs it opened via Target.createTarget
 * and its own CDP session — and never kills the browser or touches any
 * profile directory. In spawn mode the process kill and profile removal cover
 * the targets, so nothing is closed here.
 * @param session - the session being torn down.
 */
export async function closeSessionTargets(
  session: Pick<BrowserSession, 'transport' | 'tabs' | 'mode'>,
): Promise<void> {
  if (session.mode !== 'attach') return
  for (const tab of session.tabs.list()) {
    await session.tabs.closeTab(tab.id).catch(() => undefined)
  }
}

/** Start the browser (or attach to one), connect CDP, and wrap both in a session. */
async function openDefaultSession(options: {
  jpegQuality: number
  viewport: { width: number; height: number }
  onFrame: (frame: ScreencastFrame) => void
  onTabsChanged: () => void
}): Promise<BrowserSession> {
  // Resolution happens per session start, so an operator can enable attach
  // mode through the environment without touching a running spawn-mode host.
  const browser: ResolvedBrowser = await resolveBrowserHandle({ viewport: options.viewport })
  let cdp: CdpClient
  try {
    cdp = await CdpClient.connect(browser.webSocketDebuggerUrl)
  } catch (error) {
    await browser.dispose()
    throw error
  }
  const tabs = new TabManager({
    transport: cdp,
    jpegQuality: options.jpegQuality,
    viewport: options.viewport,
    onFrame: options.onFrame,
    onTabsChanged: options.onTabsChanged,
  })
  return {
    transport: cdp,
    tabs,
    mode: browser.mode,
    chrome: browser.mode === 'spawn' ? browser.chrome : undefined,
    async dispose() {
      await closeSessionTargets({ transport: cdp, tabs, mode: browser.mode })
      await tabs.dispose()
      cdp.close()
      await browser.dispose()
    },
  }
}

/**
 * The plugin's single browser service.
 */
export class BrowserViewService implements BrowserViewBackend {
  private readonly jpegQuality: number
  private readonly frameFormat: FrameImageFormat
  private readonly captureMax: { width: number; height: number }
  private readonly viewport: { width: number; height: number }
  private readonly idleFrameIntervalMs: number
  private readonly interactiveFrameIntervalMs: number
  private readonly now: () => number
  private readonly openSession: NonNullable<BrowserViewServiceOptions['openSession']>
  private readonly createRelay: () => FrameRelay
  private readonly authenticatedUrl: BrowserViewServiceOptions['authenticatedUrl']
  private readonly mirrorSource: () => string
  private readonly sinks = new Set<BrowserViewSink>()
  /** Per-sink WebRTC frame relay; a sink with an open relay receives frames there. */
  private readonly relays = new Map<BrowserViewSink, FrameRelay>()
  /**
   * Panels that asked to stop the stream - their tab is not on screen (the
   * sidebar is collapsed or another chip is showing). Nothing is captured,
   * encoded or sent for them while they are in here.
   */
  private readonly paused = new Set<BrowserViewSink>()
  /** Per-sink lane choice and mirror cursor. */
  private readonly lanes = new Map<BrowserViewSink, SinkLane>()
  /**
   * Tabs whose mirror failed most recently. A failed injection is remembered so
   * a panel that keeps its socket open does not make the host retry the same
   * doomed injection on every state change; asking for the lane again - the one
   * gesture that could plausibly have changed the page - clears it.
   */
  private readonly mirrorFailures = new Map<string, string>()
  /** The tab the recorder is running for, if any; one mirror at a time. */
  private mirroredTabId: string | null = null
  /** Batch counter for `dom` events; monotonic per service, not per tab. */
  private domSeq = 0
  /**
   * When the last frame reached any panel, for the frame-interval budget.
   * Starts at the beginning of time, not at zero: a clock whose origin is zero
   * (a test clock, or a monotonic counter) would otherwise have its very first
   * frame treated as too soon.
   */
  private lastFrameAt = Number.NEGATIVE_INFINITY
  /** Until when input keeps the interactive frame rate. */
  private interactiveUntil = 0
  private readonly bindings = new Map<string, string>()
  /**
   * Tabs whose one auth top-up for the current navigation is already spent.
   * This is what stops a retry that did not clear the challenge from
   * navigating again; it is reset when the navigation ends.
   */
  private readonly authTopUpSpent = new Set<string>()
  private session: BrowserSession | undefined
  /** The DOM mirror over the running session; absent until one starts. */
  private mirror: DomMirror | undefined
  /**
   * The tab the attached panels watch. Kept beside the tab manager instead of
   * read from it because "the page the panel shows" and "the page most recently
   * created" are different facts: a panel that follows the agent must NOT move
   * to a tab an explicit selection pinned it to, while the tab manager still
   * has to know about every tab that exists.
   */
  private displayedTabId: string | null = null
  /**
   * Whether a person chose the watched tab in the panel. Until that happens the
   * panels follow whatever the agent drives; afterwards they never steal it.
   */
  private selectionPinned = false
  private opening: Promise<BrowserSession> | undefined
  private openingTab: Promise<BrowserTabView> | undefined
  private lastError: string | undefined
  private disposed = false

  /**
   * @param options - quality, viewport, clock, and the browser factory seam.
   */
  constructor(options: BrowserViewServiceOptions = {}) {
    this.jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY
    this.frameFormat = options.frameFormat ?? DEFAULT_FRAME_FORMAT
    this.captureMax = options.captureMax ?? { width: DEFAULT_CAPTURE_MAX.width, height: DEFAULT_CAPTURE_MAX.height }
    this.viewport = options.viewport ?? { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height }
    this.idleFrameIntervalMs = options.frameIntervalMs?.idle ?? FRAME_MIN_INTERVAL_MS
    this.interactiveFrameIntervalMs = options.frameIntervalMs?.interactive ?? INTERACTIVE_FRAME_INTERVAL_MS
    this.now = options.now ?? Date.now
    this.createRelay = options.createRelay ?? (() => new RtcFrameRelay())
    this.openSession = options.openSession ?? openDefaultSession
    this.authenticatedUrl = options.authenticatedUrl
    this.mirrorSource = options.mirrorSource ?? readMirrorSource
  }

  /** Whether a browser is currently running. */
  get running(): boolean {
    return this.session !== undefined
  }

  /** The current panel-facing state; safe to call before anything started. */
  state(): BrowserPanelState {
    const state: BrowserPanelState = {
      tabs: this.session?.tabs.list() ?? [],
      activeTabId: this.session === undefined ? null : this.displayedOrDefault(),
      running: this.session !== undefined,
    }
    if (this.lastError !== undefined) state.message = this.lastError
    return state
  }

  /**
   * Register one panel socket and start the stream it wants.
   * @param sink - socket adapter.
   * @returns the detach function.
   */
  attach(sink: BrowserViewSink): () => void {
    this.sinks.add(sink)
    // A panel that never asked for a lane renders pixels, which is what every
    // panel built before the mirror existed does.
    this.lanes.set(sink, { lane: DEFAULT_VIEW_LANE, tabId: undefined, generation: undefined, offset: 0 })
    // The hello frame is the panel's first paint: it carries the current tabs
    // so a reconnecting panel does not have to ask.
    sink.send({ v: 1, kind: 'hello', state: this.state() })
    void this.syncLanes()
    return () => {
      this.sinks.delete(sink)
      this.paused.delete(sink)
      this.lanes.delete(sink)
      this.relays.get(sink)?.dispose()
      this.relays.delete(sink)
      if (this.activeSinks().length === 0) void this.stopStreaming()
      void this.syncMirror()
    }
  }

  /**
   * Run one validated panel command.
   * @param sink - the sending socket.
   * @param command - validated command.
   */
  async handleCommand(sink: BrowserViewSink, command: BrowserViewCommand): Promise<void> {
    if (this.disposed) return
    try {
      switch (command.kind) {
        case 'attach': {
          // Attaching is observation, never operation: a panel that arrived
          // must not create a tab of its own, or the user ends up watching a
          // blank page instead of the one the agent is driving.
          this.followPanelSession(command.sessionId)
          sink.send({ v: 1, kind: 'hello', state: this.state() })
          await this.syncLanes()
          return
        }
        case 'select-tab': {
          const tabs = await this.requireTabs()
          // A person picked this tab in the panel: from here on the panels stop
          // following the agent until the choice no longer exists.
          tabs.selectTab(command.tabId)
          this.selectionPinned = true
          this.showTab(command.tabId)
          await this.startStreaming()
          return
        }
        case 'request-frame': {
          const tabs = await this.requireTabs()
          const tabId = this.displayedOrDefault()
          if (tabId === null) return
          this.displayedTabId = tabId
          await tabs.refreshFrame(tabId)
          return
        }
        case 'close-tab': {
          await this.closeTab(command.tabId)
          return
        }
        case 'input': {
          // Input follows what the panel is watching, not what any agent
          // session bound: the person clicking sees this tab's frame.
          const tabs = await this.requireTabs()
          const tabId = this.displayedOrDefault()
          if (tabId === null) return
          // Buying back frames for a moment: the person who just interacted is
          // looking at this tab, so the bandwidth is worth spending here.
          this.interactiveUntil = this.now() + INTERACTIVE_WINDOW_MS
          await tabs.dispatchInput(tabId, command.input)
          return
        }
        case 'mode': {
          // One panel picking a lane never moves another's: the choice is what
          // this socket renders, and the recorder is shared only because the
          // page is.
          const lane = this.laneOf(sink)
          lane.lane = command.mode
          lane.tabId = undefined
          lane.generation = undefined
          lane.offset = 0
          const tabId = this.displayedOrDefault()
          if (command.mode === 'dom') {
            // Asking again is the one gesture that can change the outcome: a
            // page that failed to accept the recorder a moment ago may accept
            // it now, and the person just pressed the switch.
            if (tabId !== null) this.mirrorFailures.delete(tabId)
            await this.syncLanes()
          } else {
            await this.syncLanes()
            // The mirror is not a fallback for a picture: a panel that just
            // switched has none, and waiting for the compositor to move could
            // take as long as the page stays still.
            if (tabId !== null) await this.session?.tabs.refreshFrame(tabId).catch(() => undefined)
          }
          return
        }
        case 'stream': {
          // A panel whose tab left the screen says so; the host stops paying
          // for a picture nobody sees. The last panel to leave stops the
          // screencast itself, so an idle page costs no capture either.
          const others = [...this.sinks].filter(candidate => candidate !== sink && !this.paused.has(candidate))
          if (command.enabled) {
            this.paused.delete(sink)
            await this.syncLanes()
            const session = this.session
            const tabId = this.displayedOrDefault()
            if (session !== undefined && tabId !== null) {
              // A panel that was hidden missed whatever the mirror did meanwhile,
              // so its replayer is behind: hand it the recording from its
              // checkpoint again rather than the increments it never saw.
              if (this.needsPixels(sink)) {
                await session.tabs.refreshFrame(tabId).catch(() => undefined)
              } else {
                this.deliverRecording(sink, tabId)
              }
            }
          } else {
            this.paused.add(sink)
            // A paused panel must stop being the reason the recorder runs:
            // hidden is the one state where nothing of this tab is watched.
            void this.syncMirror()
            if (others.length === 0) await this.stopStreaming()
          }
          return
        }
        case 'rtc-offer': {
          // One relay per panel socket; an existing one is replaced, so a
          // renegotiation simply starts over instead of leaking a connection.
          this.relays.get(sink)?.dispose()
          const relay = this.createRelay()
          const answer = await relay.acceptOffer(command.sdp, () => {
            this.relays.get(sink) === relay && this.relays.delete(sink)
          })
          this.relays.set(sink, relay)
          sink.send({ v: 1, kind: 'rtc-answer', sdp: answer })
          return
        }
        default: {
          const unreachable: never = command
          void unreachable
        }
      }
    } catch (error) {
      this.fail('command-failed', error)
    }
  }

  /**
   * Close one tab, drop every binding that pointed at it, and let the panels
   * fall back when the tab they were watching is the one that went away.
   *
   * Bindings are forgotten before the target goes, so a later tool call cannot
   * resurrect a tab somebody deliberately closed.
   * @param tabId - tab to close.
   */
  async closeTab(tabId: string): Promise<void> {
    const tabs = await this.requireTabs()
    const wasDisplayed = tabId === this.displayedTabId
    for (const [sessionId, boundTab] of [...this.bindings]) {
      if (boundTab === tabId) this.bindings.delete(sessionId)
    }
    // The recorder dies with its target: forgetting it here is what keeps a
    // closed tab from holding a buffer nobody can ever read again.
    this.mirrorFailures.delete(tabId)
    await this.stopMirror(tabId)
    await tabs.closeTab(tabId)
    if (wasDisplayed) {
      // The pinned tab is gone, so there is nothing left to hold: fall back to
      // whatever remains and resume following.
      this.selectionPinned = false
      this.displayedTabId = null
      this.showTab(tabs.list().at(-1)?.id ?? null)
    }
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /**
   * Close the tabs one agent session opened, and nothing else.
   *
   * Ownership is read off the tab record rather than the binding map: a session
   * may have driven somebody else's tab through an explicit `tabId`, and that
   * must not make the tab its own to destroy. A caller that names a tab it does
   * not own is refused with the reason instead of being quietly ignored, because
   * a cleanup that reports success while closing nothing is worse than an error.
   *
   * A session with no tab of its own, or a host with no browser running yet,
   * closes nothing and succeeds: cleanup is the one call that must be safe to
   * make unconditionally.
   * @param sessionId - calling agent session; absent means no ownership basis.
   * @param tabId - one tab to close; omitted closes every tab this session owns.
   * @returns ids of the tabs actually closed, in close order.
   */
  async closeOwnTabs(sessionId: string | undefined, tabId?: string): Promise<string[]> {
    if (sessionId === undefined) {
      throw new Error('browser_close needs the calling session: with no session there is no tab this call may close')
    }
    if (this.session === undefined) return []
    const tabs = this.session.tabs
    if (tabId !== undefined && tabId !== '') {
      const found = tabs.list().find(tab => tab.id === tabId)
      if (found === undefined) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`)
      if (found.sessionId !== sessionId) {
        throw new Error(`tab "${tabId}" was not opened by this session, so it is not this session's to close`)
      }
      await this.closeTab(found.id)
      return [found.id]
    }
    const owned = tabs.list().filter(tab => tab.sessionId === sessionId)
    const closed: string[] = []
    for (const tab of owned) {
      await this.closeTab(tab.id)
      closed.push(tab.id)
    }
    return closed
  }

  /**
   * Resolve the tab a tool call from `sessionId` should act on.
   *
   * The order is a safety property, not a preference. An agent that lands on
   * the tab the panel happens to be showing destroys whatever the user was
   * looking at, so the watched tab is only ever a last resort:
   *
   * 1. the tab the caller named,
   * 2. the tab this session created or last worked in,
   * 3. the watched tab, but only while no other session owns it,
   * 4. otherwise a tab of its own.
   *
   * Step 3 exists for the case where the user opened a page nobody is driving
   * (they navigated or selected it themselves); step 3's ownership guard is
   * what keeps a bystander session from taking over a page another session
   * owns — the exact way the watched page used to be lost.
   * @param sessionId - calling agent session, when the host provides one.
   * @param tabId - explicit tab from the tool arguments.
   * @returns the tab view.
   */
  async tabFor(sessionId: string | undefined, tabId?: string): Promise<BrowserTabView> {
    const tabs = await this.requireTabs()
    if (tabId !== undefined && tabId !== '') {
      const found = tabs.list().find(tab => tab.id === tabId)
      if (found === undefined) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`)
      if (this.isAttachMode()) this.requireOwnedTab(found, sessionId)
      if (sessionId !== undefined) this.bindings.set(sessionId, found.id)
      this.focusFollowed(found.id)
      return found
    }
    if (sessionId !== undefined) {
      const bound = this.bindings.get(sessionId)
      if (bound !== undefined) {
        const found = tabs.list().find(tab => tab.id === bound)
        if (found !== undefined) {
          this.focusFollowed(found.id)
          return found
        }
        this.bindings.delete(sessionId)
      }
    }
    if (!this.isAttachMode()) {
      const watching = this.displayedOrDefault()
      if (watching !== null) {
        const found = tabs.list().find(tab => tab.id === watching)
        // Safety invariant, not a default-value preference: one tool navigation
        // must never drive the page the user is watching. A page another session
        // owns is therefore not this session's to drive — falling through to a
        // tab of its own is what holds that invariant, and this guard is what
        // makes it a property rather than an accident of ordering.
        if (found !== undefined && !this.ownedByOtherSession(found.id, sessionId)) {
          if (sessionId !== undefined) this.bindings.set(sessionId, found.id)
          this.focusFollowed(found.id)
          return found
        }
      }
    }
    // In attach mode the watched-tab fallback is skipped entirely: every tab
    // this session may touch is one it created, and ensureTab binds or creates
    // exactly such a tab.
    return await this.ensureTab(sessionId)
  }

  /** Whether the running browser is one the operator owns (attach mode). */
  private isAttachMode(): boolean {
    return this.session?.mode === 'attach'
  }

  /**
   * Enforce the attach-mode target allowlist: a session may only operate a
   * tab it created via Target.createTarget, never a foreign one.
   * @param found - the tab the call named.
   * @param sessionId - the calling session.
   * @throws Error listing the tabs this session may use when the tab is foreign.
   */
  private requireOwnedTab(found: BrowserTabView, sessionId: string | undefined): void {
    if (found.sessionId === sessionId) return
    const allowed = this.session?.tabs.list().filter(tab => tab.sessionId === sessionId) ?? []
    const allowedText = allowed.length === 0
      ? 'this session has none yet; create one with browser_navigate (new_tab or a fresh session creates one)'
      : allowed.map(tab => `"${tab.id}" (${tab.url})`).join(', ')
    throw new Error(
      `tab "${found.id}" was not opened by this session. Attach mode only allows tabs this session created via the tools; allowed tabs: ${allowedText}`,
    )
  }

  /**
   * Whether a tab is bound to some other session.
   * @param tabId - the tab being considered.
   * @param sessionId - the asking session, which does not count as other.
   * @returns true when another session already drives this tab.
   */
  private ownedByOtherSession(tabId: string, sessionId: string | undefined): boolean {
    for (const [owner, bound] of this.bindings) {
      if (bound === tabId && owner !== sessionId) return true
    }
    return false
  }

  /**
   * Get (or lazily create) the tab bound to one session.
   * @param sessionId - calling agent session.
   * @returns the tab view.
   */
  async ensureTab(sessionId?: string): Promise<BrowserTabView> {
    const tabs = await this.requireTabs()
    if (sessionId !== undefined) {
      const bound = this.bindings.get(sessionId)
      if (bound !== undefined) {
        const found = tabs.list().find(tab => tab.id === bound)
        if (found !== undefined) return found
        this.bindings.delete(sessionId)
      }
    }
    // Two concurrent tool calls from a fresh session must share one tab, not
    // race two `Target.createTarget` calls into existence.
    this.openingTab ??= this.createBoundTab(sessionId).finally(() => { this.openingTab = undefined })
    return await this.openingTab
  }

  /** Create a tab, bind it, and make it the one the panel watches. */
  private async createBoundTab(sessionId: string | undefined): Promise<BrowserTabView> {
    const tabs = await this.requireTabs()
    const created = await this.openTab(sessionId)
    // An unopened page still needs its first frame, or the panel shows an empty
    // viewer until something happens to move the compositor.
    await tabs.refreshFrame(created.id).catch(() => undefined)
    return created
  }

  /**
   * Open one additional tab for a session, deliberately without the
   * first-use deduplication {@link ensureTab} applies: asking for a new tab is
   * what the caller wants, so two calls must produce two tabs.
   * @param sessionId - calling agent session.
   * @returns the new tab view, now the session's bound tab and the panel's active one.
   */
  private async openTab(sessionId: string | undefined): Promise<BrowserTabView> {
    const tabs = await this.requireTabs()
    const created = await tabs.createTab({ url: 'about:blank', sessionId })
    if (sessionId !== undefined) {
      this.bindings.set(sessionId, created.id)
      tabs.bindSession(created.id, sessionId)
    }
    // A freshly opened tab is what the agent is about to work on, so a
    // following panel moves to it; a pinned panel keeps its own choice.
    this.focusFollowed(created.id)
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    return created
  }

  /**
   * Navigate a tab and trace the action.
   * @param sessionId - calling agent session.
   * @param url - destination.
   * @param tabId - explicit tab, when the caller named one.
   * @param options - `newTab` opens an additional tab instead of reusing one.
   * @returns the action outcome plus the resulting tab view.
   */
  async navigate(
    sessionId: string | undefined,
    url: string,
    tabId?: string,
    options: { newTab?: boolean } = {},
  ): Promise<{ outcome: ActionOutcome; tab: BrowserTabView }> {
    // An explicit request for a new tab wins over a tab id: the caller is
    // describing where the page should open, not which existing tab to reuse.
    const tab = options.newTab === true
      ? await this.openTab(sessionId)
      : await this.tabFor(sessionId, tabId)
    try {
      const outcome = await navigateTo(this.scope(), tab.id, url)
      await this.topUpAuthTicket(tab.id, url)
      return { outcome: this.trace('navigate', outcome), tab: this.refreshTab(tab.id) }
    } finally {
      // Every navigation gets its own single retry: a later one may be a
      // different page, and a rotated or expired cookie needs the same top-up.
      this.authTopUpSpent.delete(tab.id)
    }
  }

  /**
   * Give a loopback navigation that landed on DSH's own authentication page
   * one launch-token retry.
   *
   * The token rides the URL, and DSH answers the site root with a 303 to the
   * clean address plus the `dsh-auth-<authority>` cookie, so the retried
   * request is served normally. This is an enhancement, never a dependency: a
   * host that mounts no connection service, a seam that throws, and a page
   * that is still the challenge afterwards all end here without an error and
   * leave the navigation result exactly as it is.
   * @param tabId - tab the navigation ran in.
   * @param url - the URL the caller asked for.
   */
  private async topUpAuthTicket(tabId: string, url: string): Promise<void> {
    let ticket = await this.authTicketUrl(tabId, url)
    while (ticket !== undefined) {
      this.authTopUpSpent.add(tabId)
      await navigateTo(this.scope(), tabId, ticket)
      ticket = await this.authTicketUrl(tabId, url)
    }
  }

  /**
   * The ticketed URL for this navigation, or undefined when no retry applies.
   * @param tabId - tab the navigation ran in.
   * @param url - the URL the caller asked for.
   * @returns the URL to retry with, or undefined.
   */
  private async authTicketUrl(tabId: string, url: string): Promise<string | undefined> {
    if (this.authTopUpSpent.has(tabId)) return undefined
    const mint = this.authenticatedUrl
    if (mint === undefined) return undefined
    if (!isLoopbackTarget(url)) return undefined
    if (!(await this.documentShowsAuthChallenge(tabId))) return undefined
    try {
      const ticket = mint(url)
      return typeof ticket === 'string' && ticket !== '' ? ticket : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Whether the tab's current document is DSH's authentication page. Reading
   * the document is best-effort: a tab that refuses the script, or reports
   * something other than text, simply does not match.
   * @param tabId - tab to read.
   * @returns true when the page body is the challenge.
   */
  private async documentShowsAuthChallenge(tabId: string): Promise<boolean> {
    try {
      const scope = this.scope()
      const result = await scope.transport.send<{ result?: { value?: unknown } }>(
        'Runtime.evaluate',
        { expression: DOCUMENT_TEXT_EXPRESSION, returnByValue: true },
        scope.tabs.sessionOf(tabId),
      )
      const text = result.result?.value
      return typeof text === 'string' && isAuthChallengeText(text)
    } catch {
      return false
    }
  }

  /**
   * Click in a tab and trace the action.
   * @param sessionId - calling agent session.
   * @param target - ref, selector, or coordinates.
   * @param tabId - explicit tab.
   * @returns the recorded outcome.
   */
  async click(sessionId: string | undefined, target: ElementTarget, tabId?: string): Promise<ActionOutcome> {
    const tab = await this.tabFor(sessionId, tabId)
    const outcome = await clickElement(this.scope(), tab.id, target)
    return this.trace('click', outcome)
  }

  /**
   * Type into a tab and trace the action.
   * @param sessionId - calling agent session.
   * @param text - text to insert.
   * @param target - optional element to focus first.
   * @param tabId - explicit tab.
   * @returns the recorded outcome.
   */
  async type(sessionId: string | undefined, text: string, target: ElementTarget = {}, tabId?: string): Promise<ActionOutcome> {
    const tab = await this.tabFor(sessionId, tabId)
    const outcome = await typeText(this.scope(), tab.id, text, target)
    return this.trace('type', outcome)
  }

  /**
   * Press one key and trace the action.
   * @param sessionId - calling agent session.
   * @param key - key name or single character.
   * @param tabId - explicit tab.
   * @returns the recorded outcome.
   */
  async press(sessionId: string | undefined, key: string, tabId?: string): Promise<ActionOutcome> {
    const tab = await this.tabFor(sessionId, tabId)
    const outcome = await pressKey(this.scope(), tab.id, key)
    return this.trace('press', outcome)
  }

  /**
   * Scroll a tab and trace the action.
   * @param sessionId - calling agent session.
   * @param delta - scroll distance.
   * @param tabId - explicit tab.
   * @returns the recorded outcome.
   */
  async scroll(sessionId: string | undefined, delta: { deltaX?: number; deltaY?: number; x?: number; y?: number }, tabId?: string): Promise<ActionOutcome> {
    const tab = await this.tabFor(sessionId, tabId)
    const outcome = await scrollBy(this.scope(), tab.id, delta)
    return this.trace('scroll', outcome)
  }

  /**
   * Walk the tab's DOM and remember the ref map for later clicks.
   * @param sessionId - calling agent session.
   * @param tabId - explicit tab.
   * @returns the snapshot the model sees.
   */
  async snapshot(sessionId: string | undefined, tabId?: string): Promise<BrowserSnapshot> {
    const tab = await this.tabFor(sessionId, tabId)
    const tabs = await this.requireTabs()
    const result: SnapshotResult = await buildSnapshot(this.transport(), tab.id, tabs.sessionOf(tab.id), {
      url: tab.url,
      title: tab.title,
    })
    // Record before returning: the very next call is usually the click that
    // uses one of these refs.
    tabs.setSnapshotRefs(tab.id, result.refs)
    return result.snapshot
  }

  /**
   * Capture one JPEG of the tab.
   * @param sessionId - calling agent session.
   * @param tabId - explicit tab.
   * @returns the tab and the base64 JPEG.
   */
  async screenshot(sessionId: string | undefined, tabId?: string): Promise<{ tabId: string; url: string; title: string; data: string }> {
    const tab = await this.tabFor(sessionId, tabId)
    const tabs = await this.requireTabs()
    // JPEG even when the stream is WebP: the screenshot tool declares
    // image/jpeg and the host attachment service is typed to image/jpeg, so a
    // WebP body would be rejected as "declared image type does not match bytes".
    const data = await tabs.captureScreenshot(tab.id, 'jpeg')
    const current = tabs.list().find(candidate => candidate.id === tab.id) ?? tab
    return { tabId: current.id, url: current.url, title: current.title, data }
  }

  /**
   * Console entries of one tab, newest last.
   * @param sessionId - calling agent session.
   * @param limit - maximum trailing entries to return.
   * @param tabId - explicit tab.
   * @returns the entries.
   */
  async console(sessionId: string | undefined, limit = 100, tabId?: string): Promise<{ tabId: string; entries: BrowserConsoleEntry[] }> {
    const tab = await this.tabFor(sessionId, tabId)
    const tabs = await this.requireTabs()
    const entries = tabs.consoleEntries(tab.id)
    return { tabId: tab.id, entries: entries.slice(Math.max(0, entries.length - limit)) }
  }

  /**
   * Network entries of one tab, newest last.
   * @param sessionId - calling agent session.
   * @param limit - maximum trailing entries to return.
   * @param tabId - explicit tab.
   * @returns the entries.
   */
  async network(sessionId: string | undefined, limit = 100, tabId?: string): Promise<{ tabId: string; entries: BrowserNetworkEntry[] }> {
    const tab = await this.tabFor(sessionId, tabId)
    const tabs = await this.requireTabs()
    const entries = tabs.networkEntries(tab.id)
    return { tabId: tab.id, entries: entries.slice(Math.max(0, entries.length - limit)) }
  }

  /** Open tabs, for `browser_tabs`. */
  async listTabs(): Promise<{ tabs: BrowserTabView[]; activeTabId: string | null }> {
    if (this.session === undefined) {
      // Listing tabs is also the cheap "is anything running" probe, so it must
      // answer without starting a browser.
      return { tabs: [], activeTabId: null }
    }
    return { tabs: this.session.tabs.list(), activeTabId: this.displayedOrDefault() }
  }

  /** Push one event to every attached panel, dropping sockets that fail. */
  broadcast(event: BrowserViewEvent): void {
    if (event.kind === 'frame' && !this.withinFrameBudget()) return
    for (const sink of [...this.sinks]) {
      // A paused panel is not looking: it costs no bytes and no decoding.
      if (event.kind === 'frame' && this.paused.has(sink)) continue
      // Neither is a panel that is already rendering the mirror: the picture is
      // exactly the cost the DOM lane exists to remove.
      if (event.kind === 'frame' && !this.needsPixels(sink)) continue
      try {
        // A sink with an open relay takes its frames there, as binary with no
        // base64 tax; everything else still travels the WebSocket.
        if (event.kind === 'frame') {
          const relay = this.relays.get(sink)
          if (relay !== undefined && relay.open) {
            if (relay.sendFrame(event.seq, Buffer.from(event.data, 'base64'))) continue
            // A frame the channel cannot carry is a transport problem, never a
            // panel problem: retire the relay and send this frame (and the
            // following ones) over the WebSocket. Removing the sink here used
            // to freeze the panel for good, because an oversized frame throws.
            relay.dispose()
            this.relays.delete(sink)
          }
        }
        sink.send(event)
      } catch {
        this.sinks.delete(sink)
        this.lanes.delete(sink)
      }
    }
  }

  /**
   * Whether one panel still needs the pixel lane: it asked for pixels, or it
   * asked for the mirror and has no recording to draw yet. The second half is
   * what keeps the switch from showing a blank stage while the recorder arms.
   * @param sink - the panel.
   * @returns true when frames must keep flowing to it.
   */
  private needsPixels(sink: BrowserViewSink): boolean {
    const lane = this.lanes.get(sink)
    return lane === undefined || lane.lane !== 'dom' || lane.generation === undefined
  }

  /** One panel's lane record, created on first use. */
  private laneOf(sink: BrowserViewSink): SinkLane {
    let lane = this.lanes.get(sink)
    if (lane === undefined) {
      lane = { lane: DEFAULT_VIEW_LANE, tabId: undefined, generation: undefined, offset: 0 }
      this.lanes.set(sink, lane)
    }
    return lane
  }

  /**
   * Bring both lanes in line with what the visible panels asked for.
   *
   * One place, called after every event that can change the answer - a panel
   * attaching, hiding, showing or switching, the watched tab moving, a tab
   * closing - so "the recorder runs only while somebody watches" stays a
   * property of the service instead of a rule each call site remembers.
   */
  private async syncLanes(): Promise<void> {
    await this.syncMirror()
    await this.syncStreaming()
  }

  /**
   * Start or stop the recorder to match the visible panels' lanes. The mirror
   * follows the watched tab, exactly like the screencast: a background page
   * nobody renders must not keep a recorder running.
   */
  private async syncMirror(): Promise<void> {
    const session = this.session
    if (session === undefined) return
    const tabId = this.displayedOrDefault()
    const wanted = tabId !== null
      && this.activeSinks().some(sink => this.lanes.get(sink)?.lane === 'dom')
    const target = wanted ? tabId : null
    if (this.mirroredTabId !== null && this.mirroredTabId !== target) {
      const previous = this.mirroredTabId
      this.mirroredTabId = null
      await this.stopMirror(previous)
    }
    if (target !== null && this.mirroredTabId !== target) {
      this.mirroredTabId = target
      await this.startMirror(target)
    }
  }

  /**
   * Arm the recorder in one tab.
   *
   * Every failure ends in {@link failMirror} rather than in a rejected command:
   * the panel did not ask a question, it asked for a lane, and the honest
   * answer is the other lane plus the reason. A tab whose injection is known to
   * fail is not retried until somebody asks for the lane again.
   * @param tabId - the tab to mirror.
   */
  private async startMirror(tabId: string): Promise<void> {
    const session = this.session
    const mirror = this.mirror
    if (session === undefined || mirror === undefined) return
    if (this.mirrorFailures.has(tabId)) return
    if (!session.tabs.has(tabId)) return
    try {
      await mirror.start(tabId, session.tabs.sessionOf(tabId))
    } catch (error) {
      this.failMirror(tabId, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Stop the recorder in one tab; a tab that never recorded is fine.
   *
   * Every cursor pointing at that tab is dropped with it: the recording those
   * cursors describe no longer exists, and a panel left holding a generation
   * would never be told to rebuild when the recorder arms again.
   */
  private async stopMirror(tabId: string | null): Promise<void> {
    if (tabId === null) return
    await this.mirror?.stop(tabId).catch(() => undefined)
    for (const lane of this.lanes.values()) {
      if (lane.tabId !== tabId) continue
      lane.tabId = undefined
      lane.generation = undefined
      lane.offset = 0
    }
  }

  /**
   * Tell the panels watching one tab that its mirror is gone, and move them to
   * the pixel lane.
   *
   * The lane is changed here rather than left to the panel because the host is
   * the side that knows the mirror is dead: a panel moved to pixels starts
   * receiving frames on the next broadcast, and the reason travels with the
   * move so the viewer is never left with an empty stage and no explanation.
   * @param tabId - the tab whose mirror failed.
   * @param reason - what to show the person watching.
   */
  private failMirror(tabId: string, reason: string): void {
    this.mirrorFailures.set(tabId, reason)
    if (this.mirroredTabId === tabId) this.mirroredTabId = null
    let moved = false
    for (const sink of [...this.sinks]) {
      const lane = this.lanes.get(sink)
      if (lane === undefined || lane.lane !== 'dom') continue
      // A panel rendering some other tab's mirror is not affected by this one.
      if (lane.tabId !== undefined && lane.tabId !== tabId) continue
      lane.lane = 'pixels'
      lane.tabId = undefined
      lane.generation = undefined
      lane.offset = 0
      moved = true
      this.sendTo(sink, { v: 1, kind: 'mirror', tabId, available: false, reason })
    }
    if (moved) void this.syncStreaming()
  }

  /** Start or stop the screencast to match what the visible panels need. */
  private async syncStreaming(): Promise<void> {
    if (this.activeSinks().some(sink => this.needsPixels(sink))) await this.startStreaming()
    else await this.stopStreaming()
  }

  /** Deliver one event to one sink, dropping it if the socket is gone. */
  private sendTo(sink: BrowserViewSink, event: BrowserViewEvent): void {
    try {
      sink.send(event)
    } catch {
      this.sinks.delete(sink)
      this.lanes.delete(sink)
    }
  }

  /**
   * Hand the tabs a mirror event changed, filtered and cut for each panel.
   *
   * The cut is per sink because a recording is a stream, not a value: a panel
   * whose cursor is behind gets the events it missed, and a panel whose
   * generation is stale gets the whole recording with `reset` set, which is
   * what its replayer needs to rebuild from a checkpoint.
   * @param tabId - the tab whose recording changed.
   */
  private broadcastDom(tabId: string): void {
    const recording = this.mirror?.recording(tabId)
    if (recording === undefined) return
    let becameReady = false
    for (const sink of [...this.sinks]) {
      if (this.paused.has(sink)) continue
      const lane = this.lanes.get(sink)
      if (lane === undefined || lane.lane !== 'dom') continue
      if (this.deliver(sink, lane, tabId, recording)) becameReady = true
    }
    // The first recording a panel can draw is the moment it stops needing
    // frames; everything before it kept the pixel lane warm.
    if (becameReady) void this.syncStreaming()
  }

  /**
   * Send one panel the part of a recording it does not have yet.
   * @returns whether this delivery is the panel's first drawable recording.
   */
  private deliver(sink: BrowserViewSink, lane: SinkLane, tabId: string, recording: MirrorRecording): boolean {
    if (recording.events.length === 0) return false
    if (lane.tabId !== tabId) {
      lane.tabId = tabId
      lane.generation = undefined
      lane.offset = 0
    }
    const first = lane.generation === undefined
    // A replayer cannot draw an incremental stream, and rrweb's recorder emits
    // its Meta event a beat before the snapshot that goes with it. Waiting for
    // the snapshot is what keeps a panel's first batch drawable instead of
    // hiding the pixel stage behind an empty frame.
    if (first && !recording.events.some(event => eventTypeOf(event) === RRWEB_FULL_SNAPSHOT)) return false
    if (lane.generation !== recording.generation) {
      lane.generation = recording.generation
      lane.offset = recording.events.length
      this.domSeq += 1
      this.sendTo(sink, {
        v: 1,
        kind: 'dom',
        tabId,
        seq: this.domSeq,
        reset: true,
        events: [...recording.events],
      })
      return first
    }
    const fresh = recording.events.slice(lane.offset)
    if (fresh.length === 0) return false
    lane.offset = recording.events.length
    this.domSeq += 1
    this.sendTo(sink, { v: 1, kind: 'dom', tabId, seq: this.domSeq, events: fresh })
    return false
  }

  /**
   * Re-send a panel the recording from its checkpoint, for a panel that was
   * hidden while the page moved on.
   * @param sink - the panel to catch up.
   * @param tabId - the tab whose recording it should draw.
   */
  private deliverRecording(sink: BrowserViewSink, tabId: string): void {
    const recording = this.mirror?.recording(tabId)
    const lane = this.lanes.get(sink)
    if (recording === undefined || lane === undefined || recording.events.length === 0) return
    lane.tabId = tabId
    lane.generation = recording.generation
    lane.offset = recording.events.length
    this.domSeq += 1
    this.sendTo(sink, {
      v: 1,
      kind: 'dom',
      tabId,
      seq: this.domSeq,
      reset: true,
      events: [...recording.events],
    })
  }

  /**
   * Whether the frame-interval budget admits another frame right now: about
   * 15 fps normally, about 30 fps for a moment after input.
   * @returns true when a frame may go out.
   */
  private withinFrameBudget(): boolean {
    const now = this.now()
    const interval = now < this.interactiveUntil ? this.interactiveFrameIntervalMs : this.idleFrameIntervalMs
    if (now - this.lastFrameAt < interval) return false
    this.lastFrameAt = now
    return true
  }

  /**
   * Tear everything down: stop pushing, stop streaming, close the socket, kill
   * the browser.
   * @returns once every owned resource is released.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    // Stop broadcasting first: a panel must not receive a frame from a browser
    // that is already being killed.
    const sinks = [...this.sinks]
    this.sinks.clear()
    for (const relay of this.relays.values()) relay.dispose()
    this.relays.clear()
    this.lanes.clear()
    this.mirrorFailures.clear()
    this.mirroredTabId = null
    for (const sink of sinks) {
      try {
        sink.close()
      } catch {
        // A socket that is already gone needs no second close.
      }
    }
    // The recorder is stopped while the browser can still be talked to: a
    // recording left running in a page nobody will ever look at again is the
    // one leak this ordering prevents.
    const mirror = this.mirror
    this.mirror = undefined
    if (mirror !== undefined) await mirror.dispose().catch(() => undefined)
    const session = this.session
    this.session = undefined
    this.bindings.clear()
    this.displayedTabId = null
    this.selectionPinned = false
    if (session !== undefined) await session.dispose()
  }

  /** The action helpers' collaborator view: one transport, one tab manager. */
  private scope(): { transport: CdpTransport; tabs: TabManager } {
    const session = this.session
    if (session === undefined) throw new Error('the browser is not running')
    return { transport: session.transport, tabs: session.tabs }
  }

  /** The protocol transport of the running session. */
  private transport(): CdpTransport {
    return this.scope().transport
  }

  /** Resolve the live session or start one. */
  private async requireTabs(): Promise<TabManager> {
    return (await this.requireSession()).tabs
  }

  /**
   * Drop a session whose connection ended, so the next call starts a new browser.
   * The panels are told, because a viewer that keeps showing the last frame of a
   * dead browser is worse than one that says the connection dropped.
   * @param reason - what the panels are told happened.
   */
  private loseSession(reason: string): void {
    const session = this.session
    if (session === undefined) return
    this.session = undefined
    this.opening = undefined
    this.openingTab = undefined
    this.bindings.clear()
    this.displayedTabId = null
    this.selectionPinned = false
    this.lastError = reason
    this.lanes.clear()
    this.mirrorFailures.clear()
    this.mirroredTabId = null
    // The mirror rode this transport, so it dies with it. Its own dispose is
    // fire-and-forget: the socket is already gone, and every stop it attempts
    // is best-effort by design.
    const mirror = this.mirror
    this.mirror = undefined
    void mirror?.dispose().catch(() => undefined)
    void Promise.resolve()
      .then(() => session.dispose())
      .catch(() => undefined)
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /** Resolve the live session, starting the browser on first use. */
  private async requireSession(): Promise<BrowserSession> {
    if (this.disposed) throw new Error('the browser view service is disposed')
    if (this.session !== undefined) return this.session
    this.opening ??= this.startSession().finally(() => { this.opening = undefined })
    return await this.opening
  }

  /** Start the browser once, recording failures for the panel. */
  private async startSession(): Promise<BrowserSession> {
    try {
      const session = await this.openSession({
        jpegQuality: this.jpegQuality,
        frameFormat: this.frameFormat,
        captureMax: this.captureMax,
        viewport: this.viewport,
        onFrame: frame => { this.broadcast({ v: 1, kind: 'frame', ...frame }) },
        onTabsChanged: () => { this.broadcast({ v: 1, kind: 'state', state: this.state() }) },
      })
      this.session = session
      // The mirror is built over this session's transport and resolves tabs
      // through the tab manager's own page sessions: one attach per tab, the
      // one the console ring and the network table already use.
      this.mirror = new DomMirror({
        transport: session.transport,
        source: this.mirrorSource,
        onEvent: tabId => { this.broadcastDom(tabId) },
        onFailure: (tabId, reason) => { this.failMirror(tabId, reason) },
      })
      // A browser can die while it is idle: a crashed renderer, an operator
      // killing it, the machine reclaiming memory. Forget the session the moment
      // its connection ends, so the next call starts a fresh browser instead of
      // failing forever against a corpse.
      session.transport.onClose(() => { this.loseSession('the browser connection dropped') })
      this.lastError = undefined
      this.broadcast({ v: 1, kind: 'state', state: this.state() })
      return session
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.broadcast({ v: 1, kind: 'error', code: 'browser-launch-failed', message: this.lastError })
      throw error
    }
  }

  /** Start the screencast for the tab the panel watches. */
  private activeSinks(): BrowserViewSink[] {
    return [...this.sinks].filter(sink => !this.paused.has(sink))
  }

  private async startStreaming(): Promise<void> {
    const session = this.session
    if (session === undefined || this.activeSinks().length === 0) return
    const tabId = this.displayedOrDefault()
    if (tabId === null) return
    this.displayedTabId = tabId
    await session.tabs.startScreencast(tabId).catch(error => { this.fail('screencast-failed', error) })
  }

  /** Stop streaming when nobody is watching. */
  private async stopStreaming(): Promise<void> {
    const session = this.session
    if (session === undefined) return
    const tabId = this.displayedOrDefault()
    if (tabId === null) return
    await session.tabs.stopScreencast(tabId).catch(() => undefined)
  }

  /**
   * The tab the panels currently watch: an explicit choice while that tab
   * still exists, otherwise the newest tab, so a panel is never left pointing
   * at a tab that no longer exists.
   * @returns the watched tab id, or null when nothing is open.
   */
  private displayedOrDefault(): string | null {
    const tabs = this.session?.tabs.list() ?? []
    if (this.displayedTabId !== null && tabs.some(tab => tab.id === this.displayedTabId)) return this.displayedTabId
    return tabs.at(-1)?.id ?? null
  }

  /**
   * Show one tab to the panels and move the screencast with it.
   * @param tabId - the tab to watch, or null when the last one closed.
   */
  private showTab(tabId: string | null): void {
    if (this.displayedTabId === tabId) {
      // Nothing moved, but the caller may still owe the panels a state frame
      // (a tab's url changed, for instance).
      this.broadcast({ v: 1, kind: 'state', state: this.state() })
      void this.syncMirror()
      return
    }
    const session = this.session
    const previous = this.displayedTabId
    this.displayedTabId = tabId
    if (session !== undefined && this.sinks.size > 0) {
      // One screencast at a time: the tab nobody watches must stop emitting,
      // or a background page keeps the browser busy for no viewer.
      if (previous !== null) void session.tabs.stopScreencast(previous).catch(() => undefined)
      if (tabId !== null) void session.tabs.startScreencast(tabId).catch(() => undefined)
    }
    // The recorder follows the same rule as the screencast: the watched tab
    // only, and only while somebody visible is rendering the mirror.
    void this.syncMirror()
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /**
   * Let the panels follow an agent action unless a person pinned a tab.
   * @param tabId - the tab the agent just used.
   */
  private focusFollowed(tabId: string): void {
    if (this.selectionPinned) return
    this.showTab(tabId)
  }

  /**
   * Show the tab a panel's own session already owns, if it has one.
   *
   * Deliberately creates and binds nothing: an attaching panel observes. A
   * session without a tab keeps following the page the agent is driving.
   * @param sessionId - the session the panel belongs to.
   */
  private followPanelSession(sessionId: string | undefined): void {
    const session = this.session
    if (session === undefined || sessionId === undefined) return
    const bound = this.bindings.get(sessionId)
    if (bound === undefined) return
    const found = session.tabs.list().find(tab => tab.id === bound)
    if (found !== undefined) this.showTab(found.id)
  }

  /** Broadcast one readable action trace and return it as the tool outcome. */
  private trace(tool: string, outcome: ActionOutcome): ActionOutcome {
    const trace: BrowserActionTrace = { tool, summary: outcome.summary, at: this.now() }
    this.broadcast({ v: 1, kind: 'action', trace })
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    return outcome
  }

  /** Re-read one tab after a navigation changed its url. */
  private refreshTab(tabId: string): BrowserTabView {
    const session = this.session
    if (session === undefined) return { id: tabId, url: '', title: '', loading: false }
    return session.tabs.list().find(tab => tab.id === tabId) ?? { id: tabId, url: '', title: '', loading: false }
  }

  /** Report a failure to the panels without throwing at the caller. */
  private fail(code: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.lastError = message
    this.broadcast({ v: 1, kind: 'error', code, message })
  }
}
