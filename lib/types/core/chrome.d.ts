/**
 * Chrome process lifecycle: find the binary, start it headless on a private
 * temporary profile, and tear both the process and the profile down again.
 *
 * The host half owns exactly one browser at a time and never attaches to a
 * browser the user is running: an already-running Chrome ignores
 * `--remote-debugging-port` in practice, so a shared profile would be
 * unspeakable while looking connected. A throwaway `--user-data-dir` and an
 * OS-assigned port make every start independent and disposable.
 *
 * Failure messages are written for the person reading the panel, not for a
 * stack trace: "no Chrome installed", "the port never opened", and "the process
 * exited first" are the three things that actually happen.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/core/chrome
 */
/** Environment variable that overrides binary discovery. */
export declare const CHROME_PATH_ENV = "CHROME_PATH";
/** How long a fresh process gets to publish its DevTools endpoint. */
export declare const CHROME_STARTUP_TIMEOUT_MS = 20000;
/** How long `dispose` waits for a polite exit before it escalates. */
export declare const CHROME_EXIT_TIMEOUT_MS = 5000;
/**
 * Conventional Windows install locations, most specific first. Linux and macOS
 * paths are listed too so the same resolver works on a developer machine; a
 * missing candidate is skipped rather than reported.
 */
export declare const CHROME_INSTALL_CANDIDATES: readonly ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"];
/** Injection seams so a test can exercise discovery without touching the disk. */
export interface ChromeDiscovery {
    /** Environment to read `CHROME_PATH` from. @default process.env */
    env?: NodeJS.ProcessEnv;
    /** File probe. @default existsSync */
    isFile?: (path: string) => boolean;
}
/**
 * The candidate list for this platform, in probe order.
 * @param env - environment carrying `CHROME_PATH`.
 * @returns absolute candidate paths, the override first when it is set.
 */
export declare function chromePathCandidates(env?: NodeJS.ProcessEnv): string[];
/**
 * Resolve the browser binary to launch.
 * @param discovery - environment and file-probe overrides.
 * @returns the first existing candidate, or undefined when none is installed.
 */
export declare function resolveChromePath(discovery?: ChromeDiscovery): string | undefined;
/**
 * Ask the OS for a port that is free right now on the loopback interface.
 *
 * Binding port 0 and reading the assignment back is the only way to get a port
 * nothing else holds at this instant; the listener is closed before the caller
 * starts Chrome, so there is a small window in which another process could take
 * it. Chrome's own bind failure is detected by {@link ChromeProcess.launch}
 * (the DevTools endpoint never appears), which is why that path must report a
 * readable error rather than hanging.
 * @returns the assigned port.
 */
export declare function pickFreePort(): Promise<number>;
/** Launch options; every field has a working default. */
export interface LaunchChromeOptions {
    /** Explicit binary path; resolution happens when omitted. */
    chromePath?: string;
    /** Run without a visible window. @default true */
    headless?: boolean;
    /** Window and viewport size. @default DEFAULT_VIEWPORT */
    viewport?: {
        width: number;
        height: number;
    };
    /** Deadline for the DevTools endpoint to appear. @default CHROME_STARTUP_TIMEOUT_MS */
    startupTimeoutMs?: number;
    /** Extra command-line switches appended last. */
    extraArgs?: readonly string[];
    /** Environment and file-probe overrides for discovery. */
    discovery?: ChromeDiscovery;
    /**
     * Liveness seams used by {@link ChromeProcess.dispose} to decide whether the
     * browser really stopped before its profile is removed.
     */
    probe?: BrowserProbeOptions;
}
/** The command-line switches every launch shares. */
export declare function chromeLaunchArgs(options: {
    port: number;
    userDataDir: string;
    headless: boolean;
    viewport: {
        width: number;
        height: number;
    };
    extraArgs?: readonly string[];
}): string[];
/** A launched browser plus everything needed to undo the launch. */
export interface ChromeHandle {
    /** Binary that was started. */
    chromePath: string;
    /** Port the DevTools endpoint listens on. */
    port: number;
    /** Browser-level `webSocketDebuggerUrl`. */
    webSocketDebuggerUrl: string;
    /** Profile directory this launch created and therefore owns. */
    userDataDir: string;
    /** OS process id. */
    pid: number | undefined;
}
/** What one disposal actually achieved. */
export interface ChromeDisposeResult {
    /**
     * Whether the BROWSER is gone. The process this module spawned may be only a
     * launcher that exits while the real browser keeps running, so a dead child
     * handle says nothing on its own.
     */
    readonly stopped: boolean;
    /** Whether the profile directory was removed. */
    readonly profileRemoved: boolean;
}
/** The three steps a disposal takes, injected so the decision is testable without a browser. */
export interface BrowserDisposalHooks {
    /** Ask the spawned process to exit, escalating; resolves once it had its chance. */
    terminate(): Promise<void>;
    /** Resolve true while the browser still answers or its process is still alive. */
    probeAlive(): Promise<boolean>;
    /** Delete the profile directory this launch created. */
    removeProfile(): Promise<void>;
}
/**
 * Terminate one browser, then delete its profile only once the browser is
 * confirmed gone.
 *
 * Deleting the profile of a browser that is still running is worse than
 * leaving the directory behind: the live process loses its storage under it
 * while the caller reports a clean shutdown, and the leftover browser keeps a
 * profile path that no longer exists. So the profile is removed on evidence,
 * never on schedule.
 * @param hooks - terminate, liveness probe, profile removal.
 * @returns what the disposal achieved; never throws for a surviving browser.
 */
