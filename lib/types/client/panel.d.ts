import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { BrowserViewLiveTitleStore } from './live-title.ts';
import { type BrowserViewSocket, type BrowserViewSocketHandlers } from './socket.ts';
/** Page-side socket factory; tests inject a fake transport through it. */
export type BrowserViewSocketFactory = (handlers: BrowserViewSocketHandlers) => BrowserViewSocket;
/** Business face injected into the tab body. */
export interface BrowserViewPanelFace {
    /** Session whose screencast this body shows. */
    readonly sessionId?: string;
    /** Channel the chip reads this body's page title from. */
    readonly liveTitle?: BrowserViewLiveTitleStore;
}
/** Panel props: the locale seat, the injected face, and the seams a test may supply. */
export type BrowserViewPanelProps = PropsLocale<'browser-view'> & Partial<BrowserViewPanelFace> & {
    /** Socket factory override; defaults to the real same-origin connection. */
    readonly socketFactory?: BrowserViewSocketFactory;
    /** Origin override; defaults to the page's own location. */
    readonly location?: {
        readonly protocol: string;
        readonly host: string;
    };
};
/**
 * Render the browser view tab body.
 * @param props - composed slot props.
 * @returns the tab content.
 */
export declare function BrowserViewPanel({ t, sessionId, liveTitle, socketFactory, location }: BrowserViewPanelProps): import("react").JSX.Element;
