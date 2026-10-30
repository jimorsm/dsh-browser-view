import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { BrowserViewLiveTitleStore } from './live-title.ts';
/** Business face injected into the chip. */
export interface BrowserViewTabTitleFace {
    /** Session whose tab this chip names. */
    readonly sessionId?: string;
    /** Channel the body publishes the streamed page's title on. */
    readonly liveTitle?: BrowserViewLiveTitleStore;
}
/** Chip props: the locale seat plus the injected face. */
export type BrowserViewTabTitleProps = PropsLocale<'browser-view'> & Partial<BrowserViewTabTitleFace>;
/**
 * Render the chip contents.
 * @param props - composed slot props.
 * @returns the mark and the tab's name.
 */
export declare function BrowserViewTabTitle({ t, sessionId, liveTitle }: BrowserViewTabTitleProps): import("react").JSX.Element;