export declare function settleBrowserDispose(hooks: BrowserDisposalHooks): Promise<ChromeDisposeResult>;
/** How long one DevTools liveness probe may take. */
export declare const CHROME_PROBE_TIMEOUT_MS = 750;
/** Injection seams for {@link probeBrowserAlive}. */
export interface BrowserProbeOptions {
    /** Process liveness check. @default process.kill(pid, 0) */
    isAlive?: (pid: number) => boolean;
    /** DevTools endpoint query; true when it answers. @default a bounded fetch */
    fetchEndpoint?: (port: number, timeoutMs: number) => Promise<boolean>;
    /** Deadline for the endpoint query. @default CHROME_PROBE_TIMEOUT_MS */
    timeoutMs?: number;
}
/**
 * Whether the browser behind one handle is still running.
 *
 * Two independent facts are checked because either alone lies: the spawned pid
 * can be a launcher that exited while the browser lives, and the port can be
 * closed while a process is still shutting down. Alive wins on either.
 * @param info - port and pid pinned at launch.
 * @param options - liveness seams, for tests.
 * @returns true when the browser should be considered alive.
 */
export declare function probeBrowserAlive(info: Pick<ChromeHandle, 'port' | 'pid'>, options?: BrowserProbeOptions): Promise<boolean>;
/**
 * One Chrome process together with the temporary profile it owns.
 */
export declare class ChromeProcess {
    private readonly child;
    private readonly handle;
    private readonly probeOptions;
    private disposed;
    private disposeResult;
    private constructor();
    /**
     * Start a browser and wait until its DevTools endpoint answers.
     * @param options - binary, window size, deadlines.
     * @returns the running process.
     * @throws Error naming the actual failure (missing binary, exited process, silent port).
     */
    static launch(options?: LaunchChromeOptions): Promise<ChromeProcess>;
    /** The endpoint facts of this launch. */
    get info(): Readonly<ChromeHandle>;
    /** Whether {@link dispose} already ran. */
    get isDisposed(): boolean;
    /**
     * What the disposal achieved, once it ran. A caller that needs to know
     * whether a browser survived the shutdown reads this instead of assuming.
     * @returns the recorded outcome, or undefined before {@link dispose}.
     */
    get lastDispose(): ChromeDisposeResult | undefined;
    /**
     * Kill the process (escalating once), then delete the profile directory this
     * launch created — but only once the browser is confirmed gone.
     * @returns whether the browser stopped and whether its profile was removed.
     */
    dispose(): Promise<ChromeDisposeResult>;
}
/**
 * Delete the profile directory this launch created, without ever following a
 * link out of it.
 *
 * `fs.rm({ recursive: true })` is banned repository-wide: recursion walks a
 * junction or symlink happily and deletes whatever it points at, so a temp
 * profile that happens to contain one could remove an unrelated tree. This
 * walk instead unlinks a link in place (never descending into it), unlinks
 * regular files, and removes directories only after their contents are gone.
 * Failures are swallowed: a leftover file in the OS temp directory is a lesser
 * problem than failing the dispose path that the caller is awaiting.
 * @param dir - absolute path of the profile directory created by this launch.
 */
export declare function removeTempProfile(dir: string): Promise<void>;
