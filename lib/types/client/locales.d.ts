/**
 * Locale dictionaries for the browser-view plugin. `zh` is the key-set source
 * of truth; `en` keeps a full key-for-key mirror (packages/AGENTS.md bilingual
 * rules). Registered through ctx.locale.register(NS, { zh, en }); the components
 * read every string through the injected `t` seat, so no copy is hardcoded in
 * JSX.
 *
 * The page-title keys are gone with the page header: a right-sidebar tab is
 * named by the shell's chip, and the chip's text comes from the tab type and
 * the published page title instead ('panel.title' / 'panel.close' had no
 * reader left once the "back to the conversation" control was removed).
 *
 * 'panel.tabs.empty' went with the always-drawn tab strip: the controlled
 * browser's chips now appear only when it holds more than one page, so there is
 * no empty strip left to caption.
 */
/** Simplified Chinese dictionary (key-set source of truth). */
export declare const zh: {
    'tab.title': string;
    'guide.description': string;
    'panel.tab.untitled': string;
    'panel.url.empty': string;
    'panel.address.label': string;
    'panel.toolbar.refresh': string;
    'panel.frame.alt': string;
    'panel.empty.title': string;
    'panel.empty.hint': string;
    'panel.error.title': string;
    'panel.trace.idle': string;
    'panel.status.connecting': string;
    'panel.status.loading': string;
    'panel.status.live': string;
};
/** The browser-view namespace key union. */
export type BrowserViewKey = keyof typeof zh;
/** English dictionary, key-for-key complete against zh. */
export declare const en: Record<BrowserViewKey, string>;
