import { createRequire } from "node:module";
import WebSocket$1, { WebSocket, WebSocketServer } from "ws";
import { RTCPeerConnection } from "werift";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readdir, rmdir, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Service, symbols } from "@deepseek-ai/cordis";
//#region src/core/cdp.ts
/**
* Minimal Chrome DevTools Protocol client — the only transport the host half
* uses to reach the browser it launched.
*
* Deliberately small: one WebSocket, an auto-incrementing request id, a pending
* map, and per-method event listeners. Everything above this file (tabs,
* snapshot, actions) speaks CdpTransport, so tests drive those layers with a
* fake transport and never start Chrome.
*
* Flat-mode sessions: with `Target.setDiscoverTargets` + `Target.attachToTarget
* ({flatten: true})` every message for one tab carries its `sessionId`, so a
* single socket multiplexes browser-level and page-level commands.
*
* @module @jimorsm/dsh-client-ui-browser-view/core/cdp
*/
/** Protocol failure returned by the browser, or raised by this client. */
var CdpError = class extends Error {
	/** CDP error code, or `-1` for client-side failures (timeout, closed socket). */
	code;
	/** Method whose round-trip failed. */
	method;
	/**
	* @param method - the protocol method that failed.
	* @param code - CDP error code, `-1` for client-side failures.
	* @param message - the browser's own message, kept verbatim for diagnosis.
	*/
	constructor(method, code, message) {
		super(`${method}: ${message}`);
		this.name = "CdpError";
		this.method = method;
		this.code = code;
	}
};
/**
* A single WebSocket carrying browser-level and flat-session protocol traffic.
*/
var CdpClient = class CdpClient {
	socket;
	timeoutMs;
	pending = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Map();
	nextId = 1;
	closedReason;
	constructor(socket, timeoutMs) {
		this.socket = socket;
		this.timeoutMs = timeoutMs;
		socket.on("message", (data) => {
			this.handleMessage(data);
		});
		socket.on("close", () => {
			this.failAll("the DevTools socket closed");
		});
		socket.on("error", (error) => {
			this.failAll(`the DevTools socket failed: ${error.message}`);
		});
	}
	/**
	* Open a client against an already-discovered DevTools endpoint.
	* @param url - `webSocketDebuggerUrl` from `/json/version`.
	* @param options - command deadline override.
	* @returns a connected client.
	* @throws CdpError when the socket cannot be established in time.
	*/
	static async connect(url, options = {}) {
		const timeoutMs = options.timeoutMs ?? 3e4;
		const socket = new WebSocket$1(url, { handshakeTimeout: timeoutMs });
		await new Promise((resolve, reject) => {
			const cleanup = () => {
				socket.off("open", onOpen);
				socket.off("error", onError);
			};
			const onOpen = () => {
				cleanup();
				resolve();
			};
			const onError = (error) => {
				cleanup();
				reject(new CdpError("connect", -1, error.message));
			};
			socket.once("open", onOpen);
			socket.once("error", onError);
		});
		return new CdpClient(socket, timeoutMs);
	}
	/**
	* Address one protocol command.
	* @param method - CDP method.
	* @param params - command parameters.
	* @param sessionId - flat-mode session to address.
	* @returns the response `result`.
	*/
	send(method, params = {}, sessionId) {
		if (this.closedReason !== void 0) return Promise.reject(new CdpError(method, -1, this.closedReason));
		const id = this.nextId++;
		const payload = {
			id,
			method,
			params
		};
		if (sessionId !== void 0) payload.sessionId = sessionId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new CdpError(method, -1, `timed out after ${this.timeoutMs} ms`));
			}, this.timeoutMs);
			this.pending.set(id, {
				method,
				timer,
				resolve: (value) => {
					resolve(value);
				},
				reject
			});
			this.socket.send(JSON.stringify(payload), (error) => {
				if (error === null || error === void 0) return;
				const call = this.pending.get(id);
				if (call === void 0) return;
				this.pending.delete(id);
				clearTimeout(call.timer);
				call.reject(new CdpError(method, -1, error.message));
			});
		});
	}
	/**
	* Subscribe to one protocol event.
	* @param method - event name.
	* @param handler - event callback.
	* @returns the unsubscribe function.
	*/
	on(method, handler) {
		let set = this.listeners.get(method);
		if (set === void 0) {
			set = /* @__PURE__ */ new Set();
			this.listeners.set(method, set);
		}
		set.add(handler);
		return () => {
			const current = this.listeners.get(method);
			if (current === void 0) return;
			current.delete(handler);
			if (current.size === 0) this.listeners.delete(method);
		};
	}
	/** Drop the socket and reject every in-flight command. */
	close() {
		if (this.closedReason !== void 0) return;
		this.closedReason = "the DevTools client was closed";
		this.failAll(this.closedReason);
		try {
			this.socket.close();
		} catch {}
	}
	/** Route one decoded frame to the pending map or the event listeners. */
	handleMessage(data) {
		let message;
		try {
			message = JSON.parse(data.toString());
		} catch {
			return;
		}
		const id = message.id;
		if (typeof id === "number") {
			const call = this.pending.get(id);
			if (call === void 0) return;
			this.pending.delete(id);
			clearTimeout(call.timer);
			const error = message.error;
			if (error !== void 0 && error !== null) {
				const shaped = error;
				call.reject(new CdpError(call.method, typeof shaped.code === "number" ? shaped.code : -1, typeof shaped.message === "string" ? shaped.message : "unknown protocol error"));
				return;
			}
			call.resolve(message.result ?? {});
			return;
		}
		const method = message.method;
		if (typeof method !== "string") return;
		const set = this.listeners.get(method);
		if (set === void 0) return;
		const params = message.params ?? {};
		const sessionId = typeof message.sessionId === "string" ? message.sessionId : void 0;
		for (const handler of [...set]) try {
			handler(params, sessionId);
		} catch {}
	}
	/** Reject every in-flight command with one reason. */
	failAll(reason) {
		this.closedReason ??= reason;
		for (const [id, call] of [...this.pending]) {
			this.pending.delete(id);
			clearTimeout(call.timer);
			call.reject(new CdpError(call.method, -1, reason));
		}
	}
};
//#endregion
//#region src/host/rtc.ts
/**
* The WebRTC DataChannel frame relay: one peer connection per opting-in panel.
*
* The panel offers (it creates the unreliable `frames` DataChannel itself, so
* the unreliability parameters live on the side that knows what it wants);
* this side answers with werift, accepts the channel, and from the moment the
* channel opens receives binary frames instead of the WS JSON stream. The
* control plane (hello, state, action traces, errors, commands, input) stays
* on the WebSocket: it is low-rate and wants reliability.
*
* Frame payload over the channel: one big-endian uint32 sequence number
* followed by the raw JPEG bytes. The viewport is pinned by the host, so
* width and height do not travel per frame - the panel keeps the dimensions
* from the last WS frame event.
*
* ICE runs vanilla: werift includes host candidates in the answer SDP, and the
* deployment topology (proxy on the loopback, or a tailnet/LAN client) needs
* no STUN. If gathering were ever to need more, this is where it shows.
*
* @module @jimorsm/dsh-client-ui-browser-view/host/rtc
*/
/** Seconds to wait for ICE gathering before answering with what we have. */
const GATHER_TIMEOUT_MS = 3e3;
/**
* Header in front of every chunk: a big-endian u32 sequence, the chunk index,
* and the chunk count. Mirrored by DC_HEADER_BYTES in the panel.
*/
const CHUNK_HEADER_BYTES = 6;
/**
* Payload per chunk. A DataChannel message is capped (werift enforces 64 KiB
* and the browser side caps at the same figure), and a frame routinely exceeds
* that: a 1280x800 page at quality 50 runs to a few hundred kilobytes, where
* the same page on JPEG/quality 70 measured 111 KB and a heavy page 250 KB.
* Chunking keeps one oversized frame from being unsendable.
*/
const CHUNK_PAYLOAD_BYTES = 60 * 1024;
/** A frame needing more chunks than the count byte can express is not sent. */
const MAX_CHUNKS = 255;
/**
* One panel's frame relay. Created per accepted `rtc-offer`; the service keeps
* it next to the panel's sink and feeds frames through it while it is open.
*/
var RtcFrameRelay = class {
	/** The werift peer connection; absent until the offer is accepted. */
	pc;
	/** The unreliable channel the panel created in its offer. */
	channel;
	/** Whether the channel is open and frames may flow. */
	open = false;
	/**
	* Accept the panel's offer and return the local answer as a JSON string
	* (`{type, sdp}`), ready to travel back over the WebSocket.
	* @param offerSdpJson - the panel's `RTCSessionDescriptionInit` as JSON.
	* @param onClosed - called once when the connection fails or closes.
	* @returns the answer description JSON.
	*/
	async acceptOffer(offerSdpJson, onClosed) {
		const pc = new RTCPeerConnection({});
		this.pc = pc;
		pc.onDataChannel.subscribe((channel) => {
			this.channel = channel;
			channel.stateChanged.subscribe((state) => {
				if (state === "open") this.open = true;
				else if (state === "closed") {
					this.open = false;
					onClosed();
				}
			});
		});
		pc.connectionStateChange.subscribe((state) => {
			if (state === "failed" || state === "closed") {
				this.open = false;
				onClosed();
			}
		});
		await pc.setRemoteDescription(JSON.parse(offerSdpJson));
		await pc.setLocalDescription(await pc.createAnswer());
		if (pc.iceGatheringState !== "complete") await new Promise((resolve) => {
			const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
			pc.iceGatheringStateChange.subscribe((state) => {
				if (state === "complete") {
					clearTimeout(timer);
					resolve();
				}
			});
		});
		return JSON.stringify(pc.localDescription);
	}
	/**
	* Push one decoded frame over the channel, in chunks small enough for the
	* DataChannel message cap.
	*
	* Returns false instead of throwing when the frame cannot travel: an
	* oversized frame or a channel that died mid-frame must cost one frame, not
	* the panel. The caller falls back to the WebSocket for that frame.
	* @param seq - the frame's sequence number.
	* @param jpeg - the raw image bytes.
	* @returns whether the whole frame was handed to the channel.
	*/
	sendFrame(seq, jpeg) {
		if (!this.open || this.channel === void 0) return false;
		const chunks = chunkFrame(seq, jpeg);
		if (chunks === null) return false;
		try {
			for (const chunk of chunks) this.channel.send(chunk);
			return true;
		} catch {
			return false;
		}
	}
	/** Tear the peer connection down; safe to call more than once. */
	dispose() {
		this.open = false;
		try {
			this.pc?.close();
		} catch {}
		this.pc = void 0;
		this.channel = void 0;
	}
};
/**
* Split one frame into DataChannel-sized messages.
*
* Pure so the framing can be tested without a peer connection, and so the
* panel's reassembler has a single counterpart to agree with. Every chunk
* carries the frame's sequence number, its own index and the total count, which
* is what lets the panel notice a chunk from a newer frame and abandon the
* partial one it was holding.
* @param seq - the frame's sequence number.
* @param bytes - the encoded frame.
* @param payloadBytes - payload per chunk; the default leaves room for the header under the 64 KiB cap.
* @returns the chunks in order, or null when the frame cannot be expressed.
*/
function chunkFrame(seq, bytes, payloadBytes = CHUNK_PAYLOAD_BYTES) {
	const count = Math.max(1, Math.ceil(bytes.length / payloadBytes));
	if (count > MAX_CHUNKS) return null;
	const head = Buffer.alloc(CHUNK_HEADER_BYTES);
	head.writeUInt32BE(seq >>> 0, 0);
	head.writeUInt8(count, 5);
	const chunks = [];
	for (let index = 0; index < count; index += 1) {
		head.writeUInt8(index, 4);
		const start = index * payloadBytes;
		chunks.push(Buffer.concat([head, bytes.subarray(start, start + payloadBytes)]));
	}
	return chunks;
}
/** Mount path of the panel socket, relative to the GUI origin. */
const BROWSER_VIEW_SOCKET_PATH = "/api/dsh-browser-view/socket";
/** Viewport the host pins on every tab it creates, in CSS pixels. */
const DEFAULT_VIEWPORT = {
	width: 1280,
	height: 800
};
/**
* Box the captured frame is fitted into. The browser viewport stays at its own
* size (the agent's snapshots and coordinates are viewport-relative); only the
* picture travelling to the panel is scaled down, and input is scaled back up.
*/
const DEFAULT_CAPTURE_MAX = {
	width: 1024,
	height: 640
};
/** Deepest DOM snapshot walk the host will perform, in nodes. */
const SNAPSHOT_NODE_LIMIT = 4e3;
/** Whether a decoded value is one relayable input gesture. */
function isBrowserInputEvent(value) {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value;
	const finite = (v) => typeof v === "number" && Number.isFinite(v);
	const button = (v) => v === void 0 || v === "left" || v === "middle" || v === "right";
	const modifiers = (v) => v === void 0 || Array.isArray(v) && v.every((m) => m === "alt" || m === "ctrl" || m === "meta" || m === "shift");
	switch (candidate.kind) {
		case "mouse": return (candidate.action === "move" || candidate.action === "down" || candidate.action === "up") && finite(candidate.x) && finite(candidate.y) && button(candidate.button);
		case "wheel": return finite(candidate.x) && finite(candidate.y) && finite(candidate.deltaX) && finite(candidate.deltaY);
		case "key": return (candidate.action === "down" || candidate.action === "up") && typeof candidate.key === "string" && typeof candidate.code === "string" && (candidate.text === void 0 || typeof candidate.text === "string") && modifiers(candidate.modifiers);
		default: return false;
	}
}
/** Whether a decoded JSON value is a command this version accepts. */
function isBrowserViewCommand(value) {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value;
	if (candidate.v !== 1) return false;
	switch (candidate.kind) {
		case "attach": return candidate.sessionId === void 0 || typeof candidate.sessionId === "string";
		case "select-tab": return typeof candidate.tabId === "string";
		case "close-tab": return typeof candidate.tabId === "string";
		case "request-frame": return true;
		case "input": return isBrowserInputEvent(candidate.input);
		case "rtc-offer": return typeof candidate.sdp === "string" && candidate.sdp.length > 0;
		case "stream": return typeof candidate.enabled === "boolean";
		default: return false;
	}
}
//#endregion
//#region src/core/chrome.ts
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
const CHROME_PATH_ENV = "CHROME_PATH";
/** How long `dispose` waits for a polite exit before it escalates. */
const CHROME_EXIT_TIMEOUT_MS = 5e3;
/**
* Conventional Windows install locations, most specific first. Linux and macOS
* paths are listed too so the same resolver works on a developer machine; a
* missing candidate is skipped rather than reported.
*/
const CHROME_INSTALL_CANDIDATES = [
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
/** Linux and macOS binaries probed by their absolute path (Windows ignores these). */
const POSIX_CHROME_CANDIDATES = [
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
/**
* The candidate list for this platform, in probe order.
* @param env - environment carrying `CHROME_PATH`.
* @returns absolute candidate paths, the override first when it is set.
*/
function chromePathCandidates(env = process.env) {
	const override = env[CHROME_PATH_ENV];
	const candidates = [];
	if (override !== void 0 && override.trim() !== "") candidates.push(override.trim());
	candidates.push(...CHROME_INSTALL_CANDIDATES);
	if (process.platform !== "win32") candidates.push(...POSIX_CHROME_CANDIDATES);
	return candidates;
}
/**
* Resolve the browser binary to launch.
* @param discovery - environment and file-probe overrides.
* @returns the first existing candidate, or undefined when none is installed.
*/
function resolveChromePath(discovery = {}) {
	const isFile = discovery.isFile ?? existsSync;
	for (const candidate of chromePathCandidates(discovery.env ?? process.env)) if (isFile(candidate)) return candidate;
}
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
async function pickFreePort() {
	return await new Promise((resolve, reject) => {
		const probe = createServer();
		probe.unref();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (address === null || typeof address === "string") {
				probe.close();
				reject(/* @__PURE__ */ new Error("could not determine the assigned port"));
				return;
			}
			const { port } = address;
			probe.close(() => {
				resolve(port);
			});
		});
	});
}
/** The command-line switches every launch shares. */
function chromeLaunchArgs(options) {
	const args = [
		options.headless ? "--headless=new" : "--window-position=0,0",
		`--remote-debugging-port=${options.port}`,
		`--user-data-dir=${options.userDataDir}`,
		`--window-size=${options.viewport.width},${options.viewport.height}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-networking",
		"--disable-extensions",
		"--disable-sync",
		"--disable-component-update",
		"--disable-default-apps",
		"--hide-scrollbars",
		"--mute-audio",
		"about:blank"
	];
	if (options.extraArgs !== void 0) args.push(...options.extraArgs);
	return args;
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
async function settleBrowserDispose(hooks) {
	await hooks.terminate();
	if (await hooks.probeAlive()) return {
		stopped: false,
		profileRemoved: false
	};
	await hooks.removeProfile();
	return {
		stopped: true,
		profileRemoved: true
	};
}
/** Default process liveness check: signal 0 tests existence without signalling. */
function defaultIsProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
/** Default DevTools probe: does /json/version still answer on the pinned port. */
async function defaultDevToolsProbe(port, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, timeoutMs);
	try {
		return (await fetch(`http://127.0.0.1:${port}/json/version`, {
			headers: { host: `127.0.0.1:${port}` },
			signal: controller.signal
		})).ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
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
async function probeBrowserAlive(info, options = {}) {
	const isAlive = options.isAlive ?? defaultIsProcessAlive;
	if (info.pid !== void 0 && isAlive(info.pid)) return true;
	const query = options.fetchEndpoint ?? defaultDevToolsProbe;
	try {
		return await query(info.port, options.timeoutMs ?? 750);
	} catch {
		return false;
	}
}
/**
* One Chrome process together with the temporary profile it owns.
*/
var ChromeProcess = class ChromeProcess {
	child;
	handle;
	probeOptions;
	disposed = false;
	disposeResult;
	constructor(child, handle, probeOptions) {
		this.child = child;
		this.handle = handle;
		this.probeOptions = probeOptions;
	}
	/**
	* Start a browser and wait until its DevTools endpoint answers.
	* @param options - binary, window size, deadlines.
	* @returns the running process.
	* @throws Error naming the actual failure (missing binary, exited process, silent port).
	*/
	static async launch(options = {}) {
		const viewport = options.viewport ?? {
			width: DEFAULT_VIEWPORT.width,
			height: DEFAULT_VIEWPORT.height
		};
		const chromePath = options.chromePath ?? resolveChromePath(options.discovery);
		if (chromePath === void 0) {
			const candidates = chromePathCandidates(options.discovery?.env ?? process.env);
			throw new Error(`No Chrome binary found. Set ${CHROME_PATH_ENV} to the executable, or install Chrome. Probed: ${candidates.join(", ")}`);
		}
		const port = await pickFreePort();
		const userDataDir = await mkdtemp(join(tmpdir(), "dsh-browser-view-"));
		const args = chromeLaunchArgs({
			port,
			userDataDir,
			headless: options.headless ?? true,
			viewport,
			extraArgs: options.extraArgs
		});
		let child;
		try {
			child = spawn(chromePath, args, {
				stdio: "ignore",
				windowsHide: true
			});
		} catch (error) {
			await removeTempProfile(userDataDir);
			throw new Error(`Could not start ${chromePath}: ${error instanceof Error ? error.message : String(error)}`);
		}
		const process_ = new ChromeProcess(child, {
			chromePath,
			port,
			userDataDir,
			webSocketDebuggerUrl: "",
			pid: child.pid
		}, options.probe ?? {});
		try {
			const endpoint = await waitForDevToolsEndpoint({
				port,
				child,
				timeoutMs: options.startupTimeoutMs ?? 2e4
			});
			process_.handle.webSocketDebuggerUrl = endpoint;
			return process_;
		} catch (error) {
			await process_.dispose();
			throw error;
		}
	}
	/** The endpoint facts of this launch. */
	get info() {
		return this.handle;
	}
	/** Whether {@link dispose} already ran. */
	get isDisposed() {
		return this.disposed;
	}
	/**
	* What the disposal achieved, once it ran. A caller that needs to know
	* whether a browser survived the shutdown reads this instead of assuming.
	* @returns the recorded outcome, or undefined before {@link dispose}.
	*/
	get lastDispose() {
		return this.disposeResult;
	}
	/**
	* Kill the process (escalating once), then delete the profile directory this
	* launch created — but only once the browser is confirmed gone.
	* @returns whether the browser stopped and whether its profile was removed.
	*/
	async dispose() {
		if (this.disposeResult !== void 0) return this.disposeResult;
		this.disposed = true;
		this.disposeResult = await settleBrowserDispose({
			terminate: () => terminate(this.child),
			probeAlive: async () => await probeBrowserAlive(this.handle, this.probeOptions),
			removeProfile: async () => {
				await removeTempProfile(this.handle.userDataDir);
			}
		});
		return this.disposeResult;
	}
};
/**
* Poll `/json/version` until the browser publishes its debugger URL.
* @param options - port, child handle, deadline.
* @returns the `webSocketDebuggerUrl`.
*/
async function waitForDevToolsEndpoint(options) {
	const deadline = Date.now() + options.timeoutMs;
	let lastError = "no response";
	while (Date.now() < deadline) {
		const exitCode = options.child.exitCode;
		if (exitCode !== null) throw new Error(`Chrome exited before its DevTools endpoint came up (exit code ${exitCode})${describeExitHint(options.port)}`);
		try {
			const response = await fetch(`http://127.0.0.1:${options.port}/json/version`, { headers: { host: `127.0.0.1:${options.port}` } });
			if (response.ok) {
				const body = await response.json();
				if (typeof body.webSocketDebuggerUrl === "string" && body.webSocketDebuggerUrl !== "") return body.webSocketDebuggerUrl;
				lastError = "the DevTools endpoint reported no webSocketDebuggerUrl";
			} else lastError = `HTTP ${response.status} from /json/version`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	}
	throw new Error(`Chrome did not open its DevTools endpoint on 127.0.0.1:${options.port} within ${options.timeoutMs} ms (${lastError})`);
}
/** A hint appended to an early-exit message for the most common cause. */
function describeExitHint(port) {
	return `. The profile directory may be locked, or another process holds port ${port}.`;
}
/**
* Terminate one child process, escalating to SIGKILL after a grace period.
* @param child - the process launched for this browser.
*/
async function terminate(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise((resolve) => {
		child.once("exit", () => resolve());
		child.once("error", () => resolve());
	});
	try {
		child.kill();
	} catch {
		return;
	}
	if (await Promise.race([exited.then(() => "exited"), new Promise((resolve) => {
		setTimeout(() => resolve("timeout"), 5e3);
	})]) === "exited") return;
	try {
		child.kill("SIGKILL");
	} catch {
		return;
	}
	await Promise.race([exited, new Promise((resolve) => {
		setTimeout(resolve, CHROME_EXIT_TIMEOUT_MS);
	})]);
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
async function removeTempProfile(dir) {
	const root = tmpdir();
	if (!dir.startsWith(root) || dir === root) return;
	await emptyDirectory(dir);
	await rmdir(dir).catch(() => void 0);
}
/** Recursively empty one directory, refusing to descend through links. */
async function emptyDirectory(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isSymbolicLink()) {
			await unlink(path).catch(() => void 0);
			continue;
		}
		if (entry.isDirectory()) {
			const stats = await lstat(path).catch(() => void 0);
			if (stats === void 0) continue;
			if (stats.isSymbolicLink()) {
				await unlink(path).catch(() => void 0);
				continue;
			}
			await emptyDirectory(path);
			await rmdir(path).catch(() => void 0);
			continue;
		}
		await unlink(path).catch(() => void 0);
	}
}
//#endregion
//#region src/core/browser.ts
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
/** Environment variable that turns attach mode on. */
const ATTACH_PORT_ENV = "DSH_BROWSER_VIEW_ATTACH_PORT";
/** Deadline for the DevTools endpoint query in attach mode. */
const ATTACH_ENDPOINT_TIMEOUT_MS = 5e3;
/** What a disposal did; an attached browser is never stopped and has no profile. */
const ATTACHED_DISPOSE_RESULT = {
	stopped: false,
	profileRemoved: false
};
/**
* Parse the attach port from one environment value.
* @param raw - the env value.
* @returns the port, or undefined when the value is unset or blank.
* @throws Error when the value is set but not a usable port number.
*/
function parseAttachPort(raw) {
	if (raw === void 0 || raw.trim() === "") return void 0;
	const value = raw.trim();
	if (!/^\d+$/.test(value)) throw new Error(`${ATTACH_PORT_ENV} must be a TCP port number, got "${raw}"`);
	const port = Number(value);
	if (port < 1 || port > 65535) throw new Error(`${ATTACH_PORT_ENV} must be a port between 1 and 65535, got ${port}`);
	return port;
}
/** Default endpoint query: the same shape Chrome itself answers. */
async function defaultFetchEndpoint(port, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, timeoutMs);
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
			headers: { host: `127.0.0.1:${port}` },
			signal: controller.signal
		});
		if (!response.ok) throw new Error(`HTTP ${response.status} from /json/version`);
		const body = await response.json();
		if (typeof body.webSocketDebuggerUrl !== "string" || body.webSocketDebuggerUrl === "") throw new Error("the endpoint reported no webSocketDebuggerUrl");
		return body.webSocketDebuggerUrl;
	} finally {
		clearTimeout(timer);
	}
}
/**
* Resolve the browser the plugin drives: an attached one when
* {@link ATTACH_PORT_ENV} names a port, a freshly spawned one otherwise.
* @param options - environment and seam overrides.
* @returns the resolved browser.
* @throws Error naming the port and the last concrete reason when attach fails.
*/
async function resolveBrowserHandle(options = {}) {
	const port = parseAttachPort((options.env ?? process.env)[ATTACH_PORT_ENV]);
	if (port !== void 0) {
		const fetchEndpoint = options.fetchEndpoint ?? defaultFetchEndpoint;
		let webSocketDebuggerUrl;
		try {
			webSocketDebuggerUrl = await fetchEndpoint(port, ATTACH_ENDPOINT_TIMEOUT_MS);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`Could not attach to the browser DevTools endpoint on port ${port}: ${reason}`);
		}
		return {
			mode: "attach",
			port,
			webSocketDebuggerUrl,
			dispose: async () => ATTACHED_DISPOSE_RESULT
		};
	}
	const chrome = await (options.launchChrome ?? (async (launchOptions) => await ChromeProcess.launch(launchOptions)))({ viewport: options.viewport ?? {
		width: DEFAULT_VIEWPORT.width,
		height: DEFAULT_VIEWPORT.height
	} });
	return {
		mode: "spawn",
		chrome,
		webSocketDebuggerUrl: chrome.info.webSocketDebuggerUrl,
		dispose: () => chrome.dispose()
	};
}
//#endregion
//#region src/core/tabs.ts
/**
* Append one entry to a bounded ring, dropping the oldest overflow.
* @param ring - the ring, mutated in place.
* @param entry - the new entry.
* @param limit - maximum retained entries.
*/
function pushBounded(ring, entry, limit) {
	ring.push(entry);
	const overflow = ring.length - limit;
	if (overflow > 0) ring.splice(0, overflow);
}
/** Render one console argument the way a browser console would print it. */
function describeConsoleArg(arg) {
	if (typeof arg.unserializableValue === "string") return arg.unserializableValue;
	if (arg.value !== void 0) {
		if (typeof arg.value === "string") return arg.value;
		try {
			return JSON.stringify(arg.value);
		} catch {
			return String(arg.value);
		}
	}
	if (typeof arg.description === "string") return arg.description;
	return typeof arg.type === "string" ? `[${arg.type}]` : "[unserializable]";
}
/**
* One browser's tabs.
*/
var TabManager = class {
	transport;
	jpegQuality;
	frameFormat;
	captureMax;
	viewport;
	ringSize;
	now;
	onFrame;
	onTabsChanged;
	tabs = /* @__PURE__ */ new Map();
	bySession = /* @__PURE__ */ new Map();
	unsubscribers = [];
	active = null;
	disposed = false;
	/**
	* @param options - transport, viewport, ring size, callbacks.
	*/
	constructor(options) {
		this.transport = options.transport;
		this.jpegQuality = options.jpegQuality ?? 50;
		this.frameFormat = options.frameFormat ?? "webp";
		this.captureMax = options.captureMax ?? {
			width: DEFAULT_CAPTURE_MAX.width,
			height: DEFAULT_CAPTURE_MAX.height
		};
		this.viewport = options.viewport ?? {
			width: DEFAULT_VIEWPORT.width,
			height: DEFAULT_VIEWPORT.height
		};
		this.ringSize = options.ringSize ?? 500;
		this.now = options.now ?? Date.now;
		this.onFrame = options.onFrame;
		this.onTabsChanged = options.onTabsChanged;
		this.subscribe();
	}
	/** Replace the frame sink (the service rewires it when a panel attaches). */
	setFrameSink(sink) {
		this.onFrame = sink;
	}
	/** Replace the tab-change sink. */
	setTabsChangedSink(sink) {
		this.onTabsChanged = sink;
	}
	/** Tabs in creation order. */
	list() {
		return [...this.tabs.values()].map((tab) => this.view(tab));
	}
	/** The tab the panel watches, if any. */
	get activeTabId() {
		return this.active;
	}
	/** Whether a tab id is still open. */
	has(tabId) {
		return this.tabs.has(tabId);
	}
	/**
	* Resolve one tab or fail with a message the model can act on.
	* @param tabId - id from a previous tool call or panel event.
	* @returns the tab record.
	*/
	tab(tabId) {
		const record = this.tabs.get(tabId);
		if (record === void 0) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`);
		return this.view(record);
	}
	/** Internal record access for the layers that need the CDP session. */
	sessionOf(tabId) {
		const record = this.tabs.get(tabId);
		if (record === void 0) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`);
		return record.sessionId;
	}
	/**
	* Create one tab and instrument it.
	* @param options - url to open and the session that asked for it.
	* @returns the new tab as the panel sees it.
	*/
	async createTab(options = {}) {
		const targetId = (await this.transport.send("Target.createTarget", { url: "about:blank" })).targetId;
		if (typeof targetId !== "string" || targetId === "") throw new Error("the browser did not return a target id for the new tab");
		const sessionId = (await this.transport.send("Target.attachToTarget", {
			targetId,
			flatten: true
		})).sessionId;
		if (typeof sessionId !== "string" || sessionId === "") throw new Error(`the browser did not return a session for tab ${targetId}`);
		const record = {
			id: targetId,
			sessionId,
			url: "about:blank",
			title: "",
			loading: false,
			loaderId: void 0,
			ownerSessionId: options.sessionId,
			console: [],
			network: [],
			pendingRequests: /* @__PURE__ */ new Map(),
			screencastRunning: false,
			frameSeq: 0,
			refs: /* @__PURE__ */ new Map()
		};
		this.tabs.set(targetId, record);
		this.bySession.set(sessionId, record);
		this.active = targetId;
		await this.enableDomains(record);
		await this.pinViewport(record);
		if (options.url !== void 0 && options.url !== "") await this.navigate(targetId, options.url);
		this.onTabsChanged?.();
		return this.view(record);
	}
	/**
	* Pin CSS-pixel viewport metrics so frames, boxes, and clicks share one
	* coordinate space regardless of the window the browser opened with.
	* @param record - the tab to pin.
	*/
	async pinViewport(record) {
		await this.transport.send("Emulation.setDeviceMetricsOverride", {
			width: this.viewport.width,
			height: this.viewport.height,
			deviceScaleFactor: 1,
			mobile: false
		}, record.sessionId);
	}
	/**
	* Navigate one tab and wait for the load to settle.
	* @param tabId - target tab.
	* @param url - absolute or `data:` url.
	* @returns the tab after navigation settled.
	*/
	async navigate(tabId, url) {
		const record = this.requireRecord(tabId);
		record.loading = true;
		this.onTabsChanged?.();
		const settled = waitForLoad(this.transport, record.sessionId);
		await this.transport.send("Page.navigate", { url }, record.sessionId);
		await settled;
		await this.refreshDocumentInfo(record);
		this.onTabsChanged?.();
		return this.view(record);
	}
	/**
	* Mark which dsh session owns a tab, so the panel can show it.
	* @param tabId - target tab.
	* @param sessionId - owning session, or undefined to clear.
	*/
	bindSession(tabId, sessionId) {
		const record = this.tabs.get(tabId);
		if (record === void 0) return;
		record.ownerSessionId = sessionId;
		this.onTabsChanged?.();
	}
	/**
	* Select the tab the panel follows.
	* @param tabId - target tab.
	* @returns the selected tab.
	*/
	selectTab(tabId) {
		const record = this.requireRecord(tabId);
		this.active = tabId;
		this.onTabsChanged?.();
		return this.view(record);
	}
	/**
	* Close one tab and forget its ring buffers.
	* @param tabId - target tab.
	*/
	async closeTab(tabId) {
		const record = this.requireRecord(tabId);
		await this.stopScreencast(tabId).catch(() => void 0);
		await this.transport.send("Target.closeTarget", { targetId: record.id }).catch(() => void 0);
		this.tabs.delete(record.id);
		this.bySession.delete(record.sessionId);
		if (this.active === record.id) this.active = [...this.tabs.keys()].at(-1) ?? null;
		this.onTabsChanged?.();
	}
	/**
	* Start the JPEG screencast for one tab.
	* @param tabId - target tab.
	*/
	async startScreencast(tabId) {
		const record = this.requireRecord(tabId);
		if (record.screencastRunning) return;
		record.screencastRunning = true;
		await this.transport.send("Page.startScreencast", {
			format: this.frameFormat,
			quality: this.jpegQuality,
			maxWidth: this.captureMax.width,
			maxHeight: this.captureMax.height,
			everyNthFrame: 1
		}, record.sessionId);
	}
	/**
	* Stop the screencast for one tab; a tab that is already stopped is fine.
	* @param tabId - target tab.
	*/
	async stopScreencast(tabId) {
		const record = this.tabs.get(tabId);
		if (record === void 0 || !record.screencastRunning) return;
		record.screencastRunning = false;
		await this.transport.send("Page.stopScreencast", {}, record.sessionId);
	}
	/**
	* Capture one JPEG frame on demand.
	* @param tabId - target tab.
	* @returns base64 JPEG without the `data:` prefix.
	*/
	async captureScreenshot(tabId) {
		const record = this.requireRecord(tabId);
		const result = await this.transport.send("Page.captureScreenshot", {
			format: this.frameFormat,
			quality: this.jpegQuality,
			captureBeyondViewport: false,
			clip: {
				x: 0,
				y: 0,
				width: this.viewport.width,
				height: this.viewport.height,
				scale: this.captureMax.width / this.viewport.width
			}
		}, record.sessionId);
		if (typeof result.data !== "string" || result.data === "") throw new Error("the browser returned an empty screenshot");
		return result.data;
	}
	/**
	* Capture a frame and hand it to the panel. An action calls this because a
	* screencast only emits when the compositor sees a change: a click that
	* changes nothing visually would otherwise leave the panel showing the
	* pre-click state forever.
	* @param tabId - target tab.
	* @returns the emitted frame.
	*/
	async refreshFrame(tabId) {
		const data = await this.captureScreenshot(tabId);
		const record = this.requireRecord(tabId);
		record.frameSeq += 1;
		const frame = {
			tabId: record.id,
			seq: record.frameSeq,
			width: this.captureSize().width,
			height: this.captureSize().height,
			format: this.frameFormat,
			data
		};
		this.onFrame?.(frame);
		return frame;
	}
	/**
	* The size a captured frame actually has: the capture box, clipped to the
	* viewport's aspect ratio so both encodings agree on the picture.
	* @returns capture size in CSS pixels.
	*/
	captureSize() {
		const scale = this.captureMax.width / this.viewport.width;
		return {
			width: Math.round(this.viewport.width * scale),
			height: Math.round(this.viewport.height * scale)
		};
	}
	/**
	* Map a pointer position on the captured frame back onto the viewport.
	* The panel scales its own display box onto the frame it was sent, so what
	* arrives here is frame-relative; the browser needs viewport-relative.
	* @param x - frame-relative x.
	* @param y - frame-relative y.
	* @returns viewport-relative coordinates.
	*/
	toViewport(x, y) {
		const captured = this.captureSize();
		if (captured.width === this.viewport.width && captured.height === this.viewport.height) return {
			x,
			y
		};
		return {
			x: x * (this.viewport.width / captured.width),
			y: y * (this.viewport.height / captured.height)
		};
	}
	/**
	* Relay one panel input gesture into the tab over CDP.
	*
	* The panel sends frame CSS pixels it already scaled from its display size,
	* which this method maps back onto the viewport. Modifier and button names
	* map onto the CDP bit masks here, the contract stays human-readable.
	* @param tabId - target tab.
	* @param input - one validated gesture from the wire contract.
	*/
	async dispatchInput(tabId, input) {
		const record = this.requireRecord(tabId);
		if (input.kind === "mouse") {
			const button = input.button ?? "left";
			const buttonMask = button === "right" ? 2 : button === "middle" ? 4 : 1;
			const type = input.action === "down" ? "mousePressed" : input.action === "up" ? "mouseReleased" : "mouseMoved";
			const point = this.toViewport(input.x, input.y);
			await this.transport.send("Input.dispatchMouseEvent", {
				type,
				x: point.x,
				y: point.y,
				button,
				buttons: input.action === "move" ? 0 : buttonMask,
				clickCount: input.action === "move" ? 0 : 1
			}, record.sessionId);
			return;
		}
		if (input.kind === "wheel") {
			const point = this.toViewport(input.x, input.y);
			await this.transport.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: point.x,
				y: point.y,
				deltaX: input.deltaX,
				deltaY: input.deltaY
			}, record.sessionId);
			return;
		}
		const modifierMask = (input.modifiers ?? []).reduce((mask, name) => {
			return mask | (name === "alt" ? 1 : name === "ctrl" ? 2 : name === "meta" ? 4 : 8);
		}, 0);
		const needsText = input.action === "down" && input.text !== void 0 && input.text.length > 0;
		await this.transport.send("Input.dispatchKeyEvent", {
			type: needsText ? "char" : input.action === "down" ? "keyDown" : "keyUp",
			key: input.key,
			code: input.code,
			...needsText ? { text: input.text } : {},
			modifiers: modifierMask
		}, record.sessionId);
	}
	/**
	* Console entries captured so far, oldest first.
	* @param tabId - target tab.
	* @returns a copy; the ring keeps mutating.
	*/
	consoleEntries(tabId) {
		return [...this.requireRecord(tabId).console];
	}
	/**
	* Network entries captured so far, in request order.
	* @param tabId - target tab.
	* @returns a copy; the table keeps mutating.
	*/
	networkEntries(tabId) {
		return this.requireRecord(tabId).network.map((entry) => ({ ...entry }));
	}
	/**
	* Record the ref-to-selector map produced by one snapshot, replacing the
	* previous one: a ref is only meaningful against the observation it came
	* from, and keeping two generations would let a click hit a stale node.
	* @param tabId - target tab.
	* @param refs - depth-first ref to CSS selector.
	*/
	setSnapshotRefs(tabId, refs) {
		this.requireRecord(tabId).refs = refs;
	}
	/**
	* Resolve a snapshot ref to the selector captured with it.
	* @param tabId - target tab.
	* @param ref - depth-first index from the last snapshot.
	* @returns the CSS selector.
	*/
	selectorForRef(tabId, ref) {
		const selector = this.requireRecord(tabId).refs.get(ref);
		if (selector === void 0) throw new Error(`ref ${ref} is unknown; call browser_snapshot first and use a ref from that observation`);
		return selector;
	}
	/** Stop every screencast and detach all protocol listeners. */
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const record of this.tabs.values()) {
			if (!record.screencastRunning) continue;
			record.screencastRunning = false;
			await this.transport.send("Page.stopScreencast", {}, record.sessionId).catch(() => void 0);
		}
		for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
		this.tabs.clear();
		this.bySession.clear();
		this.active = null;
	}
	/** One view for the panel and the tools. */
	view(record) {
		const view = {
			id: record.id,
			url: record.url,
			title: record.title,
			loading: record.loading
		};
		if (record.ownerSessionId !== void 0) view.sessionId = record.ownerSessionId;
		return view;
	}
	/** Look up a record or fail with an actionable message. */
	requireRecord(tabId) {
		const record = this.tabs.get(tabId);
		if (record === void 0) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`);
		return record;
	}
	/** Enable the domains every tab needs and attach nothing else. */
	async enableDomains(record) {
		for (const method of [
			"Page.enable",
			"Runtime.enable",
			"Network.enable",
			"Log.enable"
		]) await this.transport.send(method, {}, record.sessionId);
	}
	/** Drop every observation that belonged to the previous document. */
	resetObservation(record) {
		record.console.length = 0;
		record.network.length = 0;
		record.pendingRequests.clear();
	}
	/** Read the current url and title into the record. */
	async refreshDocumentInfo(record) {
		try {
			const raw = (await this.transport.send("Runtime.evaluate", {
				expression: "JSON.stringify({ url: location.href, title: document.title })",
				returnByValue: true
			}, record.sessionId)).result?.value;
			if (typeof raw !== "string") return;
			const parsed = JSON.parse(raw);
			if (typeof parsed.url === "string") record.url = parsed.url;
			if (typeof parsed.title === "string") record.title = parsed.title;
		} catch {}
	}
	/** Register every protocol event the manager consumes. */
	subscribe() {
		const bySession = (sessionId) => {
			return sessionId === void 0 ? void 0 : this.bySession.get(sessionId);
		};
		this.unsubscribers.push(this.transport.on("Page.frameNavigated", (params, sessionId) => {
			const frame = params.frame;
			if (frame === void 0) return;
			if (frame.parentId !== void 0) return;
			const record = bySession(sessionId);
			if (record === void 0) return;
			const url = typeof frame.url === "string" ? frame.url : void 0;
			const loaderId = typeof frame.loaderId === "string" ? frame.loaderId : void 0;
			if (url !== void 0 && url !== record.url || loaderId !== void 0 && record.loaderId !== void 0 && loaderId !== record.loaderId) this.resetObservation(record);
			if (url !== void 0) record.url = url;
			if (loaderId !== void 0) record.loaderId = loaderId;
			this.onTabsChanged?.();
		}));
		this.unsubscribers.push(this.transport.on("Page.frameStartedLoading", (_params, sessionId) => {
			const record = bySession(sessionId);
			if (record === void 0) return;
			record.loading = true;
			this.onTabsChanged?.();
		}));
		this.unsubscribers.push(this.transport.on("Page.loadEventFired", (_params, sessionId) => {
			const record = bySession(sessionId);
			if (record === void 0) return;
			record.loading = false;
			this.onTabsChanged?.();
			this.refreshDocumentInfo(record).then(() => {
				this.onTabsChanged?.();
			});
		}));
		this.unsubscribers.push(this.transport.on("Runtime.consoleAPICalled", (params, sessionId) => {
			const record = bySession(sessionId);
			if (record === void 0) return;
			const shaped = params;
			const level = typeof shaped.type === "string" ? shaped.type : "log";
			const text = (shaped.args ?? []).map(describeConsoleArg).join(" ");
			pushBounded(record.console, {
				level,
				text,
				at: this.now()
			}, this.ringSize);
		}));
		this.unsubscribers.push(this.transport.on("Log.entryAdded", (params, sessionId) => {
			const record = bySession(sessionId);
			if (record === void 0) return;
			const entry = params.entry;
			if (entry === void 0 || typeof entry.text !== "string") return;
			const level = typeof entry.level === "string" ? entry.level : "info";
			pushBounded(record.console, {
				level,
				text: entry.text,
				at: this.now()
			}, this.ringSize);
		}));
		this.unsubscribers.push(this.transport.on("Network.requestWillBeSent", (params, sessionId) => {
			const record = bySession(sessionId);
			if (record === void 0) return;
			const shaped = params;
			const request = shaped.request;
			if (request === void 0 || typeof request.url !== "string") return;
			const entry = {
				url: request.url,
				method: typeof request.method === "string" ? request.method : "GET",
				status: 0,
				at: this.now()
			};
			pushBounded(record.network, entry, this.ringSize);
			if (record.network.includes(entry) && typeof shaped.requestId === "string") record.pendingRequests.set(shaped.requestId, entry);
		}));
		this.unsubscribers.push(this.transport.on("Network.responseReceived", (params, sessionId) => {
			const record = bySession(sessionId);
			if (record === void 0) return;
			const shaped = params;
			if (typeof shaped.requestId !== "string") return;
			const entry = record.pendingRequests.get(shaped.requestId);
			if (entry === void 0) return;
			record.pendingRequests.delete(shaped.requestId);
			const response = shaped.response;
			if (response === void 0) return;
			if (typeof response.status === "number") entry.status = response.status;
			if (typeof response.mimeType === "string") entry.mimeType = response.mimeType;
		}));
		this.unsubscribers.push(this.transport.on("Network.loadingFailed", (params, sessionId) => {
			const record = bySession(sessionId);
			if (record === void 0) return;
			const shaped = params;
			if (typeof shaped.requestId !== "string") return;
			const entry = record.pendingRequests.get(shaped.requestId);
			if (entry === void 0) return;
			record.pendingRequests.delete(shaped.requestId);
			if (typeof shaped.errorText === "string") entry.failure = shaped.errorText;
		}));
		this.unsubscribers.push(this.transport.on("Page.screencastFrame", (params, sessionId) => {
			const record = bySession(sessionId);
			if (record === void 0) return;
			const shaped = params;
			if (typeof shaped.sessionId === "number") this.transport.send("Page.screencastFrameAck", { sessionId: shaped.sessionId }, record.sessionId).catch(() => void 0);
			if (typeof shaped.data !== "string" || shaped.data === "") return;
			record.frameSeq += 1;
			const size = this.captureSize();
			this.onFrame?.({
				tabId: record.id,
				seq: record.frameSeq,
				width: size.width,
				height: size.height,
				format: this.frameFormat,
				data: shaped.data
			});
		}));
	}
};
/**
* Resolve when the tab's next load event arrives, or after a short grace when
* the navigation produces none (a `data:` url, an in-page fragment jump).
* @param transport - the tab's protocol transport.
* @param sessionId - flat session of the tab.
* @returns once the load settled or the grace elapsed.
*/
function waitForLoad(transport, sessionId) {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			unsubscribe();
			resolve();
		};
		const unsubscribe = transport.on("Page.loadEventFired", (_params, eventSession) => {
			if (eventSession === sessionId) done();
		});
		const timer = setTimeout(done, 1e4);
	});
}
//#endregion
//#region src/core/snapshot.ts
/**
* Build the `BrowserSnapshot` from raw page nodes.
*
* Refs are the array index, so the caller must pass nodes in depth-first order
* (the walk guarantees it) and must not re-sort them.
* @param input - tab identity, raw nodes, and the node limit.
* @returns the snapshot plus its ref map.
*/
function assembleSnapshot(input) {
	const limit = input.limit ?? 4e3;
	const refs = /* @__PURE__ */ new Map();
	const nodes = [];
	let truncated = input.raw.length > limit;
	for (const raw of input.raw) {
		if (nodes.length >= limit) {
			truncated = true;
			break;
		}
		const ref = nodes.length;
		const node = {
			ref,
			tag: raw.tag,
			depth: raw.depth
		};
		if (raw.id !== void 0 && raw.id !== "") node.id = raw.id;
		if (raw.classes !== void 0 && raw.classes.length > 0) node.classes = [...raw.classes];
		if (raw.role !== void 0 && raw.role !== "") node.role = raw.role;
		if (raw.name !== void 0 && raw.name !== "") node.name = raw.name;
		if (raw.text !== void 0 && raw.text !== "") node.text = raw.text;
		if (raw.box !== void 0) node.box = { ...raw.box };
		nodes.push(node);
		refs.set(ref, raw.selector);
	}
	return {
		snapshot: {
			tabId: input.tabId,
			url: input.url,
			title: input.title,
			nodes,
			truncated
		},
		refs
	};
}
/**
* Build the in-page walk expression.
*
* The limit is baked in as a literal because `Runtime.evaluate` has no
* argument channel for a non-expression value; it is a number this module
* controls, never user input.
* @param limit - maximum nodes the walk may report.
* @returns a self-invoking expression returning {@link RawSnapshotPayload}.
*/
function buildSnapshotExpression(limit = SNAPSHOT_NODE_LIMIT) {
	return `(() => {
  const LIMIT = ${Math.max(1, Math.floor(limit))};
  const SKIP = { script: 1, style: 1, noscript: 1, template: 1, meta: 1, link: 1, title: 1, base: 1 };
  const ROLES = {
    a: 'link', button: 'button', img: 'img', input: 'textbox', textarea: 'textbox',
    select: 'combobox', option: 'option', nav: 'navigation', main: 'main', header: 'banner',
    footer: 'contentinfo', aside: 'complementary', section: 'region', form: 'form',
    ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', td: 'cell',
    th: 'columnheader', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
    h5: 'heading', h6: 'heading', p: 'paragraph', label: 'label', dialog: 'dialog',
  };
  const nodes = [];
  let truncated = false;
  const clip = (value, max) => {
    const text = String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '...' : text;
  };
  const selectorOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id) {
        parts.unshift(node.tagName.toLowerCase() + '#' + CSS.escape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.prototype.filter.call(parent.children, (child) => child.tagName === node.tagName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };
  const nameOf = (el, tag) => {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return clip(aria, 80);
    if (tag === 'img' && el.getAttribute('alt')) return clip(el.getAttribute('alt'), 80);
    if (el.getAttribute && el.getAttribute('title')) return clip(el.getAttribute('title'), 80);
    if (el.labels && el.labels.length > 0) return clip(el.labels[0].textContent, 80);
    if (el.children.length === 0) return clip(el.textContent, 80);
    return undefined;
  };
  const walk = (el, depth) => {
    if (nodes.length >= LIMIT) { truncated = true; return; }
    const tag = el.tagName.toLowerCase();
    if (SKIP[tag]) return;
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0;
    if (visible) {
      const node = { tag: tag, depth: depth, selector: selectorOf(el) };
      if (el.id) node.id = el.id;
      const classes = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 8);
      if (classes.length > 0) node.classes = classes;
      const role = (el.getAttribute('role') || ROLES[tag] || '').trim();
      if (role) node.role = role;
      const name = nameOf(el, tag);
      if (name) node.name = name;
      if (el.children.length === 0) {
        const text = clip(el.textContent, 160);
        if (text) node.text = text;
      }
      node.box = {
        x: Math.round(rect.left), y: Math.round(rect.top),
        width: Math.round(rect.width), height: Math.round(rect.height),
      };
      nodes.push(node);
    }
    if (nodes.length >= LIMIT) { truncated = true; return; }
    for (let index = 0; index < el.children.length; index += 1) walk(el.children[index], depth + 1);
  };
  const root = document.body || document.documentElement;
  if (root) walk(root, 0);
  return { url: location.href, title: document.title, nodes: nodes, truncated: truncated };
})()`;
}
/**
* Walk the tab's document and assemble the snapshot.
* @param transport - the tab's protocol transport.
* @param tabId - target tab id.
* @param sessionId - flat session of the tab.
* @param options - limit and a title/url fallback.
* @returns the snapshot plus its ref map.
*/
async function buildSnapshot(transport, tabId, sessionId, options = {}) {
	const limit = options.limit ?? 4e3;
	const value = (await transport.send("Runtime.evaluate", {
		expression: buildSnapshotExpression(limit),
		returnByValue: true
	}, sessionId)).result?.value;
	if (typeof value !== "object" || value === null) throw new Error("the page did not return a readable DOM snapshot");
	const payload = value;
	const raw = Array.isArray(payload.nodes) ? payload.nodes : [];
	const assembled = assembleSnapshot({
		tabId,
		url: typeof payload.url === "string" ? payload.url : options.url ?? "",
		title: typeof payload.title === "string" ? payload.title : options.title ?? "",
		raw,
		limit
	});
	if (payload.truncated === true) assembled.snapshot.truncated = true;
	return assembled;
}
//#endregion
//#region src/host/loopback.ts
/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}
/** Whether a normalized URL hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}
/**
* Whether a reverse proxy stood between the client and this host: the request
* carries CF-Connecting-IP or X-Forwarded-For. Either header is stamped by a
* hop that forwards traffic, so the request did not originate on this machine.
* @param request - node HTTP request.
* @returns true when a forwarding header is present.
*/
function isProxiedRequest(request) {
	return request.headers["cf-connecting-ip"] !== void 0 || request.headers["x-forwarded-for"] !== void 0;
}
/**
* Request-level trust fence: a loopback socket address AND a loopback Host
* header, plus browser same-origin markers. The socket address is
* authoritative for a direct connection; a request that carries a forwarding
* header is refused outright, because a proxy in front of the host makes both
* the socket address and the Host header describe the proxy rather than the
* client. X-Forwarded-For is therefore never evidence *for* loopback.
*/
function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	if (isProxiedRequest(request)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/host/auth.ts
/**
* DSH's own authentication page, and the single launch-token retry a
* navigation to it gets.
*
* A fresh `dsh web` process prints a URL carrying `?token=<launch token>`.
* A request to the site root with that token answers 303 to the clean address
* and sets the `dsh-auth-<authority>` cookie; every later request is served
* from the cookie. A browser profile that never received the token — an
* ephemeral `--user-data-dir`, which is exactly what this plugin launches —
* sees the 401 challenge instead, whose body is the sentence matched here.
*
* The host's connection service can mint that same token for any URL
* (`ctx.connection.authenticatedUrl`), which is what makes the retry possible
* without this package depending on that SDK.
*
* If DSH rewords the challenge, {@link AUTH_CHALLENGE_TEXT} simply stops
* matching: the capability degrades to showing the authentication page exactly
* as before, and no other site's page is ever mistaken for ours.
*
* @module @jimorsm/dsh-client-ui-browser-view/host/auth
*/
/**
* Body text of the page DSH serves when a request carries neither the launch
* token nor a valid cookie. This is the one page the top-up reacts to.
*/
const AUTH_CHALLENGE_TEXT = /dsh web authentication required/i;
/**
* Script that reads the document's visible text. `document.body` is absent on
* a document that has no body yet, and `innerText` needs one.
*/
const DOCUMENT_TEXT_EXPRESSION = "document.body ? document.body.innerText : ''";
/**
* Whether a page's visible text is DSH's authentication challenge.
* @param text - `document.body.innerText` of the page that just loaded.
* @returns true when the document is the challenge rather than a real page.
*/
function isAuthChallengeText(text) {
	return AUTH_CHALLENGE_TEXT.test(text);
}
/**
* Whether a navigation target is one this DSH process serves on loopback: a
* `localhost` name, 127/8, or `[::1]`. A remote site can render any text it
* likes, so only a loopback authority is worth a token retry.
* @param url - the URL a navigation was asked to open.
* @returns true for an absolute http(s) URL naming a loopback authority.
*/
function isLoopbackTarget(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
	return isLoopbackHostname(parsed.hostname);
}
//#endregion
//#region src/core/actions.ts
/** Dispatch one expression in the page and return its plain-JSON value. */
async function evaluateJson(transport, sessionId, expression) {
	const result = await transport.send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true
	}, sessionId);
	if (result.exceptionDetails !== void 0) throw new Error(`the page rejected the script: ${result.exceptionDetails.text ?? "unknown error"}`);
	return result.result?.value;
}
/**
* Scroll the element into view and report its centre point.
* @param transport - the tab's protocol transport.
* @param sessionId - flat session of the tab.
* @param selector - CSS selector resolved by the caller.
* @returns the probe outcome.
*/
async function probeElement(transport, sessionId, selector) {
	const raw = await evaluateJson(transport, sessionId, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return { ok: false, reason: 'no element matches the selector' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim().slice(0, 60);
    return {
      ok: rect.width > 0 && rect.height > 0,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      tag: el.tagName.toLowerCase(),
      name: label,
      reason: rect.width > 0 && rect.height > 0 ? undefined : 'the element has no visible box',
    };
  })()`);
	if (typeof raw !== "object" || raw === null) return {
		ok: false,
		reason: "the page could not describe the element"
	};
	return raw;
}
/** Render `tag "name"` for a trace line, or just the tag. */
function describeProbe(probe) {
	const tag = probe.tag ?? "element";
	const name = probe.name ?? "";
	return name === "" ? tag : `${tag} "${name}"`;
}
/**
* Resolve one element target to a viewport point.
* @param scope - transport and tab manager.
* @param tabId - target tab.
* @param target - ref, selector, or explicit coordinates.
* @returns the point plus the description used in the trace.
*/
async function resolvePoint(scope, tabId, target) {
	if (target.ref !== void 0) {
		const selector = scope.tabs.selectorForRef(tabId, target.ref);
		const probe = await probeElement(scope.transport, scope.tabs.sessionOf(tabId), selector);
		if (probe.ok !== true || probe.x === void 0 || probe.y === void 0) throw new Error(`ref ${target.ref} no longer resolves in the page (${probe.reason ?? "unknown reason"}); call browser_snapshot again`);
		return {
			x: probe.x,
			y: probe.y,
			description: `ref ${target.ref} (${describeProbe(probe)})`
		};
	}
	if (target.selector !== void 0 && target.selector !== "") {
		const probe = await probeElement(scope.transport, scope.tabs.sessionOf(tabId), target.selector);
		if (probe.ok !== true || probe.x === void 0 || probe.y === void 0) throw new Error(`selector "${target.selector}" did not resolve (${probe.reason ?? "unknown reason"})`);
		return {
			x: probe.x,
			y: probe.y,
			description: `${target.selector} (${describeProbe(probe)})`
		};
	}
	if (target.x !== void 0 && target.y !== void 0) return {
		x: target.x,
		y: target.y,
		description: `viewport ${target.x},${target.y}`
	};
	throw new Error("click needs one of: ref (from browser_snapshot), selector, or both x and y");
}
/** Dispatch one trusted click at a viewport point. */
async function clickAt(transport, sessionId, x, y) {
	const base = {
		x,
		y,
		button: "left",
		buttons: 1,
		clickCount: 1,
		modifiers: 0
	};
	await transport.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		button: "none",
		buttons: 0
	}, sessionId);
	await transport.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...base
	}, sessionId);
	await transport.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		...base,
		buttons: 0
	}, sessionId);
}
/**
* Navigate the tab and refresh the panel frame.
* @param scope - transport and tab manager.
* @param tabId - target tab.
* @param url - absolute, `data:`, or `about:` url.
* @returns the action outcome.
*/
async function navigateTo(scope, tabId, url) {
	const tab = await scope.tabs.navigate(tabId, url);
	await scope.tabs.refreshFrame(tabId);
	return {
		tabId,
		summary: `Navigated to ${tab.url === "" ? url : tab.url}`
	};
}
/**
* Click an element or a coordinate.
* @param scope - transport and tab manager.
* @param tabId - target tab.
* @param target - ref, selector, or coordinates.
* @returns the action outcome.
*/
async function clickElement(scope, tabId, target) {
	const point = await resolvePoint(scope, tabId, target);
	await clickAt(scope.transport, scope.tabs.sessionOf(tabId), point.x, point.y);
	await scope.tabs.refreshFrame(tabId);
	return {
		tabId,
		summary: `Clicked ${point.description}`
	};
}
/**
* Type text into the focused element, or into one element first.
* @param scope - transport and tab manager.
* @param tabId - target tab.
* @param text - text to insert.
* @param target - optional element to focus before typing.
* @returns the action outcome.
*/
async function typeText(scope, tabId, text, target = {}) {
	const sessionId = scope.tabs.sessionOf(tabId);
	let where = "the focused element";
	if (target.ref !== void 0 || target.selector !== void 0 && target.selector !== "") {
		const point = await resolvePoint(scope, tabId, target);
		await clickAt(scope.transport, sessionId, point.x, point.y);
		where = point.description;
	}
	await scope.transport.send("Input.insertText", { text }, sessionId);
	await scope.tabs.refreshFrame(tabId);
	const count = [...text].length;
	return {
		tabId,
		summary: `Typed ${count} character${count === 1 ? "" : "s"} into ${where}`
	};
}
/** Keys worth naming; anything else is typed as a literal character. */
const KEYS = {
	Enter: {
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
		text: "\r"
	},
	Tab: {
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9
	},
	Escape: {
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27
	},
	Backspace: {
		key: "Backspace",
		code: "Backspace",
		windowsVirtualKeyCode: 8
	},
	Delete: {
		key: "Delete",
		code: "Delete",
		windowsVirtualKeyCode: 46
	},
	Space: {
		key: " ",
		code: "Space",
		windowsVirtualKeyCode: 32,
		text: " "
	},
	ArrowUp: {
		key: "ArrowUp",
		code: "ArrowUp",
		windowsVirtualKeyCode: 38
	},
	ArrowDown: {
		key: "ArrowDown",
		code: "ArrowDown",
		windowsVirtualKeyCode: 40
	},
	ArrowLeft: {
		key: "ArrowLeft",
		code: "ArrowLeft",
		windowsVirtualKeyCode: 37
	},
	ArrowRight: {
		key: "ArrowRight",
		code: "ArrowRight",
		windowsVirtualKeyCode: 39
	},
	Home: {
		key: "Home",
		code: "Home",
		windowsVirtualKeyCode: 36
	},
	End: {
		key: "End",
		code: "End",
		windowsVirtualKeyCode: 35
	},
	PageUp: {
		key: "PageUp",
		code: "PageUp",
		windowsVirtualKeyCode: 33
	},
	PageDown: {
		key: "PageDown",
		code: "PageDown",
		windowsVirtualKeyCode: 34
	}
};
/**
* Resolve a key name to its dispatch definition.
* @param key - `Enter`, `Tab`, ... or a single character.
* @returns the definition.
*/
function keyDefinition(key) {
	const named = KEYS[key];
	if (named !== void 0) return named;
	if ([...key].length === 1) return {
		key,
		code: `Key${key.toUpperCase()}`,
		windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
		text: key
	};
	throw new Error(`unsupported key "${key}"; use a single character or one of ${Object.keys(KEYS).join(", ")}`);
}
/**
* Press one key on whatever has focus.
* @param scope - transport and tab manager.
* @param tabId - target tab.
* @param key - key name or single character.
* @returns the action outcome.
*/
async function pressKey(scope, tabId, key) {
	const definition = keyDefinition(key);
	const sessionId = scope.tabs.sessionOf(tabId);
	await scope.transport.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: definition.key,
		code: definition.code,
		windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
		nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
		...definition.text === void 0 ? {} : { text: definition.text }
	}, sessionId);
	if (definition.text !== void 0) await scope.transport.send("Input.dispatchKeyEvent", {
		type: "char",
		key: definition.key,
		code: definition.code,
		text: definition.text,
		unmodifiedText: definition.text
	}, sessionId);
	await scope.transport.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: definition.key,
		code: definition.code,
		windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
		nativeVirtualKeyCode: definition.windowsVirtualKeyCode
	}, sessionId);
	await scope.tabs.refreshFrame(tabId);
	return {
		tabId,
		summary: `Pressed ${key}`
	};
}
/**
* Scroll the page with a synthetic wheel event at a viewport point.
* @param scope - transport and tab manager.
* @param tabId - target tab.
* @param delta - horizontal and vertical scroll distance in CSS pixels.
* @returns the action outcome.
*/
async function scrollBy(scope, tabId, delta) {
	const deltaX = Math.round(delta.deltaX ?? 0);
	const deltaY = Math.round(delta.deltaY ?? 0);
	if (deltaX === 0 && deltaY === 0) throw new Error("scroll needs a non-zero deltaY (or deltaX)");
	const x = Math.round(delta.x ?? 640);
	const y = Math.round(delta.y ?? 400);
	await scope.transport.send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x,
		y,
		deltaX,
		deltaY
	}, scope.tabs.sessionOf(tabId));
	await scope.tabs.refreshFrame(tabId);
	const directions = [];
	if (deltaY !== 0) directions.push(`${deltaY > 0 ? "down" : "up"} ${Math.abs(deltaY)} px`);
	if (deltaX !== 0) directions.push(`${deltaX > 0 ? "right" : "left"} ${Math.abs(deltaX)} px`);
	return {
		tabId,
		summary: `Scrolled ${directions.join(" and ")}`
	};
}
//#endregion
//#region src/host/service.ts
/**
* The host-side browser service: one lazy Chrome, one tab per agent session,
* and the fan-out that keeps every attached panel in sync.
*
* Lifecycle. Chrome is not started when the plugin mounts — a plugin that
* launches a browser the moment the GUI loads spends a process on a feature
* nobody has opened. The first tool call or socket attach starts it, and a
* failed start is remembered as a panel message instead of being retried in a
* loop on every keystroke.
*
* Binding. `sessionId -> tabId` is the reason two agents never fight over one
* page: a tool call from session A reuses A's tab, creates one on first use, and
* leaves B's tab alone. Tab ids stay explicit arguments too, so a caller can
* address any open tab on purpose.
*
* Broadcast. Paths, once a socket is attached, are push-only: frames, state
* changes, and action traces go to every attached panel. The service never
* lets one dead socket break the fan-out — a throwing send drops that sink.
*
* @module @jimorsm/dsh-client-ui-browser-view/host/service
*/
/**
* Smallest gap between two frames pushed to the panels, while nobody is
* interacting: about 15 fps. A screencast follows the compositor and reaches
* 60 fps on an animated page, where the picture is worth far less than the
* bandwidth - a heavy page measured 4.4-5.2 MB/s at full rate.
*/
const FRAME_MIN_INTERVAL_MS = 66;
/**
* Smallest gap right after input: about 30 fps. Someone who just clicked is
* watching the result, so the extra frames are bought back for a moment.
*/
const INTERACTIVE_FRAME_INTERVAL_MS = 33;
/** How long one input gesture keeps the interactive frame rate. */
const INTERACTIVE_WINDOW_MS = 3e3;
/**
* Close the tabs a session created, for an attached browser.
*
* An attached browser is the operator's process and profile: dispose closes
* only what the plugin created — the tabs it opened via Target.createTarget
* and its own CDP session — and never kills the browser or touches any
* profile directory. In spawn mode the process kill and profile removal cover
* the targets, so nothing is closed here.
* @param session - the session being torn down.
*/
async function closeSessionTargets(session) {
	if (session.mode !== "attach") return;
	for (const tab of session.tabs.list()) await session.tabs.closeTab(tab.id).catch(() => void 0);
}
/** Start the browser (or attach to one), connect CDP, and wrap both in a session. */
async function openDefaultSession(options) {
	const browser = await resolveBrowserHandle({ viewport: options.viewport });
	let cdp;
	try {
		cdp = await CdpClient.connect(browser.webSocketDebuggerUrl);
	} catch (error) {
		await browser.dispose();
		throw error;
	}
	const tabs = new TabManager({
		transport: cdp,
		jpegQuality: options.jpegQuality,
		viewport: options.viewport,
		onFrame: options.onFrame,
		onTabsChanged: options.onTabsChanged
	});
	return {
		transport: cdp,
		tabs,
		mode: browser.mode,
		chrome: browser.mode === "spawn" ? browser.chrome : void 0,
		async dispose() {
			await closeSessionTargets({
				transport: cdp,
				tabs,
				mode: browser.mode
			});
			await tabs.dispose();
			cdp.close();
			await browser.dispose();
		}
	};
}
/**
* The plugin's single browser service.
*/
var BrowserViewService = class {
	jpegQuality;
	frameFormat;
	captureMax;
	viewport;
	idleFrameIntervalMs;
	interactiveFrameIntervalMs;
	now;
	openSession;
	createRelay;
	authenticatedUrl;
	sinks = /* @__PURE__ */ new Set();
	/** Per-sink WebRTC frame relay; a sink with an open relay receives frames there. */
	relays = /* @__PURE__ */ new Map();
	/**
	* Panels that asked to stop the stream - their tab is not on screen (the
	* sidebar is collapsed or another chip is showing). Nothing is captured,
	* encoded or sent for them while they are in here.
	*/
	paused = /* @__PURE__ */ new Set();
	/**
	* When the last frame reached any panel, for the frame-interval budget.
	* Starts at the beginning of time, not at zero: a clock whose origin is zero
	* (a test clock, or a monotonic counter) would otherwise have its very first
	* frame treated as too soon.
	*/
	lastFrameAt = Number.NEGATIVE_INFINITY;
	/** Until when input keeps the interactive frame rate. */
	interactiveUntil = 0;
	bindings = /* @__PURE__ */ new Map();
	/**
	* Tabs whose one auth top-up for the current navigation is already spent.
	* This is what stops a retry that did not clear the challenge from
	* navigating again; it is reset when the navigation ends.
	*/
	authTopUpSpent = /* @__PURE__ */ new Set();
	session;
	/**
	* The tab the attached panels watch. Kept beside the tab manager instead of
	* read from it because "the page the panel shows" and "the page most recently
	* created" are different facts: a panel that follows the agent must NOT move
	* to a tab an explicit selection pinned it to, while the tab manager still
	* has to know about every tab that exists.
	*/
	displayedTabId = null;
	/**
	* Whether a person chose the watched tab in the panel. Until that happens the
	* panels follow whatever the agent drives; afterwards they never steal it.
	*/
	selectionPinned = false;
	opening;
	openingTab;
	lastError;
	disposed = false;
	/**
	* @param options - quality, viewport, clock, and the browser factory seam.
	*/
	constructor(options = {}) {
		this.jpegQuality = options.jpegQuality ?? 50;
		this.frameFormat = options.frameFormat ?? "webp";
		this.captureMax = options.captureMax ?? {
			width: DEFAULT_CAPTURE_MAX.width,
			height: DEFAULT_CAPTURE_MAX.height
		};
		this.viewport = options.viewport ?? {
			width: DEFAULT_VIEWPORT.width,
			height: DEFAULT_VIEWPORT.height
		};
		this.idleFrameIntervalMs = options.frameIntervalMs?.idle ?? FRAME_MIN_INTERVAL_MS;
		this.interactiveFrameIntervalMs = options.frameIntervalMs?.interactive ?? INTERACTIVE_FRAME_INTERVAL_MS;
		this.now = options.now ?? Date.now;
		this.createRelay = options.createRelay ?? (() => new RtcFrameRelay());
		this.openSession = options.openSession ?? openDefaultSession;
		this.authenticatedUrl = options.authenticatedUrl;
	}
	/** Whether a browser is currently running. */
	get running() {
		return this.session !== void 0;
	}
	/** The current panel-facing state; safe to call before anything started. */
	state() {
		const state = {
			tabs: this.session?.tabs.list() ?? [],
			activeTabId: this.session === void 0 ? null : this.displayedOrDefault(),
			running: this.session !== void 0
		};
		if (this.lastError !== void 0) state.message = this.lastError;
		return state;
	}
	/**
	* Register one panel socket and start the stream it wants.
	* @param sink - socket adapter.
	* @returns the detach function.
	*/
	attach(sink) {
		this.sinks.add(sink);
		sink.send({
			v: 1,
			kind: "hello",
			state: this.state()
		});
		this.startStreaming();
		return () => {
			this.sinks.delete(sink);
			this.paused.delete(sink);
			this.relays.get(sink)?.dispose();
			this.relays.delete(sink);
			if (this.activeSinks().length === 0) this.stopStreaming();
		};
	}
	/**
	* Run one validated panel command.
	* @param sink - the sending socket.
	* @param command - validated command.
	*/
	async handleCommand(sink, command) {
		if (this.disposed) return;
		try {
			switch (command.kind) {
				case "attach":
					this.followPanelSession(command.sessionId);
					sink.send({
						v: 1,
						kind: "hello",
						state: this.state()
					});
					await this.startStreaming();
					return;
				case "select-tab":
					(await this.requireTabs()).selectTab(command.tabId);
					this.selectionPinned = true;
					this.showTab(command.tabId);
					await this.startStreaming();
					return;
				case "request-frame": {
					const tabs = await this.requireTabs();
					const tabId = this.displayedOrDefault();
					if (tabId === null) return;
					this.displayedTabId = tabId;
					await tabs.refreshFrame(tabId);
					return;
				}
				case "close-tab":
					await this.closeTab(command.tabId);
					return;
				case "input": {
					const tabs = await this.requireTabs();
					const tabId = this.displayedOrDefault();
					if (tabId === null) return;
					this.interactiveUntil = this.now() + INTERACTIVE_WINDOW_MS;
					await tabs.dispatchInput(tabId, command.input);
					return;
				}
				case "stream": {
					const others = [...this.sinks].filter((candidate) => candidate !== sink && !this.paused.has(candidate));
					if (command.enabled) {
						this.paused.delete(sink);
						this.startStreaming();
						const session = this.session;
						const tabId = this.displayedOrDefault();
						if (session !== void 0 && tabId !== null) await session.tabs.refreshFrame(tabId).catch(() => void 0);
					} else {
						this.paused.add(sink);
						if (others.length === 0) await this.stopStreaming();
					}
					return;
				}
				case "rtc-offer": {
					this.relays.get(sink)?.dispose();
					const relay = this.createRelay();
					const answer = await relay.acceptOffer(command.sdp, () => {
						this.relays.get(sink) === relay && this.relays.delete(sink);
					});
					this.relays.set(sink, relay);
					sink.send({
						v: 1,
						kind: "rtc-answer",
						sdp: answer
					});
					return;
				}
				default:
			}
		} catch (error) {
			this.fail("command-failed", error);
		}
	}
	/**
	* Close one tab, drop every binding that pointed at it, and let the panels
	* fall back when the tab they were watching is the one that went away.
	*
	* Bindings are forgotten before the target goes, so a later tool call cannot
	* resurrect a tab somebody deliberately closed.
	* @param tabId - tab to close.
	*/
	async closeTab(tabId) {
		const tabs = await this.requireTabs();
		const wasDisplayed = tabId === this.displayedTabId;
		for (const [sessionId, boundTab] of [...this.bindings]) if (boundTab === tabId) this.bindings.delete(sessionId);
		await tabs.closeTab(tabId);
		if (wasDisplayed) {
			this.selectionPinned = false;
			this.displayedTabId = null;
			this.showTab(tabs.list().at(-1)?.id ?? null);
		}
		this.broadcast({
			v: 1,
			kind: "state",
			state: this.state()
		});
	}
	/**
	* Close the tabs one agent session opened, and nothing else.
	*
	* Ownership is read off the tab record rather than the binding map: a session
	* may have driven somebody else's tab through an explicit `tabId`, and that
	* must not make the tab its own to destroy. A caller that names a tab it does
	* not own is refused with the reason instead of being quietly ignored, because
	* a cleanup that reports success while closing nothing is worse than an error.
	*
	* A session with no tab of its own, or a host with no browser running yet,
	* closes nothing and succeeds: cleanup is the one call that must be safe to
	* make unconditionally.
	* @param sessionId - calling agent session; absent means no ownership basis.
	* @param tabId - one tab to close; omitted closes every tab this session owns.
	* @returns ids of the tabs actually closed, in close order.
	*/
	async closeOwnTabs(sessionId, tabId) {
		if (sessionId === void 0) throw new Error("browser_close needs the calling session: with no session there is no tab this call may close");
		if (this.session === void 0) return [];
		const tabs = this.session.tabs;
		if (tabId !== void 0 && tabId !== "") {
			const found = tabs.list().find((tab) => tab.id === tabId);
			if (found === void 0) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`);
			if (found.sessionId !== sessionId) throw new Error(`tab "${tabId}" was not opened by this session, so it is not this session's to close`);
			await this.closeTab(found.id);
			return [found.id];
		}
		const owned = tabs.list().filter((tab) => tab.sessionId === sessionId);
		const closed = [];
		for (const tab of owned) {
			await this.closeTab(tab.id);
			closed.push(tab.id);
		}
		return closed;
	}
	/**
	* Resolve the tab a tool call from `sessionId` should act on.
	*
	* The order is a safety property, not a preference. An agent that lands on
	* the tab the panel happens to be showing destroys whatever the user was
	* looking at, so the watched tab is only ever a last resort:
	*
	* 1. the tab the caller named,
	* 2. the tab this session created or last worked in,
	* 3. the watched tab, but only while no other session owns it,
	* 4. otherwise a tab of its own.
	*
	* Step 3 exists for the case where the user opened a page nobody is driving
	* (they navigated or selected it themselves); step 3's ownership guard is
	* what keeps a bystander session from taking over a page another session
	* owns — the exact way the watched page used to be lost.
	* @param sessionId - calling agent session, when the host provides one.
	* @param tabId - explicit tab from the tool arguments.
	* @returns the tab view.
	*/
	async tabFor(sessionId, tabId) {
		const tabs = await this.requireTabs();
		if (tabId !== void 0 && tabId !== "") {
			const found = tabs.list().find((tab) => tab.id === tabId);
			if (found === void 0) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`);
			if (this.isAttachMode()) this.requireOwnedTab(found, sessionId);
			if (sessionId !== void 0) this.bindings.set(sessionId, found.id);
			this.focusFollowed(found.id);
			return found;
		}
		if (sessionId !== void 0) {
			const bound = this.bindings.get(sessionId);
			if (bound !== void 0) {
				const found = tabs.list().find((tab) => tab.id === bound);
				if (found !== void 0) {
					this.focusFollowed(found.id);
					return found;
				}
				this.bindings.delete(sessionId);
			}
		}
		if (!this.isAttachMode()) {
			const watching = this.displayedOrDefault();
			if (watching !== null) {
				const found = tabs.list().find((tab) => tab.id === watching);
				if (found !== void 0 && !this.ownedByOtherSession(found.id, sessionId)) {
					if (sessionId !== void 0) this.bindings.set(sessionId, found.id);
					this.focusFollowed(found.id);
					return found;
				}
			}
		}
		return await this.ensureTab(sessionId);
	}
	/** Whether the running browser is one the operator owns (attach mode). */
	isAttachMode() {
		return this.session?.mode === "attach";
	}
	/**
	* Enforce the attach-mode target allowlist: a session may only operate a
	* tab it created via Target.createTarget, never a foreign one.
	* @param found - the tab the call named.
	* @param sessionId - the calling session.
	* @throws Error listing the tabs this session may use when the tab is foreign.
	*/
	requireOwnedTab(found, sessionId) {
		if (found.sessionId === sessionId) return;
		const allowed = this.session?.tabs.list().filter((tab) => tab.sessionId === sessionId) ?? [];
		const allowedText = allowed.length === 0 ? "this session has none yet; create one with browser_navigate (new_tab or a fresh session creates one)" : allowed.map((tab) => `"${tab.id}" (${tab.url})`).join(", ");
		throw new Error(`tab "${found.id}" was not opened by this session. Attach mode only allows tabs this session created via the tools; allowed tabs: ${allowedText}`);
	}
	/**
	* Whether a tab is bound to some other session.
	* @param tabId - the tab being considered.
	* @param sessionId - the asking session, which does not count as other.
	* @returns true when another session already drives this tab.
	*/
	ownedByOtherSession(tabId, sessionId) {
		for (const [owner, bound] of this.bindings) if (bound === tabId && owner !== sessionId) return true;
		return false;
	}
	/**
	* Get (or lazily create) the tab bound to one session.
	* @param sessionId - calling agent session.
	* @returns the tab view.
	*/
	async ensureTab(sessionId) {
		const tabs = await this.requireTabs();
		if (sessionId !== void 0) {
			const bound = this.bindings.get(sessionId);
			if (bound !== void 0) {
				const found = tabs.list().find((tab) => tab.id === bound);
				if (found !== void 0) return found;
				this.bindings.delete(sessionId);
			}
		}
		this.openingTab ??= this.createBoundTab(sessionId).finally(() => {
			this.openingTab = void 0;
		});
		return await this.openingTab;
	}
	/** Create a tab, bind it, and make it the one the panel watches. */
	async createBoundTab(sessionId) {
		const tabs = await this.requireTabs();
		const created = await this.openTab(sessionId);
		await tabs.refreshFrame(created.id).catch(() => void 0);
		return created;
	}
	/**
	* Open one additional tab for a session, deliberately without the
	* first-use deduplication {@link ensureTab} applies: asking for a new tab is
	* what the caller wants, so two calls must produce two tabs.
	* @param sessionId - calling agent session.
	* @returns the new tab view, now the session's bound tab and the panel's active one.
	*/
	async openTab(sessionId) {
		const tabs = await this.requireTabs();
		const created = await tabs.createTab({
			url: "about:blank",
			sessionId
		});
		if (sessionId !== void 0) {
			this.bindings.set(sessionId, created.id);
			tabs.bindSession(created.id, sessionId);
		}
		this.focusFollowed(created.id);
		this.broadcast({
			v: 1,
			kind: "state",
			state: this.state()
		});
		return created;
	}
	/**
	* Navigate a tab and trace the action.
	* @param sessionId - calling agent session.
	* @param url - destination.
	* @param tabId - explicit tab, when the caller named one.
	* @param options - `newTab` opens an additional tab instead of reusing one.
	* @returns the action outcome plus the resulting tab view.
	*/
	async navigate(sessionId, url, tabId, options = {}) {
		const tab = options.newTab === true ? await this.openTab(sessionId) : await this.tabFor(sessionId, tabId);
		try {
			const outcome = await navigateTo(this.scope(), tab.id, url);
			await this.topUpAuthTicket(tab.id, url);
			return {
				outcome: this.trace("navigate", outcome),
				tab: this.refreshTab(tab.id)
			};
		} finally {
			this.authTopUpSpent.delete(tab.id);
		}
	}
	/**
	* Give a loopback navigation that landed on DSH's own authentication page
	* one launch-token retry.
	*
	* The token rides the URL, and DSH answers the site root with a 303 to the
	* clean address plus the `dsh-auth-<authority>` cookie, so the retried
	* request is served normally. This is an enhancement, never a dependency: a
	* host that mounts no connection service, a seam that throws, and a page
	* that is still the challenge afterwards all end here without an error and
	* leave the navigation result exactly as it is.
	* @param tabId - tab the navigation ran in.
	* @param url - the URL the caller asked for.
	*/
	async topUpAuthTicket(tabId, url) {
		let ticket = await this.authTicketUrl(tabId, url);
		while (ticket !== void 0) {
			this.authTopUpSpent.add(tabId);
			await navigateTo(this.scope(), tabId, ticket);
			ticket = await this.authTicketUrl(tabId, url);
		}
	}
	/**
	* The ticketed URL for this navigation, or undefined when no retry applies.
	* @param tabId - tab the navigation ran in.
	* @param url - the URL the caller asked for.
	* @returns the URL to retry with, or undefined.
	*/
	async authTicketUrl(tabId, url) {
		if (this.authTopUpSpent.has(tabId)) return void 0;
		const mint = this.authenticatedUrl;
		if (mint === void 0) return void 0;
		if (!isLoopbackTarget(url)) return void 0;
		if (!await this.documentShowsAuthChallenge(tabId)) return void 0;
		try {
			const ticket = mint(url);
			return typeof ticket === "string" && ticket !== "" ? ticket : void 0;
		} catch {
			return;
		}
	}
	/**
	* Whether the tab's current document is DSH's authentication page. Reading
	* the document is best-effort: a tab that refuses the script, or reports
	* something other than text, simply does not match.
	* @param tabId - tab to read.
	* @returns true when the page body is the challenge.
	*/
	async documentShowsAuthChallenge(tabId) {
		try {
			const scope = this.scope();
			const text = (await scope.transport.send("Runtime.evaluate", {
				expression: DOCUMENT_TEXT_EXPRESSION,
				returnByValue: true
			}, scope.tabs.sessionOf(tabId))).result?.value;
			return typeof text === "string" && isAuthChallengeText(text);
		} catch {
			return false;
		}
	}
	/**
	* Click in a tab and trace the action.
	* @param sessionId - calling agent session.
	* @param target - ref, selector, or coordinates.
	* @param tabId - explicit tab.
	* @returns the recorded outcome.
	*/
	async click(sessionId, target, tabId) {
		const tab = await this.tabFor(sessionId, tabId);
		const outcome = await clickElement(this.scope(), tab.id, target);
		return this.trace("click", outcome);
	}
	/**
	* Type into a tab and trace the action.
	* @param sessionId - calling agent session.
	* @param text - text to insert.
	* @param target - optional element to focus first.
	* @param tabId - explicit tab.
	* @returns the recorded outcome.
	*/
	async type(sessionId, text, target = {}, tabId) {
		const tab = await this.tabFor(sessionId, tabId);
		const outcome = await typeText(this.scope(), tab.id, text, target);
		return this.trace("type", outcome);
	}
	/**
	* Press one key and trace the action.
	* @param sessionId - calling agent session.
	* @param key - key name or single character.
	* @param tabId - explicit tab.
	* @returns the recorded outcome.
	*/
	async press(sessionId, key, tabId) {
		const tab = await this.tabFor(sessionId, tabId);
		const outcome = await pressKey(this.scope(), tab.id, key);
		return this.trace("press", outcome);
	}
	/**
	* Scroll a tab and trace the action.
	* @param sessionId - calling agent session.
	* @param delta - scroll distance.
	* @param tabId - explicit tab.
	* @returns the recorded outcome.
	*/
	async scroll(sessionId, delta, tabId) {
		const tab = await this.tabFor(sessionId, tabId);
		const outcome = await scrollBy(this.scope(), tab.id, delta);
		return this.trace("scroll", outcome);
	}
	/**
	* Walk the tab's DOM and remember the ref map for later clicks.
	* @param sessionId - calling agent session.
	* @param tabId - explicit tab.
	* @returns the snapshot the model sees.
	*/
	async snapshot(sessionId, tabId) {
		const tab = await this.tabFor(sessionId, tabId);
		const tabs = await this.requireTabs();
		const result = await buildSnapshot(this.transport(), tab.id, tabs.sessionOf(tab.id), {
			url: tab.url,
			title: tab.title
		});
		tabs.setSnapshotRefs(tab.id, result.refs);
		return result.snapshot;
	}
	/**
	* Capture one JPEG of the tab.
	* @param sessionId - calling agent session.
	* @param tabId - explicit tab.
	* @returns the tab and the base64 JPEG.
	*/
	async screenshot(sessionId, tabId) {
		const tab = await this.tabFor(sessionId, tabId);
		const tabs = await this.requireTabs();
		const data = await tabs.captureScreenshot(tab.id);
		const current = tabs.list().find((candidate) => candidate.id === tab.id) ?? tab;
		return {
			tabId: current.id,
			url: current.url,
			title: current.title,
			data
		};
	}
	/**
	* Console entries of one tab, newest last.
	* @param sessionId - calling agent session.
	* @param limit - maximum trailing entries to return.
	* @param tabId - explicit tab.
	* @returns the entries.
	*/
	async console(sessionId, limit = 100, tabId) {
		const tab = await this.tabFor(sessionId, tabId);
		const entries = (await this.requireTabs()).consoleEntries(tab.id);
		return {
			tabId: tab.id,
			entries: entries.slice(Math.max(0, entries.length - limit))
		};
	}
	/**
	* Network entries of one tab, newest last.
	* @param sessionId - calling agent session.
	* @param limit - maximum trailing entries to return.
	* @param tabId - explicit tab.
	* @returns the entries.
	*/
	async network(sessionId, limit = 100, tabId) {
		const tab = await this.tabFor(sessionId, tabId);
		const entries = (await this.requireTabs()).networkEntries(tab.id);
		return {
			tabId: tab.id,
			entries: entries.slice(Math.max(0, entries.length - limit))
		};
	}
	/** Open tabs, for `browser_tabs`. */
	async listTabs() {
		if (this.session === void 0) return {
			tabs: [],
			activeTabId: null
		};
		return {
			tabs: this.session.tabs.list(),
			activeTabId: this.displayedOrDefault()
		};
	}
	/** Push one event to every attached panel, dropping sockets that fail. */
	broadcast(event) {
		if (event.kind === "frame" && !this.withinFrameBudget()) return;
		for (const sink of [...this.sinks]) {
			if (event.kind === "frame" && this.paused.has(sink)) continue;
			try {
				if (event.kind === "frame") {
					const relay = this.relays.get(sink);
					if (relay !== void 0 && relay.open) {
						if (relay.sendFrame(event.seq, Buffer.from(event.data, "base64"))) continue;
						relay.dispose();
						this.relays.delete(sink);
					}
				}
				sink.send(event);
			} catch {
				this.sinks.delete(sink);
			}
		}
	}
	/**
	* Whether the frame-interval budget admits another frame right now: about
	* 15 fps normally, about 30 fps for a moment after input.
	* @returns true when a frame may go out.
	*/
	withinFrameBudget() {
		const now = this.now();
		const interval = now < this.interactiveUntil ? this.interactiveFrameIntervalMs : this.idleFrameIntervalMs;
		if (now - this.lastFrameAt < interval) return false;
		this.lastFrameAt = now;
		return true;
	}
	/**
	* Tear everything down: stop pushing, stop streaming, close the socket, kill
	* the browser.
	* @returns once every owned resource is released.
	*/
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const sinks = [...this.sinks];
		this.sinks.clear();
		for (const relay of this.relays.values()) relay.dispose();
		this.relays.clear();
		for (const sink of sinks) try {
			sink.close();
		} catch {}
		const session = this.session;
		this.session = void 0;
		this.bindings.clear();
		this.displayedTabId = null;
		this.selectionPinned = false;
		if (session !== void 0) await session.dispose();
	}
	/** The action helpers' collaborator view: one transport, one tab manager. */
	scope() {
		const session = this.session;
		if (session === void 0) throw new Error("the browser is not running");
		return {
			transport: session.transport,
			tabs: session.tabs
		};
	}
	/** The protocol transport of the running session. */
	transport() {
		return this.scope().transport;
	}
	/** Resolve the live session or start one. */
	async requireTabs() {
		return (await this.requireSession()).tabs;
	}
	/** Resolve the live session, starting the browser on first use. */
	async requireSession() {
		if (this.disposed) throw new Error("the browser view service is disposed");
		if (this.session !== void 0) return this.session;
		this.opening ??= this.startSession().finally(() => {
			this.opening = void 0;
		});
		return await this.opening;
	}
	/** Start the browser once, recording failures for the panel. */
	async startSession() {
		try {
			const session = await this.openSession({
				jpegQuality: this.jpegQuality,
				frameFormat: this.frameFormat,
				captureMax: this.captureMax,
				viewport: this.viewport,
				onFrame: (frame) => {
					this.broadcast({
						v: 1,
						kind: "frame",
						...frame
					});
				},
				onTabsChanged: () => {
					this.broadcast({
						v: 1,
						kind: "state",
						state: this.state()
					});
				}
			});
			this.session = session;
			this.lastError = void 0;
			this.broadcast({
				v: 1,
				kind: "state",
				state: this.state()
			});
			return session;
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.broadcast({
				v: 1,
				kind: "error",
				code: "browser-launch-failed",
				message: this.lastError
			});
			throw error;
		}
	}
	/** Start the screencast for the tab the panel watches. */
	activeSinks() {
		return [...this.sinks].filter((sink) => !this.paused.has(sink));
	}
	async startStreaming() {
		const session = this.session;
		if (session === void 0 || this.activeSinks().length === 0) return;
		const tabId = this.displayedOrDefault();
		if (tabId === null) return;
		this.displayedTabId = tabId;
		await session.tabs.startScreencast(tabId).catch((error) => {
			this.fail("screencast-failed", error);
		});
	}
	/** Stop streaming when nobody is watching. */
	async stopStreaming() {
		const session = this.session;
		if (session === void 0) return;
		const tabId = this.displayedOrDefault();
		if (tabId === null) return;
		await session.tabs.stopScreencast(tabId).catch(() => void 0);
	}
	/**
	* The tab the panels currently watch: an explicit choice while that tab
	* still exists, otherwise the newest tab, so a panel is never left pointing
	* at a tab that no longer exists.
	* @returns the watched tab id, or null when nothing is open.
	*/
	displayedOrDefault() {
		const tabs = this.session?.tabs.list() ?? [];
		if (this.displayedTabId !== null && tabs.some((tab) => tab.id === this.displayedTabId)) return this.displayedTabId;
		return tabs.at(-1)?.id ?? null;
	}
	/**
	* Show one tab to the panels and move the screencast with it.
	* @param tabId - the tab to watch, or null when the last one closed.
	*/
	showTab(tabId) {
		if (this.displayedTabId === tabId) {
			this.broadcast({
				v: 1,
				kind: "state",
				state: this.state()
			});
			return;
		}
		const session = this.session;
		const previous = this.displayedTabId;
		this.displayedTabId = tabId;
		if (session !== void 0 && this.sinks.size > 0) {
			if (previous !== null) session.tabs.stopScreencast(previous).catch(() => void 0);
			if (tabId !== null) session.tabs.startScreencast(tabId).catch(() => void 0);
		}
		this.broadcast({
			v: 1,
			kind: "state",
			state: this.state()
		});
	}
	/**
	* Let the panels follow an agent action unless a person pinned a tab.
	* @param tabId - the tab the agent just used.
	*/
	focusFollowed(tabId) {
		if (this.selectionPinned) return;
		this.showTab(tabId);
	}
	/**
	* Show the tab a panel's own session already owns, if it has one.
	*
	* Deliberately creates and binds nothing: an attaching panel observes. A
	* session without a tab keeps following the page the agent is driving.
	* @param sessionId - the session the panel belongs to.
	*/
	followPanelSession(sessionId) {
		const session = this.session;
		if (session === void 0 || sessionId === void 0) return;
		const bound = this.bindings.get(sessionId);
		if (bound === void 0) return;
		const found = session.tabs.list().find((tab) => tab.id === bound);
		if (found !== void 0) this.showTab(found.id);
	}
	/** Broadcast one readable action trace and return it as the tool outcome. */
	trace(tool, outcome) {
		const trace = {
			tool,
			summary: outcome.summary,
			at: this.now()
		};
		this.broadcast({
			v: 1,
			kind: "action",
			trace
		});
		this.broadcast({
			v: 1,
			kind: "state",
			state: this.state()
		});
		return outcome;
	}
	/** Re-read one tab after a navigation changed its url. */
	refreshTab(tabId) {
		const session = this.session;
		if (session === void 0) return {
			id: tabId,
			url: "",
			title: "",
			loading: false
		};
		return session.tabs.list().find((tab) => tab.id === tabId) ?? {
			id: tabId,
			url: "",
			title: "",
			loading: false
		};
	}
	/** Report a failure to the panels without throwing at the caller. */
	fail(code, error) {
		const message = error instanceof Error ? error.message : String(error);
		this.lastError = message;
		this.broadcast({
			v: 1,
			kind: "error",
			code,
			message
		});
	}
};
//#endregion
//#region src/host/cidr.ts
/** Environment variable carrying the comma-separated CIDR list. */
const ALLOWED_CIDRS_ENV = "DSH_BROWSER_VIEW_ALLOWED_CIDRS";
/**
* Environment variable listing the socket ranges a forwarding proxy may sit
* on. Unset or empty keeps the default posture: any request that carries a
* forwarding header is refused outright, no matter which other lists exist.
*/
const TRUSTED_PROXY_CIDRS_ENV = "DSH_BROWSER_VIEW_TRUSTED_PROXY_CIDRS";
/**
* Environment variable carrying the public origin or origins browsers use to
* reach the GUI through the trusted proxy (`https://host:port`, comma
* separated when the GUI answers under several names). Required for the proxy
* path to admit anything: the Host header a proxy rewrites and the Origin
* header a browser sends describe two different authorities, so the
* same-origin rule needs the public ones spelled out, not guessed.
*/
const PUBLIC_ORIGIN_ENV = "DSH_BROWSER_VIEW_PUBLIC_ORIGIN";
/**
* Parse the public-origin environment value: comma-separated origins; an
* empty or unset value is an empty list (the proxy path stays closed).
* Each entry must parse as an absolute URL; the stored form is its normalized
* origin (`scheme://host:port`), so a trailing slash or default port in the
* env never breaks the comparison.
* @param raw - the env value.
* @returns the normalized origins, in order, duplicates collapsed.
* @throws Error naming the offending entry when one is not an absolute URL.
*/
function parsePublicOriginList(raw) {
	if (raw === void 0 || raw.trim() === "") return [];
	const origins = [];
	for (const entry of raw.split(",")) {
		const text = entry.trim();
		if (text === "") continue;
		let parsed;
		try {
			parsed = new URL(text);
		} catch {
			throw new Error(`${PUBLIC_ORIGIN_ENV} entry "${text}" is not an absolute origin like https://host:30082`);
		}
		if (parsed.origin === "null") throw new Error(`${PUBLIC_ORIGIN_ENV} entry "${text}" is not an absolute origin like https://host:30082`);
		if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
	}
	return origins;
}
/**
* Parse one dotted-quad IPv4 address into a 32-bit integer.
* @param text - `a.b.c.d`.
* @returns the integer, or undefined when the octets are not a valid IPv4 address.
*/
function parseIPv4(text) {
	const parts = text.split(".");
	if (parts.length !== 4) return void 0;
	let value = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return void 0;
		const octet = Number(part);
		if (octet > 255) return void 0;
		value = value * 256 + octet;
	}
	return value >>> 0;
}
/**
* Parse one CIDR entry: `a.b.c.d` (host bits implicitly zero) or `a.b.c.d/len`.
* @param text - one entry, surrounding whitespace allowed.
* @returns the range, or undefined when the entry is not valid IPv4 CIDR syntax.
*/
function parseCidr(text) {
	const [addressText, bitsText, extra] = text.trim().split("/");
	if (extra !== void 0) return void 0;
	const address = parseIPv4(addressText ?? "");
	if (address === void 0) return void 0;
	if (bitsText === void 0) return {
		network: address,
		bits: 32
	};
	if (!/^\d{1,2}$/.test(bitsText)) return void 0;
	const bits = Number(bitsText);
	if (bits > 32) return void 0;
	return {
		network: (address & (bits === 0 ? 0 : 4294967295 << 32 - bits >>> 0)) >>> 0,
		bits
	};
}
/**
* Parse the whole environment value: comma-separated entries; an empty or
* unset value is an empty list (default fence).
* @param raw - the env value.
* @returns the parsed ranges, in order.
* @throws Error naming the offending entry when one is not valid CIDR syntax.
*/
function parseCidrList(raw, envName = ALLOWED_CIDRS_ENV) {
	if (raw === void 0 || raw.trim() === "") return [];
	const list = [];
	for (const entry of raw.split(",")) {
		if (entry.trim() === "") continue;
		const parsed = parseCidr(entry);
		if (parsed === void 0) throw new Error(`${envName} entry "${entry.trim()}" is not an IPv4 CIDR range like 192.168.1.0/24`);
		list.push(parsed);
	}
	return list;
}
/**
* Whether one socket remote address falls inside any listed range. An
* IPv4-mapped IPv6 form (`::ffff:192.168.1.7`) is unwrapped first, as the
* loopback fence already does; a pure IPv6 address (::1 included) never
* matches an IPv4 list.
* @param list - the parsed ranges.
* @param address - the socket remote address.
* @returns true when the address is inside a listed range.
*/
function cidrMatches(list, address) {
	if (address === void 0 || list.length === 0) return false;
	const normalized = address.toLowerCase();
	const value = parseIPv4(normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized);
	if (value === void 0) return false;
	return list.some(({ network, bits }) => {
		const mask = bits === 0 ? 0 : 4294967295 << 32 - bits >>> 0;
		return (value & mask) >>> 0 === network;
	});
}
/**
* The CIDR half of the widened fence: same request-level gates as the
* loopback fence, but the socket address must sit inside a listed range
* instead of being loopback. A forwarded request is still refused outright —
* a proxy in front of the host makes the socket address describe the proxy,
* and X-Forwarded-For is never evidence for trust.
* @param request - node HTTP request.
* @param list - the parsed ranges; an empty list admits nothing.
* @returns true when the request may pass on CIDR grounds.
*/
function requestAllowedByCidr(request, list) {
	if (list.length === 0) return false;
	if (isProxiedRequest(request)) return false;
	if (!cidrMatches(list, request.socket.remoteAddress)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/**
* The client address a trusted forwarding proxy vouches for: the last entry
* of `X-Forwarded-For`, which the nearest proxy appends. Only a dotted quad
* qualifies; the lists stay IPv4-only, so a forwarded IPv6 client (or a
* forged non-address) simply does not match.
* @param request - the incoming request.
* @returns the address text, or undefined when no usable IPv4 entry exists.
*/
function forwardedClientAddress(request) {
	const raw = request.headers["x-forwarded-for"];
	if (typeof raw !== "string" || raw.trim() === "") return void 0;
	const entries = raw.split(",");
	const last = entries[entries.length - 1]?.trim();
	if (last === void 0 || last === "") return void 0;
	return parseIPv4(last) === void 0 ? void 0 : last;
}
/**
* The trusted-proxy half of the widened fence: a request that arrives through
* a proxy whose socket address is explicitly listed may name its client via
* `X-Forwarded-For`, and the client address then has to sit inside the
* allowed list. The public origin must be configured and match the Origin
* header, because behind a proxy the rewritten Host header no longer
* describes the authority the browser actually used. Every default stays
* closed: without the trusted list, the allowed list, and the public origin,
* this path admits nothing.
* @param request - the incoming request.
* @param config - the parsed fence configuration.
* @returns true when the forwarded request may pass.
*/
function requestAllowedThroughProxy(request, config) {
	const trusted = config.trustedProxyCidrs ?? [];
	if (trusted.length === 0) return false;
	const publicOrigins = config.publicOrigins ?? [];
	if (publicOrigins.length === 0) return false;
	if (!isProxiedRequest(request)) return false;
	if (!cidrMatches(trusted, request.socket.remoteAddress)) return false;
	const client = forwardedClientAddress(request);
	if (client === void 0 || !cidrMatches(config.allowedCidrs, client)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return false;
	try {
		return publicOrigins.includes(new URL(origin).origin);
	} catch {
		return false;
	}
}
//#endregion
//#region src/host/routes.ts
/** Status route of the family; the panel's fallback probe when the socket fails. */
const BROWSER_VIEW_STATE_PATH = "/api/dsh-browser-view/state";
/** Close code used when the panel speaks a contract version we do not have. */
const PROTOCOL_MISMATCH_CLOSE_CODE = 1002;
/** One noServer WebSocket server: the webserver hands us the raw upgraded socket. */
const browserViewWss = new WebSocketServer({ noServer: true });
/**
* Send one error event to a panel.
* @param sink - the socket adapter.
* @param code - stable machine code.
* @param message - human text, never a stack trace.
*/
function sendError(sink, code, message) {
	const event = {
		v: 1,
		kind: "error",
		code,
		message
	};
	sink.send(event);
}
/**
* Decode one panel frame.
* @param raw - the frame's text.
* @returns the parsed value, or undefined when it is not JSON.
*/
function decodeFrame(raw) {
	try {
		return JSON.parse(raw);
	} catch {
		return;
	}
}
/**
* Run one inbound panel frame through the version and shape gates.
*
* Exported so tests can exercise the gate without a socket: the socket path and
* the gate must not drift apart.
* @param backend - the service that executes accepted commands.
* @param sink - the socket adapter the frame arrived on.
* @param raw - the frame's text.
* @param first - whether this is the socket's first frame.
* @returns what the caller should do next: keep the socket, or close it.
*/
async function handleClientFrame(backend, sink, raw, first) {
	const value = decodeFrame(raw);
	if (value === null || typeof value !== "object") {
		sendError(sink, "invalid-payload", "expected a JSON object");
		return first ? "close" : "accept";
	}
	const version = value.v;
	if (first && version !== 1) {
		sendError(sink, "protocol-mismatch", `unsupported protocol version ${String(version)}; this host speaks version 1`);
		return "close";
	}
	if (version !== 1) {
		sendError(sink, "protocol-mismatch", `unsupported protocol version ${String(version)}; this host speaks version 1`);
		return "accept";
	}
	if (!isBrowserViewCommand(value)) {
		sendError(sink, "invalid-command", `unsupported command ${String(value.kind)}`);
		return "accept";
	}
	await backend.handleCommand(sink, value);
	return "accept";
}
/**
* Adapt one accepted WebSocket to the service's sink contract.
* @param socket - the upgraded socket.
* @returns the sink.
*/
function socketSink(socket) {
	return {
		send(event) {
			if (socket.readyState !== WebSocket.OPEN) return;
			socket.send(JSON.stringify(event));
		},
		close() {
			try {
				socket.close(1e3);
			} catch {}
		}
	};
}
/**
* The request fence of this route family: loopback always, plus the opt-in
* direct CIDR widening, plus the separately opt-in trusted-proxy path.
* @param req - the incoming request.
* @param config - the parsed fence configuration.
* @returns true when the request may be served.
*/
function isRequestFenced(req, config) {
	return isLoopbackRequest(req) || requestAllowedByCidr(req, config.allowedCidrs) || requestAllowedThroughProxy(req, config);
}
/**
* Build the route family and its upgrade.
* @param deps - the backend the socket commands reach.
* @returns exact routes plus the socket upgrade.
*/
function makeRoutes(deps) {
	const { backend } = deps;
	const fence = {
		allowedCidrs: deps.allowedCidrs ?? [],
		trustedProxyCidrs: deps.trustedProxyCidrs ?? [],
		publicOrigins: deps.publicOrigins ?? []
	};
	return {
		routes: [{
			kind: "exact",
			path: BROWSER_VIEW_STATE_PATH,
			handler: (req, res) => {
				if (!isRequestFenced(req, fence)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "GET") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				writeJson(res, 200, { state: backend.state() });
			}
		}],
		upgrade: {
			path: BROWSER_VIEW_SOCKET_PATH,
			handler: (req, socket, head) => {
				if (!isRequestFenced(req, fence)) {
					socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
					socket.destroy();
					return;
				}
				browserViewWss.handleUpgrade(req, socket, head, (accepted) => {
					const sink = socketSink(accepted);
					let first = true;
					const detach = backend.attach(sink);
					accepted.on("message", (data) => {
						const raw = data.toString();
						handleClientFrame(backend, sink, raw, first).then((next) => {
							first = false;
							if (next === "close") try {
								accepted.close(PROTOCOL_MISMATCH_CLOSE_CODE);
							} catch {}
						}).catch(() => {
							sendError(sink, "command-failed", "the host could not run that command");
						});
					});
					accepted.on("close", () => {
						detach();
					});
					accepted.on("error", () => {
						detach();
					});
				});
			}
		}
	};
}
/** Write one JSON response with the shared no-referrer header. */
function writeJson(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"referrer-policy": "no-referrer",
		"content-length": Buffer.byteLength(text)
	});
	res.end(text);
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.6/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Shared config references used by schema validators and plugin runtimes. */
const write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
	if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
	if (value === null || typeof value !== "object") return value;
	if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
		return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
	} finally {
		ancestors.delete(value);
	}
}
/**
* Create a detached reference containing an immutable copy of the supplied data.
* @param value - validated config data; class instances and functions are unsupported.
* @returns a reference whose value is updated only by its owning runtime.
*/
function createVolatile(value) {
	let current = snapshot(value);
	return Object.freeze({
		get: () => current,
		[write]: (value) => {
			current = value;
		}
	});
}
/**
* Identify references across ESM/CJS copies of the shared library.
* @param value - a parsed config value.
* @returns whether the value implements the shared reference protocol.
*/
function isVolatile(value) {
	return typeof value === "object" && value !== null && write in value;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/**
* Compare values recursively, treating two volatile references as equal regardless of value.
* Strict comparison distinguishes null/undefined, treats opaque objects by identity,
* compares URLs by normalized href, treats array holes as undefined, and considers distinct cyclic structures unequal.
* @param a - first value.
* @param b - second value.
* @param strict - whether to require strict data equality outside volatile references.
* @returns whether the values compare equal.
*/
function deepEqual(a, b, strict) {
	const ancestors = /* @__PURE__ */ new Set();
	function compare(a, b) {
		if (a === b) return true;
		if (isVolatile(a) || isVolatile(b)) return isVolatile(a) && isVolatile(b);
		if (!strict && isNullable(a) && isNullable(b)) return true;
		if (typeof a !== typeof b || typeof a !== "object" || !a || !b) return false;
		if (ancestors.has(a)) return false;
		function check(test, then) {
			return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
		}
		ancestors.add(a);
		try {
			return check(Array.isArray, (a, b) => {
				if (a.length !== b.length) return false;
				for (let index = 0; index < a.length; index++) if (!compare(a[index], b[index])) return false;
				return true;
			}) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("URL"), (a, b) => a.href === b.href) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
				if (a.byteLength !== b.byteLength) return false;
				const viewA = new Uint8Array(a);
				const viewB = new Uint8Array(b);
				for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
				return true;
			}) ?? ((!strict || [a, b].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
				...a,
				...b
			}).every((key) => compare(a[key], b[key])));
		} finally {
			ancestors.delete(a);
		}
	}
	return compare(a, b);
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.5/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (isVolatile(value)) value = value.get();
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.volatile = function volatile() {
	if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
	return this.extra("volatile", true);
};
const resolvers = {};
const checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
	const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
	if (states.has(blocked)) return;
	states.add(blocked);
	seen.set(schema, states);
	if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
	const nested = blocked || !!schema.meta?.volatile;
	if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
	if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
	if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
	if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (!options[checkedVolatile]) {
		validateVolatileSchema(schema, options.path);
		options = {
			...options,
			[checkedVolatile]: true
		};
	}
	if (schema.meta?.volatile) {
		const inner = Schema(schema);
		inner.meta = {
			...schema.meta,
			volatile: false
		};
		const [value, adapted] = Schema.resolve(data, inner, options, strict);
		try {
			return [createVolatile(value), adapted];
		} catch (error) {
			throw new ValidationError(error instanceof Error ? error.message : String(error), options);
		}
	}
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
		validateVolatileSchema(schema.inner, options.path, true);
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-scope@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-scope/lib/index.js
/**
* Shared insertion-ordered storage and effect ownership for scope-aware registries.
*
* @module @deepseek-ai/dsh-scope
*/
/**
* Insertion-ordered named entries with caller-owned duplicate diagnostics.
*
* Values are borrowed. Iterators are live within one nonempty table
* generation; draining the table detaches them from later insertions. Each
* successful insertion returns an idempotent undo for that exact entry.
*/
var NamedEntries = class {
	duplicateError;
	data = /* @__PURE__ */ new Map();
	constructor(duplicateError) {
		this.duplicateError = duplicateError;
	}
	/**
	* Insert one unique name.
	* @param name - name unique within this table.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo that removes only this insertion.
	*/
	insert(name, value) {
		const data = this.data;
		if (data.has(name)) throw this.duplicateError(name);
		data.set(name, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(name);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Read one named value.
	* @param name - name to resolve.
	* @returns the retained value, or `undefined` when absent.
	*/
	get(name) {
		return this.data.get(name);
	}
	/**
	* Test one name for membership.
	* @param name - name to test.
	* @returns whether the table contains that name.
	*/
	has(name) {
		return this.data.has(name);
	}
	/**
	* Iterate live names in insertion order.
	* @returns the native live key iterator.
	*/
	keys() {
		return this.data.keys();
	}
	/**
	* Iterate live entries in insertion order.
	* @returns the native live entry iterator.
	*/
	entries() {
		return this.data.entries();
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Insertion-ordered anonymous entries with independent registration identity.
*
* Equal values remain separate registrations. Values are borrowed, and
* iterators are live within one nonempty table generation; draining the table
* detaches them from later appends.
*/
var AnonymousEntries = class {
	data = /* @__PURE__ */ new Map();
	/**
	* Append one independently owned value.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo for this exact append.
	*/
	append(value) {
		const data = this.data;
		const key = Symbol();
		data.set(key, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(key);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Own the global and exact-scope layers for one registry.
*
* Reads never create scoped layers. Registrations derive both visibility and
* effect ownership from the supplied Cordis context, collect undo before
* notification, and reclaim only a completely empty aggregate layer.
*/
var ScopedLayers = class {
	createLayer;
	onChange;
	/** The eagerly constructed context-global layer. */
	global;
	scoped = /* @__PURE__ */ new Map();
	constructor(createLayer, onChange) {
		this.createLayer = createLayer;
		this.onChange = onChange;
		this.global = createLayer(void 0);
	}
	/**
	* Read an existing exact-scope overlay. Deliberately chain-blind: callers
	* addressing one scope's OWN contributions (its restrictions, its guards)
	* must not silently pick up an ancestor's — use {@link chainLayers} where
	* inheritance is the point.
	* @param scope - exact scope key; `undefined` denotes no overlay.
	* @returns the existing scoped layer, or `undefined` without creating one.
	*/
	peek(scope) {
		if (scope === void 0) return void 0;
		return this.scoped.get(scope);
	}
	/**
	* Existing overlays along the scope's parent chain ({@link scopeChainOf}),
	* farthest ancestor first and the exact scope last, so a caller layering
	* them in order gives the nearest scope the final word.
	* @param scope - viewing scope, or `undefined` for no overlays.
	* @returns the existing layers, nearest last; absent overlays are skipped.
	*/
	chainLayers(scope) {
		const layers = [];
		for (const key of scopeChainOf(scope).reverse()) {
			const layer = this.scoped.get(key);
			if (layer !== void 0) layers.push(layer);
		}
		return layers;
	}
	/**
	* Materialize global named entries followed by scope-chain shadows,
	* farthest ancestor first, so the nearest scope's entry wins a name.
	* @param scope - viewing scope, or `undefined` for the global view.
	* @param pick - select the named table from a layer.
	* @returns an insertion-ordered effective map.
	*/
	merge(scope, pick) {
		const merged = new Map(pick(this.global).entries());
		for (const layer of this.chainLayers(scope)) for (const [name, value] of pick(layer).entries()) merged.set(name, value);
		return merged;
	}
	/**
	* Attach one synchronous layer mutation to its registration context.
	* @param ctx - context that determines both scope visibility and effect ownership.
	* @param action - atomic mutation returning its synchronous undo.
	* @param options - Cordis effect label and optional change notification.
	* @returns the exact disposer returned by `ctx.effect()`.
	*/
	effect(ctx, action, options) {
		const scope = scopeOf(ctx);
		const notify = options.notify ?? true;
		return ctx.effect(function* () {
			let layer;
			let created = false;
			if (scope === void 0) layer = this.global;
			else {
				const existing = this.scoped.get(scope);
				if (existing === void 0) {
					layer = this.createLayer(scope);
					this.scoped.set(scope, layer);
					created = true;
				} else layer = existing;
			}
			let undo;
			try {
				undo = action(layer);
			} catch (error) {
				if (scope !== void 0 && created && layer.isEmpty()) this.scoped.delete(scope);
				throw error;
			}
			yield () => {
				undo();
				if (scope !== void 0 && layer.isEmpty()) this.scoped.delete(scope);
				if (notify) this.onChange();
			};
			if (notify) this.onChange();
		}.bind(this), options.label);
	}
};
/**
* Scoped-context primitive: mint a Cordis context that tags registrations with
* an opaque identity and build routing-only event carriers for that identity.
*
* @module @deepseek-ai/dsh-scope
*/
/** Context tag written by {@link createScope}. */
const kScope = Symbol("dsh.scope");
/** The key associated with each carrier. Presence distinguishes an unkeyed carrier from a non-carrier. */
const carrierKeys = /* @__PURE__ */ new WeakMap();
/**
* The enclosing scope of each key. One relation powers both directions of
* scope nesting: registration views inherit DOWN the chain (a child scope
* sees its ancestors' layers — {@link ScopedLayers}), and event admission
* extends UP it (a listener tagged with an ancestor receives events dispatched
* to a descendant key — {@link scopeTarget}).
*/
const scopeParents = /* @__PURE__ */ new WeakMap();
/**
* The chain from a key to its root ancestor.
* @param key - the starting key, or `undefined` for the empty chain.
* @returns keys nearest-first: `[key, parent, grandparent, …]`.
*/
function scopeChainOf(key) {
	const chain = [];
	for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) chain.push(cursor);
	return chain;
}
/**
* Read the nearest scope tag inherited by a context.
* @param ctx - context to inspect.
* @returns its scope key, or `undefined` for an unscoped context.
*/
function scopeOf(ctx) {
	return ctx[kScope];
}
/**
* Build an opaque receiver that preserves the base filter, admits untagged
* listeners globally, and admits tagged listeners for a matching key or any
* of its ancestors ({@link bindScopeParent}): a listener owned by an enclosing
* scope receives every descendant scope's events, which is what lets one
* standing composition observe each of the agents composed under it. A tag
* BELOW the dispatch key stays excluded — events flow up the chain, never
* down.
* @param base - subject or service whose existing Cordis filter is preserved.
* @param key - routed scope identity, or `undefined` for an unscoped subject.
* @returns a carrier whose subject remains available only through event arguments.
*/
function scopeTarget(base, key) {
	const baseFilter = base[Context.filter];
	const carrier = { [Context.filter](ctx) {
		if (baseFilter !== void 0 && !baseFilter.call(base, ctx)) return false;
		const tag = scopeOf(ctx);
		if (tag === void 0) return true;
		for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) if (cursor === tag) return true;
		return false;
	} };
	carrierKeys.set(carrier, key);
	return carrier;
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-typert-protocol@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js
/** The one Remote failure class shared by owners, the Gateway, and consumers. */
/**
* One Remote call failure: a real Error carrying its stable code and typed
* details. Owners throw it at the failure point; the Host Gateway encodes it
* onto the wire unchanged; the Client face rebuilds an instance for the
* `RemoteResult` error branch, so `throw result.error` keeps throw semantics.
* Discrimination is always by `code`, never by instanceof.
*/
var RemoteError = class extends Error {
	code;
	details;
	/** Structural marker: cross-realm/bundle identification never uses instanceof. */
	isDSHRemoteError = true;
	/**
	* @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
	* @param message - human diagnostic carried across the wire.
	* @param details - structured payload typed by the code.
	* @param options - standard Error options (`cause` survives in-process only).
	*/
	constructor(code, message, details, options) {
		super(message, options);
		this.code = code;
		this.details = details;
		this.name = "RemoteError";
	}
};
/**
* Remote decorators and explicit Gateway bindings backed by versioned
* descriptors carried on decorated class prototypes. Strict reflection
* remains a Typert compiler responsibility.
* @module @deepseek-ai/dsh-typert-protocol
*/
const TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/**
* Test one generated Remote name against the Connection endpoint grammar.
* @param value - namespace, method, lookup, or Context segment.
* @returns whether the value can cross the shared RPC carrier unchanged.
*/
function isTypertRemoteSegment(value) {
	return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
/**
* Bind one visible Service field to a Cordis key and Remote namespace. A
* service that owns a Cordis Context also gives its tree `ctx.invocation`,
* `undefined` outside a Remote call, so no `TypertRemoteService` is needed for
* a Host composition to read it.
* @param service - owning Service instance, normally `this`.
* @param serviceKey - exact Cordis service key.
* @param options - optional wire namespace.
* @returns a frozen, inspectable binding with no compiler-injected metadata.
*/
function bindTypertRemote(service, serviceKey, options = {}) {
	validateName("service key", serviceKey);
	const namespace = options.namespace ?? serviceKey;
	validateName("namespace", namespace);
	const ctx = Reflect.get(service, "ctx");
	if (Context.is(ctx)) provideInvocationAccessor(ctx);
	return Object.freeze({
		service,
		serviceKey,
		namespace
	});
}
/** Cordis Service base that exposes its registered name through Typert Gateway. */
var TypertRemoteService = class extends Service {
	/** Visible binding consumed by the Gateway's source-mode discovery. */
	typertRemote;
	/**
	* Register the Service and bind the same key to Typert Gateway.
	* @param ctx - owning Cordis Context.
	* @param serviceKey - exact Cordis service key and default wire namespace.
	* @param options - optional wire namespace.
	*/
	constructor(ctx, serviceKey, options = {}) {
		super(ctx, serviceKey);
		this.typertRemote = bindTypertRemote(this, this.name, options);
	}
};
/**
* Make `ctx.invocation` read as `undefined` outside a Remote call instead of the
* reflect service's "cannot get property" error; a call-derived Context shadows
* the accessor with its own property. The first Remote Service constructed in a
* tree registers it on the root, where it outlives any one Service.
*/
function provideInvocationAccessor(ctx) {
	if (Object.hasOwn(ctx.root.reflect.props, "invocation")) return;
	ctx.root.accessor("invocation", { get: () => void 0 });
}
function Remote(methodExportOrOptions, context) {
	if (typeof methodExportOrOptions === "string") {
		validateName("Remote export name", methodExportOrOptions);
		return remoteDecorator({ kind: "direct" }, { exportName: methodExportOrOptions });
	}
	if (typeof methodExportOrOptions === "object") return remoteDecorator({ kind: "direct" }, markerOptions(methodExportOrOptions, REMOTE_OPTION_KEYS, "Remote options require name, mode: \"stream\", or resources"));
	if (context === void 0) throw new TypeError("typert-protocol: Remote decorator context is missing");
	addMarkerInitializer(context, { kind: "direct" });
}
const REMOTE_OPTION_KEYS = /* @__PURE__ */ new Set([
	"name",
	"mode",
	"resources"
]);
/** Validate one decorator options object against its accepted keys and select the marker fields. */
function markerOptions(options, accepted, requirement) {
	const keys = Reflect.ownKeys(options);
	if (keys.length === 0 || keys.some((key) => typeof key !== "string" || !accepted.has(key)) || Object.hasOwn(options, "mode") && options.mode !== "stream") throw new TypeError(`typert-protocol: ${requirement}`);
	const { mode, name, resources } = options;
	if (name !== void 0) validateName("Remote export name", name);
	return {
		...mode === void 0 ? {} : { mode },
		...name === void 0 ? {} : { exportName: name },
		...resources === void 0 ? {} : { resources: resourceReaders(resources) }
	};
}
/** Freeze declared readers into the marker record; a misdeclared reader fails at decoration. */
function resourceReaders(resources) {
	const readers = {};
	for (const [kind, reader] of Object.entries(resources)) {
		if (typeof reader !== "function") throw new TypeError(`typert-protocol: Remote resource reader "${kind}" must be a function`);
		readers[kind] = reader;
	}
	if (Object.keys(readers).length === 0) throw new TypeError("typert-protocol: Remote resources require at least one reader");
	return Object.freeze(readers);
}
function remoteDecorator(invocation, options = {}) {
	return function(_method, context) {
		addMarkerInitializer(context, invocation, options);
	};
}
function readRemoteMethodDescriptor(prototype) {
	const property = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR);
	if (property === void 0) return void 0;
	const descriptor = property.value;
	if (descriptor === null || typeof descriptor !== "object") throw new TypeError("typert-protocol: Remote method descriptor must be an object");
	const version = Reflect.get(descriptor, "version");
	if (version !== 1) throw new TypeError(`typert-protocol: unsupported Remote method descriptor version ${String(version)}`);
	const methods = Reflect.get(descriptor, "methods");
	if (!Array.isArray(methods)) throw new TypeError("typert-protocol: Remote method descriptor methods must be an array");
	return descriptor;
}
function addMarkerInitializer(context, invocation, options = {}) {
	if (context.private || context.static || typeof context.name !== "string") throw new TypeError("typert-protocol: Remote decorators require a public instance method with a string name");
	const method = context.name;
	context.addInitializer(function() {
		const prototype = Object.getPrototypeOf(this);
		if (prototype === null) throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`);
		mark(prototype, method, invocation, options);
	});
}
function mark(prototype, method, invocation, { mode, exportName, resources }) {
	const descriptor = readRemoteMethodDescriptor(prototype);
	const marker = Object.freeze({
		method,
		...exportName === void 0 || exportName === method ? {} : { exportName },
		...mode === void 0 ? {} : { mode },
		invocation: Object.freeze(invocation),
		...resources === void 0 ? {} : { resources }
	});
	const current = descriptor?.methods.find((candidate) => candidate.method === method);
	if (current !== void 0) {
		if (current.exportName === marker.exportName && current.mode === marker.mode && current.resources === marker.resources && sameInvocation(current.invocation, invocation)) return;
		throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
	}
	Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
		configurable: true,
		value: Object.freeze({
			version: 1,
			methods: Object.freeze([...descriptor?.methods ?? [], marker])
		})
	});
}
function sameInvocation(left, right) {
	if (left.kind === "direct") return right.kind === "direct";
	if (right.kind === "direct") return false;
	return left.context === right.context;
}
function validateName(subject, value) {
	if (!isTypertRemoteSegment(value)) throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-util-values@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-util-values/lib/index.js
/**
* Lazily scanned view of one JSON object's top-level fields, built from text
* that may still be streaming or from an already parsed object. Nothing is
* scanned until a reader asks; the view remembers every question it answered
* and reports changed answers when the owner refreshes for publication.
* Used for model tool-call arguments: a row reads the fields it
* cares about at whatever granularity it displays, at every stage of the call.
* @module @deepseek-ai/dsh-util-values/src/partial-json
*/
const SIMPLE_ESCAPES = {
	"\"": "\"",
	"\\": "\\",
	"/": "/",
	b: "\b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "	"
};
const CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
function isWhitespace(c) {
	return c === " " || c === "\n" || c === "\r" || c === "	";
}
function isHex(c) {
	return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
}
(class PartialArguments {
	/** The view of a call with no arguments available. */
	static EMPTY = PartialArguments.fromObject({});
	/**
	* View finished argument text without scanning it until a reader asks.
	* @param text - the complete argument JSON text.
	* @returns a sealed view.
	*/
	static fromText(text) {
		const view = new PartialArguments();
		view.append(text);
		view.sealed = true;
		return view;
	}
	/**
	* View an already parsed argument payload, such as a PTC dispatch object.
	* @param value - the parsed argument value.
	* @returns a sealed view; a non-object payload has no fields.
	*/
	static fromObject(value) {
		const view = new PartialArguments();
		view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		view.sealed = true;
		return view;
	}
	/**
	* The source: text so far or a parsed object, plus whether it can still grow.
	* These are the only enumerable fields, so two views over the same source
	* compare equal structurally however far each has been read.
	*/
	chunks = [];
	object;
	sealed = false;
	#ends = [];
	#size = 0;
	#consumed = 0;
	#mode = "root";
	#escape = false;
	#keyStart = 0;
	#keyEscaped = false;
	#key = "";
	#current = null;
	#nestedEnds = [];
	#nestedInString = false;
	#invalidAt;
	#invalidValue = false;
	#entries = /* @__PURE__ */ new Map();
	#order = [];
	#reads = /* @__PURE__ */ new Map();
	/** Whether this view rejects further appends; does not scan text or register reads. */
	get isSealed() {
		return this.sealed;
	}
	/** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
	get invalid() {
		this.scan();
		return this.#mode === "invalid" || this.#invalidValue;
	}
	/**
	* Retain streamed argument text without scanning or comparing observed answers.
	* @param fragment - the text following every fragment appended before.
	*/
	append(fragment) {
		if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
		if (fragment.length === 0) return;
		this.chunks.push(fragment);
		this.#size += fragment.length;
		this.#ends.push(this.#size);
	}
	/**
	* Reconcile a streamed prefix with authoritative complete text without joining the fragments.
	* @param text - the final argument text, which replaces missing or conflicting deltas.
	* @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
	*/
	settle(text) {
		if (this.object !== void 0 || text.length !== this.#size) return PartialArguments.fromText(text);
		let offset = 0;
		for (const chunk of this.chunks) {
			if (!text.startsWith(chunk, offset)) return PartialArguments.fromText(text);
			offset += chunk.length;
		}
		this.chunks = text.length === 0 ? [] : [text];
		this.#ends = text.length === 0 ? [] : [text.length];
		this.sealed = true;
		return this;
	}
	/**
	* Compare observed answers and advance their publication baseline. Unread views remain unscanned.
	* @returns whether any observed answer changed since its first read or the preceding refresh.
	*/
	refresh() {
		if (this.#reads.size === 0) return false;
		this.scan();
		let changed = false;
		let completions = false;
		for (const read of this.#reads.values()) {
			if (read.completion) {
				completions = true;
				continue;
			}
			changed = this.refreshRead(read) || changed;
		}
		if (completions) {
			for (const read of this.#reads.values()) if (read.completion) changed = this.refreshRead(read) || changed;
		}
		if (this.sealed) this.#reads.clear();
		return changed;
	}
	refreshRead(read) {
		const now = read.answer();
		if (Object.is(now, read.last)) return false;
		read.last = now;
		return true;
	}
	/**
	* Check whether no further fields can arrive.
	* @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
	*/
	closed() {
		return this.remember("closed", "", () => this.closedNow());
	}
	/**
	* List discovered fields in first-appearance order.
	* @returns top-level keys seen so far, in first-appearance order.
	*/
	keys() {
		return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
	}
	/**
	* Check whether a top-level field has appeared.
	* @param key - argument name.
	* @returns whether the field has appeared (a string opened or another value began).
	*/
	has(key) {
		return this.remember("has", key, () => this.hasNow(key));
	}
	/**
	* Check whether a field's closing delimiter has arrived, without validating its contents.
	* @param key - argument name.
	* @returns whether its delimiter arrived and no content reader has reported an error for this value.
	*/
	complete(key) {
		return this.remember("complete", key, () => this.completeNow(key));
	}
	/**
	* Read string length without materializing its text.
	* @param key - argument name.
	* @param options - change granularity for a streaming string.
	* @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
	*/
	stringLength(key, options) {
		const step = Math.max(1, Math.floor(options?.step ?? 1));
		const offset = options?.offset ?? 0;
		return this.remember(`length:${step}:${offset}`, key, () => this.lengthNow(key), (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step));
	}
	/**
	* Check a string against a decoded UTF-16 length limit without materializing it.
	* @param key - argument name.
	* @param maxLength - decoded UTF-16 limit, floored to at least zero.
	* @returns whether the string is longer than the limit; false when absent or not a string.
	*/
	stringExceeds(key, maxLength) {
		const limit = Math.max(0, Math.floor(maxLength));
		return this.remember(`exceeds:${limit}`, key, () => (this.lengthNow(key, limit + 1) ?? 0) > limit);
	}
	/**
	* Read a decoded string, including a streaming prefix.
	* @param key - argument name.
	* @returns the string field's decoded text so far; undefined when absent or not a string.
	*/
	text(key) {
		return this.remember("text", key, () => this.textNow(key));
	}
	/**
	* Read at most the first decoded UTF-16 units of a string.
	* @param key - argument name.
	* @param maxLength - maximum decoded UTF-16 length, floored to at least one.
	* @returns the bounded string prefix; undefined when absent or not a string.
	*/
	textPrefix(key, maxLength) {
		const limit = Math.max(1, Math.floor(maxLength));
		return this.remember(`prefix:${limit}`, key, () => this.textPrefixNow(key, limit));
	}
	/**
	* Read a completed non-string argument.
	* @param key - argument name.
	* @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
	*/
	value(key) {
		return this.remember("value", key, () => this.valueNow(key));
	}
	/** Answer a question and, on a streaming view, remember it for change detection. */
	remember(kind, key, read, comparison) {
		this.scan();
		const result = read();
		if (!this.sealed) {
			const id = `${kind}/${key}`;
			if (!this.#reads.has(id)) this.#reads.set(id, {
				completion: kind === "complete",
				answer: comparison === void 0 ? read : () => comparison(read()),
				last: comparison === void 0 ? result : comparison(result)
			});
		}
		return result;
	}
	closedNow() {
		return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
	}
	keysNow() {
		return this.object === void 0 ? this.#order : Object.keys(this.object);
	}
	hasNow(key) {
		return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
	}
	completeNow(key) {
		if (this.object !== void 0) return Object.hasOwn(this.object, key);
		const entry = this.#entries.get(key);
		return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
	}
	lengthNow(key, limit = Number.POSITIVE_INFINITY) {
		if (this.object !== void 0) {
			const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
			return typeof field === "string" ? field.length : void 0;
		}
		const entry = this.#entries.get(key);
		if (entry?.kind !== "string") return void 0;
		if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
		const read = entry.length ??= {
			at: entry.start,
			length: 0,
			text: ""
		};
		this.readString(entry, read, limit, false);
		return read.length;
	}
	textNow(key) {
		if (this.object !== void 0) {
			const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
			return typeof field === "string" ? field : void 0;
		}
		const entry = this.#entries.get(key);
		if (entry?.kind !== "string") return void 0;
		if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
			let text;
			try {
				text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
			} catch (_error) {}
			if (text !== void 0) entry.text = {
				at: entry.end,
				length: text.length,
				text
			};
		}
		const read = entry.text ??= {
			at: entry.start,
			length: 0,
			text: ""
		};
		this.readString(entry, read, Number.POSITIVE_INFINITY, true);
		return read.text;
	}
	textPrefixNow(key, maxLength) {
		if (this.object !== void 0) {
			const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
			return typeof field === "string" ? field.slice(0, maxLength) : void 0;
		}
		const entry = this.#entries.get(key);
		if (entry?.kind !== "string") return void 0;
		const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
		let read = prefixes.get(maxLength);
		if (read === void 0) {
			read = {
				at: entry.start,
				length: 0,
				text: ""
			};
			prefixes.set(maxLength, read);
		}
		this.readString(entry, read, maxLength, true);
		return read.text;
	}
	valueNow(key) {
		if (this.object !== void 0) {
			if (!Object.hasOwn(this.object, key)) return void 0;
			const field = this.object[key];
			return typeof field === "string" ? void 0 : field;
		}
		const entry = this.#entries.get(key);
		if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
		if (entry.parsed === void 0) try {
			entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
		} catch (_error) {
			entry.invalid = true;
			this.#invalidValue = true;
		}
		return entry.parsed;
	}
	chunkAt(at) {
		let low = 0;
		let high = this.#ends.length;
		while (low < high) {
			const mid = low + high >>> 1;
			if (this.#ends[mid] <= at) low = mid + 1;
			else high = mid;
		}
		return low;
	}
	/** Materialize only a requested range, never the cumulative source. */
	slice(start, end) {
		if (start >= end) return "";
		const first = this.chunkAt(start);
		const last = this.chunkAt(end - 1);
		const base = first === 0 ? 0 : this.#ends[first - 1];
		if (first === last) return this.chunks[first].slice(start - base, end - base);
		const parts = [this.chunks[first].slice(start - base)];
		for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
		parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
		return parts.join("");
	}
	readString(entry, read, limit, materialize) {
		const end = Math.min(entry.end < 0 ? this.#consumed : entry.end, entry.invalidAt ?? Number.POSITIVE_INFINITY, this.#invalidAt ?? Number.POSITIVE_INFINITY);
		if (!entry.needsDecoding) {
			const length = Math.min(end - read.at, limit - read.length);
			if (length <= 0) return;
			if (materialize) read.text += this.slice(read.at, read.at + length);
			read.at += length;
			read.length += length;
			return;
		}
		let chunkIndex = this.chunkAt(read.at);
		while (read.at < end && read.length < limit) {
			const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
			const chunk = this.chunks[chunkIndex];
			const remaining = chunk.slice(read.at - base, Math.min(chunk.length, end - base));
			const boundary = remaining.search(CONTENT_ESCAPE);
			const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read.length);
			if (length > 0) {
				if (materialize) read.text += remaining.slice(0, length);
				read.at += length;
				read.length += length;
				if (read.at === base + chunk.length) chunkIndex++;
				continue;
			}
			const type = remaining.length > 1 ? remaining[1] : read.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
			let decoded;
			let width = 2;
			if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
			if (remaining[0] === "\\" && type === "u") {
				const hex = this.slice(read.at + 2, Math.min(end, read.at + 6));
				let valid = true;
				for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
				if (valid) {
					if (hex.length < 4 && entry.end < 0) return;
					if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
				}
				width = 6;
			} else if (remaining[0] === "\\" && type !== void 0) decoded = SIMPLE_ESCAPES[type];
			if (decoded === void 0) {
				entry.invalidAt = read.at;
				this.#invalidValue = true;
				return;
			}
			if (materialize) read.text += decoded;
			read.length++;
			read.at += width;
			while (chunkIndex < this.chunks.length && read.at >= this.#ends[chunkIndex]) chunkIndex++;
		}
	}
	/** Locate new field ranges without decoding or parsing their contents. */
	scan() {
		if (this.object !== void 0 || this.#consumed === this.#size) return;
		for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
			const pending = this.chunks[i];
			const base = i === 0 ? 0 : this.#ends[i - 1];
			for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
				if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
					const end = this.stringBoundary(pending, index);
					this.#consumed += end - index;
					index = end;
					if (index === pending.length) break;
				}
				this.step(pending[index], this.#consumed);
				this.#consumed++;
			}
		}
	}
	/** Only raw quotes and their preceding backslash runs can terminate a string. */
	stringBoundary(fragment, start) {
		let at = start;
		while (true) {
			const quote = fragment.indexOf("\"", at);
			const end = quote < 0 ? fragment.length : quote;
			if (this.#mode === "string") {
				const entry = this.#current;
				if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
			}
			let slashStart = end;
			while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
			const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
			this.#escape = quote < 0 && escaped;
			if (quote < 0 || !escaped) return end;
			at = quote + 1;
		}
	}
	step(c, at) {
		switch (this.#mode) {
			case "root":
				if (isWhitespace(c)) return;
				if (c === "{") {
					this.#mode = "key-or-end";
					return;
				}
				this.fail();
				return;
			case "key-or-end":
				if (isWhitespace(c)) return;
				if (c === "}") {
					this.#mode = "closed";
					return;
				}
				if (c === "\"") {
					this.beginKey(at);
					return;
				}
				this.fail();
				return;
			case "key-only":
				if (isWhitespace(c)) return;
				if (c === "\"") {
					this.beginKey(at);
					return;
				}
				this.fail();
				return;
			case "key":
				this.stepKey(c, at);
				return;
			case "colon":
				if (isWhitespace(c)) return;
				if (c === ":") {
					this.#mode = "value";
					return;
				}
				this.fail();
				return;
			case "value":
				this.beginValue(c, at);
				return;
			case "string": {
				const entry = this.#current;
				entry.end = at;
				this.#current = null;
				this.#mode = "comma-or-end";
				return;
			}
			case "scalar":
				this.stepScalar(c, at);
				return;
			case "nested":
				this.stepNested(c, at);
				return;
			case "comma-or-end":
				if (isWhitespace(c)) return;
				if (c === ",") {
					this.#mode = "key-only";
					return;
				}
				if (c === "}") {
					this.#mode = "closed";
					return;
				}
				this.fail();
				return;
			case "closed":
				if (isWhitespace(c)) return;
				this.fail();
				return;
			/* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
			case "invalid": return;
			/* v8 ignore next 2 -- Every scanner mode has a handler above. */
			default: assertNever(this.#mode);
		}
	}
	fail() {
		this.#invalidAt = this.#consumed;
		this.#mode = "invalid";
		this.#current = null;
	}
	beginKey(at) {
		this.#mode = "key";
		this.#keyStart = at + 1;
		this.#keyEscaped = false;
		this.#escape = false;
	}
	stepKey(c, at) {
		if (c < " ") {
			this.fail();
			return;
		}
		if (this.#escape) {
			this.#escape = false;
			return;
		}
		if (c === "\\") {
			this.#escape = true;
			this.#keyEscaped = true;
			return;
		}
		if (c !== "\"") return;
		const raw = this.slice(this.#keyStart, at);
		if (this.#keyEscaped) try {
			this.#key = JSON.parse(`"${raw}"`);
		} catch (_error) {
			this.fail();
			return;
		}
		else this.#key = raw;
		this.#mode = "colon";
	}
	open(entry) {
		if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
		this.#entries.set(this.#key, entry);
		this.#current = entry;
	}
	beginValue(c, at) {
		if (isWhitespace(c)) return;
		if (c === "\"") {
			this.open({
				kind: "string",
				start: at + 1,
				end: -1,
				needsDecoding: false,
				invalidAt: void 0,
				length: void 0,
				text: void 0,
				prefixes: void 0
			});
			this.#escape = false;
			this.#mode = "string";
			return;
		}
		if (c === "}" || c === "," || c === ":" || c === "]") {
			this.fail();
			return;
		}
		this.open({
			kind: "value",
			start: at,
			end: -1,
			parsed: void 0,
			invalid: false
		});
		if (c === "{" || c === "[") {
			this.#mode = "nested";
			this.#nestedEnds = [c === "{" ? "}" : "]"];
			this.#nestedInString = false;
			this.#escape = false;
			return;
		}
		this.#mode = "scalar";
	}
	stepScalar(c, at) {
		if (c !== "," && c !== "}" && !isWhitespace(c)) return;
		this.closeValue(at);
		this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
	}
	stepNested(c, at) {
		if (this.#nestedInString) {
			this.#nestedInString = false;
			return;
		}
		if (c === "\"") {
			this.#nestedInString = true;
			return;
		}
		if (c === "{" || c === "[") {
			this.#nestedEnds.push(c === "{" ? "}" : "]");
			return;
		}
		if (c === "}" || c === "]") {
			if (this.#nestedEnds.pop() !== c) {
				this.fail();
				return;
			}
			if (this.#nestedEnds.length === 0) {
				this.closeValue(at + 1);
				this.#mode = "comma-or-end";
			}
		}
	}
	closeValue(end) {
		const entry = this.#current;
		entry.end = end;
		this.#current = null;
	}
});
/** Duplicate-install-safe JSON and immutable-value helpers. @module @deepseek-ai/dsh-util-values */
/**
* Mark an unreachable closed-union branch.
* @param value - impossible value; an unhandled typed variant fails at the call site.
* @param context - optional switch-site label included in the failure message.
* @returns never; a runtime value that escaped its type always throws.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
/** Whether a realm-owned intrinsic prototype has a native constructor matching this engine's representation. */
function hasIntrinsicConstructor$1(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name === "Array" ? Array : Object);
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype$1(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor$1(value, "Object");
}
/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
function hasPlainArrayPrototype$1(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor$1(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype$1(objectPrototype);
}
/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
function hasPlainObjectPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype$1(prototype);
}
/** Return every JSON-visible object key, or reject own data JSON would discard. */
function enumerableStringKeys(value) {
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
	return keys;
}
/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */
function walkJsonValue(value, detach) {
	const ancestors = /* @__PURE__ */ new Set();
	let root;
	const assign = (destination, item) => {
		if (destination === void 0) return;
		if (destination.kind === "root") root = item;
		else if (destination.kind === "array") destination.target[destination.index] = item;
		else Object.defineProperty(destination.target, destination.key, {
			value: item,
			enumerable: true,
			configurable: true,
			writable: true
		});
	};
	const tasks = [{
		kind: "visit",
		value,
		...detach ? { destination: { kind: "root" } } : {}
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			ancestors.delete(task.source);
			continue;
		}
		if (task.kind === "array-item") {
			if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
			tasks.push({
				kind: "visit",
				value: task.source[task.index],
				...task.target === void 0 ? {} : { destination: {
					kind: "array",
					target: task.target,
					index: task.index
				} }
			});
			continue;
		}
		if (task.kind === "object-property") {
			tasks.push({
				kind: "visit",
				value: task.source[task.key],
				...task.target === void 0 ? {} : { destination: {
					kind: "object",
					target: task.target,
					key: task.key
				} }
			});
			continue;
		}
		const current = task.value;
		if (current === null) {
			assign(task.destination, null);
			continue;
		}
		if (typeof current === "boolean" || typeof current === "string") {
			assign(task.destination, current);
			continue;
		}
		if (typeof current === "number") {
			if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
			assign(task.destination, current);
			continue;
		}
		if (typeof current !== "object") return void 0;
		if (ancestors.has(current)) return void 0;
		if (Array.isArray(current)) {
			if (!hasPlainArrayPrototype$1(current)) return void 0;
			const length = current.length;
			if (Reflect.ownKeys(current).length !== length + 1) return void 0;
			const target = detach ? [] : void 0;
			if (target !== void 0) assign(task.destination, target);
			ancestors.add(current);
			tasks.push({
				kind: "leave",
				source: current
			});
			for (let index = length - 1; index >= 0; index--) tasks.push({
				kind: "array-item",
				source: current,
				index,
				...target === void 0 ? {} : { target }
			});
			continue;
		}
		if (!hasPlainObjectPrototype(current)) return void 0;
		const keys = enumerableStringKeys(current);
		if (keys === void 0) return void 0;
		const target = detach ? {} : void 0;
		if (target !== void 0) assign(task.destination, target);
		ancestors.add(current);
		tasks.push({
			kind: "leave",
			source: current
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) return void 0;
			tasks.push({
				kind: "object-property",
				source: current,
				key,
				...target === void 0 ? {} : { target }
			});
		}
	}
	return detach ? root : true;
}
/**
* Validate and detach lossless JSON in one read per property.
* @param value - candidate value to validate and detach.
* @returns the detached snapshot, or `undefined` when the value is not losslessly JSON-serializable.
*/
function snapshotJsonValue(value) {
	return walkJsonValue(value, true);
}
/**
* Test the same lossless JSON rules as {@link snapshotJsonValue} without detaching the value.
* @param value - candidate value to test.
* @returns whether the value survives a JSON round trip without loss.
*/
function isJsonValue(value) {
	return walkJsonValue(value, false) === true;
}
/**
* Deep-freeze an object graph in place while leaving live AbortSignal objects mutable.
* @param value - value to freeze.
* @returns the same value after every reachable enumerable child is frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-util-crypto@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-util-crypto/lib/index.js
/**
* Random v4 UUID, minted from `crypto.getRandomValues`.
* @returns the UUID string.
*/
function randomUUID() {
	const bytes = globalThis.crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
	const hex = Array.from(bytes, (byte, index) => {
		return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
	}).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-brand@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-brand/lib/index.js
/**
* Duplicate-install-safe nominal primitive helpers.
*
* A brand makes structurally identical strings or numbers non-interchangeable
* at the type level: a `SessionId` cannot be passed where a `ToolCallId` is
* expected, and an event sequence cannot be passed as a log offset. Comparison,
* logging, and serialization retain the underlying primitive behavior.
*
* This package owns no concrete domain value and keeps no runtime identity or mutable
* state, so independently installed copies produce interchangeable values.
*
* @module @deepseek-ai/dsh-brand
*/
/**
* Apply a compile-time string brand without changing the value.
* @param value - string admitted by the domain that owns the target brand.
* @returns the same string with the requested compile-time brand.
*/
function brandString(value) {
	return value;
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-timeout@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-timeout/lib/index.js
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-llm@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-llm/lib/index.js
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return deepFreeze(structuredClone({
		...input,
		id: brandString(randomUUID())
	}));
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
/**
* Harness error base with a stable machine-routable code and chained cause.
* Package errors extend it so tool results and replay can retain failure class.
* @module @deepseek-ai/dsh-llm/error
*/
/**
* Base class for all harness errors. Carries a `code` (stable, programmatic —
* e.g. `NO_ADAPTER`, `INVALID_ARGS`) distinct from the
* human-readable `message`, and supports `cause` chaining via the standard
* `ErrorOptions`. `name` defaults to the subclass constructor name.
*/
var HarnessError = class extends Error {
	/** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
	code;
	constructor(message, code, options) {
		super(message, options);
		this.code = code;
		this.name = new.target.name;
	}
};
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = Schema.object({
	initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = Schema.object({
	mode: Schema.const("normal").required(),
	maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = Schema.object({
	mode: Schema.const("always").required(),
	backoff: backoffSchema
});
Schema.union([normalPolicySchema, alwaysPolicySchema]);
const NORMAL_POLICY_KEYS = /* @__PURE__ */ new Set([
	"mode",
	"maxRetries",
	"retryableCodes",
	"backoff"
]);
const ALWAYS_POLICY_KEYS = /* @__PURE__ */ new Set([
	"mode",
	"maxRetries",
	"retryableCodes",
	"backoff"
]);
const BACKOFF_KEYS = /* @__PURE__ */ new Set([
	"initialDelayMs",
	"maxDelayMs",
	"jitterRatio"
]);
function validateKeys(value, allowed, path) {
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`);
}
function resolveBackoff(config, path) {
	if (config !== void 0) validateKeys(config, BACKOFF_KEYS, path);
	const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
	const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO;
	if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > 2147483647) throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > 2147483647) throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
	if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error(`${path}.jitterRatio must be between 0 and 1`);
	return Object.freeze({
		initialDelayMs,
		maxDelayMs,
		jitterRatio
	});
}
/**
* Validate, default, and detach one provider-owned retry policy.
* @param config - optional provider configuration; omission selects normal defaults.
* @param path - diagnostic path naming the provider config that owns the value.
* @returns an immutable policy safe to capture in provider registration state.
*/
function resolveRetryPolicy(config, path) {
	if (config === void 0) return Object.freeze({
		mode: "normal",
		maxRetries: DEFAULT_MAX_RETRIES,
		retryableCodes: DEFAULT_RETRYABLE_CODES,
		...resolveBackoff(void 0, `${path}.backoff`)
	});
	switch (config.mode) {
		case "normal": {
			validateKeys(config, NORMAL_POLICY_KEYS, path);
			const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
			const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES];
			if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error(`${path}.maxRetries must be a non-negative safe integer`);
			if (retryableCodes.length === 0) throw new Error(`${path}.retryableCodes must not be empty`);
			if (retryableCodes.some((code) => typeof code !== "string" || code.length === 0)) throw new Error(`${path}.retryableCodes must contain only non-empty strings`);
			if (new Set(retryableCodes).size !== retryableCodes.length) throw new Error(`${path}.retryableCodes must not contain duplicates`);
			return Object.freeze({
				mode: "normal",
				maxRetries,
				retryableCodes: Object.freeze([...retryableCodes]),
				...resolveBackoff(config.backoff, `${path}.backoff`)
			});
		}
		case "always":
			validateKeys(config, ALWAYS_POLICY_KEYS, path);
			return Object.freeze({
				mode: "always",
				...resolveBackoff(config.backoff, `${path}.backoff`)
			});
		default: throw new Error(`${path}.mode must be "normal" or "always"`);
	}
}
/**
* Field-wise equality over {@link LlmCallConfig} — the comparison a caller
* runs to decide whether a proposed configuration is a real change (worth a
* logged header snapshot) or the held one restated.
* @param a - one configuration.
* @param b - the other.
* @returns whether every field (including the `stop` list, element-wise) matches.
*/
function callConfigEquals(a, b) {
	if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
	if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
	return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
/**
* Normalization for values thrown by a final LLM adapter boundary.
*
* @module @deepseek-ai/dsh-llm/adapter-failure
*/
/**
* Detach serializable provider facts from a value thrown by an adapter.
* @param value - arbitrary value thrown during adapter dispatch or iteration.
* @returns immutable provider-neutral facts suitable for a terminal finish chunk.
* @internal
*/
function normalizeLlmFailure(value) {
	const error = value instanceof Error ? value : new HarnessError(thrownMessage(value), "UNKNOWN", { cause: value });
	const carried = ownFailureSnapshot(error);
	if (carried !== void 0 && carried.code === ownErrorCode(error)) return carried;
	return Object.freeze({
		message: errorMessage$1(error),
		code: harnessErrorCode(error)
	});
}
/** Render a non-Error throw without letting hostile coercion escape normalization. */
function thrownMessage(value) {
	try {
		const message = String(value);
		return message.length > 0 ? message : "LLM adapter failed";
	} catch (_hostileThrownValue) {
		return "LLM adapter failed";
	}
}
/** Read a foreign error's own data-backed `code` without invoking accessors. */
function ownErrorCode(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "code");
		return descriptor !== void 0 && "value" in descriptor ? descriptor.value : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Snapshot an own data property without invoking an SDK-defined accessor. */
function ownFailureSnapshot(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
		return descriptor !== void 0 && "value" in descriptor ? failureSnapshot(descriptor.value) : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Validate and detach an arbitrary serializable failure payload. */
function failureSnapshot(value) {
	if (typeof value !== "object" || value === null) return void 0;
	try {
		const candidate = value;
		const message = candidate.message;
		const code = candidate.code;
		const status = candidate.status;
		const providerRetryAfterMs = candidate.providerRetryAfterMs;
		const requestId = candidate.requestId;
		const offloadImages = candidate.offloadImages;
		if (typeof message !== "string" || message.length === 0 || typeof code !== "string" || code.length === 0 || status !== void 0 && (!Number.isInteger(status) || status < 100 || status > 599) || providerRetryAfterMs !== void 0 && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0) || requestId !== void 0 && (typeof requestId !== "string" || requestId.length === 0) || offloadImages !== void 0 && (!Number.isSafeInteger(offloadImages) || offloadImages <= 0)) return void 0;
		return Object.freeze({
			message,
			code,
			...status === void 0 ? {} : { status },
			...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
			...requestId === void 0 ? {} : { requestId },
			...offloadImages === void 0 ? {} : { offloadImages }
		});
	} catch (_sdkFailureGetter) {
		return;
	}
}
/** Read an SDK error message without letting an accessor replace the primary failure. */
function errorMessage$1(error) {
	try {
		const message = error.message;
		if (typeof message === "string" && message.length > 0) return message;
	} catch (_sdkMessageGetter) {}
	return "LLM adapter failed";
}
/** Trust only Harness-owned codes; third-party SDK codes are not our taxonomy. */
function harnessErrorCode(error) {
	return error instanceof HarnessError ? error.code : "UNKNOWN";
}
function quoted(value) {
	return JSON.stringify(value);
}
/**
* Stable text shown to a model that cannot accept one durable image reference.
* @param ref - durable normalized attachment omitted from the request.
* @returns deterministic text-only placeholder.
*/
function textOnlyImageText(ref) {
	return `[image omitted because this model accepts text only; attachment sha256:${String(ref.attachmentId).slice(7, 15)}]`;
}
/**
* True when typed model content contains an image block. This is the one image
* walk shared by every image policy (capability gating, text-only
* serialization, compaction survey), so a consumer cannot silently diverge.
* @param content - typed model content blocks.
* @returns whether any block is an image.
*/
function contentHasImage(content) {
	return content.some((block) => block.type === "image");
}
/**
* True when typed model content contains a file block.
* Reads current content on every call without retaining scan results.
* @param content - typed model content blocks.
* @returns whether any block is a file.
*/
function contentHasFile(content) {
	for (const block of content) if (block.type === "file") return true;
	return false;
}
/**
* Stable model-facing handle for one durable file reference: the address of
* the verbatim stored copy and the instruction to read it on demand. This is
* the only representation a provider ever receives for a file.
* @param ref - durable verbatim file reference.
* @param readonlyPath - execution-world path of the stored copy, when resolvable.
* @returns deterministic handle text naming the file, its size, and its address.
*/
function fileHandleText(ref, readonlyPath) {
	const digest = String(ref.attachmentId).slice(7, 15);
	const identity = `File ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest})`;
	if (readonlyPath === void 0) return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`;
	return `[${identity}: verbatim read-only copy saved at ${quoted(readonlyPath)}. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it. When delegating file work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it.]`;
}
/** Replace every file occurrence with handle text. */
function replaceFilesWithHandles(blocks, resolvePath) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "file") {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: fileHandleText(block.attachment, resolvePath(block.attachment))
			});
			continue;
		}
		next?.push(block);
	}
	return next ?? blocks;
}
function projectFilesToText(messages, resolvePath) {
	if (!messages.some((message) => contentHasFile(message.content))) return messages;
	return messages.map((message) => {
		const content = replaceFilesWithHandles(message.content, resolvePath);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
/** Replace every image occurrence for a text-only model. */
function replaceImagesForTextModel(blocks) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "image") {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: textOnlyImageText(block.attachment)
			});
			continue;
		}
		next?.push(block);
	}
	return next ?? blocks;
}
function projectImagesForTextModel(messages) {
	if (!messages.some((message) => contentHasImage(message.content))) return messages;
	return messages.map((message) => {
		const content = replaceImagesForTextModel(message.content);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
function withoutDeveloperMessages(messages) {
	const retained = messages.filter((message) => message.role !== "developer");
	return retained.length === messages.length ? messages : retained;
}
function toolDeclarations(tools, mode, history) {
	const declarations = new Map(history.tools.map((tool) => [tool.name, tool]));
	for (const update of history.updates) for (const tool of update.additions) if (!declarations.has(tool.name)) declarations.set(tool.name, {
		...tool,
		deferLoading: true
	});
	switch (mode) {
		case "in-history": return declarations;
		case "addition-only": {
			const activeNames = new Set(tools?.map((tool) => tool.name));
			for (const name of declarations.keys()) if (!activeNames.has(name)) declarations.delete(name);
			return declarations;
		}
		/* v8 ignore next 2 -- closed-union exhaustiveness guard */
		default: return assertNever(mode);
	}
}
/**
* Construct provider declarations from session-folded history without changing logged active tools.
* Unsupported routes and incomplete history use current declarations without developer updates.
* Explicitly deferred baseline tools become available only after their first retained addition.
* @param messages - complete request inputs, or the prefix selected for an auxiliary call.
* @param tools - currently active tool schemas.
* @param toolUpdate - the resolved route's update mode.
* @param history - immutable state folded from committed headers and developer messages.
* @returns provider declarations and the corresponding filtered history.
*/
function projectToolUpdates(messages, tools, toolUpdate, history) {
	if (toolUpdate === void 0) {
		let immediateTools = tools;
		if (tools?.some((tool) => tool.deferLoading === true)) immediateTools = tools.map(({ deferLoading: _loading, ...tool }) => tool);
		return {
			messages: withoutDeveloperMessages(messages),
			tools: immediateTools
		};
	}
	if (history === void 0) return {
		messages: withoutDeveloperMessages(messages),
		tools
	};
	const messageIds = new Set(messages.flatMap((message) => message.role === "developer" ? [message.id] : []));
	if (history.updates.some((update) => !messageIds.has(update.messageId))) return {
		messages: withoutDeveloperMessages(messages),
		tools
	};
	const declarations = toolDeclarations(tools, toolUpdate, history);
	const updateIds = new Set(history.updates.map((update) => update.messageId));
	const offered = new Set(history.tools.filter((tool) => !tool.deferLoading).map((tool) => tool.name));
	const projectedMessages = [];
	for (const message of messages) {
		if (message.role !== "developer") {
			projectedMessages.push(message);
			continue;
		}
		if (!updateIds.has(message.id)) continue;
		const content = message.content.filter((block) => {
			switch (block.type) {
				case "tool-addition":
					if (!declarations.has(block.toolName) || offered.has(block.toolName)) return false;
					offered.add(block.toolName);
					return true;
				case "tool-removal":
					if (toolUpdate !== "in-history") return false;
					return offered.delete(block.toolName);
				default: return true;
			}
		});
		if (content.length === 0) continue;
		if (content.length === message.content.length) projectedMessages.push(message);
		else projectedMessages.push({
			...message,
			content
		});
	}
	return {
		messages: projectedMessages.length === messages.length && projectedMessages.every((message, index) => message === messages[index]) ? messages : projectedMessages,
		tools: [...declarations.values()]
	};
}
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `docs/subsystems/llm-streaming.md#appidentity--app-attribution`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
/**
* LLM service: adapter registry with a waterfall-interceptable streaming call
* API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
* provider backends, and `BlockAssembler` for chunk assembly.
*
* @module @deepseek-ai/dsh-llm
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/**
* Typed error for LLM-related failures. Extends {@link HarnessError}, so the
* `code` string (e.g. `AUTH`, `RATE_LIMIT`, `NO_ADAPTER`) is shared taxonomy.
*/
var LlmError = class extends HarnessError {
	/** Serializable facts retained beside this live Error. */
	failure;
	/**
	* @param message - non-empty human-readable failure summary.
	* @param code - non-empty stable provider-neutral machine code.
	* @param options - optional cause and validated serializable provider facts.
	*/
	constructor(message, code, options) {
		if (typeof message !== "string" || message.length === 0) throw new Error("LlmError message must be a non-empty string");
		if (typeof code !== "string" || code.length === 0) throw new Error("LlmError code must be a non-empty string");
		if (options?.status !== void 0 && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) throw new Error("LlmError status must be an integer from 100 through 599");
		if (options?.providerRetryAfterMs !== void 0 && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) throw new Error("LlmError providerRetryAfterMs must be a positive finite number");
		if (options?.requestId !== void 0 && (typeof options.requestId !== "string" || options.requestId.length === 0)) throw new Error("LlmError requestId must be a non-empty string");
		super(message, code, options);
		this.name = "LlmError";
		this.failure = Object.freeze({
			message,
			code,
			...options?.status === void 0 ? {} : { status: options.status },
			...options?.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
			...options?.requestId === void 0 ? {} : { requestId: options.requestId },
			...options?.offloadImages === void 0 ? {} : { offloadImages: options.offloadImages }
		});
	}
};
(() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _listProviders_decorators;
	let _listConfigurableProviders_decorators;
	let _remoteDiscoverModels_decorators;
	return class LlmRuntime extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_listProviders_decorators = [Remote];
			_listConfigurableProviders_decorators = [Remote];
			_remoteDiscoverModels_decorators = [Remote("discoverModels")];
			__esDecorate(this, null, _listProviders_decorators, {
				kind: "method",
				name: "listProviders",
				static: false,
				private: false,
				access: {
					has: (obj) => "listProviders" in obj,
					get: (obj) => obj.listProviders
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _listConfigurableProviders_decorators, {
				kind: "method",
				name: "listConfigurableProviders",
				static: false,
				private: false,
				access: {
					has: (obj) => "listConfigurableProviders" in obj,
					get: (obj) => obj.listConfigurableProviders
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteDiscoverModels_decorators, {
				kind: "method",
				name: "remoteDiscoverModels",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteDiscoverModels" in obj,
					get: (obj) => obj.remoteDiscoverModels
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		adapters = (__runInitializers(this, _instanceExtraInitializers), /* @__PURE__ */ new Map());
		directory = /* @__PURE__ */ new Map();
		discoveries = /* @__PURE__ */ new Map();
		constructor(ctx) {
			super(ctx, "llm");
		}
		/** Notify topology observers without letting one broken listener veto the commit. */
		emitAdaptersUpdated() {
			for (const listener of this.ctx.events.dispatch("emit", ["llm/adapters-updated"])) try {
				const returned = listener();
				if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
					this.warnAdaptersListenerFailure(error);
				});
			} catch (error) {
				this.warnAdaptersListenerFailure(error);
			}
		}
		/** Contained-listener diagnostic shared by the sync and async failure paths. */
		warnAdaptersListenerFailure(error) {
			this.ctx.logger.warn("llm: an llm/adapters-updated listener failed");
			this.ctx.logger.warn(error);
		}
		/**
		* Register an adapter for the given provider routes. Throws `LlmError` with code
		* `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
		* Disposed with the fiber.
		* @param providers - every provider route this adapter should serve.
		* @param adapter - the adapter that streams calls for those providers.
		* @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
		*/
		registerAdapter(providers, adapter) {
			const owned = /* @__PURE__ */ new Set();
			let released = false;
			const dispose = this.ctx.effect(function* () {
				if (providers.length === 0) throw new LlmError("an adapter must register at least one provider", "INVALID_ADAPTER");
				this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned));
				yield () => {
					released = true;
					for (const provider of owned) this.adapters.delete(provider);
					owned.clear();
					this.emitAdaptersUpdated();
				};
			}.bind(this), "llm.registerAdapter()");
			const handle = (() => void dispose());
			handle.replace = (next) => {
				if (released) throw new LlmError("a disposed adapter registration cannot replace its routes", "REGISTRATION_DISPOSED");
				this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned));
			};
			return handle;
		}
		/**
		* Validate one candidate route set for `adapter`, treating routes this
		* registration already holds as available. Nothing is mutated: a rejected
		* candidate leaves the registry exactly as it was.
		*/
		prepareRoutes(providers, adapter, owned) {
			const unique = /* @__PURE__ */ new Set();
			const registrations = [];
			for (const provider of providers) {
				if (provider.length === 0) throw new LlmError("adapter provider names must be non-empty", "INVALID_ADAPTER");
				if (unique.has(provider) || this.adapters.has(provider) && !owned.has(provider)) throw new LlmError(`an adapter for provider "${provider}" is already registered`, "DUPLICATE_ADAPTER");
				const info = adapter.providerInfo(provider);
				if (typeof info.id !== "string" || info.id !== provider || typeof info.name !== "string" || info.name.length === 0) throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, "INVALID_ADAPTER");
				unique.add(provider);
				const retryPolicy = adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(void 0, `llm: provider "${provider}" retryPolicy`);
				registrations.push({
					adapter,
					provider: {
						id: info.id,
						name: info.name
					},
					retryPolicy
				});
			}
			return registrations;
		}
		/**
		* Swap this registration's routes for the prepared ones in one synchronous
		* section, so no observer can see the registry between the release and the
		* re-registration. The route set's one mutation point is also where
		* `llm/adapters-updated` is published, so a `replace` announces itself
		* exactly like a first registration.
		*/
		commitRoutes(owned, registrations) {
			for (const provider of owned) this.adapters.delete(provider);
			owned.clear();
			for (const registration of registrations) {
				this.adapters.set(registration.provider.id, registration);
				owned.add(registration.provider.id);
			}
			this.emitAdaptersUpdated();
		}
		/**
		* Describe provider routes with a registered adapter.
		* @returns detached provider metadata in registration order.
		*/
		listProviders() {
			return [...this.adapters.values()].map(({ provider }) => ({ ...provider }));
		}
		/**
		* Declare provider routes an adapter plugin can activate through
		* configuration. Registration is all-or-nothing: an empty list, invalid
		* entry, or a provider already declared by any registration throws
		* `LlmError` without registering the rest. Disposed with the fiber.
		* @param entries - every configurable provider this plugin owns.
		* @returns a handle that withdraws all of them, and can atomically replace them.
		*/
		registerConfigurableProviders(entries) {
			let held = [];
			let disposed = false;
			/**
			* Validate a candidate set in full against everything this registration
			* does not already hold, then publish it. Nothing is written until the
			* whole set passes, so a refused candidate leaves the current entries in
			* place — the property that makes `replace` a swap rather than a
			* delete-then-add that can strand the directory empty.
			*/
			const commit = (candidates) => {
				const detached = [];
				const own = new Set(held.map((entry) => entry.provider));
				for (const entry of candidates) {
					if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) throw new LlmError("configurable providers need a non-empty provider, displayName, and settingsNs", "INVALID_DIRECTORY");
					if (entry.settingsPath.some((segment) => segment.length === 0)) throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, "INVALID_DIRECTORY");
					if (this.directory.has(entry.provider) && !own.has(entry.provider) || detached.some((seen) => seen.provider === entry.provider)) throw new LlmError(`configurable provider "${entry.provider}" is already declared`, "DUPLICATE_DIRECTORY");
					detached.push(detachDirectoryEntry(entry));
				}
				for (const entry of held) this.directory.delete(entry.provider);
				for (const entry of detached) this.directory.set(entry.provider, entry);
				held = detached;
				this.emitAdaptersUpdated();
			};
			const dispose = this.ctx.effect(function* () {
				if (entries.length === 0) throw new LlmError("a configurable-provider registration must declare at least one provider", "INVALID_DIRECTORY");
				commit(entries);
				yield () => {
					disposed = true;
					for (const entry of held) this.directory.delete(entry.provider);
					held = [];
					this.emitAdaptersUpdated();
				};
			}.bind(this), "llm.registerConfigurableProviders()");
			const handle = (() => void dispose());
			handle.replace = (next) => {
				if (disposed) throw new LlmError("this configurable-provider registration was disposed", "REGISTRATION_DISPOSED");
				commit(next);
			};
			return handle;
		}
		/**
		* List every declared configurable provider, registered or dormant.
		* @returns detached directory entries in declaration order.
		*/
		listConfigurableProviders() {
			return [...this.directory.values()].map(detachDirectoryEntry);
		}
		/**
		* Offer to interrogate provider endpoints on behalf of the settings
		* namespace this plugin owns. The namespace is the key because that is what
		* a configuration surface already holds from the configurable-provider
		* directory, and because a provider being *added* has no route to name yet.
		* Disposed with the fiber.
		* @param settingsNs - the namespace whose profiles this discovery serves.
		* @param discover - interrogates one endpoint and must honor the supplied signal.
		* @returns the disposer that withdraws the offer.
		*/
		registerModelDiscovery(settingsNs, discover) {
			const dispose = this.ctx.effect(function* () {
				if (settingsNs.length === 0) throw new LlmError("model discovery needs a non-empty settings namespace", "INVALID_DISCOVERY");
				if (this.discoveries.has(settingsNs)) throw new LlmError(`model discovery for "${settingsNs}" is already registered`, "DUPLICATE_DISCOVERY");
				this.discoveries.set(settingsNs, discover);
				yield () => {
					this.discoveries.delete(settingsNs);
				};
			}.bind(this), "llm.registerModelDiscovery()");
			return () => void dispose();
		}
		/**
		* Interrogate one provider endpoint for the models it advertises. The
		* request describes a draft, not a stored route, so nothing here reads or
		* writes settings or credentials — the caller owns both, and the reply is
		* candidate metadata a surface may offer for adoption.
		* @param settingsNs - namespace whose registered discovery serves this draft.
		* @param request - the endpoint, protocol, and one-shot credential to use.
		* @param signal - caller cancellation.
		* @returns the advertised models, deduplicated in endpoint order.
		*/
		async discoverModels(settingsNs, request, signal) {
			const discover = this.discoveries.get(settingsNs);
			if (discover === void 0) throw new LlmError(`no model discovery is registered for "${settingsNs}"`, "NO_DISCOVERY");
			if ((request.provider ?? "").length === 0 && (request.baseURL ?? "").length === 0) throw new LlmError("model discovery needs a provider route or a baseURL", "INVALID_DISCOVERY");
			const discovered = signal === void 0 ? await discover(request) : await discover(request, signal);
			const seen = /* @__PURE__ */ new Set();
			const models = [];
			for (const model of discovered) {
				if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
				seen.add(model.id);
				models.push({
					id: model.id,
					...model.name === void 0 ? {} : { name: model.name },
					...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
					...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
					...model.inputModalities === void 0 ? {} : { inputModalities: [...model.inputModalities] }
				});
			}
			return models;
		}
		/**
		* Remote adapter for one draft provider interrogation.
		* @param settingsNs - namespace whose registered discovery serves this draft.
		* @param request - endpoint, protocol, and one-shot credential to use.
		* @param signal - caller cancellation supplied by the Remote carrier.
		* @returns advertised models in endpoint order.
		* @throws RemoteError with `llm/model-discovery-rejected` when discovery refuses or fails.
		*/
		async remoteDiscoverModels(settingsNs, request, signal) {
			try {
				return await this.discoverModels(settingsNs, request, signal);
			} catch (error) {
				throw new RemoteError("llm/model-discovery-rejected", error instanceof Error ? error.message : String(error), {
					settingsNs,
					...request.baseURL === void 0 ? {} : { baseURL: request.baseURL }
				}, { cause: error });
			}
		}
		/**
		* Resolve the retry policy captured when one provider route was registered.
		* @param provider - registered provider route to inspect.
		* @returns the provider-owned policy, with normal defaults already resolved.
		*/
		providerRetryPolicy(provider) {
			return this.registration(provider).retryPolicy;
		}
		/**
		* Resolve provider-side request-image pricing for one exact route, or
		* `undefined` when the provider is unregistered or declares none. Unknown
		* providers degrade to `undefined` rather than throwing because callers
		* price durable history whose route may no longer be mounted.
		* @param provider - provider route named by a request header.
		* @param model - exact model id named by the same header.
		* @returns the owning adapter's image pricing for the route, when declared.
		*/
		imageRequestPricing(provider, model) {
			return this.adapters.get(provider)?.adapter.imageRequestPricing(provider, model);
		}
		/**
		* Resolve the image projection for an exact registered model route.
		* @param provider - registered provider route.
		* @param model - exact model id.
		* @param image - normalized image reference.
		* @returns dimensions and byte target used by the adapter's request serializer.
		*/
		imageRequestTarget(provider, model, image) {
			return this.registration(provider).adapter.imageRequestTarget(provider, model, image);
		}
		/**
		* Resolve the exact text one durable file occurrence contributes to every
		* provider request in the current execution environment.
		* @param ref - durable verbatim file reference from model history.
		* @returns the same deterministic handle text used at adapter dispatch.
		*/
		fileRequestText(ref) {
			return fileHandleText(ref, this.fileReadPath(ref));
		}
		/** Detach typed adapter-owned modality metadata. */
		detachedModalities(modalities) {
			return modalities === void 0 ? void 0 : [...modalities];
		}
		/**
		* Discover models advertised by one registered provider. Catalog membership
		* does not constrain core routing. Catalog-driven entry points may restrict
		* selection and submission to the advertised models.
		* @param provider - registered provider route to inspect.
		* @returns detached model metadata in adapter-preferred order.
		*/
		async listModels(provider) {
			const models = await this.registration(provider).adapter.listModels(provider);
			const seen = /* @__PURE__ */ new Set();
			return models.map((model) => {
				if (typeof model.provider !== "string" || model.provider !== provider || typeof model.id !== "string" || model.id.length === 0 || typeof model.name !== "string" || model.name.length === 0 || model.description !== void 0 && typeof model.description !== "string" || seen.has(model.id)) throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, "INVALID_CATALOG");
				seen.add(model.id);
				const inputModalities = this.detachedModalities(model.inputModalities);
				return {
					provider: model.provider,
					id: model.id,
					name: model.name,
					...model.description === void 0 ? {} : { description: model.description },
					...inputModalities === void 0 ? {} : { inputModalities }
				};
			});
		}
		/**
		* Resolve and validate all metadata from the adapter that owns one exact
		* route. The result is detached from adapter-owned objects; catalog
		* membership remains advisory and does not control request routing.
		* @param provider - registered provider route to inspect.
		* @param model - exact model id passed to the adapter.
		* @param signal - optional cancellation for adapter-owned asynchronous lookup.
		* @returns exact model identity plus available context and reasoning metadata.
		*/
		async resolveModelInfo(provider, model, signal) {
			return this.resolveModelInfoFor(this.registration(provider), model, signal);
		}
		async resolveModelInfoFor(registration, model, signal) {
			const resolved = await registration.adapter.resolveModel(registration.provider.id, model, signal);
			return this.normalizeModelInfo(registration, model, resolved);
		}
		/** Validate and detach one adapter-returned exact model result. */
		normalizeModelInfo(registration, model, resolved) {
			const provider = registration.provider.id;
			if (typeof resolved.provider !== "string" || resolved.provider !== provider || typeof resolved.id !== "string" || resolved.id !== model || typeof resolved.name !== "string" || resolved.name.length === 0 || resolved.description !== void 0 && typeof resolved.description !== "string") throw new LlmError(`adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
			const context = resolved.context;
			if (context !== void 0 && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) throw new LlmError(`adapter returned invalid context metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_CONTEXT");
			const inputModalities = this.detachedModalities(resolved.inputModalities);
			const systemPromptUpdate = resolved.systemPromptUpdate;
			if (systemPromptUpdate !== void 0 && systemPromptUpdate !== "in-history") throw new LlmError(`adapter returned invalid system prompt update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
			const toolUpdate = resolved.toolUpdate;
			if (toolUpdate !== void 0 && toolUpdate !== "in-history" && toolUpdate !== "addition-only") throw new LlmError(`adapter returned invalid tool update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
			const defaultMaxTokens = resolved.defaultMaxTokens;
			if (defaultMaxTokens !== void 0 && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) throw new LlmError(`adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`, "INVALID_MODEL_MAX_TOKENS");
			const info = {
				provider,
				id: model,
				name: resolved.name,
				...resolved.description === void 0 ? {} : { description: resolved.description },
				...inputModalities === void 0 ? {} : { inputModalities },
				...context === void 0 ? {} : { context: { contextWindow: context.contextWindow } },
				...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
				...resolved.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: resolved.systemPromptUpdate },
				...resolved.toolUpdate === void 0 ? {} : { toolUpdate: resolved.toolUpdate }
			};
			const reasoning = resolved.reasoning;
			if (reasoning === void 0) return info;
			if (reasoning.efforts.length === 0) throw new LlmError(`adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
			const seen = /* @__PURE__ */ new Set();
			const efforts = reasoning.efforts.map((effort) => {
				if (typeof effort.id !== "string" || effort.id.length === 0 || typeof effort.name !== "string" || effort.name.length === 0 || effort.description !== void 0 && typeof effort.description !== "string" || seen.has(effort.id)) throw new LlmError(`adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
				seen.add(effort.id);
				return {
					id: effort.id,
					name: effort.name,
					...effort.description === void 0 ? {} : { description: effort.description }
				};
			});
			if (reasoning.defaultEffort !== void 0 && !seen.has(reasoning.defaultEffort)) throw new LlmError(`adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
			return {
				...info,
				reasoning: {
					efforts,
					...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
				}
			};
		}
		/**
		* Validate a conversation call config against its exact model capability and
		* materialize adapter-configured defaults. Unsupported explicit efforts
		* reject before provider I/O; no clamping or aliasing is performed. This
		* standalone query does not bind a later dispatch; use {@link prepareCall}
		* when logging and streaming must share one adapter registration.
		* @param config - provider/model route and optional request controls.
		* @param signal - optional cancellation for adapter-owned capability lookup.
		* @returns a detached config only when a default must be materialized.
		*/
		async resolveCallConfig(config, signal) {
			return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
		}
		async resolveCallFor(registration, config, signal) {
			const info = await this.resolveModelInfoFor(registration, config.model, signal);
			return this.resolveCallWithInfo(config, info);
		}
		/** Validate request controls against one already-bound exact model result. */
		resolveCallWithInfo(config, info) {
			const defaulted = config.maxTokens === void 0 && info.defaultMaxTokens !== void 0 ? {
				...config,
				maxTokens: info.defaultMaxTokens
			} : config;
			const reasoning = info.reasoning;
			const requested = defaulted.reasoningEffort;
			let resolvedConfig = defaulted;
			if (reasoning === void 0) {
				if (requested !== void 0) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`, "UNSUPPORTED_REASONING_EFFORT");
			} else {
				const effective = requested ?? reasoning.defaultEffort;
				if (effective !== void 0) {
					if (!reasoning.efforts.some((effort) => effort.id === effective)) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`, "UNSUPPORTED_REASONING_EFFORT");
					if (requested !== effective) resolvedConfig = {
						...defaulted,
						reasoningEffort: effective
					};
				}
			}
			return {
				config: resolvedConfig,
				...info.context === void 0 ? {} : { context: info.context },
				modelInfo: info
			};
		}
		/**
		* Resolve one call under its current adapter registration. The returned
		* one-shot handle keeps that registration across header logging and dispatch,
		* so HMR cannot combine one adapter's capability result with another adapter.
		* An optional synchronous callback selects concrete controls using captured
		* model metadata. Defaults and validation apply to its result. Callback
		* failures and cancellation reject preparation before dispatch.
		* @param config - provider/model route and optional concrete request controls.
		* @param signal - optional cancellation for adapter-owned capability lookup.
		* @param configure - pure control selection, called once before defaults and validation.
		* @returns a prepared config and its registration-bound stream entry point.
		*/
		async prepareCall(config, signal, configure) {
			signal?.throwIfAborted();
			const { provider, model, ...controls } = config;
			const registration = this.registration(provider);
			const adapterCall = await registration.adapter.prepareCall(provider, model, signal);
			signal?.throwIfAborted();
			const modelInfo = this.normalizeModelInfo(registration, model, adapterCall.model);
			const proposed = configure === void 0 ? config : {
				...configure(deepFreeze(structuredClone(controls)), deepFreeze(modelInfo)),
				provider,
				model
			};
			signal?.throwIfAborted();
			const resolved = this.resolveCallWithInfo(proposed, modelInfo);
			const resolvedConfig = deepFreeze(structuredClone(resolved.config));
			const context = resolved.context === void 0 ? void 0 : deepFreeze(structuredClone(resolved.context));
			const adapterDefaults = deepFreeze({
				...proposed.reasoningEffort === void 0 && resolvedConfig.reasoningEffort !== void 0 ? { reasoningEffort: true } : {},
				...proposed.maxTokens === void 0 && resolvedConfig.maxTokens !== void 0 ? { maxTokens: true } : {}
			});
			let dispatched = false;
			return Object.freeze({
				config: resolvedConfig,
				retryPolicy: registration.retryPolicy,
				adapterDefaults,
				...context === void 0 ? {} : { context },
				...modelInfo.inputModalities === void 0 ? {} : { inputModalities: Object.freeze([...modelInfo.inputModalities]) },
				...modelInfo.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: modelInfo.systemPromptUpdate },
				...modelInfo.toolUpdate === void 0 ? {} : { toolUpdate: modelInfo.toolUpdate },
				stream: (options) => {
					if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
					if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
					dispatched = true;
					return this.streamWithRegistration(options, {
						registration,
						config: resolvedConfig,
						modelInfo,
						dispatch: (options) => adapterCall.stream(options)
					});
				}
			});
		}
		registration(provider) {
			const registration = this.adapters.get(provider);
			if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, "NO_ADAPTER");
			return registration;
		}
		/** Remove replay state whose historical route is owned by another adapter. */
		forAdapter(options, adapter) {
			const messages = options.messages.map((message) => {
				if (message.role !== "assistant") return message;
				const source = message.source;
				if (source.replayState === void 0) return message;
				if (this.adapters.get(source.provider)?.adapter === adapter) return message;
				return freezeMessage({
					...message,
					source: {
						kind: "model",
						provider: source.provider,
						model: source.model
					}
				});
			});
			if (messages.every((message, index) => message === options.messages[index])) return options;
			const filtered = {
				...options,
				messages
			};
			return Object.isFrozen(options) ? deepFreeze(filtered) : filtered;
		}
		/**
		* Resolve the current execution-world read path of one durable file
		* reference through the mounted attachment and filesystem providers.
		*/
		fileReadPath(ref) {
			let hostPath;
			try {
				hostPath = this.ctx.get("attachments")?.fileHostPath(ref);
			} catch {
				return;
			}
			if (hostPath === void 0) return void 0;
			return this.ctx.get("fs")?.processPathFromHostPath(hostPath);
		}
		/**
		* Final adapter boundary. Adapter selection, dispatch, iterator construction,
		* and iteration failures become one terminal failure chunk. Middleware and
		* downstream consumer failures remain thrown plugin or consumer errors.
		*/
		async *adapterStream(options, prepared) {
			let iterator;
			try {
				const registration = prepared?.registration ?? this.registration(options.provider);
				const adapter = registration.adapter;
				let modelInfo;
				let resolvedConfig;
				let dispatch;
				if (prepared === void 0) {
					const adapterCall = await adapter.prepareCall(options.provider, options.model, options.signal);
					modelInfo = this.normalizeModelInfo(registration, options.model, adapterCall.model);
					resolvedConfig = this.resolveCallWithInfo(options, modelInfo).config;
					dispatch = (options) => adapterCall.stream(options);
				} else {
					modelInfo = prepared.modelInfo;
					resolvedConfig = prepared.config;
					dispatch = prepared.dispatch;
				}
				if (prepared !== void 0 && !callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
				const resolvedOptions = callConfigEquals(options, resolvedConfig) ? options : Object.isFrozen(options) ? deepFreeze({
					...options,
					...resolvedConfig
				}) : {
					...options,
					...resolvedConfig
				};
				let projectedMessages = resolvedOptions.messages;
				if (projectedMessages.some((message) => contentHasFile(message.content))) projectedMessages = projectFilesToText(projectedMessages, (ref) => this.fileReadPath(ref));
				if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && projectedMessages.some((message) => contentHasImage(message.content))) projectedMessages = projectImagesForTextModel(projectedMessages);
				const projectedTools = projectToolUpdates(projectedMessages, resolvedOptions.tools, modelInfo.toolUpdate, resolvedOptions.toolHistory);
				projectedMessages = projectedTools.messages;
				let projectedOptions = resolvedOptions;
				if (projectedMessages !== resolvedOptions.messages || projectedTools.tools !== resolvedOptions.tools) {
					projectedOptions = {
						...resolvedOptions,
						messages: projectedMessages,
						...projectedTools.tools === void 0 ? {} : { tools: projectedTools.tools }
					};
					if (Object.isFrozen(resolvedOptions)) deepFreeze(projectedOptions);
				}
				iterator = dispatch(this.forAdapter(projectedOptions, adapter))[Symbol.asyncIterator]();
			} catch (error) {
				yield adapterFailureChunk(error, options.signal);
				return;
			}
			let completed = false;
			try {
				while (true) {
					let item;
					try {
						const next = await iterator.next();
						item = next.done ? { done: true } : {
							done: false,
							value: next.value
						};
					} catch (error) {
						completed = true;
						yield adapterFailureChunk(error, options.signal);
						return;
					}
					if (item.done) {
						completed = true;
						return;
					}
					yield item.value;
				}
			} finally {
				if (!completed) {
					const close = iterator.return?.bind(iterator);
					if (close) await close();
				}
			}
		}
		/**
		* Stream one model call as raw chunks (token-level deltas). Replay state is
		* retained only when the same adapter instance owns its historical provider
		* and the target provider. Final adapter selection remains fixed through
		* asynchronous exact-model resolution and dispatch. Adapter selection,
		* dispatch, and iteration failures become terminal `error` or `aborted`
		* finish chunks; middleware, nested-call, cleanup, and consumer failures
		* remain thrown.
		* @param options - the full request; `options.provider` selects the adapter.
		* @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
		*/
		stream(options) {
			return this.streamWithRegistration(options);
		}
		streamWithRegistration(options, prepared) {
			return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
		}
	};
})();
/** Convert one adapter throw into the stream protocol's terminal outcome. */
function adapterFailureChunk(error, signal) {
	const failure = normalizeLlmFailure(error);
	return {
		type: "finish",
		reason: signal?.aborted || failure.code === "ABORTED" ? {
			kind: "aborted",
			failure
		} : {
			kind: "error",
			failure
		}
	};
}
/** Copy a directory entry, including its arrays, so neither side can mutate the other's copy. */
function detachDirectoryEntry(entry) {
	const { nativeAuth } = entry;
	return {
		...entry,
		settingsPath: [...entry.settingsPath],
		...entry.baseURLEnv === void 0 ? {} : { baseURLEnv: [...entry.baseURLEnv] },
		...nativeAuth === void 0 ? {} : { nativeAuth: {
			...nativeAuth,
			env: [...nativeAuth.env]
		} }
	};
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-sandbox@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5_@deepseek-ai+dsh-llm@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5_/node_modules/@deepseek-ai/dsh-sandbox/lib/index.js
/**
* The escalation vocabulary and choreography shared by every sandbox-enforcing
* tool family (`@deepseek-ai/dsh-tool-bash`, `@deepseek-ai/dsh-tool-fs`): the
* strictly-wider ladder, the argument-pairing validation, the model-facing
* denial/hint markers, and {@link approveEscalation} — the ordered fail-closed
* sequence that resolves a `sandbox_permissions` request through a
* user-approval channel BEFORE anything executes. One home keeps the two
* families' approval ordering and verbatim error texts from drifting apart.
*
* The channel is a minimal STRUCTURAL function shape ({@link EscalationAsk}),
* not the approval service type: the tool layer — which owns the agent, the
* call id, and the tool name — closes over `ctx.approval.request(...)` and
* hands the closure down, so this package never depends on the approval or
* agent packages.
*
* @module dsh-sandbox/escalation
*/
/**
* The strictly-wider table: what a call whose effective mode is the key may
* escalate TO. Checked at EXECUTION, never baked into a tool schema — the
* schema's enum is {@link ESCALATION_TARGETS}, because schemas are
* registry-global while the effective mode is per-call truth.
*/
const WIDER_MODES = {
	"read-only": ["workspace-write", "danger-full-access"],
	"workspace-write": ["danger-full-access"]
};
/**
* The closed escalation-target vocabulary — every mode a call could ever
* escalate TO (`read-only` is the floor; nothing escalates to it). Advertised
* whenever the mounted capability confines: cutting the enum down to the modes
* wider than the composition's DEFAULT would strand a session whose effective
* mode sits below it (a `danger-full-access` default would advertise nothing
* while a narrower-switched session stays confined with no lever).
*/
const ESCALATION_TARGETS = ["workspace-write", "danger-full-access"];
/**
* Validate the escalation argument pairing a tool schema cannot express:
* `sandbox_permissions` and `justification` travel together — an approval
* prompt without a reason, or a reason driving nothing, is a malformed ask —
* and the justification must be a non-empty sentence.
* @param sandboxPermissions - the raw `sandbox_permissions` argument, if given.
* @param justification - the raw `justification` argument, if given.
*/
function validateEscalationArgs(sandboxPermissions, justification) {
	if (sandboxPermissions !== void 0 && justification === void 0) throw new Error("invalid escalation: sandbox_permissions requires a justification");
	if (justification !== void 0 && sandboxPermissions === void 0) throw new Error("invalid escalation: justification is only valid together with sandbox_permissions");
	if (justification !== void 0 && justification.trim().length === 0) throw new Error("invalid justification: expected a non-empty sentence");
}
/**
* Resolve a sandbox permission request before execution. Repeating the call's
* effective mode returns it without approval. A strictly wider mode requires
* approval and applies only to this call. Narrower or unsupported targets,
* missing approval services or agents for widening, and non-grant outcomes
* throw before execution.
* @param request - the escalation to judge (see {@link EscalationRequest}).
* @param approval - the approval ingredients the tool holds (see {@link EscalationApproval}).
* @returns the granted mode, consumed by the one call that asked.
*/
async function approveEscalation(request, approval) {
	const { requestedMode: mode, effectiveMode, justification, subject } = request;
	if (mode === effectiveMode) return effectiveMode;
	if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode)) throw new Error(`sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`);
	if (approval.approver === void 0) throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval service is composed`);
	if (approval.agent === void 0) throw new Error(`sandbox escalation to "${mode}" requires approval, but the call has no agent to route it through`);
	const outcome = await approval.approver.request({
		agent: approval.agent,
		toolName: approval.toolName,
		callId: approval.callId,
		reason: `escalate sandbox to ${mode}: ${justification}`,
		displayReason: {
			en: `Allow this operation with ${mode} permissions: ${justification}`,
			zh: `允许本次操作使用 ${mode} 权限：${justification}`
		},
		...approval.signal ? { signal: approval.signal } : {}
	});
	switch (outcome) {
		case "allowed-once": return mode;
		case "rejected": throw new Error(`the user rejected escalating this ${subject} to "${mode}"; it stays denied, so stop and explain instead of working around it`);
		case "cancelled": throw new Error(`approval for escalating to "${mode}" was cancelled`);
		case "unavailable": throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval channel is available`);
		default: return assertNever(outcome, "EscalationOutcome");
	}
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+dsh-tools@0.2.1-rc.3_@deepseek-ai+cordis@4.0.5_@deepseek-ai+dsh-llm@0.2.1-_7ec0328b583307551fe7fbd9f6738598/node_modules/@deepseek-ai/dsh-tools/lib/index.js
/**
* Enforced JSON Schema subset shared by tool outputs, generated PTC mode
* types, subagents, and workflows. The subset accepts any JSON root, an
* annotation-only schema for unconstrained JSON, one scalar `type`, object
* `properties`/`required`/boolean `additionalProperties`, array `items`,
* type-correct scalar `enum`/`const`, and exact-one `oneOf`.
*
* Unsupported or misplaced keywords reject rather than being accepted without
* enforcement. Consumers that require an object root apply
* {@link assertObjectJsonSchema} before accepting input.
* @module dsh-tools/json-schema
*/
/**
* Thrown when a raw schema falls outside the enforced subset. `violations`
* lists every offending path instead of stopping at the first author error.
*/
var JsonSchemaError = class extends HarnessError {
	/** Individual schema violations in walk order. */
	violations;
	constructor(violations) {
		super(`unsupported JSON schema: ${violations.join("; ")}`, "UNSUPPORTED_SCHEMA");
		this.name = "JsonSchemaError";
		this.violations = violations;
	}
};
const CONSTRAINT_KEYWORDS = /* @__PURE__ */ new Set([
	"type",
	"oneOf",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
]);
const ANNOTATION_KEYWORDS = /* @__PURE__ */ new Set([
	"description",
	"title",
	"default",
	"examples"
]);
const SCHEMA_TYPES = [
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null"
];
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
/**
* Test for a realm-agnostic plain JSON record without accepting arrays or
* exotic objects.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the value has a plain-object prototype chain.
*/
function isPlainJsonRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
	} catch {
		return false;
	}
}
/** Whether an array uses one realm's intrinsic `Array.prototype`. */
function hasPlainArrayPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
/** Return whether a record contains only own enumerable string keys. */
function hasOnlyEnumerableStringKeys(value) {
	try {
		return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key));
	} catch {
		return false;
	}
}
/**
* Test for an ordinary schema record whose keys survive JSON projection.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the record has an intrinsic prototype and only own enumerable string keys.
*/
function isJsonSchemaRecord(value) {
	return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);
}
/**
* Test for a dense ordinary array with no JSON-invisible decorations.
* @param value - candidate array from any JavaScript realm.
* @returns Whether the array is intrinsic, dense, and undecorated.
*/
function isPlainJsonArray(value) {
	if (!Array.isArray(value)) return false;
	try {
		if (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
		for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
		return true;
	} catch {
		return false;
	}
}
/** Lossless finite JSON number, excluding negative zero. */
function isJsonNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
/** Whether a scalar is valid for one declared schema type. */
function scalarMatches(type, value) {
	switch (type) {
		case "string": return typeof value === "string";
		case "number": return isJsonNumber(value);
		case "integer": return isJsonNumber(value) && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		/* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */
		default: return assertNever(type, "JsonSchemaType");
	}
}
/** Keywords that are invalid beside `oneOf`. */
const ONE_OF_SIBLING_KEYWORDS = [
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
];
/** Validate object-only fields after its property schemas have been visited. */
function checkObjectSchemaTail(node, path, properties, violations) {
	const hasRequired = Object.hasOwn(node, "required");
	const required = hasRequired ? node.required : void 0;
	if (hasRequired) if (!isPlainJsonArray(required) || required.some((entry) => typeof entry !== "string")) violations.push(`${path}.required must be an array of strings`);
	else {
		const declared = isJsonSchemaRecord(properties) ? properties : {};
		for (const key of required) if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
	}
	if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") violations.push(`${path}.additionalProperties must be a boolean`);
}
/** Collect every violation for one raw schema tree without using the JavaScript call stack. */
function checkSchemaNode(root, rootPath, violations, seen) {
	const tasks = [{
		kind: "enter",
		node: root,
		path: rootPath
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.node);
			continue;
		}
		if (task.kind === "one-of-tail") {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`);
			continue;
		}
		if (task.kind === "object-tail") {
			checkObjectSchemaTail(task.node, task.path, task.properties, violations);
			continue;
		}
		const { node, path } = task;
		if (!isJsonSchemaRecord(node)) {
			violations.push(`${path} must be a schema object`);
			continue;
		}
		if (seen.has(node)) {
			violations.push(`${path} is circular`);
			continue;
		}
		seen.add(node);
		tasks.push({
			kind: "leave",
			node
		});
		for (const key of Object.keys(node)) {
			if (CONSTRAINT_KEYWORDS.has(key)) continue;
			if (ANNOTATION_KEYWORDS.has(key)) {
				try {
					if (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`);
				} catch {
					violations.push(`${path}.${key} annotation must be lossless JSON data`);
				}
				continue;
			}
			violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
		}
		if (Object.hasOwn(node, "description") && typeof node.description !== "string") violations.push(`${path}.description must be a string`);
		if (Object.hasOwn(node, "title") && typeof node.title !== "string") violations.push(`${path}.title must be a string`);
		const hasType = Object.hasOwn(node, "type");
		const hasOneOf = Object.hasOwn(node, "oneOf");
		if (hasType && hasOneOf) {
			violations.push(`${path} cannot declare both type and oneOf`);
			continue;
		}
		if (!hasType && !hasOneOf) {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);
			continue;
		}
		if (hasOneOf) {
			const oneOf = node.oneOf;
			tasks.push({
				kind: "one-of-tail",
				node,
				path
			});
			if (!isPlainJsonArray(oneOf) || oneOf.length < 2) violations.push(`${path}.oneOf must be an array of at least two schemas`);
			else for (let index = oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "enter",
				node: oneOf[index],
				path: `${path}.oneOf[${index}]`
			});
			continue;
		}
		const type = node.type;
		if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
			violations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);
			continue;
		}
		const schemaType = type;
		for (const [key, types] of Object.entries({
			properties: ["object"],
			required: ["object"],
			additionalProperties: ["object"],
			items: ["array"],
			enum: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			],
			const: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			]
		})) if (Object.hasOwn(node, key) && !types.includes(schemaType)) violations.push(`${path}.${key} is not supported on type "${schemaType}"`);
		switch (schemaType) {
			case "object": {
				const properties = Object.hasOwn(node, "properties") ? node.properties : void 0;
				tasks.push({
					kind: "object-tail",
					node,
					path,
					properties
				});
				if (Object.hasOwn(node, "properties")) if (!isJsonSchemaRecord(properties)) violations.push(`${path}.properties must be an object of schemas`);
				else {
					const entries = Object.entries(properties);
					for (let index = entries.length - 1; index >= 0; index--) {
						const entry = entries[index];
						/* v8 ignore next -- the loop is bounded by the captured entry count. */
						if (entry === void 0) continue;
						tasks.push({
							kind: "enter",
							node: entry[1],
							path: `${path}.properties.${entry[0]}`
						});
					}
				}
				break;
			}
			case "array":
				if (Object.hasOwn(node, "items")) tasks.push({
					kind: "enter",
					node: node.items,
					path: `${path}.items`
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null": {
				const hasEnum = Object.hasOwn(node, "enum");
				const allowed = hasEnum ? node.enum : void 0;
				const enumValid = isPlainJsonArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(schemaType, entry));
				if (hasEnum && !enumValid) violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);
				const hasConst = Object.hasOwn(node, "const");
				const declaredConst = hasConst ? node.const : void 0;
				const constValid = scalarMatches(schemaType, declaredConst);
				if (hasConst) {
					if (!constValid) violations.push(`${path}.const must be a ${schemaType} value`);
					else if (enumValid && !allowed.includes(declaredConst)) violations.push(`${path}.const must be one of ${path}.enum when both are declared`);
				}
				break;
			}
			/* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */
			default: assertNever(schemaType, "JsonSchemaType");
		}
	}
}
/**
* Assert that an arbitrary raw schema uses only the enforced subset.
* Annotation-only schemas are accepted as the standard unconstrained-JSON
* form; callers that require an object root use {@link assertObjectJsonSchema}.
* @param schema - untrusted raw JSON Schema.
* @returns Assertion that the schema belongs to the supported subset.
*/
function assertSupportedJsonSchema(schema) {
	const violations = [];
	checkSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());
	if (violations.length > 0) throw new JsonSchemaError(violations);
}
/** Safely test the lossless JSON boundary when a getter may throw. */
function safelyIsJsonValue(value) {
	try {
		return isJsonValue(value);
	} catch {
		return false;
	}
}
/** Root-aware diagnostic path for the parameter validator's empty sentinel. */
function diagnosticPath(path) {
	return path === "" ? "arguments" : path;
}
/** Append one object property without a leading dot at an implicit root. */
function propertyPath(path, key) {
	return path === "" ? key : `${path}.${key}`;
}
/** The generic exception-containment diagnostic owned by one valid schema node. */
function losslessValueViolation(path) {
	return [`"${diagnosticPath(path)}" must be a lossless JSON value`];
}
/** Append diagnostics without spreading a potentially wide child result as call arguments. */
function appendViolations(target, source) {
	for (const violation of source) target.push(violation);
}
/** Initialize one validation frame with empty aggregation state. */
function valueFrame(node, value, path) {
	return {
		node,
		value,
		path,
		catches: false,
		phase: "start",
		children: [],
		childIndex: 0,
		violations: [],
		tailViolations: [],
		matches: 0
	};
}
/** Validate one scalar node after its primitive type check. */
function checkScalarValue(node, value, path) {
	const allowed = Object.hasOwn(node, "enum") ? node.enum : void 0;
	if (allowed !== void 0 && !allowed.includes(value)) return [`"${diagnosticPath(path)}" must be one of ${JSON.stringify(allowed)}`];
	if (Object.hasOwn(node, "const") && value !== node.const) return [`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`];
	return [];
}
/** Validate one trusted schema/value pair with explicit frames rather than recursive calls. */
function checkValue(schema, value, path) {
	const frames = [valueFrame(schema, value, path)];
	let rootResult;
	const receive = (result) => {
		const parent = frames.at(-1);
		if (parent === void 0) {
			rootResult = result;
			return;
		}
		if (parent.kind === "oneOf") {
			if (result.length === 0) parent.matches++;
		} else appendViolations(parent.violations, result);
	};
	const finish = (result) => {
		frames.pop();
		receive(result);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		try {
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing schema-value child frame");
					frame.childIndex++;
					frames.push(valueFrame(child.node, child.value, child.path));
					continue;
				}
				if (frame.kind === "oneOf") {
					finish(frame.matches === 1 ? [] : [`"${diagnosticPath(frame.path)}" must match exactly one oneOf branch (matched ${frame.matches})`]);
					continue;
				}
				appendViolations(frame.violations, frame.tailViolations);
				if (frame.violations.length > 0) finish(frame.violations);
				else if (frame.kind === "object") finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a lossless JSON object`]);
				else finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a dense lossless JSON array`]);
				continue;
			}
			const nodeType = Object.hasOwn(frame.node, "type") ? frame.node.type : void 0;
			frame.catches = !(nodeType !== void 0 && !SCHEMA_TYPES.includes(nodeType));
			const oneOf = Object.hasOwn(frame.node, "oneOf") ? frame.node.oneOf : void 0;
			if (oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = Array.from(oneOf, (branch) => ({
					node: branch,
					value: frame.value,
					path: frame.path
				}));
				frame.childIndex = 0;
				frame.matches = 0;
				frame.phase = "children";
				continue;
			}
			if (nodeType === void 0) {
				finish(safelyIsJsonValue(frame.value) ? [] : losslessValueViolation(frame.path));
				continue;
			}
			switch (nodeType) {
				case "object": {
					if (!isPlainJsonRecord(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an object`]);
						break;
					}
					const properties = Object.hasOwn(frame.node, "properties") ? frame.node.properties ?? {} : {};
					const violations = [];
					const required = Object.hasOwn(frame.node, "required") ? frame.node.required ?? [] : [];
					for (const key of required) if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) violations.push(`missing required property "${propertyPath(frame.path, key)}"`);
					const children = [];
					for (const [key, child] of Object.entries(properties)) {
						if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) continue;
						children.push({
							node: child,
							value: frame.value[key],
							path: propertyPath(frame.path, key)
						});
					}
					const tailViolations = [];
					if (Object.hasOwn(frame.node, "additionalProperties") && frame.node.additionalProperties === false) {
						for (const key of Object.keys(frame.value)) if (!Object.hasOwn(properties, key)) tailViolations.push(`"${propertyPath(frame.path, key)}" is not a declared property (additionalProperties: false)`);
					}
					frame.kind = "object";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = violations;
					frame.tailViolations = tailViolations;
					frame.phase = "children";
					break;
				}
				case "array": {
					if (!Array.isArray(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an array`]);
						break;
					}
					const items = Object.hasOwn(frame.node, "items") ? frame.node.items : void 0;
					const children = items === void 0 ? [] : frame.value.flatMap((entry, index) => [{
						node: items,
						value: entry,
						path: `${frame.path}[${index}]`
					}]);
					frame.kind = "array";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = [];
					frame.phase = "children";
					break;
				}
				case "string":
					finish(typeof frame.value === "string" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a string`]);
					break;
				case "number":
					finish(typeof frame.value !== "number" ? [`"${diagnosticPath(frame.path)}" must be a number`] : !isJsonNumber(frame.value) ? [`"${diagnosticPath(frame.path)}" must be a finite JSON number`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "integer":
					finish(!isJsonNumber(frame.value) || !Number.isInteger(frame.value) ? [`"${diagnosticPath(frame.path)}" must be an integer`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "boolean":
					finish(typeof frame.value === "boolean" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a boolean`]);
					break;
				case "null":
					finish(frame.value === null ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be null`]);
					break;
				default: finish(assertNever(nodeType, "JsonSchemaType"));
			}
		} catch (error) {
			let failed = frames.pop();
			while (failed !== void 0 && !failed.catches) failed = frames.pop();
			if (failed === void 0) throw error;
			receive(losslessValueViolation(failed.path));
		}
	}
	/* v8 ignore next -- every root frame finishes or throws. */
	return rootResult ?? losslessValueViolation(path);
}
/**
* Validate a candidate value against an asserted raw schema. The function is
* total for arbitrary values and returns path-qualified violations.
* @param schema - a schema accepted by {@link assertSupportedJsonSchema}.
* @param value - the candidate JSON value.
* @param path - root label used in diagnostics.
* @returns All violations in walk order; empty means valid.
*/
function validateJsonSchemaValue(schema, value, path = "value") {
	return checkValue(schema, value, path);
}
/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */
const ANNOTATION_KEYS = [
	"description",
	"title",
	"default",
	"examples"
];
/** Throw one author-schema violation through the shared schema error type. */
function authorError(message) {
	throw new JsonSchemaError([message]);
}
/** Copy own annotation fields for validation by the raw-schema boundary. */
function copyAnnotations(source, target) {
	if (Object.hasOwn(source, "description")) target.description = source.description;
	if (Object.hasOwn(source, "title")) target.title = source.title;
	if (Object.hasOwn(source, "default")) target.default = source.default;
	if (Object.hasOwn(source, "examples")) target.examples = source.examples;
}
/** Reject author-only keys outside one node's declared vocabulary. */
function assertAuthorKeys(source, path, allowed) {
	for (const key of Object.keys(source)) if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`);
}
/** Install a compiled node without giving `__proto__` assignment semantics. */
function assignCompiledNode(destination, node) {
	switch (destination.kind) {
		case "root":
			destination.holder.value = node;
			break;
		case "property":
			Object.defineProperty(destination.target, destination.key, {
				value: node,
				enumerable: true,
				configurable: true,
				writable: true
			});
			break;
		case "item":
			destination.target.items = node;
			break;
		case "one-of":
			destination.target[destination.index] = node;
			break;
	}
}
/** Install a compiled property map at its root or containing object node. */
function assignCompiledPropertyMap(destination, compiled) {
	if (destination.kind === "root") destination.holder.value = compiled;
	else destination.target.properties = compiled.properties;
}
/** Execute an author-schema compilation task graph without recursive descent. */
function runSchemaCompiler(initial) {
	const seen = /* @__PURE__ */ new Set();
	const tasks = [initial];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.input);
			continue;
		}
		if (task.kind === "property-map-tail") {
			if (task.required.length > 0) {
				task.compiled.required = task.required;
				if (task.destination.kind === "object") task.destination.target.required = task.required;
			}
			continue;
		}
		if (task.kind === "property") {
			if (!isJsonSchemaRecord(task.property)) authorError(`${task.path} must be a value schema object`);
			if (Object.hasOwn(task.property, "required") && task.property.required !== true) authorError(`${task.path}.required must be true when present`);
			if (Object.hasOwn(task.property, "required") && task.property.required === true) task.required.push(task.key);
			tasks.push({
				kind: "value",
				input: task.property,
				path: task.path,
				allowRequired: true,
				destination: {
					kind: "property",
					target: task.properties,
					key: task.key
				}
			});
			continue;
		}
		if (task.kind === "property-map") {
			if (!isJsonSchemaRecord(task.input)) authorError(`${task.path} must be an object of value schemas`);
			if (seen.has(task.input)) authorError(`${task.path} is circular`);
			seen.add(task.input);
			const compiled = { properties: {} };
			const required = [];
			assignCompiledPropertyMap(task.destination, compiled);
			tasks.push({
				kind: "leave",
				input: task.input
			});
			tasks.push({
				kind: "property-map-tail",
				compiled,
				required,
				destination: task.destination
			});
			const entries = Object.entries(task.input);
			for (let index = entries.length - 1; index >= 0; index--) {
				const entry = entries[index];
				/* v8 ignore next -- the loop is bounded by the captured entry count. */
				if (entry === void 0) continue;
				tasks.push({
					kind: "property",
					property: entry[1],
					path: `${task.path}.${entry[0]}`,
					key: entry[0],
					properties: compiled.properties,
					required
				});
			}
			continue;
		}
		const { input, path } = task;
		if (!isJsonSchemaRecord(input)) authorError(`${path} must be a value schema object`);
		if (seen.has(input)) authorError(`${path} is circular`);
		seen.add(input);
		const authorKeys = [...ANNOTATION_KEYS, ...task.allowRequired ? ["required"] : []];
		const node = {};
		assignCompiledNode(task.destination, node);
		tasks.push({
			kind: "leave",
			input
		});
		if (Object.hasOwn(input, "oneOf")) {
			assertAuthorKeys(input, path, [
				...authorKeys,
				"oneOf",
				"type"
			]);
			if (Object.hasOwn(input, "type")) authorError(`${path} cannot declare both type and oneOf`);
			if (!isPlainJsonArray(input.oneOf)) authorError(`${path}.oneOf must be an array of at least two value schemas`);
			const branches = [];
			node.oneOf = branches;
			copyAnnotations(input, node);
			for (let index = input.oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "value",
				input: input.oneOf[index],
				path: `${path}.oneOf[${index}]`,
				allowRequired: false,
				destination: {
					kind: "one-of",
					target: branches,
					index
				}
			});
			continue;
		}
		const inputType = Object.hasOwn(input, "type") ? input.type : void 0;
		switch (inputType) {
			case "json":
				assertAuthorKeys(input, path, [...authorKeys, "type"]);
				copyAnnotations(input, node);
				break;
			case "object":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"properties",
					"additionalProperties"
				]);
				if (!Object.hasOwn(input, "additionalProperties") || typeof input.additionalProperties !== "boolean") authorError(`${path}.additionalProperties must be explicitly true or false`);
				node.type = "object";
				copyAnnotations(input, node);
				node.additionalProperties = input.additionalProperties;
				if (Object.hasOwn(input, "properties")) tasks.push({
					kind: "property-map",
					input: input.properties,
					path: `${path}.properties`,
					destination: {
						kind: "object",
						target: node
					}
				});
				break;
			case "array":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"items"
				]);
				node.type = "array";
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "items")) tasks.push({
					kind: "value",
					input: input.items,
					path: `${path}.items`,
					allowRequired: false,
					destination: {
						kind: "item",
						target: node
					}
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"enum",
					"const"
				]);
				node.type = inputType;
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "enum")) {
					if (!isPlainJsonArray(input.enum)) authorError(`${path}.enum must be a non-empty array of scalar values`);
					node.enum = Array.from(input.enum, (entry) => entry);
				}
				if (Object.hasOwn(input, "const")) node.const = input.const;
				break;
			default: authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`);
		}
	}
}
/** Compile one implicit property map, collecting per-property requiredness. */
function compilePropertyMap(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "property-map",
		input,
		path,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/** Compile one author node without applying any consumer root restriction. */
function compileValueSchema(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "value",
		input,
		path,
		allowRequired: false,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/**
* Compile one author-facing value schema to the enforced raw JSON Schema
* subset. The author-only `json` node becomes an annotation-only schema.
* @param spec - schema for any JSON-value root.
* @returns The asserted raw schema projection.
*/
function valueSchemaSpecToJsonSchema(spec) {
	const schema = compileValueSchema(spec, "schema");
	assertSupportedJsonSchema(schema);
	return schema;
}
/**
* Compile the implicit open parameter object into raw JSON Schema.
* @param spec - per-property parameter definitions.
* @returns An object-rooted raw schema with no implicit-root openness override.
*/
function parameterSchemaSpecToJsonSchema(spec) {
	const compiled = compilePropertyMap(spec, "parameters");
	const schema = {
		type: "object",
		properties: compiled.properties,
		...compiled.required === void 0 ? {} : { required: compiled.required }
	};
	assertSupportedJsonSchema(schema);
	return schema;
}
/** Invalid model-generated arguments for a typed tool. */
var ToolArgsError = class extends HarnessError {
	/** Individual violations in schema-walk order. */
	violations;
	constructor(violations) {
		super(`invalid arguments: ${violations.join("; ")}`, "INVALID_ARGS");
		this.name = "ToolArgsError";
		this.violations = violations;
	}
};
/**
* Define a first-party tool with inferred arguments and strict execution
* validation. Replay-only presenters validate softly and fall back to generic
* rendering for obsolete logged arguments.
* @param options - typed definition and optional finalizer and presenters.
* @returns A registry-ready definition.
*/
function defineTool(options) {
	const userExecute = options.execute;
	const userFinalizeContent = options.finalizeContent;
	const userProjectContent = options.projectContent;
	const userRender = options.output.render;
	const userPresentationMeta = options.output.presentationMeta;
	const userPresentCall = options.presentCall;
	const userPresentResult = options.presentResult;
	const userIsConcurrencySafe = options.isConcurrencySafe;
	if (options.timeoutMs !== void 0 && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`);
	const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
	const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);
	const validate = (args) => validateJsonSchemaValue(parameters, args, "");
	const tool = {
		name: options.name,
		description: options.description,
		parameters,
		output: {
			schema: outputSchema,
			render(args, value) {
				return userRender(args, value);
			},
			...userPresentationMeta !== void 0 ? { presentationMeta(args, value) {
				return userPresentationMeta(args, value);
			} } : {}
		},
		...options.deferLoading === true ? { deferLoading: options.deferLoading } : {},
		...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
		async execute(args, exec) {
			const violations = validate(args);
			if (violations.length > 0) throw new ToolArgsError(violations);
			return userExecute(args, exec);
		}
	};
	if (userProjectContent) tool.projectContent = (exec, result) => userProjectContent(exec, result);
	if (userFinalizeContent) tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result);
	if (userPresentCall) tool.presentCall = (args) => {
		if (validate(args).length > 0) return void 0;
		return userPresentCall(args);
	};
	if (userPresentResult) tool.presentResult = (args, result) => {
		if (validate(args).length > 0) return void 0;
		return userPresentResult(args, result);
	};
	if (userIsConcurrencySafe) tool.isConcurrencySafe = (args) => {
		if (validate(args).length > 0) return false;
		return userIsConcurrencySafe(args);
	};
	return tool;
}
/** Keeps calls under a changed policy from overlapping their canceled predecessors. */
var PtcCalls = class {
	calls = /* @__PURE__ */ new Map();
	disposed = false;
	/**
	* Observe policy changes for the owning tool registry.
	* @param ctx - Registry lifecycle and Session events.
	*/
	constructor(ctx) {
		ctx.on("session/event", (session, event) => {
			if (event.type !== "sandbox/mode") return;
			for (const call of this.calls.get(session.id) ?? []) if (call.mode !== event.data.mode) call.controller.abort(/* @__PURE__ */ new Error("sandbox mode changed"));
		}, { global: true });
		ctx.effect(() => async () => {
			this.disposed = true;
			const calls = [...this.calls.values()].flatMap((calls) => [...calls]);
			for (const call of calls) call.controller.abort(/* @__PURE__ */ new Error("PTC tool registry disposed"));
			await Promise.all(calls.map((call) => call.done));
		}, "PTC calls");
	}
	/**
	* Await canceled predecessors before resolving authority and admitting a call.
	* @param sessionId - Calling Session.
	* @param signal - Caller cancellation.
	* @param mode - Current standing mode, read after preceding cleanup.
	* @param run - Complete call, including nested-tool cleanup.
	* @returns The call result.
	*/
	async run(sessionId, signal, mode, run) {
		for (;;) {
			const pending = [...this.calls.get(sessionId) ?? []].filter((call) => call.controller.signal.aborted);
			if (pending.length === 0) break;
			await Promise.all(pending.map((call) => call.done));
		}
		signal.throwIfAborted();
		if (this.disposed) throw new Error("PTC tool registry disposed");
		const controller = new AbortController();
		const done = Promise.withResolvers();
		const call = {
			mode: mode(),
			controller,
			done: done.promise
		};
		let calls = this.calls.get(sessionId);
		if (calls === void 0) this.calls.set(sessionId, calls = /* @__PURE__ */ new Set());
		calls.add(call);
		try {
			return await run(AbortSignal.any([signal, controller.signal]));
		} finally {
			calls.delete(call);
			if (calls.size === 0) this.calls.delete(sessionId);
			done.resolve(void 0);
		}
	}
};
/**
* PTC mode `run_code` transport. Programs call the registry's agent-visible
* tools through nested executions scheduled under the native concurrency
* contract; each sub-dispatch is logged for reconstruction, while only the
* outer curated result enters model history.
* @module @deepseek-ai/dsh-tools/src/ptc
*/
/** The model-facing name of the PTC mode tool. */
const RUN_CODE_NAME = "run_code";
/** Keep tool-call rules here; the runtime owns evaluation syntax and state retention. */
function runCodeFlavor(language, execution = {
	programDescription: "the program to execute",
	outputInstruction: "Curate the program output.",
	codeDescription: `The ${language} program to execute, following this tool's execution instructions.`
}) {
	return {
		description: `Execute a ${language} program against the available tools. Takes two required arguments: \`code\`, ${execution.programDescription}, and \`description\`, a short summary of what the program does. Call tools as \`await tools.name(args)\` per the declarations in the system prompt. ${execution.outputInstruction} Image-bearing subtool results are attached after the run.`,
		codeDescription: execution.codeDescription
	};
}
const TYPESCRIPT_FLAVOR = runCodeFlavor("TypeScript");
const TYPESCRIPT_FUNCTION_FLAVOR = runCodeFlavor("TypeScript", {
	programDescription: "the BODY of an async function (erasable syntax only; top-level `await` and `return` work)",
	outputInstruction: "Only what you print or return is program output — curate it.",
	codeDescription: "The program: the body of an async TypeScript function."
});
/** Per-language `run_code` schema flavors (see {@link RunCodeFlavor}); one entry per {@link PtcSdkLanguage}. */
const RUN_CODE_FLAVORS = {
	typescript: TYPESCRIPT_FLAVOR,
	python: runCodeFlavor("Python")
};
/**
* The `description` parameter's model-facing description: language-independent
* (the UI label contract is the same for every runtime), shared between the
* static spec and the language-aware `parameters` getter so the two emissions
* can never drift.
*/
const RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION = "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\".";
const RUN_CODE_CONTROLS = {
	timeoutMs: {
		type: "number",
		description: "Positive elapsed-time budget in milliseconds, capped by the deployment maximum."
	},
	sandbox_permissions: {
		type: "string",
		enum: [...ESCALATION_TARGETS],
		description: "Wider sandbox mode for this complete program execution; requires justification and approval."
	},
	justification: {
		type: "string",
		description: "Reason this complete program needs wider access, shown to the user for approval. Use the language of the user’s current request."
	}
};
function controlParameters(runtime) {
	if (runtime === void 0) return RUN_CODE_CONTROLS;
	return {
		...runtime.timeout === void 0 ? {} : { timeoutMs: {
			...RUN_CODE_CONTROLS.timeoutMs,
			description: `Positive elapsed-time budget in milliseconds, including nested tool and approval waits. Default ${runtime.timeout.defaultMs}; capped at ${runtime.timeout.maxMs}. Zero does not disable the deadline.`
		} },
		...runtime.sandboxMode === void 0 ? {} : {
			sandbox_permissions: RUN_CODE_CONTROLS.sandbox_permissions,
			justification: RUN_CODE_CONTROLS.justification
		}
	};
}
function escalationGuidance(runtime) {
	return runtime?.sandboxMode === void 0 ? "" : " A sandbox escalation approves this complete program for one execution only. Nested tools retain their own policies and approvals. Request wider access only after evidence of a denial. Earlier effects may already have completed: inspect them before explicitly retrying. Programs are never replayed automatically.";
}
/**
* Resolve the {@link RunCodeFlavor} for the loaded runtime's language, read at
* schema-emission time so the model-visible `run_code` schema always matches
* the SDK section's language. `peekRuntime` returns `undefined` only when no
* runtime is mounted, which reaches this function through definition readers
* and `schemas()` — the doc-catalog harvest is the only shipped one, and none
* of them feeds a model, because `wireSchemas` calls `requirePtcRuntime`
* before projecting — so that path degrades to {@link TYPESCRIPT_FLAVOR}. A
* mounted runtime whose language has no flavor entry fails loud, exactly as
* `requirePtcRuntime` rejects it at assembly. Keeping this table in step with
* `SDK_RENDERERS` is the compiler's job ({@link PtcSdkLanguage}); what this
* guard owns is the runtime-supplied language neither table knows, which never
* yields a wrong-language schema for a real runtime.
*/
function resolveFlavor(peekRuntime) {
	const runtime = peekRuntime();
	if (runtime === void 0) return TYPESCRIPT_FLAVOR;
	const flavor = RUN_CODE_FLAVORS[runtime.language];
	if (!Object.hasOwn(RUN_CODE_FLAVORS, runtime.language) || flavor === void 0) {
		const known = Object.keys(RUN_CODE_FLAVORS).map((name) => JSON.stringify(name)).join(", ");
		throw new Error(`dsh-tools: no run_code schema flavor registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
	}
	return runtime.language === "typescript" && runtime.programFormat === "function-body" ? TYPESCRIPT_FUNCTION_FLAVOR : flavor;
}
/**
* Thrown by `run_code` when the program run itself failed — a program
* exception, a budget expiry, an abort, or substrate death. Extends
* {@link HarnessError} (`code: 'CODE_RUN_FAILED'`); the registry's execution
* pipeline converts it into a structured `isError` result whose text carries
* the failure kind plus the captured logs, so the model can self-correct.
*/
var CodeRunFailedError = class extends HarnessError {
	constructor(message) {
		super(message, "CODE_RUN_FAILED");
		this.name = "CodeRunFailedError";
	}
};
/**
* Snapshot one binding call's argument as lossless JSON, then snapshot that
* detached value again so dispatch and logging stay independent without
* reintroducing structured-clone's platform-specific nesting limit.
*/
function jsonNormalizeArgs(value) {
	let snapshot;
	try {
		snapshot = snapshotJsonValue(value);
	} catch (error) {
		throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (snapshot === void 0) throw new Error("tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)");
	const logged = snapshotJsonValue(snapshot);
	/* v8 ignore next -- snapshot is already a detached lossless JSON value. */
	if (logged === void 0) throw new Error("tool arguments could not be detached for durable logging");
	return {
		dispatched: snapshot,
		logged
	};
}
/** Two-space JSON presentation, matching the existing shallow `run_code` text contract. */
const JSON_INDENT = "  ";
/**
* ECMAScript caps `JSON.stringify`'s `space` string at ten characters. The
* renderer also caps TOTAL indentation there, compacting deeper subtrees, so
* formatted output remains linear in the canonical JSON size.
*/
const MAX_JSON_INDENT_CHARS = 10;
/** Render one non-string JSON root without recursive traversal or unbounded indentation growth. */
function renderJsonValue(value) {
	const chunks = [];
	const tasks = [{
		kind: "value",
		value,
		depth: 0,
		compact: false
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "text") {
			chunks.push(task.text);
			continue;
		}
		const current = task.value;
		if (current === null || typeof current === "boolean" || typeof current === "number") {
			chunks.push(String(current));
			continue;
		}
		if (typeof current === "string") {
			chunks.push(JSON.stringify(current));
			continue;
		}
		const compact = task.compact || (task.depth + 1) * 2 > MAX_JSON_INDENT_CHARS;
		const childDepth = task.depth + 1;
		if (Array.isArray(current)) {
			chunks.push("[");
			if (current.length === 0) {
				chunks.push("]");
				continue;
			}
			tasks.push({
				kind: "text",
				text: compact ? "]" : `\n${JSON_INDENT.repeat(task.depth)}]`
			});
			for (let index = current.length - 1; index >= 0; index--) {
				const item = current[index];
				/* v8 ignore next -- canonical JsonValue arrays are dense. */
				if (item === void 0) throw new Error("cannot render a sparse JSON array");
				tasks.push({
					kind: "value",
					value: item,
					depth: childDepth,
					compact
				});
				tasks.push({
					kind: "text",
					text: compact ? index === 0 ? "" : "," : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}`
				});
			}
			continue;
		}
		const keys = Object.keys(current);
		chunks.push("{");
		if (keys.length === 0) {
			chunks.push("}");
			continue;
		}
		tasks.push({
			kind: "text",
			text: compact ? "}" : `\n${JSON_INDENT.repeat(task.depth)}}`
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) throw new Error("cannot render a missing JSON object key");
			const item = current[key];
			/* v8 ignore next -- canonical JsonValue records contain no undefined properties. */
			if (item === void 0) throw new Error("cannot render an undefined JSON object property");
			tasks.push({
				kind: "value",
				value: item,
				depth: childDepth,
				compact
			});
			tasks.push({
				kind: "text",
				text: compact ? `${index === 0 ? "" : ","}${JSON.stringify(key)}:` : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `
			});
		}
	}
	return chunks.join("");
}
/** Render one present program completion value for the model-facing result text. */
function renderValue(value) {
	return typeof value === "string" ? value : renderJsonValue(value);
}
/**
* Build the `run_code` {@link ToolDefinition}: required `code` and
* `description` parameters, executed through the dispatch bridge described
* above. The
* registry reserves it as presentation infrastructure under non-native modes,
* outside the filterable global/scoped capability layers.
* @param registry - the owning registry (sub-calls go through its `execute`,
*   bindings cover its registered tools).
* @param options - the registry-private capabilities described above.
* @param ctx - Owning registry context, independent of the calling Agent.
* @returns the registry-ready definition.
*/
function createRunCodeTool(registry, options, ctx) {
	const { requireRuntime, peekRuntime, maxParallel, shapeDispatchLog } = options;
	const stateOwners = /* @__PURE__ */ new WeakMap();
	const calls = new PtcCalls(ctx);
	const definition = defineTool({
		name: RUN_CODE_NAME,
		description: TYPESCRIPT_FLAVOR.description,
		parameters: {
			code: {
				type: "string",
				required: true,
				description: TYPESCRIPT_FLAVOR.codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			},
			...RUN_CODE_CONTROLS
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					logs: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					result: { type: "json" },
					sandbox: {
						type: "object",
						additionalProperties: false,
						properties: {
							mode: {
								type: "string",
								required: true,
								enum: [
									"read-only",
									"workspace-write",
									"danger-full-access"
								]
							},
							denied: {
								type: "boolean",
								required: true
							},
							enforcement: {
								type: "string",
								enum: ["full", "partial"]
							}
						}
					}
				}
			},
			render: (_args, value) => {
				const rendered = value.result === void 0 ? "" : renderValue(value.result);
				const parts = [value.logs.join("\n"), rendered].filter((part) => part.length > 0);
				if (value.sandbox?.enforcement === "partial") parts.push("File sandbox enforcement is partial on this host.");
				if (value.sandbox?.denied) parts.push(`The ${value.sandbox.mode} file sandbox denied an operation.${escalationGuidance(peekRuntime())}`);
				return [{
					type: "text",
					text: parts.length > 0 ? parts.join("\n") : "(run_code completed with no output)"
				}];
			}
		},
		async execute(args, exec) {
			if (args.description.trim().length === 0) throw new Error("invalid description: expected a non-empty string");
			const runtime = requireRuntime();
			const run = async (callSignal) => {
				validateEscalationArgs(args.sandbox_permissions, args.justification);
				if (args.timeoutMs !== void 0 && runtime.timeout === void 0) throw new Error("timeoutMs is not available for this PTC runtime");
				if (args.timeoutMs !== void 0 && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) throw new Error("invalid timeoutMs: expected a positive finite number");
				const standingPolicy = runtime.sandboxMode === void 0 ? void 0 : options.resolveSandboxPolicy(exec);
				let policy = standingPolicy;
				if (args.sandbox_permissions !== void 0 && args.justification !== void 0) {
					if (standingPolicy === void 0) throw new Error("sandbox_permissions is not available for this PTC runtime");
					const approvedMode = await approveEscalation({
						requestedMode: args.sandbox_permissions,
						justification: args.justification,
						effectiveMode: standingPolicy.mode,
						subject: "program"
					}, {
						approver: options.peekApprover(),
						agent: exec.agent,
						callId: exec.callId,
						toolName: RUN_CODE_NAME,
						signal: callSignal
					});
					policy = {
						...standingPolicy,
						mode: approvedMode
					};
				}
				const cwd = await options.resolveWorkingDirectory({
					...exec,
					signal: callSignal
				});
				callSignal.throwIfAborted();
				const runController = new AbortController();
				const onOuterAbort = () => {
					runController.abort(callSignal.reason);
				};
				callSignal.addEventListener("abort", onOuterAbort, { once: true });
				let dispatches = 0;
				const pendingQueue = [];
				const inFlight = /* @__PURE__ */ new Set();
				/** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
				const logWork = /* @__PURE__ */ new Set();
				const commitQueue = [];
				let exclusiveActive = false;
				let driving = false;
				let driverRun = Promise.resolve();
				let wake;
				const wakeup = () => {
					const release = wake;
					wake = void 0;
					release?.();
				};
				/**
				* The single ordered lane. Each pass commits the head-of-line settled
				* dispatch (ordered post-execute), then starts the next queued entry if
				* its slot is free (ordered pre-execute), and otherwise sleeps until a
				* body settles or a new submission arrives. One run reaching the
				* empty-queues/empty-pool state is quiescence.
				*/
				const drive = () => {
					if (driving) return driverRun;
					driving = true;
					driverRun = (async () => {
						try {
							for (;;) {
								const signal = new Promise((resolve) => {
									wake = resolve;
								});
								const commitHead = commitQueue[0];
								if (commitHead !== void 0 && commitHead.settled) {
									commitQueue.shift();
									await commitHead.commit();
									if (commitHead.mode === "exclusive") exclusiveActive = false;
									continue;
								}
								const head = pendingQueue[0];
								if (head !== void 0) {
									if (runController.signal.aborted) {
										pendingQueue.shift();
										head.abandon();
										continue;
									}
									const mode = head.classify();
									if (!exclusiveActive && (mode === "exclusive" ? inFlight.size === 0 : inFlight.size < maxParallel)) {
										if (mode === "exclusive") exclusiveActive = true;
										head.mode = mode;
										pendingQueue.shift();
										commitQueue.push(head);
										await head.start();
										const flight = head.flight.finally(() => {
											inFlight.delete(flight);
											wakeup();
										});
										inFlight.add(flight);
										continue;
									}
								}
								if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return;
								await signal;
							}
						} finally {
							driving = false;
							wake = void 0;
						}
					})();
					return driverRun;
				};
				/** Every dispatch settled AND committed; nothing can start (the run is aborted at call time). */
				const drainDispatches = async () => {
					await drive();
					while (logWork.size > 0) await Promise.allSettled([...logWork]);
				};
				const runOver = () => runController.signal.aborted;
				const binding = (schema) => async (rawArgs) => {
					const { name } = schema;
					if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} not dispatched`);
					const normalized = jsonNormalizeArgs(rawArgs);
					const n = ++dispatches;
					const subCallId = brandString(`${String(exec.callId)}:ptc:${n}`);
					const input = {
						callId: subCallId,
						rootCallId: exec.rootCallId,
						name,
						schema,
						arguments: normalized.dispatched,
						...exec.agent ? { agent: exec.agent } : {},
						parent: exec.token,
						signal: runController.signal
					};
					const scheduler = registry[TOOL_RUNTIME_SCHEDULER];
					const outcome = await new Promise((resolve, reject) => {
						let parked;
						const settle = (result) => {
							resolve(result.isError ? {
								isError: true,
								message: result.error.message
							} : {
								isError: false,
								value: result.value
							});
							const agent = exec.agent;
							if (agent === void 0) return;
							const task = (async () => {
								const logged = await shapeDispatchLog({
									exec,
									agent,
									subCallId,
									name,
									isError: result.isError,
									content: result.content
								});
								agent.session.append("tool/ptc-dispatch", {
									rootCallId: exec.rootCallId,
									parentCallId: exec.callId,
									subCallId,
									name,
									arguments: normalized.logged,
									isError: result.isError,
									...result.error?.info === void 0 ? {} : { error: result.error.info },
									content: logged,
									...result.meta === void 0 ? {} : { meta: result.meta }
								});
							})().finally(() => {
								logWork.delete(task);
							});
							logWork.add(task);
						};
						pendingQueue.push({
							flight: Promise.resolve(),
							settled: false,
							classify: () => registry.executionMode(input).kind,
							abandon: () => {
								reject(/* @__PURE__ */ new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`));
							},
							async start() {
								exec.agent?.session.append("tool/ptc-dispatch-start", {
									rootCallId: exec.rootCallId,
									parentCallId: exec.callId,
									subCallId,
									name,
									arguments: normalized.logged
								});
								const prepared = await scheduler.prepare(input);
								if (prepared.kind === "dispatch") {
									this.flight = scheduler.dispatch(prepared.exec).then((dispatchOutcome) => {
										parked = {
											kind: dispatchOutcome.kind,
											exec: prepared.exec,
											result: dispatchOutcome.result
										};
										this.settled = true;
									});
									return;
								}
								parked = {
									kind: prepared.kind,
									exec: prepared.exec,
									result: prepared.result
								};
								this.settled = true;
							},
							async commit() {
								/* v8 ignore next -- commit() runs only after `settled` flipped, which set parked. */
								if (parked === void 0) return;
								const result = parked.kind === "post-result" ? await scheduler.finalize(parked.exec, parked.result) : scheduler.finish(parked.exec, parked.result);
								if (!result.isError && result.content.some((block) => block.type === "image")) exec.deferContext(createUserMessage({
									content: result.content,
									source: { kind: "ptc-mode" }
								}));
								for (const context of result.additionalContexts ?? []) exec.deferContext(context);
								if (result.concludesTurn) exec.concludeTurn();
								settle(result);
								while (logWork.size > maxParallel) await Promise.race(logWork);
							}
						});
						wakeup();
						drive();
					});
					if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} result discarded`);
					if (outcome.isError) throw new Error(outcome.message);
					return outcome.value;
				};
				const functions = Object.create(null);
				for (const schema of registry.schemas(exec.agent)) {
					if (schema.name === "run_code") continue;
					Object.defineProperty(functions, schema.name, {
						enumerable: true,
						value: binding(deepFreeze(schema))
					});
				}
				try {
					let result;
					try {
						if (exec.agent !== void 0) {
							const agent = exec.agent;
							let runtimes = stateOwners.get(agent);
							if (runtimes === void 0) stateOwners.set(agent, runtimes = /* @__PURE__ */ new WeakSet());
							let provider = runtime;
							for (;;) {
								const original = provider[symbols.original];
								if (original === void 0) break;
								provider = original;
							}
							if (!runtimes.has(provider)) {
								agent.ctx.effect(() => () => runtime.release(agent), "PTC retained environment");
								runtimes.add(provider);
							}
						}
						result = await runtime.run(runtime.resolve({
							program: args.code,
							...exec.agent === void 0 || policy?.mode !== standingPolicy?.mode ? {} : { stateOwner: exec.agent },
							bindings: [{
								global: "tools",
								functions,
								errorClass: {
									name: "ToolCallError",
									memberNameProperty: "toolName"
								}
							}],
							signal: runController.signal,
							...cwd !== void 0 ? { cwd } : {},
							...policy !== void 0 ? { sandboxPolicy: policy } : {},
							...args.timeoutMs !== void 0 ? { timeoutMs: args.timeoutMs } : {}
						}));
					} finally {
						runController.abort("run_code settled");
						await drainDispatches();
					}
					if (result.error) {
						const logsText = result.logs.length > 0 ? `\nCaptured output:\n${result.logs.join("\n")}` : "";
						const sandboxText = result.sandbox === void 0 ? "" : `\nFile sandbox: ${result.sandbox.mode}${result.sandbox.enforcement === void 0 ? "" : `; enforcement: ${result.sandbox.enforcement}`}${result.sandbox.denied ? "; operation denied" : ""}.`;
						throw new CodeRunFailedError(`code run failed (${result.error.kind}): ${result.error.message}${logsText}${sandboxText}${result.sandbox?.denied ? escalationGuidance(runtime) : ""}`);
					}
					return {
						logs: result.logs,
						...result.sandbox === void 0 ? {} : { sandbox: result.sandbox },
						...result.value !== void 0 ? { result: result.value } : {}
					};
				} finally {
					callSignal.removeEventListener("abort", onOuterAbort);
				}
			};
			return runtime.sandboxMode === void 0 || exec.agent === void 0 ? run(exec.signal) : calls.run(exec.agent.session.id, exec.signal, () => options.resolveSandboxPolicy(exec).mode, run);
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.description,
			kind: "execute",
			rawInput: args.code
		})
	});
	Object.defineProperty(definition, "description", {
		enumerable: true,
		get: () => {
			const runtime = peekRuntime();
			const instructions = runtime?.executionInstructions;
			return resolveFlavor(peekRuntime).description + (instructions ? ` ${instructions}` : "") + (runtime === void 0 ? "" : " Each program starts in the Session's current directory. Running programs keep their initial directory.") + escalationGuidance(runtime);
		}
	});
	Object.defineProperty(definition, "parameters", {
		enumerable: true,
		get: () => parameterSchemaSpecToJsonSchema({
			code: {
				type: "string",
				required: true,
				description: resolveFlavor(peekRuntime).codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			},
			...controlParameters(peekRuntime())
		})
	});
	return definition;
}
/**
* PTC mode codegen: the pure projection from registered tool schemas to the TypeScript SDK
* text the model programs against (the `tools:sdk` prompt section). Sibling of
* `json-schema.ts` — `schemas()` (native function calling) and this module (the generated
* `declare const tools` API) are two projections of the same store.
* @module @deepseek-ai/dsh-tools/src/ts-types
*/
/** Property names that are valid bare TS identifiers; anything else is quoted. */
const IDENTIFIER$1 = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Render an object key: bare when it is a valid identifier, quoted otherwise (every name stays reachable, no aliasing). */
function renderKey(name) {
	return IDENTIFIER$1.test(name) ? name : JSON.stringify(name);
}
/** One `indent`-deep line prefix (two spaces per level). */
function pad$1(indent) {
	return "  ".repeat(indent);
}
/** A one-line JSDoc block for a schema `description`, or no lines when there is none. */
function docLines$1(description, indent) {
	if (typeof description !== "string" || description.length === 0) return [];
	const collapsed = description.replace(/\s+/g, " ").trim();
	return [`${pad$1(indent)}/** ${collapsed.replaceAll("*/", String.raw`*\/`)} */`];
}
/** Render one scalar already validated by the unified schema boundary. */
function renderScalar(value) {
	return JSON.stringify(value);
}
/** Render a validated scalar `const`/`enum`, falling back to the broad type. */
function renderConstrainedScalar$1(node, type) {
	const broad = type === "integer" ? "number" : type;
	if (Object.hasOwn(node, "const")) return renderScalar(node.const);
	if (Object.hasOwn(node, "enum")) return node.enum.map(renderScalar).join(" | ");
	return broad;
}
/** Build one document from captured parts while retaining the legacy array-parenthesization test. */
function typeDocumentFrom(parts) {
	return {
		parts,
		containsUnionOrIntersection: parts.some((part) => typeof part === "string" ? part.includes("|") || part.includes("&") : part.containsUnionOrIntersection)
	};
}
/** Build a small document without an intermediate array at each call site. */
function typeDocument(...parts) {
	return typeDocumentFrom(parts);
}
/** Flatten a nested document with an explicit work stack. */
function flattenTypeDocument(document) {
	const chunks = [];
	const tasks = [document];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (typeof task === "string") {
			chunks.push(task);
			continue;
		}
		for (let index = task.parts.length - 1; index >= 0; index--) {
			const part = task.parts[index];
			/* v8 ignore next -- the loop is bounded by the captured part count. */
			if (part !== void 0) tasks.push(part);
		}
	}
	return chunks.join("");
}
/** Initialize one schema-render frame with empty aggregation state. */
function schemaRenderFrame(node, indent) {
	return {
		node,
		indent,
		phase: "start",
		children: [],
		childIndex: 0,
		childDocuments: [],
		entries: []
	};
}
/** Render an already asserted schema to a composable document. */
function renderSupportedSchema(schema, indent) {
	const frames = [schemaRenderFrame(schema, indent)];
	let rootDocument;
	const finish = (document) => {
		frames.pop();
		const parent = frames.at(-1);
		if (parent === void 0) rootDocument = document;
		else parent.childDocuments.push(document);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		if (frame.phase === "children") {
			if (frame.childIndex < frame.children.length) {
				const child = frame.children[frame.childIndex];
				/* v8 ignore next -- childIndex is bounded by children.length. */
				if (child === void 0) throw new Error("missing schema render child");
				frame.childIndex++;
				frames.push(schemaRenderFrame(child.node, child.indent));
				continue;
			}
			if (frame.kind === "oneOf") {
				const parts = [];
				for (let index = 0; index < frame.childDocuments.length; index++) {
					if (index > 0) parts.push(" | ");
					const child = frame.childDocuments[index];
					/* v8 ignore next -- child documents correspond one-to-one with children. */
					if (child !== void 0) parts.push(child);
				}
				finish(typeDocumentFrom(parts));
				continue;
			}
			if (frame.kind === "array") {
				const child = frame.childDocuments[0];
				/* v8 ignore next -- array frames always schedule exactly one child. */
				if (child === void 0) throw new Error("missing array item type");
				finish(child.containsUnionOrIntersection ? typeDocument("(", child, ")[]") : typeDocument(child, "[]"));
				continue;
			}
			const required = new Set(frame.node.required);
			const parts = ["{"];
			for (let index = 0; index < frame.entries.length; index++) {
				const entry = frame.entries[index];
				const child = frame.childDocuments[index];
				/* v8 ignore next -- object entries and child documents have the same length. */
				if (entry === void 0 || child === void 0) throw new Error("missing object property type");
				const [name, prop] = entry;
				for (const line of docLines$1(prop.description, frame.indent + 1)) parts.push("\n", line);
				parts.push("\n", `${pad$1(frame.indent + 1)}${renderKey(name)}${required.has(name) ? "" : "?"}: `, child, ";");
			}
			parts.push("\n", `${pad$1(frame.indent)}}`);
			const declared = typeDocumentFrom(parts);
			finish(frame.node.additionalProperties === false ? declared : typeDocument(declared, " & Record<string, JsonValue>"));
			continue;
		}
		const node = frame.node;
		if (node.oneOf !== void 0) {
			frame.kind = "oneOf";
			frame.children = Array.from(node.oneOf, (child) => ({
				node: child,
				indent: frame.indent
			}));
			frame.childIndex = 0;
			frame.childDocuments = [];
			frame.phase = "children";
			continue;
		}
		if (node.type === void 0) {
			finish(typeDocument("JsonValue"));
			continue;
		}
		switch (node.type) {
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				finish(typeDocument(renderConstrainedScalar$1(node, node.type)));
				break;
			case "array":
				if (node.items === void 0) finish(typeDocument("JsonValue[]"));
				else {
					frame.kind = "array";
					frame.children = [{
						node: node.items,
						indent: frame.indent
					}];
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			case "object": {
				const open = node.additionalProperties !== false;
				const entries = Object.entries(node.properties ?? {});
				if (entries.length === 0) finish(typeDocument(open ? "Record<string, JsonValue>" : "Record<string, never>"));
				else {
					frame.kind = "object";
					frame.entries = entries;
					frame.children = entries.map(([, child]) => ({
						node: child,
						indent: frame.indent + 1
					}));
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			}
			/* v8 ignore next -- assertSupportedJsonSchema narrowed this closed type union. */
			default: finish(typeDocument("unknown"));
		}
	}
	/* v8 ignore next -- every root frame produces one document. */
	return rootDocument ?? typeDocument("unknown");
}
/**
* Map one enforced JSON-Schema node to a TypeScript type literal. Supports
* every unified schema construct and returns `unknown` for malformed or
* unsupported inputs without throwing.
* @param schema - the JSON-Schema node (any shape; hostile inputs degrade).
* @param indent - the indentation level for nested object members.
* @returns the TS type text (multi-line for objects with properties).
*/
function jsonSchemaToTs(schema, indent = 0) {
	try {
		assertSupportedJsonSchema(schema);
		return flattenTypeDocument(renderSupportedSchema(schema, indent));
	} catch {
		return "unknown";
	}
}
/** Render the argument and call instructions for the selected execution syntax. */
function renderSdkInstructions(programFormat) {
	return `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\`, ${programFormat === "function-body" ? "the body of an async TypeScript function (erasable syntax only — no `enum` or namespaces; type annotations are advisory, the code runs type-stripped)" : "the program to execute"}, and \`description\`, a short summary of what the program does. The declarations below are SDK bindings for this program. A declaration does not make its name a directly callable tool; only names supplied as separate tool schemas may be called directly.`;
}
/** Render tool execution and output instructions for the selected execution syntax. */
function renderSdkProgramInstructions(programFormat) {
	return `Inside the program:

- Call tools as \`await tools.name(args)\` — quoted access for exotic names: \`tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value. Tool arguments must be lossless JSON.
- A FAILED tool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose \`message\` is human-readable — \`try/catch\` it to handle and continue.
- Independent read-only calls MAY overlap under \`Promise.all\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- ${programFormat === "function-body" ? "Emit results with `return` and/or `console.log(...)`. Only what you print or return is program output." : "Only values emitted as program output enter the conversation."} A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

Program-only SDK bindings:`;
}
/** Whether one string schema accepts the literal used by the bash example. */
function acceptsExampleString(schema, value) {
	return schema?.type === "string" && (schema.const === void 0 || schema.const === value) && (schema.enum === void 0 || schema.enum.includes(value));
}
/** Render the bash example only when its literal arguments satisfy the current parameter schema. */
function renderBashExample(schemas, programFormat) {
	const bash = schemas.find((schema) => schema.name === "bash");
	if (bash === void 0) return "";
	const parameters = bash.parameters;
	if (parameters.type !== "object") return "";
	const required = parameters.required ?? [];
	if (required.some((name) => name !== "command" && name !== "description")) return "";
	if (!acceptsExampleString(parameters.properties?.command, "pwd")) return "";
	const needsDescription = required.includes("description");
	if (needsDescription && !acceptsExampleString(parameters.properties?.description, "Show current directory")) return "";
	const description = needsDescription ? "description: 'Show current directory', " : "";
	return ` When no separate \`bash\` schema is supplied, invoke a declared \`bash\` binding inside \`run_code\`:\n\n\`run_code({ code: "${programFormat === "function-body" ? `return await tools.bash({ ${description}command: 'pwd' })` : `console.log(await tools.bash({ ${description}command: 'pwd' }))`}", description: "Show current directory" })\``;
}
/**
* Render the full `tools:sdk` prompt section: the fixed usage instructions
* plus one `declare const tools` interface covering every given tool.
* Deterministic — tools are emitted in lexicographic name order, so an
* unchanged tool set produces byte-identical text across assemblies. The sort
* is not a total order on byte-equal names, so two schemas sharing a name
* would render in argument order; the caller's visible-capability map is keyed
* by name, so the input never carries a duplicate.
* @param schemas - the tool schemas to declare (the caller excludes
*   `run_code` itself).
* @param programFormat - Runtime syntax; function bodies support returning a result, REPLs print it.
* @returns the complete section text.
*/
function renderToolsSdk(schemas, programFormat = "function-body") {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const argsMembers = [];
	const outputMembers = [];
	for (const schema of sorted) {
		argsMembers.push(...docLines$1(schema.description, 1));
		argsMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.parameters, 1)};`);
		outputMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.output, 1)};`);
	}
	const declaration = [
		`interface ToolArgsMap {${argsMembers.length > 0 ? `\n${argsMembers.join("\n")}\n` : ""}}`,
		`interface ToolOutputMap {${outputMembers.length > 0 ? `\n${outputMembers.join("\n")}\n` : ""}}`,
		"type ToolName = keyof ToolOutputMap",
		[
			"declare class ToolCallError extends Error {",
			"  readonly name: \"ToolCallError\";",
			"  readonly toolName: ToolName;",
			"}"
		].join("\n"),
		[
			"declare const tools: {",
			"  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;",
			"}"
		].join("\n")
	].join("\n\n");
	const jsonValue = "type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }";
	const instructions = renderSdkInstructions(programFormat);
	const programInstructions = renderSdkProgramInstructions(programFormat);
	return `${instructions}${renderBashExample(sorted, programFormat)}\n\n${programInstructions}\n\n\`\`\`ts\n${jsonValue}\n\n${declaration}\n\`\`\``;
}
/**
* PTC mode codegen — Python flavor. The pure projection from registered tool schemas to the
* Python SDK text the model programs against under `runtime.language === 'python'`. Sibling of
* {@link ./ts-types.ts | ts-types.ts}; the two files are two projections of the same registry
* store, keyed by the loaded {@link @deepseek-ai/dsh-ptc-runtime#PtcRuntime.language | PTC
* runtime's language}.
*
* Under `mode: 'ptc'` the native tool schemas are omitted from the request, so this generated
* SDK is the model's ONLY source for each tool's argument names, required fields, types,
* descriptions, and canonical output types. Object-shaped arguments and outputs render as one
* named `TypedDict` per tool (and per nested object), not an opaque `dict[str, Any]`, so the
* shape survives into the program under the mode that has nothing else to carry it.
* @module @deepseek-ai/dsh-tools/src/py-types
*/
/**
* The reference grammar's `xid_start xid_continue*` — the set
* `str.isidentifier()` accepts on a CPython whose Unicode tables match the
* engine's. See {@link isBareIdentifier} for what a version skew does.
*/
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;
/**
* Whether a name can be emitted as a bare Python identifier rather than
* routed to the subscript/`dict[str, Any]` path.
*
* Python identifiers are not ASCII: `路径` is as legal a field name as `path`,
* and rejecting it would degrade the whole enclosing object, dropping every
* field's name, requiredness, and type — information whose only source under
* `mode: 'ptc'` is this generated text.
*
* NFKC stability is a second and separate condition, because CPython
* normalizes identifiers at compile time while JSON keys are compared as
* written: `ﬁeld` would be declared and reachable as `field`, so the SDK would
* advertise a key under a spelling the harness never accepts, and two keys
* that normalize together would collapse into one declaration. Those names
* take the subscript path, which carries their exact bytes.
*
* `IDENTIFIER` matches `str.isidentifier()` (measured on Node 22.23.1 vs
* CPython 3.9.6 tables): the equivalence holds inside the two versions' shared
* tables, and the skew characters below are exactly where that pair diverges.
* The predicate as a whole is deliberately stricter than `isidentifier()`,
* which does not test NFKC stability: `'ﬁeld'.isidentifier()` is True and
* this returns false.
*
* Both conditions are evaluated against the ENGINE's Unicode tables, and the
* two sides are versioned independently — `\p{XID_Start}`/`\p{XID_Continue}`
* follow the running engine (Node 22.23.1 reports Unicode 17.0) while CPython
* follows its own (3.9.6 reports 13.0.0). The skew is not symmetric. A CPython
* older than the engine is the dangerous direction: a character added to either
* property since its tables (U+10570 Vithkuqi and U+1E290 Toto, 14.0; U+1E4D0
* Nag Mundari, 15.0; U+1C89 Cyrillic TJE, 16.0 — ages per `DerivedAge.txt`; all
* four are NFKC-stable and accepted here, and all four are `Cn` on that 3.9.6,
* which rejects them) is emitted bare and its tokenizer refuses the character,
* taking the whole SDK block down — the same parseability invariant
* {@link UNPRINTABLE}, {@link LONE_SURROGATE} and {@link MAX_LIST_NESTING}
* exist for. Both properties carry it: a character added only to `XID_Continue`
* passes the trailing `\p{XID_Continue}*` in a tail position and fails the same
* way — U+200C ZWNJ and U+200D ZWJ are that case, gaining `XID_Continue` in UCD
* 15.1 and absent from it in 13.0.0, 14.0.0 and 15.0.0, so `a\u{200C}b` is
* emitted bare here while `isidentifier()` is False on 3.9.6 and on 3.12.13
* (15.0.0). A CPython newer than the engine only routes a legal name to the
* subscript/`dict[str, Any]` path: less readable, still correct. The NFKC
* condition reduces to the same skew, since normalization stability guarantees
* an assigned character's normalization never changes afterwards.
*
* This predicate is not the only reader of engine tables. {@link camelCase}
* reads them at three further points — its split set, its head test, and its
* `toUpperCase()` case mapping — and this predicate's verdict gates none of
* them: a class name derived there reaches emitted text whenever any object
* shape in the tool's schema declares a `TypedDict`, including for a tool this
* predicate rejected. A tool named `zz-\u{1E4D0}x` with such parameters never
* reaches the skew here (the `-` rejects it outright) yet emits `class
* Zz\u{1E4D0}xArgs`, which that same 3.9.6 refuses — Nag Mundari arrived two
* releases after its tables. The case mapping is a separate table rather than
* an XID membership test, and it fails on names both conditions above accept:
* `\u{019B}` is XID_Start and NFKC-stable, so this predicate accepts it and
* `async def \u{019B}` compiles on 3.9.6, but Node uppercases it to
* `\u{A7DC}` — unassigned in that CPython, whose own `.upper()` is the identity
* here — and the declared `class \u{A7DC}Args` fails with `invalid
* non-printable character U+A7DC`. Closing the exposure therefore covers all
* four read points, not this predicate alone; it needs the target interpreter's
* version, which the backend reporting `language: 'python'` owns; the
* language-dispatch Agent Note records the deferral.
*
* The `ts-types` sibling keeps its own ASCII rule rather than sharing this
* one: ECMAScript identifiers are a different set (`$`) and are never
* normalized, so one predicate cannot be correct for both. ZWJ/ZWNJ are not
* part of that difference — both sets carry them on the engine's tables; what
* separates the two there is the CPython table version above.
* @param name - the raw schema field or tool name.
* @returns whether the name can be emitted bare.
*/
function isBareIdentifier(name) {
	return IDENTIFIER.test(name) && name.normalize("NFKC") === name;
}
/**
* Python hard keywords: reserved everywhere, so a tool or field named
* ``class`` or ``lambda`` is legal on the wire but not as an attribute
* (``tools.class`` would be a SyntaxError in the model program) and not as a
* class-syntax `TypedDict` field. Such a tool renders under subscript access
* and such an object degrades to ``dict[str, Any]`` — the model still reaches
* every tool and field without collisions.
* Soft keywords (``match``, ``case``, ``type``, ``_`` — the language
* reference's whole set) are deliberately ABSENT: each is special in exactly
* one syntactic position — a statement head (``match``, ``type``), a ``match``
* statement's clause head (``case``), or a pattern (``_``) — so ``match: str``
* as a field and ``async def match(...)`` as a method are both legal, and
* including them would needlessly degrade common search/regex tool fields to
* ``dict[str, Any]``. Underscore-leading names are handled separately, not
* here: a non-dunder ``__token`` name-mangles, a dunder present on
* ``object``/``type`` resolves before the proxy hook, and implicit
* special-method lookup bypasses the hook.
*/
const RESERVED = /* @__PURE__ */ new Set([
	"False",
	"None",
	"True",
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
	"__debug__"
]);
/** `typing` symbols this module may emit, in the deterministic import order. */
const TYPING_ORDER = [
	"Any",
	"Literal",
	"NotRequired",
	"Protocol",
	"TypedDict"
];
/** `indent`-deep line prefix (four spaces per level to match PEP 8 output). */
function pad(indent) {
	return "    ".repeat(indent);
}
/**
* The `Cc` code points that survive the whitespace collapse in {@link describe}
* and have no printable form: the C0 controls, DEL, and the C1 controls. Only
* U+0009 to U+000D are absent, because ECMAScript `\s` already collapsed them —
* `\s` is TAB/VT/FF/SP/NBSP/ZWNBSP/Zs plus LF/CR/LS/PS, so no C1 code point is
* in it and the whole U+0080 to U+009F block reaches this rule intact. Those
* are not hypothetical input: they are what Windows-1252 bytes 0x80 to 0x9F
* (smart quotes, em dash) become when decoded as Latin-1.
* CPython rejects source containing a NUL outright
* (`SyntaxError: source code string cannot contain null bytes`), whether it
* sits in a docstring or in a comment, so one such byte anywhere in a schema
* description would make the whole generated SDK unparseable — under
* `mode: 'ptc'`, the model's only declaration of the tools. The rest are
* legal but invisible; escaping them with the same rule keeps the emitted text
* readable and the treatment uniform.
*
* The boundary is the category, not per-code-point addressability: `\xNN`
* addresses U+0000 to U+00FF, so one escape form covers `Cc` exactly. The
* invisible `Cf` formatting characters pass through by design — of them only
* U+00AD soft hyphen would fit `\xNN` at all, and escaping that one while
* U+200B ZWSP, U+200E/U+200F bidi marks, and U+2060 word joiner passed through
* would leave a rule that is neither category- nor addressability-shaped. The
* whole family is legal in both consumers, since only LF and CR terminate a
* Python string literal or a `#` comment. That set is the tokenizer's, not
* `str.splitlines()`': NEL (U+0085), LS (U+2028), and PS (U+2029) split a
* string at run time but do not end a physical line in source — measured on
* CPython 3.9.6 and 3.12.13, each accepted in both positions with the value
* round-tripping — so they are safe raw wherever they reach emitted text
* unescaped, which for all three is `JSON.stringify`, at two call sites:
* {@link pyScalar}'s literal path, and the subscript tool-name comment's own
* call, which a name carrying any of them always reaches, none being
* `XID_Continue`. The `description` path escapes NEL under the class above and
* folds LS and PS in {@link describe}'s `\s+` collapse, both being `\s`.
*/
const UNPRINTABLE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
/**
* Unpaired surrogate code points, escaped by {@link describe} as `\uNNNN` —
* its own form, since `\xNN` stops at U+00FF. The `u` flag is what makes this
* the LONE ones: in Unicode mode a well-formed pair is a single astral code
* point outside D800 to DFFF, so an emoji in a description survives untouched.
*
* This is the NUL case from {@link UNPRINTABLE}, not the invisible-character
* case. Python source must be UTF-8-encodable and a lone surrogate is not, so
* `compile()` raises `UnicodeEncodeError: surrogates not allowed` for one
* anywhere in the text — measured on 3.9 for a string literal and for a `#`
* comment alike. A raw or MCP tool description reaches this: `JSON.parse` on a
* wire `"\ud800"` escape yields exactly such a code point.
*/
const LONE_SURROGATE = /[\ud800-\udfff]/gu;
/**
* The collapsed one-line `description` of a schema node (byte-stable across
* formatting churn), or `undefined` when the node carries none. Every caller
* passes an object — a validated property node, the `ToolSdkSchema` itself, or
* the `{ description }` wrapper {@link docLines} synthesizes — so only the
* description field needs guarding. A description that collapses
* to nothing (empty, or whitespace only) is `undefined` too: it documents the
* node no better than an absent one, and emitting it would leave an empty
* `"""` docstring or a bare `#   ` line in the SDK. Only ECMAScript whitespace
* folds, so a description of whitespace plus one surviving control character is
* NOT absent: it collapses to that character's visible escape.
*
* Control characters left over after the whitespace collapse are rendered as
* their `\xNN` escapes (see {@link UNPRINTABLE}) and unpaired surrogates as
* their `\uNNNN` escapes (see {@link LONE_SURROGATE}); the escape's own backslash is
* emitted literally by both consumers, since {@link docLines} doubles it into a
* Python source escape and a `#` comment carries it verbatim.
*/
function describe(schema) {
	const description = schema.description;
	if (typeof description !== "string") return void 0;
	const collapsed = description.replace(/\s+/g, " ").replace(UNPRINTABLE, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`).replace(LONE_SURROGATE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).trim();
	return collapsed.length === 0 ? void 0 : collapsed;
}
/**
* One-line docstring for a tool `description`, or no lines when there is none.
* Backslashes are doubled first, every quote is escaped, and a trailing
* backslash cannot survive: a description ending in `"` or an odd backslash
* would otherwise merge with (or escape) the closing triple quote and make
* the generated block — PTC mode's only SDK — syntactically invalid Python.
*/
function docLines(description, indent) {
	const collapsed = describe({ description });
	if (collapsed === void 0) return [];
	const escaped = collapsed.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
	return [`${pad(indent)}"""${escaped}"""`];
}
/**
* CamelCase a name into a Python type identifier: non-identifier characters
* split words, `_` splits too (it is `XID_Continue`, so the split set names it
* explicitly), and a head that cannot start an identifier takes a `Tool`
* prefix. Unicode survives, so a `路径` field yields `路径`-based class names
* instead of collapsing to the bare prefix. A character that is not
* `XID_Continue` splits even when it is a letter, so a name whose NFKC folding
* would leave the identifier set is not carried through — the split set is the
* grammar's, not an ASCII approximation of it.
*
* The result is NFKC-normalized: these names are generated, never matched
* against a JSON key, so normalizing is free here and keeps what CPython
* compiles identical to what is emitted — unlike {@link isBareIdentifier},
* which must reject unstable names outright. Normalizing AFTER the prefix
* decision is what makes that hold at the seam the prefix creates: `Tool` +
* a combining-mark head composes there (`U+0301` gives `Tooĺ`, U+013A), so
* normalizing only the un-prefixed part would emit a name CPython compiles to
* a different symbol. The second call is idempotent on the un-prefixed arm.
*
* The split set, the head test, and `toUpperCase()` all read the engine's
* Unicode tables, so this function carries the same version skew
* {@link isBareIdentifier} documents, by paths independent of it: a class name
* derived here reaches emitted text whenever any object shape in the tool's
* schema declares a `TypedDict`, and the predicate's verdict on the tool name
* does not gate that. The case mapping is the one that can fail on a name the
* predicate accepted; the worked example is there.
* @param raw - the schema field or tool name to derive from.
* @returns a class-name segment safe to emit.
*/
function camelCase(raw) {
	const joined = raw.split(/[^\p{XID_Continue}]+|_+/u).filter((part) => part.length > 0).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("").normalize("NFKC");
	return (/^\p{XID_Start}/u.test(joined) ? joined : `Tool${joined}`).normalize("NFKC");
}
/** Class-name base cap keeping each emitted name — and total text — linear in schema depth. */
const MAX_CLASS_NAME_BASE = 120;
/**
* Deepest `list[…]` nesting emitted into one annotation before the item type
* degrades to `Any`. CPython's tokenizer rejects a logical line holding more
* than 200 simultaneously-open brackets (`MAXLEVEL`, `SyntaxError: too many
* nested parentheses`), so an array chain deeper than that would render an SDK
* block that is not valid Python at all — the same failure the docstring
* escaping in {@link docLines} exists to prevent. 180 leaves headroom for the
* few brackets an annotation can add around the chain, all of which count
* toward the same limit. Per emission site, counting brackets open at the
* chain's innermost point:
*
* - Return annotation, `async def f(self, args: X) -> chain:` — 180 `list[`
*   plus an innermost `Literal[`. The parameter list's `(` closed at the `)`
*   before the `->`, so it is NOT open here: 181.
* - TypedDict field, `field: NotRequired[chain]` — a class-body line with no
*   other open bracket, and its children start at `listDepth: 1` to reserve
*   the `NotRequired[`, so 179 `list[` plus `Literal[`: 181. Required fields
*   share that start for uniformity, spending one level of representable depth
*   on a bracket they never emit.
* - Argument annotation, `async def f(self, args: chain) -> Y:` — the `(` IS
*   still open around it: 180 `list[` plus `Literal[` plus the paren, 182, the
*   worst case. Reachable only through a raw `register()` whose `parameters`
*   is an array reached from the root through `oneOf` arms alone — the root
*   array itself, or one nested under any depth of unions, since an arm
*   inherits the enclosing depth unchanged (`A | B` opens no bracket). An
*   object ancestor takes it out of this case: its fields restart the chain at
*   the 181 site. `defineTool` compiles an object root, so the annotation is a
*   bare TypedDict class name or a one-bracket `dict[str, Any]` when that
*   object degrades — never a chain.
*
* A CPython grammar limit, not a deployment choice, so it is fixed rather than
* configurable. The sibling `ts-types` renderer needs no counterpart: nothing
* in the TypeScript grammar bounds nesting, and its SDK block is never type-
* checked. Only bracket nesting counts — a `oneOf` renders as a flat `A | B`
* chain and nested objects render as separate `class` statements, so neither
* accumulates open brackets at any depth. The invariant this cap serves is
* grammatical validity; see the `oneOf` arm in {@link renderType} for the one
* interpreter limit deliberately left uncapped.
*/
const MAX_LIST_NESTING = 180;
/**
* Cap a class-name base at {@link MAX_CLASS_NAME_BASE} (see the callers for
* why capping keeps the render linear). `slice` counts UTF-16 code units, so
* an astral character straddling the boundary would be cut in half and leave a
* lone surrogate — not an identifier character, and not even well-formed text;
* drop it rather than emit it.
*/
function capClassNameBase(base) {
	if (base.length <= MAX_CLASS_NAME_BASE) return base;
	const capped = base.slice(0, MAX_CLASS_NAME_BASE);
	return /[\uD800-\uDBFF]$/.test(capped) ? capped.slice(0, -1) : capped;
}
/**
* Reserve a unique class name from a base, suffixing `2`, `3`, … on collision.
* The base is capped at {@link MAX_CLASS_NAME_BASE} first: child class names
* derive from their parent's allocated name (`ParentChild`), so an unbounded
* schema of single-field objects would otherwise grow each name by one field
* per level and the sum of all names to Θ(depth²). Capping the base keeps each
* name — and the total emitted text — linear in depth. Collisions resume from
* the per-base counter in `state.nextClassCounter` rather than rescanning from
* `2`, so a deep chain sharing one capped base stays O(1) per allocation
* (amortized) instead of Θ(depth²) in time.
*/
function allocateClassName(base, state) {
	const capped = capClassNameBase(base);
	let name = capped;
	if (state.usedClassNames.has(name)) {
		let n = state.nextClassCounter.get(capped) ?? 2;
		while (state.usedClassNames.has(`${capped}${n}`)) n++;
		name = `${capped}${n}`;
		state.nextClassCounter.set(capped, n + 1);
	}
	state.usedClassNames.add(name);
	return name;
}
/**
* Append a child-name segment to a parent class-name base, capping the result
* at {@link MAX_CLASS_NAME_BASE}. Capping AT PROPAGATION (not only inside
* {@link allocateClassName}) keeps each level O(1): a deep `oneOf`- or
* object-chain would otherwise carry an ever-growing ConsString down the tree
* and re-materialize it (via `.length`/`.slice`) at every level — Θ(depth²).
* The bounded base plus the collision counter still yields unique names.
*
* The join is NFKC-normalized because both sides are separately normalized yet
* their concatenation need not be: a base ending in a Hangul L jamo or LV
* syllable composes with a following V or T jamo head (`가` + `ᆨ` gives `각`),
* so the emitted class name would differ from the symbol CPython compiles, and
* two byte-distinct names could fold onto one — `usedClassNames` dedupes by the
* raw bytes, so the collision counter would not see it. Normalizing costs
* O(cap + segment) per level, the same order as the `slice` it feeds. The other
* two join points need no counterpart: `Args`/`Output` start with `A`/`O` and
* {@link allocateClassName}'s suffix is digits, none of which compose backwards.
*/
function childClassName(base, segment) {
	return capClassNameBase(`${base}${segment}`.normalize("NFKC"));
}
/**
* Render one validated scalar as Python literal text (`True`/`False`,
* JSON-quoted strings, bare numbers). `null` cannot reach here: the `null`
* type renders directly as `None`, and the unified validator rejects a null
* `const`/`enum` entry on every other scalar type.
*
* A beyond-safe-range integral number takes `BigInt` digits rather than
* `String`: Python integers are arbitrary-precision, so the emitted digits ARE
* the value the model programs against, and `String` can give a different
* integer than the double holds (`2 ** 60` prints the rounded `...847000`, not
* the exact `...846976`) or no integer literal at all (`1e21` prints `1e+21`).
* `String`'s rounding is not a bug in it: `Number::toString` emits the shortest
* decimal string that re-reads to the same double, then pads to the exponent
* with zeros (1 significant digit for `1e20`, 16 for `2 ** 60`) — and when the
* shortest string is shorter than the double's exact value, those padded digits
* name an integer no double holds. Passing one back would have to cross the
* argument boundary as a JSON number — a double again — so the SDK would
* document a value no program can pass. `BigInt` needs no case split: where
* `String` is already exact (`2 ** 53`, `1e20`) the two agree byte for byte,
* and where it is not, `BigInt` is the exact one. The TS flavor needs no
* counterpart at all: its literal is re-read by a JS parser back into the same
* double.
*
* `JSON.stringify` is also what keeps this path's output parseable, and it is
* the only thing that does. It covers both classes of hazard: the two kinds of
* code point CPython refuses anywhere in source — NUL among the C0 controls,
* and the whole D800–DFFF unpaired-surrogate block, escaped under ES2019
* well-formed stringification, which the engines range guarantees — and the
* ones that break this line in particular, a bare `"` closing the literal
* early, a trailing odd backslash eating the closing quote, and a bare LF/CR
* ending it before its terminator. The `description` path carries
* {@link UNPRINTABLE} and {@link LONE_SURROGATE} because nothing quotes it,
* and folds newlines in {@link describe}.
*
* That leans on a coincidence worth naming: every escape `JSON.stringify` can
* emit (`\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`) is also a Python
* escape denoting the same character, so the emitted `Literal[...]` both
* parses and decodes back to the value the schema declared. DEL, the C1
* controls (NEL among them), and LS/PS (U+2028/U+2029) do reach it raw —
* legal but invisible, byte-for-byte as in the TS flavor; escaping them is a
* both-flavors change. Those last three are legal here for the reason
* {@link UNPRINTABLE} records: they are `str.splitlines()` boundaries, not
* tokenizer line terminators. The subscript tool-name comment quotes its name
* through its own call to the same `JSON.stringify`, never through this
* function, and inherits both halves — escapes and pass-throughs alike.
*/
function pyScalar(value) {
	if (value === true) return "True";
	if (value === false) return "False";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) return BigInt(value).toString();
	return String(value);
}
/**
* Render a validated scalar `const`/`enum` as `Literal[...]`, falling back to
* the broad type. Deliberately deviates from PEP 586, which restricts `Literal`
* parameters to int/bool/str/bytes/enum/None: a non-integral number
* `const`/`enum` emits a float literal (`Literal[1.5]`) a strict checker would
* reject. An integral one does not deviate — {@link pyScalar} emits int digits,
* including for the beyond-safe-range values it widens through `BigInt`, and
* PEP 586 admits int parameters. Harmless either way — the stub is advisory
* prompt text, only required to parse — and keeping the exact value
* communicates the constraint to the model.
*/
function renderConstrainedScalar(node, broad, state) {
	if (node.const !== void 0) {
		state.typing.add("Literal");
		return `Literal[${pyScalar(node.const)}]`;
	}
	if (node.enum !== void 0) {
		state.typing.add("Literal");
		return `Literal[${node.enum.map(pyScalar).join(", ")}]`;
	}
	return broad;
}
/**
* Map one JSON-Schema node to a Python type expression, threading `state` to
* collect the `TypedDict` declarations and `typing` symbols a full render
* needs. `className` is the name to give an object node with properties (and
* the prefix for its nested objects). Handles every unified schema construct —
* `oneOf` (→ `X | Y`), `const`/`enum` (→ `Literal[...]`), `integer` (→ `int`),
* `null` (→ `None`) — and degrades an unsupported or malformed schema to `Any`
* without throwing, the same trusted-after-validation stance as the sibling
* {@link ./ts-types.ts | ts-types} renderer. {@link jsonSchemaToPy} is the
* context-free entry point; this is the collecting core.
*/
function renderType(schema, className, state) {
	const newFrame = (schema, className, listDepth) => ({
		schema,
		className,
		phase: "start",
		listDepth,
		children: [],
		childIndex: 0,
		childTypes: [],
		entries: []
	});
	try {
		assertSupportedJsonSchema(schema);
		const frames = [newFrame(schema, className, 0)];
		let result;
		const finish = (type) => {
			frames.pop();
			const parent = frames.at(-1);
			if (parent === void 0) result = type;
			else parent.childTypes.push(type);
		};
		while (frames.length > 0) {
			const frame = frames.at(-1);
			/* v8 ignore next -- the loop condition guarantees a current frame. */
			if (frame === void 0) break;
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing python render child");
					frame.childIndex++;
					frames.push(newFrame(child.schema, child.className, child.listDepth));
					continue;
				}
				if (frame.kind === "oneOf") {
					let union = "";
					for (const [index, childType] of frame.childTypes.entries()) union = index === 0 ? childType : `${union} | ${childType}`;
					finish(union);
					continue;
				}
				if (frame.kind === "array") {
					/* v8 ignore next -- the ?? arm needs a childless array frame, which start never builds. */
					finish(`list[${frame.childTypes[0] ?? "Any"}]`);
					continue;
				}
				const node = frame.node;
				const name = frame.allocated;
				/* v8 ignore next -- typeddict frames always set node and allocated at start. */
				if (node === void 0 || name === void 0) throw new Error("missing typeddict frame state");
				const required = new Set(node.required);
				const lines = [`class ${name}(TypedDict):`];
				for (let index = 0; index < frame.entries.length; index++) {
					const entry = frame.entries[index];
					const fieldType = frame.childTypes[index];
					/* v8 ignore next -- entries and childTypes correspond one-to-one. */
					if (entry === void 0 || fieldType === void 0) throw new Error("missing typeddict field type");
					const [field, fieldSchema] = entry;
					const description = describe(fieldSchema);
					if (description !== void 0) lines.push(`${pad(1)}# ${description}`);
					if (required.has(field)) lines.push(`${pad(1)}${field}: ${fieldType}`);
					else {
						state.typing.add("NotRequired");
						lines.push(`${pad(1)}${field}: NotRequired[${fieldType}]`);
					}
				}
				if (node.additionalProperties !== false) lines.push(`${pad(1)}# Additional keys beyond those declared are allowed.`);
				if (lines.length === 1) lines.push(`${pad(1)}pass`);
				state.classes.push(lines.join("\n"));
				finish(name);
				continue;
			}
			frame.phase = "children";
			const node = frame.schema;
			if (node.oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = node.oneOf.map((branch, index) => ({
					schema: branch,
					className: childClassName(frame.className, `${index + 1}`),
					listDepth: frame.listDepth
				}));
				continue;
			}
			if (node.type === void 0) {
				state.typing.add("Any");
				finish("Any");
				continue;
			}
			switch (node.type) {
				case "string":
					finish(renderConstrainedScalar(node, "str", state));
					break;
				case "number":
					finish(renderConstrainedScalar(node, "float", state));
					break;
				case "integer":
					finish(renderConstrainedScalar(node, "int", state));
					break;
				case "boolean":
					finish(renderConstrainedScalar(node, "bool", state));
					break;
				case "null":
					finish("None");
					break;
				case "array":
					if (node.items === void 0) {
						state.typing.add("Any");
						finish("list[Any]");
						break;
					}
					if (frame.listDepth >= MAX_LIST_NESTING) {
						state.typing.add("Any");
						finish("Any");
						break;
					}
					frame.kind = "array";
					frame.children = [{
						schema: node.items,
						className: frame.className,
						listDepth: frame.listDepth + 1
					}];
					break;
				case "object": {
					const entries = Object.entries(node.properties ?? {});
					if (className === "" || !entries.every(([name]) => isBareIdentifier(name) && !RESERVED.has(name) && !(name.startsWith("__") && !name.endsWith("__")))) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					if (entries.length === 0 && node.additionalProperties !== false) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					frame.kind = "typeddict";
					frame.node = node;
					frame.allocated = allocateClassName(frame.className, state);
					state.typing.add("TypedDict");
					frame.entries = entries;
					/* v8 ignore next -- allocated is always set before children are built. */
					frame.children = entries.map(([field, child]) => ({
						schema: child,
						className: childClassName(frame.allocated ?? "", camelCase(field)),
						listDepth: 1
					}));
					break;
				}
				/* v8 ignore next 4 -- assertSupportedJsonSchema narrowed this closed type union. */
				default:
					state.typing.add("Any");
					finish("Any");
			}
		}
		/* v8 ignore next -- every root frame produces one expression. */
		return result ?? "Any";
	} catch {
		state.typing.add("Any");
		return "Any";
	}
}
/** The fixed model-facing usage contract rendered above the declarations. */
const SDK_INSTRUCTIONS = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\`, the program to execute, and \`description\`, a short summary of what the program does. At run time exactly two of the names declared below are bound: \`tools\` and \`ToolCallError\`. Everything else is a STATIC STUB describing argument and return types — in particular the \`TypedDict\` classes do NOT exist at run time, so build arguments as plain \`dict\`/\`list\` JSON values: \`await tools.name({"field": 1})\`, never \`FooArgs(field=1)\`, which raises \`NameError\`. Inside the program:

- Call tools as \`await tools.name(args)\` — subscript access for exotic, reserved, or underscore-leading names: \`await tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value (each method's return type below). Tool arguments must be lossless JSON.
- A FAILED tool call raises \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose message is human-readable — wrap in \`try/except\` to handle and continue.
- Independent read-only calls MAY overlap under \`asyncio.gather\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Only values emitted as program output enter the conversation. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

The available tools:`;
/**
* Render the full `tools:sdk` prompt section under `runtime.language ===
* 'python'`: the Python-flavored usage instructions plus one named `TypedDict`
* per tool argument or output object (and per nested object) and one awaitable
* method per visible tool on a `Tools` protocol — typed args in, the tool's
* canonical output value out — with a `tools: Tools` singleton the model calls
* into. The `typing` import line lists exactly the symbols the render used.
* Deterministic — tools are emitted in lexicographic name order, and class
* declarations precede the protocol in that same order (nested classes before
* the parent that references them), so an unchanged tool set produces
* byte-identical text across assemblies. The sort is not a total order on
* byte-equal names, so two schemas sharing a name would render in argument
* order; the caller's visible-capability map is keyed by name, so the input
* never carries a duplicate.
* @param schemas - the tool schemas plus canonical output schemas to declare
*   (the caller excludes `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdkPy(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const state = {
		classes: [],
		usedClassNames: /* @__PURE__ */ new Set(),
		nextClassCounter: /* @__PURE__ */ new Map(),
		typing: /* @__PURE__ */ new Set(["Protocol"])
	};
	const members = [];
	let statements = 0;
	for (const schema of sorted) {
		const argType = renderType(schema.parameters, `${camelCase(schema.name)}Args`, state);
		const outputType = renderType(schema.output, `${camelCase(schema.name)}Output`, state);
		if (isBareIdentifier(schema.name) && !RESERVED.has(schema.name) && !schema.name.startsWith("_")) {
			const doc = docLines(schema.description, 2);
			members.push(doc.length > 0 ? `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}:` : `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}: ...`);
			members.push(...doc);
			statements += 1;
		} else {
			members.push(`${pad(1)}# tools[${JSON.stringify(schema.name)}](args: ${argType}) -> ${outputType}`);
			const description = describe(schema);
			if (description !== void 0) members.push(`${pad(1)}#   ${description}`);
		}
	}
	const body = (statements > 0 ? members : [`${pad(1)}pass`, ...members]).join("\n");
	const imports = TYPING_ORDER.filter((symbol) => state.typing.has(symbol));
	const classBlock = state.classes.length > 0 ? `${state.classes.join("\n\n")}\n\n` : "";
	return `${SDK_INSTRUCTIONS}\n\n\`\`\`python\n${`from typing import ${imports.join(", ")}\n\nclass ToolCallError(Exception):
    toolName: str\n\n${classBlock}class Tools(Protocol):\n${body}\n\ntools: Tools`}\n\`\`\``;
}
/**
* Tool registry, model presentation modes, and pre/guard/around/post/result
* execution pipeline.
* @module @deepseek-ai/dsh-tools
*/
/**
* Language → SDK-section renderer. The registry looks up the loaded
* `ctx.ptcRuntime.language` in this table when assembling the `tools:sdk`
* section under a non-native mode; a runtime whose language is not a key
* fails the assembly loudly (same idiom as `toolOrder` violations). Adding a
* new backend language is three parallel edits — a {@link PtcSdkLanguage}
* member, an entry here, and a `RUN_CODE_FLAVORS` entry in `ptc.ts` for
* its `run_code` schema strings — plus the renderer function this table points
* at. The `satisfies` clause pins this table's key set to that union, which
* the flavor table is checked against too, so any of the three left out is a
* typecheck failure. What no check reaches is the prose that names the values
* instead of deriving them: the seam's `dsh-ptc-runtime` README pair, its
* `PtcRuntime.language` JSDoc, and `docs/subsystems/ptc-runtime.md`
* with its zh pair, plus this package's own README pair and the
* {@link Config.mode} JSDoc.
*/
/**
* The model-facing statement of the `ptc` collapse. Names the consequence
* (the call fails) and the route (inside the program), because a rule the
* model can only discover by being denied is one it corrects too late.
*/
const PTC_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.`;
const SDK_RENDERERS = {
	typescript: renderToolsSdk,
	python: renderToolsSdkPy
};
/**
* Scheduler entry point omitted from the generated named service API.
* @internal
*/
const TOOL_RUNTIME_SCHEDULER = Symbol("@deepseek-ai/dsh-tools.scheduler");
/** Canonical error code for cancellation after a tool body was invoked. */
const TOOL_ABORTED = "ABORTED";
/** Canonical error code for cancellation before a tool body was invoked. */
const TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";
/**
* Thrown (internally) when the model requests a tool that isn't registered.
* Extends {@link HarnessError} (`code: 'UNKNOWN_TOOL'`) so an unknown-tool
* failure is as routable as a tool-thrown one — retry/sandbox/replay code can
* distinguish it from a tool body's own error.
*/
var ToolNotFoundError = class extends HarnessError {
	/**
	* @param toolName - the name the caller asked for.
	* @param reachableFrom - how the model reaches this tool instead, when the
	*   name IS visible and only the presentation denies calling it directly.
	*   Omitted for a name that is registered nowhere.
	*/
	constructor(toolName, reachableFrom) {
		super(reachableFrom === void 0 ? `unknown tool "${toolName}"` : `unknown tool "${toolName}": ${reachableFrom}`, "UNKNOWN_TOOL");
		this.name = "ToolNotFoundError";
	}
};
/** Thrown when a tool body or post-policy value violates its declared output. */
var ToolOutputError = class extends HarnessError {
	/** Schema/value violations in validation order. */
	violations;
	constructor(toolName, violations) {
		super(`tool "${toolName}" returned invalid output: ${violations.join("; ")}`, "INVALID_TOOL_OUTPUT");
		this.name = "ToolOutputError";
		this.violations = violations;
	}
};
/** Convert one projector exception into the canonical invalid-output failure. */
function projectionError(toolName, projector, error) {
	return new ToolOutputError(toolName, [`output.${projector} failed: ${errorMessage(error)}`]);
}
/** Snapshot one projector result before later durable-result materialization. */
function snapshotProjection(toolName, projector, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, [`output.${projector} returned non-lossless JSON`]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw projectionError(toolName, projector, error);
	}
}
/** Snapshot one body or policy value into the canonical invalid-output failure class. */
function snapshotToolValue(toolName, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, ["value is not lossless JSON"]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw new ToolOutputError(toolName, [`value snapshot failed: ${errorMessage(error)}`]);
	}
}
/**
* Best-effort human-readable message from an arbitrary thrown value: Error
* instances use `.message`; non-Error objects with a string `message`
* property (e.g. `throw { message: 'denied' }`) use it too; everything else
* is stringified.
*/
function errorMessage(error) {
	try {
		if (error instanceof Error) return error.message;
		if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
		return String(error);
	} catch {
		return "<unprintable thrown value>";
	}
}
/** Derive one failure message from policy feedback without changing its rendered blocks. */
function failureMessageFromContent(content) {
	const text = content.map((block) => block.type === "text" ? block.text : `[${block.type} content]`).join("\n");
	return text.length > 0 ? text : "tool result blocked by post-execute policy";
}
/** Snapshot and freeze one durable tool-result projection or reject lossy data. */
function materializePresentation(candidate) {
	const detached = snapshotJsonValue(candidate);
	if (detached === void 0) throw new TypeError("tool result must be losslessly JSON-serializable");
	return deepFreeze(detached);
}
/** Structured `{ name, code }` for a thrown HarnessError, else undefined. */
function errorInfo(error) {
	try {
		return error instanceof HarnessError ? {
			name: error.name,
			code: error.code
		} : void 0;
	} catch {
		return;
	}
}
/** One scope's complete tool-registry contribution. */
var ToolLayer = class {
	tools;
	restrictions = new AnonymousEntries();
	guards = new AnonymousEntries();
	/**
	* Presentation this scope's agent declared for itself, shadowing the
	* deployment default. One cell rather than an entry table: two answers to
	* "which form does the model see" is a contradiction, not a merge.
	*/
	mode;
	constructor(scope) {
		this.tools = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `tool "${name}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)` : `tool "${name}" is already registered in this scope`));
	}
	/** Whether every contribution table in this aggregate layer is empty. */
	isEmpty() {
		return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty() && this.mode === void 0;
	}
	/** Whether every compiled restriction in this layer admits a global tool name. */
	admits(name) {
		for (const filter of this.restrictions.values()) if (filter.allow !== void 0 && !filter.allow.has(name) || filter.deny !== void 0 && filter.deny.has(name)) return false;
		return true;
	}
	/** First monotonic denial from this layer's live guard registrations. */
	guardReason(exec) {
		for (const guard of this.guards.values()) {
			const reason = guard(exec);
			if (reason !== void 0) return reason;
		}
	}
};
/** Resolve the run_code overlap cap at the owning config boundary (direct construction bypasses the Loader schema). */
function resolveMaxParallelSubCalls(value) {
	const maxParallelSubCalls = value ?? 10;
	if (!Number.isInteger(maxParallelSubCalls) || maxParallelSubCalls < 1) throw new Error("maxParallelSubCalls must be a positive integer");
	return maxParallelSubCalls;
}
(class extends Service {
	static inject = ["systemPrompt"];
	static Config = Schema.object({
		mode: Schema.union(["native", "ptc"]).default("native"),
		maxParallelSubCalls: Schema.natural().min(1).default(10)
	});
	/** Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler. */
	[TOOL_RUNTIME_SCHEDULER] = {
		prepare: (exec) => this.prepareScheduledExecution(exec),
		dispatch: (exec) => this.dispatchScheduledExecution(exec),
		finalize: (exec, result) => this.finalizeScheduledExecution(exec, result),
		finish: (exec, result) => this.finishScheduledExecution(exec, result)
	};
	/** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
	deferredContexts = /* @__PURE__ */ new WeakMap();
	/** Executions whose tool body declared the current turn complete. */
	concludingExecutions = /* @__PURE__ */ new WeakSet();
	/** Original caller cancellation, kept outside the wrapper-mutable execution object. */
	cancellationStates = /* @__PURE__ */ new WeakMap();
	/** Definition-owned final content transform snapshotted before policy begins. */
	contentFinalizers = /* @__PURE__ */ new WeakMap();
	/** Execution-prepared content installed before post-execute policy. */
	contentProjectors = /* @__PURE__ */ new WeakMap();
	layers = new ScopedLayers((scope) => new ToolLayer(scope), () => {
		this.ctx.emit("tools/change");
	});
	/** Presentation for scopes that declare none; {@link presentAs} shadows it per scope. */
	defaultMode;
	maxParallelSubCalls;
	/**
	* Reserved presentation transport, kept outside the filterable registration
	* layers. Built on first need rather than at construction: which agents run
	* a PTC mode is no longer known when the service is constructed, and the
	* transport owns its PTC call tracking and state-owner registrations.
	*/
	ptcTransport;
	ptcContext;
	constructor(ctx, config = {}) {
		super(ctx, "tools");
		this.ptcContext = ctx;
		this.defaultMode = config.mode ?? "native";
		this.maxParallelSubCalls = resolveMaxParallelSubCalls(config.maxParallelSubCalls);
		ctx.systemPrompt.tools((context) => this.wireSchemas(context.scope));
		if (this.defaultMode !== "native") {
			ctx.systemPrompt.section(this.collapseSection());
			ctx.systemPrompt.section(this.sdkSection());
		}
	}
	/**
	* The prompt statement of the `ptc` executor collapse, registered wherever
	* {@link sdkSection} is and rendering empty outside an effective `ptc`.
	*
	* Every tool contributes its own guidance section naming its tool, none of
	* them qualify how that tool is reached, and they all render before the SDK.
	* Without this the model reads a catalog of tools it is told to use and no
	* statement that only `run_code` may be called, so it emits a native call,
	* receives `UNKNOWN_TOOL` for a tool the prompt just declared, and concludes
	* the deployment is inconsistent. Its order places the rule before that
	* guidance rather than after it.
	*
	* Native scopes render no instruction.
	* @returns the section registration.
	*/
	collapseSection() {
		return {
			name: "tools:ptc-only",
			order: this.ctx.systemPrompt.getSectionOrder("PTC_ONLY"),
			text: (context) => this.modeFor(context.scope) === "ptc" ? PTC_ONLY_INSTRUCTION : ""
		};
	}
	/**
	* The generated-SDK prompt section, registered globally by a PTC mode
	* deployment and per scope by {@link presentAs}.
	*
	* The body regenerates from the CALLING scope, and renders empty for an
	* agent presenting natively — an agent that opted out under a PTC mode
	* deployment still sees the global registration, and an empty section is
	* dropped from the rendered prompt.
	* @returns the section registration.
	*/
	sdkSection() {
		return {
			name: "tools:sdk",
			order: this.ctx.systemPrompt.getSectionOrder("TOOLS_SDK"),
			interpolate: false,
			text: (context) => {
				const mode = this.modeFor(context.scope);
				if (mode === "native") return "";
				const runtime = this.requirePtcRuntime(mode);
				const render = SDK_RENDERERS[runtime.language];
				/* v8 ignore next -- requirePtcRuntime rejects an unknown language before this runs. */
				if (render === void 0) throw new Error(`dsh-tools: no SDK renderer for ${runtime.language}`);
				return render(this.sdkSchemas(context.scope), runtime.programFormat);
			}
		};
	}
	/**
	* The presentation one scope's agent sees: its own declaration, else the
	* deployment default.
	* @param scope - the calling agent, or undefined for the global view.
	* @returns the resolved presentation mode.
	*/
	modeFor(scope) {
		const layers = this.layers.chainLayers(scope);
		for (let index = layers.length - 1; index >= 0; index -= 1) {
			const mode = layers[index]?.mode;
			if (mode !== void 0) return mode;
		}
		return this.defaultMode;
	}
	/**
	* The reserved `run_code` transport, built on first need.
	*
	* It never enters the global layer: per-agent restrictions must not remove
	* it, and a scoped registration must not shadow it. The visibility resolver
	* appends it after resolving the filterable global/scoped capability layers,
	* and only for scopes whose mode actually presents it.
	* @returns the shared transport definition.
	*/
	requirePtcTransport() {
		this.ptcTransport ??= createRunCodeTool(this, {
			resolveWorkingDirectory: async (exec) => {
				if (exec.agent === void 0) return void 0;
				const directories = this.ctx.get("workingDirectory");
				if (directories === void 0) throw new Error("dsh-tools: run_code with an Agent requires workingDirectory");
				return directories.ensure(exec.agent, exec.signal);
			},
			requireRuntime: () => this.requirePtcRuntime(this.defaultMode),
			peekApprover: () => this.ctx.get("approval"),
			resolveSandboxPolicy: (exec) => {
				const policy = this.ctx.get("sandboxPolicy");
				if (policy === void 0) throw new Error("dsh-tools: confined PTC runtime requires sandboxPolicy");
				return policy.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session });
			},
			peekRuntime: () => this.ctx.get("ptcRuntime"),
			maxParallel: this.maxParallelSubCalls,
			shapeDispatchLog: (dispatch) => this.shapeDispatchLog(dispatch)
		}, this.ptcContext);
		return this.ptcTransport;
	}
	/**
	* Present the calling scope's tools in `mode` instead of the deployment
	* default. Nearest scope on the chain wins, so a preset's standing
	* declaration covers every agent joined under it.
	*
	* Scoped only, and one declaration per scope: this is how an agent preset
	* composes PTC mode agents beside native ones in the same process, and a
	* process-global override would be the `mode` config field instead.
	* @param mode - the presentation the covered agents' models see.
	* @returns the exact disposer that restores the deployment default.
	*/
	presentAs(mode) {
		const ctx = this.ctx;
		if (scopeOf(ctx) === void 0) throw new Error("tools.presentAs() requires a scoped context (agent.ctx): a context-global presentation is the `mode` config field on the tools row");
		return ctx.effect(function* () {
			yield this.layers.effect(ctx, (layer) => {
				if (layer.mode !== void 0) throw new Error(`tools.presentAs("${mode}") conflicts with "${layer.mode}" already declared for this scope; one composition selects one presentation`);
				layer.mode = mode;
				return () => {
					layer.mode = void 0;
				};
			}, { label: "tools.presentAs()" });
			if (mode !== "native") {
				yield ctx.systemPrompt.section(this.collapseSection());
				yield ctx.systemPrompt.section(this.sdkSection());
			}
		}.bind(this), "tools.presentAs()");
	}
	/**
	* Build one scope's wire schemas and names for prompt-order validation.
	* Restrictions do not make known tools invalid, but a mode collapse does.
	*/
	wireSchemas(scope) {
		const view = this.view(scope);
		const mode = this.modeFor(scope);
		if (mode === "native") return {
			schemas: [...view.visible.values()].map((definition) => this.schemaOf(definition, false)),
			knownNames: [...view.knownNames]
		};
		this.requirePtcRuntime(mode);
		return {
			schemas: [...view.visible.values()].map((definition) => this.schemaOf(definition, false)).filter((schema) => schema.name === RUN_CODE_NAME),
			knownNames: [RUN_CODE_NAME]
		};
	}
	/**
	* Resolve the PTC runtime or throw the actionable misconfiguration error.
	* Read at use time (assembly / run_code execution), NOT via static
	* `inject`: an inject entry would hold `ctx.tools` — and every tool plugin
	* behind it — hostage to a PTC runtime existing even under `mode:
	* 'native'`.
	*
	* Assembly and `run_code` execution read separately, so the language is not
	* bound to a request. Harmless while one published backend exists — both
	* reads return the same flavor — but a reload that swapped in a second
	* language between them would hand a program written against one SDK to the
	* other. Binding it is deferred until a second backend ships (the first
	* point it is testable).
	*/
	requirePtcRuntime(mode) {
		const runtime = this.ctx.get("ptcRuntime");
		if (!runtime) throw new Error(`dsh-tools: mode "${mode}" requires a PTC runtime — load a ctx.ptcRuntime implementation (e.g. @deepseek-ai/dsh-ptc-runtime-node) or set tools mode to "native"`);
		if (!Object.hasOwn(SDK_RENDERERS, runtime.language)) {
			const known = Object.keys(SDK_RENDERERS).map((name) => JSON.stringify(name)).join(", ");
			throw new Error(`dsh-tools: no SDK renderer registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
		}
		return runtime;
	}
	/**
	* Register globally or in the calling agent scope. Scoped tools shadow
	* globals; duplicates within one layer and the reserved `run_code` name fail.
	* @param definition - tool schema, execution, and optional finalization/presentation callbacks.
	* @returns the exact disposer that unregisters the tool.
	*/
	register(definition) {
		const name = definition.name;
		const output = definition.output;
		if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || output.presentationMeta !== void 0 && typeof output.presentationMeta !== "function") throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
		assertSupportedJsonSchema(output.schema);
		const timeoutMs = definition.timeoutMs;
		if (timeoutMs !== void 0 && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`);
		if (name === "run_code") throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`);
		return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), { label: "tools.register()" });
	}
	/**
	* Restrict global tools for the calling agent scope. Empty filters, unknown
	* names, scope-local names, and reserved transport names fail. Restrictions
	* intersect; scoped registrations remain visible.
	* @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
	* @returns the exact disposer that lifts this restriction.
	*/
	restrict(filter) {
		const scope = scopeOf(this.ctx);
		if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");
		const allow = filter.allow;
		const deny = filter.deny;
		if (allow === void 0 && deny === void 0) throw new Error("tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)");
		const compiled = {
			...allow !== void 0 ? { allow: new Set(allow) } : {},
			...deny !== void 0 ? { deny: new Set(deny) } : {}
		};
		if ([...allow ?? [], ...deny ?? []].includes("run_code")) throw new Error(`tools.restrict() cannot name reserved PTC mode presentation transport "${RUN_CODE_NAME}"; restrict end-capability tools instead`);
		const known = this.view(scope).restrictableNames;
		const unknown = [...allow ?? [], ...deny ?? []].filter((name) => !known.has(name));
		if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ") || "(none)"}`);
		return this.layers.effect(this.ctx, (layer) => layer.restrictions.append(compiled), { label: "tools.restrict()" });
	}
	/**
	* Register a monotonic guard after the extensible `tools/pre-execute`
	* waterfall. A plain-context guard applies globally; one registered through
	* `agent.ctx` applies only to that agent. Any matching guard may deny by
	* returning a reason, while no guard can force-allow a call another guard
	* denied. The exact effect disposer is returned for ordered ownership and
	* HMR cleanup.
	* @param guard - synchronous check; a returned string denies the execution.
	* @returns the exact disposer that unregisters the guard.
	*/
	guard(guard) {
		return this.layers.effect(this.ctx, (layer) => layer.guards.append(guard), {
			label: "tools.guard()",
			notify: false
		});
	}
	/** First monotonic denial from the global then the scope chain's guard layers, farthest first. */
	guardReason(exec) {
		const globalReason = this.layers.global.guardReason(exec);
		if (globalReason !== void 0) return globalReason;
		if (exec.agent === void 0) return void 0;
		for (const layer of this.layers.chainLayers(exec.agent)) {
			const reason = layer.guardReason(exec);
			if (reason !== void 0) return reason;
		}
	}
	/**
	* Resolve every registry fact one scope needs in one layer traversal. The
	* visible map applies restrictions to the INHERITED surface, then the
	* scope's own registrations and the reserved presentation transport; the
	* other sets retain the pre-restriction facts needed by restriction and
	* prompt-order validation.
	*
	* A restriction filters what a scope inherits — the global layer and every
	* ancestor layer on its chain — and never what its OWN layer registers.
	* That exemption is what a per-child capability filter has to keep intact:
	* the delegation runtime registers a child's structured-output tool into the
	* child's own layer, and a filter naming the capabilities the child may use
	* must not strip the machinery it answers through.
	*
	* Reading the exempt set as "the global layer" instead of "not mine" held
	* only while every model-facing tool sat in the host composition. Once
	* presets moved them onto the agent plane they became an ANCESTOR
	* contribution, so a child's filter silently stopped constraining anything
	* it was given.
	* @param scope - the viewing scope (the agent), or undefined for the global view.
	* @returns the complete derived view for that scope.
	*/
	view(scope) {
		const layers = this.layers.chainLayers(scope);
		const own = this.layers.peek(scope);
		const inherited = new Map(this.layers.global.tools.entries());
		for (const layer of layers) {
			if (layer === own) continue;
			for (const [name, definition] of layer.tools.entries()) inherited.set(name, definition);
		}
		const visible = /* @__PURE__ */ new Map();
		const knownNames = /* @__PURE__ */ new Set();
		const restrictableNames = /* @__PURE__ */ new Set();
		for (const [name, definition] of inherited) {
			knownNames.add(name);
			restrictableNames.add(name);
			if (layers.every((layer) => layer.admits(name))) visible.set(name, definition);
		}
		if (own !== void 0) for (const [name, definition] of own.tools.entries()) {
			knownNames.add(name);
			visible.set(name, definition);
		}
		if (this.modeFor(scope) !== "native") visible.set(RUN_CODE_NAME, this.requirePtcTransport());
		return {
			visible,
			knownNames,
			restrictableNames
		};
	}
	/**
	* Look up a tool as one scope sees it (scoped
	* shadows global; a restricted-away global reads as absent). Presenters pass
	* the calling agent so the rendered card matches the definition that
	* actually executed.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns the definition the scope resolves, or undefined when none is visible.
	*/
	get(name, scope) {
		return this.view(scope).visible.get(name);
	}
	/**
	* Resolve the definition that MAY EXECUTE for a call, applying the mode
	* collapse at the operation boundary that owns it. The registry view
	* (`get`) is presentation-agnostic; here a MODEL-DIRECT call under `ptc`
	* may only name the reserved `run_code` transport, while a nested
	* sub-dispatch (a `parent` token set — the `run_code` SDK calling a tool
	* it bound) may call any visible tool. Denial surfaces as `UNKNOWN_TOOL`
	* through the executor, matching an absent definition.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	* @returns the definition that may run, or undefined when the call must be rejected.
	*/
	resolveExecution(name, scope, nested) {
		const tool = this.get(name, scope);
		if (tool === void 0) return void 0;
		if (this.collapses(name, scope, nested)) return void 0;
		return tool;
	}
	/**
	* Project visible definitions onto the allowlisted model-facing schema fields,
	* excluding execution and presentation callbacks.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns one deep-cloned schema per visible tool.
	*/
	schemas(scope) {
		return [...this.view(scope).visible.values()].map((definition) => this.schemaOf(definition, true));
	}
	/** Project visible callable tools onto the generated PTC mode SDK contract. */
	sdkSchemas(scope) {
		return [...this.view(scope).visible.values()].filter((definition) => definition.name !== RUN_CODE_NAME).map((definition) => {
			const output = snapshotJsonValue(definition.output.schema);
			/* v8 ignore next -- registration already validated and retained this schema as lossless JSON. */
			if (output === void 0) throw new Error(`tool "${definition.name}" output schema must be lossless JSON before SDK projection`);
			return {
				...this.schemaOf(definition, true),
				output
			};
		});
	}
	/** Project one definition onto the model-facing schema fields. */
	schemaOf(definition, detachParameters) {
		const { name, description, parameters, deferLoading } = definition;
		const detached = detachParameters ? snapshotJsonValue(parameters) : parameters;
		if (detached === void 0) throw new Error(`tool "${name}" parameters must be lossless JSON before schema projection`);
		return {
			name,
			description,
			parameters: detached,
			...deferLoading === true ? { deferLoading } : {}
		};
	}
	/**
	* Classify a pending call through the caller's visible tool definition. Only
	* an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
	* throwing classifiers are exclusive.
	* @param exec - call name, parsed arguments, and optional agent scope.
	* @returns the fail-closed scheduling mode.
	*/
	executionMode(exec) {
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (!tool?.isConcurrencySafe) return { kind: "exclusive" };
		try {
			return tool.isConcurrencySafe(exec.arguments) === true ? { kind: "parallel" } : { kind: "exclusive" };
		} catch {
			return { kind: "exclusive" };
		}
	}
	/**
	* Run the `tools/ptc-dispatch-log` waterfall over one settled sub-dispatch
	* and return the content the bridge should log on `tool/ptc-dispatch`.
	* Contained: when a listener throws, the method logs the original settled
	* content; that failure must not fail the dispatch or omit the settle event. Private:
	* the ONE consumer is the `run_code` bridge this registry constructs, which
	* receives it as a capability parameter (the `requireRuntime` idiom) — the
	* waterfall, not this invoker, is the public extension point.
	*/
	async shapeDispatchLog(dispatch) {
		try {
			return await this.ctx.waterfall(scopeTarget(this, dispatch.agent), "tools/ptc-dispatch-log", dispatch, () => Promise.resolve(dispatch.content));
		} catch (error) {
			this.ctx.logger.warn(`tools: ptc-dispatch-log listener failed for ${dispatch.name}: ${errorMessage(error)}; logging the original settled content`);
			return dispatch.content;
		}
	}
	/**
	* Whether the `ptc` mode collapse denies a model-direct call: only the
	* reserved `run_code` transport may be named. Nested sub-dispatches (a
	* `parent` token set) bypass the collapse. One home for the
	* security-relevant predicate, shared by {@link resolveExecution} and
	* {@link createExecution} so the two can never drift apart.
	*
	* Resolved through {@link modeFor}, NOT `defaultMode`: an agent given `ptc`
	* by an agent preset under a native deployment is the composition
	* `dsh-agent-tool-presentation` exists for, and reading the deployment default would
	* leave exactly that agent uncollapsed — announcing one surface while
	* executing another, which is the bypass this collapse closes.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope whose effective presentation mode applies.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	*/
	collapses(name, scope, nested) {
		return !nested && this.modeFor(scope) === "ptc" && name !== "run_code";
	}
	/**
	* Execute through pre-policy, guards, around-dispatch, post-policy,
	* definition-owned content finalization, and final notification. Tool and
	* listener failures resolve as materialized error results; an invisible tool
	* reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
	* snapshot final observers receive. Cancellation
	* arriving after entry and before final result materialization skips a
	* not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
	* successful started outcome with `ABORTED`; already-started work is still
	* drained and may retain a tool-owned structured error.
	* @param exec - the typed same-process call input. The registry assigns its
	*   correlation token before policy begins.
	* @returns the materialized final result.
	*/
	async execute(exec) {
		return this.prepareExecution(exec, (prepared) => this.completeScheduledExecution(prepared));
	}
	async completeScheduledExecution(prepared) {
		switch (prepared.kind) {
			case "dispatch": {
				const dispatched = await this.dispatchScheduledExecution(prepared.exec);
				return dispatched.kind === "post-result" ? await this.finalizeScheduledExecution(prepared.exec, dispatched.result) : this.finishScheduledExecution(prepared.exec, dispatched.result);
			}
			case "post-result": return await this.finalizeScheduledExecution(prepared.exec, prepared.result);
			case "final-result": return this.finishScheduledExecution(prepared.exec, prepared.result);
			/* v8 ignore next -- closed-union exhaustiveness guard */
			default: return assertNever(prepared, "scheduled tool preparation");
		}
	}
	createExecution(exec) {
		const deferredContexts = [];
		const token = createExecutionToken();
		const callId = exec.callId;
		const rootCallId = exec.rootCallId ?? callId;
		const name = exec.name;
		const agent = exec.agent;
		const parent = exec.parent;
		const signal = exec.signal;
		const visible = this.get(name, agent);
		const collapsed = visible !== void 0 && this.collapses(name, agent, parent !== void 0);
		const concludingExecutions = this.concludingExecutions;
		const base = {
			token,
			callId,
			rootCallId,
			name,
			signal,
			...agent !== void 0 ? { agent } : {},
			...parent !== void 0 ? { parent } : {},
			...exec.schema !== void 0 ? { schema: exec.schema } : {},
			deferContext(context) {
				deferredContexts.push(context);
			},
			concludeTurn() {
				concludingExecutions.add(this);
			}
		};
		const capturedFinalizer = visible?.finalizeContent?.bind(visible);
		const capturedProjector = visible?.projectContent?.bind(visible);
		const finalizerFor = () => collapsed && !signal.aborted ? void 0 : capturedFinalizer;
		try {
			const detached = snapshotJsonValue(exec.arguments);
			if (detached === void 0) throw new TypeError("tool execution arguments must be losslessly JSON-serializable");
			const execution = {
				...base,
				arguments: deepFreeze(detached)
			};
			this.deferredContexts.set(execution, deferredContexts);
			this.contentFinalizers.set(execution, finalizerFor());
			if (!collapsed) this.contentProjectors.set(execution, capturedProjector);
			this.cancellationStates.set(execution, {
				callerSignal: signal,
				bodyInvoked: false
			});
			if (collapsed) {
				if (signal.aborted) return {
					kind: "final-result",
					exec: execution,
					result: toolAbortedBeforeDispatchResult()
				};
				return {
					kind: "final-result",
					exec: execution,
					result: toolErrorResult(new ToolNotFoundError(name, `only \`${RUN_CODE_NAME}\` is callable directly — call \`${name}\` from inside a \`${RUN_CODE_NAME}\` program instead`))
				};
			}
			return {
				kind: "ready",
				exec: execution
			};
		} catch (error) {
			const execution = {
				...base,
				arguments: void 0
			};
			this.contentFinalizers.set(execution, finalizerFor());
			return {
				kind: "final-result",
				exec: execution,
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run the ordered pre-execute and monotonic guard stages for the scheduler.
	* @param input - the caller-supplied execution input.
	* @returns the prepared execution plus the next scheduler stage.
	* @internal
	*/
	async prepareScheduledExecution(input) {
		return this.prepareExecution(input, (prepared) => prepared);
	}
	async prepareExecution(input, next) {
		const created = this.createExecution(input);
		if (created.kind !== "ready") return next(created);
		const exec = created.exec;
		if (this.callerCancelled(exec)) return next({
			kind: "final-result",
			exec,
			result: toolAbortedBeforeDispatchResult()
		});
		try {
			const carrier = scopeTarget(this, exec.agent);
			const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));
			const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : {
				decision: gate,
				approvalCancelled: false
			};
			const { decision } = askResolution;
			if (this.callerCancelled(exec) && askResolution.approvalCancelled) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			if (decision.kind === "cancel") return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			const denialReason = decision.kind === "allow" ? this.guardReason(exec) : decision.reason;
			const denialInfo = decision.kind === "deny" ? decision.info : void 0;
			if (denialReason !== void 0) return await next({
				kind: "post-result",
				exec,
				result: this.materializeFinalResult({
					content: [{
						type: "text",
						text: `Error: ${denialReason}`
					}],
					isError: true,
					error: {
						message: denialReason,
						...denialInfo === void 0 ? {} : { info: denialInfo }
					}
				})
			});
			if (this.callerCancelled(exec)) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			return await next({
				kind: "dispatch",
				exec
			});
		} catch (error) {
			return next({
				kind: "final-result",
				exec,
				result: toolErrorResult(error)
			});
		}
	}
	/** Whether the original caller signal is currently aborted. */
	callerCancelled(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.callerSignal.aborted;
	}
	/** Canonical cancellation outcome selected by whether the tool body started. */
	cancellationResult(exec, prior) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.bodyInvoked ? toolAbortedResult(prior) : toolAbortedBeforeDispatchResult(prior);
	}
	/**
	* Dispatch the registered body with the original caller signal fused back
	* into any around-wrapper replacement. Cancellation never abandons the body:
	* a started promise reaches quiescence before its outcome becomes `ABORTED`.
	*/
	async dispatchToolBody(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		const wrapperSignal = exec.signal;
		const fused = fuseToolSignals(state.callerSignal, wrapperSignal);
		const signal = fused.signal;
		if (isAborted(signal)) {
			fused.dispose();
			return toolAbortedBeforeDispatchResult();
		}
		exec.signal = signal;
		try {
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (!tool) throw new ToolNotFoundError(exec.name);
			state.bodyInvoked = true;
			const returned = await tool.execute(exec.arguments, exec);
			const result = this.createSuccessResult(exec, tool, returned);
			return isAborted(signal) ? toolAbortedResult(result) : result;
		} catch (error) {
			return toolErrorResult(error);
		} finally {
			fused.dispose();
			exec.signal = wrapperSignal;
		}
	}
	/**
	* Run around-dispatch and the tool body. Tool and unknown-tool failures still
	* receive post-execute; pipeline failures are already final.
	* @param exec - the prepared execution.
	* @returns whether the result still needs post-execute.
	* @internal
	*/
	async dispatchScheduledExecution(exec) {
		try {
			const mutableExec = exec;
			const carrier = scopeTarget(this, exec.agent);
			const result = await this.ctx.waterfall(carrier, "tools/execute", mutableExec, () => this.dispatchToolBody(mutableExec));
			const normalized = this.normalizeDispatchResult(exec, result);
			const deferredContexts = this.deferredContexts.get(exec);
			/* v8 ignore next -- dispatch only receives executions minted by this registry's prepare stage */
			if (deferredContexts === void 0) throw new Error("tool registry scheduler invariant violated: unprepared execution");
			const resultWithDeferredContexts = deferredContexts.length === 0 ? normalized : this.markCanonical(exec, {
				...normalized,
				additionalContexts: [...deferredContexts, ...normalized.additionalContexts ?? []]
			});
			return {
				kind: "post-result",
				result: this.callerCancelled(exec) && !resultWithDeferredContexts.isError ? this.cancellationResult(exec, resultWithDeferredContexts) : resultWithDeferredContexts
			};
		} catch (error) {
			return {
				kind: "final-result",
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run ordered post-execute, then apply definition-owned content finalization,
	* materialize, and notify the final outcome.
	* @param exec - the prepared execution.
	* @param result - dispatch/pre result that still needs post-execute.
	* @returns the materialized final result.
	* @internal
	*/
	async finalizeScheduledExecution(exec, result) {
		try {
			const project = this.contentProjectors.get(exec);
			this.contentProjectors.delete(exec);
			const content = project?.(exec, result);
			const projected = content === void 0 ? result : this.markCanonical(exec, this.materializeFinalResult({
				...result,
				content
			}));
			const postResult = await this.postExecute(exec, projected);
			return this.finishScheduledExecution(exec, this.callerCancelled(exec) && !postResult.isError ? this.cancellationResult(exec, postResult) : postResult);
		} catch (error) {
			return this.finishScheduledExecution(exec, toolErrorResult(error));
		}
	}
	/**
	* Materialize the candidate, apply definition-owned content finalization,
	* then materialize and notify the authoritative result.
	* @param exec - the prepared execution.
	* @param result - final result.
	* @returns the materialized final result.
	* @internal
	*/
	finishScheduledExecution(exec, result) {
		let materializedResult;
		try {
			materializedResult = this.materializeFinalResult(result);
		} catch (error) {
			materializedResult = this.materializeFinalResult(toolErrorResult(error));
		}
		let finalResult;
		try {
			finalResult = this.materializeFinalResult(this.applyFinalContent(exec, materializedResult));
		} catch (error) {
			finalResult = this.materializeFinalResult(toolErrorResult(error));
		}
		this.notifyResult(exec, finalResult);
		return finalResult;
	}
	/** Apply the snapshotted tool-owned content transform without exposing other result fields. */
	applyFinalContent(exec, result) {
		const finalizeContent = this.contentFinalizers.get(exec);
		if (finalizeContent === void 0) return result;
		const content = finalizeContent(exec, result);
		return content === void 0 ? result : {
			...result,
			content
		};
	}
	/** Notify observers without exposing a mutation or error channel into the outcome. */
	notifyResult(exec, result) {
		Object.freeze(exec);
		const { name: toolName, callId } = exec;
		const reportFailure = (error) => {
			this.ctx.logger.warn(`tool "${toolName}" (${callId}): tools/result observer failed: ${errorMessage(error)}`);
		};
		const callbacks = this.ctx.events.dispatch("emit", [
			scopeTarget(this, exec.agent),
			"tools/result",
			exec,
			result
		]);
		for (const callback of callbacks) try {
			const returned = callback(exec, result);
			Promise.resolve(returned).catch(reportFailure);
		} catch (error) {
			reportFailure(error);
		}
	}
	/**
	* Resolve an `ask` decision to allow/deny through the approval seam. The
	* seam is consumed opportunistically with `ctx.get('approval')` — a
	* deployment that composes no ApprovalService keeps the historical degrade
	* to deny, and an unmount mid-session degrades the same way on the next ask.
	* An agent-less execution also degrades: without an agent there is no
	* session to audit to and no UI to route to. Otherwise the outcome maps
	* one-to-one — `allowed-once` proceeds; the three non-grants deny with
	* distinct reasons so the model can tell a human "no" from an absent
	* approval channel.
	*/
	async serviceAsk(exec, ask) {
		const approval = this.ctx.get("approval");
		if (approval === void 0) return {
			decision: {
				kind: "deny",
				reason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)`
			},
			approvalCancelled: false
		};
		if (exec.agent === void 0) return {
			decision: {
				kind: "deny",
				reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`
			},
			approvalCancelled: false
		};
		const outcome = await approval.request({
			agent: exec.agent,
			toolName: exec.name,
			callId: exec.callId,
			...ask.reason !== void 0 ? { reason: ask.reason } : {},
			...ask.displayReason !== void 0 ? { displayReason: ask.displayReason } : {},
			signal: exec.signal
		});
		switch (outcome) {
			case "allowed-once": return {
				decision: { kind: "allow" },
				approvalCancelled: false
			};
			case "rejected": return {
				decision: {
					kind: "deny",
					reason: `the user rejected tool "${exec.name}"`
				},
				approvalCancelled: false
			};
			case "cancelled": return {
				decision: {
					kind: "deny",
					reason: `approval for tool "${exec.name}" was cancelled`
				},
				approvalCancelled: true
			};
			case "unavailable": return {
				decision: {
					kind: "deny",
					reason: `tool "${exec.name}" requires approval, but no approval channel is available`
				},
				approvalCancelled: false
			};
			default: return assertNever(outcome, "ApprovalOutcome");
		}
	}
	/**
	* Run the `tools/post-execute` waterfall over a dispatched `result` and apply
	* its {@link PostToolDecision}: `accept` keeps the call successful (replacing
	* `content` when given), `block` turns it into an `isError` whose content is
	* the corrective `feedback`. Either decision may attach `additionalContexts`,
	* which are ferried on the returned result for the loop's active-batch FIFO.
	* Context deferred by the tool body survives an accepted result but is
	* discarded when the outer call is blocked; a block exposes only context the
	* blocking decision explicitly supplied.
	* Runs inside `execute`'s outer try/catch (a throwing listener → isError).
	*/
	async postExecute(exec, result) {
		const decision = await this.ctx.waterfall(scopeTarget(this, exec.agent), "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }));
		const decisionContexts = decision.additionalContexts ?? [];
		if (decision.kind === "block") {
			const message = failureMessageFromContent(decision.feedback);
			return this.markCanonical(exec, {
				content: decision.feedback,
				isError: true,
				error: { message },
				...decisionContexts.length > 0 ? { additionalContexts: decisionContexts } : {}
			});
		}
		if (Object.hasOwn(decision, "content") && Object.hasOwn(decision, "value")) throw new TypeError("tools/post-execute accept decision cannot replace both value and content");
		const additionalContexts = [...result.additionalContexts ?? [], ...decisionContexts];
		if (Object.hasOwn(decision, "value")) {
			if (result.isError) throw new TypeError("tools/post-execute cannot replace the value of a failed result");
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (tool === void 0) throw new ToolNotFoundError(exec.name);
			const replaced = this.createSuccessResult(exec, tool, decision.value);
			return this.markCanonical(exec, {
				...replaced,
				...additionalContexts.length > 0 ? { additionalContexts } : {}
			});
		}
		return this.markCanonical(exec, {
			...result,
			...decision.content !== void 0 ? { content: decision.content } : {},
			...additionalContexts.length > 0 ? { additionalContexts } : {}
		});
	}
	/** Registry-normalized results and the exact dispatch that validated each value. */
	canonicalResults = /* @__PURE__ */ new WeakMap();
	/** Mark one registry-normalized result as canonical only for its owning dispatch. */
	markCanonical(exec, result) {
		this.canonicalResults.set(result, exec.token);
		return result;
	}
	/** Snapshot, validate, render, and optionally project one successful body value. */
	createSuccessResult(exec, tool, candidate) {
		const detached = snapshotToolValue(tool.name, candidate);
		const violations = validateJsonSchemaValue(tool.output.schema, detached, "value");
		if (violations.length > 0) throw new ToolOutputError(tool.name, violations);
		const value = deepFreeze(detached);
		let rendered;
		try {
			rendered = tool.output.render(exec.arguments, value);
		} catch (error) {
			throw projectionError(tool.name, "render", error);
		}
		const content = snapshotProjection(tool.name, "render", rendered);
		let meta;
		if (tool.output.presentationMeta !== void 0) {
			let projected;
			try {
				projected = tool.output.presentationMeta(exec.arguments, value);
			} catch (error) {
				throw projectionError(tool.name, "presentationMeta", error);
			}
			meta = snapshotProjection(tool.name, "presentationMeta", projected);
		}
		const concludesTurn = this.concludingExecutions.has(exec);
		return this.markCanonical(exec, this.materializeFinalResult({
			isError: false,
			value,
			content,
			...meta !== void 0 ? { meta } : {},
			...concludesTurn ? { concludesTurn: true } : {}
		}));
	}
	/** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
	normalizeDispatchResult(exec, result) {
		if (this.canonicalResults.get(result) === exec.token) return result;
		if (result.isError) return this.markCanonical(exec, {
			isError: true,
			error: result.error,
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (tool === void 0) throw new ToolNotFoundError(exec.name);
		const normalized = this.createSuccessResult(exec, tool, result.value);
		return this.markCanonical(exec, {
			...normalized,
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
	}
	/** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
	materializeFinalResult(result) {
		const presentation = {
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		};
		if (result.isError) return materializePresentation({
			isError: true,
			error: result.error,
			...presentation
		});
		return deepFreeze({
			...materializePresentation({
				isError: false,
				...presentation,
				...result.concludesTurn === true ? { concludesTurn: true } : {}
			}),
			value: result.value
		});
	}
});
/** Mint a same-process correlation token whose identity is its value. */
function createExecutionToken() {
	return Symbol("dsh.tool.execution");
}
function toolErrorResult(error) {
	const info = errorInfo(error);
	const message = errorMessage(error);
	return {
		content: [{
			type: "text",
			text: `Error: ${message}`
		}],
		isError: true,
		error: {
			message,
			...info ? { info } : {}
		}
	};
}
/** Read live abort state across an await without treating it as synchronously immutable. */
function isAborted(signal) {
	return signal.aborted;
}
/**
* Fuse caller and wrapper cancellation without nesting `AbortSignal.any`.
* Keeping the relay dispatch-scoped also removes listeners when work settles.
*/
function fuseToolSignals(caller, wrapper) {
	if (caller === wrapper) return {
		signal: caller,
		dispose() {}
	};
	const controller = new AbortController();
	let listening = false;
	const dispose = () => {
		if (!listening) return;
		listening = false;
		caller.removeEventListener("abort", abortFromCaller);
		wrapper.removeEventListener("abort", abortFromWrapper);
	};
	const abortFrom = (source) => {
		const reason = source.reason;
		controller.abort(reason);
		dispose();
	};
	const abortFromCaller = () => {
		abortFrom(caller);
	};
	const abortFromWrapper = () => {
		abortFrom(wrapper);
	};
	if (wrapper.aborted) abortFromWrapper();
	else if (caller.aborted) abortFromCaller();
	else {
		listening = true;
		caller.addEventListener("abort", abortFromCaller, { once: true });
		wrapper.addEventListener("abort", abortFromWrapper, { once: true });
	}
	return {
		signal: controller.signal,
		dispose
	};
}
/** Canonical result when cancellation supersedes success after body invocation. */
function toolAbortedResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted"
		}],
		isError: true,
		error: {
			message: "tool call aborted",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
/** Canonical result when cancellation prevents tool body invocation. */
function toolAbortedBeforeDispatchResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted before dispatch"
		}],
		isError: true,
		error: {
			message: "tool call aborted before dispatch",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED_BEFORE_DISPATCH
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
//#endregion
//#region src/host/tools.ts
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
/** One text block. */
function text(value) {
	return [{
		type: "text",
		text: value
	}];
}
/** Structured JSON rendered as the model-facing text block. */
function renderJson(value) {
	return text(JSON.stringify(value, null, 2));
}
/** Read the calling agent's session id without depending on the agent type. */
function sessionIdOf(exec) {
	const id = exec.agent?.session?.id;
	return typeof id === "string" ? id : void 0;
}
/** Shared tab selector parameter. */
const TAB_ID_PARAM = {
	type: "string",
	description: "Tab id from browser_tabs or a previous result. Omit to use the tab this session already uses."
};
/** Shared element-target parameters. */
const TARGET_PARAMS = {
	ref: {
		type: "integer",
		description: "Depth-first ref from the most recent browser_snapshot. Valid only for that observation; re-snapshot after the page changes."
	},
	selector: {
		type: "string",
		description: "CSS selector, when you already know the element and do not need a snapshot."
	},
	x: {
		type: "number",
		description: "Viewport x in CSS pixels; pair it with y instead of ref or selector."
	},
	y: {
		type: "number",
		description: "Viewport y in CSS pixels; pair it with x instead of ref or selector."
	}
};
/** The tab reference every result carries. */
const TAB_FIELDS = { tabId: {
	type: "string",
	required: true,
	description: "Tab the result came from."
} };
/** The action trace line every mutating tool returns. */
const SUMMARY_FIELD = { summary: {
	type: "string",
	required: true,
	description: "One-line description of what happened, also shown in the panel."
} };
/** One snapshot node, mirroring the wire contract. */
const SNAPSHOT_NODE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		ref: {
			type: "integer",
			required: true,
			description: "Depth-first index; pass it to browser_click."
		},
		tag: {
			type: "string",
			required: true
		},
		id: { type: "string" },
		classes: {
			type: "array",
			items: { type: "string" }
		},
		role: { type: "string" },
		name: { type: "string" },
		text: { type: "string" },
		box: {
			type: "object",
			additionalProperties: false,
			properties: {
				x: {
					type: "number",
					required: true
				},
				y: {
					type: "number",
					required: true
				},
				width: {
					type: "number",
					required: true
				},
				height: {
					type: "number",
					required: true
				}
			}
		},
		depth: {
			type: "integer",
			required: true
		}
	}
};
/** Directory listing entry shape shared by `browser_tabs`. */
const TAB_VIEW_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true
		},
		url: {
			type: "string",
			required: true
		},
		title: {
			type: "string",
			required: true
		},
		loading: {
			type: "boolean",
			required: true
		},
		sessionId: { type: "string" }
	}
};
/**
* Build every browser tool against one service.
* @param deps - the service plus the optional attachment sink.
* @returns the tool definitions, in registration order.
*/
function createBrowserTools(deps) {
	const { service } = deps;
	return [
		defineTool({
			name: "browser_navigate",
			description: "Navigate the plugin's own browser tab to a URL and report the resulting page (url, title). This browser is a real Chromium the host launched, so the page renders, runs scripts, and makes network requests exactly as it would for a user. Use it to inspect a local page or site, to verify rendered markup, or to set up a page before a snapshot, click, or screenshot. After navigating, call browser_snapshot before clicking anything: refs from before the navigation no longer exist. Without new_tab the call reuses this session's current tab, so the console and network buffers start over with the new document. Set new_tab to true to keep the current page and open the URL in an additional tab (browser_tabs then lists both). 中文触发词：打开网页、浏览器里看一下、访问这个地址、渲染页面、新标签页。",
			parameters: {
				url: {
					type: "string",
					required: true,
					description: "Absolute URL, including data: and about: URLs."
				},
				new_tab: {
					type: "boolean",
					description: "When true, open the URL in a new tab and leave the current page untouched; the new tab becomes the active one. Defaults to false."
				},
				tab_id: TAB_ID_PARAM
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						url: {
							type: "string",
							required: true
						},
						title: {
							type: "string",
							required: true
						},
						loading: {
							type: "boolean",
							required: true
						},
						...SUMMARY_FIELD
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				const { outcome, tab } = await service.navigate(sessionIdOf(exec), args.url, args.tab_id, { newTab: args.new_tab === true });
				return {
					tabId: outcome.tabId,
					url: tab.url,
					title: tab.title,
					loading: tab.loading,
					summary: outcome.summary
				};
			}
		}),
		defineTool({
			name: "browser_click",
			description: "Click an element in the browser tab, using a ref from the most recent browser_snapshot, a CSS selector, or viewport x/y. A ref only identifies the node that existed when that snapshot ran: if the page has navigated or re-rendered since, call browser_snapshot again first, because a stale ref either matches nothing (the tool says so) or matches a different element (the click lands somewhere you did not intend). The click is dispatched as a real mouse event at the element centre, so focus, hover, and trusted-event handlers behave normally. 中文触发词：点击、按下按钮、点这个链接。",
			parameters: {
				...TARGET_PARAMS,
				tab_id: TAB_ID_PARAM
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						...SUMMARY_FIELD
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				const outcome = await service.click(sessionIdOf(exec), {
					ref: args.ref,
					selector: args.selector,
					x: args.x,
					y: args.y
				}, args.tab_id);
				return {
					tabId: outcome.tabId,
					summary: outcome.summary
				};
			}
		}),
		defineTool({
			name: "browser_type",
			description: "Insert text into the page. Without a target the text goes to whatever is focused; with a ref or selector the tool clicks that element first and then types. This inserts text the way an input method does, so it does not fire per-key handlers by itself: use browser_press afterwards when the page needs Enter, Tab, or a keystroke to commit. Like browser_click, a ref is only valid for the snapshot it came from. 中文触发词：输入、填写输入框、在搜索框里打字。",
			parameters: {
				text: {
					type: "string",
					required: true,
					description: "Text to insert."
				},
				...TARGET_PARAMS,
				tab_id: TAB_ID_PARAM
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						...SUMMARY_FIELD,
						characters: {
							type: "integer",
							required: true
						}
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				const outcome = await service.type(sessionIdOf(exec), args.text, {
					ref: args.ref,
					selector: args.selector,
					x: args.x,
					y: args.y
				}, args.tab_id);
				return {
					tabId: outcome.tabId,
					summary: outcome.summary,
					characters: [...args.text].length
				};
			}
		}),
		defineTool({
			name: "browser_press",
			description: "Press one key in the focused element: Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, or a single character. Use it to submit a form after browser_type, to dismiss a dialog, or to move through a list. 中文触发词：按回车、按键、提交表单。",
			parameters: {
				key: {
					type: "string",
					required: true,
					description: "Key name from the list above, or one character."
				},
				tab_id: TAB_ID_PARAM
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						...SUMMARY_FIELD
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				const outcome = await service.press(sessionIdOf(exec), args.key, args.tab_id);
				return {
					tabId: outcome.tabId,
					summary: outcome.summary
				};
			}
		}),
		defineTool({
			name: "browser_scroll",
			description: "Scroll the page by a pixel delta at a viewport point. Positive delta_y scrolls down, negative scrolls up; delta_x scrolls sideways. Use it before a screenshot that must show content below the fold, or to trigger lazy loading before a snapshot. 中文触发词：滚动、往下翻、滚动条。",
			parameters: {
				delta_y: {
					type: "number",
					description: "Vertical scroll distance in CSS pixels; positive is down."
				},
				delta_x: {
					type: "number",
					description: "Horizontal scroll distance in CSS pixels; positive is right."
				},
				x: {
					type: "number",
					description: "Viewport x where the wheel event lands. Defaults to the middle of the viewport."
				},
				y: {
					type: "number",
					description: "Viewport y where the wheel event lands. Defaults to the middle of the viewport."
				},
				tab_id: TAB_ID_PARAM
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						...SUMMARY_FIELD
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				const outcome = await service.scroll(sessionIdOf(exec), {
					deltaX: args.delta_x,
					deltaY: args.delta_y,
					x: args.x,
					y: args.y
				}, args.tab_id);
				return {
					tabId: outcome.tabId,
					summary: outcome.summary
				};
			}
		}),
		defineTool({
			name: "browser_snapshot",
			description: "Return a numbered, depth-first view of the page DOM: tag, id, classes, role, accessible name, visible text, and box for each node, with indentation given by depth. The ref numbers from this call are exactly what browser_click accepts. The walk is capped; when the result says truncated, work from the part you have (or scroll and snapshot again) rather than assuming the page is small. Always snapshot before clicking: it is what gives you a valid ref, and it is how you see what an action changed. 中文触发词：看看页面结构、DOM、有哪些元素、快照。",
			parameters: { tab_id: TAB_ID_PARAM },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						url: {
							type: "string",
							required: true
						},
						title: {
							type: "string",
							required: true
						},
						truncated: {
							type: "boolean",
							required: true
						},
						nodes: {
							type: "array",
							required: true,
							items: SNAPSHOT_NODE_SCHEMA
						}
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				const result = await service.snapshot(sessionIdOf(exec), args.tab_id);
				return {
					tabId: result.tabId,
					url: result.url,
					title: result.title,
					truncated: result.truncated,
					nodes: result.nodes
				};
			}
		}),
		defineTool({
			name: "browser_screenshot",
			description: "Capture the current tab as a JPEG and return the image itself, not a description of it. Use it when the user should see the page, when layout or styling matters more than the DOM, or to check that something rendered correctly. The image is the whole visible viewport; scroll first if the region you need is off-screen. 中文触发词：截图、看一下现在的页面、画面。",
			parameters: { tab_id: TAB_ID_PARAM },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						url: {
							type: "string",
							required: true
						},
						title: {
							type: "string",
							required: true
						},
						image: {
							type: "object",
							additionalProperties: false,
							required: true,
							properties: {
								attachmentId: {
									type: "string",
									required: true
								},
								mediaType: {
									type: "string",
									required: true
								},
								bytes: {
									type: "integer",
									required: true
								},
								width: {
									type: "integer",
									required: true
								},
								height: {
									type: "integer",
									required: true
								},
								name: { type: "string" }
							}
						}
					}
				},
				render: (_args, value) => {
					const envelope = `<path>browser-view:screenshot/${value.tabId}.jpg</path>
<type>image</type>
<content>
${value.image.mediaType} screenshot, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes
url: ${value.url}
title: ${value.title}
</content>`;
					const block = {
						type: "image",
						attachment: value.image
					};
					return [...text(envelope), block];
				}
			},
			execute: async (args, exec) => {
				const saveImage = deps.saveImage;
				if (saveImage === void 0) throw new Error("browser_screenshot needs the host attachment service to store the image; this host mounts none");
				const shot = await service.screenshot(sessionIdOf(exec), args.tab_id);
				const ref = await saveImage({
					data: Buffer.from(shot.data, "base64"),
					mediaType: "image/jpeg",
					name: `browser-view-${shot.tabId}.jpg`
				});
				return {
					tabId: shot.tabId,
					url: shot.url,
					title: shot.title,
					image: {
						attachmentId: ref.attachmentId,
						mediaType: ref.mediaType,
						bytes: ref.bytes,
						width: ref.width,
						height: ref.height,
						...ref.name === void 0 ? {} : { name: ref.name }
					}
				};
			}
		}),
		defineTool({
			name: "browser_console",
			description: "Return the console entries the tab has captured (log, info, warn, error, debug), newest last. Use it to confirm a script ran, to read a value a page printed, or to find the error behind a page that looks wrong. The buffer is bounded, so a very chatty page only keeps the most recent entries. 中文触发词：控制台、console 报错、看看日志。",
			parameters: {
				limit: {
					type: "integer",
					description: "Maximum trailing entries to return (default 100)."
				},
				tab_id: TAB_ID_PARAM
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						entries: {
							type: "array",
							required: true,
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									level: {
										type: "string",
										required: true
									},
									text: {
										type: "string",
										required: true
									},
									at: {
										type: "integer",
										required: true
									}
								}
							}
						}
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				const result = await service.console(sessionIdOf(exec), args.limit ?? 100, args.tab_id);
				return {
					tabId: result.tabId,
					entries: result.entries
				};
			}
		}),
		defineTool({
			name: "browser_network",
			description: "Return the network requests the tab has observed (url, method, status, mime type, failure text), newest last. Use it to check that a page called the endpoint you expected, to see why a resource failed, or to confirm a redirect. Status 0 means the request never received a response; read the failure field in that case. 中文触发词：网络请求、接口流量、请求记录。",
			parameters: {
				limit: {
					type: "integer",
					description: "Maximum trailing entries to return (default 100)."
				},
				tab_id: TAB_ID_PARAM
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						...TAB_FIELDS,
						entries: {
							type: "array",
							required: true,
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									url: {
										type: "string",
										required: true
									},
									method: {
										type: "string",
										required: true
									},
									status: {
										type: "integer",
										required: true
									},
									mimeType: { type: "string" },
									failure: { type: "string" },
									at: {
										type: "integer",
										required: true
									}
								}
							}
						}
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				const result = await service.network(sessionIdOf(exec), args.limit ?? 100, args.tab_id);
				return {
					tabId: result.tabId,
					entries: result.entries
				};
			}
		}),
		defineTool({
			name: "browser_tabs",
			description: "List the browser tabs this plugin currently has open, with their ids, urls, titles, and loading state. Call it when you need a tab id, when you are unsure whether a browser is running at all, or after the user closed a tab in the panel. It never starts a browser: an empty list means nothing has been opened yet, so navigate first. 中文触发词：有多少标签页、当前浏览器状态、打开着哪些页面。",
			parameters: {},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						tabs: {
							type: "array",
							required: true,
							items: TAB_VIEW_SCHEMA
						},
						activeTabId: {
							required: true,
							oneOf: [{ type: "string" }, { type: "null" }],
							description: "Tab the panel is watching, or null when no tab is open."
						}
					}
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async () => {
				const result = await service.listTabs();
				return {
					tabs: result.tabs,
					activeTabId: result.activeTabId
				};
			}
		}),
		defineTool({
			name: "browser_close",
			description: "Close the browser tab this session opened, and nothing else. Call it when the work in the browser is finished: a tab left open is a page still running on the host and a chip still sitting in the panel, and the next thing anyone sees is somebody else's leftover. It refuses a tab another session opened, because those pages belong to the sessions driving them; a session that owns no tab closes nothing and still succeeds, so the call is safe to make unconditionally. Without tab_id it closes every tab this session opened; with tab_id it closes exactly that one. 中文触发词：关掉网页、关闭标签页、收尾清理。",
			parameters: { tab_id: {
				type: "string",
				description: "Tab id from browser_tabs or a previous result. Omit to close every tab this session opened."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { closed: {
						type: "array",
						required: true,
						items: { type: "string" },
						description: "Ids of the tabs this call actually closed, in close order."
					} }
				},
				render: (_args, value) => renderJson(value)
			},
			execute: async (args, exec) => {
				return { closed: await service.closeOwnTabs(sessionIdOf(exec), args.tab_id) };
			}
		})
	];
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "browser-view";
/** Services required before the routes and the tools can mount. */
const inject = ["webServer", "tools"];
/**
* Mount the routes, the tools, and the browser lifetime.
* @param ctx - host plugin context carrying webServer and tools.
*/
function apply(ctx) {
	const service = new BrowserViewService({ authenticatedUrl: (url) => {
		const connection = ctx.get("connection");
		if (connection === void 0 || typeof connection.authenticatedUrl !== "function") return void 0;
		try {
			return connection.authenticatedUrl(url);
		} catch {
			return;
		}
	} });
	const saveImage = async (input) => {
		const attachments = ctx.get("attachments");
		if (attachments === void 0 || typeof attachments.saveImage !== "function") throw new Error("browser_screenshot needs the host attachment service to store the image; this host mounts none");
		return await attachments.saveImage(input);
	};
	const { routes, upgrade } = makeRoutes({
		backend: service,
		allowedCidrs: parseCidrList(process.env[ALLOWED_CIDRS_ENV]),
		trustedProxyCidrs: parseCidrList(process.env[TRUSTED_PROXY_CIDRS_ENV], TRUSTED_PROXY_CIDRS_ENV),
		publicOrigins: parsePublicOriginList(process.env[PUBLIC_ORIGIN_ENV])
	});
	const tools = createBrowserTools({
		service,
		saveImage
	});
	ctx.effect(() => {
		const disposers = routes.map((route) => ctx.webServer.register(route));
		const upgradeDisposer = ctx.webServer.registerUpgrade(upgrade);
		return () => {
			for (const dispose of disposers) dispose();
			upgradeDisposer();
		};
	}, "browser-view: routes");
	ctx.effect(() => {
		const disposers = tools.map((tool) => ctx.tools.register(tool));
		return () => {
			for (const dispose of disposers) dispose();
		};
	}, "browser-view: tools");
	ctx.effect(() => () => {
		service.dispose();
	}, "browser-view: browser");
}
//#endregion
export { apply, inject, name };
