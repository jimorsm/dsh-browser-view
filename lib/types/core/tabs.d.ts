/**
 * Tab lifecycle over one CDP connection: create, list, select, close, and the
 * per-tab instrumentation the panel and the tools read.
 *
 * Each tab is a flat-mode session. Three domain subscriptions make a tab
 * observable — `Runtime`/`Log` for the console ring, `Network` for the
 * request table, `Page` for navigation state and the screencast — and they are
 * enabled once, when the tab is attached, because a domain that is enabled late
 * silently misses everything that happened before it.
 *
 * Ring buffers are bounded by {@link EVENT_RING_SIZE}: an unbounded console
 * turns a chatty page into an unbounded memory leak in the host process, and
 * the ring's newest entries are the ones anyone reads.
 *
 * Screencast frames must be acknowledged one by one. Chrome stops sending after
 * an unacknowledged frame, so a dropped ack looks exactly like a frozen page.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/tabs
 */
import type { CdpTransport } from './cdp.ts';
import { type BrowserConsoleEntry, type BrowserInputEvent, type BrowserNetworkEntry, type BrowserTabView } from './protocol.ts';
/** One JPEG frame as the panel receives it. */
export interface ScreencastFrame {
    /** Tab the frame belongs to. */
    tabId: string;
    /** Monotonic per-tab frame counter. */
    seq: number;
    /** Frame width in CSS pixels. */
    width: number;
    /** Frame height in CSS pixels. */
    height: number;
    /** Base64 JPEG without the `data:` prefix. */
    data: string;
}
/** Construction options. */
export interface TabManagerOptions {
    /** The protocol transport every tab shares. */
    transport: CdpTransport;
    /** JPEG quality requested from CDP. @default DEFAULT_JPEG_QUALITY */
    jpegQuality?: number;
    /** Viewport pinned on every new tab. @default DEFAULT_VIEWPORT */
    viewport?: {
        width: number;
        height: number;
    };
    /** Console and network ring size. @default EVENT_RING_SIZE */
    ringSize?: number;
    /** Clock used for entry timestamps. @default Date.now */
    now?: () => number;
    /** Receives every screencast frame and every explicitly refreshed frame. */
    onFrame?: (frame: ScreencastFrame) => void;
    /** Notifies that a tab's url, title, loading state, or membership changed. */
    onTabsChanged?: () => void;
}
/** One tab's host-side record. */
interface TabRecord {
    id: string;
    sessionId: string;
    url: string;
    title: string;
    loading: boolean;
    /**
     * Loader id of the document the observation buffers describe. A new loader
     * id means a new document, which is what makes "the console only shows this
     * page" hold even when the address itself did not change (a reload).
     */
    loaderId: string | undefined;
    ownerSessionId: string | undefined;
    console: BrowserConsoleEntry[];
    network: BrowserNetworkEntry[];
    /** Pending requests keyed by network request id, so response frames update in place. */
    pendingRequests: Map<string, BrowserNetworkEntry>;
    screencastRunning: boolean;
    frameSeq: number;
    /** Depth-first ref to CSS selector map captured by the last snapshot. */
    refs: Map<number, string>;
}
/**
 * Append one entry to a bounded ring, dropping the oldest overflow.
 * @param ring - the ring, mutated in place.
 * @param entry - the new entry.
 * @param limit - maximum retained entries.
 */
export declare function pushBounded<T>(ring: T[], entry: T, limit: number): void;
/**
 * One browser's tabs.
 */
