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
 *
 * Kept at 1 again when the DOM mirror added the `mode` command and the `dom`
 * and `mirror` events, for the same reason: a panel from before the mirror
 * never asks for it, a host from before the mirror answers the request with one
 * `invalid-command` error, and a panel that receives a kind it does not know
 * drops that message instead of throwing. An added event kind must therefore
 * never be one a panel has to understand to keep working.
 *
 * Kept at 1 once more for the `capture` lane, its `capture` status and its
 * `capture-chunk` payload, which obey exactly that rule: an older panel never
 * sends `mode: 'capture'`, an older host answers it with one `invalid-command`
 * error, and a payload kind this version does not know is dropped unread.
 */
export declare const BROWSER_VIEW_API_VERSION = 1;
/** Mount path of the panel socket, relative to the GUI origin. */
export declare const BROWSER_VIEW_SOCKET_PATH = "/api/dsh-browser-view/socket";
/** JPEG quality the host asks CDP for; the panel only displays frames. */
export declare const DEFAULT_JPEG_QUALITY = 50;
/** Viewport the host pins on every tab it creates, in CSS pixels. */
export declare const DEFAULT_VIEWPORT: {
    readonly width: 1280;
    readonly height: 800;
};
/**
 * Image format the host asks CDP for. WebP carries the same visual quality in
 * roughly a third fewer bytes than JPEG, which is the difference between a
 * heavy page costing 36 Mbps and costing under 10.
 */
export type FrameImageFormat = 'jpeg' | 'webp';
/** Format used when the caller does not pick one. */
export declare const DEFAULT_FRAME_FORMAT: FrameImageFormat;
/**
 * Box the captured frame is fitted into. The browser viewport stays at its own
 * size (the agent's snapshots and coordinates are viewport-relative); only the
 * picture travelling to the panel is scaled down, and input is scaled back up.
 */
export declare const DEFAULT_CAPTURE_MAX: {
    readonly width: 1024;
    readonly height: 640;
};
/** How long a tab may live without any session binding before it is reaped. */
export declare const IDLE_TAB_TTL_MS: number;
/** Deepest DOM snapshot walk the host will perform, in nodes. */
export declare const SNAPSHOT_NODE_LIMIT = 4000;
/** Ring size for captured console and network entries per tab. */
export declare const EVENT_RING_SIZE = 500;
/** One open tab as the panel and the tools see it. */
export interface BrowserTabView {
    /** Stable CDP target id, the handle tools accept. */
    id: string;
    /** Current top-level URL. */
    url: string;
    /** Current document title, empty when the page has none. */
    title: string;
    /** Whether the tab is loading right now. */
    loading: boolean;
    /** Session that last acted on the tab, when any. */
    sessionId?: string;
}
/** What the header of the panel shows. */
export interface BrowserPanelState {
    /** Tabs in creation order. */
    tabs: BrowserTabView[];
    /** Tab the panel is watching, null when none is open. */
    activeTabId: string | null;
    /** Whether the host half currently owns a live browser process. */
    running: boolean;
    /** Last error text the host wants the panel to show instead of a frame. */
    message?: string;
}
/**
 * Which lane a panel renders.
 *
 * `dom` is the DOM mirror: the page is serialized by the host and replayed as
 * live DOM, which keeps text crisp and costs event-sized traffic instead of
 * frame-sized. `pixels` is the original screencast, the fallback that draws
 * anything at all. `capture` is the tab capture: the host records the watched
 * tab's own compositor output with `getDisplayMedia` + `MediaRecorder` and the
 * panel plays the chunks with MSE.
 *
 * `capture` exists because the two other lanes each lose the same thing. A DOM
 * mirror has an element where a `<video>` is and no picture in it, and the
 * element-level `HTMLMediaElement.captureStream()` that would fix that is
 * blocked by the same-origin rule for exactly the case that matters - media on
 * a cross-origin CDN, which is where a page's media almost always is (measured:
 * `SecurityError` on a same-page cross-origin `file://` media element). Tab
 * capture goes through the browser's own capture surface instead of the
 * element, so it is origin-independent.
 */
