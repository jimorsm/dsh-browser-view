import type { BrowserActionTrace, BrowserPanelState, BrowserViewCommand, BrowserViewEvent } from '../core/protocol.ts';
/** Connection phase the panel renders in its status line. */
export type BrowserViewSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
/** First reconnect delay, doubled per failed attempt. */
export declare const RECONNECT_BASE_MS = 500;
/** Reconnect ceiling; a host that stays down must not spin the tab. */
export declare const RECONNECT_MAX_MS = 15000;
/** One decoded frame, exactly as the panel needs it. */
export interface BrowserViewFrame {
    /** Tab the frame belongs to. */
    readonly tabId: string;
    /** Host-side monotonic counter for this tab. */
    readonly seq: number;
    /** Captured frame width in CSS pixels. */
    readonly width: number;
    /** Captured frame height in CSS pixels. */
    readonly height: number;
    /** Encoding of `data`; a host without the field always sent JPEG. */
    readonly format?: 'jpeg' | 'webp';
    /** Base64 image bytes, no data: prefix. */
    readonly data: string;
}
/** One decoded batch of mirror events, exactly as the panel needs it. */
export interface BrowserViewDomBatch {
    /** Tab the recording belongs to. */
    readonly tabId: string;
    /** Host-side monotonic counter over mirror batches. */
    readonly seq: number;
    /** Whether `events` start a recording rather than continue one. */
    readonly reset: boolean;
    /** rrweb recording events, in recording order. */
    readonly events: ReadonlyArray<unknown>;
}
/** Whether the host's DOM mirror is running for one tab. */
export interface BrowserViewMirrorStatus {
    /** Tab the status describes. */
    readonly tabId: string;
    /** Whether the mirror is running. */
    readonly available: boolean;
    /** Why it is not, when the host reported a failure. */
    readonly reason?: string;
}
/** Callbacks the panel installs on a connection. */
export interface BrowserViewSocketHandlers {
    /** Connection phase changed. */
    onStatus?(status: BrowserViewSocketStatus): void;
    /** Tabs, active tab and running flag were (re)published. */
    onState(state: BrowserPanelState): void;
    /** A fresh frame arrived, already filtered for staleness. */
    onFrame(frame: BrowserViewFrame): void;
    /** A batch of DOM mirror events arrived, already filtered for staleness. */
    onDom?(batch: BrowserViewDomBatch): void;
    /** The host reported whether the DOM mirror runs for a tab. */
    onMirror?(status: BrowserViewMirrorStatus): void;
    /** The agent performed one tool action. */
    onAction(trace: BrowserActionTrace): void;
    /** The host reported a failure the panel must show instead of a frame. */
    onError(code: string, message: string): void;
    /** The host answered our WebRTC offer; the SDP applies to that connection. */
    onRtcAnswer?(sdp: string): void;
}
/** The minimal socket face this client needs; the DOM WebSocket satisfies it. */
export interface BrowserViewWebSocketLike {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: {
        data: unknown;
    }) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
}
/** Constructor shape of the transport; injectable for tests. */
export type BrowserViewWebSocketCtor = new (url: string) => BrowserViewWebSocketLike;
/** Options for one connection. */
export interface BrowserViewSocketOptions {
    /** Transport constructor; defaults to the page's WebSocket. */
    readonly WebSocketImpl?: BrowserViewWebSocketCtor;
    /** Origin source for the URL; defaults to `globalThis.location`. */
    readonly location?: {
        readonly protocol: string;
        readonly host: string;
    };
    /** Session the panel attaches to, forwarded in the `attach` command. */
    readonly sessionId?: string;
    /** Timer seam so backoff can be advanced deterministically in tests. */
    readonly setTimer?: (handler: () => void, ms: number) => unknown;
    /** Timer cancellation seam paired with `setTimer`. */
    readonly clearTimer?: (handle: unknown) => void;
}
/** The handle a panel keeps for the lifetime of one mounted connection. */
export interface BrowserViewSocket {
    /** Send one command, buffered while the socket is not open. */
    send(command: BrowserViewCommand): void;
    /** Stop reconnecting and close the transport. */
    close(): void;
    /** Current connection phase. */
    status(): BrowserViewSocketStatus;
}
/**
 * Derive the socket URL from a web page or its application shell's Host.
 *
 * A web page keeps its own origin even when a transport hook is present. An
 * application-delivered page such as the desktop shell's dsh-app: cannot carry
 * a WebSocket upgrade on that scheme, so it uses the Host authority the shell
 * publishes instead. The shell rewrites that handshake; the Host fence is unchanged.
 * @param location - origin the panel is rendered on.
 * @param streamBaseUrl - official `__DSH_TRANSPORT__.streamBaseUrl`, when published.
 * @returns the absolute ws/wss URL, or null when no safe Host authority is known.
 */
export declare function browserViewSocketUrl(location: {
    readonly protocol: string;
    readonly host: string;
}, streamBaseUrl?: string): string | null;
/**
 * Backoff for one reconnect attempt.
 * @param attempt - zero-based attempt index.
 * @returns delay in milliseconds, capped at RECONNECT_MAX_MS.
 */
export declare function reconnectDelay(attempt: number): number;
/**
 * Narrow one decoded payload into a protocol event.
 *
 * The protocol is a discriminated union over `kind`, so an unknown kind or a
 * wrong field type is a shape this panel cannot render: it is dropped rather
 * than half-applied, which keeps one malformed push from corrupting the view.
 * @param value - parsed JSON value (or a raw frame string).
 * @returns the event, or null when the payload is not one this version reads.
 */
export declare function parseBrowserViewEvent(value: unknown): BrowserViewEvent | null;
/**
 * Open one connection to the host half and keep it alive.
 *
 * Sequencing: every successful open sends `attach` (the host answers with
 * `hello` plus frames), and the per-tab frame counter is cleared because the
 * host restarts its `seq` for a new connection — keeping the old high-water
 * mark would drop the whole fresh stream.
 * @param handlers - panel callbacks.
 * @param options - transport, origin, session and timer seams.
 * @returns the handle the panel closes on unmount.
 */
export declare function connectBrowserViewSocket(handlers: BrowserViewSocketHandlers, options?: BrowserViewSocketOptions): BrowserViewSocket;
