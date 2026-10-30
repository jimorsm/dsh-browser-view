/**
 * Which browser the host half drives: one it spawned itself (default) or one
 * it attaches to over an already-open DevTools endpoint.
 *
 * Attach mode exists for operators who run the browser themselves: the plugin
 * never spawns Chromium, never creates a profile, and on dispose must not
 * kill anything it does not own. The resolution is a single seam
 * ({@link resolveBrowserHandle}) so the service stays ignorant of where the
 * `webSocketDebuggerUrl` came from — every caller after resolution speaks the
 * same CDP path either way.
 *
 * Failure messages carry the port and the last concrete reason (HTTP status
 * or transport error), because "attach failed" sends the operator reading
 * source code to learn the port was wrong.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/browser
 */
import { ChromeProcess, type ChromeDisposeResult } from './chrome.ts';
/** Environment variable that turns attach mode on. */
export declare const ATTACH_PORT_ENV = "DSH_BROWSER_VIEW_ATTACH_PORT";
/** Deadline for the DevTools endpoint query in attach mode. */
export declare const ATTACH_ENDPOINT_TIMEOUT_MS = 5000;
/** A browser the plugin launched and therefore owns end to end. */
export interface SpawnedBrowser {
    readonly mode: 'spawn';
    /** The running process; dispose kills it and removes the profile. */
    readonly chrome: ChromeProcess;
    /** Browser-level `webSocketDebuggerUrl`. */
    readonly webSocketDebuggerUrl: string;
    /** Kill the process and remove the throwaway profile. */
    dispose(): Promise<ChromeDisposeResult>;
}
/** A browser the operator runs; dispose never touches it. */
export interface AttachedBrowser {
    readonly mode: 'attach';
    /** Port the DevTools endpoint answers on. */
    readonly port: number;
    /** Browser-level `webSocketDebuggerUrl`. */
    readonly webSocketDebuggerUrl: string;
    /** A no-op: the operator's browser is not the plugin's to stop. */
    dispose(): Promise<ChromeDisposeResult>;
}
/** Either way the plugin can reach a browser. */
export type ResolvedBrowser = SpawnedBrowser | AttachedBrowser;
/** What a disposal did; an attached browser is never stopped and has no profile. */
export declare const ATTACHED_DISPOSE_RESULT: ChromeDisposeResult;
/** Injection seams so a test can exercise resolution without a browser. */
export interface ResolveBrowserOptions {
    /** Environment to read {@link ATTACH_PORT_ENV} from. @default process.env */
    env?: NodeJS.ProcessEnv;
    /** Window size used when a browser must be spawned. @default DEFAULT_VIEWPORT */
    viewport?: {
        width: number;
        height: number;
    };
    /**
     * The DevTools endpoint query; resolves the `webSocketDebuggerUrl`.
     * @default a bounded fetch of http://127.0.0.1:<port>/json/version
     */
    fetchEndpoint?: (port: number, timeoutMs: number) => Promise<string>;
    /** The spawn path, replaced by tests. @default ChromeProcess.launch */
    launchChrome?: (options: {
        viewport: {
            width: number;
            height: number;
        };
    }) => Promise<ChromeProcess>;
}
/**
 * Parse the attach port from one environment value.
 * @param raw - the env value.
 * @returns the port, or undefined when the value is unset or blank.
 * @throws Error when the value is set but not a usable port number.
 */
export declare function parseAttachPort(raw: string | undefined): number | undefined;
/**
 * Resolve the browser the plugin drives: an attached one when
 * {@link ATTACH_PORT_ENV} names a port, a freshly spawned one otherwise.
 * @param options - environment and seam overrides.
 * @returns the resolved browser.
 * @throws Error naming the port and the last concrete reason when attach fails.
 */
export declare function resolveBrowserHandle(options?: ResolveBrowserOptions): Promise<ResolvedBrowser>;
