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
import type { CdpTransport } from './cdp.ts';
/**
 * Title the watched tab is given while it is being captured.
 *
 * A fixed sentinel, not the page's own title: the launch switch names this
 * string, and the host sets the tab's title to it a moment before asking for the
 * stream. It is deliberately unlikely to collide with a real page title (the
 * runbook's spike used this exact string).
 */
export declare const TAB_CAPTURE_SENTINEL_TITLE = "BV-SENTINEL-7f3a";
/**
 * Global the binding is installed as. Named after the plugin rather than
 * something short: it lands on the watched page's `window`, which may be a page
 * the agent does not own.
 */
export declare const TAB_CAPTURE_BINDING_NAME = "dshBrowserViewTabCapture";
/** Recorder bitrate; the runbook's spike measured ~400-713 kbps of real output. */
export declare const CAPTURE_BITS_PER_SECOND = 1500000;
/** Chunk cadence: five chunks a second is smooth enough and small enough. */
export declare const CAPTURE_TIMESLICE_MS = 200;
/**
 * Blobs the page may have queued for conversion before it pauses the recorder.
 *
 * Small on purpose. Each blob is one 200 ms slice (tens of kilobytes), so this
 * bounds the page's own backlog to well under a megabyte; a host that has truly
 * stopped reading gets a paused recorder instead of a growing array.
 */
export declare const CAPTURE_PAGE_QUEUE_LIMIT = 8;
/** Payload field the page uses to report a failure of its own recorder. */
export declare const CAPTURE_ERROR_FIELD = "__dshCaptureError";
/** One chunk as it arrived from the page, before it is framed for the panel. */
export interface CaptureChunk {
    /** Base64 WebM bytes. */
    readonly data: string;
}
/** What one disposal of a capture actually achieved, for diagnostics and tests. */
export interface CaptureStopReport {
    /**
     * Whether a capture was running when stop was asked for. `false` means the
     * document was already gone (a navigation replaces the recorder with it).
     */
    readonly stopped: boolean;
    /** Tracks the stream held. */
    readonly tracks: number;
    /** Tracks whose `readyState` was `ended` right after the stop, so the
     *  display-capture indicator is gone rather than merely unfed. */
    readonly ended: number;
}
/**
 * The error a payload reports, or undefined when the payload carries a chunk.
 * @param payload - one decoded binding payload.
 * @returns the error text when the page reported one.
 */
export declare function captureErrorMessage(payload: unknown): string | undefined;
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
export declare function buildCaptureRename(sentinel?: string): string;
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
export declare function buildCaptureRestore(original: string, sentinel?: string): string;
/** Options for {@link buildCaptureStart}. */
export interface CaptureStartOptions {
    /** Binding the recorder pushes chunks into. @default TAB_CAPTURE_BINDING_NAME */
    bindingName?: string;
    /** Token stamped on every payload, so a replaced recording's chunks are dropped. */
    token: string;
    /** Container/codec to record. @default CAPTURE_MIME */
    mime?: string;
    /** Target bitrate. @default CAPTURE_BITS_PER_SECOND */
    bitsPerSecond?: number;
    /** Chunk cadence. @default CAPTURE_TIMESLICE_MS */
    timesliceMs?: number;
    /** Blobs allowed to queue before the recorder pauses. @default CAPTURE_PAGE_QUEUE_LIMIT */
    queueLimit?: number;
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
export declare function buildCaptureStart(options: CaptureStartOptions): string;
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
export declare function buildCaptureStop(): string;
/** Why a capture never started, as the panel is told. */
export type CaptureFailureReporter = (tabId: string, reason: string) => void;
/**
 * A capture whose document went away, as the host is told.
 *
 * Distinct from {@link CaptureFailureReporter} on purpose. A navigation is not
 * a failure of the lane: the recorder died with its document and nothing can be
 * stopped or restored (the new document never had the sentinel), so the honest
 * move is a fresh recording in the new document rather than the pixel-lane
 * fallback a real failure earns.
 */
export type CaptureLossReporter = (tabId: string, reason: string) => void;
/** Construction options. */
export interface TabCaptureOptions {
    /** The protocol transport the tabs share. */
    transport: CdpTransport;
    /** Binding the page pushes chunks into. @default TAB_CAPTURE_BINDING_NAME */
    bindingName?: string;
    /** Receives one base64 chunk whenever the page's recorder emits one. */
    onChunk?: (tabId: string, chunk: CaptureChunk) => void;
    /** Receives a capture that could not start, or died, with the reason to show. */
    onFailure?: CaptureFailureReporter;
    /** Receives a capture whose document was replaced by a navigation. */
    onLost?: CaptureLossReporter;
}
/**
 * One browser's tab capture.
 */
export declare class TabCapture {
    private readonly transport;
    private readonly bindingName;
    private onChunk;
    private onFailure;
    private onLost;
    private readonly sessions;
    /** Session whose binding payloads currently belong to which tab. */
    private readonly tabBySession;
    /** In-flight starts, so two callers asking at once start once. */
    private readonly starting;
    private readonly unsubscribers;
    /** Counter behind every recording's token. */
    private nextToken;
    private disposed;
    /**
     * @param options - transport, binding name and the two sinks.
     */
    constructor(options: TabCaptureOptions);
    /** Replace the chunk sink. */
    setChunkSink(sink: ((tabId: string, chunk: CaptureChunk) => void) | undefined): void;
    /** Replace the failure sink. */
    setFailureSink(sink: CaptureFailureReporter | undefined): void;
    /** Replace the navigation-loss sink. */
    setLossSink(sink: CaptureLossReporter | undefined): void;
    /** Whether a tab is currently recording. */
    isCapturing(tabId: string): boolean;
    /** The tabs currently recording. */
    capturingTabs(): string[];
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
    start(tabId: string, sessionId: string): Promise<void>;
    /**
     * Stop capturing one tab, release the capture and put the title back.
     *
     * Every step is best-effort by design: the document that was recording may
     * already be gone (a navigation replaces it and its recorder with it), and a
     * failed stop must not stop the host from forgetting the session.
     * @param tabId - target tab.
     * @returns what the stop achieved, for diagnostics and the real-browser check.
     */
    stop(tabId: string): Promise<CaptureStopReport>;
    /** Stop every recording and detach the protocol listener. */
    dispose(): Promise<void>;
    /** Rename, bind, and ask the page for the tab's surface. */
    private begin;
    /** Route one binding payload into the tab that owns its session. */
    private ingest;
    /** Register the binding and the navigation listeners. */
    private subscribe;
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
    private loseToNavigation;
}
