/**
 * The browser view tab's content, mounted by the right sidebar into its
 * content area under the 'browser-view' tab type.
 *
 * The shell owns the column, the chip, the close control and the switch between
 * tabs; this file owns what is drawn inside one tab and scrolls inside it. It
 * therefore has no title bar of its own and no "back" control - a page header
 * in a sidebar tab would repeat the chip right above it - and it fills the
 * height it is given instead of positioning itself against the viewport.
 *
 * The body is laid out like the shipped browser tab's chrome: one 38px toolbar
 * holding the address display, the connection marker and the one control this
 * plugin actually has - refresh the captured frame - then the frame itself,
 * then the action trace. Nothing here claims a capability the host does not
 * expose: there is no forward/back pair, no reload of the page (the host drives
 * navigation, this side only observes it) and no "open in a new window",
 * because the page lives in a Chromium process on the host.
 *
 * The refresh control and the state marker are the product's own atoms -
 * IconRefreshOutlineRegular and StateDot from @deepseek-ai/dsh-client-ui-primitives,
 * the same two the shipped browser tab's toolbar uses - so the chrome is drawn
 * from one source rather than redrawn beside it. The package's Vite config
 * inlines @deepseek-ai packages, which is what lets the jsdom body tests load
 * that entry point (it imports its own stylesheets).
 *
 * Frame rendering: an <img> fed a base64 JPEG data URL, not a <canvas>. The host
 * already decoded and re-encoded the frame (CDP gives it JPEG base64), so there
 * are no pixels for this side to compose - a canvas would add a drawImage hop,
 * a context lifecycle and an invalidation race for zero gain, while the image
 * element decodes off the main thread and lets CSS own the aspect-ratio fit.
 *
 * Two lanes. The default is the DOM mirror: the host serializes the page with
 * rrweb and streams its mutations, and this body replays them as real DOM, so
 * text stays crisp and the traffic is event-sized instead of frame-sized. The
 * pixel lane is kept, one click away, because a DOM cannot show a `<video>`, a
 * canvas or native UI - and because it is the fallback when the mirror cannot
 * start, in which case the reason is shown rather than an empty stage. While a
 * mirror is still being armed the pixel lane stays on screen, so the switch
 * never trades a live picture for a blank one.
 *
 * The mirror is read-only. Mapping a click on a replayed node back to a CDP
 * action on the recorded page's element is deliberately not implemented here:
 * rrweb's replayer renders into its own iframe whose nodes are a reconstruction,
 * not the page, so a click would have to be resolved against a node id the host
 * never sees. Input stays on the pixel stage until that mapping exists.
 *
 * Input relay: the live frame is also an interactive surface. Pointer and key
 * events on the image are rescaled to the host-pinned viewport and relayed as
 * `input` commands, which the host turns into CDP `Input.*` calls. The events
 * the panel page itself would want (typing into the address box, scrolling the
 * sidebar) stay untouched: keyboard capture only happens while the frame is
 * focused, and the wheel listener is scoped to the image element.
 *
 * Frame transport: frames arrive over the WebSocket by default, and the panel
 * additionally offers a WebRTC DataChannel (unreliable, unordered) - when the
 * host accepts, binary frames arrive there and are painted straight onto a
 * canvas, skipping the base64 and JSON hops. Any failure falls back to the
 * WebSocket stream transparently; nothing user-visible depends on the upgrade.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  IconRefreshOutlineRegular,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserActionTrace, BrowserInputEvent, BrowserPanelState, BrowserViewLane } from '../core/protocol.ts'
import { BROWSER_VIEW_API_VERSION } from '../core/protocol.ts'
import { FrameAssembler, readFrameChunk } from './frame-assembly.ts'
import type { BrowserViewLiveTitleStore } from './live-title.ts'
import { createRrwebMirror, type BrowserViewMirrorFactory, type BrowserViewMirrorHandle } from './mirror.ts'
import { BROWSER_VIEW_PARTS, BROWSER_VIEW_PLUGIN } from './semantic.ts'
import {
  connectBrowserViewSocket,
  type BrowserViewFrame,
  type BrowserViewSocket,
  type BrowserViewSocketHandlers,
  type BrowserViewSocketStatus,
} from './socket.ts'
import css from './panel.module.css'

/** Page-side socket factory; tests inject a fake transport through it. */
export type BrowserViewSocketFactory = (handlers: BrowserViewSocketHandlers) => BrowserViewSocket

