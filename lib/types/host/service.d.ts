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
import type { CdpTransport } from '../core/cdp.ts';
import { ChromeProcess } from '../core/chrome.ts';
import { TabManager, type ScreencastFrame } from '../core/tabs.ts';
import { type ActionOutcome, type ElementTarget } from '../core/actions.ts';
import { type FrameImageFormat, type BrowserConsoleEntry, type BrowserNetworkEntry, type BrowserPanelState, type BrowserSnapshot, type BrowserTabView, type BrowserViewCommand, type BrowserViewEvent } from '../core/protocol.ts';
/** One attached panel socket as the service sees it. */
export interface BrowserViewSink {
    /** Deliver one event; a throw means the sink is gone. */
    send(event: BrowserViewEvent): void;
    /** Close the underlying transport. */
    close(): void;
}
/** What the route layer needs from the service; tests stub this instead. */
export interface BrowserViewBackend {
    /** The state the status route reports; safe to call before a browser exists. */
    state(): BrowserPanelState;
    /**
     * Register one panel socket.
     * @param sink - the socket adapter.
     * @returns the detach function, called when the socket closes.
     */
    attach(sink: BrowserViewSink): () => void;
    /**
     * Run one validated panel command.
     * @param sink - the socket that sent it.
     * @param command - an already validated command.
     */
    handleCommand(sink: BrowserViewSink, command: BrowserViewCommand): Promise<void>;
}
/** One running browser plus the tab manager over it. */
export interface BrowserSession {
    /** Protocol transport the tabs and the actions share. */
    transport: CdpTransport;
    /** Tabs of this browser. */
    tabs: TabManager;
    /**
     * Whether the plugin spawned this browser (`spawn`, the default) or attached
     * to one the operator runs (`attach`). An omitted value means spawn: every
     * session this plugin opened before attach mode existed was spawned.
     */
    mode?: 'spawn' | 'attach';
    /** The Chrome process; absent when a test supplied its own session or the browser is attached. */
    chrome?: ChromeProcess;
    /** Stop everything this session owns. */
    dispose(): Promise<void>;
}
/** What the service needs from one sink's frame relay. */
export interface FrameRelay {
    /** Whether the channel is open and frames may travel over it. */
    readonly open: boolean;
    /**
     * Accept a panel's offer.
     * @param offerSdpJson - the panel's description as JSON.
     * @param onClosed - called when the connection dies.
     * @returns the answer description as JSON.
     */
    acceptOffer(offerSdpJson: string, onClosed: () => void): Promise<string>;
    /**
     * Hand one frame to the channel.
     * @returns whether the whole frame travelled.
     */
    sendFrame(seq: number, image: Buffer): boolean;
    /** Release the connection. */
    dispose(): void;
}
/** Construction options. */
export interface BrowserViewServiceOptions {
    /** JPEG quality for frames and screenshots. @default DEFAULT_JPEG_QUALITY */
    jpegQuality?: number;
    /** Viewport pinned on every tab. @default DEFAULT_VIEWPORT */
    viewport?: {
        width: number;
        height: number;
    };
    /** Frame encoding requested from CDP. @default DEFAULT_FRAME_FORMAT */
    frameFormat?: FrameImageFormat;
    /** Capture box the frame is fitted into. @default DEFAULT_CAPTURE_MAX */
    captureMax?: {
        width: number;
        height: number;
    };
    /**
     * Smallest gap between two frames pushed to a panel, in milliseconds, idle
     * and just after input. Injected because a test clock that never advances
     * would otherwise treat every frame after the first as too soon.
     * @default { idle: FRAME_MIN_INTERVAL_MS, interactive: INTERACTIVE_FRAME_INTERVAL_MS }
     */
    frameIntervalMs?: {
        idle?: number;
        interactive?: number;
    };
    /**
     * Builds one sink's frame relay. Replaced by tests, which cannot negotiate a
     * real peer connection; the production value is {@link RtcFrameRelay}.
     * @default () => new RtcFrameRelay()
     */
    createRelay?: () => FrameRelay;
    /** Clock for action traces. @default Date.now */
    now?: () => number;
    /**
     * Reads the bundled rrweb recorder the mirror injects. Injected by tests,
     * which have no built artifact; the production value reads the copy that
     * ships beside the host half ({@link readMirrorSource}).
     */
    mirrorSource?: () => string;
    /**
     * Mints the process launch-token URL for one clean URL, or returns
     * undefined when the host mounts no such seam. Resolved per navigation by
     * the loader from `ctx.get('connection')`; absent here means no auth top-up.
     */
    authenticatedUrl?: (url: string) => string | undefined;
    /** Browser factory, replaced by tests. */
    openSession?: (options: {
        jpegQuality: number;
        frameFormat: FrameImageFormat;
        captureMax: {
            width: number;
            height: number;
        };
        viewport: {
            width: number;
            height: number;
        };
        onFrame: (frame: ScreencastFrame) => void;
        onTabsChanged: () => void;
    }) => Promise<BrowserSession>;
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
export declare function closeSessionTargets(session: Pick<BrowserSession, 'transport' | 'tabs' | 'mode'>): Promise<void>;
/**
 * The plugin's single browser service.
 */
export declare class BrowserViewService implements BrowserViewBackend {
    private readonly jpegQuality;
    private readonly frameFormat;
    private readonly captureMax;
    private readonly viewport;
    private readonly idleFrameIntervalMs;
    private readonly interactiveFrameIntervalMs;
    private readonly now;
    private readonly openSession;
    private readonly createRelay;
    private readonly authenticatedUrl;
    private readonly mirrorSource;
    private readonly sinks;
    /** Per-sink WebRTC frame relay; a sink with an open relay receives frames there. */
    private readonly relays;
    /**
     * Panels that asked to stop the stream - their tab is not on screen (the
     * sidebar is collapsed or another chip is showing). Nothing is captured,
     * encoded or sent for them while they are in here.
     */
    private readonly paused;
    /** Per-sink lane choice and mirror cursor. */
    private readonly lanes;
    /**
     * Tabs whose mirror failed most recently. A failed injection is remembered so
     * a panel that keeps its socket open does not make the host retry the same
     * doomed injection on every state change; asking for the lane again - the one
     * gesture that could plausibly have changed the page - clears it.
     */
    private readonly mirrorFailures;
    /** The tab the recorder is running for, if any; one mirror at a time. */
    private mirroredTabId;
    /** Batch counter for `dom` events; monotonic per service, not per tab. */
    private domSeq;
    /**
     * When the last frame reached any panel, for the frame-interval budget.
     * Starts at the beginning of time, not at zero: a clock whose origin is zero
     * (a test clock, or a monotonic counter) would otherwise have its very first
     * frame treated as too soon.
     */
    private lastFrameAt;
    /** Until when input keeps the interactive frame rate. */
    private interactiveUntil;
    private readonly bindings;
    /**
     * Tabs whose one auth top-up for the current navigation is already spent.
     * This is what stops a retry that did not clear the challenge from
     * navigating again; it is reset when the navigation ends.
     */
    private readonly authTopUpSpent;
    private session;
    /** The DOM mirror over the running session; absent until one starts. */
    private mirror;
    /**
     * The tab the attached panels watch. Kept beside the tab manager instead of
     * read from it because "the page the panel shows" and "the page most recently
     * created" are different facts: a panel that follows the agent must NOT move
     * to a tab an explicit selection pinned it to, while the tab manager still
     * has to know about every tab that exists.
     */
    private displayedTabId;
    /**
     * Whether a person chose the watched tab in the panel. Until that happens the
     * panels follow whatever the agent drives; afterwards they never steal it.
     */
    private selectionPinned;
    private opening;
    private openingTab;
    private lastError;
    private disposed;
    /**
     * @param options - quality, viewport, clock, and the browser factory seam.
     */
    constructor(options?: BrowserViewServiceOptions);
    /** Whether a browser is currently running. */
    get running(): boolean;
    /** The current panel-facing state; safe to call before anything started. */
    state(): BrowserPanelState;
    /**
     * Register one panel socket and start the stream it wants.
     * @param sink - socket adapter.
     * @returns the detach function.
     */
    attach(sink: BrowserViewSink): () => void;
    /**
     * Run one validated panel command.
     * @param sink - the sending socket.
     * @param command - validated command.
     */
    handleCommand(sink: BrowserViewSink, command: BrowserViewCommand): Promise<void>;
    /**
     * Close one tab, drop every binding that pointed at it, and let the panels
     * fall back when the tab they were watching is the one that went away.
     *
     * Bindings are forgotten before the target goes, so a later tool call cannot
     * resurrect a tab somebody deliberately closed.
     * @param tabId - tab to close.
     */
    closeTab(tabId: string): Promise<void>;
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
    closeOwnTabs(sessionId: string | undefined, tabId?: string): Promise<string[]>;
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
    tabFor(sessionId: string | undefined, tabId?: string): Promise<BrowserTabView>;
    /** Whether the running browser is one the operator owns (attach mode). */
    private isAttachMode;
    /**
     * Enforce the attach-mode target allowlist: a session may only operate a
     * tab it created via Target.createTarget, never a foreign one.
     * @param found - the tab the call named.
     * @param sessionId - the calling session.
     * @throws Error listing the tabs this session may use when the tab is foreign.
     */
    private requireOwnedTab;
    /**
     * Whether a tab is bound to some other session.
     * @param tabId - the tab being considered.
     * @param sessionId - the asking session, which does not count as other.
     * @returns true when another session already drives this tab.
     */
    private ownedByOtherSession;
    /**
     * Get (or lazily create) the tab bound to one session.
     * @param sessionId - calling agent session.
     * @returns the tab view.
     */
    ensureTab(sessionId?: string): Promise<BrowserTabView>;
    /** Create a tab, bind it, and make it the one the panel watches. */
    private createBoundTab;
    /**
     * Open one additional tab for a session, deliberately without the
     * first-use deduplication {@link ensureTab} applies: asking for a new tab is
     * what the caller wants, so two calls must produce two tabs.
     * @param sessionId - calling agent session.
     * @returns the new tab view, now the session's bound tab and the panel's active one.
     */
    private openTab;
    /**
     * Navigate a tab and trace the action.
     * @param sessionId - calling agent session.
     * @param url - destination.
     * @param tabId - explicit tab, when the caller named one.
     * @param options - `newTab` opens an additional tab instead of reusing one.
     * @returns the action outcome plus the resulting tab view.
     */
    navigate(sessionId: string | undefined, url: string, tabId?: string, options?: {
        newTab?: boolean;
    }): Promise<{
        outcome: ActionOutcome;
        tab: BrowserTabView;
    }>;
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
    private topUpAuthTicket;
    /**
     * The ticketed URL for this navigation, or undefined when no retry applies.
     * @param tabId - tab the navigation ran in.
     * @param url - the URL the caller asked for.
     * @returns the URL to retry with, or undefined.
     */
    private authTicketUrl;
    /**
     * Whether the tab's current document is DSH's authentication page. Reading
     * the document is best-effort: a tab that refuses the script, or reports
     * something other than text, simply does not match.
     * @param tabId - tab to read.
     * @returns true when the page body is the challenge.
     */
    private documentShowsAuthChallenge;
    /**
     * Click in a tab and trace the action.
     * @param sessionId - calling agent session.
     * @param target - ref, selector, or coordinates.
     * @param tabId - explicit tab.
     * @returns the recorded outcome.
     */
    click(sessionId: string | undefined, target: ElementTarget, tabId?: string): Promise<ActionOutcome>;
    /**
     * Type into a tab and trace the action.
     * @param sessionId - calling agent session.
     * @param text - text to insert.
     * @param target - optional element to focus first.
     * @param tabId - explicit tab.
     * @returns the recorded outcome.
     */
    type(sessionId: string | undefined, text: string, target?: ElementTarget, tabId?: string): Promise<ActionOutcome>;
    /**
     * Press one key and trace the action.
     * @param sessionId - calling agent session.
     * @param key - key name or single character.
     * @param tabId - explicit tab.
     * @returns the recorded outcome.
     */
    press(sessionId: string | undefined, key: string, tabId?: string): Promise<ActionOutcome>;
    /**
     * Scroll a tab and trace the action.
     * @param sessionId - calling agent session.
     * @param delta - scroll distance.
     * @param tabId - explicit tab.
     * @returns the recorded outcome.
     */
    scroll(sessionId: string | undefined, delta: {
        deltaX?: number;
        deltaY?: number;
        x?: number;
        y?: number;
    }, tabId?: string): Promise<ActionOutcome>;
    /**
     * Walk the tab's DOM and remember the ref map for later clicks.
     * @param sessionId - calling agent session.
     * @param tabId - explicit tab.
     * @returns the snapshot the model sees.
     */
    snapshot(sessionId: string | undefined, tabId?: string): Promise<BrowserSnapshot>;
    /**
     * Capture one JPEG of the tab.
     * @param sessionId - calling agent session.
     * @param tabId - explicit tab.
     * @returns the tab and the base64 JPEG.
     */
    screenshot(sessionId: string | undefined, tabId?: string): Promise<{
        tabId: string;
        url: string;
        title: string;
        data: string;
    }>;
    /**
     * Console entries of one tab, newest last.
     * @param sessionId - calling agent session.
     * @param limit - maximum trailing entries to return.
     * @param tabId - explicit tab.
     * @returns the entries.
     */
    console(sessionId: string | undefined, limit?: number, tabId?: string): Promise<{
        tabId: string;
        entries: BrowserConsoleEntry[];
    }>;
    /**
     * Network entries of one tab, newest last.
     * @param sessionId - calling agent session.
     * @param limit - maximum trailing entries to return.
     * @param tabId - explicit tab.
     * @returns the entries.
     */
    network(sessionId: string | undefined, limit?: number, tabId?: string): Promise<{
        tabId: string;
        entries: BrowserNetworkEntry[];
    }>;
    /** Open tabs, for `browser_tabs`. */
    listTabs(): Promise<{
        tabs: BrowserTabView[];
        activeTabId: string | null;
    }>;
    /** Push one event to every attached panel, dropping sockets that fail. */
    broadcast(event: BrowserViewEvent): void;
    /**
     * Whether one panel still needs the pixel lane: it asked for pixels, or it
     * asked for the mirror and has no recording to draw yet. The second half is
     * what keeps the switch from showing a blank stage while the recorder arms.
     * @param sink - the panel.
     * @returns true when frames must keep flowing to it.
     */
    private needsPixels;
    /** One panel's lane record, created on first use. */
    private laneOf;
    /**
     * Bring both lanes in line with what the visible panels asked for.
     *
     * One place, called after every event that can change the answer - a panel
     * attaching, hiding, showing or switching, the watched tab moving, a tab
     * closing - so "the recorder runs only while somebody watches" stays a
     * property of the service instead of a rule each call site remembers.
     */
    private syncLanes;
    /**
     * Start or stop the recorder to match the visible panels' lanes. The mirror
     * follows the watched tab, exactly like the screencast: a background page
     * nobody renders must not keep a recorder running.
     */
    private syncMirror;
    /**
     * Arm the recorder in one tab.
     *
     * Every failure ends in {@link failMirror} rather than in a rejected command:
     * the panel did not ask a question, it asked for a lane, and the honest
     * answer is the other lane plus the reason. A tab whose injection is known to
     * fail is not retried until somebody asks for the lane again.
     * @param tabId - the tab to mirror.
     */
    private startMirror;
    /**
     * Stop the recorder in one tab; a tab that never recorded is fine.
     *
     * Every cursor pointing at that tab is dropped with it: the recording those
     * cursors describe no longer exists, and a panel left holding a generation
     * would never be told to rebuild when the recorder arms again.
     */
    private stopMirror;
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
    private failMirror;
    /** Start or stop the screencast to match what the visible panels need. */
    private syncStreaming;
    /** Deliver one event to one sink, dropping it if the socket is gone. */
    private sendTo;
    /**
     * Hand the tabs a mirror event changed, filtered and cut for each panel.
     *
     * The cut is per sink because a recording is a stream, not a value: a panel
     * whose cursor is behind gets the events it missed, and a panel whose
     * generation is stale gets the whole recording with `reset` set, which is
     * what its replayer needs to rebuild from a checkpoint.
     * @param tabId - the tab whose recording changed.
     */
    private broadcastDom;
    /**
     * Send one panel the part of a recording it does not have yet.
     * @returns whether this delivery is the panel's first drawable recording.
     */
    private deliver;
    /**
     * Re-send a panel the recording from its checkpoint, for a panel that was
     * hidden while the page moved on.
     * @param sink - the panel to catch up.
     * @param tabId - the tab whose recording it should draw.
     */
    private deliverRecording;
    /**
     * Whether the frame-interval budget admits another frame right now: about
     * 15 fps normally, about 30 fps for a moment after input.
     * @returns true when a frame may go out.
     */
    private withinFrameBudget;
    /**
     * Tear everything down: stop pushing, stop streaming, close the socket, kill
     * the browser.
     * @returns once every owned resource is released.
     */
    dispose(): Promise<void>;
    /** The action helpers' collaborator view: one transport, one tab manager. */
    private scope;
    /** The protocol transport of the running session. */
    private transport;
    /** Resolve the live session or start one. */
    private requireTabs;
    /**
     * Drop a session whose connection ended, so the next call starts a new browser.
     * The panels are told, because a viewer that keeps showing the last frame of a
     * dead browser is worse than one that says the connection dropped.
     * @param reason - what the panels are told happened.
     */
    private loseSession;
    /** Resolve the live session, starting the browser on first use. */
    private requireSession;
    /** Start the browser once, recording failures for the panel. */
    private startSession;
    /** Start the screencast for the tab the panel watches. */
    private activeSinks;
    private startStreaming;
    /** Stop streaming when nobody is watching. */
    private stopStreaming;
    /**
     * The tab the panels currently watch: an explicit choice while that tab
     * still exists, otherwise the newest tab, so a panel is never left pointing
     * at a tab that no longer exists.
     * @returns the watched tab id, or null when nothing is open.
     */
    private displayedOrDefault;
    /**
     * Show one tab to the panels and move the screencast with it.
     * @param tabId - the tab to watch, or null when the last one closed.
     */
    private showTab;
    /**
     * Let the panels follow an agent action unless a person pinned a tab.
     * @param tabId - the tab the agent just used.
     */
    private focusFollowed;
    /**
     * Show the tab a panel's own session already owns, if it has one.
     *
     * Deliberately creates and binds nothing: an attaching panel observes. A
     * session without a tab keeps following the page the agent is driving.
     * @param sessionId - the session the panel belongs to.
     */
    private followPanelSession;
    /** Broadcast one readable action trace and return it as the tool outcome. */
    private trace;
    /** Re-read one tab after a navigation changed its url. */
    private refreshTab;
    /** Report a failure to the panels without throwing at the caller. */
    private fail;
}
