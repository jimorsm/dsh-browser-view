window.__ModuleLoader__.load({
	id: "@jimorsm/dsh-client-ui-browser-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/live-title.ts
		/**
		* Create one store for the plugin's lifetime.
		* @returns the channel.
		*/
		function createLiveTitleStore() {
			const titles = /* @__PURE__ */ new Map();
			const listeners = /* @__PURE__ */ new Set();
			const notify = () => {
				for (const listener of [...listeners]) listener();
			};
			return {
				get(sessionId) {
					return sessionId === void 0 ? void 0 : titles.get(sessionId);
				},
				set(sessionId, title) {
					if (sessionId === void 0) return;
					const current = titles.get(sessionId);
					if (title === void 0 || title.length === 0) {
						if (current === void 0) return;
						titles.delete(sessionId);
						notify();
						return;
					}
					if (current === title) return;
					titles.set(sessionId, title);
					notify();
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				}
			};
		}
		//#endregion
		//#region src/client/locales.ts
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
		const zh = {
			"tab.title": "浏览器视图",
			"guide.description": "看 agent 正在操作的网页",
			"panel.tab.untitled": "未命名页面",
			"panel.url.empty": "还没有打开页面",
			"panel.address.label": "页面地址",
			"panel.toolbar.refresh": "刷新画面",
			"panel.frame.alt": "agent 正在操作的页面画面",
			"panel.empty.title": "还没有画面",
			"panel.empty.hint": "让 agent 打开一个页面后，这里会实时显示它正在看的网页。",
			"panel.error.title": "浏览器视图出错",
			"panel.trace.idle": "暂无工具动作",
			"panel.status.connecting": "正在连接",
			"panel.status.loading": "加载中",
			"panel.status.live": "实时"
		};
		/** English dictionary, key-for-key complete against zh. */
		const en = {
			"tab.title": "Browser view",
			"guide.description": "Watch the page the agent is driving",
			"panel.tab.untitled": "Untitled page",
			"panel.url.empty": "No page open yet",
			"panel.address.label": "Page address",
			"panel.toolbar.refresh": "Refresh the frame",
			"panel.frame.alt": "Live view of the page the agent is driving",
			"panel.empty.title": "No frames yet",
			"panel.empty.hint": "Once the agent opens a page, this tab shows the page it is looking at.",
			"panel.error.title": "Browser view error",
			"panel.trace.idle": "No tool actions yet",
			"panel.status.connecting": "Connecting",
			"panel.status.loading": "Loading",
			"panel.status.live": "Live"
		};
		//#endregion
		//#region src/core/protocol.ts
		/** Mount path of the panel socket, relative to the GUI origin. */
		const BROWSER_VIEW_SOCKET_PATH = "/api/dsh-browser-view/socket";
		//#endregion
		//#region src/client/semantic.ts
		/**
		* Semantic attributes for the browser-view surface (semantic-attrs-v1).
		*
		* The plugin name lives on the root element of each surface so part values stay
		* bare words; a theme anchors on the pair, never on a part name that repeats
		* the plugin. The right-sidebar chip and the shell's tab strip around it are
		* not ours, so only this plugin's own elements are stamped.
		*
		* The body's part names follow the shipped browser tab's structure - a toolbar
		* with an address display, the frame, and the action trace - so a theme that
		* already anchors on that chrome reaches this tab the same way.
		*/
		/** Root plugin attribute value carried by every top-level browser-view element. */
		const BROWSER_VIEW_PLUGIN = "browser-view";
		/** Part names this plugin emits, in surface order. */
		const BROWSER_VIEW_PARTS = {
			/** The tab body the sidebar mounts in its content area. */
			panel: "panel",
			/** Top chrome row: address display, connection state, refresh. */
			toolbar: "toolbar",
			/** The read-only address display of the streamed page. */
			address: "address",
			/** The controlled browser's tab chips; drawn only when it holds several. */
			tabs: "tabs",
			/** The live frame image. */
			frame: "frame",
			/** Bottom action trace. */
			trace: "trace",
			/** Connection state marker in the toolbar. */
			status: "status",
			/** No-frame placeholder. */
			empty: "empty",
			/** Host-reported failure placeholder. */
			error: "error",
			/** This plugin's share of the right-sidebar chip. */
			tabTitle: "tab-title"
		};
		/** Reconnect ceiling; a host that stays down must not spin the tab. */
		const RECONNECT_MAX_MS = 15e3;
		/** Commands held while the socket is down; the oldest drop first. */
		const PENDING_COMMAND_LIMIT = 16;
		/** The network authority of a shell-owned Host, without credentials or a path. */
		function hostAuthorityOf(base) {
			if (base === void 0 || base === "") return void 0;
			let url;
			try {
				url = new URL(base);
			} catch {
				return;
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") return void 0;
			if (url.username !== "" || url.password !== "" || url.host === "") return void 0;
			return {
				protocol: url.protocol,
				authority: url.host
			};
		}
		/**
		* Derive the socket URL from a web page or its application shell's Host.
		*
		* A web page keeps its own origin even when a transport hook is present. An
		* application-delivered page such as the desktop shell's dsh-app: cannot carry
		* a WebSocket upgrade on that scheme, so it uses the Host authority the shell
		* publishes instead. The shell rewrites that handshake; the Host fence is unchanged.
		* @param location - origin the panel is rendered on.
		* @param streamBaseUrl - official `__DSH_TRANSPORT__.streamBaseUrl`, when published.
		* @returns the absolute ws/wss URL, or null when no safe Host authority is known.
		*/
		function browserViewSocketUrl(location, streamBaseUrl) {
			const pageProtocol = location.protocol === "https:" ? "wss:" : location.protocol === "http:" ? "ws:" : null;
			if (pageProtocol !== null) return `${pageProtocol}//${location.host}${BROWSER_VIEW_SOCKET_PATH}`;
			const base = hostAuthorityOf(streamBaseUrl);
			if (base === void 0) return null;
			return `${base.protocol === "https:" ? "wss:" : "ws:"}//${base.authority}${BROWSER_VIEW_SOCKET_PATH}`;
		}
		/**
		* Backoff for one reconnect attempt.
		* @param attempt - zero-based attempt index.
		* @returns delay in milliseconds, capped at RECONNECT_MAX_MS.
		*/
		function reconnectDelay(attempt) {
			const exponential = 500 * 2 ** Math.max(0, Math.floor(attempt));
			return Math.min(exponential, RECONNECT_MAX_MS);
		}
		/** Narrow a tab row from the wire. */
		function readTab(value) {
			if (typeof value !== "object" || value === null) return null;
			const candidate = value;
			if (typeof candidate.id !== "string") return null;
			if (typeof candidate.url !== "string") return null;
			if (typeof candidate.title !== "string") return null;
			if (typeof candidate.loading !== "boolean") return null;
			return {
				id: candidate.id,
				url: candidate.url,
				title: candidate.title,
				loading: candidate.loading,
				...typeof candidate.sessionId === "string" ? { sessionId: candidate.sessionId } : {}
			};
		}
		/** Narrow the panel state from the wire. */
		function readPanelState(value) {
			if (typeof value !== "object" || value === null) return null;
			const candidate = value;
			if (!Array.isArray(candidate.tabs)) return null;
			if (typeof candidate.running !== "boolean") return null;
			if (candidate.activeTabId !== null && typeof candidate.activeTabId !== "string") return null;
			const tabs = [];
			for (const entry of candidate.tabs) {
				const tab = readTab(entry);
				if (tab === null) return null;
				tabs.push(tab);
			}
			return {
				tabs,
				activeTabId: candidate.activeTabId,
				running: candidate.running,
				...typeof candidate.message === "string" ? { message: candidate.message } : {}
			};
		}
		/**
		* Narrow one decoded payload into a protocol event.
		*
		* The protocol is a discriminated union over `kind`, so an unknown kind or a
		* wrong field type is a shape this panel cannot render: it is dropped rather
		* than half-applied, which keeps one malformed push from corrupting the view.
		* @param value - parsed JSON value (or a raw frame string).
		* @returns the event, or null when the payload is not one this version reads.
		*/
		function parseBrowserViewEvent(value) {
			let payload = value;
			if (typeof payload === "string") try {
				payload = JSON.parse(payload);
			} catch {
				return null;
			}
			if (typeof payload !== "object" || payload === null) return null;
			const candidate = payload;
			if (candidate.v !== 1) return null;
			switch (candidate.kind) {
				case "hello":
				case "state": {
					const state = readPanelState(candidate.state);
					if (state === null) return null;
					return {
						v: 1,
						kind: candidate.kind,
						state
					};
				}
				case "frame":
					if (typeof candidate.tabId !== "string") return null;
					if (typeof candidate.seq !== "number") return null;
					if (typeof candidate.width !== "number") return null;
					if (typeof candidate.height !== "number") return null;
					if (typeof candidate.data !== "string") return null;
					return {
						v: 1,
						kind: "frame",
						tabId: candidate.tabId,
						seq: candidate.seq,
						width: candidate.width,
						height: candidate.height,
						data: candidate.data
					};
				case "action": {
					const trace = candidate.trace;
					if (typeof trace !== "object" || trace === null) return null;
					const row = trace;
					if (typeof row.tool !== "string" || typeof row.summary !== "string" || typeof row.at !== "number") return null;
					return {
						v: 1,
						kind: "action",
						trace: {
							tool: row.tool,
							summary: row.summary,
							at: row.at
						}
					};
				}
				case "rtc-answer":
					if (typeof candidate.sdp !== "string") return null;
					return {
						v: 1,
						kind: "rtc-answer",
						sdp: candidate.sdp
					};
				case "error":
					if (typeof candidate.code !== "string" || typeof candidate.message !== "string") return null;
					return {
						v: 1,
						kind: "error",
						code: candidate.code,
						message: candidate.message
					};
				default: return null;
			}
		}
		/**
		* Open one connection to the host half and keep it alive.
		*
		* Sequencing: every successful open sends `attach` (the host answers with
		* `hello` plus frames), and the per-tab frame counter is cleared because the
		* host restarts its `seq` for a new connection — keeping the old high-water
		* mark would drop the whole fresh stream.
		* @param handlers - panel callbacks.
		* @param options - transport, origin, session and timer seams.
		* @returns the handle the panel closes on unmount.
		*/
		function connectBrowserViewSocket(handlers, options = {}) {
			const globals = globalThis;
			const WebSocketImpl = options.WebSocketImpl ?? globals.WebSocket;
			const location = options.location ?? globals.location;
			const setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms));
			const clearTimer = options.clearTimer ?? ((handle) => {
				clearTimeout(handle);
			});
			const publishedBase = globals.__DSH_TRANSPORT__?.streamBaseUrl;
			const url = location === void 0 ? null : browserViewSocketUrl(location, typeof publishedBase === "string" ? publishedBase : void 0);
			let status = "connecting";
			let socket = null;
			let attempt = 0;
			let disposed = false;
			let timer = null;
			const pending = [];
			const lastSeqByTab = /* @__PURE__ */ new Map();
			/** Publish a phase change once. */
			const setStatus = (next) => {
				if (status === next) return;
				status = next;
				handlers.onStatus?.(next);
			};
			/** Send without buffering (open socket only). */
			const sendNow = (command) => {
				if (socket === null) return false;
				try {
					socket.send(JSON.stringify(command));
					return true;
				} catch {
					return false;
				}
			};
			/** Dispatch one decoded event, dropping frames older than what is on screen. */
			const dispatch = (event) => {
				switch (event.kind) {
					case "hello":
					case "state":
						handlers.onState(event.state);
						return;
					case "frame": {
						const previous = lastSeqByTab.get(event.tabId);
						if (previous !== void 0 && event.seq <= previous) return;
						lastSeqByTab.set(event.tabId, event.seq);
						handlers.onFrame({
							tabId: event.tabId,
							seq: event.seq,
							width: event.width,
							height: event.height,
							data: event.data
						});
						return;
					}
					case "action":
						handlers.onAction(event.trace);
						return;
					case "rtc-answer":
						handlers.onRtcAnswer?.(event.sdp);
						return;
					case "error":
						handlers.onError(event.code, event.message);
						return;
					default: return;
				}
			};
			/** Arm the next reconnect; each failure doubles the wait until the ceiling. */
			const scheduleReconnect = () => {
				if (disposed) return;
				if (url === null || WebSocketImpl === void 0) {
					setStatus("closed");
					return;
				}
				setStatus("reconnecting");
				if (timer !== null) clearTimer(timer);
				const delay = reconnectDelay(attempt);
				attempt += 1;
				timer = setTimer(() => {
					timer = null;
					connect();
				}, delay);
			};
			/** Open one transport and wire it to the handlers. */
			const connect = () => {
				if (disposed) return;
				if (url === null || WebSocketImpl === void 0) {
					setStatus("closed");
					return;
				}
				setStatus(attempt === 0 ? "connecting" : "reconnecting");
				let transport;
				try {
					transport = new WebSocketImpl(url);
				} catch {
					socket = null;
					scheduleReconnect();
					return;
				}
				socket = transport;
				transport.onopen = () => {
					if (disposed) return;
					attempt = 0;
					lastSeqByTab.clear();
					setStatus("open");
					while (pending.length > 0) {
						const command = pending.shift();
						if (command !== void 0) sendNow(command);
					}
					sendNow({
						v: 1,
						kind: "attach",
						...options.sessionId === void 0 ? {} : { sessionId: options.sessionId }
					});
				};
				transport.onmessage = (event) => {
					if (disposed) return;
					const parsed = parseBrowserViewEvent(event.data);
					if (parsed !== null) dispatch(parsed);
				};
				transport.onerror = () => {};
				transport.onclose = () => {
					if (socket === transport) socket = null;
					if (disposed) return;
					scheduleReconnect();
				};
			};
			connect();
			return {
				send(command) {
					if (sendNow(command)) return;
					pending.push(command);
					if (pending.length > PENDING_COMMAND_LIMIT) pending.shift();
				},
				close() {
					if (disposed) return;
					disposed = true;
					if (timer !== null) {
						clearTimer(timer);
						timer = null;
					}
					const transport = socket;
					socket = null;
					setStatus("closed");
					if (transport !== null) try {
						transport.close();
					} catch {}
				},
				status() {
					return status;
				}
			};
		}
		//#endregion
		//#region \0dsh-css:src/client/panel.module.css.mjs
		const css = ".WKhQka_tabTitle{align-items:center;gap:5px;min-width:0;max-width:100%;display:inline-flex}.WKhQka_tabTitleMark{flex:none;width:13px;height:13px}.WKhQka_tabTitleText{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}.WKhQka_root{min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);flex-direction:column;flex:auto;display:flex;overflow:hidden}.WKhQka_toolbar{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:5px 6px;display:flex}.WKhQka_tool{width:28px;height:28px;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}@media (hover:hover){.WKhQka_tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}}.WKhQka_tool:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}.WKhQka_tool:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-base), 0 0 0 4px var(--dsw-alias-brand-primary);outline:none}.WKhQka_addressBox{flex:auto;min-width:0;position:relative}.WKhQka_address{box-sizing:border-box;width:100%;height:28px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:0 9px;overflow:hidden}.WKhQka_address::placeholder{color:var(--dsw-alias-label-tertiary)}.WKhQka_address:focus{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.WKhQka_status{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);white-space:nowrap;flex:none;align-items:center;gap:4px;line-height:16px;display:inline-flex}.WKhQka_statusText{text-overflow:ellipsis;max-width:72px;overflow:hidden}.WKhQka_tabs{border-bottom:.5px solid var(--dsw-alias-border-l3);scrollbar-width:none;flex:none;align-items:center;gap:4px;padding:4px 6px;display:flex;overflow-x:auto}.WKhQka_tabs::-webkit-scrollbar{display:none}.WKhQka_tab{max-width:150px;height:24px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);white-space:nowrap;text-overflow:ellipsis;border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:0;flex:none;padding:0 8px;transition:background-color .12s,color .12s;overflow:hidden}@media (hover:hover){.WKhQka_tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}}.WKhQka_tabActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}.WKhQka_tab:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-base), 0 0 0 4px var(--dsw-alias-brand-primary);outline:none}.WKhQka_content{background:var(--dsw-alias-bg-base);flex:auto;min-width:0;min-height:0;display:flex;overflow:auto}.WKhQka_frame{object-fit:contain;max-width:100%;height:auto;margin:auto;display:block}.WKhQka_empty,.WKhQka_error{text-align:center;flex-direction:column;align-items:center;gap:6px;margin:auto;padding:20px 16px;display:flex}.WKhQka_emptyTitle,.WKhQka_errorTitle{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px}.WKhQka_emptyHint,.WKhQka_errorBody{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.WKhQka_errorTitle{color:var(--dsw-alias-state-error-primary)}.WKhQka_errorCode{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);font-size:11px;line-height:16px}.WKhQka_trace{border-top:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:8px;max-height:84px;padding:6px 10px;display:flex;overflow:hidden}.WKhQka_traceList{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex;overflow:hidden}.WKhQka_traceIdle{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.WKhQka_traceRow{align-items:baseline;gap:6px;min-width:0;font-size:12px;line-height:18px;display:flex}.WKhQka_traceTool{color:var(--dsw-alias-brand-primary);font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);flex:none;font-size:11px}.WKhQka_traceSummary{min-width:0;color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}";
		const tagId = "@jimorsm/dsh-client-ui-browser-view/src/client/panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@jimorsm/dsh-client-ui-browser-view";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var panel_module_css_default = {
			"address": "WKhQka_address",
			"addressBox": "WKhQka_addressBox",
			"content": "WKhQka_content",
			"empty": "WKhQka_empty",
			"emptyHint": "WKhQka_emptyHint",
			"emptyTitle": "WKhQka_emptyTitle",
			"error": "WKhQka_error",
			"errorBody": "WKhQka_errorBody",
			"errorCode": "WKhQka_errorCode",
			"errorTitle": "WKhQka_errorTitle",
			"frame": "WKhQka_frame",
			"root": "WKhQka_root",
			"status": "WKhQka_status",
			"statusText": "WKhQka_statusText",
			"tab": "WKhQka_tab",
			"tabActive": "WKhQka_tabActive",
			"tabTitle": "WKhQka_tabTitle",
			"tabTitleMark": "WKhQka_tabTitleMark",
			"tabTitleText": "WKhQka_tabTitleText",
			"tabs": "WKhQka_tabs",
			"tool": "WKhQka_tool",
			"toolbar": "WKhQka_toolbar",
			"trace": "WKhQka_trace",
			"traceIdle": "WKhQka_traceIdle",
			"traceList": "WKhQka_traceList",
			"traceRow": "WKhQka_traceRow",
			"traceSummary": "WKhQka_traceSummary",
			"traceTool": "WKhQka_traceTool"
		};
		//#endregion
		//#region src/client/panel.tsx
		/**
		* The browser view tab's content, mounted by the right sidebar into its
		* content area under the 'browser-view' tab type.
		*
		* The shell owns the column, the chip, the close control and the switch between
		* tabs; this file owns what is drawn inside one tab and scrolls inside it. It
		* therefore has no title bar of its own and no "back" control - a page header
		* in a sidebar tab would repeat the chip right above it - and it fills the
		* height it is given instead of positioning itself against the viewport.
		*
		* The body is laid out like the shipped browser tab's chrome: one 38px toolbar
		* holding the address display, the connection marker and the one control this
		* plugin actually has - refresh the captured frame - then the frame itself,
		* then the action trace. Nothing here claims a capability the host does not
		* expose: there is no forward/back pair, no reload of the page (the host drives
		* navigation, this side only observes it) and no "open in a new window",
		* because the page lives in a Chromium process on the host.
		*
		* The refresh control and the state marker are the product's own atoms -
		* IconRefreshOutlineRegular and StateDot from @deepseek-ai/dsh-client-ui-primitives,
		* the same two the shipped browser tab's toolbar uses - so the chrome is drawn
		* from one source rather than redrawn beside it. The package's Vite config
		* inlines @deepseek-ai packages, which is what lets the jsdom body tests load
		* that entry point (it imports its own stylesheets).
		*
		* Frame rendering: an <img> fed a base64 JPEG data URL, not a <canvas>. The host
		* already decoded and re-encoded the frame (CDP gives it JPEG base64), so there
		* are no pixels for this side to compose - a canvas would add a drawImage hop,
		* a context lifecycle and an invalidation race for zero gain, while the image
		* element decodes off the main thread and lets CSS own the aspect-ratio fit.
		*
		* Input relay: the live frame is also an interactive surface. Pointer and key
		* events on the image are rescaled to the host-pinned viewport and relayed as
		* `input` commands, which the host turns into CDP `Input.*` calls. The events
		* the panel page itself would want (typing into the address box, scrolling the
		* sidebar) stay untouched: keyboard capture only happens while the frame is
		* focused, and the wheel listener is scoped to the image element.
		*
		* Frame transport: frames arrive over the WebSocket by default, and the panel
		* additionally offers a WebRTC DataChannel (unreliable, unordered) - when the
		* host accepts, binary frames arrive there and are painted straight onto a
		* canvas, skipping the base64 and JSON hops. Any failure falls back to the
		* WebSocket stream transparently; nothing user-visible depends on the upgrade.
		*/
		/** Trace rows kept on screen; older tool calls scroll out of relevance. */
		const TRACE_LIMIT = 5;
		/** State before the host publishes anything. */
		const EMPTY_STATE = {
			tabs: [],
			activeTabId: null,
			running: false
		};
		/** Join truthy class names (CSS Modules maps are typed as plain records). */
		function cx(...names) {
			return names.filter((name) => typeof name === "string" && name.length > 0).join(" ");
		}
		/**
		* Render the browser view tab body.
		* @param props - composed slot props.
		* @returns the tab content.
		*/
		function BrowserViewPanel({ t, sessionId, liveTitle, socketFactory, location }) {
			const [state, setState] = (0, react.useState)(EMPTY_STATE);
			const [frame, setFrame] = (0, react.useState)(null);
			const [traces, setTraces] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)(null);
			const [status, setStatus] = (0, react.useState)("connecting");
			const socketRef = (0, react.useRef)(null);
			/** Last active tab seen in a state push; a tab switch invalidates the picture. */
			const lastActiveTabRef = (0, react.useRef)(null);
			const factory = (0, react.useMemo)(() => socketFactory ?? ((handlers) => connectBrowserViewSocket(handlers, {
				location,
				sessionId
			})), [
				socketFactory,
				location,
				sessionId
			]);
			(0, react.useEffect)(() => {
				const instance = factory({
					onStatus: (next) => {
						setStatus(next);
					},
					onState: (next) => {
						if (lastActiveTabRef.current !== next.activeTabId) {
							lastActiveTabRef.current = next.activeTabId;
							setFrame(null);
						}
						setState(next);
					},
					onFrame: (next) => {
						setError(null);
						setFrame(next);
					},
					onAction: (trace) => {
						setTraces((current) => [trace, ...current].slice(0, TRACE_LIMIT));
					},
					onError: (code, message) => {
						setError({
							code,
							message
						});
					},
					onRtcAnswer: (sdp) => {
						rtcAnswerRef.current?.(sdp);
					}
				});
				socketRef.current = instance;
				return () => {
					socketRef.current = null;
					instance.close();
				};
			}, [factory]);
			const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
			const loading = activeTab?.loading === true || status !== "open";
			const hostError = state.message !== void 0 && state.message.length > 0 ? {
				code: "",
				message: state.message
			} : null;
			const effectiveError = error ?? hostError;
			const visibleFrame = effectiveError === null ? frame : null;
			const dataUrl = visibleFrame === null ? null : `data:image/jpeg;base64,${visibleFrame.data}`;
			const frameRef = (0, react.useRef)(null);
			const canvasRef = (0, react.useRef)(null);
			const lastMoveAtRef = (0, react.useRef)(0);
			const MOVE_THROTTLE_MS = 33;
			const [dcActive, setDcActive] = (0, react.useState)(false);
			const pcRef = (0, react.useRef)(null);
			const rtcTriedRef = (0, react.useRef)(false);
			const rtcAnswerRef = (0, react.useRef)(void 0);
			const sendInput = (input) => {
				socketRef.current?.send({
					v: 1,
					kind: "input",
					input
				});
			};
			/** Rescale a pointer position from displayed size to the host viewport. */
			const pointOf = (event) => {
				const element = dcActive ? canvasRef.current : frameRef.current;
				if (element === null || visibleFrame === null) return null;
				const rect = element.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return null;
				return {
					x: Math.round((event.clientX - rect.left) * (visibleFrame.width / rect.width)),
					y: Math.round((event.clientY - rect.top) * (visibleFrame.height / rect.height))
				};
			};
			const buttonOf = (event) => {
				return event.button === 2 ? "right" : event.button === 1 ? "middle" : "left";
			};
			const modifiersOf = (event) => {
				const modifiers = [];
				if (event.altKey) modifiers.push("alt");
				if (event.ctrlKey) modifiers.push("ctrl");
				if (event.metaKey) modifiers.push("meta");
				if (event.shiftKey) modifiers.push("shift");
				return modifiers;
			};
			(0, react.useEffect)(() => {
				const element = dcActive ? canvasRef.current : frameRef.current;
				if (element === null || visibleFrame === null) return;
				const onWheel = (event) => {
					event.preventDefault();
					const point = pointOf(event);
					if (point === null) return;
					sendInput({
						kind: "wheel",
						x: point.x,
						y: point.y,
						deltaX: event.deltaX,
						deltaY: event.deltaY
					});
				};
				element.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					element.removeEventListener("wheel", onWheel);
				};
			}, [visibleFrame, dcActive]);
			const onPointerDown = (event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				const point = pointOf(event);
				if (point !== null) sendInput({
					kind: "mouse",
					action: "down",
					x: point.x,
					y: point.y,
					button: buttonOf(event)
				});
			};
			const onPointerMove = (event) => {
				const now = Date.now();
				if (now - lastMoveAtRef.current < MOVE_THROTTLE_MS) return;
				lastMoveAtRef.current = now;
				const point = pointOf(event);
				if (point !== null) sendInput({
					kind: "mouse",
					action: "move",
					x: point.x,
					y: point.y
				});
			};
			const onPointerUp = (event) => {
				const point = pointOf(event);
				if (point !== null) sendInput({
					kind: "mouse",
					action: "up",
					x: point.x,
					y: point.y,
					button: buttonOf(event)
				});
			};
			const onKeyDown = (event) => {
				if (event.key.length === 1 || event.key === "Backspace" || event.key === "Tab") event.preventDefault();
				sendInput({
					kind: "key",
					action: "down",
					key: event.key,
					code: event.code,
					...event.key.length === 1 ? { text: event.key } : {},
					modifiers: modifiersOf(event)
				});
			};
			const onKeyUp = (event) => {
				sendInput({
					kind: "key",
					action: "up",
					key: event.key,
					code: event.code,
					modifiers: modifiersOf(event)
				});
			};
			const inputHandlers = visibleFrame === null ? {} : {
				tabIndex: 0,
				onPointerDown,
				onPointerMove,
				onPointerUp,
				onKeyDown,
				onKeyUp
			};
			(0, react.useEffect)(() => {
				if (status !== "open") {
					rtcTriedRef.current = false;
					setDcActive(false);
					return;
				}
				if (rtcTriedRef.current || dataUrl === null || frame === null) return;
				rtcTriedRef.current = true;
				let pc;
				try {
					pc = new RTCPeerConnection({ iceServers: [] });
				} catch {
					return;
				}
				pcRef.current = pc;
				const channel = pc.createDataChannel("frames", {
					ordered: false,
					maxRetransmits: 0
				});
				channel.binaryType = "arraybuffer";
				channel.onopen = () => {
					setDcActive(true);
				};
				channel.onclose = () => {
					setDcActive(false);
				};
				channel.onmessage = (event) => {
					const buffer = event.data;
					if (buffer.byteLength < 5) return;
					const blob = new Blob([buffer.slice(4)], { type: "image/jpeg" });
					createImageBitmap(blob).then((bitmap) => {
						const canvas = canvasRef.current;
						if (canvas !== null) {
							if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
							if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
							canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
						}
						bitmap.close();
						setDcActive(true);
					}).catch(() => void 0);
				};
				rtcAnswerRef.current = (sdp) => {
					pc.setRemoteDescription(JSON.parse(sdp)).catch(() => void 0);
				};
				pc.createOffer().then((offer) => pc.setLocalDescription(offer)).then(() => {
					socketRef.current?.send({
						v: 1,
						kind: "rtc-offer",
						sdp: JSON.stringify(pc.localDescription)
					});
				}).catch(() => {
					pc.close();
				});
				const timeout = setTimeout(() => {
					if (channel.readyState !== "open") {
						rtcAnswerRef.current = void 0;
						pc.close();
						setDcActive(false);
					}
				}, 5e3);
				return () => {
					clearTimeout(timeout);
					rtcAnswerRef.current = void 0;
					pc.close();
					setDcActive(false);
				};
			}, [
				status,
				dataUrl === null,
				frame === null
			]);
			const statusLabel = status !== "open" ? t("panel.status.connecting") : loading ? t("panel.status.loading") : t("panel.status.live");
			const dotState = status !== "open" ? "idle" : loading ? "ongoing" : "done";
			const pageTitle = activeTab === null || activeTab.title.length === 0 ? void 0 : activeTab.title;
			const url = activeTab?.url ?? "";
			(0, react.useEffect)(() => {
				liveTitle?.set(sessionId, pageTitle);
				return () => {
					liveTitle?.set(sessionId, void 0);
				};
			}, [
				liveTitle,
				sessionId,
				pageTitle
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.root,
				"data-dsh-plugin": BROWSER_VIEW_PLUGIN,
				"data-dsh-part": BROWSER_VIEW_PARTS.panel,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: panel_module_css_default.toolbar,
						"data-dsh-part": BROWSER_VIEW_PARTS.toolbar,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: panel_module_css_default.addressBox,
								"data-dsh-part": BROWSER_VIEW_PARTS.address,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: panel_module_css_default.address,
									type: "text",
									readOnly: true,
									value: url,
									title: url.length > 0 ? url : void 0,
									placeholder: t("panel.url.empty"),
									"aria-label": t("panel.address.label"),
									spellCheck: false,
									onFocus: (event) => {
										event.currentTarget.select();
									},
									onClick: (event) => {
										event.currentTarget.select();
									}
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: panel_module_css_default.status,
								"data-dsh-part": BROWSER_VIEW_PARTS.status,
								"aria-live": "polite",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
									state: dotState,
									size: 10
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: panel_module_css_default.statusText,
									children: statusLabel
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: panel_module_css_default.tool,
								title: t("panel.toolbar.refresh"),
								"aria-label": t("panel.toolbar.refresh"),
								disabled: activeTab === null,
								onClick: () => {
									socketRef.current?.send({
										v: 1,
										kind: "request-frame"
									});
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {})
							})
						]
					}),
					state.tabs.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.tabs,
						role: "tablist",
						"data-dsh-part": BROWSER_VIEW_PARTS.tabs,
						children: state.tabs.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							"aria-selected": tab.id === state.activeTabId,
							className: cx(panel_module_css_default.tab, tab.id === state.activeTabId && panel_module_css_default.tabActive),
							title: tab.url,
							onClick: () => {
								socketRef.current?.send({
									v: 1,
									kind: "select-tab",
									tabId: tab.id
								});
							},
							children: tab.title.length > 0 ? tab.title : t("panel.tab.untitled")
						}, tab.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.content,
						children: effectiveError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: panel_module_css_default.error,
							"data-dsh-part": BROWSER_VIEW_PARTS.error,
							role: "alert",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: panel_module_css_default.errorTitle,
									children: t("panel.error.title")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: panel_module_css_default.errorBody,
									children: effectiveError.message
								}),
								effectiveError.code.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: panel_module_css_default.errorCode,
									children: effectiveError.code
								})
							]
						}) : dataUrl === null || visibleFrame === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: panel_module_css_default.empty,
							"data-dsh-part": BROWSER_VIEW_PARTS.empty,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: panel_module_css_default.emptyTitle,
								children: t("panel.empty.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: panel_module_css_default.emptyHint,
								children: t("panel.empty.hint")
							})]
						}) : dcActive ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
							ref: canvasRef,
							className: panel_module_css_default.frame,
							"data-dsh-part": BROWSER_VIEW_PARTS.frame,
							width: visibleFrame.width,
							height: visibleFrame.height,
							style: {
								cursor: "default",
								outline: "none"
							},
							...inputHandlers
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							ref: frameRef,
							className: panel_module_css_default.frame,
							"data-dsh-part": BROWSER_VIEW_PARTS.frame,
							src: dataUrl,
							alt: t("panel.frame.alt"),
							width: visibleFrame.width,
							height: visibleFrame.height,
							draggable: false,
							style: {
								cursor: "default",
								outline: "none"
							},
							...inputHandlers
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", {
						className: panel_module_css_default.trace,
						"data-dsh-part": BROWSER_VIEW_PARTS.trace,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: panel_module_css_default.traceList,
							children: traces.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: panel_module_css_default.traceIdle,
								children: t("panel.trace.idle")
							}) : traces.map((trace, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: panel_module_css_default.traceRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: panel_module_css_default.traceTool,
									children: trace.tool
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: panel_module_css_default.traceSummary,
									children: trace.summary
								})]
							}, `${trace.at}-${index}`))
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/guide-icon.tsx
		/**
		* Render the guide glyph.
		* @param props - square edge in px (the guide passes 22 or 26) and a layout class.
		* @returns the window-and-cursor mark.
		*/
		function BrowserViewGuideGlyph({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				className,
				"aria-hidden": "true",
				focusable: "false",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "1.75",
						y: "2.25",
						width: "12.5",
						height: "11.5",
						rx: "1.75",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M1.75 5.75h12.5",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "3.9",
						cy: "4",
						r: "0.7",
						fill: "currentColor"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M7.4 8.15l3.85 1.7-1.6.65-.7 1.65z",
						fill: "currentColor"
					})
				]
			});
		}
		//#endregion
		//#region src/client/tab-type.ts
		/** What this plugin's tabs are, and what openTabIn/openTab name. */
		const BROWSER_VIEW_TAB_KIND = "browser-view";
		/** This implementation's identity in the tab system; also the keyed slot dispatch key. */
		const BROWSER_VIEW_TAB_ID = "@jimorsm/dsh-client-ui-browser-view";
		/** Identity of this type's capsule on the guide page, stable within the provider. */
		const BROWSER_VIEW_GUIDE_ENTRY_ID = "open";
		/**
		* Build stage one of the registration.
		* @param t - translate function of this plugin's dictionary.
		* @returns the static tab type the registry keeps.
		*/
		function browserViewTabDefinition(t) {
			return {
				id: BROWSER_VIEW_TAB_ID,
				kind: BROWSER_VIEW_TAB_KIND,
				keepMounted: true,
				priority: "extension",
				title: () => t("tab.title"),
				guide: [{
					id: BROWSER_VIEW_GUIDE_ENTRY_ID,
					order: 40,
					title: () => t("tab.title"),
					description: () => t("guide.description"),
					icon: BrowserViewGuideGlyph
				}]
			};
		}
		//#endregion
		//#region src/client/tab-title.tsx
		/**
		* The browser view's chip text.
		*
		* The shell owns the right-sidebar chip: its box, its close and hidden
		* controls, the active highlight and the switch between tabs. This component
		* draws only what sits inside it - the browser mark and the name - which is why
		* it carries no state of its own.
		*
		* The name prefers the page the body is streaming, read from the published
		* channel (live-title.ts), and falls back to this plugin's own name before the
		* first state push: a chip that says "Checkout" is more useful than one that
		* says "Browser view", but an empty chip is worse than either.
		*/
		/**
		* Decorative browser-window mark; inline so the chip carries no icon dependency.
		* @returns the glyph.
		*/
		function BrowserViewMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: panel_module_css_default.tabTitleMark,
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				focusable: "false",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "1.75",
						y: "2.25",
						width: "12.5",
						height: "11.5",
						rx: "1.75",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.5"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M1.75 5.75h12.5",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.5"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M7.4 8.15l3.85 1.7-1.6.65-.7 1.65z",
						fill: "currentColor"
					})
				]
			});
		}
		/**
		* Render the chip contents.
		* @param props - composed slot props.
		* @returns the mark and the tab's name.
		*/
		function BrowserViewTabTitle({ t, sessionId, liveTitle }) {
			const pageTitle = (0, react.useSyncExternalStore)((0, react.useCallback)((listener) => liveTitle?.subscribe(listener) ?? (() => {}), [liveTitle]), (0, react.useCallback)(() => liveTitle?.get(sessionId), [liveTitle, sessionId]), () => void 0);
			const label = pageTitle !== void 0 && pageTitle.length > 0 ? pageTitle : t("tab.title");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: panel_module_css_default.tabTitle,
				"data-dsh-plugin": BROWSER_VIEW_PLUGIN,
				"data-dsh-part": BROWSER_VIEW_PARTS.tabTitle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrowserViewMark, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: panel_module_css_default.tabTitleText,
					children: label
				})]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "browser-view";
		/** Services required by this plugin. */
		const inject = [
			"slots",
			"locale",
			"sidebarRightTabs"
		];
		/**
		* Register the browser-view tab type and its surfaces.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				try {
					return ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {
					return () => {};
				}
			}, "browser-view: dictionaries");
			let translate;
			try {
				translate = ctx.locale.bind(NS);
			} catch {}
			const copy = (key) => translate?.(key) ?? zh[key];
			ctx.effect(() => {
				try {
					return ctx.sidebarRightTabs.register(browserViewTabDefinition(copy));
				} catch {
					return () => {};
				}
			}, "browser-view: tab type");
			const liveTitle = createLiveTitleStore();
			ctx.slots.inject("sidebar.right.pane.tab", () => {
				try {
					return ctx.slots.register({
						name: "sidebar.right.pane.tab",
						key: BROWSER_VIEW_TAB_ID,
						locale: NS,
						inject: (sessionId) => ({
							sessionId,
							liveTitle
						})
					}, BrowserViewPanel);
				} catch {
					return () => {};
				}
			});
			ctx.slots.inject("sidebar.right.pane.tab.title", () => {
				try {
					return ctx.slots.register({
						name: "sidebar.right.pane.tab.title",
						key: BROWSER_VIEW_TAB_ID,
						locale: NS,
						inject: (sessionId) => ({
							sessionId,
							liveTitle
						})
					}, BrowserViewTabTitle);
				} catch {
					return () => {};
				}
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map