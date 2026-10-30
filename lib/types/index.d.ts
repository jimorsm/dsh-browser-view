/**
 * Host loader entry for the browser-view plugin — runs in the DSH host process.
 *
 * Mounts three surfaces and nothing else:
 *
 * - the status route and the panel WebSocket under /api/dsh-browser-view,
 * - the ten `browser_*` agent tools,
 * - one lazily started Chromium that both share (src/host/service.ts).
 *
 * No system-prompt announcement: the repository requires an `announceToAgent`
 * switch (default off) before a plugin injects anything into every agent's
 * prompt, and this version ships no announcement at all, so there is no switch
 * to add yet. The tools describe themselves.
 *
 * Shutdown order matters: the service stops broadcasting and closes the panel
 * sockets first, then stops the screencast, then kills Chrome. A panel that
 * received a frame from an already-dying browser would show a frozen image and
 * no reason for it.
 *
 * @module @jimorsm/dsh-client-ui-browser-view
 */
import type { Context } from '@deepseek-ai/cordis';
/** Stable cordis plugin name. */
export declare const name = "browser-view";
/** Services required before the routes and the tools can mount. */
export declare const inject: string[];
/**
 * Mount the routes, the tools, and the browser lifetime.
 * @param ctx - host plugin context carrying webServer and tools.
 */
export declare function apply(ctx: Context): void;
