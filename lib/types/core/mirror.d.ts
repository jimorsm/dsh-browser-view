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
import type { CdpTransport } from './cdp.ts';
/**
 * Global the binding is installed as, and the name `Runtime.bindingCalled`
 * reports. Named after the plugin rather than something short: it lands on the
 * watched page's `window`, which may be a page the agent does not own.
 */
export declare const MIRROR_BINDING_NAME = "dshBrowserViewDomMirror";
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
export declare const MIRROR_BUFFER_EVENT_LIMIT = 4000;
/** Byte ceiling for one tab's retained recording history. */
export declare const MIRROR_BUFFER_BYTE_LIMIT: number;
/** One tab's recording as the panel needs it. */
export interface MirrorRecording {
    /**
     * Events from the last full snapshot (and the Meta event before it) onward,
     * in recording order.
     */
    events: unknown[];
    /**
     * Bumped whenever `events` stops being a continuation of what it was — a
     * checkpoint that dropped the history, or the byte ceiling doing the same.
     * A sink whose cursor carries another generation is sent the whole array.
     */
    generation: number;
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
export declare const MIRROR_ERROR_FIELD = "__dshMirrorError";
/**
 * The error a payload reports, or undefined when the payload is a recording
 * event.
 * @param payload - one decoded binding payload.
 * @returns the error text when the script reported one.
 */
export declare function mirrorErrorMessage(payload: unknown): string | undefined;
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
export declare function buildMirrorInjection(umdSource: string, bindingName?: string): string;
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
export declare function buildMirrorStop(bindingName?: string): string;
/** Why a mirror never started, as the panel is told. */
export type MirrorFailureReporter = (tabId: string, reason: string) => void;
/** Construction options. */
export interface DomMirrorOptions {
    /** The protocol transport the tabs share. */
    transport: CdpTransport;
    /**
     * Reads the bundled recorder. Called once per recording, never at
     * construction, so a host that never mirrors never touches the file and a
     * missing artifact fails exactly the call that needed it.
     */
    source: () => string;
    /** Binding the recorder emits into. @default MIRROR_BINDING_NAME */
    bindingName?: string;
    /** Receives one tab id whenever that tab's recording changed. */
    onEvent?: (tabId: string) => void;
    /** Receives a mirror that could not start, or died, with the reason. */
    onFailure?: MirrorFailureReporter;
}
/**
 * One browser's DOM mirror.
 */
export declare class DomMirror {
    private readonly transport;
    private readonly source;
    private readonly bindingName;
    private onEvent;
    private onFailure;
    private readonly sessions;
    /** Session whose binding payloads currently belong to which tab. */
    private readonly tabBySession;
    /** In-flight starts, so two panels asking at once attach once. */
    private readonly starting;
    private readonly unsubscribers;
    private disposed;
    /**
     * @param options - transport, recorder source, and the two sinks.
     */
    constructor(options: DomMirrorOptions);
    /** Replace the event sink. */
    setEventSink(sink: ((tabId: string) => void) | undefined): void;
    /** Replace the failure sink. */
    setFailureSink(sink: MirrorFailureReporter | undefined): void;
    /** Whether a tab is currently recording. */
    isRecording(tabId: string): boolean;
    /** The tabs currently recording. */
    recordingTabs(): string[];
    /**
     * The retained recording of one tab, for a panel that needs it from the top.
     * @param tabId - target tab.
     * @returns the recording, or undefined when the tab is not mirrored.
     */
    recording(tabId: string): MirrorRecording | undefined;
    /**
     * Start mirroring one tab. Idempotent, and safe to call concurrently: two
     * panels asking at the same moment share one injection.
     * @param tabId - target tab.
     * @param sessionId - the tab's flat CDP session.
     * @throws Error when the recorder could not be armed, with the reason to show.
     */
    start(tabId: string, sessionId: string): Promise<void>;
    /**
     * Stop mirroring one tab and forget its recording.
     * @param tabId - target tab.
     */
    stop(tabId: string): Promise<void>;
    /** Stop every recording and detach the protocol listener. */
    dispose(): Promise<void>;
    /** Inject the recorder and start it in the document that is loaded. */
    private arm;
    /** Route one binding payload into the tab that owns its session. */
    private ingest;
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
    private append;
    /** Register the binding listener. */
    private subscribe;
}
