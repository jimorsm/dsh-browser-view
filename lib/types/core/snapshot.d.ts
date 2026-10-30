/**
 * DOM snapshot for the agent: one depth-first walk of the document, rendered as
 * a flat node list whose array index IS the node's `ref`.
 *
 * Why a flat list with an ordinal ref: the model cannot hold a live node
 * handle, so the only thing that survives a round trip is a number. Depth-first
 * order makes the list readable as an outline (indentation is `depth`), and it
 * is reproducible for the same document, so the same page yields the same refs.
 *
 * Reuse: the walk also returns the CSS selector it computed for every node, and
 * {@link TabManager} keeps that map alongside the last snapshot. `browser_click`
 * resolves a ref through that map, which is why a ref is only valid against the
 * observation it came from — after a re-render the selector may match nothing or
 * a different node, and the tool says so instead of clicking blindly.
 *
 * The walk runs inside the page (one `Runtime.evaluate`), not over the DOM
 * protocol: `DOM.getDocument` returns the whole tree in one message regardless
 * of the limit this module promises, and a 200k-node document would be shipped
 * across the socket before any host-side cap could apply.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/snapshot
 */
import type { CdpTransport } from './cdp.ts';
import { type BrowserSnapshot } from './protocol.ts';
/** One node as the in-page walk reports it, before the host assigns a ref. */
export interface RawSnapshotNode {
    /** Lowercase tag name. */
    tag: string;
    /** Element id, when set. */
    id?: string;
    /** Element class list, when non-empty. */
    classes?: string[];
    /** Explicit or implicit accessible role. */
    role?: string;
    /** Accessible name, when one could be derived. */
    name?: string;
    /** Visible text for leaf nodes, already truncated in the page. */
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
    /** CSS selector that resolves back to this element. */
    selector: string;
}
/** What the in-page walk returns. */
export interface RawSnapshotPayload {
    /** Document url at walk time. */
    url?: string;
    /** Document title at walk time. */
    title?: string;
    /** Depth-first nodes, already cut at the limit. */
    nodes?: RawSnapshotNode[];
    /** Whether the walk stopped at the limit. */
    truncated?: boolean;
}
/** One assembled snapshot plus the ref map the click tool reuses. */
export interface SnapshotResult {
    /** The value `browser_snapshot` returns. */
    snapshot: BrowserSnapshot;
    /** Depth-first ref to CSS selector, valid only for this observation. */
    refs: Map<number, string>;
}
/**
 * Build the `BrowserSnapshot` from raw page nodes.
 *
 * Refs are the array index, so the caller must pass nodes in depth-first order
 * (the walk guarantees it) and must not re-sort them.
 * @param input - tab identity, raw nodes, and the node limit.
 * @returns the snapshot plus its ref map.
 */
export declare function assembleSnapshot(input: {
    tabId: string;
    url: string;
    title: string;
    raw: readonly RawSnapshotNode[];
    limit?: number;
}): SnapshotResult;
/**
 * Build the in-page walk expression.
 *
 * The limit is baked in as a literal because `Runtime.evaluate` has no
 * argument channel for a non-expression value; it is a number this module
 * controls, never user input.
 * @param limit - maximum nodes the walk may report.
 * @returns a self-invoking expression returning {@link RawSnapshotPayload}.
 */
export declare function buildSnapshotExpression(limit?: number): string;
/**
 * Walk the tab's document and assemble the snapshot.
 * @param transport - the tab's protocol transport.
 * @param tabId - target tab id.
 * @param sessionId - flat session of the tab.
 * @param options - limit and a title/url fallback.
 * @returns the snapshot plus its ref map.
 */
export declare function buildSnapshot(transport: CdpTransport, tabId: string, sessionId: string, options?: {
    limit?: number;
    url?: string;
    title?: string;
}): Promise<SnapshotResult>;
