/**
 * The browser-view wire contract, shared by both halves.
 *
 * One source of truth for the host <-> browser messages and for the shapes the
 * agent tools return. Both halves compile this file (src/core is compiled into
 * the host program and the browser bundle), so a change here is a change to
 * both sides at once and needs no second definition.
 *
 * Transport: one WebSocket per mounted panel, created by the host half through
 * `ctx.webServer.registerUpgrade`. The host pushes events; the panel sends
 * commands. The browser itself is driven over CDP by the host half, so the
 * panel never speaks the devtools protocol.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/protocol
 */

/**
 * Version of the wire contract; a mismatch rejects the socket instead of guessing.
 *
 * Kept at 1 when the `input` command was added: the two halves ship in one
 * bundle so they always agree, and the asymmetries are benign — an older panel
 * never sends `input`, and a newer panel against an older host only earns a
 * per-frame `invalid-command` error, not a closed socket.
 */
export const BROWSER_VIEW_API_VERSION = 1

/** Mount path of the panel socket, relative to the GUI origin. */
export const BROWSER_VIEW_SOCKET_PATH = '/api/dsh-browser-view/socket'

/** JPEG quality the host asks CDP for; the panel only displays frames. */
export const DEFAULT_JPEG_QUALITY = 50

/** Viewport the host pins on every tab it creates, in CSS pixels. */
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const

/**
 * Image format the host asks CDP for. WebP carries the same visual quality in
 * roughly a third fewer bytes than JPEG, which is the difference between a
 * heavy page costing 36 Mbps and costing under 10.
 */
export type FrameImageFormat = 'jpeg' | 'webp'

/** Format used when the caller does not pick one. */
export const DEFAULT_FRAME_FORMAT: FrameImageFormat = 'webp'

/**
 * Box the captured frame is fitted into. The browser viewport stays at its own
 * size (the agent's snapshots and coordinates are viewport-relative); only the
 * picture travelling to the panel is scaled down, and input is scaled back up.
 */
export const DEFAULT_CAPTURE_MAX = { width: 1024, height: 640 } as const

/** How long a tab may live without any session binding before it is reaped. */
export const IDLE_TAB_TTL_MS = 10 * 60_000

/** Deepest DOM snapshot walk the host will perform, in nodes. */
export const SNAPSHOT_NODE_LIMIT = 4000

/** Ring size for captured console and network entries per tab. */
export const EVENT_RING_SIZE = 500

/** One open tab as the panel and the tools see it. */
export interface BrowserTabView {
  /** Stable CDP target id, the handle tools accept. */
  id: string
  /** Current top-level URL. */
  url: string
  /** Current document title, empty when the page has none. */
  title: string
  /** Whether the tab is loading right now. */
  loading: boolean
  /** Session that last acted on the tab, when any. */
  sessionId?: string
}

/** What the header of the panel shows. */
export interface BrowserPanelState {
  /** Tabs in creation order. */
  tabs: BrowserTabView[]
  /** Tab the panel is watching, null when none is open. */
  activeTabId: string | null
  /** Whether the host half currently owns a live browser process. */
  running: boolean
  /** Last error text the host wants the panel to show instead of a frame. */
  message?: string
}

/** One line of the panel's "what is the agent doing" trace. */
export interface BrowserActionTrace {
  /** Tool name that produced the change, without its `browser_` prefix. */
  tool: string
  /** One-line human description, already localized by the host. */
  summary: string
  /** Millisecond timestamp of the action. */
  at: number
}

/** Host pushes one of these to every attached panel. */
export type BrowserViewEvent =
  | { v: 1; kind: 'hello'; state: BrowserPanelState }
  | { v: 1; kind: 'state'; state: BrowserPanelState }
  | {
      v: 1
      kind: 'frame'
      /** Tab the frame belongs to. */
      tabId: string
      /** Monotonic frame counter, so a slow panel can drop intermediate frames. */
      seq: number
      /**
       * Captured frame size in CSS pixels. Smaller than the viewport when the
       * capture box scales the picture down; the panel maps its pointer back
       * onto this box and the host scales up to viewport coordinates.
       */
      width: number
      /** Captured frame size in CSS pixels. */
      height: number
      /** Encoding of `data`, so the panel labels the data URL correctly. */
      format: FrameImageFormat
      /** Base64 image bytes, no data: prefix. */
      data: string
    }
  | { v: 1; kind: 'action'; trace: BrowserActionTrace }
  | { v: 1; kind: 'rtc-answer'; sdp: string }
  | { v: 1; kind: 'error'; code: string; message: string }

/** Panel sends one of these to the host. */
export type BrowserViewCommand =
  | { v: 1; kind: 'attach'; sessionId?: string }
  | { v: 1; kind: 'select-tab'; tabId: string }
  | { v: 1; kind: 'request-frame' }
  | { v: 1; kind: 'close-tab'; tabId: string }
  | { v: 1; kind: 'input'; input: BrowserInputEvent }
  | { v: 1; kind: 'rtc-offer'; sdp: string }
  | { v: 1; kind: 'stream'; enabled: boolean }

