/**
 * Semantic attributes for the browser-view surface (semantic-attrs-v1).
 *
 * The plugin name lives on the root element of each surface so part values stay
 * bare words; a theme anchors on the pair, never on a part name that repeats
 * the plugin. The right-sidebar chip and the shell's tab strip around it are
 * not ours, so only this plugin's own elements are stamped.
 *
 * The body's part names follow the shipped browser tab's structure - a toolbar
 * with an address display, the frame, and the action trace - so a theme that
 * already anchors on that chrome reaches this tab the same way.
 */
/** Root plugin attribute value carried by every top-level browser-view element. */
export declare const BROWSER_VIEW_PLUGIN = "browser-view";
/** Part names this plugin emits, in surface order. */
export declare const BROWSER_VIEW_PARTS: {
    /** The tab body the sidebar mounts in its content area. */
    readonly panel: "panel";
    /** Top chrome row: address display, connection state, lane switch, refresh. */
    readonly toolbar: "toolbar";
    /** The read-only address display of the streamed page. */
    readonly address: "address";
    /** The lane switch: DOM mirror or pixel stream. */
    readonly mode: "mode";
    /** The controlled browser's tab chips; drawn only when it holds several. */
    readonly tabs: "tabs";
    /** The live frame image. */
    readonly frame: "frame";
    /** The replayed DOM mirror of the streamed page. */
    readonly mirror: "mirror";
    /** Why the mirror is not running and the pixel lane took over. */
    readonly mirrorNotice: "mirror-notice";
    /** Placeholder shown while the mirror is being armed. */
    readonly mirrorStarting: "mirror-starting";
    /** Bottom action trace. */
    readonly trace: "trace";
    /** Connection state marker in the toolbar. */
    readonly status: "status";
    /** No-frame placeholder. */
    readonly empty: "empty";
    /** Host-reported failure placeholder. */
    readonly error: "error";
    /** This plugin's share of the right-sidebar chip. */
    readonly tabTitle: "tab-title";
};
