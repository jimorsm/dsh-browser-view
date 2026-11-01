/**
 * Browser-half entry for the browser-view plugin - runs inside the dsh web GUI.
 *
 * The browser view is a tab in the official right sidebar, beside the
 * conversation, not a page that takes the whole window. It contributes exactly
 * the seats a tab type needs, and only those:
 * - `sidebarRightTabs.register` (stage one): the static tab type - its id, its
 *   kind ('browser-view'), the band it ranks in, the chip's initial text and the
 *   guide capsule that opens it from the column's own tab strip.
 * - 'sidebar.right.pane.tab' + 'sidebar.right.pane.tab.title' (stage two, one
 *   keyed registration each under the SAME id): the tab's body and its chip
 *   contents, which is exactly the shape the shipped terminal tab uses.
 *
 * The session-header shortcut is deliberately gone: the column's tab strip and
 * the guide capsule already open the tab, so a second entry in the conversation
 * header only crowded that row.
 *
 * `main` and 'sidebar.panellist' are deliberately NOT registered any more: the
 * first took the whole center column over, and the second put a row in the
 * shell's global panel list that addressed that column. A right-sidebar tab
 * needs neither.
 *
 * The two slot seats go through `ctx.slots.inject` so the contribution waits for
 * the owning plugin to declare the seat: load order between this plugin and the
 * sidebar plugin therefore does not matter, and a shell that cannot serve a seat
 * simply leaves the surface absent.
 *
 * Export discipline (packages/AGENTS.md): the /client surface carries only what
 * cordis loading needs plus types.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type BrowserViewKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Browser-view surface copy. */
        'browser-view': BrowserViewKey;
    }
}
/** Services required by this plugin. */
export declare const inject: string[];
/**
 * Register the browser-view tab type and its surfaces.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
export type { BrowserViewPanelFace, BrowserViewPanelProps, BrowserViewSocketFactory } from './panel.tsx';
export type { BrowserViewLiveTitleStore } from './live-title.ts';
export type { BrowserViewMirrorFactory, BrowserViewMirrorHandle } from './mirror.ts';
export type { BrowserViewTabParams } from './tab-type.ts';
export type { BrowserViewTabTitleFace, BrowserViewTabTitleProps } from './tab-title.tsx';
export type { BrowserViewDomBatch, BrowserViewFrame, BrowserViewMirrorStatus, BrowserViewSocketStatus, } from './socket.ts';
export type { BrowserViewKey } from './locales.ts';