/** Business face injected into the tab body. */
export interface BrowserViewPanelFace {
  /** Session whose screencast this body shows. */
  readonly sessionId?: string
  /** Channel the chip reads this body's page title from. */
  readonly liveTitle?: BrowserViewLiveTitleStore
}

/** Panel props: the locale seat, the injected face, and the seams a test may supply. */
export type BrowserViewPanelProps = PropsLocale<'browser-view'> & Partial<BrowserViewPanelFace> & {
  /** Socket factory override; defaults to the real same-origin connection. */
  readonly socketFactory?: BrowserViewSocketFactory
  /** Origin override; defaults to the page's own location. */
  readonly location?: { readonly protocol: string; readonly host: string }
  /**
   * Builds the DOM mirror's replayer. Overridden by tests, which have no
   * browser to replay into; the default loads rrweb lazily.
   */
  readonly mirrorFactory?: BrowserViewMirrorFactory
}

/** Trace rows kept on screen; older tool calls scroll out of relevance. */
const TRACE_LIMIT = 5

/** State before the host publishes anything. */
const EMPTY_STATE: BrowserPanelState = { tabs: [], activeTabId: null, running: false }

/** Join truthy class names (CSS Modules maps are typed as plain records). */
function cx(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ')
}

/**
 * Render the browser view tab body.
 * @param props - composed slot props.
 * @returns the tab content.
 */
