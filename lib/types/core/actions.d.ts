/**
 * The five things an agent does to a page: navigate, click, type, press a key,
 * and scroll.
 *
 * Two rules shape every action here.
 *
 * Coordinates, not synthetic events. `element.click()` from a script skips
 * focus, hover, and the trusted-event path, so a page that checks
 * `isTrusted` or listens on a parent behaves differently from a real click.
 * Every element-level action therefore resolves a box and dispatches real
 * input events at its centre.
 *
 * Every action refreshes the frame. The screencast only emits when the
 * compositor sees a change, so a scroll back to the same place, a click that
 * opens nothing, or a key that is swallowed would leave the panel showing the
 * pre-action state. Each action ends with an explicit capture, which is also
 * what makes "the panel shows what just happened" true for every action
 * instead of only the visual ones.
 *
 * Each action also returns one readable trace line: it is the only thing the
 * panel puts in front of the user, and the model gets it back as the action's
 * own summary.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/actions
 */
import type { CdpTransport } from './cdp.ts';
import type { TabManager } from './tabs.ts';
/** The collaborators one action needs. */
export interface ActionScope {
    /** Protocol transport shared with the tab manager. */
    transport: CdpTransport;
    /** Tab bookkeeping, ref resolution, and frame refresh. */
    tabs: TabManager;
}
/** What one action reports back. */
export interface ActionOutcome {
    /** Tab that changed. */
    tabId: string;
    /** One-line human description, also used as the panel trace. */
    summary: string;
}
/** Which element a click or a type targets. Exactly one form is used. */
export interface ElementTarget {
    /** Depth-first ref from the last `browser_snapshot`. */
    ref?: number;
    /** CSS selector, for a caller that already knows the page. */
    selector?: string;
    /** Viewport x coordinate, when the caller measured the element itself. */
    x?: number;
    /** Viewport y coordinate. */
    y?: number;
}
/**
 * Navigate the tab and refresh the panel frame.
 * @param scope - transport and tab manager.
 * @param tabId - target tab.
 * @param url - absolute, `data:`, or `about:` url.
 * @returns the action outcome.
 */
export declare function navigateTo(scope: ActionScope, tabId: string, url: string): Promise<ActionOutcome>;
/**
 * Click an element or a coordinate.
 * @param scope - transport and tab manager.
 * @param tabId - target tab.
 * @param target - ref, selector, or coordinates.
 * @returns the action outcome.
 */
export declare function clickElement(scope: ActionScope, tabId: string, target: ElementTarget): Promise<ActionOutcome>;
/**
 * Type text into the focused element, or into one element first.
 * @param scope - transport and tab manager.
 * @param tabId - target tab.
 * @param text - text to insert.
 * @param target - optional element to focus before typing.
 * @returns the action outcome.
 */
export declare function typeText(scope: ActionScope, tabId: string, text: string, target?: ElementTarget): Promise<ActionOutcome>;
/** One key definition for `Input.dispatchKeyEvent`. */
interface KeyDefinition {
    key: string;
    code: string;
    windowsVirtualKeyCode: number;
    text?: string;
}
/**
 * Resolve a key name to its dispatch definition.
 * @param key - `Enter`, `Tab`, ... or a single character.
 * @returns the definition.
 */
export declare function keyDefinition(key: string): KeyDefinition;
/**
 * Press one key on whatever has focus.
 * @param scope - transport and tab manager.
 * @param tabId - target tab.
 * @param key - key name or single character.
 * @returns the action outcome.
 */
export declare function pressKey(scope: ActionScope, tabId: string, key: string): Promise<ActionOutcome>;
/**
 * Scroll the page with a synthetic wheel event at a viewport point.
 * @param scope - transport and tab manager.
 * @param tabId - target tab.
 * @param delta - horizontal and vertical scroll distance in CSS pixels.
 * @returns the action outcome.
 */
export declare function scrollBy(scope: ActionScope, tabId: string, delta: {
    deltaX?: number;
    deltaY?: number;
    x?: number;
    y?: number;
}): Promise<ActionOutcome>;
export {};
