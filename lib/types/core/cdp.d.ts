/**
 * Minimal Chrome DevTools Protocol client — the only transport the host half
 * uses to reach the browser it launched.
 *
 * Deliberately small: one WebSocket, an auto-incrementing request id, a pending
 * map, and per-method event listeners. Everything above this file (tabs,
 * snapshot, actions) speaks CdpTransport, so tests drive those layers with a
 * fake transport and never start Chrome.
 *
 * Flat-mode sessions: with `Target.setDiscoverTargets` + `Target.attachToTarget
 * ({flatten: true})` every message for one tab carries its `sessionId`, so a
 * single socket multiplexes browser-level and page-level commands.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/cdp
 */
/** Protocol failure returned by the browser, or raised by this client. */
export declare class CdpError extends Error {
    /** CDP error code, or `-1` for client-side failures (timeout, closed socket). */
    readonly code: number;
    /** Method whose round-trip failed. */
    readonly method: string;
    /**
     * @param method - the protocol method that failed.
     * @param code - CDP error code, `-1` for client-side failures.
     * @param message - the browser's own message, kept verbatim for diagnosis.
     */
    constructor(method: string, code: number, message: string);
}
/** The subset of the client the upper layers depend on; tests supply a fake. */
export interface CdpTransport {
    /**
     * Send one protocol command and resolve with its result.
     * @param method - CDP method, for example `Page.navigate`.
     * @param params - command parameters.
     * @param sessionId - flat-mode session to address; omitted sends browser-level.
     * @returns the `result` object of the response.
     */
    send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
    /**
     * Subscribe to one protocol event.
     * @param method - event name, for example `Page.screencastFrame`.
     * @param handler - receives event params and the originating session, if any.
     * @returns the unsubscribe function.
     */
    on(method: string, handler: CdpEventListener): () => void;
    /** Drop the socket; every pending round-trip rejects. */
    close(): void;
}
/** One protocol event delivery. */
export type CdpEventListener = (params: Record<string, unknown>, sessionId: string | undefined) => void;
/** Default per-command deadline; long enough for a navigation, short enough to fail a wedged tab. */
export declare const CDP_COMMAND_TIMEOUT_MS = 30000;
/**
 * A single WebSocket carrying browser-level and flat-session protocol traffic.
 */
export declare class CdpClient implements CdpTransport {
    private readonly socket;
    private readonly timeoutMs;
    private readonly pending;
    private readonly listeners;
    private nextId;
    private closedReason;
    private constructor();
    /**
     * Open a client against an already-discovered DevTools endpoint.
     * @param url - `webSocketDebuggerUrl` from `/json/version`.
     * @param options - command deadline override.
     * @returns a connected client.
     * @throws CdpError when the socket cannot be established in time.
     */
    static connect(url: string, options?: {
        timeoutMs?: number;
    }): Promise<CdpClient>;
    /**
     * Address one protocol command.
     * @param method - CDP method.
     * @param params - command parameters.
     * @param sessionId - flat-mode session to address.
     * @returns the response `result`.
     */
    send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
    /**
     * Subscribe to one protocol event.
     * @param method - event name.
     * @param handler - event callback.
     * @returns the unsubscribe function.
     */
    on(method: string, handler: CdpEventListener): () => void;
    /** Drop the socket and reject every in-flight command. */
    close(): void;
    /** Route one decoded frame to the pending map or the event listeners. */
    private handleMessage;
    /** Reject every in-flight command with one reason. */
    private failAll;
}
