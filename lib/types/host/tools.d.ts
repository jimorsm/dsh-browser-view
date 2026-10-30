/**
 * The eleven agent tools over the browser service.
 *
 * Shape of a result. Every tool but `browser_screenshot` returns structured
 * JSON, rendered as one pretty-printed text block: the model reads fields, not
 * prose, and the GUI can present the same value later. `browser_screenshot`
 * returns a real image part — an `ImageBlock` carrying a durable attachment
 * reference — because a JPEG smuggled in as base64 text is not an image to any
 * model that can see one.
 *
 * The screenshot path therefore needs the host's attachment service: the bytes
 * are committed through it, and the block only carries the reference. The
 * dependency is injected ({@link BrowserToolDeps.saveImage}) rather than read
 * from the context here, so these tools stay testable without a host.
 *
 * Why the descriptions are long: a model that does not know a `ref` expires
 * with its observation will happily click a stale one and report success. The
 * snapshot-first rule is the single most important sentence in this file, so it
 * appears in both tools that depend on it.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/host/tools
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { BrowserViewService } from './service.ts';
/** A durable image reference as the attachment service returns it. */
export interface DurableImageRef {
    /** Attachment id, unique within the host's attachment store. */
    attachmentId: string;
    /** Media type of the stored image. */
    mediaType: string;
    /** Stored byte length. */
    bytes: number;
    /** Stored pixel width. */
    width: number;
    /** Stored pixel height. */
    height: number;
    /** Display name, when the store keeps one. */
    name?: string;
}
/** What the tools need from the host. */
export interface BrowserToolDeps {
    /** The browser service every tool drives. */
    service: BrowserViewService;
    /**
     * Commit one JPEG to the host's durable attachment store.
     *
     * Absent when the composing host mounts no attachment service; the screenshot
     * tool then refuses with an explanation instead of returning text pretending
     * to be an image.
     */
    saveImage?: (input: {
        data: Uint8Array;
        mediaType: 'image/jpeg';
        name?: string;
    }) => Promise<DurableImageRef>;
}
/**
 * Build every browser tool against one service.
 * @param deps - the service plus the optional attachment sink.
 * @returns the tool definitions, in registration order.
 */
export declare function createBrowserTools(deps: BrowserToolDeps): ToolDefinition[];
/** Names of every tool this plugin registers, in registration order. */
export declare const BROWSER_TOOL_NAMES: readonly ["browser_navigate", "browser_click", "browser_type", "browser_press", "browser_scroll", "browser_snapshot", "browser_screenshot", "browser_console", "browser_network", "browser_tabs", "browser_close"];