export function BrowserViewPanel({ t, sessionId, liveTitle, socketFactory, location, mirrorFactory }: BrowserViewPanelProps) {
  const [state, setState] = useState<BrowserPanelState>(EMPTY_STATE)
  const [frame, setFrame] = useState<BrowserViewFrame | null>(null)
  const [traces, setTraces] = useState<ReadonlyArray<BrowserActionTrace>>([])
  const [error, setError] = useState<{ readonly code: string; readonly message: string } | null>(null)
  const [status, setStatus] = useState<BrowserViewSocketStatus>('connecting')
  /**
   * Lane this panel renders. The DOM mirror is the default because it is the
   * cheap, crisp one; the pixel lane is what the switch and the fallback use.
   */
  const [lane, setLane] = useState<BrowserViewLane>('dom')
  /** Bumped for every checkpoint batch, which is what rebuilds the replayer. */
  const [mirrorCheckpoints, setMirrorCheckpoints] = useState(0)
  /** Whether the replayer is mounted and drawing. */
  const [mirrorReady, setMirrorReady] = useState(false)
  /** Why the mirror is not running; shown beside the pixel picture it fell in to. */
  const [mirrorNotice, setMirrorNotice] = useState<string | null>(null)
  const socketRef = useRef<BrowserViewSocket | null>(null)
  /** Last active tab seen in a state push; a tab switch invalidates the picture. */
  const lastActiveTabRef = useRef<string | null>(null)
  /** Lane the panel asked the host for, readable from socket callbacks. */
  const laneRef = useRef<BrowserViewLane>('dom')
  /** The checkpoint batch the replayer is (re)built from. */
  const mirrorCheckpointRef = useRef<ReadonlyArray<unknown>>([])
  /** Mounted replayer; live events are pushed into it as they arrive. */
  const mirrorHandleRef = useRef<BrowserViewMirrorHandle | null>(null)
  /** Element the replayer is mounted into. */
  const mirrorRootRef = useRef<HTMLDivElement | null>(null)

  /**
   * Move to the pixel lane because the mirror cannot be shown, and say why.
   *
   * The host is told, not just the state: it is the side that stops sending
   * frames once a mirror is live, so a panel that quietly stops rendering the
   * mirror would freeze on its last drawn state. Not sending it in the
   * host-driven case is deliberate - there the host has already moved this
   * sink and sending it back would be a round trip that changes nothing.
   * @param reason - what to show the person watching.
   */
  const fallBackToPixels = (reason: string, tellHost = true): void => {
    if (laneRef.current !== 'pixels') {
      laneRef.current = 'pixels'
      setLane('pixels')
    }
    setMirrorReady(false)
    setMirrorNotice(reason)
    if (tellHost) socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: 'pixels' })
  }

  const factory = useMemo<BrowserViewSocketFactory>(
    () => socketFactory ?? ((handlers) => connectBrowserViewSocket(handlers, { location, sessionId })),
    [socketFactory, location, sessionId],
  )


  useEffect(() => {
    const instance = factory({
      onStatus: (next) => {
        setStatus(next)
        if (next !== 'open') return
        // The host's lane choice died with the old socket, so the panel asks
        // for its own again on every connection - including the mirror, which
        // is what makes a reconnect retry a mirror that had failed.
        socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: laneRef.current })
        // A reconnected host streams by default, so a panel that is off screen
        // has to say so again on the new socket.
        if (!announcedRef.current) {
          socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'stream', enabled: false })
        }
      },
      onState: (next) => {
        // Compare outside the state updater: an updater must stay pure, and a
        // frame from the previous tab would otherwise stay on screen after the
        // page switched tabs.
        if (lastActiveTabRef.current !== next.activeTabId) {
          lastActiveTabRef.current = next.activeTabId
          setFrame(null)
          // A recording belongs to one tab; the next one arrives as a fresh
          // checkpoint, so the replayer built for the old tab is torn down.
          mirrorCheckpointRef.current = []
          setMirrorCheckpoints(0)
          setMirrorReady(false)
        }
        setState(next)
      },
      onFrame: (next) => {
        setError(null)
        frameFormatRef.current = next.format ?? 'jpeg'
        setFrame(next)
      },
      onDom: (batch) => {
        // A batch for a tab the panel has already left would rebuild the
        // replayer on the wrong page.
        if (lastActiveTabRef.current !== null && batch.tabId !== lastActiveTabRef.current) return
        if (batch.reset) {
          mirrorCheckpointRef.current = batch.events
          setMirrorReady(false)
          setMirrorCheckpoints((current) => current + 1)
          return
        }
        // Live increments go straight into the running replay; waiting for a
        // recording to finish would mean never showing anything.
        for (const event of batch.events) mirrorHandleRef.current?.addEvent(event)
      },
      onMirror: (mirror) => {
        if (mirror.available) return
        if (lastActiveTabRef.current !== null && mirror.tabId !== lastActiveTabRef.current) return
        // The host has already moved this sink to pixels, so this is the
        // no-round-trip branch of the fallback.
        fallBackToPixels(mirror.reason ?? t('panel.mirror.unavailable'), false)
      },
      onAction: (trace) => {
        setTraces((current) => [trace, ...current].slice(0, TRACE_LIMIT))
      },
      onError: (code, message) => { setError({ code, message }) },
      onRtcAnswer: (sdp) => { rtcAnswerRef.current?.(sdp) },
    })
    socketRef.current = instance
    return () => {
      socketRef.current = null
      instance.close()
    }
  }, [factory])

  // Mount, rebuild and tear down the DOM mirror.
  //
  // The replayer is built from a checkpoint batch and then fed live events: one
  // effect keyed on the checkpoint counter, so a recorded checkpoint replaces
  // the replay exactly once instead of every batch. The pixel lane stays on
  // screen until the first replayer is up, which is what keeps the default lane
  // from showing an empty stage while the recorder arms.
  useEffect(() => {
    if (lane !== 'dom' || mirrorCheckpoints === 0) return
    const root = mirrorRootRef.current
    if (root === null) return
    const build = mirrorFactory ?? createRrwebMirror
    let cancelled = false
    let handle: BrowserViewMirrorHandle | null = null
    // Started on a resolved promise, not called directly: a factory that throws
    // synchronously must land in the same catch as one that rejects, or the
    // failure would escape the effect and take the whole tab down with it.
    void Promise.resolve()
      .then(() => build(root, mirrorCheckpointRef.current))
      .then((created) => {
        if (cancelled) {
          created.destroy()
          return
        }
        handle = created
        mirrorHandleRef.current = created
        setMirrorReady(true)
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        // A replayer that cannot be built is a mirror that cannot be shown:
        // fall back with the reason rather than leave a blank stage.
        fallBackToPixels(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      cancelled = true
      handle?.destroy()
      mirrorHandleRef.current = null
      setMirrorReady(false)
    }
  }, [lane, mirrorCheckpoints, mirrorFactory])

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
  // Loading is per tab on the wire; the connection phase joins it so a page
  // that is still dialing never claims to be live.
  const loading = activeTab?.loading === true || status !== 'open'
  // The wire carries two failure channels: an explicit error push, and the
  // message a state push may use to say "show this instead of a frame". Both
  // land on the same block so the tab never shows a stale picture beside a host
  // complaint.
  const hostError = state.message !== undefined && state.message.length > 0
    ? { code: '', message: state.message }
    : null
  const effectiveError = error ?? hostError
  // One narrowed value for the stage: a frame is only paintable when the host
  // reported no error, which keeps the null check off the JSX branch.
  const visibleFrame = effectiveError === null ? frame : null
  const dataUrl = visibleFrame === null
    ? null
    : `data:image/${visibleFrame.format ?? 'jpeg'};base64,${visibleFrame.data}`
  // --- Input relay -------------------------------------------------------
  // One wire frame per gesture; moves are throttled because a dragged pointer
  // fires far faster than the page can usefully consume.
  const frameRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastMoveAtRef = useRef(0)
  const MOVE_THROTTLE_MS = 33

  // --- WebRTC DataChannel frame transport --------------------------------
  // Offered once per socket session, after the first WS frame proves the
  // stream is alive. Until the channel opens (or if it never does) the WS
  // stream keeps feeding the <img>; opening the channel flips rendering to
  // the <canvas> and the WS frame events stop arriving (the host filters
  // them for a sink with an open relay).
  const [dcActive, setDcActive] = useState(false)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const rtcTriedRef = useRef(false)
  const rtcAnswerRef = useRef<((sdp: string) => void) | undefined>(undefined)
  /** Encoding of the last frame seen over the socket; the DataChannel path has
   *  no per-message header field for it, so it inherits the stream's. */
  const frameFormatRef = useRef<'jpeg' | 'webp'>('jpeg')
  /** Panel root, observed to learn whether this tab is actually on screen. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** Whether this panel last told the host it is watching (the host's default). */
  const announcedRef = useRef(true)
  /** Reassembles chunked DataChannel frames. */
  const assemblerRef = useRef(new FrameAssembler())

  /** One lane switch: the panel tells the host and moves its own stage. */
  const switchLane = (next: BrowserViewLane): void => {
    laneRef.current = next
    setLane(next)
    // A person asking for a lane is also clearing the last failure's notice;
    // the host clears its own record of it on the same command.
    setMirrorNotice(null)
    setMirrorReady(false)
    socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'mode', mode: next })
  }

  const sendInput = (input: BrowserInputEvent): void => {
    socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'input', input })
  }

  /** Rescale a pointer position from displayed size to the host viewport. */
  const pointOf = (event: { readonly clientX: number; readonly clientY: number }): { x: number; y: number } | null => {
    const element = dcActive ? canvasRef.current : frameRef.current
    if (element === null || visibleFrame === null) return null
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: Math.round((event.clientX - rect.left) * (visibleFrame.width / rect.width)),
      y: Math.round((event.clientY - rect.top) * (visibleFrame.height / rect.height)),
    }
  }

  const buttonOf = (event: { readonly button: number }): 'left' | 'middle' | 'right' => {
    return event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left'
  }

  const modifiersOf = (event: { readonly altKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean }): string[] => {
    const modifiers: string[] = []
    if (event.altKey) modifiers.push('alt')
    if (event.ctrlKey) modifiers.push('ctrl')
    if (event.metaKey) modifiers.push('meta')
    if (event.shiftKey) modifiers.push('shift')
    return modifiers
  }

  // The wheel listener must be non-passive to keep the sidebar itself from
  // scrolling while the remote page scrolls; React's synthetic onWheel cannot
  // promise that, so this one is attached by hand and scoped to the image.
  useEffect(() => {
    const element: HTMLElement | null = dcActive ? canvasRef.current : frameRef.current
    if (element === null || visibleFrame === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const point = pointOf(event)
      if (point === null) return
      sendInput({ kind: 'wheel', x: point.x, y: point.y, deltaX: event.deltaX, deltaY: event.deltaY })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [visibleFrame, dcActive])

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement | HTMLImageElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointOf(event)
    if (point !== null) {
      sendInput({ kind: 'mouse', action: 'down', x: point.x, y: point.y, button: buttonOf(event) })
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement | HTMLImageElement>): void => {
    const now = Date.now()
    if (now - lastMoveAtRef.current < MOVE_THROTTLE_MS) return
    lastMoveAtRef.current = now
    const point = pointOf(event)
    if (point !== null) sendInput({ kind: 'mouse', action: 'move', x: point.x, y: point.y })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement | HTMLImageElement>): void => {
    const point = pointOf(event)
    if (point !== null) {
      sendInput({ kind: 'mouse', action: 'up', x: point.x, y: point.y, button: buttonOf(event) })
    }
  }

  // Keyboard capture only while the frame is focused (tabIndex drives that),
  // so typing into the address box or other chrome is never hijacked.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement | HTMLImageElement>): void => {
    if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Tab') event.preventDefault()
    sendInput({
      kind: 'key',
      action: 'down',
      key: event.key,
      code: event.code,
      ...(event.key.length === 1 ? { text: event.key } : {}),
      modifiers: modifiersOf(event),
    })
  }

  const onKeyUp = (event: ReactKeyboardEvent<HTMLCanvasElement | HTMLImageElement>): void => {
    sendInput({ kind: 'key', action: 'up', key: event.key, code: event.code, modifiers: modifiersOf(event) })
  }

  const inputHandlers = visibleFrame === null ? {} : {
    tabIndex: 0,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    onKeyUp,
  }

  // Tell the host when this tab is not on screen.
  //
  // The sidebar keeps the panel mounted while the column is collapsed or
  // another chip is showing, so "mounted" is not "watching": without this an
  // animating page keeps pushing frames nobody sees for as long as the panel
  // lives. The host stops capturing, encoding and sending for a panel that
  // reports itself hidden, and sends one fresh frame when it returns.
  //
  // The shell's hiding mechanism is not part of this plugin's contract, so the
  // state is derived from three signals instead of one: intersection (covers
  // display:none, zero size and off-screen), the document's own visibility
  // (the whole GUI tab is hidden), and a slow poll that walks the ancestors for
  // a computed display/visibility/content-visibility change - which is what
  // covers a sidebar that hides the column with `visibility: hidden` and
  // therefore keeps a layout box intersection would still call visible.
  useEffect(() => {
    const element = rootRef.current
    // jsdom, the client test environment, has no IntersectionObserver and no
    // layout; the browser always has both.
    if (element === null || typeof IntersectionObserver === 'undefined') return
    let intersecting = element.getClientRects().length > 0
    const rendered = (): boolean => {
      if (document.visibilityState !== 'visible') return false
      if (!intersecting) return false
      const box = element.getBoundingClientRect()
      if (box.width < 2 || box.height < 2) return false
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (style.contentVisibility === 'hidden') return false
      }
      return true
    }
    const announce = (): void => {
      const visible = rendered()
      if (announcedRef.current === visible) return
      announcedRef.current = visible
      socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'stream', enabled: visible })
    }
    const observer = new IntersectionObserver((entries) => {
      intersecting = entries.some(entry => entry.isIntersecting)
      announce()
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', announce)
    const poll = window.setInterval(announce, 1_000)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', announce)
      window.clearInterval(poll)
    }
  }, [])

  // Offer the DataChannel once per socket session, after the first WS frame
  // shows the stream is alive. A five-second window covers ICE; past it the
  // connection is torn down and the WS stream simply continues. On reconnect
  // the host relay is gone, so the attempt flag resets with the status.
  useEffect(() => {
    if (status !== 'open') {
      rtcTriedRef.current = false
      setDcActive(false)
      return
    }
    if (rtcTriedRef.current || dataUrl === null || frame === null) return
    rtcTriedRef.current = true
    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection({ iceServers: [] })
    } catch {
      return
    }
    pcRef.current = pc
    // A new peer connection starts a new stream: a partial frame from the old
    // channel can never be completed and must not be mixed into this one.
    assemblerRef.current.reset()
    const channel = pc.createDataChannel('frames', { ordered: false, maxRetransmits: 0 })
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => { setDcActive(true) }
    channel.onclose = () => { setDcActive(false) }
    // A frame larger than the DataChannel message cap arrives as several
    // chunks (see host/rtc.ts): [u32 seq][u8 index][u8 count] then payload.
    // The channel is unordered and unreliable by design, so chunks are
    // accumulated per sequence and a chunk for a newer frame abandons the
    // partial one - a late chunk can never complete a stale frame on screen.
    channel.onmessage = (event: MessageEvent) => {
      const chunk = readFrameChunk(event.data as ArrayBuffer)
      if (chunk === null) return
      const complete = assemblerRef.current.push(chunk)
      if (complete === null) return
      const blob = new Blob([complete], { type: `image/${frameFormatRef.current}` })
      void createImageBitmap(blob).then((bitmap) => {
        const canvas = canvasRef.current
        if (canvas !== null) {
          if (canvas.width !== bitmap.width) canvas.width = bitmap.width
          if (canvas.height !== bitmap.height) canvas.height = bitmap.height
          const context = canvas.getContext('2d')
          context?.drawImage(bitmap, 0, 0)
        }
        bitmap.close()
        setDcActive(true)
      }).catch(() => undefined)
    }
    rtcAnswerRef.current = (sdp: string) => {
      void pc.setRemoteDescription(JSON.parse(sdp) as RTCSessionDescriptionInit).catch(() => undefined)
    }
    void pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'rtc-offer', sdp: JSON.stringify(pc.localDescription) })
      })
      .catch(() => { pc.close() })
    const timeout = setTimeout(() => {
      if (channel.readyState !== 'open') {
        rtcAnswerRef.current = undefined
        pc.close()
        setDcActive(false)
      }
    }, 5_000)
    return () => {
      clearTimeout(timeout)
      rtcAnswerRef.current = undefined
      pc.close()
      setDcActive(false)
    }
  }, [status, dataUrl === null, frame === null])

  // The marker names what the viewer is actually looking at: the socket's phase
  // first (nothing is live before the host answers), then the page's own load
  // state. The same three strings the trace footer used to carry.
  const statusLabel = status !== 'open'
    ? t('panel.status.connecting')
    : loading ? t('panel.status.loading') : t('panel.status.live')
  // Three of the product's five dot states, in the order a viewer meets them:
  // nothing reached yet, a page still loading, a settled live picture.
  const dotState: StateDotState = status !== 'open' ? 'idle' : loading ? 'ongoing' : 'done'
  const pageTitle = activeTab === null || activeTab.title.length === 0 ? undefined : activeTab.title
  const url = activeTab?.url ?? ''

  // The chip beside this tab names the page being streamed, and only this body
  // can know that name. Publishing in an effect keeps render pure; the cleanup
  // clears the entry so a closed tab leaves no stale name behind.
  useEffect(() => {
    liveTitle?.set(sessionId, pageTitle)
    return () => { liveTitle?.set(sessionId, undefined) }
  }, [liveTitle, sessionId, pageTitle])

  return (
    <div ref={rootRef} className={css.root} data-dsh-plugin={BROWSER_VIEW_PLUGIN} data-dsh-part={BROWSER_VIEW_PARTS.panel}>
      <div className={css.toolbar} data-dsh-part={BROWSER_VIEW_PARTS.toolbar}>
        <div className={css.addressBox} data-dsh-part={BROWSER_VIEW_PARTS.address}>
          <input
            className={css.address}
            type="text"
            readOnly
            value={url}
            title={url.length > 0 ? url : undefined}
            placeholder={t('panel.url.empty')}
            aria-label={t('panel.address.label')}
            spellCheck={false}
            // Selecting on click is the address bar's own gesture: the whole
            // address is ready to copy without a second control.
            onFocus={(event) => { event.currentTarget.select() }}
            onClick={(event) => { event.currentTarget.select() }}
          />
        </div>
        <span className={css.status} data-dsh-part={BROWSER_VIEW_PARTS.status} aria-live="polite">
          <StateDot state={dotState} size={10} />
          <span className={css.statusText}>{statusLabel}</span>
        </span>
        <button
          type="button"
          className={cx(css.tool, css.mode)}
          data-dsh-part={BROWSER_VIEW_PARTS.mode}
          data-mode={lane}
          title={t('panel.mode.switch')}
          aria-label={t('panel.mode.switch')}
          disabled={activeTab === null}
          onClick={() => { switchLane(lane === 'dom' ? 'pixels' : 'dom') }}
        >
          {lane === 'dom' ? t('panel.mode.dom') : t('panel.mode.pixels')}
        </button>
        <button
          type="button"
          className={css.tool}
          title={t('panel.toolbar.refresh')}
          aria-label={t('panel.toolbar.refresh')}
          disabled={activeTab === null}
          onClick={() => {
            socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'request-frame' })
          }}
        >
          <IconRefreshOutlineRegular />
        </button>
      </div>
      {state.tabs.length > 1 && (
        <div className={css.tabs} role="tablist" data-dsh-part={BROWSER_VIEW_PARTS.tabs}>
          {state.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === state.activeTabId}
              className={cx(css.tab, tab.id === state.activeTabId && css.tabActive)}
              title={tab.url}
              onClick={() => {
                socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'select-tab', tabId: tab.id })
              }}
            >
              {tab.title.length > 0 ? tab.title : t('panel.tab.untitled')}
            </button>
          ))}
        </div>
      )}
      <div className={css.content}>
        {effectiveError !== null ? (
          <div className={css.error} data-dsh-part={BROWSER_VIEW_PARTS.error} role="alert">
            <span className={css.errorTitle}>{t('panel.error.title')}</span>
            <span className={css.errorBody}>{effectiveError.message}</span>
            {effectiveError.code.length > 0 && <span className={css.errorCode}>{effectiveError.code}</span>}
          </div>
        ) : (
          <>
            {/* Mounted whenever the mirror is the chosen lane, hidden while the
                pixel stage still owns the picture: the replayer is built into
                this element and remounting it would lose the replay. */}
            {lane === 'dom' && (
              <div
                ref={mirrorRootRef}
                className={cx(css.mirror, !mirrorReady && css.mirrorIdle)}
                data-dsh-part={BROWSER_VIEW_PARTS.mirror}
              />
            )}
            {lane === 'dom' && mirrorReady ? null
              : dataUrl === null || visibleFrame === null
                ? lane === 'dom' && activeTab !== null
                  // A page is open and the mirror is arming: say so instead of
                  // showing the no-page placeholder or an empty stage.
                  ? <div className={css.mirrorNote} data-dsh-part={BROWSER_VIEW_PARTS.mirrorStarting}>{t('panel.mirror.starting')}</div>
                  : (
                    <div className={css.empty} data-dsh-part={BROWSER_VIEW_PARTS.empty}>
                      <span className={css.emptyTitle}>{t('panel.empty.title')}</span>
                      <span className={css.emptyHint}>{t('panel.empty.hint')}</span>
                    </div>
                  )
                : dcActive ? (
                  <canvas
                    ref={canvasRef}
                    className={css.frame}
                    data-dsh-part={BROWSER_VIEW_PARTS.frame}
                    width={visibleFrame.width}
                    height={visibleFrame.height}
                    style={{ cursor: 'default', outline: 'none' }}
                    {...inputHandlers}
                  />
                ) : (
                  <img
                    ref={frameRef}
                    className={css.frame}
                    data-dsh-part={BROWSER_VIEW_PARTS.frame}
                    src={dataUrl}
                    alt={t('panel.frame.alt')}
                    width={visibleFrame.width}
                    height={visibleFrame.height}
                    draggable={false}
                    style={{ cursor: 'default', outline: 'none' }}
                    {...inputHandlers}
                  />
                )}
          </>
        )}
      </div>
      {mirrorNotice !== null && (
        <div className={css.mirrorNotice} data-dsh-part={BROWSER_VIEW_PARTS.mirrorNotice} role="status">
          {t('panel.mirror.unavailable')}
          {mirrorNotice}
        </div>
      )}
      <footer className={css.trace} data-dsh-part={BROWSER_VIEW_PARTS.trace}>
        <div className={css.traceList}>
          {traces.length === 0
            ? <span className={css.traceIdle}>{t('panel.trace.idle')}</span>
            : traces.map((trace, index) => (
              <div key={`${trace.at}-${index}`} className={css.traceRow}>
                <span className={css.traceTool}>{trace.tool}</span>
                <span className={css.traceSummary}>{trace.summary}</span>
              </div>
            ))}
        </div>
      </footer>
    </div>
  )
}