/** One user input gesture the panel relays into the watched tab. */
export type BrowserInputEvent =
  | {
      kind: 'mouse'
      action: 'move' | 'down' | 'up'
      /** Viewport CSS pixel, already scaled by the panel. */
      x: number
      /** Viewport CSS pixel, already scaled by the panel. */
      y: number
      button?: 'left' | 'middle' | 'right'
    }
  | {
      kind: 'wheel'
      /** Viewport CSS pixel, already scaled by the panel. */
      x: number
      /** Viewport CSS pixel, already scaled by the panel. */
      y: number
      deltaX: number
      deltaY: number
    }
  | {
      kind: 'key'
      action: 'down' | 'up'
      /** DOM `key` value, for example `a`, `Enter`, `Shift`. */
      key: string
      /** DOM `code` value, for example `KeyA`, `Enter`. */
      code: string
      /** Generated text for a printable key-down, when the panel produced one. */
      text?: string
      /** Held modifiers among `alt`, `ctrl`, `meta`, `shift`. */
      modifiers?: string[]
    }

/** Whether a decoded value is one relayable input gesture. */
export function isBrowserInputEvent(value: unknown): value is BrowserInputEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
  const button = (v: unknown): boolean =>
    v === undefined || v === 'left' || v === 'middle' || v === 'right'
  const modifiers = (v: unknown): boolean =>
    v === undefined
    || (Array.isArray(v) && v.every(m => m === 'alt' || m === 'ctrl' || m === 'meta' || m === 'shift'))
  switch (candidate.kind) {
    case 'mouse':
      return (candidate.action === 'move' || candidate.action === 'down' || candidate.action === 'up')
        && finite(candidate.x) && finite(candidate.y) && button(candidate.button)
    case 'wheel':
      return finite(candidate.x) && finite(candidate.y)
        && finite(candidate.deltaX) && finite(candidate.deltaY)
    case 'key':
      return (candidate.action === 'down' || candidate.action === 'up')
        && typeof candidate.key === 'string' && typeof candidate.code === 'string'
        && (candidate.text === undefined || typeof candidate.text === 'string')
        && modifiers(candidate.modifiers)
    default:
      return false
  }
}

/** A console entry the host rang in while the tab was open. */
export interface BrowserConsoleEntry {
  /** Console level: log, info, warn, error, debug. */
  level: string
  /** Already-stringified arguments. */
  text: string
  /** Millisecond timestamp. */
  at: number
}

/** A network request the host observed, reduced to what verification needs. */
export interface BrowserNetworkEntry {
  /** Request URL. */
  url: string
  /** HTTP method. */
  method: string
  /** Response status, 0 while pending or on a transport failure. */
  status: number
  /** Response mime type when known. */
  mimeType?: string
  /** CDP failure text when the request failed. */
  failure?: string
  /** Millisecond timestamp of the request. */
  at: number
}

/** One node of the DOM snapshot the tools return. */
export interface BrowserSnapshotNode {
  /** Depth-first index, the handle `browser_click` accepts as `ref`. */
  ref: number
  /** Lowercase tag name. */
  tag: string
  /** Element id, when set. */
  id?: string
  /** Element classes, when set. */
  classes?: string[]
  /** Accessible role when Chrome reports one. */
  role?: string
  /** Accessible name when Chrome reports one. */
  name?: string
  /** Visible text for leaf nodes, truncated by the host. */
  text?: string
  /** Bounding box in CSS pixels, window-relative. */
  box?: { x: number; y: number; width: number; height: number }
  /** Depth in the walked tree. */
  depth: number
}

/** What `browser_snapshot` returns to the model. */
export interface BrowserSnapshot {
  /** Tab the snapshot came from. */
  tabId: string
  /** Top-level URL at snapshot time. */
  url: string
  /** Document title. */
  title: string
  /** Walked nodes, bounded by SNAPSHOT_NODE_LIMIT. */
  nodes: BrowserSnapshotNode[]
  /** True when the walk hit the node limit. */
  truncated: boolean
}

/** Whether a decoded JSON value is the WebRTC answer event travelling host -> panel. */
export function isRtcAnswerEvent(value: unknown): value is Extract<BrowserViewEvent, { kind: 'rtc-answer' }> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.v === BROWSER_VIEW_API_VERSION
    && candidate.kind === 'rtc-answer'
    && typeof candidate.sdp === 'string'
}

/** Whether a decoded JSON value is a command this version accepts. */
export function isBrowserViewCommand(value: unknown): value is BrowserViewCommand {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.v !== BROWSER_VIEW_API_VERSION) return false
  switch (candidate.kind) {
    case 'attach':
      return candidate.sessionId === undefined || typeof candidate.sessionId === 'string'
    case 'select-tab':
      return typeof candidate.tabId === 'string'
    case 'close-tab':
      return typeof candidate.tabId === 'string'
    case 'request-frame':
      return true
    case 'input':
      return isBrowserInputEvent(candidate.input)
    case 'rtc-offer':
      return typeof candidate.sdp === 'string' && candidate.sdp.length > 0
    case 'stream':
      return typeof candidate.enabled === 'boolean'
    default:
      return false
  }
}
