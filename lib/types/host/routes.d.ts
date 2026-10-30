/**
 * The /api/dsh-browser-view route family: one status route and the panel
 * WebSocket.
 *
 * The socket is push-only once it is open — the host sends frames, state, and
 * action traces, and the panel sends four small commands — so the protocol is a
 * plain JSON text frame in both directions rather than a second sub-protocol.
 *
 * Two gates sit in front of every accepted command.
 *
 * Loopback. Both the route and the upgrade refuse a non-loopback request with
 * 403 and destroy the socket. This surface drives a browser on the host
 * machine, so an LAN-exposed GUI must not serve it.
 *
 * Version. The FIRST frame must declare {@link BROWSER_VIEW_API_VERSION}; a
 * mismatch closes the socket instead of accepting commands whose meaning we
 * cannot know. Later malformed frames only produce an error event, because by
 * then the panel is known-good and a close would cost it its stream.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/host/routes
 */
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver';
import { type Cidr4, type SocketFenceConfig } from './cidr.ts';
import type { BrowserViewBackend, BrowserViewSink } from './service.ts';
/** Status route of the family; the panel's fallback probe when the socket fails. */
export declare const BROWSER_VIEW_STATE_PATH = "/api/dsh-browser-view/state";
/** Close code used when the panel speaks a contract version we do not have. */
export declare const PROTOCOL_MISMATCH_CLOSE_CODE = 1002;
/**
 * Send one error event to a panel.
 * @param sink - the socket adapter.
 * @param code - stable machine code.
 * @param message - human text, never a stack trace.
 */
export declare function sendError(sink: BrowserViewSink, code: string, message: string): void;
/**
 * Decode one panel frame.
 * @param raw - the frame's text.
 * @returns the parsed value, or undefined when it is not JSON.
 */
export declare function decodeFrame(raw: string): unknown;
/**
 * Run one inbound panel frame through the version and shape gates.
 *
 * Exported so tests can exercise the gate without a socket: the socket path and
 * the gate must not drift apart.
 * @param backend - the service that executes accepted commands.
 * @param sink - the socket adapter the frame arrived on.
 * @param raw - the frame's text.
 * @param first - whether this is the socket's first frame.
 * @returns what the caller should do next: keep the socket, or close it.
 */
export declare function handleClientFrame(backend: BrowserViewBackend, sink: BrowserViewSink, raw: string, first: boolean): Promise<'accept' | 'close'>;
/**
 * Adapt one accepted WebSocket to the service's sink contract.
 * @param socket - the upgraded socket.
 * @returns the sink.
 */
export declare function socketSink(socket: WebSocket): BrowserViewSink;
/** Route family dependencies. */
export interface BrowserViewRoutesDeps {
    /** The browser service (tests pass a stub). */
    backend: BrowserViewBackend;
    /**
     * The parsed `DSH_BROWSER_VIEW_ALLOWED_CIDRS` list. Empty (the default)
     * keeps the fence loopback-only; a listed CIDR admits requests whose socket
     * address sits inside it, under the same request-level gates.
     */
    allowedCidrs?: readonly Cidr4[];
    /**
     * The parsed `DSH_BROWSER_VIEW_TRUSTED_PROXY_CIDRS` list: the socket ranges
     * a forwarding proxy may sit on. Empty (the default) keeps the outright
     * forwarded-request refusal; a listed range plus an allowed client address
     * and a matching `DSH_BROWSER_VIEW_PUBLIC_ORIGIN` admits the request.
     */
    trustedProxyCidrs?: readonly Cidr4[];
    /**
     * The parsed `DSH_BROWSER_VIEW_PUBLIC_ORIGIN` values: the public origins a
     * trusted-proxy request's Origin must be one of.
     */
    publicOrigins?: readonly string[];
}
/**
 * The request fence of this route family: loopback always, plus the opt-in
 * direct CIDR widening, plus the separately opt-in trusted-proxy path.
 * @param req - the incoming request.
 * @param config - the parsed fence configuration.
 * @returns true when the request may be served.
 */
export declare function isRequestFenced(req: IncomingMessage, config: SocketFenceConfig): boolean;
/**
 * Build the route family and its upgrade.
 * @param deps - the backend the socket commands reach.
 * @returns exact routes plus the socket upgrade.
 */
export declare function makeRoutes(deps: BrowserViewRoutesDeps): {
    routes: WebRoute[];
    upgrade: WebUpgradeRoute;
};