export type BrowserViewLane = 'capture' | 'dom' | 'pixels';
/**
 * Container/codec the tab capture is recorded and replayed in.
 *
 * Part of the wire contract because both halves need the same string: the page
 * passes it to `MediaRecorder`, the panel passes it to `MediaSource`. No audio
 * codec appears in it, deliberately: this product has no audio path at all (the
 * browser is launched with `--mute-audio`, and capture is asked for video only).
 */
export declare const CAPTURE_MIME = "video/webm;codecs=vp8";
/**
 * Lane a panel renders before it has said anything.
 *
 * Deliberately the pixel lane on the host side: a panel built before this
 * feature existed never sends `mode`, and it must keep receiving exactly what
 * it received before - frames, no mirror traffic, no recorder running.
 */
export declare const DEFAULT_VIEW_LANE: BrowserViewLane;
/** One line of the panel's "what is the agent doing" trace. */
export interface BrowserActionTrace {
    /** Tool name that produced the change, without its `browser_` prefix. */
    tool: string;
    /** One-line human description, already localized by the host. */
    summary: string;
    /** Millisecond timestamp of the action. */
    at: number;
}
/** Host pushes one of these to every attached panel. */
export type BrowserViewEvent = {
    v: 1;
    kind: 'hello';
    state: BrowserPanelState;
} | {
    v: 1;
    kind: 'state';
    state: BrowserPanelState;
} | {
    v: 1;
    kind: 'frame';
    /** Tab the frame belongs to. */
    tabId: string;
    /** Monotonic frame counter, so a slow panel can drop intermediate frames. */
    seq: number;
    /**
     * Captured frame size in CSS pixels. Smaller than the viewport when the
     * capture box scales the picture down; the panel maps its pointer back
     * onto this box and the host scales up to viewport coordinates.
     */
    width: number;
    /** Captured frame size in CSS pixels. */
    height: number;
    /** Encoding of `data`, so the panel labels the data URL correctly. */
    format: FrameImageFormat;
    /** Base64 image bytes, no data: prefix. */
    data: string;
} | {
    v: 1;
    kind: 'action';
    trace: BrowserActionTrace;
} | {
    v: 1;
    kind: 'dom';
    /** Tab the mirrored events belong to. */
    tabId: string;
    /** Monotonic per-tab counter over mirror batches, so a slow panel drops stale ones. */
    seq: number;
    /**
     * True when `events` start a recording rather than continue one: the
     * panel drops its replayer and rebuilds it from this batch. The host sets
     * it for the first batch a panel ever receives, and again whenever the
     * recording's history was truncated (a navigation, an rrweb checkpoint).
     */
    reset?: boolean;
    /**
     * rrweb recording events in recording order, opaque to this contract: the
     * panel hands them to rrweb's replayer untouched. One batch carries one
     * event today, but the shape stays a list so a batching host needs no
     * contract change.
     */
    events: unknown[];
} | {
    v: 1;
    kind: 'mirror';
    /** Tab the mirror status belongs to. */
    tabId: string;
    /** Whether the DOM mirror is running for that tab. */
    available: boolean;
    /** Why the mirror could not start, shown to the person watching. */
    reason?: string;
} | {
    v: 1;
    kind: 'capture';
    /** Tab the capture status belongs to. */
    tabId: string;
    /** Whether the tab capture is running for that tab. */
    available: boolean;
    /** Why the capture could not start or stopped, shown to the person watching. */
    reason?: string;
} | {
    v: 1;
    kind: 'capture-chunk';
    /** Tab the recording belongs to. */
    tabId: string;
    /** Monotonic per-service counter over chunks, so a slow panel can drop stale ones. */
    seq: number;
    /**
     * True when this chunk starts a recording rather than continues one: the
     * panel discards its media source and rebuilds it from this chunk. Set
     * for the first chunk of every recording, which is the chunk carrying the
     * container header (`MediaRecorder.start(200)` emits it first) - a
     * `SourceBuffer` cannot be appended to from the middle of a stream.
     */
    reset?: boolean;
    /** Codec of this recording, so the panel builds its source buffer from it. */
    mime: string;
    /** Base64 WebM bytes of one recorder chunk, no data: prefix. */
    data: string;
} | {
    v: 1;
    kind: 'rtc-answer';
    sdp: string;
} | {
    v: 1;
    kind: 'error';
    code: string;
    message: string;
};
/** Panel sends one of these to the host. */
export type BrowserViewCommand = {
    v: 1;
    kind: 'attach';
    sessionId?: string;
} | {
    v: 1;
    kind: 'select-tab';
    tabId: string;
} | {
    v: 1;
    kind: 'request-frame';
} | {
    v: 1;
    kind: 'close-tab';
    tabId: string;
} | {
    v: 1;
    kind: 'input';
    input: BrowserInputEvent;
} | {
    v: 1;
    kind: 'mode';
    mode: BrowserViewLane;
} | {
    v: 1;
    kind: 'rtc-offer';
    sdp: string;
} | {
    v: 1;
    kind: 'stream';
    enabled: boolean;
};
/** One user input gesture the panel relays into the watched tab. */
export type BrowserInputEvent = {
    kind: 'mouse';
    action: 'move' | 'down' | 'up';
    /** Viewport CSS pixel, already scaled by the panel. */
    x: number;
    /** Viewport CSS pixel, already scaled by the panel. */
    y: number;
    button?: 'left' | 'middle' | 'right';
} | {
    kind: 'wheel';
    /** Viewport CSS pixel, already scaled by the panel. */
    x: number;
    /** Viewport CSS pixel, already scaled by the panel. */
    y: number;
    deltaX: number;
    deltaY: number;
} | {
    kind: 'key';
    action: 'down' | 'up';
    /** DOM `key` value, for example `a`, `Enter`, `Shift`. */
    key: string;
    /** DOM `code` value, for example `KeyA`, `Enter`. */
    code: string;
    /** Generated text for a printable key-down, when the panel produced one. */
    text?: string;
    /** Held modifiers among `alt`, `ctrl`, `meta`, `shift`. */
    modifiers?: string[];
};
/** Whether a decoded value is one relayable input gesture. */
export declare function isBrowserInputEvent(value: unknown): value is BrowserInputEvent;
/** A console entry the host rang in while the tab was open. */
export interface BrowserConsoleEntry {
    /** Console level: log, info, warn, error, debug. */
    level: string;
    /** Already-stringified arguments. */
    text: string;
    /** Millisecond timestamp. */
    at: number;
}
/** A network request the host observed, reduced to what verification needs. */
export interface BrowserNetworkEntry {
    /** Request URL. */
    url: string;
    /** HTTP method. */
    method: string;
    /** Response status, 0 while pending or on a transport failure. */
    status: number;
    /** Response mime type when known. */
    mimeType?: string;
    /** CDP failure text when the request failed. */
    failure?: string;
    /** Millisecond timestamp of the request. */
    at: number;
}
/** One node of the DOM snapshot the tools return. */
export interface BrowserSnapshotNode {
    /** Depth-first index, the handle `browser_click` accepts as `ref`. */
    ref: number;
    /** Lowercase tag name. */
    tag: string;
    /** Element id, when set. */
    id?: string;
    /** Element classes, when set. */
    classes?: string[];
    /** Accessible role when Chrome reports one. */
    role?: string;
    /** Accessible name when Chrome reports one. */
    name?: string;
    /** Visible text for leaf nodes, truncated by the host. */
    text?: string;
    /** Bounding box in CSS pixels, window-relative. */
    box?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Depth in the walked tree. */
    depth: number;
}
/** What `browser_snapshot` returns to the model. */
export interface BrowserSnapshot {
    /** Tab the snapshot came from. */
    tabId: string;
    /** Top-level URL at snapshot time. */
    url: string;
    /** Document title. */
    title: string;
    /** Walked nodes, bounded by SNAPSHOT_NODE_LIMIT. */
    nodes: BrowserSnapshotNode[];
    /** True when the walk hit the node limit. */
    truncated: boolean;
}
/** Whether a decoded JSON value is the WebRTC answer event travelling host -> panel. */
export declare function isRtcAnswerEvent(value: unknown): value is Extract<BrowserViewEvent, {
    kind: 'rtc-answer';
}>;
/** Whether a decoded JSON value is a command this version accepts. */
export declare function isBrowserViewCommand(value: unknown): value is BrowserViewCommand;