export declare class TabManager {
    private readonly transport;
    private readonly jpegQuality;
    private readonly viewport;
    private readonly ringSize;
    private readonly now;
    private onFrame;
    private onTabsChanged;
    private readonly tabs;
    private readonly bySession;
    private readonly unsubscribers;
    private active;
    private disposed;
    /**
     * @param options - transport, viewport, ring size, callbacks.
     */
    constructor(options: TabManagerOptions);
    /** Replace the frame sink (the service rewires it when a panel attaches). */
    setFrameSink(sink: ((frame: ScreencastFrame) => void) | undefined): void;
    /** Replace the tab-change sink. */
    setTabsChangedSink(sink: (() => void) | undefined): void;
    /** Tabs in creation order. */
    list(): BrowserTabView[];
    /** The tab the panel watches, if any. */
    get activeTabId(): string | null;
    /** Whether a tab id is still open. */
    has(tabId: string): boolean;
    /**
     * Resolve one tab or fail with a message the model can act on.
     * @param tabId - id from a previous tool call or panel event.
     * @returns the tab record.
     */
    tab(tabId: string): BrowserTabView;
    /** Internal record access for the layers that need the CDP session. */
    sessionOf(tabId: string): string;
    /**
     * Create one tab and instrument it.
     * @param options - url to open and the session that asked for it.
     * @returns the new tab as the panel sees it.
     */
    createTab(options?: {
        url?: string;
        sessionId?: string;
    }): Promise<BrowserTabView>;
    /**
     * Pin CSS-pixel viewport metrics so frames, boxes, and clicks share one
     * coordinate space regardless of the window the browser opened with.
     * @param record - the tab to pin.
     */
    pinViewport(record: TabRecord): Promise<void>;
    /**
     * Navigate one tab and wait for the load to settle.
     * @param tabId - target tab.
     * @param url - absolute or `data:` url.
     * @returns the tab after navigation settled.
     */
    navigate(tabId: string, url: string): Promise<BrowserTabView>;
    /**
     * Mark which dsh session owns a tab, so the panel can show it.
     * @param tabId - target tab.
     * @param sessionId - owning session, or undefined to clear.
     */
    bindSession(tabId: string, sessionId: string | undefined): void;
    /**
     * Select the tab the panel follows.
     * @param tabId - target tab.
     * @returns the selected tab.
     */
    selectTab(tabId: string): BrowserTabView;
    /**
     * Close one tab and forget its ring buffers.
     * @param tabId - target tab.
     */
    closeTab(tabId: string): Promise<void>;
    /**
     * Start the JPEG screencast for one tab.
     * @param tabId - target tab.
     */
    startScreencast(tabId: string): Promise<void>;
    /**
     * Stop the screencast for one tab; a tab that is already stopped is fine.
     * @param tabId - target tab.
     */
    stopScreencast(tabId: string): Promise<void>;
    /**
     * Capture one JPEG frame on demand.
     * @param tabId - target tab.
     * @returns base64 JPEG without the `data:` prefix.
     */
    captureScreenshot(tabId: string): Promise<string>;
    /**
     * Capture a frame and hand it to the panel. An action calls this because a
     * screencast only emits when the compositor sees a change: a click that
     * changes nothing visually would otherwise leave the panel showing the
     * pre-click state forever.
     * @param tabId - target tab.
     * @returns the emitted frame.
     */
    refreshFrame(tabId: string): Promise<ScreencastFrame>;
    /**
     * Relay one panel input gesture into the tab over CDP.
     *
     * The panel sends viewport CSS pixels it already scaled from its display
     * size, so the coordinates go through unchanged. Modifier and button names
     * map onto the CDP bit masks here, the contract stays human-readable.
     * @param tabId - target tab.
     * @param input - one validated gesture from the wire contract.
     */
    dispatchInput(tabId: string, input: BrowserInputEvent): Promise<void>;
    /**
     * Console entries captured so far, oldest first.
     * @param tabId - target tab.
     * @returns a copy; the ring keeps mutating.
     */
    consoleEntries(tabId: string): BrowserConsoleEntry[];
    /**
     * Network entries captured so far, in request order.
     * @param tabId - target tab.
     * @returns a copy; the table keeps mutating.
     */
    networkEntries(tabId: string): BrowserNetworkEntry[];
    /**
     * Record the ref-to-selector map produced by one snapshot, replacing the
     * previous one: a ref is only meaningful against the observation it came
     * from, and keeping two generations would let a click hit a stale node.
     * @param tabId - target tab.
     * @param refs - depth-first ref to CSS selector.
     */
    setSnapshotRefs(tabId: string, refs: Map<number, string>): void;
    /**
     * Resolve a snapshot ref to the selector captured with it.
     * @param tabId - target tab.
     * @param ref - depth-first index from the last snapshot.
     * @returns the CSS selector.
     */
    selectorForRef(tabId: string, ref: number): string;
    /** Stop every screencast and detach all protocol listeners. */
    dispose(): Promise<void>;
    /** One view for the panel and the tools. */
    private view;
    /** Look up a record or fail with an actionable message. */
    private requireRecord;
    /** Enable the domains every tab needs and attach nothing else. */
    private enableDomains;
    /** Drop every observation that belonged to the previous document. */
    private resetObservation;
    /** Read the current url and title into the record. */
    private refreshDocumentInfo;
    /** Register every protocol event the manager consumes. */
    private subscribe;
}
export {};
