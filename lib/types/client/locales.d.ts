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
 *
 * The lane switch needs its own words rather than one label: the control has to
 * name what is on screen now ('panel.mode.auto' plus the three resolved
 * variants / 'panel.mode.dom' / 'panel.mode.pixels' / 'panel.mode.capture'),
 * say what pressing it does ('panel.mode.switch'), and account for a lane that
 * could not start ('panel.mirror.starting' / 'panel.capture.starting' and the
 * two '…unavailable' sentence prefixes, because the host's own reason is
 * appended to each). The auto variants exist because "auto" alone would hide
 * the one fact a viewer needs: which lane they are actually watching.
 */
/** Simplified Chinese dictionary (key-set source of truth). */
export declare const zh: {
    'tab.title': string;
    'guide.description': string;
    'panel.tab.untitled': string;
    'panel.url.empty': string;
    'panel.address.label': string;
    'panel.toolbar.refresh': string;
    'panel.mode.auto': string;
    'panel.mode.auto.mirror': string;
    'panel.mode.auto.capture': string;
    'panel.mode.auto.pixels': string;
    'panel.mode.dom': string;
    'panel.mode.pixels': string;
    'panel.mode.capture': string;
    'panel.mode.switch': string;
    'panel.frame.alt': string;
    'panel.empty.title': string;
    'panel.empty.hint': string;
    'panel.mirror.starting': string;
    'panel.mirror.unavailable': string;
    'panel.capture.starting': string;
    'panel.capture.unavailable': string;
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
