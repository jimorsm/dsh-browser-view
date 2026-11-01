window.__ModuleLoader__.load({
	id: "@jimorsm/dsh-client-ui-browser-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __defProp$2 = Object.defineProperty;
		var __esmMin = (fn, res, err) => () => {
			if (err) throw err[0];
			try {
				return fn && (res = fn(fn = 0)), res;
			} catch (e) {
				throw err = [e], e;
			}
		};
		var __exportAll = (all, no_symbols) => {
			let target = {};
			for (var name in all) __defProp$2(target, name, {
				get: all[name],
				enumerable: true
			});
			if (!no_symbols) __defProp$2(target, Symbol.toStringTag, { value: "Module" });
			return target;
		};
		//#endregion
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
		*
		* The lane switch needs its own words rather than one label: the control has to
		* name what is on screen now ('panel.mode.dom' / 'panel.mode.pixels'), say what
		* pressing it does ('panel.mode.switch'), and account for a mirror that could
		* not start ('panel.mirror.starting' / 'panel.mirror.unavailable' - the latter
		* is a sentence prefix, because the host's own reason is appended to it).
		*/
		/** Simplified Chinese dictionary (key-set source of truth). */
		const zh = {
			"tab.title": "浏览器视图",
			"guide.description": "看 agent 正在操作的网页",
			"panel.tab.untitled": "未命名页面",
			"panel.url.empty": "还没有打开页面",
			"panel.address.label": "页面地址",
			"panel.toolbar.refresh": "刷新画面",
			"panel.mode.dom": "文字",
			"panel.mode.pixels": "像素",
			"panel.mode.switch": "切换显示模式（文字镜像 / 像素画面）",
			"panel.frame.alt": "agent 正在操作的页面画面",
			"panel.empty.title": "还没有画面",
			"panel.empty.hint": "让 agent 打开一个页面后，这里会实时显示它正在看的网页。",
			"panel.mirror.starting": "正在建立文字镜像…",
			"panel.mirror.unavailable": "文字镜像不可用，已切换到像素画面：",
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
			"panel.mode.dom": "Text",
			"panel.mode.pixels": "Pixels",
			"panel.mode.switch": "Switch the view mode (DOM mirror or pixel stream)",
			"panel.frame.alt": "Live view of the page the agent is driving",
			"panel.empty.title": "No frames yet",
			"panel.empty.hint": "Once the agent opens a page, this tab shows the page it is looking at.",
			"panel.mirror.starting": "Building the DOM mirror…",
			"panel.mirror.unavailable": "The DOM mirror is unavailable; showing the pixel stream instead: ",
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
		/**
		* Read one DataChannel message.
		* @param data - the raw message.
		* @returns the chunk, or null when the message is not a well-formed chunk.
		*/
		function readFrameChunk(data) {
			if (data.byteLength < 6) return null;
			const view = new DataView(data);
			const seq = view.getUint32(0);
			const index = view.getUint8(4);
			const count = view.getUint8(5);
			if (count === 0 || index >= count) return null;
			return {
				seq,
				index,
				count,
				payload: data.slice(6)
			};
		}
		/** Reassembles chunked frames, one frame at a time. */
		var FrameAssembler = class {
			partial = null;
			/**
			* Offer one chunk.
			* @param chunk - a chunk from {@link readFrameChunk}.
			* @returns the complete frame bytes, or null while it is still incomplete.
			*/
			push(chunk) {
				const partial = this.partial;
				if (partial === null || partial.seq !== chunk.seq) this.partial = {
					seq: chunk.seq,
					chunks: new Array(chunk.count),
					received: 0
				};
				const current = this.partial;
				if (current === null) return null;
				if (current.chunks[chunk.index] === void 0) {
					current.chunks[chunk.index] = chunk.payload;
					current.received += 1;
				}
				if (current.received < current.chunks.length) return null;
				const parts = current.chunks;
				this.partial = null;
				const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
				const frame = new Uint8Array(total);
				let offset = 0;
				for (const part of parts) {
					frame.set(new Uint8Array(part), offset);
					offset += part.byteLength;
				}
				return frame.buffer;
			}
			/** Drop whatever partial frame is held; called when the transport changes. */
			reset() {
				this.partial = null;
			}
		};
		//#endregion
		//#region node_modules/.pnpm/rrweb@2.2.0/node_modules/rrweb/dist/rrweb.js
		var rrweb_exports = /* @__PURE__ */ __exportAll({
			EventType: () => EventType,
			IncrementalSource: () => IncrementalSource,
			MouseInteractions: () => MouseInteractions,
			Replayer: () => Replayer,
			ReplayerEvents: () => ReplayerEvents,
			addAnnotation: () => addAnnotation,
			addCustomEvent: () => addCustomEvent,
			canvasMutation: () => canvasMutation,
			freezePage: () => freezePage,
			mirror: () => _mirror,
			record: () => record,
			takeFullSnapshot: () => takeFullSnapshot,
			utils: () => utils
		});
		function getUntaintedPrototype$2(key) {
			if (untaintedBasePrototype$2[key]) return untaintedBasePrototype$2[key];
			const defaultObj = globalThis[key];
			const defaultPrototype = defaultObj.prototype;
			const accessorNames = key in testableAccessors$2 ? testableAccessors$2[key] : void 0;
			const isUntaintedAccessors = Boolean(accessorNames && accessorNames.every((accessor) => {
				var _a2, _b;
				return Boolean((_b = (_a2 = Object.getOwnPropertyDescriptor(defaultPrototype, accessor)) == null ? void 0 : _a2.get) == null ? void 0 : _b.toString().includes("[native code]"));
			}));
			const methodNames = key in testableMethods$2 ? testableMethods$2[key] : void 0;
			const isUntaintedMethods = Boolean(methodNames && methodNames.every((method) => {
				var _a2;
				return typeof defaultPrototype[method] === "function" && ((_a2 = defaultPrototype[method]) == null ? void 0 : _a2.toString().includes("[native code]"));
			}));
			if (isUntaintedAccessors && isUntaintedMethods && !isAngularZonePresent$2()) {
				untaintedBasePrototype$2[key] = defaultObj.prototype;
				return defaultObj.prototype;
			}
			try {
				const iframeEl = document.createElement("iframe");
				iframeEl.style.display = "none";
				document.body.appendChild(iframeEl);
				const win = iframeEl.contentWindow;
				if (!win) return defaultObj.prototype;
				const untaintedObject = win[key].prototype;
				if (!untaintedObject) {
					iframeEl.remove();
					return defaultPrototype;
				}
				const ua = navigator.userAgent;
				if (ua.includes("Safari") && !ua.includes("Chrome")) {
					iframeEl.classList.add("rr-block");
					iframeEl.setAttribute("__rrwebUntaintedMutationObserver", "");
					untaintedBaseIframeCleanup$2[key] = () => iframeEl.remove();
				} else iframeEl.remove();
				return untaintedBasePrototype$2[key] = untaintedObject;
			} catch {
				return defaultPrototype;
			}
		}
		function getUntaintedAccessor$2(key, instance, accessor) {
			var _a2, _b;
			const cached = (_a2 = untaintedAccessorCache$2[key]) == null ? void 0 : _a2[accessor];
			if (cached) return cached.call(instance);
			const untaintedPrototype = getUntaintedPrototype$2(key);
			const untaintedAccessor = (_b = Object.getOwnPropertyDescriptor(untaintedPrototype, accessor)) == null ? void 0 : _b.get;
			if (!untaintedAccessor) return instance[accessor];
			(untaintedAccessorCache$2[key] || (untaintedAccessorCache$2[key] = {}))[accessor] = untaintedAccessor;
			return untaintedAccessor.call(instance);
		}
		function getUntaintedMethod$2(key, instance, method) {
			const cacheKey = `${key}.${String(method)}`;
			if (untaintedMethodCache$2[cacheKey]) return untaintedMethodCache$2[cacheKey].bind(instance);
			const untaintedMethod = getUntaintedPrototype$2(key)[method];
			if (typeof untaintedMethod !== "function") return instance[method];
			untaintedMethodCache$2[cacheKey] = untaintedMethod;
			return untaintedMethod.bind(instance);
		}
		function ownerDocument$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "ownerDocument");
		}
		function childNodes$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "childNodes");
		}
		function parentNode$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "parentNode");
		}
		function parentElement$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "parentElement");
		}
		function textContent$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "textContent");
		}
		function firstChild$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "firstChild");
		}
		function lastChild$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "lastChild");
		}
		function nextSibling$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "nextSibling");
		}
		function previousSibling$2(n2) {
			return getUntaintedAccessor$2("Node", n2, "previousSibling");
		}
		function contains$2(n2, other) {
			return getUntaintedMethod$2("Node", n2, "contains")(other);
		}
		function getRootNode$2(n2) {
			return getUntaintedMethod$2("Node", n2, "getRootNode")();
		}
		function host$2(n2) {
			if (!n2 || !("host" in n2)) return null;
			return getUntaintedAccessor$2("ShadowRoot", n2, "host");
		}
		function styleSheets$2(n2) {
			return n2.styleSheets;
		}
		function shadowRoot$2(n2) {
			if (!n2 || !("shadowRoot" in n2)) return null;
			return getUntaintedAccessor$2("Element", n2, "shadowRoot");
		}
		function querySelector$2(n2, selectors) {
			return getUntaintedAccessor$2("Element", n2, "querySelector")(selectors);
		}
		function querySelectorAll$2(n2, selectors) {
			return getUntaintedAccessor$2("Element", n2, "querySelectorAll")(selectors);
		}
		function mutationObserverCtor$2() {
			const prototype = getUntaintedPrototype$2("MutationObserver");
			mutationObserverUsers$2++;
			let stopCalled = false;
			return [prototype.constructor, () => {
				if (stopCalled) return;
				stopCalled = true;
				if (--mutationObserverUsers$2 !== 0) return;
				const cleanup = untaintedBaseIframeCleanup$2["MutationObserver"];
				if (!cleanup) return;
				try {
					cleanup();
				} finally {
					delete untaintedBasePrototype$2["MutationObserver"];
					delete untaintedBaseIframeCleanup$2["MutationObserver"];
				}
			}];
		}
		function patch$2(source, name, replacement) {
			try {
				if (!(name in source)) return () => {};
				const original = source[name];
				const wrapped = replacement(original);
				if (typeof wrapped === "function") {
					wrapped.prototype = wrapped.prototype || {};
					Object.defineProperties(wrapped, { __rrweb_original__: {
						enumerable: false,
						value: original
					} });
				}
				source[name] = wrapped;
				return () => {
					source[name] = original;
				};
			} catch {
				return () => {};
			}
		}
		function isElement(n2) {
			return n2.nodeType === n2.ELEMENT_NODE;
		}
		function isShadowRoot(n2) {
			const hostEl = n2 && "host" in n2 && "mode" in n2 && index$2.host(n2) || null;
			return Boolean(hostEl && "shadowRoot" in hostEl && index$2.shadowRoot(hostEl) === n2);
		}
		function isNativeShadowDom(shadowRoot2) {
			return Object.prototype.toString.call(shadowRoot2) === "[object ShadowRoot]";
		}
		function fixBrowserCompatibilityIssuesInCSS(cssText) {
			if (cssText.includes(" background-clip: text;") && !cssText.includes(" -webkit-background-clip: text;")) cssText = cssText.replace(/\sbackground-clip:\s*text;/g, " -webkit-background-clip: text; background-clip: text;");
			return cssText;
		}
		function escapeImportStatement(rule2) {
			const { cssText } = rule2;
			if (cssText.split("\"").length < 3) return cssText;
			const statement = ["@import", `url(${JSON.stringify(rule2.href)})`];
			if (rule2.layerName === "") statement.push(`layer`);
			else if (rule2.layerName) statement.push(`layer(${rule2.layerName})`);
			if (rule2.supportsText) statement.push(`supports(${rule2.supportsText})`);
			if (rule2.media.length) statement.push(rule2.media.mediaText);
			return statement.join(" ") + ";";
		}
		function stringifyStylesheet(s2) {
			try {
				const rules2 = s2.rules || s2.cssRules;
				if (!rules2) return null;
				let sheetHref = s2.href;
				if (!sheetHref && s2.ownerNode) sheetHref = s2.ownerNode.baseURI;
				return fixBrowserCompatibilityIssuesInCSS(Array.from(rules2, (rule2) => stringifyRule(rule2, sheetHref)).join(""));
			} catch (error) {
				return null;
			}
		}
		function stringifyRule(rule2, sheetHref) {
			if (isCSSImportRule(rule2)) {
				let importStringified;
				try {
					importStringified = stringifyStylesheet(rule2.styleSheet) || escapeImportStatement(rule2);
				} catch (error) {
					importStringified = rule2.cssText;
				}
				if (rule2.styleSheet.href) return absolutifyURLs(importStringified, rule2.styleSheet.href);
				return importStringified;
			} else {
				let ruleStringified = rule2.cssText;
				if (isCSSStyleRule(rule2) && rule2.selectorText.includes(":")) ruleStringified = fixSafariColons(ruleStringified);
				if (sheetHref) return absolutifyURLs(ruleStringified, sheetHref);
				return ruleStringified;
			}
		}
		function fixSafariColons(cssStringified) {
			return cssStringified.replace(/(\[(?:[\w-]+)[^\\])(:(?:[\w-]+)\])/gm, "$1\\$2");
		}
		function isCSSImportRule(rule2) {
			return "styleSheet" in rule2;
		}
		function isCSSStyleRule(rule2) {
			return "selectorText" in rule2;
		}
		function createMirror$2() {
			return new Mirror();
		}
		function maskInputValue({ element, maskInputOptions, tagName, type, value, maskInputFn }) {
			let text = value || "";
			const actualType = type && toLowerCase(type);
			if (maskInputOptions[tagName.toLowerCase()] || actualType && maskInputOptions[actualType]) if (maskInputFn) text = maskInputFn(text, element);
			else text = "*".repeat(text.length);
			return text;
		}
		function toLowerCase(str) {
			return str.toLowerCase();
		}
		function is2DCanvasBlank(canvas) {
			const ctx = canvas.getContext("2d");
			if (!ctx) return true;
			const chunkSize = 50;
			for (let x = 0; x < canvas.width; x += chunkSize) for (let y = 0; y < canvas.height; y += chunkSize) {
				const getImageData = ctx.getImageData;
				const originalGetImageData = ORIGINAL_ATTRIBUTE_NAME in getImageData ? getImageData[ORIGINAL_ATTRIBUTE_NAME] : getImageData;
				if (new Uint32Array(originalGetImageData.call(ctx, x, y, Math.min(chunkSize, canvas.width - x), Math.min(chunkSize, canvas.height - y)).data.buffer).some((pixel) => pixel !== 0)) return false;
			}
			return true;
		}
		function isNodeMetaEqual(a2, b) {
			if (!a2 || !b || a2.type !== b.type) return false;
			if (a2.type === NodeType$3.Document) return a2.compatMode === b.compatMode;
			else if (a2.type === NodeType$3.DocumentType) return a2.name === b.name && a2.publicId === b.publicId && a2.systemId === b.systemId;
			else if (a2.type === NodeType$3.Comment || a2.type === NodeType$3.Text || a2.type === NodeType$3.CDATA) return a2.textContent === b.textContent;
			else if (a2.type === NodeType$3.Element) return a2.tagName === b.tagName && JSON.stringify(a2.attributes) === JSON.stringify(b.attributes) && a2.isSVG === b.isSVG && a2.needBlock === b.needBlock;
			return false;
		}
		function getInputType(element) {
			const type = element.type;
			return element.hasAttribute("data-rr-is-password") ? "password" : type ? toLowerCase(type) : null;
		}
		function extractFileExtension(path, baseURL) {
			let url;
			try {
				url = new URL(path, baseURL ?? window.location.href);
			} catch (err) {
				return null;
			}
			const match = url.pathname.match(/\.([0-9a-z]+)(?:$)/i);
			return (match == null ? void 0 : match[1]) ?? null;
		}
		function extractOrigin(url) {
			let origin = "";
			if (url.indexOf("//") > -1) origin = url.split("/").slice(0, 3).join("/");
			else origin = url.split("/")[0];
			origin = origin.split("?")[0];
			return origin;
		}
		function absolutifyURLs(cssText, href) {
			return (cssText || "").replace(URL_IN_CSS_REF, (origin, quote1, path1, quote2, path2, path3) => {
				const filePath = path1 || path2 || path3;
				const maybeQuote = quote1 || quote2 || "";
				if (!filePath) return origin;
				if (URL_PROTOCOL_MATCH.test(filePath) || URL_WWW_MATCH.test(filePath)) return `url(${maybeQuote}${filePath}${maybeQuote})`;
				if (DATA_URI.test(filePath)) return `url(${maybeQuote}${filePath}${maybeQuote})`;
				if (filePath[0] === "/") return `url(${maybeQuote}${extractOrigin(href) + filePath}${maybeQuote})`;
				const filePathNoHash = filePath.split("#")[0];
				const maybeHash = filePath.substring(filePathNoHash.length);
				const stack = href.split("#")[0].split("/");
				const parts = filePathNoHash.split("/");
				stack.pop();
				for (const part of parts) if (part === ".") continue;
				else if (part === "..") stack.pop();
				else stack.push(part);
				return `url(${maybeQuote}${stack.join("/")}${maybeHash}${maybeQuote})`;
			});
		}
		function normalizeCssString(cssText, _testNoPxNorm = false) {
			return _testNoPxNorm ? cssText.replace(cssNormalizeReNoPx, "") : cssText.replace(cssNormalizeRe, "$1");
		}
		function splitCssText(cssText, style, _testNoPxNorm = false) {
			const childNodes2 = Array.from(style.childNodes);
			const splits = [];
			let iterCount = 0;
			if (childNodes2.length > 1 && cssText && typeof cssText === "string") {
				let cssTextNorm = normalizeCssString(cssText, _testNoPxNorm);
				const normFactor = cssTextNorm.length / cssText.length;
				for (let i2 = 1; i2 < childNodes2.length; i2++) if (childNodes2[i2].textContent && typeof childNodes2[i2].textContent === "string") {
					const textContentNorm = normalizeCssString(childNodes2[i2].textContent, _testNoPxNorm);
					const jLimit = 100;
					let j = 3;
					for (; j < textContentNorm.length; j++) {
						if (textContentNorm[j].match(/[a-zA-Z0-9]/) || textContentNorm.indexOf(textContentNorm.substring(0, j), 1) !== -1) continue;
						break;
					}
					for (; j < textContentNorm.length; j++) {
						let startSubstring = textContentNorm.substring(0, j);
						let cssNormSplits = cssTextNorm.split(startSubstring);
						let splitNorm = -1;
						if (cssNormSplits.length === 2) splitNorm = cssNormSplits[0].length;
						else if (cssNormSplits.length > 2 && cssNormSplits[0] === "" && childNodes2[i2 - 1].textContent !== "") splitNorm = cssTextNorm.indexOf(startSubstring, 1);
						else if (cssNormSplits.length === 1) {
							startSubstring = startSubstring.substring(0, startSubstring.length - 1);
							cssNormSplits = cssTextNorm.split(startSubstring);
							if (cssNormSplits.length <= 1) {
								splits.push(cssText);
								return splits;
							}
							j = 101;
						} else if (j === textContentNorm.length - 1) splitNorm = cssTextNorm.indexOf(startSubstring);
						if (cssNormSplits.length >= 2 && j > jLimit) {
							const prevTextContent = childNodes2[i2 - 1].textContent;
							if (prevTextContent && typeof prevTextContent === "string") {
								const prevMinLength = normalizeCssString(prevTextContent).length;
								splitNorm = cssTextNorm.indexOf(startSubstring, prevMinLength);
							}
							if (splitNorm === -1) splitNorm = cssNormSplits[0].length;
						}
						if (splitNorm !== -1) {
							let k = Math.floor(splitNorm / normFactor);
							for (; k > 0 && k < cssText.length;) {
								iterCount += 1;
								if (iterCount > 50 * childNodes2.length) {
									splits.push(cssText);
									return splits;
								}
								const normPart = normalizeCssString(cssText.substring(0, k), _testNoPxNorm);
								if (normPart.length === splitNorm) {
									splits.push(cssText.substring(0, k));
									cssText = cssText.substring(k);
									cssTextNorm = cssTextNorm.substring(splitNorm);
									break;
								} else if (normPart.length < splitNorm) k += Math.max(1, Math.floor((splitNorm - normPart.length) / normFactor));
								else k -= Math.max(1, Math.floor((normPart.length - splitNorm) * normFactor));
							}
							break;
						}
					}
				}
			}
			splits.push(cssText);
			return splits;
		}
		function markCssSplits(cssText, style) {
			return splitCssText(cssText, style).join("/* rr_split */");
		}
		function genId() {
			return _id++;
		}
		function getValidTagName$1(element) {
			if (element instanceof HTMLFormElement) return "form";
			const processedTagName = toLowerCase(element.tagName);
			if (tagNameRegex.test(processedTagName)) return "div";
			return processedTagName;
		}
		function getAbsoluteSrcsetString(doc, attributeValue) {
			if (attributeValue.trim() === "") return attributeValue;
			let pos = 0;
			function collectCharacters(regEx) {
				let chars2;
				const match = regEx.exec(attributeValue.substring(pos));
				if (match) {
					chars2 = match[0];
					pos += chars2.length;
					return chars2;
				}
				return "";
			}
			const output = [];
			while (true) {
				collectCharacters(SRCSET_COMMAS_OR_SPACES);
				if (pos >= attributeValue.length) break;
				let url = collectCharacters(SRCSET_NOT_SPACES);
				if (url.slice(-1) === ",") {
					url = absoluteToDoc(doc, url.substring(0, url.length - 1));
					output.push(url);
				} else {
					let descriptorsStr = "";
					url = absoluteToDoc(doc, url);
					let inParens = false;
					while (true) {
						const c2 = attributeValue.charAt(pos);
						if (c2 === "") {
							output.push((url + descriptorsStr).trim());
							break;
						} else if (!inParens) {
							if (c2 === ",") {
								pos += 1;
								output.push((url + descriptorsStr).trim());
								break;
							} else if (c2 === "(") inParens = true;
						} else if (c2 === ")") inParens = false;
						descriptorsStr += c2;
						pos += 1;
					}
				}
			}
			return output.join(", ");
		}
		function absoluteToDoc(doc, attributeValue) {
			if (!attributeValue || attributeValue.trim() === "") return attributeValue;
			return getHref(doc, attributeValue);
		}
		function isSVGElement(el) {
			return Boolean(el.tagName === "svg" || el.ownerSVGElement);
		}
		function getHref(doc, customHref) {
			let a2 = cachedDocument.get(doc);
			if (!a2) {
				a2 = doc.createElement("a");
				cachedDocument.set(doc, a2);
			}
			if (!customHref) customHref = "";
			else if (customHref.startsWith("blob:") || customHref.startsWith("data:")) return customHref;
			a2.setAttribute("href", customHref);
			return a2.href;
		}
		function transformAttribute(doc, tagName, name, value) {
			if (!value) return value;
			if (name === "src" || name === "href" && !(tagName === "use" && value[0] === "#")) return absoluteToDoc(doc, value);
			else if (name === "xlink:href" && value[0] !== "#") return absoluteToDoc(doc, value);
			else if (name === "background" && [
				"table",
				"td",
				"th"
			].includes(tagName)) return absoluteToDoc(doc, value);
			else if (name === "srcset") return getAbsoluteSrcsetString(doc, value);
			else if (name === "style") return absolutifyURLs(value, getHref(doc));
			else if (tagName === "object" && name === "data") return absoluteToDoc(doc, value);
			return value;
		}
		function ignoreAttribute(tagName, name, _value) {
			return ["video", "audio"].includes(tagName) && toLowerCase(name) === "autoplay";
		}
		function _isBlockedElement(element, blockClass, blockSelector) {
			try {
				if (typeof blockClass === "string") {
					if (element.classList.contains(blockClass)) return true;
				} else for (let eIndex = element.classList.length; eIndex--;) {
					const className = element.classList[eIndex];
					if (blockClass.test(className)) return true;
				}
				if (blockSelector) return element.matches(blockSelector);
			} catch (e2) {}
			return false;
		}
		function classMatchesRegex(node2, regex, checkAncestors) {
			if (!node2) return false;
			if (node2.nodeType !== node2.ELEMENT_NODE) {
				if (!checkAncestors) return false;
				return classMatchesRegex(index$2.parentNode(node2), regex, checkAncestors);
			}
			for (let eIndex = node2.classList.length; eIndex--;) {
				const className = node2.classList[eIndex];
				if (regex.test(className)) return true;
			}
			if (!checkAncestors) return false;
			return classMatchesRegex(index$2.parentNode(node2), regex, checkAncestors);
		}
		function needMaskingText(node2, maskTextClass, maskTextSelector, checkAncestors) {
			let el;
			if (isElement(node2)) {
				el = node2;
				if (!index$2.childNodes(el).length) return false;
			} else if (index$2.parentElement(node2) === null) return false;
			else el = index$2.parentElement(node2);
			try {
				if (typeof maskTextClass === "string") {
					if (checkAncestors) {
						if (el.closest(`.${maskTextClass}`)) return true;
					} else if (el.classList.contains(maskTextClass)) return true;
				} else if (classMatchesRegex(el, maskTextClass, checkAncestors)) return true;
				if (maskTextSelector) {
					if (checkAncestors) {
						if (el.closest(maskTextSelector)) return true;
					} else if (el.matches(maskTextSelector)) return true;
				}
			} catch (e2) {}
			return false;
		}
		function onceIframeLoaded(iframeEl, listener, iframeLoadTimeout) {
			const win = iframeEl.contentWindow;
			if (!win) return;
			let fired = false;
			let readyState;
			try {
				readyState = win.document.readyState;
			} catch (error) {
				return;
			}
			if (readyState !== "complete") {
				const timer = setTimeout(() => {
					if (!fired) {
						listener();
						fired = true;
					}
				}, iframeLoadTimeout);
				iframeEl.addEventListener("load", () => {
					clearTimeout(timer);
					fired = true;
					listener();
				});
				return;
			}
			const blankUrl = "about:blank";
			if (win.location.href !== blankUrl || iframeEl.src === blankUrl || iframeEl.src === "") {
				setTimeout(listener, 0);
				return iframeEl.addEventListener("load", listener);
			}
			iframeEl.addEventListener("load", listener);
		}
		function onceStylesheetLoaded(link, listener, styleSheetLoadTimeout) {
			let fired = false;
			let styleSheetLoaded;
			try {
				styleSheetLoaded = link.sheet;
			} catch (error) {
				return;
			}
			if (styleSheetLoaded) return;
			const timer = setTimeout(() => {
				if (!fired) {
					listener();
					fired = true;
				}
			}, styleSheetLoadTimeout);
			link.addEventListener("load", () => {
				clearTimeout(timer);
				fired = true;
				listener();
			});
		}
		function serializeNode(n2, options) {
			const { doc, mirror: mirror2, blockClass, blockSelector, needsMask, inlineStylesheet, maskInputOptions = {}, maskTextFn, maskInputFn, dataURLOptions = {}, inlineImages, recordCanvas, keepIframeSrcFn, newlyAddedElement = false, cssCaptured = false } = options;
			const rootId = getRootId(doc, mirror2);
			switch (n2.nodeType) {
				case n2.DOCUMENT_NODE: if (n2.compatMode !== "CSS1Compat") return {
					type: NodeType$3.Document,
					childNodes: [],
					compatMode: n2.compatMode
				};
				else return {
					type: NodeType$3.Document,
					childNodes: []
				};
				case n2.DOCUMENT_TYPE_NODE: return {
					type: NodeType$3.DocumentType,
					name: n2.name,
					publicId: n2.publicId,
					systemId: n2.systemId,
					rootId
				};
				case n2.ELEMENT_NODE: return serializeElementNode(n2, {
					doc,
					blockClass,
					blockSelector,
					inlineStylesheet,
					maskInputOptions,
					maskInputFn,
					dataURLOptions,
					inlineImages,
					recordCanvas,
					keepIframeSrcFn,
					newlyAddedElement,
					rootId
				});
				case n2.TEXT_NODE: return serializeTextNode(n2, {
					doc,
					needsMask,
					maskTextFn,
					rootId,
					cssCaptured
				});
				case n2.CDATA_SECTION_NODE: return {
					type: NodeType$3.CDATA,
					textContent: "",
					rootId
				};
				case n2.COMMENT_NODE: return {
					type: NodeType$3.Comment,
					textContent: index$2.textContent(n2) || "",
					rootId
				};
				default: return false;
			}
		}
		function getRootId(doc, mirror2) {
			if (!mirror2.hasNode(doc)) return void 0;
			const docId = mirror2.getId(doc);
			return docId === 1 ? void 0 : docId;
		}
		function serializeTextNode(n2, options) {
			const { needsMask, maskTextFn, rootId, cssCaptured } = options;
			const parent = index$2.parentNode(n2);
			const parentTagName = parent && parent.tagName;
			let textContent2 = "";
			const isStyle = parentTagName === "STYLE" ? true : void 0;
			const isScript = parentTagName === "SCRIPT" ? true : void 0;
			if (isScript) textContent2 = "SCRIPT_PLACEHOLDER";
			else if (!cssCaptured) {
				textContent2 = index$2.textContent(n2);
				if (isStyle && textContent2) textContent2 = absolutifyURLs(textContent2, getHref(options.doc));
			}
			if (!isStyle && !isScript && textContent2 && needsMask) textContent2 = maskTextFn ? maskTextFn(textContent2, index$2.parentElement(n2)) : textContent2.replace(/[\S]/g, "*");
			return {
				type: NodeType$3.Text,
				textContent: textContent2 || "",
				rootId
			};
		}
		function serializeElementNode(n2, options) {
			const { doc, blockClass, blockSelector, inlineStylesheet, maskInputOptions = {}, maskInputFn, dataURLOptions = {}, inlineImages, recordCanvas, keepIframeSrcFn, newlyAddedElement = false, rootId } = options;
			const needBlock = _isBlockedElement(n2, blockClass, blockSelector);
			const tagName = getValidTagName$1(n2);
			let attributes = {};
			const len = n2.attributes.length;
			for (let i2 = 0; i2 < len; i2++) {
				const attr = n2.attributes[i2];
				if (!ignoreAttribute(tagName, attr.name, attr.value)) attributes[attr.name] = transformAttribute(doc, tagName, toLowerCase(attr.name), attr.value);
			}
			if (tagName === "link" && inlineStylesheet) {
				const stylesheet = Array.from(doc.styleSheets).find((s2) => {
					return s2.href === n2.href;
				});
				let cssText = null;
				if (stylesheet) cssText = stringifyStylesheet(stylesheet);
				if (cssText) {
					delete attributes.rel;
					delete attributes.href;
					attributes._cssText = cssText;
				}
			}
			if (tagName === "style" && n2.sheet) {
				let cssText = stringifyStylesheet(n2.sheet);
				if (cssText) {
					if (n2.childNodes.length > 1) cssText = markCssSplits(cssText, n2);
					attributes._cssText = cssText;
				}
			}
			if ([
				"input",
				"textarea",
				"select"
			].includes(tagName)) {
				const value = n2.value;
				const checked = n2.checked;
				if (attributes.type !== "radio" && attributes.type !== "checkbox" && attributes.type !== "submit" && attributes.type !== "button" && value) attributes.value = maskInputValue({
					element: n2,
					type: getInputType(n2),
					tagName,
					value,
					maskInputOptions,
					maskInputFn
				});
				else if (checked) attributes.checked = checked;
			}
			if (tagName === "option") if (n2.selected && !maskInputOptions["select"]) attributes.selected = true;
			else delete attributes.selected;
			if (tagName === "dialog" && n2.open) attributes.rr_open_mode = n2.matches("dialog:modal") ? "modal" : "non-modal";
			if (tagName === "canvas" && recordCanvas) {
				if (n2.__context === "2d") {
					if (!is2DCanvasBlank(n2)) attributes.rr_dataURL = n2.toDataURL(dataURLOptions.type, dataURLOptions.quality);
				} else if (!("__context" in n2)) {
					const canvasDataURL = n2.toDataURL(dataURLOptions.type, dataURLOptions.quality);
					const blankCanvas = doc.createElement("canvas");
					blankCanvas.width = n2.width;
					blankCanvas.height = n2.height;
					if (canvasDataURL !== blankCanvas.toDataURL(dataURLOptions.type, dataURLOptions.quality)) attributes.rr_dataURL = canvasDataURL;
				}
			}
			if (tagName === "img" && inlineImages) {
				if (!canvasService) {
					canvasService = doc.createElement("canvas");
					canvasCtx = canvasService.getContext("2d");
				}
				const image = n2;
				const imageSrc = image.currentSrc || image.getAttribute("src") || "<unknown-src>";
				const priorCrossOrigin = image.crossOrigin;
				const recordInlineImage = () => {
					image.removeEventListener("load", recordInlineImage);
					try {
						canvasService.width = image.naturalWidth;
						canvasService.height = image.naturalHeight;
						canvasCtx.drawImage(image, 0, 0);
						attributes.rr_dataURL = canvasService.toDataURL(dataURLOptions.type, dataURLOptions.quality);
					} catch (err) {
						if (image.crossOrigin !== "anonymous") {
							image.crossOrigin = "anonymous";
							if (image.complete && image.naturalWidth !== 0) recordInlineImage();
							else image.addEventListener("load", recordInlineImage);
							return;
						} else console.warn(`Cannot inline img src=${imageSrc}! Error: ${err}`);
					}
					if (image.crossOrigin === "anonymous") priorCrossOrigin ? attributes.crossOrigin = priorCrossOrigin : image.removeAttribute("crossorigin");
				};
				if (image.complete && image.naturalWidth !== 0) recordInlineImage();
				else image.addEventListener("load", recordInlineImage);
			}
			if (["audio", "video"].includes(tagName)) {
				const mediaAttributes = attributes;
				mediaAttributes.rr_mediaState = n2.paused ? "paused" : "played";
				mediaAttributes.rr_mediaCurrentTime = n2.currentTime;
				mediaAttributes.rr_mediaPlaybackRate = n2.playbackRate;
				mediaAttributes.rr_mediaMuted = n2.muted;
				mediaAttributes.rr_mediaLoop = n2.loop;
				mediaAttributes.rr_mediaVolume = n2.volume;
			}
			if (!newlyAddedElement) {
				if (n2.scrollLeft) attributes.rr_scrollLeft = n2.scrollLeft;
				if (n2.scrollTop) attributes.rr_scrollTop = n2.scrollTop;
			}
			if (needBlock) {
				const { width, height } = n2.getBoundingClientRect();
				attributes = {
					class: attributes.class,
					rr_width: `${width}px`,
					rr_height: `${height}px`
				};
			}
			if (tagName === "iframe" && !keepIframeSrcFn(attributes.src)) {
				if (!n2.contentDocument) attributes.rr_src = attributes.src;
				delete attributes.src;
			}
			let isCustomElement;
			try {
				if (customElements.get(tagName)) isCustomElement = true;
			} catch (e2) {}
			return {
				type: NodeType$3.Element,
				tagName,
				attributes,
				childNodes: [],
				isSVG: isSVGElement(n2) || void 0,
				needBlock,
				rootId,
				isCustom: isCustomElement
			};
		}
		function lowerIfExists(maybeAttr) {
			if (maybeAttr === void 0 || maybeAttr === null) return "";
			else return maybeAttr.toLowerCase();
		}
		function slimDOMDefaults(_slimDOMOptions) {
			if (_slimDOMOptions === true || _slimDOMOptions === "all") return {
				script: true,
				comment: true,
				headFavicon: true,
				headWhitespace: true,
				headMetaSocial: true,
				headMetaRobots: true,
				headMetaHttpEquiv: true,
				headMetaVerification: true,
				headMetaAuthorship: _slimDOMOptions === "all",
				headMetaDescKeywords: _slimDOMOptions === "all",
				headTitleMutations: _slimDOMOptions === "all"
			};
			else if (_slimDOMOptions) return _slimDOMOptions;
			return {};
		}
		function slimDOMExcluded(sn, slimDOMOptions) {
			if (slimDOMOptions.comment && sn.type === NodeType$3.Comment) return true;
			else if (sn.type === NodeType$3.Element) {
				if (slimDOMOptions.script && (sn.tagName === "script" || sn.tagName === "link" && (sn.attributes.rel === "preload" && sn.attributes.as === "script" || sn.attributes.rel === "modulepreload") || sn.tagName === "link" && sn.attributes.rel === "prefetch" && typeof sn.attributes.href === "string" && extractFileExtension(sn.attributes.href) === "js")) return true;
				else if (slimDOMOptions.headFavicon && (sn.tagName === "link" && sn.attributes.rel === "shortcut icon" || sn.tagName === "meta" && (lowerIfExists(sn.attributes.name).match(/^msapplication-tile(image|color)$/) || lowerIfExists(sn.attributes.name) === "application-name" || lowerIfExists(sn.attributes.rel) === "icon" || lowerIfExists(sn.attributes.rel) === "apple-touch-icon" || lowerIfExists(sn.attributes.rel) === "shortcut icon"))) return true;
				else if (sn.tagName === "meta") {
					if (slimDOMOptions.headMetaDescKeywords && lowerIfExists(sn.attributes.name).match(/^description|keywords$/)) return true;
					else if (slimDOMOptions.headMetaSocial && (lowerIfExists(sn.attributes.property).match(/^(og|twitter|fb):/) || lowerIfExists(sn.attributes.name).match(/^(og|twitter):/) || lowerIfExists(sn.attributes.name) === "pinterest")) return true;
					else if (slimDOMOptions.headMetaRobots && (lowerIfExists(sn.attributes.name) === "robots" || lowerIfExists(sn.attributes.name) === "googlebot" || lowerIfExists(sn.attributes.name) === "bingbot")) return true;
					else if (slimDOMOptions.headMetaHttpEquiv && sn.attributes["http-equiv"] !== void 0) return true;
					else if (slimDOMOptions.headMetaAuthorship && (lowerIfExists(sn.attributes.name) === "author" || lowerIfExists(sn.attributes.name) === "generator" || lowerIfExists(sn.attributes.name) === "framework" || lowerIfExists(sn.attributes.name) === "publisher" || lowerIfExists(sn.attributes.name) === "progid" || lowerIfExists(sn.attributes.property).match(/^article:/) || lowerIfExists(sn.attributes.property).match(/^product:/))) return true;
					else if (slimDOMOptions.headMetaVerification && (lowerIfExists(sn.attributes.name) === "google-site-verification" || lowerIfExists(sn.attributes.name) === "yandex-verification" || lowerIfExists(sn.attributes.name) === "csrf-token" || lowerIfExists(sn.attributes.name) === "p:domain_verify" || lowerIfExists(sn.attributes.name) === "verify-v1" || lowerIfExists(sn.attributes.name) === "verification" || lowerIfExists(sn.attributes.name) === "shopify-checkout-api-token")) return true;
				}
			}
			return false;
		}
		function serializeNodeWithId(n2, options) {
			const { doc, mirror: mirror2, blockClass, blockSelector, maskTextClass, maskTextSelector, skipChild = false, inlineStylesheet = true, maskInputOptions = {}, maskTextFn, maskInputFn, slimDOMOptions, dataURLOptions = {}, inlineImages = false, recordCanvas = false, onSerialize, onIframeLoad, iframeLoadTimeout = 5e3, onStylesheetLoad, stylesheetLoadTimeout = 5e3, keepIframeSrcFn = () => false, newlyAddedElement = false, cssCaptured = false } = options;
			let { needsMask } = options;
			let { preserveWhiteSpace = true } = options;
			if (!needsMask) needsMask = needMaskingText(n2, maskTextClass, maskTextSelector, needsMask === void 0);
			const _serializedNode = serializeNode(n2, {
				doc,
				mirror: mirror2,
				blockClass,
				blockSelector,
				needsMask,
				inlineStylesheet,
				maskInputOptions,
				maskTextFn,
				maskInputFn,
				dataURLOptions,
				inlineImages,
				recordCanvas,
				keepIframeSrcFn,
				newlyAddedElement,
				cssCaptured
			});
			if (!_serializedNode) {
				console.warn(n2, "not serialized");
				return null;
			}
			let id;
			if (mirror2.hasNode(n2)) id = mirror2.getId(n2);
			else if (slimDOMExcluded(_serializedNode, slimDOMOptions) || !preserveWhiteSpace && _serializedNode.type === NodeType$3.Text && !_serializedNode.textContent.replace(/^\s+|\s+$/gm, "").length) id = IGNORED_NODE;
			else id = genId();
			const serializedNode = Object.assign(_serializedNode, { id });
			mirror2.add(n2, serializedNode);
			if (id === IGNORED_NODE) return null;
			if (onSerialize) onSerialize(n2);
			let recordChild = !skipChild;
			if (serializedNode.type === NodeType$3.Element) {
				recordChild = recordChild && !serializedNode.needBlock;
				delete serializedNode.needBlock;
				const shadowRootEl = index$2.shadowRoot(n2);
				if (shadowRootEl && isNativeShadowDom(shadowRootEl)) serializedNode.isShadowHost = true;
			}
			if ((serializedNode.type === NodeType$3.Document || serializedNode.type === NodeType$3.Element) && recordChild) {
				if (slimDOMOptions.headWhitespace && serializedNode.type === NodeType$3.Element && serializedNode.tagName === "head") preserveWhiteSpace = false;
				const bypassOptions = {
					doc,
					mirror: mirror2,
					blockClass,
					blockSelector,
					needsMask,
					maskTextClass,
					maskTextSelector,
					skipChild,
					inlineStylesheet,
					maskInputOptions,
					maskTextFn,
					maskInputFn,
					slimDOMOptions,
					dataURLOptions,
					inlineImages,
					recordCanvas,
					preserveWhiteSpace,
					onSerialize,
					onIframeLoad,
					iframeLoadTimeout,
					onStylesheetLoad,
					stylesheetLoadTimeout,
					keepIframeSrcFn,
					cssCaptured: false
				};
				if (serializedNode.type === NodeType$3.Element && serializedNode.tagName === "textarea" && serializedNode.attributes.value !== void 0);
				else {
					if (serializedNode.type === NodeType$3.Element && serializedNode.attributes._cssText !== void 0 && typeof serializedNode.attributes._cssText === "string") bypassOptions.cssCaptured = true;
					for (const childN of Array.from(index$2.childNodes(n2))) {
						const serializedChildNode = serializeNodeWithId(childN, bypassOptions);
						if (serializedChildNode) serializedNode.childNodes.push(serializedChildNode);
					}
				}
				let shadowRootEl = null;
				if (isElement(n2) && (shadowRootEl = index$2.shadowRoot(n2))) for (const childN of Array.from(index$2.childNodes(shadowRootEl))) {
					const serializedChildNode = serializeNodeWithId(childN, bypassOptions);
					if (serializedChildNode) {
						isNativeShadowDom(shadowRootEl) && (serializedChildNode.isShadow = true);
						serializedNode.childNodes.push(serializedChildNode);
					}
				}
			}
			const parent = index$2.parentNode(n2);
			if (parent && isShadowRoot(parent) && isNativeShadowDom(parent)) serializedNode.isShadow = true;
			if (serializedNode.type === NodeType$3.Element && serializedNode.tagName === "iframe") onceIframeLoaded(n2, () => {
				const iframeDoc = n2.contentDocument;
				if (iframeDoc && onIframeLoad) {
					const serializedIframeNode = serializeNodeWithId(iframeDoc, {
						doc: iframeDoc,
						mirror: mirror2,
						blockClass,
						blockSelector,
						needsMask,
						maskTextClass,
						maskTextSelector,
						skipChild: false,
						inlineStylesheet,
						maskInputOptions,
						maskTextFn,
						maskInputFn,
						slimDOMOptions,
						dataURLOptions,
						inlineImages,
						recordCanvas,
						preserveWhiteSpace,
						onSerialize,
						onIframeLoad,
						iframeLoadTimeout,
						onStylesheetLoad,
						stylesheetLoadTimeout,
						keepIframeSrcFn
					});
					if (serializedIframeNode) onIframeLoad(n2, serializedIframeNode);
				}
			}, iframeLoadTimeout);
			if (serializedNode.type === NodeType$3.Element && serializedNode.tagName === "link" && typeof serializedNode.attributes.rel === "string" && (serializedNode.attributes.rel === "stylesheet" || serializedNode.attributes.rel === "preload" && typeof serializedNode.attributes.href === "string" && extractFileExtension(serializedNode.attributes.href) === "css")) onceStylesheetLoaded(n2, () => {
				if (onStylesheetLoad) {
					const serializedLinkNode = serializeNodeWithId(n2, {
						doc,
						mirror: mirror2,
						blockClass,
						blockSelector,
						needsMask,
						maskTextClass,
						maskTextSelector,
						skipChild: false,
						inlineStylesheet,
						maskInputOptions,
						maskTextFn,
						maskInputFn,
						slimDOMOptions,
						dataURLOptions,
						inlineImages,
						recordCanvas,
						preserveWhiteSpace,
						onSerialize,
						onIframeLoad,
						iframeLoadTimeout,
						onStylesheetLoad,
						stylesheetLoadTimeout,
						keepIframeSrcFn
					});
					if (serializedLinkNode) onStylesheetLoad(n2, serializedLinkNode);
				}
			}, stylesheetLoadTimeout);
			return serializedNode;
		}
		function snapshot(n2, options) {
			const { mirror: mirror2 = new Mirror(), blockClass = "rr-block", blockSelector = null, maskTextClass = "rr-mask", maskTextSelector = null, inlineStylesheet = true, inlineImages = false, recordCanvas = false, maskAllInputs = false, maskTextFn, maskInputFn, slimDOM = false, dataURLOptions, preserveWhiteSpace, onSerialize, onIframeLoad, iframeLoadTimeout, onStylesheetLoad, stylesheetLoadTimeout, keepIframeSrcFn = () => false } = options;
			return serializeNodeWithId(n2, {
				doc: n2,
				mirror: mirror2,
				blockClass,
				blockSelector,
				maskTextClass,
				maskTextSelector,
				skipChild: false,
				inlineStylesheet,
				maskInputOptions: maskAllInputs === true ? {
					color: true,
					date: true,
					"datetime-local": true,
					email: true,
					month: true,
					number: true,
					range: true,
					search: true,
					tel: true,
					text: true,
					time: true,
					url: true,
					week: true,
					textarea: true,
					select: true,
					password: true
				} : maskAllInputs === false ? { password: true } : maskAllInputs,
				maskTextFn,
				maskInputFn,
				slimDOMOptions: slimDOMDefaults(slimDOM),
				dataURLOptions,
				inlineImages,
				recordCanvas,
				preserveWhiteSpace,
				onSerialize,
				onIframeLoad,
				iframeLoadTimeout,
				onStylesheetLoad,
				stylesheetLoadTimeout,
				keepIframeSrcFn,
				newlyAddedElement: false
			});
		}
		function getDefaultExportFromCjs$1(x) {
			return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
		}
		function getAugmentedNamespace$1(n2) {
			if (n2.__esModule) return n2;
			var f2 = n2.default;
			if (typeof f2 == "function") {
				var a2 = function a22() {
					if (this instanceof a22) return Reflect.construct(f2, arguments, this.constructor);
					return f2.apply(this, arguments);
				};
				a2.prototype = f2.prototype;
			} else a2 = {};
			Object.defineProperty(a2, "__esModule", { value: true });
			Object.keys(n2).forEach(function(k) {
				var d = Object.getOwnPropertyDescriptor(n2, k);
				Object.defineProperty(a2, k, d.get ? d : {
					enumerable: true,
					get: function() {
						return n2[k];
					}
				});
			});
			return a2;
		}
		function requirePicocolors_browser$1() {
			if (hasRequiredPicocolors_browser$1) return picocolors_browser$1.exports;
			hasRequiredPicocolors_browser$1 = 1;
			var x = String;
			var create = function() {
				return {
					isColorSupported: false,
					reset: x,
					bold: x,
					dim: x,
					italic: x,
					underline: x,
					inverse: x,
					hidden: x,
					strikethrough: x,
					black: x,
					red: x,
					green: x,
					yellow: x,
					blue: x,
					magenta: x,
					cyan: x,
					white: x,
					gray: x,
					bgBlack: x,
					bgRed: x,
					bgGreen: x,
					bgYellow: x,
					bgBlue: x,
					bgMagenta: x,
					bgCyan: x,
					bgWhite: x
				};
			};
			picocolors_browser$1.exports = create();
			picocolors_browser$1.exports.createColors = create;
			return picocolors_browser$1.exports;
		}
		function requireCssSyntaxError$1() {
			if (hasRequiredCssSyntaxError$1) return cssSyntaxError$1;
			hasRequiredCssSyntaxError$1 = 1;
			let pico = /* @__PURE__ */ requirePicocolors_browser$1();
			let terminalHighlight = require$$2$1;
			class CssSyntaxError extends Error {
				constructor(message, line, column, source, file, plugin) {
					super(message);
					this.name = "CssSyntaxError";
					this.reason = message;
					if (file) this.file = file;
					if (source) this.source = source;
					if (plugin) this.plugin = plugin;
					if (typeof line !== "undefined" && typeof column !== "undefined") if (typeof line === "number") {
						this.line = line;
						this.column = column;
					} else {
						this.line = line.line;
						this.column = line.column;
						this.endLine = column.line;
						this.endColumn = column.column;
					}
					this.setMessage();
					if (Error.captureStackTrace) Error.captureStackTrace(this, CssSyntaxError);
				}
				setMessage() {
					this.message = this.plugin ? this.plugin + ": " : "";
					this.message += this.file ? this.file : "<css input>";
					if (typeof this.line !== "undefined") this.message += ":" + this.line + ":" + this.column;
					this.message += ": " + this.reason;
				}
				showSourceCode(color) {
					if (!this.source) return "";
					let css = this.source;
					if (color == null) color = pico.isColorSupported;
					if (terminalHighlight) {
						if (color) css = terminalHighlight(css);
					}
					let lines = css.split(/\r?\n/);
					let start = Math.max(this.line - 3, 0);
					let end = Math.min(this.line + 2, lines.length);
					let maxWidth = String(end).length;
					let mark, aside;
					if (color) {
						let { bold, gray, red } = pico.createColors(true);
						mark = (text) => bold(red(text));
						aside = (text) => gray(text);
					} else mark = aside = (str) => str;
					return lines.slice(start, end).map((line, index2) => {
						let number = start + 1 + index2;
						let gutter = " " + (" " + number).slice(-maxWidth) + " | ";
						if (number === this.line) {
							let spacing = aside(gutter.replace(/\d/g, " ")) + line.slice(0, this.column - 1).replace(/[^\t]/g, " ");
							return mark(">") + aside(gutter) + line + "\n " + spacing + mark("^");
						}
						return " " + aside(gutter) + line;
					}).join("\n");
				}
				toString() {
					let code = this.showSourceCode();
					if (code) code = "\n\n" + code + "\n";
					return this.name + ": " + this.message + code;
				}
			}
			cssSyntaxError$1 = CssSyntaxError;
			CssSyntaxError.default = CssSyntaxError;
			return cssSyntaxError$1;
		}
		function requireSymbols$1() {
			if (hasRequiredSymbols$1) return symbols$1;
			hasRequiredSymbols$1 = 1;
			symbols$1.isClean = Symbol("isClean");
			symbols$1.my = Symbol("my");
			return symbols$1;
		}
		function requireStringifier$1() {
			if (hasRequiredStringifier$1) return stringifier$1;
			hasRequiredStringifier$1 = 1;
			const DEFAULT_RAW = {
				after: "\n",
				beforeClose: "\n",
				beforeComment: "\n",
				beforeDecl: "\n",
				beforeOpen: " ",
				beforeRule: "\n",
				colon: ": ",
				commentLeft: " ",
				commentRight: " ",
				emptyBody: "",
				indent: "    ",
				semicolon: false
			};
			function capitalize(str) {
				return str[0].toUpperCase() + str.slice(1);
			}
			class Stringifier {
				constructor(builder) {
					this.builder = builder;
				}
				atrule(node2, semicolon) {
					let name = "@" + node2.name;
					let params = node2.params ? this.rawValue(node2, "params") : "";
					if (typeof node2.raws.afterName !== "undefined") name += node2.raws.afterName;
					else if (params) name += " ";
					if (node2.nodes) this.block(node2, name + params);
					else {
						let end = (node2.raws.between || "") + (semicolon ? ";" : "");
						this.builder(name + params + end, node2);
					}
				}
				beforeAfter(node2, detect) {
					let value;
					if (node2.type === "decl") value = this.raw(node2, null, "beforeDecl");
					else if (node2.type === "comment") value = this.raw(node2, null, "beforeComment");
					else if (detect === "before") value = this.raw(node2, null, "beforeRule");
					else value = this.raw(node2, null, "beforeClose");
					let buf = node2.parent;
					let depth = 0;
					while (buf && buf.type !== "root") {
						depth += 1;
						buf = buf.parent;
					}
					if (value.includes("\n")) {
						let indent = this.raw(node2, null, "indent");
						if (indent.length) for (let step = 0; step < depth; step++) value += indent;
					}
					return value;
				}
				block(node2, start) {
					let between = this.raw(node2, "between", "beforeOpen");
					this.builder(start + between + "{", node2, "start");
					let after;
					if (node2.nodes && node2.nodes.length) {
						this.body(node2);
						after = this.raw(node2, "after");
					} else after = this.raw(node2, "after", "emptyBody");
					if (after) this.builder(after);
					this.builder("}", node2, "end");
				}
				body(node2) {
					let last = node2.nodes.length - 1;
					while (last > 0) {
						if (node2.nodes[last].type !== "comment") break;
						last -= 1;
					}
					let semicolon = this.raw(node2, "semicolon");
					for (let i2 = 0; i2 < node2.nodes.length; i2++) {
						let child = node2.nodes[i2];
						let before = this.raw(child, "before");
						if (before) this.builder(before);
						this.stringify(child, last !== i2 || semicolon);
					}
				}
				comment(node2) {
					let left = this.raw(node2, "left", "commentLeft");
					let right = this.raw(node2, "right", "commentRight");
					this.builder("/*" + left + node2.text + right + "*/", node2);
				}
				decl(node2, semicolon) {
					let between = this.raw(node2, "between", "colon");
					let string = node2.prop + between + this.rawValue(node2, "value");
					if (node2.important) string += node2.raws.important || " !important";
					if (semicolon) string += ";";
					this.builder(string, node2);
				}
				document(node2) {
					this.body(node2);
				}
				raw(node2, own, detect) {
					let value;
					if (!detect) detect = own;
					if (own) {
						value = node2.raws[own];
						if (typeof value !== "undefined") return value;
					}
					let parent = node2.parent;
					if (detect === "before") {
						if (!parent || parent.type === "root" && parent.first === node2) return "";
						if (parent && parent.type === "document") return "";
					}
					if (!parent) return DEFAULT_RAW[detect];
					let root2 = node2.root();
					if (!root2.rawCache) root2.rawCache = {};
					if (typeof root2.rawCache[detect] !== "undefined") return root2.rawCache[detect];
					if (detect === "before" || detect === "after") return this.beforeAfter(node2, detect);
					else {
						let method = "raw" + capitalize(detect);
						if (this[method]) value = this[method](root2, node2);
						else root2.walk((i2) => {
							value = i2.raws[own];
							if (typeof value !== "undefined") return false;
						});
					}
					if (typeof value === "undefined") value = DEFAULT_RAW[detect];
					root2.rawCache[detect] = value;
					return value;
				}
				rawBeforeClose(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.nodes && i2.nodes.length > 0) {
							if (typeof i2.raws.after !== "undefined") {
								value = i2.raws.after;
								if (value.includes("\n")) value = value.replace(/[^\n]+$/, "");
								return false;
							}
						}
					});
					if (value) value = value.replace(/\S/g, "");
					return value;
				}
				rawBeforeComment(root2, node2) {
					let value;
					root2.walkComments((i2) => {
						if (typeof i2.raws.before !== "undefined") {
							value = i2.raws.before;
							if (value.includes("\n")) value = value.replace(/[^\n]+$/, "");
							return false;
						}
					});
					if (typeof value === "undefined") value = this.raw(node2, null, "beforeDecl");
					else if (value) value = value.replace(/\S/g, "");
					return value;
				}
				rawBeforeDecl(root2, node2) {
					let value;
					root2.walkDecls((i2) => {
						if (typeof i2.raws.before !== "undefined") {
							value = i2.raws.before;
							if (value.includes("\n")) value = value.replace(/[^\n]+$/, "");
							return false;
						}
					});
					if (typeof value === "undefined") value = this.raw(node2, null, "beforeRule");
					else if (value) value = value.replace(/\S/g, "");
					return value;
				}
				rawBeforeOpen(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.type !== "decl") {
							value = i2.raws.between;
							if (typeof value !== "undefined") return false;
						}
					});
					return value;
				}
				rawBeforeRule(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.nodes && (i2.parent !== root2 || root2.first !== i2)) {
							if (typeof i2.raws.before !== "undefined") {
								value = i2.raws.before;
								if (value.includes("\n")) value = value.replace(/[^\n]+$/, "");
								return false;
							}
						}
					});
					if (value) value = value.replace(/\S/g, "");
					return value;
				}
				rawColon(root2) {
					let value;
					root2.walkDecls((i2) => {
						if (typeof i2.raws.between !== "undefined") {
							value = i2.raws.between.replace(/[^\s:]/g, "");
							return false;
						}
					});
					return value;
				}
				rawEmptyBody(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.nodes && i2.nodes.length === 0) {
							value = i2.raws.after;
							if (typeof value !== "undefined") return false;
						}
					});
					return value;
				}
				rawIndent(root2) {
					if (root2.raws.indent) return root2.raws.indent;
					let value;
					root2.walk((i2) => {
						let p = i2.parent;
						if (p && p !== root2 && p.parent && p.parent === root2) {
							if (typeof i2.raws.before !== "undefined") {
								let parts = i2.raws.before.split("\n");
								value = parts[parts.length - 1];
								value = value.replace(/\S/g, "");
								return false;
							}
						}
					});
					return value;
				}
				rawSemicolon(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.nodes && i2.nodes.length && i2.last.type === "decl") {
							value = i2.raws.semicolon;
							if (typeof value !== "undefined") return false;
						}
					});
					return value;
				}
				rawValue(node2, prop) {
					let value = node2[prop];
					let raw = node2.raws[prop];
					if (raw && raw.value === value) return raw.raw;
					return value;
				}
				root(node2) {
					this.body(node2);
					if (node2.raws.after) this.builder(node2.raws.after);
				}
				rule(node2) {
					this.block(node2, this.rawValue(node2, "selector"));
					if (node2.raws.ownSemicolon) this.builder(node2.raws.ownSemicolon, node2, "end");
				}
				stringify(node2, semicolon) {
					if (!this[node2.type]) throw new Error("Unknown AST node type " + node2.type + ". Maybe you need to change PostCSS stringifier.");
					this[node2.type](node2, semicolon);
				}
			}
			stringifier$1 = Stringifier;
			Stringifier.default = Stringifier;
			return stringifier$1;
		}
		function requireStringify$1() {
			if (hasRequiredStringify$1) return stringify_1$1;
			hasRequiredStringify$1 = 1;
			let Stringifier = requireStringifier$1();
			function stringify(node2, builder) {
				new Stringifier(builder).stringify(node2);
			}
			stringify_1$1 = stringify;
			stringify.default = stringify;
			return stringify_1$1;
		}
		function requireNode$1() {
			if (hasRequiredNode$1) return node$1;
			hasRequiredNode$1 = 1;
			let { isClean, my } = requireSymbols$1();
			let CssSyntaxError = requireCssSyntaxError$1();
			let Stringifier = requireStringifier$1();
			let stringify = requireStringify$1();
			function cloneNode(obj, parent) {
				let cloned = new obj.constructor();
				for (let i2 in obj) {
					if (!Object.prototype.hasOwnProperty.call(obj, i2)) continue;
					if (i2 === "proxyCache") continue;
					let value = obj[i2];
					let type = typeof value;
					if (i2 === "parent" && type === "object") {
						if (parent) cloned[i2] = parent;
					} else if (i2 === "source") cloned[i2] = value;
					else if (Array.isArray(value)) cloned[i2] = value.map((j) => cloneNode(j, cloned));
					else {
						if (type === "object" && value !== null) value = cloneNode(value);
						cloned[i2] = value;
					}
				}
				return cloned;
			}
			class Node2 {
				constructor(defaults = {}) {
					this.raws = {};
					this[isClean] = false;
					this[my] = true;
					for (let name in defaults) if (name === "nodes") {
						this.nodes = [];
						for (let node2 of defaults[name]) if (typeof node2.clone === "function") this.append(node2.clone());
						else this.append(node2);
					} else this[name] = defaults[name];
				}
				addToError(error) {
					error.postcssNode = this;
					if (error.stack && this.source && /\n\s{4}at /.test(error.stack)) {
						let s2 = this.source;
						error.stack = error.stack.replace(/\n\s{4}at /, `$&${s2.input.from}:${s2.start.line}:${s2.start.column}$&`);
					}
					return error;
				}
				after(add) {
					this.parent.insertAfter(this, add);
					return this;
				}
				assign(overrides = {}) {
					for (let name in overrides) this[name] = overrides[name];
					return this;
				}
				before(add) {
					this.parent.insertBefore(this, add);
					return this;
				}
				cleanRaws(keepBetween) {
					delete this.raws.before;
					delete this.raws.after;
					if (!keepBetween) delete this.raws.between;
				}
				clone(overrides = {}) {
					let cloned = cloneNode(this);
					for (let name in overrides) cloned[name] = overrides[name];
					return cloned;
				}
				cloneAfter(overrides = {}) {
					let cloned = this.clone(overrides);
					this.parent.insertAfter(this, cloned);
					return cloned;
				}
				cloneBefore(overrides = {}) {
					let cloned = this.clone(overrides);
					this.parent.insertBefore(this, cloned);
					return cloned;
				}
				error(message, opts = {}) {
					if (this.source) {
						let { end, start } = this.rangeBy(opts);
						return this.source.input.error(message, {
							column: start.column,
							line: start.line
						}, {
							column: end.column,
							line: end.line
						}, opts);
					}
					return new CssSyntaxError(message);
				}
				getProxyProcessor() {
					return {
						get(node2, prop) {
							if (prop === "proxyOf") return node2;
							else if (prop === "root") return () => node2.root().toProxy();
							else return node2[prop];
						},
						set(node2, prop, value) {
							if (node2[prop] === value) return true;
							node2[prop] = value;
							if (prop === "prop" || prop === "value" || prop === "name" || prop === "params" || prop === "important" || prop === "text") node2.markDirty();
							return true;
						}
					};
				}
				markDirty() {
					if (this[isClean]) {
						this[isClean] = false;
						let next = this;
						while (next = next.parent) next[isClean] = false;
					}
				}
				next() {
					if (!this.parent) return void 0;
					let index2 = this.parent.index(this);
					return this.parent.nodes[index2 + 1];
				}
				positionBy(opts, stringRepresentation) {
					let pos = this.source.start;
					if (opts.index) pos = this.positionInside(opts.index, stringRepresentation);
					else if (opts.word) {
						stringRepresentation = this.toString();
						let index2 = stringRepresentation.indexOf(opts.word);
						if (index2 !== -1) pos = this.positionInside(index2, stringRepresentation);
					}
					return pos;
				}
				positionInside(index2, stringRepresentation) {
					let string = stringRepresentation || this.toString();
					let column = this.source.start.column;
					let line = this.source.start.line;
					for (let i2 = 0; i2 < index2; i2++) if (string[i2] === "\n") {
						column = 1;
						line += 1;
					} else column += 1;
					return {
						column,
						line
					};
				}
				prev() {
					if (!this.parent) return void 0;
					let index2 = this.parent.index(this);
					return this.parent.nodes[index2 - 1];
				}
				rangeBy(opts) {
					let start = {
						column: this.source.start.column,
						line: this.source.start.line
					};
					let end = this.source.end ? {
						column: this.source.end.column + 1,
						line: this.source.end.line
					} : {
						column: start.column + 1,
						line: start.line
					};
					if (opts.word) {
						let stringRepresentation = this.toString();
						let index2 = stringRepresentation.indexOf(opts.word);
						if (index2 !== -1) {
							start = this.positionInside(index2, stringRepresentation);
							end = this.positionInside(index2 + opts.word.length, stringRepresentation);
						}
					} else {
						if (opts.start) start = {
							column: opts.start.column,
							line: opts.start.line
						};
						else if (opts.index) start = this.positionInside(opts.index);
						if (opts.end) end = {
							column: opts.end.column,
							line: opts.end.line
						};
						else if (typeof opts.endIndex === "number") end = this.positionInside(opts.endIndex);
						else if (opts.index) end = this.positionInside(opts.index + 1);
					}
					if (end.line < start.line || end.line === start.line && end.column <= start.column) end = {
						column: start.column + 1,
						line: start.line
					};
					return {
						end,
						start
					};
				}
				raw(prop, defaultType) {
					return new Stringifier().raw(this, prop, defaultType);
				}
				remove() {
					if (this.parent) this.parent.removeChild(this);
					this.parent = void 0;
					return this;
				}
				replaceWith(...nodes) {
					if (this.parent) {
						let bookmark = this;
						let foundSelf = false;
						for (let node2 of nodes) if (node2 === this) foundSelf = true;
						else if (foundSelf) {
							this.parent.insertAfter(bookmark, node2);
							bookmark = node2;
						} else this.parent.insertBefore(bookmark, node2);
						if (!foundSelf) this.remove();
					}
					return this;
				}
				root() {
					let result2 = this;
					while (result2.parent && result2.parent.type !== "document") result2 = result2.parent;
					return result2;
				}
				toJSON(_, inputs) {
					let fixed = {};
					let emitInputs = inputs == null;
					inputs = inputs || /* @__PURE__ */ new Map();
					let inputsNextIndex = 0;
					for (let name in this) {
						if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
						if (name === "parent" || name === "proxyCache") continue;
						let value = this[name];
						if (Array.isArray(value)) fixed[name] = value.map((i2) => {
							if (typeof i2 === "object" && i2.toJSON) return i2.toJSON(null, inputs);
							else return i2;
						});
						else if (typeof value === "object" && value.toJSON) fixed[name] = value.toJSON(null, inputs);
						else if (name === "source") {
							let inputId = inputs.get(value.input);
							if (inputId == null) {
								inputId = inputsNextIndex;
								inputs.set(value.input, inputsNextIndex);
								inputsNextIndex++;
							}
							fixed[name] = {
								end: value.end,
								inputId,
								start: value.start
							};
						} else fixed[name] = value;
					}
					if (emitInputs) fixed.inputs = [...inputs.keys()].map((input2) => input2.toJSON());
					return fixed;
				}
				toProxy() {
					if (!this.proxyCache) this.proxyCache = new Proxy(this, this.getProxyProcessor());
					return this.proxyCache;
				}
				toString(stringifier2 = stringify) {
					if (stringifier2.stringify) stringifier2 = stringifier2.stringify;
					let result2 = "";
					stringifier2(this, (i2) => {
						result2 += i2;
					});
					return result2;
				}
				warn(result2, text, opts) {
					let data = { node: this };
					for (let i2 in opts) data[i2] = opts[i2];
					return result2.warn(text, data);
				}
				get proxyOf() {
					return this;
				}
			}
			node$1 = Node2;
			Node2.default = Node2;
			return node$1;
		}
		function requireDeclaration$1() {
			if (hasRequiredDeclaration$1) return declaration$1;
			hasRequiredDeclaration$1 = 1;
			let Node2 = requireNode$1();
			class Declaration extends Node2 {
				constructor(defaults) {
					if (defaults && typeof defaults.value !== "undefined" && typeof defaults.value !== "string") defaults = {
						...defaults,
						value: String(defaults.value)
					};
					super(defaults);
					this.type = "decl";
				}
				get variable() {
					return this.prop.startsWith("--") || this.prop[0] === "$";
				}
			}
			declaration$1 = Declaration;
			Declaration.default = Declaration;
			return declaration$1;
		}
		function requireNonSecure$1() {
			if (hasRequiredNonSecure$1) return nonSecure$1;
			hasRequiredNonSecure$1 = 1;
			let urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
			let customAlphabet = (alphabet, defaultSize = 21) => {
				return (size = defaultSize) => {
					let id = "";
					let i2 = size;
					while (i2--) id += alphabet[Math.random() * alphabet.length | 0];
					return id;
				};
			};
			let nanoid = (size = 21) => {
				let id = "";
				let i2 = size;
				while (i2--) id += urlAlphabet[Math.random() * 64 | 0];
				return id;
			};
			nonSecure$1 = {
				nanoid,
				customAlphabet
			};
			return nonSecure$1;
		}
		function requirePreviousMap$1() {
			if (hasRequiredPreviousMap$1) return previousMap$1;
			hasRequiredPreviousMap$1 = 1;
			let { SourceMapConsumer, SourceMapGenerator } = require$$2$1;
			let { existsSync, readFileSync } = require$$2$1;
			let { dirname, join } = require$$2$1;
			function fromBase64(str) {
				if (Buffer) return Buffer.from(str, "base64").toString();
				else return window.atob(str);
			}
			class PreviousMap {
				constructor(css, opts) {
					if (opts.map === false) return;
					this.loadAnnotation(css);
					this.inline = this.startWith(this.annotation, "data:");
					let prev = opts.map ? opts.map.prev : void 0;
					let text = this.loadMap(opts.from, prev);
					if (!this.mapFile && opts.from) this.mapFile = opts.from;
					if (this.mapFile) this.root = dirname(this.mapFile);
					if (text) this.text = text;
				}
				consumer() {
					if (!this.consumerCache) this.consumerCache = new SourceMapConsumer(this.text);
					return this.consumerCache;
				}
				decodeInline(text) {
					let baseCharsetUri = /^data:application\/json;charset=utf-?8;base64,/;
					let baseUri = /^data:application\/json;base64,/;
					if (/^data:application\/json;charset=utf-?8,/.test(text) || /^data:application\/json,/.test(text)) return decodeURIComponent(text.substr(RegExp.lastMatch.length));
					if (baseCharsetUri.test(text) || baseUri.test(text)) return fromBase64(text.substr(RegExp.lastMatch.length));
					let encoding = text.match(/data:application\/json;([^,]+),/)[1];
					throw new Error("Unsupported source map encoding " + encoding);
				}
				getAnnotationURL(sourceMapString) {
					return sourceMapString.replace(/^\/\*\s*# sourceMappingURL=/, "").trim();
				}
				isMap(map) {
					if (typeof map !== "object") return false;
					return typeof map.mappings === "string" || typeof map._mappings === "string" || Array.isArray(map.sections);
				}
				loadAnnotation(css) {
					let comments = css.match(/\/\*\s*# sourceMappingURL=/gm);
					if (!comments) return;
					let start = css.lastIndexOf(comments.pop());
					let end = css.indexOf("*/", start);
					if (start > -1 && end > -1) this.annotation = this.getAnnotationURL(css.substring(start, end));
				}
				loadFile(path) {
					this.root = dirname(path);
					if (existsSync(path)) {
						this.mapFile = path;
						return readFileSync(path, "utf-8").toString().trim();
					}
				}
				loadMap(file, prev) {
					if (prev === false) return false;
					if (prev) if (typeof prev === "string") return prev;
					else if (typeof prev === "function") {
						let prevPath = prev(file);
						if (prevPath) {
							let map = this.loadFile(prevPath);
							if (!map) throw new Error("Unable to load previous source map: " + prevPath.toString());
							return map;
						}
					} else if (prev instanceof SourceMapConsumer) return SourceMapGenerator.fromSourceMap(prev).toString();
					else if (prev instanceof SourceMapGenerator) return prev.toString();
					else if (this.isMap(prev)) return JSON.stringify(prev);
					else throw new Error("Unsupported previous source map format: " + prev.toString());
					else if (this.inline) return this.decodeInline(this.annotation);
					else if (this.annotation) {
						let map = this.annotation;
						if (file) map = join(dirname(file), map);
						return this.loadFile(map);
					}
				}
				startWith(string, start) {
					if (!string) return false;
					return string.substr(0, start.length) === start;
				}
				withContent() {
					return !!(this.consumer().sourcesContent && this.consumer().sourcesContent.length > 0);
				}
			}
			previousMap$1 = PreviousMap;
			PreviousMap.default = PreviousMap;
			return previousMap$1;
		}
		function requireInput$1() {
			if (hasRequiredInput$1) return input$1;
			hasRequiredInput$1 = 1;
			let { SourceMapConsumer, SourceMapGenerator } = require$$2$1;
			let { fileURLToPath, pathToFileURL } = require$$2$1;
			let { isAbsolute, resolve } = require$$2$1;
			let { nanoid } = /* @__PURE__ */ requireNonSecure$1();
			let terminalHighlight = require$$2$1;
			let CssSyntaxError = requireCssSyntaxError$1();
			let PreviousMap = requirePreviousMap$1();
			let fromOffsetCache = Symbol("fromOffsetCache");
			let sourceMapAvailable = Boolean(SourceMapConsumer && SourceMapGenerator);
			let pathAvailable = Boolean(resolve && isAbsolute);
			class Input {
				constructor(css, opts = {}) {
					if (css === null || typeof css === "undefined" || typeof css === "object" && !css.toString) throw new Error(`PostCSS received ${css} instead of CSS string`);
					this.css = css.toString();
					if (this.css[0] === "﻿" || this.css[0] === "￾") {
						this.hasBOM = true;
						this.css = this.css.slice(1);
					} else this.hasBOM = false;
					if (opts.from) if (!pathAvailable || /^\w+:\/\//.test(opts.from) || isAbsolute(opts.from)) this.file = opts.from;
					else this.file = resolve(opts.from);
					if (pathAvailable && sourceMapAvailable) {
						let map = new PreviousMap(this.css, opts);
						if (map.text) {
							this.map = map;
							let file = map.consumer().file;
							if (!this.file && file) this.file = this.mapResolve(file);
						}
					}
					if (!this.file) this.id = "<input css " + nanoid(6) + ">";
					if (this.map) this.map.file = this.from;
				}
				error(message, line, column, opts = {}) {
					let result2, endLine, endColumn;
					if (line && typeof line === "object") {
						let start = line;
						let end = column;
						if (typeof start.offset === "number") {
							let pos = this.fromOffset(start.offset);
							line = pos.line;
							column = pos.col;
						} else {
							line = start.line;
							column = start.column;
						}
						if (typeof end.offset === "number") {
							let pos = this.fromOffset(end.offset);
							endLine = pos.line;
							endColumn = pos.col;
						} else {
							endLine = end.line;
							endColumn = end.column;
						}
					} else if (!column) {
						let pos = this.fromOffset(line);
						line = pos.line;
						column = pos.col;
					}
					let origin = this.origin(line, column, endLine, endColumn);
					if (origin) result2 = new CssSyntaxError(message, origin.endLine === void 0 ? origin.line : {
						column: origin.column,
						line: origin.line
					}, origin.endLine === void 0 ? origin.column : {
						column: origin.endColumn,
						line: origin.endLine
					}, origin.source, origin.file, opts.plugin);
					else result2 = new CssSyntaxError(message, endLine === void 0 ? line : {
						column,
						line
					}, endLine === void 0 ? column : {
						column: endColumn,
						line: endLine
					}, this.css, this.file, opts.plugin);
					result2.input = {
						column,
						endColumn,
						endLine,
						line,
						source: this.css
					};
					if (this.file) {
						if (pathToFileURL) result2.input.url = pathToFileURL(this.file).toString();
						result2.input.file = this.file;
					}
					return result2;
				}
				fromOffset(offset) {
					let lastLine, lineToIndex;
					if (!this[fromOffsetCache]) {
						let lines = this.css.split("\n");
						lineToIndex = new Array(lines.length);
						let prevIndex = 0;
						for (let i2 = 0, l2 = lines.length; i2 < l2; i2++) {
							lineToIndex[i2] = prevIndex;
							prevIndex += lines[i2].length + 1;
						}
						this[fromOffsetCache] = lineToIndex;
					} else lineToIndex = this[fromOffsetCache];
					lastLine = lineToIndex[lineToIndex.length - 1];
					let min = 0;
					if (offset >= lastLine) min = lineToIndex.length - 1;
					else {
						let max = lineToIndex.length - 2;
						let mid;
						while (min < max) {
							mid = min + (max - min >> 1);
							if (offset < lineToIndex[mid]) max = mid - 1;
							else if (offset >= lineToIndex[mid + 1]) min = mid + 1;
							else {
								min = mid;
								break;
							}
						}
					}
					return {
						col: offset - lineToIndex[min] + 1,
						line: min + 1
					};
				}
				mapResolve(file) {
					if (/^\w+:\/\//.test(file)) return file;
					return resolve(this.map.consumer().sourceRoot || this.map.root || ".", file);
				}
				origin(line, column, endLine, endColumn) {
					if (!this.map) return false;
					let consumer = this.map.consumer();
					let from = consumer.originalPositionFor({
						column,
						line
					});
					if (!from.source) return false;
					let to;
					if (typeof endLine === "number") to = consumer.originalPositionFor({
						column: endColumn,
						line: endLine
					});
					let fromUrl;
					if (isAbsolute(from.source)) fromUrl = pathToFileURL(from.source);
					else fromUrl = new URL(from.source, this.map.consumer().sourceRoot || pathToFileURL(this.map.mapFile));
					let result2 = {
						column: from.column,
						endColumn: to && to.column,
						endLine: to && to.line,
						line: from.line,
						url: fromUrl.toString()
					};
					if (fromUrl.protocol === "file:") if (fileURLToPath) result2.file = fileURLToPath(fromUrl);
					else throw new Error(`file: protocol is not available in this PostCSS build`);
					let source = consumer.sourceContentFor(from.source);
					if (source) result2.source = source;
					return result2;
				}
				toJSON() {
					let json = {};
					for (let name of [
						"hasBOM",
						"css",
						"file",
						"id"
					]) if (this[name] != null) json[name] = this[name];
					if (this.map) {
						json.map = { ...this.map };
						if (json.map.consumerCache) json.map.consumerCache = void 0;
					}
					return json;
				}
				get from() {
					return this.file || this.id;
				}
			}
			input$1 = Input;
			Input.default = Input;
			if (terminalHighlight && terminalHighlight.registerInput) terminalHighlight.registerInput(Input);
			return input$1;
		}
		function requireMapGenerator$1() {
			if (hasRequiredMapGenerator$1) return mapGenerator$1;
			hasRequiredMapGenerator$1 = 1;
			let { SourceMapConsumer, SourceMapGenerator } = require$$2$1;
			let { dirname, relative, resolve, sep } = require$$2$1;
			let { pathToFileURL } = require$$2$1;
			let Input = requireInput$1();
			let sourceMapAvailable = Boolean(SourceMapConsumer && SourceMapGenerator);
			let pathAvailable = Boolean(dirname && resolve && relative && sep);
			class MapGenerator {
				constructor(stringify, root2, opts, cssString) {
					this.stringify = stringify;
					this.mapOpts = opts.map || {};
					this.root = root2;
					this.opts = opts;
					this.css = cssString;
					this.originalCSS = cssString;
					this.usesFileUrls = !this.mapOpts.from && this.mapOpts.absolute;
					this.memoizedFileURLs = /* @__PURE__ */ new Map();
					this.memoizedPaths = /* @__PURE__ */ new Map();
					this.memoizedURLs = /* @__PURE__ */ new Map();
				}
				addAnnotation() {
					let content;
					if (this.isInline()) content = "data:application/json;base64," + this.toBase64(this.map.toString());
					else if (typeof this.mapOpts.annotation === "string") content = this.mapOpts.annotation;
					else if (typeof this.mapOpts.annotation === "function") content = this.mapOpts.annotation(this.opts.to, this.root);
					else content = this.outputFile() + ".map";
					let eol = "\n";
					if (this.css.includes("\r\n")) eol = "\r\n";
					this.css += eol + "/*# sourceMappingURL=" + content + " */";
				}
				applyPrevMaps() {
					for (let prev of this.previous()) {
						let from = this.toUrl(this.path(prev.file));
						let root2 = prev.root || dirname(prev.file);
						let map;
						if (this.mapOpts.sourcesContent === false) {
							map = new SourceMapConsumer(prev.text);
							if (map.sourcesContent) map.sourcesContent = null;
						} else map = prev.consumer();
						this.map.applySourceMap(map, from, this.toUrl(this.path(root2)));
					}
				}
				clearAnnotation() {
					if (this.mapOpts.annotation === false) return;
					if (this.root) {
						let node2;
						for (let i2 = this.root.nodes.length - 1; i2 >= 0; i2--) {
							node2 = this.root.nodes[i2];
							if (node2.type !== "comment") continue;
							if (node2.text.indexOf("# sourceMappingURL=") === 0) this.root.removeChild(i2);
						}
					} else if (this.css) this.css = this.css.replace(/\n*?\/\*#[\S\s]*?\*\/$/gm, "");
				}
				generate() {
					this.clearAnnotation();
					if (pathAvailable && sourceMapAvailable && this.isMap()) return this.generateMap();
					else {
						let result2 = "";
						this.stringify(this.root, (i2) => {
							result2 += i2;
						});
						return [result2];
					}
				}
				generateMap() {
					if (this.root) this.generateString();
					else if (this.previous().length === 1) {
						let prev = this.previous()[0].consumer();
						prev.file = this.outputFile();
						this.map = SourceMapGenerator.fromSourceMap(prev, { ignoreInvalidMapping: true });
					} else {
						this.map = new SourceMapGenerator({
							file: this.outputFile(),
							ignoreInvalidMapping: true
						});
						this.map.addMapping({
							generated: {
								column: 0,
								line: 1
							},
							original: {
								column: 0,
								line: 1
							},
							source: this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>"
						});
					}
					if (this.isSourcesContent()) this.setSourcesContent();
					if (this.root && this.previous().length > 0) this.applyPrevMaps();
					if (this.isAnnotation()) this.addAnnotation();
					if (this.isInline()) return [this.css];
					else return [this.css, this.map];
				}
				generateString() {
					this.css = "";
					this.map = new SourceMapGenerator({
						file: this.outputFile(),
						ignoreInvalidMapping: true
					});
					let line = 1;
					let column = 1;
					let noSource = "<no source>";
					let mapping = {
						generated: {
							column: 0,
							line: 0
						},
						original: {
							column: 0,
							line: 0
						},
						source: ""
					};
					let lines, last;
					this.stringify(this.root, (str, node2, type) => {
						this.css += str;
						if (node2 && type !== "end") {
							mapping.generated.line = line;
							mapping.generated.column = column - 1;
							if (node2.source && node2.source.start) {
								mapping.source = this.sourcePath(node2);
								mapping.original.line = node2.source.start.line;
								mapping.original.column = node2.source.start.column - 1;
								this.map.addMapping(mapping);
							} else {
								mapping.source = noSource;
								mapping.original.line = 1;
								mapping.original.column = 0;
								this.map.addMapping(mapping);
							}
						}
						lines = str.match(/\n/g);
						if (lines) {
							line += lines.length;
							last = str.lastIndexOf("\n");
							column = str.length - last;
						} else column += str.length;
						if (node2 && type !== "start") {
							let p = node2.parent || { raws: {} };
							if (!(node2.type === "decl" || node2.type === "atrule" && !node2.nodes) || node2 !== p.last || p.raws.semicolon) if (node2.source && node2.source.end) {
								mapping.source = this.sourcePath(node2);
								mapping.original.line = node2.source.end.line;
								mapping.original.column = node2.source.end.column - 1;
								mapping.generated.line = line;
								mapping.generated.column = column - 2;
								this.map.addMapping(mapping);
							} else {
								mapping.source = noSource;
								mapping.original.line = 1;
								mapping.original.column = 0;
								mapping.generated.line = line;
								mapping.generated.column = column - 1;
								this.map.addMapping(mapping);
							}
						}
					});
				}
				isAnnotation() {
					if (this.isInline()) return true;
					if (typeof this.mapOpts.annotation !== "undefined") return this.mapOpts.annotation;
					if (this.previous().length) return this.previous().some((i2) => i2.annotation);
					return true;
				}
				isInline() {
					if (typeof this.mapOpts.inline !== "undefined") return this.mapOpts.inline;
					let annotation = this.mapOpts.annotation;
					if (typeof annotation !== "undefined" && annotation !== true) return false;
					if (this.previous().length) return this.previous().some((i2) => i2.inline);
					return true;
				}
				isMap() {
					if (typeof this.opts.map !== "undefined") return !!this.opts.map;
					return this.previous().length > 0;
				}
				isSourcesContent() {
					if (typeof this.mapOpts.sourcesContent !== "undefined") return this.mapOpts.sourcesContent;
					if (this.previous().length) return this.previous().some((i2) => i2.withContent());
					return true;
				}
				outputFile() {
					if (this.opts.to) return this.path(this.opts.to);
					else if (this.opts.from) return this.path(this.opts.from);
					else return "to.css";
				}
				path(file) {
					if (this.mapOpts.absolute) return file;
					if (file.charCodeAt(0) === 60) return file;
					if (/^\w+:\/\//.test(file)) return file;
					let cached = this.memoizedPaths.get(file);
					if (cached) return cached;
					let from = this.opts.to ? dirname(this.opts.to) : ".";
					if (typeof this.mapOpts.annotation === "string") from = dirname(resolve(from, this.mapOpts.annotation));
					let path = relative(from, file);
					this.memoizedPaths.set(file, path);
					return path;
				}
				previous() {
					if (!this.previousMaps) {
						this.previousMaps = [];
						if (this.root) this.root.walk((node2) => {
							if (node2.source && node2.source.input.map) {
								let map = node2.source.input.map;
								if (!this.previousMaps.includes(map)) this.previousMaps.push(map);
							}
						});
						else {
							let input2 = new Input(this.originalCSS, this.opts);
							if (input2.map) this.previousMaps.push(input2.map);
						}
					}
					return this.previousMaps;
				}
				setSourcesContent() {
					let already = {};
					if (this.root) this.root.walk((node2) => {
						if (node2.source) {
							let from = node2.source.input.from;
							if (from && !already[from]) {
								already[from] = true;
								let fromUrl = this.usesFileUrls ? this.toFileUrl(from) : this.toUrl(this.path(from));
								this.map.setSourceContent(fromUrl, node2.source.input.css);
							}
						}
					});
					else if (this.css) {
						let from = this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>";
						this.map.setSourceContent(from, this.css);
					}
				}
				sourcePath(node2) {
					if (this.mapOpts.from) return this.toUrl(this.mapOpts.from);
					else if (this.usesFileUrls) return this.toFileUrl(node2.source.input.from);
					else return this.toUrl(this.path(node2.source.input.from));
				}
				toBase64(str) {
					if (Buffer) return Buffer.from(str).toString("base64");
					else return window.btoa(unescape(encodeURIComponent(str)));
				}
				toFileUrl(path) {
					let cached = this.memoizedFileURLs.get(path);
					if (cached) return cached;
					if (pathToFileURL) {
						let fileURL = pathToFileURL(path).toString();
						this.memoizedFileURLs.set(path, fileURL);
						return fileURL;
					} else throw new Error("`map.absolute` option is not available in this PostCSS build");
				}
				toUrl(path) {
					let cached = this.memoizedURLs.get(path);
					if (cached) return cached;
					if (sep === "\\") path = path.replace(/\\/g, "/");
					let url = encodeURI(path).replace(/[#?]/g, encodeURIComponent);
					this.memoizedURLs.set(path, url);
					return url;
				}
			}
			mapGenerator$1 = MapGenerator;
			return mapGenerator$1;
		}
		function requireComment$1() {
			if (hasRequiredComment$1) return comment$1;
			hasRequiredComment$1 = 1;
			let Node2 = requireNode$1();
			class Comment extends Node2 {
				constructor(defaults) {
					super(defaults);
					this.type = "comment";
				}
			}
			comment$1 = Comment;
			Comment.default = Comment;
			return comment$1;
		}
		function requireContainer$1() {
			if (hasRequiredContainer$1) return container$1;
			hasRequiredContainer$1 = 1;
			let { isClean, my } = requireSymbols$1();
			let Declaration = requireDeclaration$1();
			let Comment = requireComment$1();
			let Node2 = requireNode$1();
			let parse, Rule, AtRule, Root;
			function cleanSource(nodes) {
				return nodes.map((i2) => {
					if (i2.nodes) i2.nodes = cleanSource(i2.nodes);
					delete i2.source;
					return i2;
				});
			}
			function markDirtyUp(node2) {
				node2[isClean] = false;
				if (node2.proxyOf.nodes) for (let i2 of node2.proxyOf.nodes) markDirtyUp(i2);
			}
			class Container extends Node2 {
				append(...children) {
					for (let child of children) {
						let nodes = this.normalize(child, this.last);
						for (let node2 of nodes) this.proxyOf.nodes.push(node2);
					}
					this.markDirty();
					return this;
				}
				cleanRaws(keepBetween) {
					super.cleanRaws(keepBetween);
					if (this.nodes) for (let node2 of this.nodes) node2.cleanRaws(keepBetween);
				}
				each(callback) {
					if (!this.proxyOf.nodes) return void 0;
					let iterator = this.getIterator();
					let index2, result2;
					while (this.indexes[iterator] < this.proxyOf.nodes.length) {
						index2 = this.indexes[iterator];
						result2 = callback(this.proxyOf.nodes[index2], index2);
						if (result2 === false) break;
						this.indexes[iterator] += 1;
					}
					delete this.indexes[iterator];
					return result2;
				}
				every(condition) {
					return this.nodes.every(condition);
				}
				getIterator() {
					if (!this.lastEach) this.lastEach = 0;
					if (!this.indexes) this.indexes = {};
					this.lastEach += 1;
					let iterator = this.lastEach;
					this.indexes[iterator] = 0;
					return iterator;
				}
				getProxyProcessor() {
					return {
						get(node2, prop) {
							if (prop === "proxyOf") return node2;
							else if (!node2[prop]) return node2[prop];
							else if (prop === "each" || typeof prop === "string" && prop.startsWith("walk")) return (...args) => {
								return node2[prop](...args.map((i2) => {
									if (typeof i2 === "function") return (child, index2) => i2(child.toProxy(), index2);
									else return i2;
								}));
							};
							else if (prop === "every" || prop === "some") return (cb) => {
								return node2[prop]((child, ...other) => cb(child.toProxy(), ...other));
							};
							else if (prop === "root") return () => node2.root().toProxy();
							else if (prop === "nodes") return node2.nodes.map((i2) => i2.toProxy());
							else if (prop === "first" || prop === "last") return node2[prop].toProxy();
							else return node2[prop];
						},
						set(node2, prop, value) {
							if (node2[prop] === value) return true;
							node2[prop] = value;
							if (prop === "name" || prop === "params" || prop === "selector") node2.markDirty();
							return true;
						}
					};
				}
				index(child) {
					if (typeof child === "number") return child;
					if (child.proxyOf) child = child.proxyOf;
					return this.proxyOf.nodes.indexOf(child);
				}
				insertAfter(exist, add) {
					let existIndex = this.index(exist);
					let nodes = this.normalize(add, this.proxyOf.nodes[existIndex]).reverse();
					existIndex = this.index(exist);
					for (let node2 of nodes) this.proxyOf.nodes.splice(existIndex + 1, 0, node2);
					let index2;
					for (let id in this.indexes) {
						index2 = this.indexes[id];
						if (existIndex < index2) this.indexes[id] = index2 + nodes.length;
					}
					this.markDirty();
					return this;
				}
				insertBefore(exist, add) {
					let existIndex = this.index(exist);
					let type = existIndex === 0 ? "prepend" : false;
					let nodes = this.normalize(add, this.proxyOf.nodes[existIndex], type).reverse();
					existIndex = this.index(exist);
					for (let node2 of nodes) this.proxyOf.nodes.splice(existIndex, 0, node2);
					let index2;
					for (let id in this.indexes) {
						index2 = this.indexes[id];
						if (existIndex <= index2) this.indexes[id] = index2 + nodes.length;
					}
					this.markDirty();
					return this;
				}
				normalize(nodes, sample) {
					if (typeof nodes === "string") nodes = cleanSource(parse(nodes).nodes);
					else if (typeof nodes === "undefined") nodes = [];
					else if (Array.isArray(nodes)) {
						nodes = nodes.slice(0);
						for (let i2 of nodes) if (i2.parent) i2.parent.removeChild(i2, "ignore");
					} else if (nodes.type === "root" && this.type !== "document") {
						nodes = nodes.nodes.slice(0);
						for (let i2 of nodes) if (i2.parent) i2.parent.removeChild(i2, "ignore");
					} else if (nodes.type) nodes = [nodes];
					else if (nodes.prop) {
						if (typeof nodes.value === "undefined") throw new Error("Value field is missed in node creation");
						else if (typeof nodes.value !== "string") nodes.value = String(nodes.value);
						nodes = [new Declaration(nodes)];
					} else if (nodes.selector) nodes = [new Rule(nodes)];
					else if (nodes.name) nodes = [new AtRule(nodes)];
					else if (nodes.text) nodes = [new Comment(nodes)];
					else throw new Error("Unknown node type in node creation");
					return nodes.map((i2) => {
						if (!i2[my]) Container.rebuild(i2);
						i2 = i2.proxyOf;
						if (i2.parent) i2.parent.removeChild(i2);
						if (i2[isClean]) markDirtyUp(i2);
						if (typeof i2.raws.before === "undefined") {
							if (sample && typeof sample.raws.before !== "undefined") i2.raws.before = sample.raws.before.replace(/\S/g, "");
						}
						i2.parent = this.proxyOf;
						return i2;
					});
				}
				prepend(...children) {
					children = children.reverse();
					for (let child of children) {
						let nodes = this.normalize(child, this.first, "prepend").reverse();
						for (let node2 of nodes) this.proxyOf.nodes.unshift(node2);
						for (let id in this.indexes) this.indexes[id] = this.indexes[id] + nodes.length;
					}
					this.markDirty();
					return this;
				}
				push(child) {
					child.parent = this;
					this.proxyOf.nodes.push(child);
					return this;
				}
				removeAll() {
					for (let node2 of this.proxyOf.nodes) node2.parent = void 0;
					this.proxyOf.nodes = [];
					this.markDirty();
					return this;
				}
				removeChild(child) {
					child = this.index(child);
					this.proxyOf.nodes[child].parent = void 0;
					this.proxyOf.nodes.splice(child, 1);
					let index2;
					for (let id in this.indexes) {
						index2 = this.indexes[id];
						if (index2 >= child) this.indexes[id] = index2 - 1;
					}
					this.markDirty();
					return this;
				}
				replaceValues(pattern, opts, callback) {
					if (!callback) {
						callback = opts;
						opts = {};
					}
					this.walkDecls((decl) => {
						if (opts.props && !opts.props.includes(decl.prop)) return;
						if (opts.fast && !decl.value.includes(opts.fast)) return;
						decl.value = decl.value.replace(pattern, callback);
					});
					this.markDirty();
					return this;
				}
				some(condition) {
					return this.nodes.some(condition);
				}
				walk(callback) {
					return this.each((child, i2) => {
						let result2;
						try {
							result2 = callback(child, i2);
						} catch (e2) {
							throw child.addToError(e2);
						}
						if (result2 !== false && child.walk) result2 = child.walk(callback);
						return result2;
					});
				}
				walkAtRules(name, callback) {
					if (!callback) {
						callback = name;
						return this.walk((child, i2) => {
							if (child.type === "atrule") return callback(child, i2);
						});
					}
					if (name instanceof RegExp) return this.walk((child, i2) => {
						if (child.type === "atrule" && name.test(child.name)) return callback(child, i2);
					});
					return this.walk((child, i2) => {
						if (child.type === "atrule" && child.name === name) return callback(child, i2);
					});
				}
				walkComments(callback) {
					return this.walk((child, i2) => {
						if (child.type === "comment") return callback(child, i2);
					});
				}
				walkDecls(prop, callback) {
					if (!callback) {
						callback = prop;
						return this.walk((child, i2) => {
							if (child.type === "decl") return callback(child, i2);
						});
					}
					if (prop instanceof RegExp) return this.walk((child, i2) => {
						if (child.type === "decl" && prop.test(child.prop)) return callback(child, i2);
					});
					return this.walk((child, i2) => {
						if (child.type === "decl" && child.prop === prop) return callback(child, i2);
					});
				}
				walkRules(selector, callback) {
					if (!callback) {
						callback = selector;
						return this.walk((child, i2) => {
							if (child.type === "rule") return callback(child, i2);
						});
					}
					if (selector instanceof RegExp) return this.walk((child, i2) => {
						if (child.type === "rule" && selector.test(child.selector)) return callback(child, i2);
					});
					return this.walk((child, i2) => {
						if (child.type === "rule" && child.selector === selector) return callback(child, i2);
					});
				}
				get first() {
					if (!this.proxyOf.nodes) return void 0;
					return this.proxyOf.nodes[0];
				}
				get last() {
					if (!this.proxyOf.nodes) return void 0;
					return this.proxyOf.nodes[this.proxyOf.nodes.length - 1];
				}
			}
			Container.registerParse = (dependant) => {
				parse = dependant;
			};
			Container.registerRule = (dependant) => {
				Rule = dependant;
			};
			Container.registerAtRule = (dependant) => {
				AtRule = dependant;
			};
			Container.registerRoot = (dependant) => {
				Root = dependant;
			};
			container$1 = Container;
			Container.default = Container;
			Container.rebuild = (node2) => {
				if (node2.type === "atrule") Object.setPrototypeOf(node2, AtRule.prototype);
				else if (node2.type === "rule") Object.setPrototypeOf(node2, Rule.prototype);
				else if (node2.type === "decl") Object.setPrototypeOf(node2, Declaration.prototype);
				else if (node2.type === "comment") Object.setPrototypeOf(node2, Comment.prototype);
				else if (node2.type === "root") Object.setPrototypeOf(node2, Root.prototype);
				node2[my] = true;
				if (node2.nodes) node2.nodes.forEach((child) => {
					Container.rebuild(child);
				});
			};
			return container$1;
		}
		function requireDocument$1() {
			if (hasRequiredDocument$1) return document$1$1;
			hasRequiredDocument$1 = 1;
			let Container = requireContainer$1();
			let LazyResult, Processor;
			class Document2 extends Container {
				constructor(defaults) {
					super({
						type: "document",
						...defaults
					});
					if (!this.nodes) this.nodes = [];
				}
				toResult(opts = {}) {
					return new LazyResult(new Processor(), this, opts).stringify();
				}
			}
			Document2.registerLazyResult = (dependant) => {
				LazyResult = dependant;
			};
			Document2.registerProcessor = (dependant) => {
				Processor = dependant;
			};
			document$1$1 = Document2;
			Document2.default = Document2;
			return document$1$1;
		}
		function requireWarnOnce$1() {
			if (hasRequiredWarnOnce$1) return warnOnce$1;
			hasRequiredWarnOnce$1 = 1;
			let printed = {};
			warnOnce$1 = function warnOnce2(message) {
				if (printed[message]) return;
				printed[message] = true;
				if (typeof console !== "undefined" && console.warn) console.warn(message);
			};
			return warnOnce$1;
		}
		function requireWarning$1() {
			if (hasRequiredWarning$1) return warning$1;
			hasRequiredWarning$1 = 1;
			class Warning {
				constructor(text, opts = {}) {
					this.type = "warning";
					this.text = text;
					if (opts.node && opts.node.source) {
						let range = opts.node.rangeBy(opts);
						this.line = range.start.line;
						this.column = range.start.column;
						this.endLine = range.end.line;
						this.endColumn = range.end.column;
					}
					for (let opt in opts) this[opt] = opts[opt];
				}
				toString() {
					if (this.node) return this.node.error(this.text, {
						index: this.index,
						plugin: this.plugin,
						word: this.word
					}).message;
					if (this.plugin) return this.plugin + ": " + this.text;
					return this.text;
				}
			}
			warning$1 = Warning;
			Warning.default = Warning;
			return warning$1;
		}
		function requireResult$1() {
			if (hasRequiredResult$1) return result$1;
			hasRequiredResult$1 = 1;
			let Warning = requireWarning$1();
			class Result {
				constructor(processor2, root2, opts) {
					this.processor = processor2;
					this.messages = [];
					this.root = root2;
					this.opts = opts;
					this.css = void 0;
					this.map = void 0;
				}
				toString() {
					return this.css;
				}
				warn(text, opts = {}) {
					if (!opts.plugin) {
						if (this.lastPlugin && this.lastPlugin.postcssPlugin) opts.plugin = this.lastPlugin.postcssPlugin;
					}
					let warning2 = new Warning(text, opts);
					this.messages.push(warning2);
					return warning2;
				}
				warnings() {
					return this.messages.filter((i2) => i2.type === "warning");
				}
				get content() {
					return this.css;
				}
			}
			result$1 = Result;
			Result.default = Result;
			return result$1;
		}
		function requireTokenize$1() {
			if (hasRequiredTokenize$1) return tokenize$1;
			hasRequiredTokenize$1 = 1;
			const SINGLE_QUOTE = "'".charCodeAt(0);
			const DOUBLE_QUOTE = "\"".charCodeAt(0);
			const BACKSLASH = "\\".charCodeAt(0);
			const SLASH = "/".charCodeAt(0);
			const NEWLINE = "\n".charCodeAt(0);
			const SPACE = " ".charCodeAt(0);
			const FEED = "\f".charCodeAt(0);
			const TAB = "	".charCodeAt(0);
			const CR = "\r".charCodeAt(0);
			const OPEN_SQUARE = "[".charCodeAt(0);
			const CLOSE_SQUARE = "]".charCodeAt(0);
			const OPEN_PARENTHESES = "(".charCodeAt(0);
			const CLOSE_PARENTHESES = ")".charCodeAt(0);
			const OPEN_CURLY = "{".charCodeAt(0);
			const CLOSE_CURLY = "}".charCodeAt(0);
			const SEMICOLON = ";".charCodeAt(0);
			const ASTERISK = "*".charCodeAt(0);
			const COLON = ":".charCodeAt(0);
			const AT = "@".charCodeAt(0);
			const RE_AT_END = /[\t\n\f\r "#'()/;[\\\]{}]/g;
			const RE_WORD_END = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g;
			const RE_BAD_BRACKET = /.[\r\n"'(/\\]/;
			const RE_HEX_ESCAPE = /[\da-f]/i;
			tokenize$1 = function tokenizer(input2, options = {}) {
				let css = input2.css.valueOf();
				let ignore = options.ignoreErrors;
				let code, next, quote, content, escape;
				let escaped, escapePos, prev, n2, currentToken;
				let length = css.length;
				let pos = 0;
				let buffer = [];
				let returned = [];
				function position() {
					return pos;
				}
				function unclosed(what) {
					throw input2.error("Unclosed " + what, pos);
				}
				function endOfFile() {
					return returned.length === 0 && pos >= length;
				}
				function nextToken(opts) {
					if (returned.length) return returned.pop();
					if (pos >= length) return;
					let ignoreUnclosed = opts ? opts.ignoreUnclosed : false;
					code = css.charCodeAt(pos);
					switch (code) {
						case NEWLINE:
						case SPACE:
						case TAB:
						case CR:
						case FEED:
							next = pos;
							do {
								next += 1;
								code = css.charCodeAt(next);
							} while (code === SPACE || code === NEWLINE || code === TAB || code === CR || code === FEED);
							currentToken = ["space", css.slice(pos, next)];
							pos = next - 1;
							break;
						case OPEN_SQUARE:
						case CLOSE_SQUARE:
						case OPEN_CURLY:
						case CLOSE_CURLY:
						case COLON:
						case SEMICOLON:
						case CLOSE_PARENTHESES: {
							let controlChar = String.fromCharCode(code);
							currentToken = [
								controlChar,
								controlChar,
								pos
							];
							break;
						}
						case OPEN_PARENTHESES:
							prev = buffer.length ? buffer.pop()[1] : "";
							n2 = css.charCodeAt(pos + 1);
							if (prev === "url" && n2 !== SINGLE_QUOTE && n2 !== DOUBLE_QUOTE && n2 !== SPACE && n2 !== NEWLINE && n2 !== TAB && n2 !== FEED && n2 !== CR) {
								next = pos;
								do {
									escaped = false;
									next = css.indexOf(")", next + 1);
									if (next === -1) if (ignore || ignoreUnclosed) {
										next = pos;
										break;
									} else unclosed("bracket");
									escapePos = next;
									while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
										escapePos -= 1;
										escaped = !escaped;
									}
								} while (escaped);
								currentToken = [
									"brackets",
									css.slice(pos, next + 1),
									pos,
									next
								];
								pos = next;
							} else {
								next = css.indexOf(")", pos + 1);
								content = css.slice(pos, next + 1);
								if (next === -1 || RE_BAD_BRACKET.test(content)) currentToken = [
									"(",
									"(",
									pos
								];
								else {
									currentToken = [
										"brackets",
										content,
										pos,
										next
									];
									pos = next;
								}
							}
							break;
						case SINGLE_QUOTE:
						case DOUBLE_QUOTE:
							quote = code === SINGLE_QUOTE ? "'" : "\"";
							next = pos;
							do {
								escaped = false;
								next = css.indexOf(quote, next + 1);
								if (next === -1) if (ignore || ignoreUnclosed) {
									next = pos + 1;
									break;
								} else unclosed("string");
								escapePos = next;
								while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
									escapePos -= 1;
									escaped = !escaped;
								}
							} while (escaped);
							currentToken = [
								"string",
								css.slice(pos, next + 1),
								pos,
								next
							];
							pos = next;
							break;
						case AT:
							RE_AT_END.lastIndex = pos + 1;
							RE_AT_END.test(css);
							if (RE_AT_END.lastIndex === 0) next = css.length - 1;
							else next = RE_AT_END.lastIndex - 2;
							currentToken = [
								"at-word",
								css.slice(pos, next + 1),
								pos,
								next
							];
							pos = next;
							break;
						case BACKSLASH:
							next = pos;
							escape = true;
							while (css.charCodeAt(next + 1) === BACKSLASH) {
								next += 1;
								escape = !escape;
							}
							code = css.charCodeAt(next + 1);
							if (escape && code !== SLASH && code !== SPACE && code !== NEWLINE && code !== TAB && code !== CR && code !== FEED) {
								next += 1;
								if (RE_HEX_ESCAPE.test(css.charAt(next))) {
									while (RE_HEX_ESCAPE.test(css.charAt(next + 1))) next += 1;
									if (css.charCodeAt(next + 1) === SPACE) next += 1;
								}
							}
							currentToken = [
								"word",
								css.slice(pos, next + 1),
								pos,
								next
							];
							pos = next;
							break;
						default:
							if (code === SLASH && css.charCodeAt(pos + 1) === ASTERISK) {
								next = css.indexOf("*/", pos + 2) + 1;
								if (next === 0) if (ignore || ignoreUnclosed) next = css.length;
								else unclosed("comment");
								currentToken = [
									"comment",
									css.slice(pos, next + 1),
									pos,
									next
								];
								pos = next;
							} else {
								RE_WORD_END.lastIndex = pos + 1;
								RE_WORD_END.test(css);
								if (RE_WORD_END.lastIndex === 0) next = css.length - 1;
								else next = RE_WORD_END.lastIndex - 2;
								currentToken = [
									"word",
									css.slice(pos, next + 1),
									pos,
									next
								];
								buffer.push(currentToken);
								pos = next;
							}
							break;
					}
					pos++;
					return currentToken;
				}
				function back(token) {
					returned.push(token);
				}
				return {
					back,
					endOfFile,
					nextToken,
					position
				};
			};
			return tokenize$1;
		}
		function requireAtRule$1() {
			if (hasRequiredAtRule$1) return atRule$1;
			hasRequiredAtRule$1 = 1;
			let Container = requireContainer$1();
			class AtRule extends Container {
				constructor(defaults) {
					super(defaults);
					this.type = "atrule";
				}
				append(...children) {
					if (!this.proxyOf.nodes) this.nodes = [];
					return super.append(...children);
				}
				prepend(...children) {
					if (!this.proxyOf.nodes) this.nodes = [];
					return super.prepend(...children);
				}
			}
			atRule$1 = AtRule;
			AtRule.default = AtRule;
			Container.registerAtRule(AtRule);
			return atRule$1;
		}
		function requireRoot$1() {
			if (hasRequiredRoot$1) return root$1;
			hasRequiredRoot$1 = 1;
			let Container = requireContainer$1();
			let LazyResult, Processor;
			class Root extends Container {
				constructor(defaults) {
					super(defaults);
					this.type = "root";
					if (!this.nodes) this.nodes = [];
				}
				normalize(child, sample, type) {
					let nodes = super.normalize(child);
					if (sample) {
						if (type === "prepend") if (this.nodes.length > 1) sample.raws.before = this.nodes[1].raws.before;
						else delete sample.raws.before;
						else if (this.first !== sample) for (let node2 of nodes) node2.raws.before = sample.raws.before;
					}
					return nodes;
				}
				removeChild(child, ignore) {
					let index2 = this.index(child);
					if (!ignore && index2 === 0 && this.nodes.length > 1) this.nodes[1].raws.before = this.nodes[index2].raws.before;
					return super.removeChild(child);
				}
				toResult(opts = {}) {
					return new LazyResult(new Processor(), this, opts).stringify();
				}
			}
			Root.registerLazyResult = (dependant) => {
				LazyResult = dependant;
			};
			Root.registerProcessor = (dependant) => {
				Processor = dependant;
			};
			root$1 = Root;
			Root.default = Root;
			Container.registerRoot(Root);
			return root$1;
		}
		function requireList$1() {
			if (hasRequiredList$1) return list_1$1;
			hasRequiredList$1 = 1;
			let list = {
				comma(string) {
					return list.split(string, [","], true);
				},
				space(string) {
					return list.split(string, [
						" ",
						"\n",
						"	"
					]);
				},
				split(string, separators, last) {
					let array = [];
					let current = "";
					let split = false;
					let func = 0;
					let inQuote = false;
					let prevQuote = "";
					let escape = false;
					for (let letter of string) {
						if (escape) escape = false;
						else if (letter === "\\") escape = true;
						else if (inQuote) {
							if (letter === prevQuote) inQuote = false;
						} else if (letter === "\"" || letter === "'") {
							inQuote = true;
							prevQuote = letter;
						} else if (letter === "(") func += 1;
						else if (letter === ")") {
							if (func > 0) func -= 1;
						} else if (func === 0) {
							if (separators.includes(letter)) split = true;
						}
						if (split) {
							if (current !== "") array.push(current.trim());
							current = "";
							split = false;
						} else current += letter;
					}
					if (last || current !== "") array.push(current.trim());
					return array;
				}
			};
			list_1$1 = list;
			list.default = list;
			return list_1$1;
		}
		function requireRule$1() {
			if (hasRequiredRule$1) return rule$1;
			hasRequiredRule$1 = 1;
			let Container = requireContainer$1();
			let list = requireList$1();
			class Rule extends Container {
				constructor(defaults) {
					super(defaults);
					this.type = "rule";
					if (!this.nodes) this.nodes = [];
				}
				get selectors() {
					return list.comma(this.selector);
				}
				set selectors(values) {
					let match = this.selector ? this.selector.match(/,\s*/) : null;
					let sep = match ? match[0] : "," + this.raw("between", "beforeOpen");
					this.selector = values.join(sep);
				}
			}
			rule$1 = Rule;
			Rule.default = Rule;
			Container.registerRule(Rule);
			return rule$1;
		}
		function requireParser$1() {
			if (hasRequiredParser$1) return parser$1;
			hasRequiredParser$1 = 1;
			let Declaration = requireDeclaration$1();
			let tokenizer = requireTokenize$1();
			let Comment = requireComment$1();
			let AtRule = requireAtRule$1();
			let Root = requireRoot$1();
			let Rule = requireRule$1();
			const SAFE_COMMENT_NEIGHBOR = {
				empty: true,
				space: true
			};
			function findLastWithPosition(tokens) {
				for (let i2 = tokens.length - 1; i2 >= 0; i2--) {
					let token = tokens[i2];
					let pos = token[3] || token[2];
					if (pos) return pos;
				}
			}
			class Parser {
				constructor(input2) {
					this.input = input2;
					this.root = new Root();
					this.current = this.root;
					this.spaces = "";
					this.semicolon = false;
					this.createTokenizer();
					this.root.source = {
						input: input2,
						start: {
							column: 1,
							line: 1,
							offset: 0
						}
					};
				}
				atrule(token) {
					let node2 = new AtRule();
					node2.name = token[1].slice(1);
					if (node2.name === "") this.unnamedAtrule(node2, token);
					this.init(node2, token[2]);
					let type;
					let prev;
					let shift;
					let last = false;
					let open = false;
					let params = [];
					let brackets = [];
					while (!this.tokenizer.endOfFile()) {
						token = this.tokenizer.nextToken();
						type = token[0];
						if (type === "(" || type === "[") brackets.push(type === "(" ? ")" : "]");
						else if (type === "{" && brackets.length > 0) brackets.push("}");
						else if (type === brackets[brackets.length - 1]) brackets.pop();
						if (brackets.length === 0) if (type === ";") {
							node2.source.end = this.getPosition(token[2]);
							node2.source.end.offset++;
							this.semicolon = true;
							break;
						} else if (type === "{") {
							open = true;
							break;
						} else if (type === "}") {
							if (params.length > 0) {
								shift = params.length - 1;
								prev = params[shift];
								while (prev && prev[0] === "space") prev = params[--shift];
								if (prev) {
									node2.source.end = this.getPosition(prev[3] || prev[2]);
									node2.source.end.offset++;
								}
							}
							this.end(token);
							break;
						} else params.push(token);
						else params.push(token);
						if (this.tokenizer.endOfFile()) {
							last = true;
							break;
						}
					}
					node2.raws.between = this.spacesAndCommentsFromEnd(params);
					if (params.length) {
						node2.raws.afterName = this.spacesAndCommentsFromStart(params);
						this.raw(node2, "params", params);
						if (last) {
							token = params[params.length - 1];
							node2.source.end = this.getPosition(token[3] || token[2]);
							node2.source.end.offset++;
							this.spaces = node2.raws.between;
							node2.raws.between = "";
						}
					} else {
						node2.raws.afterName = "";
						node2.params = "";
					}
					if (open) {
						node2.nodes = [];
						this.current = node2;
					}
				}
				checkMissedSemicolon(tokens) {
					let colon = this.colon(tokens);
					if (colon === false) return;
					let founded = 0;
					let token;
					for (let j = colon - 1; j >= 0; j--) {
						token = tokens[j];
						if (token[0] !== "space") {
							founded += 1;
							if (founded === 2) break;
						}
					}
					throw this.input.error("Missed semicolon", token[0] === "word" ? token[3] + 1 : token[2]);
				}
				colon(tokens) {
					let brackets = 0;
					let token, type, prev;
					for (let [i2, element] of tokens.entries()) {
						token = element;
						type = token[0];
						if (type === "(") brackets += 1;
						if (type === ")") brackets -= 1;
						if (brackets === 0 && type === ":") if (!prev) this.doubleColon(token);
						else if (prev[0] === "word" && prev[1] === "progid") continue;
						else return i2;
						prev = token;
					}
					return false;
				}
				comment(token) {
					let node2 = new Comment();
					this.init(node2, token[2]);
					node2.source.end = this.getPosition(token[3] || token[2]);
					node2.source.end.offset++;
					let text = token[1].slice(2, -2);
					if (/^\s*$/.test(text)) {
						node2.text = "";
						node2.raws.left = text;
						node2.raws.right = "";
					} else {
						let match = text.match(/^(\s*)([^]*\S)(\s*)$/);
						node2.text = match[2];
						node2.raws.left = match[1];
						node2.raws.right = match[3];
					}
				}
				createTokenizer() {
					this.tokenizer = tokenizer(this.input);
				}
				decl(tokens, customProperty) {
					let node2 = new Declaration();
					this.init(node2, tokens[0][2]);
					let last = tokens[tokens.length - 1];
					if (last[0] === ";") {
						this.semicolon = true;
						tokens.pop();
					}
					node2.source.end = this.getPosition(last[3] || last[2] || findLastWithPosition(tokens));
					node2.source.end.offset++;
					while (tokens[0][0] !== "word") {
						if (tokens.length === 1) this.unknownWord(tokens);
						node2.raws.before += tokens.shift()[1];
					}
					node2.source.start = this.getPosition(tokens[0][2]);
					node2.prop = "";
					while (tokens.length) {
						let type = tokens[0][0];
						if (type === ":" || type === "space" || type === "comment") break;
						node2.prop += tokens.shift()[1];
					}
					node2.raws.between = "";
					let token;
					while (tokens.length) {
						token = tokens.shift();
						if (token[0] === ":") {
							node2.raws.between += token[1];
							break;
						} else {
							if (token[0] === "word" && /\w/.test(token[1])) this.unknownWord([token]);
							node2.raws.between += token[1];
						}
					}
					if (node2.prop[0] === "_" || node2.prop[0] === "*") {
						node2.raws.before += node2.prop[0];
						node2.prop = node2.prop.slice(1);
					}
					let firstSpaces = [];
					let next;
					while (tokens.length) {
						next = tokens[0][0];
						if (next !== "space" && next !== "comment") break;
						firstSpaces.push(tokens.shift());
					}
					this.precheckMissedSemicolon(tokens);
					for (let i2 = tokens.length - 1; i2 >= 0; i2--) {
						token = tokens[i2];
						if (token[1].toLowerCase() === "!important") {
							node2.important = true;
							let string = this.stringFrom(tokens, i2);
							string = this.spacesFromEnd(tokens) + string;
							if (string !== " !important") node2.raws.important = string;
							break;
						} else if (token[1].toLowerCase() === "important") {
							let cache = tokens.slice(0);
							let str = "";
							for (let j = i2; j > 0; j--) {
								let type = cache[j][0];
								if (str.trim().indexOf("!") === 0 && type !== "space") break;
								str = cache.pop()[1] + str;
							}
							if (str.trim().indexOf("!") === 0) {
								node2.important = true;
								node2.raws.important = str;
								tokens = cache;
							}
						}
						if (token[0] !== "space" && token[0] !== "comment") break;
					}
					if (tokens.some((i2) => i2[0] !== "space" && i2[0] !== "comment")) {
						node2.raws.between += firstSpaces.map((i2) => i2[1]).join("");
						firstSpaces = [];
					}
					this.raw(node2, "value", firstSpaces.concat(tokens), customProperty);
					if (node2.value.includes(":") && !customProperty) this.checkMissedSemicolon(tokens);
				}
				doubleColon(token) {
					throw this.input.error("Double colon", { offset: token[2] }, { offset: token[2] + token[1].length });
				}
				emptyRule(token) {
					let node2 = new Rule();
					this.init(node2, token[2]);
					node2.selector = "";
					node2.raws.between = "";
					this.current = node2;
				}
				end(token) {
					if (this.current.nodes && this.current.nodes.length) this.current.raws.semicolon = this.semicolon;
					this.semicolon = false;
					this.current.raws.after = (this.current.raws.after || "") + this.spaces;
					this.spaces = "";
					if (this.current.parent) {
						this.current.source.end = this.getPosition(token[2]);
						this.current.source.end.offset++;
						this.current = this.current.parent;
					} else this.unexpectedClose(token);
				}
				endFile() {
					if (this.current.parent) this.unclosedBlock();
					if (this.current.nodes && this.current.nodes.length) this.current.raws.semicolon = this.semicolon;
					this.current.raws.after = (this.current.raws.after || "") + this.spaces;
					this.root.source.end = this.getPosition(this.tokenizer.position());
				}
				freeSemicolon(token) {
					this.spaces += token[1];
					if (this.current.nodes) {
						let prev = this.current.nodes[this.current.nodes.length - 1];
						if (prev && prev.type === "rule" && !prev.raws.ownSemicolon) {
							prev.raws.ownSemicolon = this.spaces;
							this.spaces = "";
						}
					}
				}
				getPosition(offset) {
					let pos = this.input.fromOffset(offset);
					return {
						column: pos.col,
						line: pos.line,
						offset
					};
				}
				init(node2, offset) {
					this.current.push(node2);
					node2.source = {
						input: this.input,
						start: this.getPosition(offset)
					};
					node2.raws.before = this.spaces;
					this.spaces = "";
					if (node2.type !== "comment") this.semicolon = false;
				}
				other(start) {
					let end = false;
					let type = null;
					let colon = false;
					let bracket = null;
					let brackets = [];
					let customProperty = start[1].startsWith("--");
					let tokens = [];
					let token = start;
					while (token) {
						type = token[0];
						tokens.push(token);
						if (type === "(" || type === "[") {
							if (!bracket) bracket = token;
							brackets.push(type === "(" ? ")" : "]");
						} else if (customProperty && colon && type === "{") {
							if (!bracket) bracket = token;
							brackets.push("}");
						} else if (brackets.length === 0) {
							if (type === ";") if (colon) {
								this.decl(tokens, customProperty);
								return;
							} else break;
							else if (type === "{") {
								this.rule(tokens);
								return;
							} else if (type === "}") {
								this.tokenizer.back(tokens.pop());
								end = true;
								break;
							} else if (type === ":") colon = true;
						} else if (type === brackets[brackets.length - 1]) {
							brackets.pop();
							if (brackets.length === 0) bracket = null;
						}
						token = this.tokenizer.nextToken();
					}
					if (this.tokenizer.endOfFile()) end = true;
					if (brackets.length > 0) this.unclosedBracket(bracket);
					if (end && colon) {
						if (!customProperty) while (tokens.length) {
							token = tokens[tokens.length - 1][0];
							if (token !== "space" && token !== "comment") break;
							this.tokenizer.back(tokens.pop());
						}
						this.decl(tokens, customProperty);
					} else this.unknownWord(tokens);
				}
				parse() {
					let token;
					while (!this.tokenizer.endOfFile()) {
						token = this.tokenizer.nextToken();
						switch (token[0]) {
							case "space":
								this.spaces += token[1];
								break;
							case ";":
								this.freeSemicolon(token);
								break;
							case "}":
								this.end(token);
								break;
							case "comment":
								this.comment(token);
								break;
							case "at-word":
								this.atrule(token);
								break;
							case "{":
								this.emptyRule(token);
								break;
							default:
								this.other(token);
								break;
						}
					}
					this.endFile();
				}
				precheckMissedSemicolon() {}
				raw(node2, prop, tokens, customProperty) {
					let token, type;
					let length = tokens.length;
					let value = "";
					let clean = true;
					let next, prev;
					for (let i2 = 0; i2 < length; i2 += 1) {
						token = tokens[i2];
						type = token[0];
						if (type === "space" && i2 === length - 1 && !customProperty) clean = false;
						else if (type === "comment") {
							prev = tokens[i2 - 1] ? tokens[i2 - 1][0] : "empty";
							next = tokens[i2 + 1] ? tokens[i2 + 1][0] : "empty";
							if (!SAFE_COMMENT_NEIGHBOR[prev] && !SAFE_COMMENT_NEIGHBOR[next]) if (value.slice(-1) === ",") clean = false;
							else value += token[1];
							else clean = false;
						} else value += token[1];
					}
					if (!clean) {
						let raw = tokens.reduce((all, i2) => all + i2[1], "");
						node2.raws[prop] = {
							raw,
							value
						};
					}
					node2[prop] = value;
				}
				rule(tokens) {
					tokens.pop();
					let node2 = new Rule();
					this.init(node2, tokens[0][2]);
					node2.raws.between = this.spacesAndCommentsFromEnd(tokens);
					this.raw(node2, "selector", tokens);
					this.current = node2;
				}
				spacesAndCommentsFromEnd(tokens) {
					let lastTokenType;
					let spaces = "";
					while (tokens.length) {
						lastTokenType = tokens[tokens.length - 1][0];
						if (lastTokenType !== "space" && lastTokenType !== "comment") break;
						spaces = tokens.pop()[1] + spaces;
					}
					return spaces;
				}
				spacesAndCommentsFromStart(tokens) {
					let next;
					let spaces = "";
					while (tokens.length) {
						next = tokens[0][0];
						if (next !== "space" && next !== "comment") break;
						spaces += tokens.shift()[1];
					}
					return spaces;
				}
				spacesFromEnd(tokens) {
					let lastTokenType;
					let spaces = "";
					while (tokens.length) {
						lastTokenType = tokens[tokens.length - 1][0];
						if (lastTokenType !== "space") break;
						spaces = tokens.pop()[1] + spaces;
					}
					return spaces;
				}
				stringFrom(tokens, from) {
					let result2 = "";
					for (let i2 = from; i2 < tokens.length; i2++) result2 += tokens[i2][1];
					tokens.splice(from, tokens.length - from);
					return result2;
				}
				unclosedBlock() {
					let pos = this.current.source.start;
					throw this.input.error("Unclosed block", pos.line, pos.column);
				}
				unclosedBracket(bracket) {
					throw this.input.error("Unclosed bracket", { offset: bracket[2] }, { offset: bracket[2] + 1 });
				}
				unexpectedClose(token) {
					throw this.input.error("Unexpected }", { offset: token[2] }, { offset: token[2] + 1 });
				}
				unknownWord(tokens) {
					throw this.input.error("Unknown word", { offset: tokens[0][2] }, { offset: tokens[0][2] + tokens[0][1].length });
				}
				unnamedAtrule(node2, token) {
					throw this.input.error("At-rule without name", { offset: token[2] }, { offset: token[2] + token[1].length });
				}
			}
			parser$1 = Parser;
			return parser$1;
		}
		function requireParse$1() {
			if (hasRequiredParse$1) return parse_1$1;
			hasRequiredParse$1 = 1;
			let Container = requireContainer$1();
			let Parser = requireParser$1();
			let Input = requireInput$1();
			function parse(css, opts) {
				let input2 = new Input(css, opts);
				let parser2 = new Parser(input2);
				try {
					parser2.parse();
				} catch (e2) {
					throw e2;
				}
				return parser2.root;
			}
			parse_1$1 = parse;
			parse.default = parse;
			Container.registerParse(parse);
			return parse_1$1;
		}
		function requireLazyResult$1() {
			if (hasRequiredLazyResult$1) return lazyResult$1;
			hasRequiredLazyResult$1 = 1;
			let { isClean, my } = requireSymbols$1();
			let MapGenerator = requireMapGenerator$1();
			let stringify = requireStringify$1();
			let Container = requireContainer$1();
			let Document2 = requireDocument$1();
			requireWarnOnce$1();
			let Result = requireResult$1();
			let parse = requireParse$1();
			let Root = requireRoot$1();
			const TYPE_TO_CLASS_NAME = {
				atrule: "AtRule",
				comment: "Comment",
				decl: "Declaration",
				document: "Document",
				root: "Root",
				rule: "Rule"
			};
			const PLUGIN_PROPS = {
				AtRule: true,
				AtRuleExit: true,
				Comment: true,
				CommentExit: true,
				Declaration: true,
				DeclarationExit: true,
				Document: true,
				DocumentExit: true,
				Once: true,
				OnceExit: true,
				postcssPlugin: true,
				prepare: true,
				Root: true,
				RootExit: true,
				Rule: true,
				RuleExit: true
			};
			const NOT_VISITORS = {
				Once: true,
				postcssPlugin: true,
				prepare: true
			};
			const CHILDREN = 0;
			function isPromise(obj) {
				return typeof obj === "object" && typeof obj.then === "function";
			}
			function getEvents(node2) {
				let key = false;
				let type = TYPE_TO_CLASS_NAME[node2.type];
				if (node2.type === "decl") key = node2.prop.toLowerCase();
				else if (node2.type === "atrule") key = node2.name.toLowerCase();
				if (key && node2.append) return [
					type,
					type + "-" + key,
					CHILDREN,
					type + "Exit",
					type + "Exit-" + key
				];
				else if (key) return [
					type,
					type + "-" + key,
					type + "Exit",
					type + "Exit-" + key
				];
				else if (node2.append) return [
					type,
					CHILDREN,
					type + "Exit"
				];
				else return [type, type + "Exit"];
			}
			function toStack(node2) {
				let events;
				if (node2.type === "document") events = [
					"Document",
					CHILDREN,
					"DocumentExit"
				];
				else if (node2.type === "root") events = [
					"Root",
					CHILDREN,
					"RootExit"
				];
				else events = getEvents(node2);
				return {
					eventIndex: 0,
					events,
					iterator: 0,
					node: node2,
					visitorIndex: 0,
					visitors: []
				};
			}
			function cleanMarks(node2) {
				node2[isClean] = false;
				if (node2.nodes) node2.nodes.forEach((i2) => cleanMarks(i2));
				return node2;
			}
			let postcss2 = {};
			class LazyResult {
				constructor(processor2, css, opts) {
					this.stringified = false;
					this.processed = false;
					let root2;
					if (typeof css === "object" && css !== null && (css.type === "root" || css.type === "document")) root2 = cleanMarks(css);
					else if (css instanceof LazyResult || css instanceof Result) {
						root2 = cleanMarks(css.root);
						if (css.map) {
							if (typeof opts.map === "undefined") opts.map = {};
							if (!opts.map.inline) opts.map.inline = false;
							opts.map.prev = css.map;
						}
					} else {
						let parser2 = parse;
						if (opts.syntax) parser2 = opts.syntax.parse;
						if (opts.parser) parser2 = opts.parser;
						if (parser2.parse) parser2 = parser2.parse;
						try {
							root2 = parser2(css, opts);
						} catch (error) {
							this.processed = true;
							this.error = error;
						}
						if (root2 && !root2[my]) Container.rebuild(root2);
					}
					this.result = new Result(processor2, root2, opts);
					this.helpers = {
						...postcss2,
						postcss: postcss2,
						result: this.result
					};
					this.plugins = this.processor.plugins.map((plugin) => {
						if (typeof plugin === "object" && plugin.prepare) return {
							...plugin,
							...plugin.prepare(this.result)
						};
						else return plugin;
					});
				}
				async() {
					if (this.error) return Promise.reject(this.error);
					if (this.processed) return Promise.resolve(this.result);
					if (!this.processing) this.processing = this.runAsync();
					return this.processing;
				}
				catch(onRejected) {
					return this.async().catch(onRejected);
				}
				finally(onFinally) {
					return this.async().then(onFinally, onFinally);
				}
				getAsyncError() {
					throw new Error("Use process(css).then(cb) to work with async plugins");
				}
				handleError(error, node2) {
					let plugin = this.result.lastPlugin;
					try {
						if (node2) node2.addToError(error);
						this.error = error;
						if (error.name === "CssSyntaxError" && !error.plugin) {
							error.plugin = plugin.postcssPlugin;
							error.setMessage();
						} else if (plugin.postcssVersion) {}
					} catch (err) {
						if (console && console.error) console.error(err);
					}
					return error;
				}
				prepareVisitors() {
					this.listeners = {};
					let add = (plugin, type, cb) => {
						if (!this.listeners[type]) this.listeners[type] = [];
						this.listeners[type].push([plugin, cb]);
					};
					for (let plugin of this.plugins) if (typeof plugin === "object") for (let event in plugin) {
						if (!PLUGIN_PROPS[event] && /^[A-Z]/.test(event)) throw new Error(`Unknown event ${event} in ${plugin.postcssPlugin}. Try to update PostCSS (${this.processor.version} now).`);
						if (!NOT_VISITORS[event]) {
							if (typeof plugin[event] === "object") for (let filter in plugin[event]) if (filter === "*") add(plugin, event, plugin[event][filter]);
							else add(plugin, event + "-" + filter.toLowerCase(), plugin[event][filter]);
							else if (typeof plugin[event] === "function") add(plugin, event, plugin[event]);
						}
					}
					this.hasListener = Object.keys(this.listeners).length > 0;
				}
				async runAsync() {
					this.plugin = 0;
					for (let i2 = 0; i2 < this.plugins.length; i2++) {
						let plugin = this.plugins[i2];
						let promise = this.runOnRoot(plugin);
						if (isPromise(promise)) try {
							await promise;
						} catch (error) {
							throw this.handleError(error);
						}
					}
					this.prepareVisitors();
					if (this.hasListener) {
						let root2 = this.result.root;
						while (!root2[isClean]) {
							root2[isClean] = true;
							let stack = [toStack(root2)];
							while (stack.length > 0) {
								let promise = this.visitTick(stack);
								if (isPromise(promise)) try {
									await promise;
								} catch (e2) {
									let node2 = stack[stack.length - 1].node;
									throw this.handleError(e2, node2);
								}
							}
						}
						if (this.listeners.OnceExit) for (let [plugin, visitor] of this.listeners.OnceExit) {
							this.result.lastPlugin = plugin;
							try {
								if (root2.type === "document") {
									let roots = root2.nodes.map((subRoot) => visitor(subRoot, this.helpers));
									await Promise.all(roots);
								} else await visitor(root2, this.helpers);
							} catch (e2) {
								throw this.handleError(e2);
							}
						}
					}
					this.processed = true;
					return this.stringify();
				}
				runOnRoot(plugin) {
					this.result.lastPlugin = plugin;
					try {
						if (typeof plugin === "object" && plugin.Once) {
							if (this.result.root.type === "document") {
								let roots = this.result.root.nodes.map((root2) => plugin.Once(root2, this.helpers));
								if (isPromise(roots[0])) return Promise.all(roots);
								return roots;
							}
							return plugin.Once(this.result.root, this.helpers);
						} else if (typeof plugin === "function") return plugin(this.result.root, this.result);
					} catch (error) {
						throw this.handleError(error);
					}
				}
				stringify() {
					if (this.error) throw this.error;
					if (this.stringified) return this.result;
					this.stringified = true;
					this.sync();
					let opts = this.result.opts;
					let str = stringify;
					if (opts.syntax) str = opts.syntax.stringify;
					if (opts.stringifier) str = opts.stringifier;
					if (str.stringify) str = str.stringify;
					let data = new MapGenerator(str, this.result.root, this.result.opts).generate();
					this.result.css = data[0];
					this.result.map = data[1];
					return this.result;
				}
				sync() {
					if (this.error) throw this.error;
					if (this.processed) return this.result;
					this.processed = true;
					if (this.processing) throw this.getAsyncError();
					for (let plugin of this.plugins) if (isPromise(this.runOnRoot(plugin))) throw this.getAsyncError();
					this.prepareVisitors();
					if (this.hasListener) {
						let root2 = this.result.root;
						while (!root2[isClean]) {
							root2[isClean] = true;
							this.walkSync(root2);
						}
						if (this.listeners.OnceExit) if (root2.type === "document") for (let subRoot of root2.nodes) this.visitSync(this.listeners.OnceExit, subRoot);
						else this.visitSync(this.listeners.OnceExit, root2);
					}
					return this.result;
				}
				then(onFulfilled, onRejected) {
					return this.async().then(onFulfilled, onRejected);
				}
				toString() {
					return this.css;
				}
				visitSync(visitors, node2) {
					for (let [plugin, visitor] of visitors) {
						this.result.lastPlugin = plugin;
						let promise;
						try {
							promise = visitor(node2, this.helpers);
						} catch (e2) {
							throw this.handleError(e2, node2.proxyOf);
						}
						if (node2.type !== "root" && node2.type !== "document" && !node2.parent) return true;
						if (isPromise(promise)) throw this.getAsyncError();
					}
				}
				visitTick(stack) {
					let visit2 = stack[stack.length - 1];
					let { node: node2, visitors } = visit2;
					if (node2.type !== "root" && node2.type !== "document" && !node2.parent) {
						stack.pop();
						return;
					}
					if (visitors.length > 0 && visit2.visitorIndex < visitors.length) {
						let [plugin, visitor] = visitors[visit2.visitorIndex];
						visit2.visitorIndex += 1;
						if (visit2.visitorIndex === visitors.length) {
							visit2.visitors = [];
							visit2.visitorIndex = 0;
						}
						this.result.lastPlugin = plugin;
						try {
							return visitor(node2.toProxy(), this.helpers);
						} catch (e2) {
							throw this.handleError(e2, node2);
						}
					}
					if (visit2.iterator !== 0) {
						let iterator = visit2.iterator;
						let child;
						while (child = node2.nodes[node2.indexes[iterator]]) {
							node2.indexes[iterator] += 1;
							if (!child[isClean]) {
								child[isClean] = true;
								stack.push(toStack(child));
								return;
							}
						}
						visit2.iterator = 0;
						delete node2.indexes[iterator];
					}
					let events = visit2.events;
					while (visit2.eventIndex < events.length) {
						let event = events[visit2.eventIndex];
						visit2.eventIndex += 1;
						if (event === CHILDREN) {
							if (node2.nodes && node2.nodes.length) {
								node2[isClean] = true;
								visit2.iterator = node2.getIterator();
							}
							return;
						} else if (this.listeners[event]) {
							visit2.visitors = this.listeners[event];
							return;
						}
					}
					stack.pop();
				}
				walkSync(node2) {
					node2[isClean] = true;
					let events = getEvents(node2);
					for (let event of events) if (event === CHILDREN) {
						if (node2.nodes) node2.each((child) => {
							if (!child[isClean]) this.walkSync(child);
						});
					} else {
						let visitors = this.listeners[event];
						if (visitors) {
							if (this.visitSync(visitors, node2.toProxy())) return;
						}
					}
				}
				warnings() {
					return this.sync().warnings();
				}
				get content() {
					return this.stringify().content;
				}
				get css() {
					return this.stringify().css;
				}
				get map() {
					return this.stringify().map;
				}
				get messages() {
					return this.sync().messages;
				}
				get opts() {
					return this.result.opts;
				}
				get processor() {
					return this.result.processor;
				}
				get root() {
					return this.sync().root;
				}
				get [Symbol.toStringTag]() {
					return "LazyResult";
				}
			}
			LazyResult.registerPostcss = (dependant) => {
				postcss2 = dependant;
			};
			lazyResult$1 = LazyResult;
			LazyResult.default = LazyResult;
			Root.registerLazyResult(LazyResult);
			Document2.registerLazyResult(LazyResult);
			return lazyResult$1;
		}
		function requireNoWorkResult$1() {
			if (hasRequiredNoWorkResult$1) return noWorkResult$1;
			hasRequiredNoWorkResult$1 = 1;
			let MapGenerator = requireMapGenerator$1();
			let stringify = requireStringify$1();
			requireWarnOnce$1();
			let parse = requireParse$1();
			const Result = requireResult$1();
			class NoWorkResult {
				constructor(processor2, css, opts) {
					css = css.toString();
					this.stringified = false;
					this._processor = processor2;
					this._css = css;
					this._opts = opts;
					this._map = void 0;
					let root2;
					let str = stringify;
					this.result = new Result(this._processor, root2, this._opts);
					this.result.css = css;
					let self2 = this;
					Object.defineProperty(this.result, "root", { get() {
						return self2.root;
					} });
					let map = new MapGenerator(str, root2, this._opts, css);
					if (map.isMap()) {
						let [generatedCSS, generatedMap] = map.generate();
						if (generatedCSS) this.result.css = generatedCSS;
						if (generatedMap) this.result.map = generatedMap;
					} else {
						map.clearAnnotation();
						this.result.css = map.css;
					}
				}
				async() {
					if (this.error) return Promise.reject(this.error);
					return Promise.resolve(this.result);
				}
				catch(onRejected) {
					return this.async().catch(onRejected);
				}
				finally(onFinally) {
					return this.async().then(onFinally, onFinally);
				}
				sync() {
					if (this.error) throw this.error;
					return this.result;
				}
				then(onFulfilled, onRejected) {
					return this.async().then(onFulfilled, onRejected);
				}
				toString() {
					return this._css;
				}
				warnings() {
					return [];
				}
				get content() {
					return this.result.css;
				}
				get css() {
					return this.result.css;
				}
				get map() {
					return this.result.map;
				}
				get messages() {
					return [];
				}
				get opts() {
					return this.result.opts;
				}
				get processor() {
					return this.result.processor;
				}
				get root() {
					if (this._root) return this._root;
					let root2;
					let parser2 = parse;
					try {
						root2 = parser2(this._css, this._opts);
					} catch (error) {
						this.error = error;
					}
					if (this.error) throw this.error;
					else {
						this._root = root2;
						return root2;
					}
				}
				get [Symbol.toStringTag]() {
					return "NoWorkResult";
				}
			}
			noWorkResult$1 = NoWorkResult;
			NoWorkResult.default = NoWorkResult;
			return noWorkResult$1;
		}
		function requireProcessor$1() {
			if (hasRequiredProcessor$1) return processor$1;
			hasRequiredProcessor$1 = 1;
			let NoWorkResult = requireNoWorkResult$1();
			let LazyResult = requireLazyResult$1();
			let Document2 = requireDocument$1();
			let Root = requireRoot$1();
			class Processor {
				constructor(plugins = []) {
					this.version = "8.4.38";
					this.plugins = this.normalize(plugins);
				}
				normalize(plugins) {
					let normalized = [];
					for (let i2 of plugins) {
						if (i2.postcss === true) i2 = i2();
						else if (i2.postcss) i2 = i2.postcss;
						if (typeof i2 === "object" && Array.isArray(i2.plugins)) normalized = normalized.concat(i2.plugins);
						else if (typeof i2 === "object" && i2.postcssPlugin) normalized.push(i2);
						else if (typeof i2 === "function") normalized.push(i2);
						else if (typeof i2 === "object" && (i2.parse || i2.stringify)) {} else throw new Error(i2 + " is not a PostCSS plugin");
					}
					return normalized;
				}
				process(css, opts = {}) {
					if (!this.plugins.length && !opts.parser && !opts.stringifier && !opts.syntax) return new NoWorkResult(this, css, opts);
					else return new LazyResult(this, css, opts);
				}
				use(plugin) {
					this.plugins = this.plugins.concat(this.normalize([plugin]));
					return this;
				}
			}
			processor$1 = Processor;
			Processor.default = Processor;
			Root.registerProcessor(Processor);
			Document2.registerProcessor(Processor);
			return processor$1;
		}
		function requireFromJSON$1() {
			if (hasRequiredFromJSON$1) return fromJSON_1$1;
			hasRequiredFromJSON$1 = 1;
			let Declaration = requireDeclaration$1();
			let PreviousMap = requirePreviousMap$1();
			let Comment = requireComment$1();
			let AtRule = requireAtRule$1();
			let Input = requireInput$1();
			let Root = requireRoot$1();
			let Rule = requireRule$1();
			function fromJSON(json, inputs) {
				if (Array.isArray(json)) return json.map((n2) => fromJSON(n2));
				let { inputs: ownInputs, ...defaults } = json;
				if (ownInputs) {
					inputs = [];
					for (let input2 of ownInputs) {
						let inputHydrated = {
							...input2,
							__proto__: Input.prototype
						};
						if (inputHydrated.map) inputHydrated.map = {
							...inputHydrated.map,
							__proto__: PreviousMap.prototype
						};
						inputs.push(inputHydrated);
					}
				}
				if (defaults.nodes) defaults.nodes = json.nodes.map((n2) => fromJSON(n2, inputs));
				if (defaults.source) {
					let { inputId, ...source } = defaults.source;
					defaults.source = source;
					if (inputId != null) defaults.source.input = inputs[inputId];
				}
				if (defaults.type === "root") return new Root(defaults);
				else if (defaults.type === "decl") return new Declaration(defaults);
				else if (defaults.type === "rule") return new Rule(defaults);
				else if (defaults.type === "comment") return new Comment(defaults);
				else if (defaults.type === "atrule") return new AtRule(defaults);
				else throw new Error("Unknown node type: " + json.type);
			}
			fromJSON_1$1 = fromJSON;
			fromJSON.default = fromJSON;
			return fromJSON_1$1;
		}
		function requirePostcss$1() {
			if (hasRequiredPostcss$1) return postcss_1$1;
			hasRequiredPostcss$1 = 1;
			let CssSyntaxError = requireCssSyntaxError$1();
			let Declaration = requireDeclaration$1();
			let LazyResult = requireLazyResult$1();
			let Container = requireContainer$1();
			let Processor = requireProcessor$1();
			let stringify = requireStringify$1();
			let fromJSON = requireFromJSON$1();
			let Document2 = requireDocument$1();
			let Warning = requireWarning$1();
			let Comment = requireComment$1();
			let AtRule = requireAtRule$1();
			let Result = requireResult$1();
			let Input = requireInput$1();
			let parse = requireParse$1();
			let list = requireList$1();
			let Rule = requireRule$1();
			let Root = requireRoot$1();
			let Node2 = requireNode$1();
			function postcss2(...plugins) {
				if (plugins.length === 1 && Array.isArray(plugins[0])) plugins = plugins[0];
				return new Processor(plugins);
			}
			postcss2.plugin = function plugin(name, initializer) {
				let warningPrinted = false;
				function creator(...args) {
					if (console && console.warn && !warningPrinted) {
						warningPrinted = true;
						console.warn(name + ": postcss.plugin was deprecated. Migration guide:\nhttps://evilmartians.com/chronicles/postcss-8-plugin-migration");
						if (process.env.LANG && process.env.LANG.startsWith("cn")) console.warn(name + ": 里面 postcss.plugin 被弃用. 迁移指南:\nhttps://www.w3ctech.com/topic/2226");
					}
					let transformer = initializer(...args);
					transformer.postcssPlugin = name;
					transformer.postcssVersion = new Processor().version;
					return transformer;
				}
				let cache;
				Object.defineProperty(creator, "postcss", { get() {
					if (!cache) cache = creator();
					return cache;
				} });
				creator.process = function(css, processOpts, pluginOpts) {
					return postcss2([creator(pluginOpts)]).process(css, processOpts);
				};
				return creator;
			};
			postcss2.stringify = stringify;
			postcss2.parse = parse;
			postcss2.fromJSON = fromJSON;
			postcss2.list = list;
			postcss2.comment = (defaults) => new Comment(defaults);
			postcss2.atRule = (defaults) => new AtRule(defaults);
			postcss2.decl = (defaults) => new Declaration(defaults);
			postcss2.rule = (defaults) => new Rule(defaults);
			postcss2.root = (defaults) => new Root(defaults);
			postcss2.document = (defaults) => new Document2(defaults);
			postcss2.CssSyntaxError = CssSyntaxError;
			postcss2.Declaration = Declaration;
			postcss2.Container = Container;
			postcss2.Processor = Processor;
			postcss2.Document = Document2;
			postcss2.Comment = Comment;
			postcss2.Warning = Warning;
			postcss2.AtRule = AtRule;
			postcss2.Result = Result;
			postcss2.Input = Input;
			postcss2.Rule = Rule;
			postcss2.Root = Root;
			postcss2.Node = Node2;
			LazyResult.registerPostcss(postcss2);
			postcss_1$1 = postcss2;
			postcss2.default = postcss2;
			return postcss_1$1;
		}
		function getTagName(n2) {
			let tagName = tagMap[n2.tagName] ? tagMap[n2.tagName] : n2.tagName;
			if (tagName === "link" && n2.attributes._cssText) tagName = "style";
			return tagName;
		}
		function adaptCssForReplay(cssText, cache) {
			const cachedStyle = cache == null ? void 0 : cache.stylesWithHoverClass.get(cssText);
			if (cachedStyle) return cachedStyle;
			let result2 = cssText;
			try {
				result2 = postcss$1([mediaSelectorPlugin, pseudoClassPlugin]).process(cssText).css;
			} catch (error) {
				console.warn("Failed to adapt css for replay", error);
			}
			cache?.stylesWithHoverClass.set(cssText, result2);
			return result2;
		}
		function createCache() {
			return { stylesWithHoverClass: /* @__PURE__ */ new Map() };
		}
		function isSupportedSandboxedIframe(frameElement) {
			if (!frameElement || frameElement.tagName !== "IFRAME") return false;
			if (!("sandbox" in frameElement)) return false;
			const sandboxTokens = Array.from(frameElement.sandbox);
			return sandboxTokens.length === 1 && sandboxTokens[0] === "allow-same-origin";
		}
		function assertRebuildTargetAllowed(options) {
			if (options.UNSAFE_allowUnprotectedRebuild) return;
			const win = options.doc.defaultView;
			if (!win) return;
			if (sandboxedRebuildDocuments.has(options.doc) && isSupportedSandboxedIframe(win.frameElement)) return;
			throw new Error(REBUILD_TARGET_ERROR);
		}
		function applyCssSplits(n2, cssText, hackCss, cache) {
			const childTextNodes = [];
			for (const scn of n2.childNodes) if (scn.type === NodeType$3.Text) childTextNodes.push(scn);
			const cssTextSplits = cssText.split("/* rr_split */");
			while (cssTextSplits.length > 1 && cssTextSplits.length > childTextNodes.length) cssTextSplits.splice(-2, 2, cssTextSplits.slice(-2).join(""));
			let adaptedCss = "";
			if (hackCss) adaptedCss = adaptCssForReplay(cssTextSplits.join(""), cache);
			let startIndex = 0;
			let errorOffset = -1;
			for (let i2 = 0; i2 < childTextNodes.length; i2++) {
				if (i2 === cssTextSplits.length) break;
				const childTextNode = childTextNodes[i2];
				let cssTextSection = cssTextSplits[i2];
				const nextTextSection = i2 < cssTextSplits.length - 1 ? cssTextSplits[i2 + 1] : null;
				if (hackCss && nextTextSection) {
					let endIndex = startIndex;
					let endSearch = nextTextSection.length;
					endSearch = Math.min(endSearch, 30);
					let found = false;
					for (; endSearch > 2; endSearch--) {
						const searchBit = nextTextSection.substring(0, endSearch);
						const searchIndex = adaptedCss.substring(startIndex).indexOf(searchBit);
						found = searchIndex !== -1;
						if (found) {
							endIndex += searchIndex;
							break;
						}
					}
					if (!found) endIndex += cssTextSection.length;
					cssTextSection = adaptedCss.substring(startIndex, endIndex);
					startIndex = endIndex;
				} else if (hackCss) cssTextSection = adaptedCss.substring(startIndex);
				if (errorOffset !== -1) cssTextSection = cssTextSection.substring(errorOffset);
				if (nextTextSection && (errorOffset !== -1 || cssTextSection.endsWith("0p") && nextTextSection.startsWith("x"))) {
					errorOffset = nextTextSection.indexOf("}");
					if (errorOffset !== -1) {
						errorOffset += 1;
						cssTextSection += nextTextSection.substring(0, errorOffset);
					}
				}
				childTextNode.textContent = cssTextSection;
			}
		}
		function buildStyleNode(n2, styleEl, cssText, options) {
			const { doc, hackCss, cache } = options;
			if (n2.childNodes.length) applyCssSplits(n2, cssText, hackCss, cache);
			else {
				if (hackCss) cssText = adaptCssForReplay(cssText, cache);
				styleEl.appendChild(doc.createTextNode(cssText));
			}
		}
		function buildNode(n2, options) {
			var _a2;
			const { doc, hackCss, cache } = options;
			switch (n2.type) {
				case NodeType$3.Document: return doc.implementation.createDocument(null, "", null);
				case NodeType$3.DocumentType: return doc.implementation.createDocumentType(n2.name || "html", n2.publicId, n2.systemId);
				case NodeType$3.Element: {
					const tagName = getTagName(n2);
					let node2;
					if (n2.isSVG) node2 = doc.createElementNS("http://www.w3.org/2000/svg", tagName);
					else {
						if (n2.isCustom && ((_a2 = doc.defaultView) == null ? void 0 : _a2.customElements) && !doc.defaultView.customElements.get(n2.tagName)) doc.defaultView.customElements.define(n2.tagName, class extends doc.defaultView.HTMLElement {});
						node2 = doc.createElement(tagName);
					}
					const specialAttributes = {};
					for (const name in n2.attributes) {
						if (!Object.prototype.hasOwnProperty.call(n2.attributes, name)) continue;
						let value = n2.attributes[name];
						if (tagName === "option" && name === "selected" && value === false) continue;
						if (value === null) continue;
						if (value === true) value = "";
						if (name.startsWith("rr_")) {
							specialAttributes[name] = value;
							continue;
						}
						if (typeof value !== "string");
						else if (tagName === "style" && name === "_cssText") {
							buildStyleNode(n2, node2, value, options);
							continue;
						} else if (tagName === "textarea" && name === "value") {
							node2.appendChild(doc.createTextNode(value));
							n2.childNodes = [];
							continue;
						}
						try {
							if (n2.isSVG && name === "xlink:href") node2.setAttributeNS("http://www.w3.org/1999/xlink", name, value.toString());
							else if (name === "onload" || name === "onclick" || name.substring(0, 7) === "onmouse") node2.setAttribute("_" + name, value.toString());
							else if (tagName === "meta" && n2.attributes["http-equiv"] === "Content-Security-Policy" && name === "content") {
								node2.setAttribute("csp-content", value.toString());
								continue;
							} else if (tagName === "link" && (n2.attributes.rel === "preload" && n2.attributes.as === "script" || n2.attributes.rel === "modulepreload")) {} else if (tagName === "link" && n2.attributes.rel === "prefetch" && typeof n2.attributes.href === "string" && extractFileExtension(n2.attributes.href) === "js") {} else if (tagName === "img" && n2.attributes.srcset && n2.attributes.rr_dataURL) node2.setAttribute("rrweb-original-srcset", n2.attributes.srcset);
							else node2.setAttribute(name, value.toString());
						} catch (error) {}
					}
					for (const name in specialAttributes) {
						const value = specialAttributes[name];
						if (tagName === "canvas" && name === "rr_dataURL") {
							const image = doc.createElement("img");
							image.onload = () => {
								const ctx = node2.getContext("2d");
								if (ctx) ctx.drawImage(image, 0, 0, image.width, image.height);
							};
							image.src = value.toString();
							if (node2.RRNodeType) node2.rr_dataURL = value.toString();
						} else if (tagName === "img" && name === "rr_dataURL") {
							const image = node2;
							if (!image.currentSrc.startsWith("data:")) {
								image.setAttribute("rrweb-original-src", n2.attributes.src);
								image.src = value.toString();
							}
						}
						if (name === "rr_width") node2.style.setProperty("width", value.toString());
						else if (name === "rr_height") node2.style.setProperty("height", value.toString());
						else if (name === "rr_mediaCurrentTime" && typeof value === "number") node2.currentTime = value;
						else if (name === "rr_mediaState") switch (value) {
							case "played":
								node2.play().catch((e2) => console.warn("media playback error", e2));
								break;
							case "paused":
								node2.pause();
								break;
						}
						else if (name === "rr_mediaPlaybackRate" && typeof value === "number") node2.playbackRate = value;
						else if (name === "rr_mediaMuted" && typeof value === "boolean") node2.muted = value;
						else if (name === "rr_mediaLoop" && typeof value === "boolean") node2.loop = value;
						else if (name === "rr_mediaVolume" && typeof value === "number") node2.volume = value;
						else if (name === "rr_open_mode") node2.setAttribute("rr_open_mode", value);
					}
					if (n2.isShadowHost) if (!node2.shadowRoot) node2.attachShadow({ mode: "open" });
					else while (node2.shadowRoot.firstChild) node2.shadowRoot.removeChild(node2.shadowRoot.firstChild);
					if (tagName === "input" || tagName === "textarea") node2.setAttribute("autocomplete", "off");
					return node2;
				}
				case NodeType$3.Text:
					if (n2.isStyle && hackCss) return doc.createTextNode(adaptCssForReplay(n2.textContent, cache));
					return doc.createTextNode(n2.textContent);
				case NodeType$3.CDATA: return doc.createCDATASection(n2.textContent);
				case NodeType$3.Comment: return doc.createComment(n2.textContent);
				default: return null;
			}
		}
		function buildNodeWithSN(n2, options) {
			const { doc, mirror: mirror2, skipChild = false, hackCss = true, afterAppend, cache } = options;
			if (mirror2.has(n2.id)) {
				const nodeInMirror = mirror2.getNode(n2.id);
				if (isNodeMetaEqual(mirror2.getMeta(nodeInMirror), n2)) return mirror2.getNode(n2.id);
			}
			let node2 = buildNode(n2, {
				doc,
				hackCss,
				cache
			});
			if (!node2) return null;
			if (n2.rootId && mirror2.getNode(n2.rootId) !== doc) mirror2.replace(n2.rootId, doc);
			if (n2.type === NodeType$3.Document) {
				doc.close();
				doc.open();
				if (n2.compatMode === "BackCompat" && n2.childNodes && n2.childNodes[0].type !== NodeType$3.DocumentType) if (n2.childNodes[0].type === NodeType$3.Element && "xmlns" in n2.childNodes[0].attributes && n2.childNodes[0].attributes.xmlns === "http://www.w3.org/1999/xhtml") doc.write("<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"\">");
				else doc.write("<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.0 Transitional//EN\" \"\">");
				node2 = doc;
			}
			mirror2.add(node2, n2);
			if ((n2.type === NodeType$3.Document || n2.type === NodeType$3.Element) && !skipChild) for (const childN of n2.childNodes) {
				const childNode = buildNodeWithSN(childN, {
					doc,
					mirror: mirror2,
					skipChild: false,
					hackCss,
					afterAppend,
					cache
				});
				if (!childNode) {
					console.warn("Failed to rebuild", childN);
					continue;
				}
				if (childN.isShadow && isElement(node2) && node2.shadowRoot) node2.shadowRoot.appendChild(childNode);
				else if (n2.type === NodeType$3.Document && childN.type == NodeType$3.Element) {
					const htmlElement = childNode;
					let body = null;
					htmlElement.childNodes.forEach((child) => {
						if (child.nodeName === "BODY") body = child;
					});
					if (body) {
						htmlElement.removeChild(body);
						node2.appendChild(childNode);
						htmlElement.appendChild(body);
					} else node2.appendChild(childNode);
				} else node2.appendChild(childNode);
				if (afterAppend) afterAppend(childNode, childN.id);
			}
			return node2;
		}
		function visit(mirror2, onVisit) {
			function walk(node2) {
				onVisit(node2);
			}
			for (const id of mirror2.getIds()) if (mirror2.has(id)) walk(mirror2.getNode(id));
		}
		function handleScroll(node2, mirror2) {
			const n2 = mirror2.getMeta(node2);
			if ((n2 == null ? void 0 : n2.type) !== NodeType$3.Element) return;
			const el = node2;
			for (const name in n2.attributes) {
				if (!(Object.prototype.hasOwnProperty.call(n2.attributes, name) && name.startsWith("rr_"))) continue;
				const value = n2.attributes[name];
				if (name === "rr_scrollLeft") el.scrollLeft = value;
				if (name === "rr_scrollTop") el.scrollTop = value;
			}
		}
		function rebuild(n2, options) {
			assertRebuildTargetAllowed(options);
			const { doc, onVisit, hackCss = true, afterAppend, cache, mirror: mirror2 = new Mirror() } = options;
			const node2 = buildNodeWithSN(n2, {
				doc,
				mirror: mirror2,
				skipChild: false,
				hackCss,
				afterAppend,
				cache
			});
			visit(mirror2, (visitedNode) => {
				if (onVisit) onVisit(visitedNode);
				handleScroll(visitedNode, mirror2);
			});
			return node2;
		}
		function createSandboxedIframe(options) {
			var _a2;
			if (!options.root.isConnected) throw new Error(SANDBOXED_IFRAME_ROOT_ERROR);
			const iframe = options.root.ownerDocument.createElement("iframe");
			for (const [name, value] of Object.entries(options.iframeAttributes || {})) {
				if (name === "sandbox") continue;
				iframe.setAttribute(name, value);
			}
			iframe.setAttribute("sandbox", "allow-same-origin");
			options.root.appendChild(iframe);
			const doc = iframe.contentDocument;
			if (!doc || !iframe.contentWindow) {
				(_a2 = iframe.parentNode) == null || _a2.removeChild(iframe);
				throw new Error(SANDBOXED_IFRAME_ROOT_ERROR);
			}
			sandboxedRebuildDocuments.add(doc);
			return iframe;
		}
		function getUntaintedPrototype$1(key) {
			if (untaintedBasePrototype$1[key]) return untaintedBasePrototype$1[key];
			const defaultObj = globalThis[key];
			const defaultPrototype = defaultObj.prototype;
			const accessorNames = key in testableAccessors$1 ? testableAccessors$1[key] : void 0;
			const isUntaintedAccessors = Boolean(accessorNames && accessorNames.every((accessor) => {
				var _a2, _b;
				return Boolean((_b = (_a2 = Object.getOwnPropertyDescriptor(defaultPrototype, accessor)) == null ? void 0 : _a2.get) == null ? void 0 : _b.toString().includes("[native code]"));
			}));
			const methodNames = key in testableMethods$1 ? testableMethods$1[key] : void 0;
			const isUntaintedMethods = Boolean(methodNames && methodNames.every((method) => {
				var _a2;
				return typeof defaultPrototype[method] === "function" && ((_a2 = defaultPrototype[method]) == null ? void 0 : _a2.toString().includes("[native code]"));
			}));
			if (isUntaintedAccessors && isUntaintedMethods && !isAngularZonePresent$1()) {
				untaintedBasePrototype$1[key] = defaultObj.prototype;
				return defaultObj.prototype;
			}
			try {
				const iframeEl = document.createElement("iframe");
				iframeEl.style.display = "none";
				document.body.appendChild(iframeEl);
				const win = iframeEl.contentWindow;
				if (!win) return defaultObj.prototype;
				const untaintedObject = win[key].prototype;
				if (!untaintedObject) {
					iframeEl.remove();
					return defaultPrototype;
				}
				const ua = navigator.userAgent;
				if (ua.includes("Safari") && !ua.includes("Chrome")) {
					iframeEl.classList.add("rr-block");
					iframeEl.setAttribute("__rrwebUntaintedMutationObserver", "");
					untaintedBaseIframeCleanup$1[key] = () => iframeEl.remove();
				} else iframeEl.remove();
				return untaintedBasePrototype$1[key] = untaintedObject;
			} catch {
				return defaultPrototype;
			}
		}
		function getUntaintedAccessor$1(key, instance, accessor) {
			var _a2, _b;
			const cached = (_a2 = untaintedAccessorCache$1[key]) == null ? void 0 : _a2[accessor];
			if (cached) return cached.call(instance);
			const untaintedPrototype = getUntaintedPrototype$1(key);
			const untaintedAccessor = (_b = Object.getOwnPropertyDescriptor(untaintedPrototype, accessor)) == null ? void 0 : _b.get;
			if (!untaintedAccessor) return instance[accessor];
			(untaintedAccessorCache$1[key] || (untaintedAccessorCache$1[key] = {}))[accessor] = untaintedAccessor;
			return untaintedAccessor.call(instance);
		}
		function getUntaintedMethod$1(key, instance, method) {
			const cacheKey = `${key}.${String(method)}`;
			if (untaintedMethodCache$1[cacheKey]) return untaintedMethodCache$1[cacheKey].bind(instance);
			const untaintedMethod = getUntaintedPrototype$1(key)[method];
			if (typeof untaintedMethod !== "function") return instance[method];
			untaintedMethodCache$1[cacheKey] = untaintedMethod;
			return untaintedMethod.bind(instance);
		}
		function ownerDocument$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "ownerDocument");
		}
		function childNodes$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "childNodes");
		}
		function parentNode$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "parentNode");
		}
		function parentElement$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "parentElement");
		}
		function textContent$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "textContent");
		}
		function firstChild$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "firstChild");
		}
		function lastChild$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "lastChild");
		}
		function nextSibling$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "nextSibling");
		}
		function previousSibling$1(n2) {
			return getUntaintedAccessor$1("Node", n2, "previousSibling");
		}
		function contains$1(n2, other) {
			return getUntaintedMethod$1("Node", n2, "contains")(other);
		}
		function getRootNode$1(n2) {
			return getUntaintedMethod$1("Node", n2, "getRootNode")();
		}
		function host$1(n2) {
			if (!n2 || !("host" in n2)) return null;
			return getUntaintedAccessor$1("ShadowRoot", n2, "host");
		}
		function styleSheets$1(n2) {
			return n2.styleSheets;
		}
		function shadowRoot$1(n2) {
			if (!n2 || !("shadowRoot" in n2)) return null;
			return getUntaintedAccessor$1("Element", n2, "shadowRoot");
		}
		function querySelector$1(n2, selectors) {
			return getUntaintedAccessor$1("Element", n2, "querySelector")(selectors);
		}
		function querySelectorAll$1(n2, selectors) {
			return getUntaintedAccessor$1("Element", n2, "querySelectorAll")(selectors);
		}
		function mutationObserverCtor$1() {
			const prototype = getUntaintedPrototype$1("MutationObserver");
			mutationObserverUsers$1++;
			let stopCalled = false;
			return [prototype.constructor, () => {
				if (stopCalled) return;
				stopCalled = true;
				if (--mutationObserverUsers$1 !== 0) return;
				const cleanup = untaintedBaseIframeCleanup$1["MutationObserver"];
				if (!cleanup) return;
				try {
					cleanup();
				} finally {
					delete untaintedBasePrototype$1["MutationObserver"];
					delete untaintedBaseIframeCleanup$1["MutationObserver"];
				}
			}];
		}
		function patch$1(source, name, replacement) {
			try {
				if (!(name in source)) return () => {};
				const original = source[name];
				const wrapped = replacement(original);
				if (typeof wrapped === "function") {
					wrapped.prototype = wrapped.prototype || {};
					Object.defineProperties(wrapped, { __rrweb_original__: {
						enumerable: false,
						value: original
					} });
				}
				source[name] = wrapped;
				return () => {
					source[name] = original;
				};
			} catch {
				return () => {};
			}
		}
		function createMirror$1() {
			return new Mirror$1();
		}
		function getDefaultExportFromCjs(x) {
			return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
		}
		function getAugmentedNamespace(n2) {
			if (n2.__esModule) return n2;
			var f2 = n2.default;
			if (typeof f2 == "function") {
				var a2 = function a22() {
					if (this instanceof a22) return Reflect.construct(f2, arguments, this.constructor);
					return f2.apply(this, arguments);
				};
				a2.prototype = f2.prototype;
			} else a2 = {};
			Object.defineProperty(a2, "__esModule", { value: true });
			Object.keys(n2).forEach(function(k) {
				var d = Object.getOwnPropertyDescriptor(n2, k);
				Object.defineProperty(a2, k, d.get ? d : {
					enumerable: true,
					get: function() {
						return n2[k];
					}
				});
			});
			return a2;
		}
		function requirePicocolors_browser() {
			if (hasRequiredPicocolors_browser) return picocolors_browser.exports;
			hasRequiredPicocolors_browser = 1;
			var x = String;
			var create = function() {
				return {
					isColorSupported: false,
					reset: x,
					bold: x,
					dim: x,
					italic: x,
					underline: x,
					inverse: x,
					hidden: x,
					strikethrough: x,
					black: x,
					red: x,
					green: x,
					yellow: x,
					blue: x,
					magenta: x,
					cyan: x,
					white: x,
					gray: x,
					bgBlack: x,
					bgRed: x,
					bgGreen: x,
					bgYellow: x,
					bgBlue: x,
					bgMagenta: x,
					bgCyan: x,
					bgWhite: x
				};
			};
			picocolors_browser.exports = create();
			picocolors_browser.exports.createColors = create;
			return picocolors_browser.exports;
		}
		function requireCssSyntaxError() {
			if (hasRequiredCssSyntaxError) return cssSyntaxError;
			hasRequiredCssSyntaxError = 1;
			let pico = /* @__PURE__ */ requirePicocolors_browser();
			let terminalHighlight = require$$2;
			class CssSyntaxError extends Error {
				constructor(message, line, column, source, file, plugin) {
					super(message);
					this.name = "CssSyntaxError";
					this.reason = message;
					if (file) this.file = file;
					if (source) this.source = source;
					if (plugin) this.plugin = plugin;
					if (typeof line !== "undefined" && typeof column !== "undefined") if (typeof line === "number") {
						this.line = line;
						this.column = column;
					} else {
						this.line = line.line;
						this.column = line.column;
						this.endLine = column.line;
						this.endColumn = column.column;
					}
					this.setMessage();
					if (Error.captureStackTrace) Error.captureStackTrace(this, CssSyntaxError);
				}
				setMessage() {
					this.message = this.plugin ? this.plugin + ": " : "";
					this.message += this.file ? this.file : "<css input>";
					if (typeof this.line !== "undefined") this.message += ":" + this.line + ":" + this.column;
					this.message += ": " + this.reason;
				}
				showSourceCode(color) {
					if (!this.source) return "";
					let css = this.source;
					if (color == null) color = pico.isColorSupported;
					if (terminalHighlight) {
						if (color) css = terminalHighlight(css);
					}
					let lines = css.split(/\r?\n/);
					let start = Math.max(this.line - 3, 0);
					let end = Math.min(this.line + 2, lines.length);
					let maxWidth = String(end).length;
					let mark, aside;
					if (color) {
						let { bold, gray, red } = pico.createColors(true);
						mark = (text) => bold(red(text));
						aside = (text) => gray(text);
					} else mark = aside = (str) => str;
					return lines.slice(start, end).map((line, index2) => {
						let number = start + 1 + index2;
						let gutter = " " + (" " + number).slice(-maxWidth) + " | ";
						if (number === this.line) {
							let spacing = aside(gutter.replace(/\d/g, " ")) + line.slice(0, this.column - 1).replace(/[^\t]/g, " ");
							return mark(">") + aside(gutter) + line + "\n " + spacing + mark("^");
						}
						return " " + aside(gutter) + line;
					}).join("\n");
				}
				toString() {
					let code = this.showSourceCode();
					if (code) code = "\n\n" + code + "\n";
					return this.name + ": " + this.message + code;
				}
			}
			cssSyntaxError = CssSyntaxError;
			CssSyntaxError.default = CssSyntaxError;
			return cssSyntaxError;
		}
		function requireSymbols() {
			if (hasRequiredSymbols) return symbols;
			hasRequiredSymbols = 1;
			symbols.isClean = Symbol("isClean");
			symbols.my = Symbol("my");
			return symbols;
		}
		function requireStringifier() {
			if (hasRequiredStringifier) return stringifier;
			hasRequiredStringifier = 1;
			const DEFAULT_RAW = {
				after: "\n",
				beforeClose: "\n",
				beforeComment: "\n",
				beforeDecl: "\n",
				beforeOpen: " ",
				beforeRule: "\n",
				colon: ": ",
				commentLeft: " ",
				commentRight: " ",
				emptyBody: "",
				indent: "    ",
				semicolon: false
			};
			function capitalize(str) {
				return str[0].toUpperCase() + str.slice(1);
			}
			class Stringifier {
				constructor(builder) {
					this.builder = builder;
				}
				atrule(node2, semicolon) {
					let name = "@" + node2.name;
					let params = node2.params ? this.rawValue(node2, "params") : "";
					if (typeof node2.raws.afterName !== "undefined") name += node2.raws.afterName;
					else if (params) name += " ";
					if (node2.nodes) this.block(node2, name + params);
					else {
						let end = (node2.raws.between || "") + (semicolon ? ";" : "");
						this.builder(name + params + end, node2);
					}
				}
				beforeAfter(node2, detect) {
					let value;
					if (node2.type === "decl") value = this.raw(node2, null, "beforeDecl");
					else if (node2.type === "comment") value = this.raw(node2, null, "beforeComment");
					else if (detect === "before") value = this.raw(node2, null, "beforeRule");
					else value = this.raw(node2, null, "beforeClose");
					let buf = node2.parent;
					let depth = 0;
					while (buf && buf.type !== "root") {
						depth += 1;
						buf = buf.parent;
					}
					if (value.includes("\n")) {
						let indent = this.raw(node2, null, "indent");
						if (indent.length) for (let step = 0; step < depth; step++) value += indent;
					}
					return value;
				}
				block(node2, start) {
					let between = this.raw(node2, "between", "beforeOpen");
					this.builder(start + between + "{", node2, "start");
					let after;
					if (node2.nodes && node2.nodes.length) {
						this.body(node2);
						after = this.raw(node2, "after");
					} else after = this.raw(node2, "after", "emptyBody");
					if (after) this.builder(after);
					this.builder("}", node2, "end");
				}
				body(node2) {
					let last = node2.nodes.length - 1;
					while (last > 0) {
						if (node2.nodes[last].type !== "comment") break;
						last -= 1;
					}
					let semicolon = this.raw(node2, "semicolon");
					for (let i2 = 0; i2 < node2.nodes.length; i2++) {
						let child = node2.nodes[i2];
						let before = this.raw(child, "before");
						if (before) this.builder(before);
						this.stringify(child, last !== i2 || semicolon);
					}
				}
				comment(node2) {
					let left = this.raw(node2, "left", "commentLeft");
					let right = this.raw(node2, "right", "commentRight");
					this.builder("/*" + left + node2.text + right + "*/", node2);
				}
				decl(node2, semicolon) {
					let between = this.raw(node2, "between", "colon");
					let string = node2.prop + between + this.rawValue(node2, "value");
					if (node2.important) string += node2.raws.important || " !important";
					if (semicolon) string += ";";
					this.builder(string, node2);
				}
				document(node2) {
					this.body(node2);
				}
				raw(node2, own, detect) {
					let value;
					if (!detect) detect = own;
					if (own) {
						value = node2.raws[own];
						if (typeof value !== "undefined") return value;
					}
					let parent = node2.parent;
					if (detect === "before") {
						if (!parent || parent.type === "root" && parent.first === node2) return "";
						if (parent && parent.type === "document") return "";
					}
					if (!parent) return DEFAULT_RAW[detect];
					let root2 = node2.root();
					if (!root2.rawCache) root2.rawCache = {};
					if (typeof root2.rawCache[detect] !== "undefined") return root2.rawCache[detect];
					if (detect === "before" || detect === "after") return this.beforeAfter(node2, detect);
					else {
						let method = "raw" + capitalize(detect);
						if (this[method]) value = this[method](root2, node2);
						else root2.walk((i2) => {
							value = i2.raws[own];
							if (typeof value !== "undefined") return false;
						});
					}
					if (typeof value === "undefined") value = DEFAULT_RAW[detect];
					root2.rawCache[detect] = value;
					return value;
				}
				rawBeforeClose(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.nodes && i2.nodes.length > 0) {
							if (typeof i2.raws.after !== "undefined") {
								value = i2.raws.after;
								if (value.includes("\n")) value = value.replace(/[^\n]+$/, "");
								return false;
							}
						}
					});
					if (value) value = value.replace(/\S/g, "");
					return value;
				}
				rawBeforeComment(root2, node2) {
					let value;
					root2.walkComments((i2) => {
						if (typeof i2.raws.before !== "undefined") {
							value = i2.raws.before;
							if (value.includes("\n")) value = value.replace(/[^\n]+$/, "");
							return false;
						}
					});
					if (typeof value === "undefined") value = this.raw(node2, null, "beforeDecl");
					else if (value) value = value.replace(/\S/g, "");
					return value;
				}
				rawBeforeDecl(root2, node2) {
					let value;
					root2.walkDecls((i2) => {
						if (typeof i2.raws.before !== "undefined") {
							value = i2.raws.before;
							if (value.includes("\n")) value = value.replace(/[^\n]+$/, "");
							return false;
						}
					});
					if (typeof value === "undefined") value = this.raw(node2, null, "beforeRule");
					else if (value) value = value.replace(/\S/g, "");
					return value;
				}
				rawBeforeOpen(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.type !== "decl") {
							value = i2.raws.between;
							if (typeof value !== "undefined") return false;
						}
					});
					return value;
				}
				rawBeforeRule(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.nodes && (i2.parent !== root2 || root2.first !== i2)) {
							if (typeof i2.raws.before !== "undefined") {
								value = i2.raws.before;
								if (value.includes("\n")) value = value.replace(/[^\n]+$/, "");
								return false;
							}
						}
					});
					if (value) value = value.replace(/\S/g, "");
					return value;
				}
				rawColon(root2) {
					let value;
					root2.walkDecls((i2) => {
						if (typeof i2.raws.between !== "undefined") {
							value = i2.raws.between.replace(/[^\s:]/g, "");
							return false;
						}
					});
					return value;
				}
				rawEmptyBody(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.nodes && i2.nodes.length === 0) {
							value = i2.raws.after;
							if (typeof value !== "undefined") return false;
						}
					});
					return value;
				}
				rawIndent(root2) {
					if (root2.raws.indent) return root2.raws.indent;
					let value;
					root2.walk((i2) => {
						let p = i2.parent;
						if (p && p !== root2 && p.parent && p.parent === root2) {
							if (typeof i2.raws.before !== "undefined") {
								let parts = i2.raws.before.split("\n");
								value = parts[parts.length - 1];
								value = value.replace(/\S/g, "");
								return false;
							}
						}
					});
					return value;
				}
				rawSemicolon(root2) {
					let value;
					root2.walk((i2) => {
						if (i2.nodes && i2.nodes.length && i2.last.type === "decl") {
							value = i2.raws.semicolon;
							if (typeof value !== "undefined") return false;
						}
					});
					return value;
				}
				rawValue(node2, prop) {
					let value = node2[prop];
					let raw = node2.raws[prop];
					if (raw && raw.value === value) return raw.raw;
					return value;
				}
				root(node2) {
					this.body(node2);
					if (node2.raws.after) this.builder(node2.raws.after);
				}
				rule(node2) {
					this.block(node2, this.rawValue(node2, "selector"));
					if (node2.raws.ownSemicolon) this.builder(node2.raws.ownSemicolon, node2, "end");
				}
				stringify(node2, semicolon) {
					if (!this[node2.type]) throw new Error("Unknown AST node type " + node2.type + ". Maybe you need to change PostCSS stringifier.");
					this[node2.type](node2, semicolon);
				}
			}
			stringifier = Stringifier;
			Stringifier.default = Stringifier;
			return stringifier;
		}
		function requireStringify() {
			if (hasRequiredStringify) return stringify_1;
			hasRequiredStringify = 1;
			let Stringifier = requireStringifier();
			function stringify(node2, builder) {
				new Stringifier(builder).stringify(node2);
			}
			stringify_1 = stringify;
			stringify.default = stringify;
			return stringify_1;
		}
		function requireNode() {
			if (hasRequiredNode) return node;
			hasRequiredNode = 1;
			let { isClean, my } = requireSymbols();
			let CssSyntaxError = requireCssSyntaxError();
			let Stringifier = requireStringifier();
			let stringify = requireStringify();
			function cloneNode(obj, parent) {
				let cloned = new obj.constructor();
				for (let i2 in obj) {
					if (!Object.prototype.hasOwnProperty.call(obj, i2)) continue;
					if (i2 === "proxyCache") continue;
					let value = obj[i2];
					let type = typeof value;
					if (i2 === "parent" && type === "object") {
						if (parent) cloned[i2] = parent;
					} else if (i2 === "source") cloned[i2] = value;
					else if (Array.isArray(value)) cloned[i2] = value.map((j) => cloneNode(j, cloned));
					else {
						if (type === "object" && value !== null) value = cloneNode(value);
						cloned[i2] = value;
					}
				}
				return cloned;
			}
			class Node2 {
				constructor(defaults = {}) {
					this.raws = {};
					this[isClean] = false;
					this[my] = true;
					for (let name in defaults) if (name === "nodes") {
						this.nodes = [];
						for (let node2 of defaults[name]) if (typeof node2.clone === "function") this.append(node2.clone());
						else this.append(node2);
					} else this[name] = defaults[name];
				}
				addToError(error) {
					error.postcssNode = this;
					if (error.stack && this.source && /\n\s{4}at /.test(error.stack)) {
						let s2 = this.source;
						error.stack = error.stack.replace(/\n\s{4}at /, `$&${s2.input.from}:${s2.start.line}:${s2.start.column}$&`);
					}
					return error;
				}
				after(add) {
					this.parent.insertAfter(this, add);
					return this;
				}
				assign(overrides = {}) {
					for (let name in overrides) this[name] = overrides[name];
					return this;
				}
				before(add) {
					this.parent.insertBefore(this, add);
					return this;
				}
				cleanRaws(keepBetween) {
					delete this.raws.before;
					delete this.raws.after;
					if (!keepBetween) delete this.raws.between;
				}
				clone(overrides = {}) {
					let cloned = cloneNode(this);
					for (let name in overrides) cloned[name] = overrides[name];
					return cloned;
				}
				cloneAfter(overrides = {}) {
					let cloned = this.clone(overrides);
					this.parent.insertAfter(this, cloned);
					return cloned;
				}
				cloneBefore(overrides = {}) {
					let cloned = this.clone(overrides);
					this.parent.insertBefore(this, cloned);
					return cloned;
				}
				error(message, opts = {}) {
					if (this.source) {
						let { end, start } = this.rangeBy(opts);
						return this.source.input.error(message, {
							column: start.column,
							line: start.line
						}, {
							column: end.column,
							line: end.line
						}, opts);
					}
					return new CssSyntaxError(message);
				}
				getProxyProcessor() {
					return {
						get(node2, prop) {
							if (prop === "proxyOf") return node2;
							else if (prop === "root") return () => node2.root().toProxy();
							else return node2[prop];
						},
						set(node2, prop, value) {
							if (node2[prop] === value) return true;
							node2[prop] = value;
							if (prop === "prop" || prop === "value" || prop === "name" || prop === "params" || prop === "important" || prop === "text") node2.markDirty();
							return true;
						}
					};
				}
				markDirty() {
					if (this[isClean]) {
						this[isClean] = false;
						let next = this;
						while (next = next.parent) next[isClean] = false;
					}
				}
				next() {
					if (!this.parent) return void 0;
					let index2 = this.parent.index(this);
					return this.parent.nodes[index2 + 1];
				}
				positionBy(opts, stringRepresentation) {
					let pos = this.source.start;
					if (opts.index) pos = this.positionInside(opts.index, stringRepresentation);
					else if (opts.word) {
						stringRepresentation = this.toString();
						let index2 = stringRepresentation.indexOf(opts.word);
						if (index2 !== -1) pos = this.positionInside(index2, stringRepresentation);
					}
					return pos;
				}
				positionInside(index2, stringRepresentation) {
					let string = stringRepresentation || this.toString();
					let column = this.source.start.column;
					let line = this.source.start.line;
					for (let i2 = 0; i2 < index2; i2++) if (string[i2] === "\n") {
						column = 1;
						line += 1;
					} else column += 1;
					return {
						column,
						line
					};
				}
				prev() {
					if (!this.parent) return void 0;
					let index2 = this.parent.index(this);
					return this.parent.nodes[index2 - 1];
				}
				rangeBy(opts) {
					let start = {
						column: this.source.start.column,
						line: this.source.start.line
					};
					let end = this.source.end ? {
						column: this.source.end.column + 1,
						line: this.source.end.line
					} : {
						column: start.column + 1,
						line: start.line
					};
					if (opts.word) {
						let stringRepresentation = this.toString();
						let index2 = stringRepresentation.indexOf(opts.word);
						if (index2 !== -1) {
							start = this.positionInside(index2, stringRepresentation);
							end = this.positionInside(index2 + opts.word.length, stringRepresentation);
						}
					} else {
						if (opts.start) start = {
							column: opts.start.column,
							line: opts.start.line
						};
						else if (opts.index) start = this.positionInside(opts.index);
						if (opts.end) end = {
							column: opts.end.column,
							line: opts.end.line
						};
						else if (typeof opts.endIndex === "number") end = this.positionInside(opts.endIndex);
						else if (opts.index) end = this.positionInside(opts.index + 1);
					}
					if (end.line < start.line || end.line === start.line && end.column <= start.column) end = {
						column: start.column + 1,
						line: start.line
					};
					return {
						end,
						start
					};
				}
				raw(prop, defaultType) {
					return new Stringifier().raw(this, prop, defaultType);
				}
				remove() {
					if (this.parent) this.parent.removeChild(this);
					this.parent = void 0;
					return this;
				}
				replaceWith(...nodes) {
					if (this.parent) {
						let bookmark = this;
						let foundSelf = false;
						for (let node2 of nodes) if (node2 === this) foundSelf = true;
						else if (foundSelf) {
							this.parent.insertAfter(bookmark, node2);
							bookmark = node2;
						} else this.parent.insertBefore(bookmark, node2);
						if (!foundSelf) this.remove();
					}
					return this;
				}
				root() {
					let result2 = this;
					while (result2.parent && result2.parent.type !== "document") result2 = result2.parent;
					return result2;
				}
				toJSON(_, inputs) {
					let fixed = {};
					let emitInputs = inputs == null;
					inputs = inputs || /* @__PURE__ */ new Map();
					let inputsNextIndex = 0;
					for (let name in this) {
						if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
						if (name === "parent" || name === "proxyCache") continue;
						let value = this[name];
						if (Array.isArray(value)) fixed[name] = value.map((i2) => {
							if (typeof i2 === "object" && i2.toJSON) return i2.toJSON(null, inputs);
							else return i2;
						});
						else if (typeof value === "object" && value.toJSON) fixed[name] = value.toJSON(null, inputs);
						else if (name === "source") {
							let inputId = inputs.get(value.input);
							if (inputId == null) {
								inputId = inputsNextIndex;
								inputs.set(value.input, inputsNextIndex);
								inputsNextIndex++;
							}
							fixed[name] = {
								end: value.end,
								inputId,
								start: value.start
							};
						} else fixed[name] = value;
					}
					if (emitInputs) fixed.inputs = [...inputs.keys()].map((input2) => input2.toJSON());
					return fixed;
				}
				toProxy() {
					if (!this.proxyCache) this.proxyCache = new Proxy(this, this.getProxyProcessor());
					return this.proxyCache;
				}
				toString(stringifier2 = stringify) {
					if (stringifier2.stringify) stringifier2 = stringifier2.stringify;
					let result2 = "";
					stringifier2(this, (i2) => {
						result2 += i2;
					});
					return result2;
				}
				warn(result2, text, opts) {
					let data = { node: this };
					for (let i2 in opts) data[i2] = opts[i2];
					return result2.warn(text, data);
				}
				get proxyOf() {
					return this;
				}
			}
			node = Node2;
			Node2.default = Node2;
			return node;
		}
		function requireDeclaration() {
			if (hasRequiredDeclaration) return declaration;
			hasRequiredDeclaration = 1;
			let Node2 = requireNode();
			class Declaration extends Node2 {
				constructor(defaults) {
					if (defaults && typeof defaults.value !== "undefined" && typeof defaults.value !== "string") defaults = {
						...defaults,
						value: String(defaults.value)
					};
					super(defaults);
					this.type = "decl";
				}
				get variable() {
					return this.prop.startsWith("--") || this.prop[0] === "$";
				}
			}
			declaration = Declaration;
			Declaration.default = Declaration;
			return declaration;
		}
		function requireNonSecure() {
			if (hasRequiredNonSecure) return nonSecure;
			hasRequiredNonSecure = 1;
			let urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
			let customAlphabet = (alphabet, defaultSize = 21) => {
				return (size = defaultSize) => {
					let id = "";
					let i2 = size;
					while (i2--) id += alphabet[Math.random() * alphabet.length | 0];
					return id;
				};
			};
			let nanoid = (size = 21) => {
				let id = "";
				let i2 = size;
				while (i2--) id += urlAlphabet[Math.random() * 64 | 0];
				return id;
			};
			nonSecure = {
				nanoid,
				customAlphabet
			};
			return nonSecure;
		}
		function requirePreviousMap() {
			if (hasRequiredPreviousMap) return previousMap;
			hasRequiredPreviousMap = 1;
			let { SourceMapConsumer, SourceMapGenerator } = require$$2;
			let { existsSync, readFileSync } = require$$2;
			let { dirname, join } = require$$2;
			function fromBase64(str) {
				if (Buffer) return Buffer.from(str, "base64").toString();
				else return window.atob(str);
			}
			class PreviousMap {
				constructor(css, opts) {
					if (opts.map === false) return;
					this.loadAnnotation(css);
					this.inline = this.startWith(this.annotation, "data:");
					let prev = opts.map ? opts.map.prev : void 0;
					let text = this.loadMap(opts.from, prev);
					if (!this.mapFile && opts.from) this.mapFile = opts.from;
					if (this.mapFile) this.root = dirname(this.mapFile);
					if (text) this.text = text;
				}
				consumer() {
					if (!this.consumerCache) this.consumerCache = new SourceMapConsumer(this.text);
					return this.consumerCache;
				}
				decodeInline(text) {
					let baseCharsetUri = /^data:application\/json;charset=utf-?8;base64,/;
					let baseUri = /^data:application\/json;base64,/;
					if (/^data:application\/json;charset=utf-?8,/.test(text) || /^data:application\/json,/.test(text)) return decodeURIComponent(text.substr(RegExp.lastMatch.length));
					if (baseCharsetUri.test(text) || baseUri.test(text)) return fromBase64(text.substr(RegExp.lastMatch.length));
					let encoding = text.match(/data:application\/json;([^,]+),/)[1];
					throw new Error("Unsupported source map encoding " + encoding);
				}
				getAnnotationURL(sourceMapString) {
					return sourceMapString.replace(/^\/\*\s*# sourceMappingURL=/, "").trim();
				}
				isMap(map) {
					if (typeof map !== "object") return false;
					return typeof map.mappings === "string" || typeof map._mappings === "string" || Array.isArray(map.sections);
				}
				loadAnnotation(css) {
					let comments = css.match(/\/\*\s*# sourceMappingURL=/gm);
					if (!comments) return;
					let start = css.lastIndexOf(comments.pop());
					let end = css.indexOf("*/", start);
					if (start > -1 && end > -1) this.annotation = this.getAnnotationURL(css.substring(start, end));
				}
				loadFile(path) {
					this.root = dirname(path);
					if (existsSync(path)) {
						this.mapFile = path;
						return readFileSync(path, "utf-8").toString().trim();
					}
				}
				loadMap(file, prev) {
					if (prev === false) return false;
					if (prev) if (typeof prev === "string") return prev;
					else if (typeof prev === "function") {
						let prevPath = prev(file);
						if (prevPath) {
							let map = this.loadFile(prevPath);
							if (!map) throw new Error("Unable to load previous source map: " + prevPath.toString());
							return map;
						}
					} else if (prev instanceof SourceMapConsumer) return SourceMapGenerator.fromSourceMap(prev).toString();
					else if (prev instanceof SourceMapGenerator) return prev.toString();
					else if (this.isMap(prev)) return JSON.stringify(prev);
					else throw new Error("Unsupported previous source map format: " + prev.toString());
					else if (this.inline) return this.decodeInline(this.annotation);
					else if (this.annotation) {
						let map = this.annotation;
						if (file) map = join(dirname(file), map);
						return this.loadFile(map);
					}
				}
				startWith(string, start) {
					if (!string) return false;
					return string.substr(0, start.length) === start;
				}
				withContent() {
					return !!(this.consumer().sourcesContent && this.consumer().sourcesContent.length > 0);
				}
			}
			previousMap = PreviousMap;
			PreviousMap.default = PreviousMap;
			return previousMap;
		}
		function requireInput() {
			if (hasRequiredInput) return input;
			hasRequiredInput = 1;
			let { SourceMapConsumer, SourceMapGenerator } = require$$2;
			let { fileURLToPath, pathToFileURL } = require$$2;
			let { isAbsolute, resolve } = require$$2;
			let { nanoid } = /* @__PURE__ */ requireNonSecure();
			let terminalHighlight = require$$2;
			let CssSyntaxError = requireCssSyntaxError();
			let PreviousMap = requirePreviousMap();
			let fromOffsetCache = Symbol("fromOffsetCache");
			let sourceMapAvailable = Boolean(SourceMapConsumer && SourceMapGenerator);
			let pathAvailable = Boolean(resolve && isAbsolute);
			class Input {
				constructor(css, opts = {}) {
					if (css === null || typeof css === "undefined" || typeof css === "object" && !css.toString) throw new Error(`PostCSS received ${css} instead of CSS string`);
					this.css = css.toString();
					if (this.css[0] === "﻿" || this.css[0] === "￾") {
						this.hasBOM = true;
						this.css = this.css.slice(1);
					} else this.hasBOM = false;
					if (opts.from) if (!pathAvailable || /^\w+:\/\//.test(opts.from) || isAbsolute(opts.from)) this.file = opts.from;
					else this.file = resolve(opts.from);
					if (pathAvailable && sourceMapAvailable) {
						let map = new PreviousMap(this.css, opts);
						if (map.text) {
							this.map = map;
							let file = map.consumer().file;
							if (!this.file && file) this.file = this.mapResolve(file);
						}
					}
					if (!this.file) this.id = "<input css " + nanoid(6) + ">";
					if (this.map) this.map.file = this.from;
				}
				error(message, line, column, opts = {}) {
					let result2, endLine, endColumn;
					if (line && typeof line === "object") {
						let start = line;
						let end = column;
						if (typeof start.offset === "number") {
							let pos = this.fromOffset(start.offset);
							line = pos.line;
							column = pos.col;
						} else {
							line = start.line;
							column = start.column;
						}
						if (typeof end.offset === "number") {
							let pos = this.fromOffset(end.offset);
							endLine = pos.line;
							endColumn = pos.col;
						} else {
							endLine = end.line;
							endColumn = end.column;
						}
					} else if (!column) {
						let pos = this.fromOffset(line);
						line = pos.line;
						column = pos.col;
					}
					let origin = this.origin(line, column, endLine, endColumn);
					if (origin) result2 = new CssSyntaxError(message, origin.endLine === void 0 ? origin.line : {
						column: origin.column,
						line: origin.line
					}, origin.endLine === void 0 ? origin.column : {
						column: origin.endColumn,
						line: origin.endLine
					}, origin.source, origin.file, opts.plugin);
					else result2 = new CssSyntaxError(message, endLine === void 0 ? line : {
						column,
						line
					}, endLine === void 0 ? column : {
						column: endColumn,
						line: endLine
					}, this.css, this.file, opts.plugin);
					result2.input = {
						column,
						endColumn,
						endLine,
						line,
						source: this.css
					};
					if (this.file) {
						if (pathToFileURL) result2.input.url = pathToFileURL(this.file).toString();
						result2.input.file = this.file;
					}
					return result2;
				}
				fromOffset(offset) {
					let lastLine, lineToIndex;
					if (!this[fromOffsetCache]) {
						let lines = this.css.split("\n");
						lineToIndex = new Array(lines.length);
						let prevIndex = 0;
						for (let i2 = 0, l2 = lines.length; i2 < l2; i2++) {
							lineToIndex[i2] = prevIndex;
							prevIndex += lines[i2].length + 1;
						}
						this[fromOffsetCache] = lineToIndex;
					} else lineToIndex = this[fromOffsetCache];
					lastLine = lineToIndex[lineToIndex.length - 1];
					let min = 0;
					if (offset >= lastLine) min = lineToIndex.length - 1;
					else {
						let max = lineToIndex.length - 2;
						let mid;
						while (min < max) {
							mid = min + (max - min >> 1);
							if (offset < lineToIndex[mid]) max = mid - 1;
							else if (offset >= lineToIndex[mid + 1]) min = mid + 1;
							else {
								min = mid;
								break;
							}
						}
					}
					return {
						col: offset - lineToIndex[min] + 1,
						line: min + 1
					};
				}
				mapResolve(file) {
					if (/^\w+:\/\//.test(file)) return file;
					return resolve(this.map.consumer().sourceRoot || this.map.root || ".", file);
				}
				origin(line, column, endLine, endColumn) {
					if (!this.map) return false;
					let consumer = this.map.consumer();
					let from = consumer.originalPositionFor({
						column,
						line
					});
					if (!from.source) return false;
					let to;
					if (typeof endLine === "number") to = consumer.originalPositionFor({
						column: endColumn,
						line: endLine
					});
					let fromUrl;
					if (isAbsolute(from.source)) fromUrl = pathToFileURL(from.source);
					else fromUrl = new URL(from.source, this.map.consumer().sourceRoot || pathToFileURL(this.map.mapFile));
					let result2 = {
						column: from.column,
						endColumn: to && to.column,
						endLine: to && to.line,
						line: from.line,
						url: fromUrl.toString()
					};
					if (fromUrl.protocol === "file:") if (fileURLToPath) result2.file = fileURLToPath(fromUrl);
					else throw new Error(`file: protocol is not available in this PostCSS build`);
					let source = consumer.sourceContentFor(from.source);
					if (source) result2.source = source;
					return result2;
				}
				toJSON() {
					let json = {};
					for (let name of [
						"hasBOM",
						"css",
						"file",
						"id"
					]) if (this[name] != null) json[name] = this[name];
					if (this.map) {
						json.map = { ...this.map };
						if (json.map.consumerCache) json.map.consumerCache = void 0;
					}
					return json;
				}
				get from() {
					return this.file || this.id;
				}
			}
			input = Input;
			Input.default = Input;
			if (terminalHighlight && terminalHighlight.registerInput) terminalHighlight.registerInput(Input);
			return input;
		}
		function requireMapGenerator() {
			if (hasRequiredMapGenerator) return mapGenerator;
			hasRequiredMapGenerator = 1;
			let { SourceMapConsumer, SourceMapGenerator } = require$$2;
			let { dirname, relative, resolve, sep } = require$$2;
			let { pathToFileURL } = require$$2;
			let Input = requireInput();
			let sourceMapAvailable = Boolean(SourceMapConsumer && SourceMapGenerator);
			let pathAvailable = Boolean(dirname && resolve && relative && sep);
			class MapGenerator {
				constructor(stringify, root2, opts, cssString) {
					this.stringify = stringify;
					this.mapOpts = opts.map || {};
					this.root = root2;
					this.opts = opts;
					this.css = cssString;
					this.originalCSS = cssString;
					this.usesFileUrls = !this.mapOpts.from && this.mapOpts.absolute;
					this.memoizedFileURLs = /* @__PURE__ */ new Map();
					this.memoizedPaths = /* @__PURE__ */ new Map();
					this.memoizedURLs = /* @__PURE__ */ new Map();
				}
				addAnnotation() {
					let content;
					if (this.isInline()) content = "data:application/json;base64," + this.toBase64(this.map.toString());
					else if (typeof this.mapOpts.annotation === "string") content = this.mapOpts.annotation;
					else if (typeof this.mapOpts.annotation === "function") content = this.mapOpts.annotation(this.opts.to, this.root);
					else content = this.outputFile() + ".map";
					let eol = "\n";
					if (this.css.includes("\r\n")) eol = "\r\n";
					this.css += eol + "/*# sourceMappingURL=" + content + " */";
				}
				applyPrevMaps() {
					for (let prev of this.previous()) {
						let from = this.toUrl(this.path(prev.file));
						let root2 = prev.root || dirname(prev.file);
						let map;
						if (this.mapOpts.sourcesContent === false) {
							map = new SourceMapConsumer(prev.text);
							if (map.sourcesContent) map.sourcesContent = null;
						} else map = prev.consumer();
						this.map.applySourceMap(map, from, this.toUrl(this.path(root2)));
					}
				}
				clearAnnotation() {
					if (this.mapOpts.annotation === false) return;
					if (this.root) {
						let node2;
						for (let i2 = this.root.nodes.length - 1; i2 >= 0; i2--) {
							node2 = this.root.nodes[i2];
							if (node2.type !== "comment") continue;
							if (node2.text.indexOf("# sourceMappingURL=") === 0) this.root.removeChild(i2);
						}
					} else if (this.css) this.css = this.css.replace(/\n*?\/\*#[\S\s]*?\*\/$/gm, "");
				}
				generate() {
					this.clearAnnotation();
					if (pathAvailable && sourceMapAvailable && this.isMap()) return this.generateMap();
					else {
						let result2 = "";
						this.stringify(this.root, (i2) => {
							result2 += i2;
						});
						return [result2];
					}
				}
				generateMap() {
					if (this.root) this.generateString();
					else if (this.previous().length === 1) {
						let prev = this.previous()[0].consumer();
						prev.file = this.outputFile();
						this.map = SourceMapGenerator.fromSourceMap(prev, { ignoreInvalidMapping: true });
					} else {
						this.map = new SourceMapGenerator({
							file: this.outputFile(),
							ignoreInvalidMapping: true
						});
						this.map.addMapping({
							generated: {
								column: 0,
								line: 1
							},
							original: {
								column: 0,
								line: 1
							},
							source: this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>"
						});
					}
					if (this.isSourcesContent()) this.setSourcesContent();
					if (this.root && this.previous().length > 0) this.applyPrevMaps();
					if (this.isAnnotation()) this.addAnnotation();
					if (this.isInline()) return [this.css];
					else return [this.css, this.map];
				}
				generateString() {
					this.css = "";
					this.map = new SourceMapGenerator({
						file: this.outputFile(),
						ignoreInvalidMapping: true
					});
					let line = 1;
					let column = 1;
					let noSource = "<no source>";
					let mapping = {
						generated: {
							column: 0,
							line: 0
						},
						original: {
							column: 0,
							line: 0
						},
						source: ""
					};
					let lines, last;
					this.stringify(this.root, (str, node2, type) => {
						this.css += str;
						if (node2 && type !== "end") {
							mapping.generated.line = line;
							mapping.generated.column = column - 1;
							if (node2.source && node2.source.start) {
								mapping.source = this.sourcePath(node2);
								mapping.original.line = node2.source.start.line;
								mapping.original.column = node2.source.start.column - 1;
								this.map.addMapping(mapping);
							} else {
								mapping.source = noSource;
								mapping.original.line = 1;
								mapping.original.column = 0;
								this.map.addMapping(mapping);
							}
						}
						lines = str.match(/\n/g);
						if (lines) {
							line += lines.length;
							last = str.lastIndexOf("\n");
							column = str.length - last;
						} else column += str.length;
						if (node2 && type !== "start") {
							let p = node2.parent || { raws: {} };
							if (!(node2.type === "decl" || node2.type === "atrule" && !node2.nodes) || node2 !== p.last || p.raws.semicolon) if (node2.source && node2.source.end) {
								mapping.source = this.sourcePath(node2);
								mapping.original.line = node2.source.end.line;
								mapping.original.column = node2.source.end.column - 1;
								mapping.generated.line = line;
								mapping.generated.column = column - 2;
								this.map.addMapping(mapping);
							} else {
								mapping.source = noSource;
								mapping.original.line = 1;
								mapping.original.column = 0;
								mapping.generated.line = line;
								mapping.generated.column = column - 1;
								this.map.addMapping(mapping);
							}
						}
					});
				}
				isAnnotation() {
					if (this.isInline()) return true;
					if (typeof this.mapOpts.annotation !== "undefined") return this.mapOpts.annotation;
					if (this.previous().length) return this.previous().some((i2) => i2.annotation);
					return true;
				}
				isInline() {
					if (typeof this.mapOpts.inline !== "undefined") return this.mapOpts.inline;
					let annotation = this.mapOpts.annotation;
					if (typeof annotation !== "undefined" && annotation !== true) return false;
					if (this.previous().length) return this.previous().some((i2) => i2.inline);
					return true;
				}
				isMap() {
					if (typeof this.opts.map !== "undefined") return !!this.opts.map;
					return this.previous().length > 0;
				}
				isSourcesContent() {
					if (typeof this.mapOpts.sourcesContent !== "undefined") return this.mapOpts.sourcesContent;
					if (this.previous().length) return this.previous().some((i2) => i2.withContent());
					return true;
				}
				outputFile() {
					if (this.opts.to) return this.path(this.opts.to);
					else if (this.opts.from) return this.path(this.opts.from);
					else return "to.css";
				}
				path(file) {
					if (this.mapOpts.absolute) return file;
					if (file.charCodeAt(0) === 60) return file;
					if (/^\w+:\/\//.test(file)) return file;
					let cached = this.memoizedPaths.get(file);
					if (cached) return cached;
					let from = this.opts.to ? dirname(this.opts.to) : ".";
					if (typeof this.mapOpts.annotation === "string") from = dirname(resolve(from, this.mapOpts.annotation));
					let path = relative(from, file);
					this.memoizedPaths.set(file, path);
					return path;
				}
				previous() {
					if (!this.previousMaps) {
						this.previousMaps = [];
						if (this.root) this.root.walk((node2) => {
							if (node2.source && node2.source.input.map) {
								let map = node2.source.input.map;
								if (!this.previousMaps.includes(map)) this.previousMaps.push(map);
							}
						});
						else {
							let input2 = new Input(this.originalCSS, this.opts);
							if (input2.map) this.previousMaps.push(input2.map);
						}
					}
					return this.previousMaps;
				}
				setSourcesContent() {
					let already = {};
					if (this.root) this.root.walk((node2) => {
						if (node2.source) {
							let from = node2.source.input.from;
							if (from && !already[from]) {
								already[from] = true;
								let fromUrl = this.usesFileUrls ? this.toFileUrl(from) : this.toUrl(this.path(from));
								this.map.setSourceContent(fromUrl, node2.source.input.css);
							}
						}
					});
					else if (this.css) {
						let from = this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>";
						this.map.setSourceContent(from, this.css);
					}
				}
				sourcePath(node2) {
					if (this.mapOpts.from) return this.toUrl(this.mapOpts.from);
					else if (this.usesFileUrls) return this.toFileUrl(node2.source.input.from);
					else return this.toUrl(this.path(node2.source.input.from));
				}
				toBase64(str) {
					if (Buffer) return Buffer.from(str).toString("base64");
					else return window.btoa(unescape(encodeURIComponent(str)));
				}
				toFileUrl(path) {
					let cached = this.memoizedFileURLs.get(path);
					if (cached) return cached;
					if (pathToFileURL) {
						let fileURL = pathToFileURL(path).toString();
						this.memoizedFileURLs.set(path, fileURL);
						return fileURL;
					} else throw new Error("`map.absolute` option is not available in this PostCSS build");
				}
				toUrl(path) {
					let cached = this.memoizedURLs.get(path);
					if (cached) return cached;
					if (sep === "\\") path = path.replace(/\\/g, "/");
					let url = encodeURI(path).replace(/[#?]/g, encodeURIComponent);
					this.memoizedURLs.set(path, url);
					return url;
				}
			}
			mapGenerator = MapGenerator;
			return mapGenerator;
		}
		function requireComment() {
			if (hasRequiredComment) return comment;
			hasRequiredComment = 1;
			let Node2 = requireNode();
			class Comment extends Node2 {
				constructor(defaults) {
					super(defaults);
					this.type = "comment";
				}
			}
			comment = Comment;
			Comment.default = Comment;
			return comment;
		}
		function requireContainer() {
			if (hasRequiredContainer) return container;
			hasRequiredContainer = 1;
			let { isClean, my } = requireSymbols();
			let Declaration = requireDeclaration();
			let Comment = requireComment();
			let Node2 = requireNode();
			let parse, Rule, AtRule, Root;
			function cleanSource(nodes) {
				return nodes.map((i2) => {
					if (i2.nodes) i2.nodes = cleanSource(i2.nodes);
					delete i2.source;
					return i2;
				});
			}
			function markDirtyUp(node2) {
				node2[isClean] = false;
				if (node2.proxyOf.nodes) for (let i2 of node2.proxyOf.nodes) markDirtyUp(i2);
			}
			class Container extends Node2 {
				append(...children) {
					for (let child of children) {
						let nodes = this.normalize(child, this.last);
						for (let node2 of nodes) this.proxyOf.nodes.push(node2);
					}
					this.markDirty();
					return this;
				}
				cleanRaws(keepBetween) {
					super.cleanRaws(keepBetween);
					if (this.nodes) for (let node2 of this.nodes) node2.cleanRaws(keepBetween);
				}
				each(callback) {
					if (!this.proxyOf.nodes) return void 0;
					let iterator = this.getIterator();
					let index2, result2;
					while (this.indexes[iterator] < this.proxyOf.nodes.length) {
						index2 = this.indexes[iterator];
						result2 = callback(this.proxyOf.nodes[index2], index2);
						if (result2 === false) break;
						this.indexes[iterator] += 1;
					}
					delete this.indexes[iterator];
					return result2;
				}
				every(condition) {
					return this.nodes.every(condition);
				}
				getIterator() {
					if (!this.lastEach) this.lastEach = 0;
					if (!this.indexes) this.indexes = {};
					this.lastEach += 1;
					let iterator = this.lastEach;
					this.indexes[iterator] = 0;
					return iterator;
				}
				getProxyProcessor() {
					return {
						get(node2, prop) {
							if (prop === "proxyOf") return node2;
							else if (!node2[prop]) return node2[prop];
							else if (prop === "each" || typeof prop === "string" && prop.startsWith("walk")) return (...args) => {
								return node2[prop](...args.map((i2) => {
									if (typeof i2 === "function") return (child, index2) => i2(child.toProxy(), index2);
									else return i2;
								}));
							};
							else if (prop === "every" || prop === "some") return (cb) => {
								return node2[prop]((child, ...other) => cb(child.toProxy(), ...other));
							};
							else if (prop === "root") return () => node2.root().toProxy();
							else if (prop === "nodes") return node2.nodes.map((i2) => i2.toProxy());
							else if (prop === "first" || prop === "last") return node2[prop].toProxy();
							else return node2[prop];
						},
						set(node2, prop, value) {
							if (node2[prop] === value) return true;
							node2[prop] = value;
							if (prop === "name" || prop === "params" || prop === "selector") node2.markDirty();
							return true;
						}
					};
				}
				index(child) {
					if (typeof child === "number") return child;
					if (child.proxyOf) child = child.proxyOf;
					return this.proxyOf.nodes.indexOf(child);
				}
				insertAfter(exist, add) {
					let existIndex = this.index(exist);
					let nodes = this.normalize(add, this.proxyOf.nodes[existIndex]).reverse();
					existIndex = this.index(exist);
					for (let node2 of nodes) this.proxyOf.nodes.splice(existIndex + 1, 0, node2);
					let index2;
					for (let id in this.indexes) {
						index2 = this.indexes[id];
						if (existIndex < index2) this.indexes[id] = index2 + nodes.length;
					}
					this.markDirty();
					return this;
				}
				insertBefore(exist, add) {
					let existIndex = this.index(exist);
					let type = existIndex === 0 ? "prepend" : false;
					let nodes = this.normalize(add, this.proxyOf.nodes[existIndex], type).reverse();
					existIndex = this.index(exist);
					for (let node2 of nodes) this.proxyOf.nodes.splice(existIndex, 0, node2);
					let index2;
					for (let id in this.indexes) {
						index2 = this.indexes[id];
						if (existIndex <= index2) this.indexes[id] = index2 + nodes.length;
					}
					this.markDirty();
					return this;
				}
				normalize(nodes, sample) {
					if (typeof nodes === "string") nodes = cleanSource(parse(nodes).nodes);
					else if (typeof nodes === "undefined") nodes = [];
					else if (Array.isArray(nodes)) {
						nodes = nodes.slice(0);
						for (let i2 of nodes) if (i2.parent) i2.parent.removeChild(i2, "ignore");
					} else if (nodes.type === "root" && this.type !== "document") {
						nodes = nodes.nodes.slice(0);
						for (let i2 of nodes) if (i2.parent) i2.parent.removeChild(i2, "ignore");
					} else if (nodes.type) nodes = [nodes];
					else if (nodes.prop) {
						if (typeof nodes.value === "undefined") throw new Error("Value field is missed in node creation");
						else if (typeof nodes.value !== "string") nodes.value = String(nodes.value);
						nodes = [new Declaration(nodes)];
					} else if (nodes.selector) nodes = [new Rule(nodes)];
					else if (nodes.name) nodes = [new AtRule(nodes)];
					else if (nodes.text) nodes = [new Comment(nodes)];
					else throw new Error("Unknown node type in node creation");
					return nodes.map((i2) => {
						if (!i2[my]) Container.rebuild(i2);
						i2 = i2.proxyOf;
						if (i2.parent) i2.parent.removeChild(i2);
						if (i2[isClean]) markDirtyUp(i2);
						if (typeof i2.raws.before === "undefined") {
							if (sample && typeof sample.raws.before !== "undefined") i2.raws.before = sample.raws.before.replace(/\S/g, "");
						}
						i2.parent = this.proxyOf;
						return i2;
					});
				}
				prepend(...children) {
					children = children.reverse();
					for (let child of children) {
						let nodes = this.normalize(child, this.first, "prepend").reverse();
						for (let node2 of nodes) this.proxyOf.nodes.unshift(node2);
						for (let id in this.indexes) this.indexes[id] = this.indexes[id] + nodes.length;
					}
					this.markDirty();
					return this;
				}
				push(child) {
					child.parent = this;
					this.proxyOf.nodes.push(child);
					return this;
				}
				removeAll() {
					for (let node2 of this.proxyOf.nodes) node2.parent = void 0;
					this.proxyOf.nodes = [];
					this.markDirty();
					return this;
				}
				removeChild(child) {
					child = this.index(child);
					this.proxyOf.nodes[child].parent = void 0;
					this.proxyOf.nodes.splice(child, 1);
					let index2;
					for (let id in this.indexes) {
						index2 = this.indexes[id];
						if (index2 >= child) this.indexes[id] = index2 - 1;
					}
					this.markDirty();
					return this;
				}
				replaceValues(pattern, opts, callback) {
					if (!callback) {
						callback = opts;
						opts = {};
					}
					this.walkDecls((decl) => {
						if (opts.props && !opts.props.includes(decl.prop)) return;
						if (opts.fast && !decl.value.includes(opts.fast)) return;
						decl.value = decl.value.replace(pattern, callback);
					});
					this.markDirty();
					return this;
				}
				some(condition) {
					return this.nodes.some(condition);
				}
				walk(callback) {
					return this.each((child, i2) => {
						let result2;
						try {
							result2 = callback(child, i2);
						} catch (e2) {
							throw child.addToError(e2);
						}
						if (result2 !== false && child.walk) result2 = child.walk(callback);
						return result2;
					});
				}
				walkAtRules(name, callback) {
					if (!callback) {
						callback = name;
						return this.walk((child, i2) => {
							if (child.type === "atrule") return callback(child, i2);
						});
					}
					if (name instanceof RegExp) return this.walk((child, i2) => {
						if (child.type === "atrule" && name.test(child.name)) return callback(child, i2);
					});
					return this.walk((child, i2) => {
						if (child.type === "atrule" && child.name === name) return callback(child, i2);
					});
				}
				walkComments(callback) {
					return this.walk((child, i2) => {
						if (child.type === "comment") return callback(child, i2);
					});
				}
				walkDecls(prop, callback) {
					if (!callback) {
						callback = prop;
						return this.walk((child, i2) => {
							if (child.type === "decl") return callback(child, i2);
						});
					}
					if (prop instanceof RegExp) return this.walk((child, i2) => {
						if (child.type === "decl" && prop.test(child.prop)) return callback(child, i2);
					});
					return this.walk((child, i2) => {
						if (child.type === "decl" && child.prop === prop) return callback(child, i2);
					});
				}
				walkRules(selector, callback) {
					if (!callback) {
						callback = selector;
						return this.walk((child, i2) => {
							if (child.type === "rule") return callback(child, i2);
						});
					}
					if (selector instanceof RegExp) return this.walk((child, i2) => {
						if (child.type === "rule" && selector.test(child.selector)) return callback(child, i2);
					});
					return this.walk((child, i2) => {
						if (child.type === "rule" && child.selector === selector) return callback(child, i2);
					});
				}
				get first() {
					if (!this.proxyOf.nodes) return void 0;
					return this.proxyOf.nodes[0];
				}
				get last() {
					if (!this.proxyOf.nodes) return void 0;
					return this.proxyOf.nodes[this.proxyOf.nodes.length - 1];
				}
			}
			Container.registerParse = (dependant) => {
				parse = dependant;
			};
			Container.registerRule = (dependant) => {
				Rule = dependant;
			};
			Container.registerAtRule = (dependant) => {
				AtRule = dependant;
			};
			Container.registerRoot = (dependant) => {
				Root = dependant;
			};
			container = Container;
			Container.default = Container;
			Container.rebuild = (node2) => {
				if (node2.type === "atrule") Object.setPrototypeOf(node2, AtRule.prototype);
				else if (node2.type === "rule") Object.setPrototypeOf(node2, Rule.prototype);
				else if (node2.type === "decl") Object.setPrototypeOf(node2, Declaration.prototype);
				else if (node2.type === "comment") Object.setPrototypeOf(node2, Comment.prototype);
				else if (node2.type === "root") Object.setPrototypeOf(node2, Root.prototype);
				node2[my] = true;
				if (node2.nodes) node2.nodes.forEach((child) => {
					Container.rebuild(child);
				});
			};
			return container;
		}
		function requireDocument() {
			if (hasRequiredDocument) return document$1;
			hasRequiredDocument = 1;
			let Container = requireContainer();
			let LazyResult, Processor;
			class Document2 extends Container {
				constructor(defaults) {
					super({
						type: "document",
						...defaults
					});
					if (!this.nodes) this.nodes = [];
				}
				toResult(opts = {}) {
					return new LazyResult(new Processor(), this, opts).stringify();
				}
			}
			Document2.registerLazyResult = (dependant) => {
				LazyResult = dependant;
			};
			Document2.registerProcessor = (dependant) => {
				Processor = dependant;
			};
			document$1 = Document2;
			Document2.default = Document2;
			return document$1;
		}
		function requireWarnOnce() {
			if (hasRequiredWarnOnce) return warnOnce;
			hasRequiredWarnOnce = 1;
			let printed = {};
			warnOnce = function warnOnce2(message) {
				if (printed[message]) return;
				printed[message] = true;
				if (typeof console !== "undefined" && console.warn) console.warn(message);
			};
			return warnOnce;
		}
		function requireWarning() {
			if (hasRequiredWarning) return warning;
			hasRequiredWarning = 1;
			class Warning {
				constructor(text, opts = {}) {
					this.type = "warning";
					this.text = text;
					if (opts.node && opts.node.source) {
						let range = opts.node.rangeBy(opts);
						this.line = range.start.line;
						this.column = range.start.column;
						this.endLine = range.end.line;
						this.endColumn = range.end.column;
					}
					for (let opt in opts) this[opt] = opts[opt];
				}
				toString() {
					if (this.node) return this.node.error(this.text, {
						index: this.index,
						plugin: this.plugin,
						word: this.word
					}).message;
					if (this.plugin) return this.plugin + ": " + this.text;
					return this.text;
				}
			}
			warning = Warning;
			Warning.default = Warning;
			return warning;
		}
		function requireResult() {
			if (hasRequiredResult) return result;
			hasRequiredResult = 1;
			let Warning = requireWarning();
			class Result {
				constructor(processor2, root2, opts) {
					this.processor = processor2;
					this.messages = [];
					this.root = root2;
					this.opts = opts;
					this.css = void 0;
					this.map = void 0;
				}
				toString() {
					return this.css;
				}
				warn(text, opts = {}) {
					if (!opts.plugin) {
						if (this.lastPlugin && this.lastPlugin.postcssPlugin) opts.plugin = this.lastPlugin.postcssPlugin;
					}
					let warning2 = new Warning(text, opts);
					this.messages.push(warning2);
					return warning2;
				}
				warnings() {
					return this.messages.filter((i2) => i2.type === "warning");
				}
				get content() {
					return this.css;
				}
			}
			result = Result;
			Result.default = Result;
			return result;
		}
		function requireTokenize() {
			if (hasRequiredTokenize) return tokenize;
			hasRequiredTokenize = 1;
			const SINGLE_QUOTE = "'".charCodeAt(0);
			const DOUBLE_QUOTE = "\"".charCodeAt(0);
			const BACKSLASH = "\\".charCodeAt(0);
			const SLASH = "/".charCodeAt(0);
			const NEWLINE = "\n".charCodeAt(0);
			const SPACE = " ".charCodeAt(0);
			const FEED = "\f".charCodeAt(0);
			const TAB = "	".charCodeAt(0);
			const CR = "\r".charCodeAt(0);
			const OPEN_SQUARE = "[".charCodeAt(0);
			const CLOSE_SQUARE = "]".charCodeAt(0);
			const OPEN_PARENTHESES = "(".charCodeAt(0);
			const CLOSE_PARENTHESES = ")".charCodeAt(0);
			const OPEN_CURLY = "{".charCodeAt(0);
			const CLOSE_CURLY = "}".charCodeAt(0);
			const SEMICOLON = ";".charCodeAt(0);
			const ASTERISK = "*".charCodeAt(0);
			const COLON = ":".charCodeAt(0);
			const AT = "@".charCodeAt(0);
			const RE_AT_END = /[\t\n\f\r "#'()/;[\\\]{}]/g;
			const RE_WORD_END = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g;
			const RE_BAD_BRACKET = /.[\r\n"'(/\\]/;
			const RE_HEX_ESCAPE = /[\da-f]/i;
			tokenize = function tokenizer(input2, options = {}) {
				let css = input2.css.valueOf();
				let ignore = options.ignoreErrors;
				let code, next, quote, content, escape;
				let escaped, escapePos, prev, n2, currentToken;
				let length = css.length;
				let pos = 0;
				let buffer = [];
				let returned = [];
				function position() {
					return pos;
				}
				function unclosed(what) {
					throw input2.error("Unclosed " + what, pos);
				}
				function endOfFile() {
					return returned.length === 0 && pos >= length;
				}
				function nextToken(opts) {
					if (returned.length) return returned.pop();
					if (pos >= length) return;
					let ignoreUnclosed = opts ? opts.ignoreUnclosed : false;
					code = css.charCodeAt(pos);
					switch (code) {
						case NEWLINE:
						case SPACE:
						case TAB:
						case CR:
						case FEED:
							next = pos;
							do {
								next += 1;
								code = css.charCodeAt(next);
							} while (code === SPACE || code === NEWLINE || code === TAB || code === CR || code === FEED);
							currentToken = ["space", css.slice(pos, next)];
							pos = next - 1;
							break;
						case OPEN_SQUARE:
						case CLOSE_SQUARE:
						case OPEN_CURLY:
						case CLOSE_CURLY:
						case COLON:
						case SEMICOLON:
						case CLOSE_PARENTHESES: {
							let controlChar = String.fromCharCode(code);
							currentToken = [
								controlChar,
								controlChar,
								pos
							];
							break;
						}
						case OPEN_PARENTHESES:
							prev = buffer.length ? buffer.pop()[1] : "";
							n2 = css.charCodeAt(pos + 1);
							if (prev === "url" && n2 !== SINGLE_QUOTE && n2 !== DOUBLE_QUOTE && n2 !== SPACE && n2 !== NEWLINE && n2 !== TAB && n2 !== FEED && n2 !== CR) {
								next = pos;
								do {
									escaped = false;
									next = css.indexOf(")", next + 1);
									if (next === -1) if (ignore || ignoreUnclosed) {
										next = pos;
										break;
									} else unclosed("bracket");
									escapePos = next;
									while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
										escapePos -= 1;
										escaped = !escaped;
									}
								} while (escaped);
								currentToken = [
									"brackets",
									css.slice(pos, next + 1),
									pos,
									next
								];
								pos = next;
							} else {
								next = css.indexOf(")", pos + 1);
								content = css.slice(pos, next + 1);
								if (next === -1 || RE_BAD_BRACKET.test(content)) currentToken = [
									"(",
									"(",
									pos
								];
								else {
									currentToken = [
										"brackets",
										content,
										pos,
										next
									];
									pos = next;
								}
							}
							break;
						case SINGLE_QUOTE:
						case DOUBLE_QUOTE:
							quote = code === SINGLE_QUOTE ? "'" : "\"";
							next = pos;
							do {
								escaped = false;
								next = css.indexOf(quote, next + 1);
								if (next === -1) if (ignore || ignoreUnclosed) {
									next = pos + 1;
									break;
								} else unclosed("string");
								escapePos = next;
								while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
									escapePos -= 1;
									escaped = !escaped;
								}
							} while (escaped);
							currentToken = [
								"string",
								css.slice(pos, next + 1),
								pos,
								next
							];
							pos = next;
							break;
						case AT:
							RE_AT_END.lastIndex = pos + 1;
							RE_AT_END.test(css);
							if (RE_AT_END.lastIndex === 0) next = css.length - 1;
							else next = RE_AT_END.lastIndex - 2;
							currentToken = [
								"at-word",
								css.slice(pos, next + 1),
								pos,
								next
							];
							pos = next;
							break;
						case BACKSLASH:
							next = pos;
							escape = true;
							while (css.charCodeAt(next + 1) === BACKSLASH) {
								next += 1;
								escape = !escape;
							}
							code = css.charCodeAt(next + 1);
							if (escape && code !== SLASH && code !== SPACE && code !== NEWLINE && code !== TAB && code !== CR && code !== FEED) {
								next += 1;
								if (RE_HEX_ESCAPE.test(css.charAt(next))) {
									while (RE_HEX_ESCAPE.test(css.charAt(next + 1))) next += 1;
									if (css.charCodeAt(next + 1) === SPACE) next += 1;
								}
							}
							currentToken = [
								"word",
								css.slice(pos, next + 1),
								pos,
								next
							];
							pos = next;
							break;
						default:
							if (code === SLASH && css.charCodeAt(pos + 1) === ASTERISK) {
								next = css.indexOf("*/", pos + 2) + 1;
								if (next === 0) if (ignore || ignoreUnclosed) next = css.length;
								else unclosed("comment");
								currentToken = [
									"comment",
									css.slice(pos, next + 1),
									pos,
									next
								];
								pos = next;
							} else {
								RE_WORD_END.lastIndex = pos + 1;
								RE_WORD_END.test(css);
								if (RE_WORD_END.lastIndex === 0) next = css.length - 1;
								else next = RE_WORD_END.lastIndex - 2;
								currentToken = [
									"word",
									css.slice(pos, next + 1),
									pos,
									next
								];
								buffer.push(currentToken);
								pos = next;
							}
							break;
					}
					pos++;
					return currentToken;
				}
				function back(token) {
					returned.push(token);
				}
				return {
					back,
					endOfFile,
					nextToken,
					position
				};
			};
			return tokenize;
		}
		function requireAtRule() {
			if (hasRequiredAtRule) return atRule;
			hasRequiredAtRule = 1;
			let Container = requireContainer();
			class AtRule extends Container {
				constructor(defaults) {
					super(defaults);
					this.type = "atrule";
				}
				append(...children) {
					if (!this.proxyOf.nodes) this.nodes = [];
					return super.append(...children);
				}
				prepend(...children) {
					if (!this.proxyOf.nodes) this.nodes = [];
					return super.prepend(...children);
				}
			}
			atRule = AtRule;
			AtRule.default = AtRule;
			Container.registerAtRule(AtRule);
			return atRule;
		}
		function requireRoot() {
			if (hasRequiredRoot) return root;
			hasRequiredRoot = 1;
			let Container = requireContainer();
			let LazyResult, Processor;
			class Root extends Container {
				constructor(defaults) {
					super(defaults);
					this.type = "root";
					if (!this.nodes) this.nodes = [];
				}
				normalize(child, sample, type) {
					let nodes = super.normalize(child);
					if (sample) {
						if (type === "prepend") if (this.nodes.length > 1) sample.raws.before = this.nodes[1].raws.before;
						else delete sample.raws.before;
						else if (this.first !== sample) for (let node2 of nodes) node2.raws.before = sample.raws.before;
					}
					return nodes;
				}
				removeChild(child, ignore) {
					let index2 = this.index(child);
					if (!ignore && index2 === 0 && this.nodes.length > 1) this.nodes[1].raws.before = this.nodes[index2].raws.before;
					return super.removeChild(child);
				}
				toResult(opts = {}) {
					return new LazyResult(new Processor(), this, opts).stringify();
				}
			}
			Root.registerLazyResult = (dependant) => {
				LazyResult = dependant;
			};
			Root.registerProcessor = (dependant) => {
				Processor = dependant;
			};
			root = Root;
			Root.default = Root;
			Container.registerRoot(Root);
			return root;
		}
		function requireList() {
			if (hasRequiredList) return list_1;
			hasRequiredList = 1;
			let list = {
				comma(string) {
					return list.split(string, [","], true);
				},
				space(string) {
					return list.split(string, [
						" ",
						"\n",
						"	"
					]);
				},
				split(string, separators, last) {
					let array = [];
					let current = "";
					let split = false;
					let func = 0;
					let inQuote = false;
					let prevQuote = "";
					let escape = false;
					for (let letter of string) {
						if (escape) escape = false;
						else if (letter === "\\") escape = true;
						else if (inQuote) {
							if (letter === prevQuote) inQuote = false;
						} else if (letter === "\"" || letter === "'") {
							inQuote = true;
							prevQuote = letter;
						} else if (letter === "(") func += 1;
						else if (letter === ")") {
							if (func > 0) func -= 1;
						} else if (func === 0) {
							if (separators.includes(letter)) split = true;
						}
						if (split) {
							if (current !== "") array.push(current.trim());
							current = "";
							split = false;
						} else current += letter;
					}
					if (last || current !== "") array.push(current.trim());
					return array;
				}
			};
			list_1 = list;
			list.default = list;
			return list_1;
		}
		function requireRule() {
			if (hasRequiredRule) return rule;
			hasRequiredRule = 1;
			let Container = requireContainer();
			let list = requireList();
			class Rule extends Container {
				constructor(defaults) {
					super(defaults);
					this.type = "rule";
					if (!this.nodes) this.nodes = [];
				}
				get selectors() {
					return list.comma(this.selector);
				}
				set selectors(values) {
					let match = this.selector ? this.selector.match(/,\s*/) : null;
					let sep = match ? match[0] : "," + this.raw("between", "beforeOpen");
					this.selector = values.join(sep);
				}
			}
			rule = Rule;
			Rule.default = Rule;
			Container.registerRule(Rule);
			return rule;
		}
		function requireParser() {
			if (hasRequiredParser) return parser;
			hasRequiredParser = 1;
			let Declaration = requireDeclaration();
			let tokenizer = requireTokenize();
			let Comment = requireComment();
			let AtRule = requireAtRule();
			let Root = requireRoot();
			let Rule = requireRule();
			const SAFE_COMMENT_NEIGHBOR = {
				empty: true,
				space: true
			};
			function findLastWithPosition(tokens) {
				for (let i2 = tokens.length - 1; i2 >= 0; i2--) {
					let token = tokens[i2];
					let pos = token[3] || token[2];
					if (pos) return pos;
				}
			}
			class Parser {
				constructor(input2) {
					this.input = input2;
					this.root = new Root();
					this.current = this.root;
					this.spaces = "";
					this.semicolon = false;
					this.createTokenizer();
					this.root.source = {
						input: input2,
						start: {
							column: 1,
							line: 1,
							offset: 0
						}
					};
				}
				atrule(token) {
					let node2 = new AtRule();
					node2.name = token[1].slice(1);
					if (node2.name === "") this.unnamedAtrule(node2, token);
					this.init(node2, token[2]);
					let type;
					let prev;
					let shift;
					let last = false;
					let open = false;
					let params = [];
					let brackets = [];
					while (!this.tokenizer.endOfFile()) {
						token = this.tokenizer.nextToken();
						type = token[0];
						if (type === "(" || type === "[") brackets.push(type === "(" ? ")" : "]");
						else if (type === "{" && brackets.length > 0) brackets.push("}");
						else if (type === brackets[brackets.length - 1]) brackets.pop();
						if (brackets.length === 0) if (type === ";") {
							node2.source.end = this.getPosition(token[2]);
							node2.source.end.offset++;
							this.semicolon = true;
							break;
						} else if (type === "{") {
							open = true;
							break;
						} else if (type === "}") {
							if (params.length > 0) {
								shift = params.length - 1;
								prev = params[shift];
								while (prev && prev[0] === "space") prev = params[--shift];
								if (prev) {
									node2.source.end = this.getPosition(prev[3] || prev[2]);
									node2.source.end.offset++;
								}
							}
							this.end(token);
							break;
						} else params.push(token);
						else params.push(token);
						if (this.tokenizer.endOfFile()) {
							last = true;
							break;
						}
					}
					node2.raws.between = this.spacesAndCommentsFromEnd(params);
					if (params.length) {
						node2.raws.afterName = this.spacesAndCommentsFromStart(params);
						this.raw(node2, "params", params);
						if (last) {
							token = params[params.length - 1];
							node2.source.end = this.getPosition(token[3] || token[2]);
							node2.source.end.offset++;
							this.spaces = node2.raws.between;
							node2.raws.between = "";
						}
					} else {
						node2.raws.afterName = "";
						node2.params = "";
					}
					if (open) {
						node2.nodes = [];
						this.current = node2;
					}
				}
				checkMissedSemicolon(tokens) {
					let colon = this.colon(tokens);
					if (colon === false) return;
					let founded = 0;
					let token;
					for (let j = colon - 1; j >= 0; j--) {
						token = tokens[j];
						if (token[0] !== "space") {
							founded += 1;
							if (founded === 2) break;
						}
					}
					throw this.input.error("Missed semicolon", token[0] === "word" ? token[3] + 1 : token[2]);
				}
				colon(tokens) {
					let brackets = 0;
					let token, type, prev;
					for (let [i2, element] of tokens.entries()) {
						token = element;
						type = token[0];
						if (type === "(") brackets += 1;
						if (type === ")") brackets -= 1;
						if (brackets === 0 && type === ":") if (!prev) this.doubleColon(token);
						else if (prev[0] === "word" && prev[1] === "progid") continue;
						else return i2;
						prev = token;
					}
					return false;
				}
				comment(token) {
					let node2 = new Comment();
					this.init(node2, token[2]);
					node2.source.end = this.getPosition(token[3] || token[2]);
					node2.source.end.offset++;
					let text = token[1].slice(2, -2);
					if (/^\s*$/.test(text)) {
						node2.text = "";
						node2.raws.left = text;
						node2.raws.right = "";
					} else {
						let match = text.match(/^(\s*)([^]*\S)(\s*)$/);
						node2.text = match[2];
						node2.raws.left = match[1];
						node2.raws.right = match[3];
					}
				}
				createTokenizer() {
					this.tokenizer = tokenizer(this.input);
				}
				decl(tokens, customProperty) {
					let node2 = new Declaration();
					this.init(node2, tokens[0][2]);
					let last = tokens[tokens.length - 1];
					if (last[0] === ";") {
						this.semicolon = true;
						tokens.pop();
					}
					node2.source.end = this.getPosition(last[3] || last[2] || findLastWithPosition(tokens));
					node2.source.end.offset++;
					while (tokens[0][0] !== "word") {
						if (tokens.length === 1) this.unknownWord(tokens);
						node2.raws.before += tokens.shift()[1];
					}
					node2.source.start = this.getPosition(tokens[0][2]);
					node2.prop = "";
					while (tokens.length) {
						let type = tokens[0][0];
						if (type === ":" || type === "space" || type === "comment") break;
						node2.prop += tokens.shift()[1];
					}
					node2.raws.between = "";
					let token;
					while (tokens.length) {
						token = tokens.shift();
						if (token[0] === ":") {
							node2.raws.between += token[1];
							break;
						} else {
							if (token[0] === "word" && /\w/.test(token[1])) this.unknownWord([token]);
							node2.raws.between += token[1];
						}
					}
					if (node2.prop[0] === "_" || node2.prop[0] === "*") {
						node2.raws.before += node2.prop[0];
						node2.prop = node2.prop.slice(1);
					}
					let firstSpaces = [];
					let next;
					while (tokens.length) {
						next = tokens[0][0];
						if (next !== "space" && next !== "comment") break;
						firstSpaces.push(tokens.shift());
					}
					this.precheckMissedSemicolon(tokens);
					for (let i2 = tokens.length - 1; i2 >= 0; i2--) {
						token = tokens[i2];
						if (token[1].toLowerCase() === "!important") {
							node2.important = true;
							let string = this.stringFrom(tokens, i2);
							string = this.spacesFromEnd(tokens) + string;
							if (string !== " !important") node2.raws.important = string;
							break;
						} else if (token[1].toLowerCase() === "important") {
							let cache = tokens.slice(0);
							let str = "";
							for (let j = i2; j > 0; j--) {
								let type = cache[j][0];
								if (str.trim().indexOf("!") === 0 && type !== "space") break;
								str = cache.pop()[1] + str;
							}
							if (str.trim().indexOf("!") === 0) {
								node2.important = true;
								node2.raws.important = str;
								tokens = cache;
							}
						}
						if (token[0] !== "space" && token[0] !== "comment") break;
					}
					if (tokens.some((i2) => i2[0] !== "space" && i2[0] !== "comment")) {
						node2.raws.between += firstSpaces.map((i2) => i2[1]).join("");
						firstSpaces = [];
					}
					this.raw(node2, "value", firstSpaces.concat(tokens), customProperty);
					if (node2.value.includes(":") && !customProperty) this.checkMissedSemicolon(tokens);
				}
				doubleColon(token) {
					throw this.input.error("Double colon", { offset: token[2] }, { offset: token[2] + token[1].length });
				}
				emptyRule(token) {
					let node2 = new Rule();
					this.init(node2, token[2]);
					node2.selector = "";
					node2.raws.between = "";
					this.current = node2;
				}
				end(token) {
					if (this.current.nodes && this.current.nodes.length) this.current.raws.semicolon = this.semicolon;
					this.semicolon = false;
					this.current.raws.after = (this.current.raws.after || "") + this.spaces;
					this.spaces = "";
					if (this.current.parent) {
						this.current.source.end = this.getPosition(token[2]);
						this.current.source.end.offset++;
						this.current = this.current.parent;
					} else this.unexpectedClose(token);
				}
				endFile() {
					if (this.current.parent) this.unclosedBlock();
					if (this.current.nodes && this.current.nodes.length) this.current.raws.semicolon = this.semicolon;
					this.current.raws.after = (this.current.raws.after || "") + this.spaces;
					this.root.source.end = this.getPosition(this.tokenizer.position());
				}
				freeSemicolon(token) {
					this.spaces += token[1];
					if (this.current.nodes) {
						let prev = this.current.nodes[this.current.nodes.length - 1];
						if (prev && prev.type === "rule" && !prev.raws.ownSemicolon) {
							prev.raws.ownSemicolon = this.spaces;
							this.spaces = "";
						}
					}
				}
				getPosition(offset) {
					let pos = this.input.fromOffset(offset);
					return {
						column: pos.col,
						line: pos.line,
						offset
					};
				}
				init(node2, offset) {
					this.current.push(node2);
					node2.source = {
						input: this.input,
						start: this.getPosition(offset)
					};
					node2.raws.before = this.spaces;
					this.spaces = "";
					if (node2.type !== "comment") this.semicolon = false;
				}
				other(start) {
					let end = false;
					let type = null;
					let colon = false;
					let bracket = null;
					let brackets = [];
					let customProperty = start[1].startsWith("--");
					let tokens = [];
					let token = start;
					while (token) {
						type = token[0];
						tokens.push(token);
						if (type === "(" || type === "[") {
							if (!bracket) bracket = token;
							brackets.push(type === "(" ? ")" : "]");
						} else if (customProperty && colon && type === "{") {
							if (!bracket) bracket = token;
							brackets.push("}");
						} else if (brackets.length === 0) {
							if (type === ";") if (colon) {
								this.decl(tokens, customProperty);
								return;
							} else break;
							else if (type === "{") {
								this.rule(tokens);
								return;
							} else if (type === "}") {
								this.tokenizer.back(tokens.pop());
								end = true;
								break;
							} else if (type === ":") colon = true;
						} else if (type === brackets[brackets.length - 1]) {
							brackets.pop();
							if (brackets.length === 0) bracket = null;
						}
						token = this.tokenizer.nextToken();
					}
					if (this.tokenizer.endOfFile()) end = true;
					if (brackets.length > 0) this.unclosedBracket(bracket);
					if (end && colon) {
						if (!customProperty) while (tokens.length) {
							token = tokens[tokens.length - 1][0];
							if (token !== "space" && token !== "comment") break;
							this.tokenizer.back(tokens.pop());
						}
						this.decl(tokens, customProperty);
					} else this.unknownWord(tokens);
				}
				parse() {
					let token;
					while (!this.tokenizer.endOfFile()) {
						token = this.tokenizer.nextToken();
						switch (token[0]) {
							case "space":
								this.spaces += token[1];
								break;
							case ";":
								this.freeSemicolon(token);
								break;
							case "}":
								this.end(token);
								break;
							case "comment":
								this.comment(token);
								break;
							case "at-word":
								this.atrule(token);
								break;
							case "{":
								this.emptyRule(token);
								break;
							default:
								this.other(token);
								break;
						}
					}
					this.endFile();
				}
				precheckMissedSemicolon() {}
				raw(node2, prop, tokens, customProperty) {
					let token, type;
					let length = tokens.length;
					let value = "";
					let clean = true;
					let next, prev;
					for (let i2 = 0; i2 < length; i2 += 1) {
						token = tokens[i2];
						type = token[0];
						if (type === "space" && i2 === length - 1 && !customProperty) clean = false;
						else if (type === "comment") {
							prev = tokens[i2 - 1] ? tokens[i2 - 1][0] : "empty";
							next = tokens[i2 + 1] ? tokens[i2 + 1][0] : "empty";
							if (!SAFE_COMMENT_NEIGHBOR[prev] && !SAFE_COMMENT_NEIGHBOR[next]) if (value.slice(-1) === ",") clean = false;
							else value += token[1];
							else clean = false;
						} else value += token[1];
					}
					if (!clean) {
						let raw = tokens.reduce((all, i2) => all + i2[1], "");
						node2.raws[prop] = {
							raw,
							value
						};
					}
					node2[prop] = value;
				}
				rule(tokens) {
					tokens.pop();
					let node2 = new Rule();
					this.init(node2, tokens[0][2]);
					node2.raws.between = this.spacesAndCommentsFromEnd(tokens);
					this.raw(node2, "selector", tokens);
					this.current = node2;
				}
				spacesAndCommentsFromEnd(tokens) {
					let lastTokenType;
					let spaces = "";
					while (tokens.length) {
						lastTokenType = tokens[tokens.length - 1][0];
						if (lastTokenType !== "space" && lastTokenType !== "comment") break;
						spaces = tokens.pop()[1] + spaces;
					}
					return spaces;
				}
				spacesAndCommentsFromStart(tokens) {
					let next;
					let spaces = "";
					while (tokens.length) {
						next = tokens[0][0];
						if (next !== "space" && next !== "comment") break;
						spaces += tokens.shift()[1];
					}
					return spaces;
				}
				spacesFromEnd(tokens) {
					let lastTokenType;
					let spaces = "";
					while (tokens.length) {
						lastTokenType = tokens[tokens.length - 1][0];
						if (lastTokenType !== "space") break;
						spaces = tokens.pop()[1] + spaces;
					}
					return spaces;
				}
				stringFrom(tokens, from) {
					let result2 = "";
					for (let i2 = from; i2 < tokens.length; i2++) result2 += tokens[i2][1];
					tokens.splice(from, tokens.length - from);
					return result2;
				}
				unclosedBlock() {
					let pos = this.current.source.start;
					throw this.input.error("Unclosed block", pos.line, pos.column);
				}
				unclosedBracket(bracket) {
					throw this.input.error("Unclosed bracket", { offset: bracket[2] }, { offset: bracket[2] + 1 });
				}
				unexpectedClose(token) {
					throw this.input.error("Unexpected }", { offset: token[2] }, { offset: token[2] + 1 });
				}
				unknownWord(tokens) {
					throw this.input.error("Unknown word", { offset: tokens[0][2] }, { offset: tokens[0][2] + tokens[0][1].length });
				}
				unnamedAtrule(node2, token) {
					throw this.input.error("At-rule without name", { offset: token[2] }, { offset: token[2] + token[1].length });
				}
			}
			parser = Parser;
			return parser;
		}
		function requireParse() {
			if (hasRequiredParse) return parse_1;
			hasRequiredParse = 1;
			let Container = requireContainer();
			let Parser = requireParser();
			let Input = requireInput();
			function parse(css, opts) {
				let input2 = new Input(css, opts);
				let parser2 = new Parser(input2);
				try {
					parser2.parse();
				} catch (e2) {
					throw e2;
				}
				return parser2.root;
			}
			parse_1 = parse;
			parse.default = parse;
			Container.registerParse(parse);
			return parse_1;
		}
		function requireLazyResult() {
			if (hasRequiredLazyResult) return lazyResult;
			hasRequiredLazyResult = 1;
			let { isClean, my } = requireSymbols();
			let MapGenerator = requireMapGenerator();
			let stringify = requireStringify();
			let Container = requireContainer();
			let Document2 = requireDocument();
			requireWarnOnce();
			let Result = requireResult();
			let parse = requireParse();
			let Root = requireRoot();
			const TYPE_TO_CLASS_NAME = {
				atrule: "AtRule",
				comment: "Comment",
				decl: "Declaration",
				document: "Document",
				root: "Root",
				rule: "Rule"
			};
			const PLUGIN_PROPS = {
				AtRule: true,
				AtRuleExit: true,
				Comment: true,
				CommentExit: true,
				Declaration: true,
				DeclarationExit: true,
				Document: true,
				DocumentExit: true,
				Once: true,
				OnceExit: true,
				postcssPlugin: true,
				prepare: true,
				Root: true,
				RootExit: true,
				Rule: true,
				RuleExit: true
			};
			const NOT_VISITORS = {
				Once: true,
				postcssPlugin: true,
				prepare: true
			};
			const CHILDREN = 0;
			function isPromise(obj) {
				return typeof obj === "object" && typeof obj.then === "function";
			}
			function getEvents(node2) {
				let key = false;
				let type = TYPE_TO_CLASS_NAME[node2.type];
				if (node2.type === "decl") key = node2.prop.toLowerCase();
				else if (node2.type === "atrule") key = node2.name.toLowerCase();
				if (key && node2.append) return [
					type,
					type + "-" + key,
					CHILDREN,
					type + "Exit",
					type + "Exit-" + key
				];
				else if (key) return [
					type,
					type + "-" + key,
					type + "Exit",
					type + "Exit-" + key
				];
				else if (node2.append) return [
					type,
					CHILDREN,
					type + "Exit"
				];
				else return [type, type + "Exit"];
			}
			function toStack(node2) {
				let events;
				if (node2.type === "document") events = [
					"Document",
					CHILDREN,
					"DocumentExit"
				];
				else if (node2.type === "root") events = [
					"Root",
					CHILDREN,
					"RootExit"
				];
				else events = getEvents(node2);
				return {
					eventIndex: 0,
					events,
					iterator: 0,
					node: node2,
					visitorIndex: 0,
					visitors: []
				};
			}
			function cleanMarks(node2) {
				node2[isClean] = false;
				if (node2.nodes) node2.nodes.forEach((i2) => cleanMarks(i2));
				return node2;
			}
			let postcss2 = {};
			class LazyResult {
				constructor(processor2, css, opts) {
					this.stringified = false;
					this.processed = false;
					let root2;
					if (typeof css === "object" && css !== null && (css.type === "root" || css.type === "document")) root2 = cleanMarks(css);
					else if (css instanceof LazyResult || css instanceof Result) {
						root2 = cleanMarks(css.root);
						if (css.map) {
							if (typeof opts.map === "undefined") opts.map = {};
							if (!opts.map.inline) opts.map.inline = false;
							opts.map.prev = css.map;
						}
					} else {
						let parser2 = parse;
						if (opts.syntax) parser2 = opts.syntax.parse;
						if (opts.parser) parser2 = opts.parser;
						if (parser2.parse) parser2 = parser2.parse;
						try {
							root2 = parser2(css, opts);
						} catch (error) {
							this.processed = true;
							this.error = error;
						}
						if (root2 && !root2[my]) Container.rebuild(root2);
					}
					this.result = new Result(processor2, root2, opts);
					this.helpers = {
						...postcss2,
						postcss: postcss2,
						result: this.result
					};
					this.plugins = this.processor.plugins.map((plugin) => {
						if (typeof plugin === "object" && plugin.prepare) return {
							...plugin,
							...plugin.prepare(this.result)
						};
						else return plugin;
					});
				}
				async() {
					if (this.error) return Promise.reject(this.error);
					if (this.processed) return Promise.resolve(this.result);
					if (!this.processing) this.processing = this.runAsync();
					return this.processing;
				}
				catch(onRejected) {
					return this.async().catch(onRejected);
				}
				finally(onFinally) {
					return this.async().then(onFinally, onFinally);
				}
				getAsyncError() {
					throw new Error("Use process(css).then(cb) to work with async plugins");
				}
				handleError(error, node2) {
					let plugin = this.result.lastPlugin;
					try {
						if (node2) node2.addToError(error);
						this.error = error;
						if (error.name === "CssSyntaxError" && !error.plugin) {
							error.plugin = plugin.postcssPlugin;
							error.setMessage();
						} else if (plugin.postcssVersion) {}
					} catch (err) {
						if (console && console.error) console.error(err);
					}
					return error;
				}
				prepareVisitors() {
					this.listeners = {};
					let add = (plugin, type, cb) => {
						if (!this.listeners[type]) this.listeners[type] = [];
						this.listeners[type].push([plugin, cb]);
					};
					for (let plugin of this.plugins) if (typeof plugin === "object") for (let event in plugin) {
						if (!PLUGIN_PROPS[event] && /^[A-Z]/.test(event)) throw new Error(`Unknown event ${event} in ${plugin.postcssPlugin}. Try to update PostCSS (${this.processor.version} now).`);
						if (!NOT_VISITORS[event]) {
							if (typeof plugin[event] === "object") for (let filter in plugin[event]) if (filter === "*") add(plugin, event, plugin[event][filter]);
							else add(plugin, event + "-" + filter.toLowerCase(), plugin[event][filter]);
							else if (typeof plugin[event] === "function") add(plugin, event, plugin[event]);
						}
					}
					this.hasListener = Object.keys(this.listeners).length > 0;
				}
				async runAsync() {
					this.plugin = 0;
					for (let i2 = 0; i2 < this.plugins.length; i2++) {
						let plugin = this.plugins[i2];
						let promise = this.runOnRoot(plugin);
						if (isPromise(promise)) try {
							await promise;
						} catch (error) {
							throw this.handleError(error);
						}
					}
					this.prepareVisitors();
					if (this.hasListener) {
						let root2 = this.result.root;
						while (!root2[isClean]) {
							root2[isClean] = true;
							let stack = [toStack(root2)];
							while (stack.length > 0) {
								let promise = this.visitTick(stack);
								if (isPromise(promise)) try {
									await promise;
								} catch (e2) {
									let node2 = stack[stack.length - 1].node;
									throw this.handleError(e2, node2);
								}
							}
						}
						if (this.listeners.OnceExit) for (let [plugin, visitor] of this.listeners.OnceExit) {
							this.result.lastPlugin = plugin;
							try {
								if (root2.type === "document") {
									let roots = root2.nodes.map((subRoot) => visitor(subRoot, this.helpers));
									await Promise.all(roots);
								} else await visitor(root2, this.helpers);
							} catch (e2) {
								throw this.handleError(e2);
							}
						}
					}
					this.processed = true;
					return this.stringify();
				}
				runOnRoot(plugin) {
					this.result.lastPlugin = plugin;
					try {
						if (typeof plugin === "object" && plugin.Once) {
							if (this.result.root.type === "document") {
								let roots = this.result.root.nodes.map((root2) => plugin.Once(root2, this.helpers));
								if (isPromise(roots[0])) return Promise.all(roots);
								return roots;
							}
							return plugin.Once(this.result.root, this.helpers);
						} else if (typeof plugin === "function") return plugin(this.result.root, this.result);
					} catch (error) {
						throw this.handleError(error);
					}
				}
				stringify() {
					if (this.error) throw this.error;
					if (this.stringified) return this.result;
					this.stringified = true;
					this.sync();
					let opts = this.result.opts;
					let str = stringify;
					if (opts.syntax) str = opts.syntax.stringify;
					if (opts.stringifier) str = opts.stringifier;
					if (str.stringify) str = str.stringify;
					let data = new MapGenerator(str, this.result.root, this.result.opts).generate();
					this.result.css = data[0];
					this.result.map = data[1];
					return this.result;
				}
				sync() {
					if (this.error) throw this.error;
					if (this.processed) return this.result;
					this.processed = true;
					if (this.processing) throw this.getAsyncError();
					for (let plugin of this.plugins) if (isPromise(this.runOnRoot(plugin))) throw this.getAsyncError();
					this.prepareVisitors();
					if (this.hasListener) {
						let root2 = this.result.root;
						while (!root2[isClean]) {
							root2[isClean] = true;
							this.walkSync(root2);
						}
						if (this.listeners.OnceExit) if (root2.type === "document") for (let subRoot of root2.nodes) this.visitSync(this.listeners.OnceExit, subRoot);
						else this.visitSync(this.listeners.OnceExit, root2);
					}
					return this.result;
				}
				then(onFulfilled, onRejected) {
					return this.async().then(onFulfilled, onRejected);
				}
				toString() {
					return this.css;
				}
				visitSync(visitors, node2) {
					for (let [plugin, visitor] of visitors) {
						this.result.lastPlugin = plugin;
						let promise;
						try {
							promise = visitor(node2, this.helpers);
						} catch (e2) {
							throw this.handleError(e2, node2.proxyOf);
						}
						if (node2.type !== "root" && node2.type !== "document" && !node2.parent) return true;
						if (isPromise(promise)) throw this.getAsyncError();
					}
				}
				visitTick(stack) {
					let visit2 = stack[stack.length - 1];
					let { node: node2, visitors } = visit2;
					if (node2.type !== "root" && node2.type !== "document" && !node2.parent) {
						stack.pop();
						return;
					}
					if (visitors.length > 0 && visit2.visitorIndex < visitors.length) {
						let [plugin, visitor] = visitors[visit2.visitorIndex];
						visit2.visitorIndex += 1;
						if (visit2.visitorIndex === visitors.length) {
							visit2.visitors = [];
							visit2.visitorIndex = 0;
						}
						this.result.lastPlugin = plugin;
						try {
							return visitor(node2.toProxy(), this.helpers);
						} catch (e2) {
							throw this.handleError(e2, node2);
						}
					}
					if (visit2.iterator !== 0) {
						let iterator = visit2.iterator;
						let child;
						while (child = node2.nodes[node2.indexes[iterator]]) {
							node2.indexes[iterator] += 1;
							if (!child[isClean]) {
								child[isClean] = true;
								stack.push(toStack(child));
								return;
							}
						}
						visit2.iterator = 0;
						delete node2.indexes[iterator];
					}
					let events = visit2.events;
					while (visit2.eventIndex < events.length) {
						let event = events[visit2.eventIndex];
						visit2.eventIndex += 1;
						if (event === CHILDREN) {
							if (node2.nodes && node2.nodes.length) {
								node2[isClean] = true;
								visit2.iterator = node2.getIterator();
							}
							return;
						} else if (this.listeners[event]) {
							visit2.visitors = this.listeners[event];
							return;
						}
					}
					stack.pop();
				}
				walkSync(node2) {
					node2[isClean] = true;
					let events = getEvents(node2);
					for (let event of events) if (event === CHILDREN) {
						if (node2.nodes) node2.each((child) => {
							if (!child[isClean]) this.walkSync(child);
						});
					} else {
						let visitors = this.listeners[event];
						if (visitors) {
							if (this.visitSync(visitors, node2.toProxy())) return;
						}
					}
				}
				warnings() {
					return this.sync().warnings();
				}
				get content() {
					return this.stringify().content;
				}
				get css() {
					return this.stringify().css;
				}
				get map() {
					return this.stringify().map;
				}
				get messages() {
					return this.sync().messages;
				}
				get opts() {
					return this.result.opts;
				}
				get processor() {
					return this.result.processor;
				}
				get root() {
					return this.sync().root;
				}
				get [Symbol.toStringTag]() {
					return "LazyResult";
				}
			}
			LazyResult.registerPostcss = (dependant) => {
				postcss2 = dependant;
			};
			lazyResult = LazyResult;
			LazyResult.default = LazyResult;
			Root.registerLazyResult(LazyResult);
			Document2.registerLazyResult(LazyResult);
			return lazyResult;
		}
		function requireNoWorkResult() {
			if (hasRequiredNoWorkResult) return noWorkResult;
			hasRequiredNoWorkResult = 1;
			let MapGenerator = requireMapGenerator();
			let stringify = requireStringify();
			requireWarnOnce();
			let parse = requireParse();
			const Result = requireResult();
			class NoWorkResult {
				constructor(processor2, css, opts) {
					css = css.toString();
					this.stringified = false;
					this._processor = processor2;
					this._css = css;
					this._opts = opts;
					this._map = void 0;
					let root2;
					let str = stringify;
					this.result = new Result(this._processor, root2, this._opts);
					this.result.css = css;
					let self2 = this;
					Object.defineProperty(this.result, "root", { get() {
						return self2.root;
					} });
					let map = new MapGenerator(str, root2, this._opts, css);
					if (map.isMap()) {
						let [generatedCSS, generatedMap] = map.generate();
						if (generatedCSS) this.result.css = generatedCSS;
						if (generatedMap) this.result.map = generatedMap;
					} else {
						map.clearAnnotation();
						this.result.css = map.css;
					}
				}
				async() {
					if (this.error) return Promise.reject(this.error);
					return Promise.resolve(this.result);
				}
				catch(onRejected) {
					return this.async().catch(onRejected);
				}
				finally(onFinally) {
					return this.async().then(onFinally, onFinally);
				}
				sync() {
					if (this.error) throw this.error;
					return this.result;
				}
				then(onFulfilled, onRejected) {
					return this.async().then(onFulfilled, onRejected);
				}
				toString() {
					return this._css;
				}
				warnings() {
					return [];
				}
				get content() {
					return this.result.css;
				}
				get css() {
					return this.result.css;
				}
				get map() {
					return this.result.map;
				}
				get messages() {
					return [];
				}
				get opts() {
					return this.result.opts;
				}
				get processor() {
					return this.result.processor;
				}
				get root() {
					if (this._root) return this._root;
					let root2;
					let parser2 = parse;
					try {
						root2 = parser2(this._css, this._opts);
					} catch (error) {
						this.error = error;
					}
					if (this.error) throw this.error;
					else {
						this._root = root2;
						return root2;
					}
				}
				get [Symbol.toStringTag]() {
					return "NoWorkResult";
				}
			}
			noWorkResult = NoWorkResult;
			NoWorkResult.default = NoWorkResult;
			return noWorkResult;
		}
		function requireProcessor() {
			if (hasRequiredProcessor) return processor;
			hasRequiredProcessor = 1;
			let NoWorkResult = requireNoWorkResult();
			let LazyResult = requireLazyResult();
			let Document2 = requireDocument();
			let Root = requireRoot();
			class Processor {
				constructor(plugins = []) {
					this.version = "8.4.38";
					this.plugins = this.normalize(plugins);
				}
				normalize(plugins) {
					let normalized = [];
					for (let i2 of plugins) {
						if (i2.postcss === true) i2 = i2();
						else if (i2.postcss) i2 = i2.postcss;
						if (typeof i2 === "object" && Array.isArray(i2.plugins)) normalized = normalized.concat(i2.plugins);
						else if (typeof i2 === "object" && i2.postcssPlugin) normalized.push(i2);
						else if (typeof i2 === "function") normalized.push(i2);
						else if (typeof i2 === "object" && (i2.parse || i2.stringify)) {} else throw new Error(i2 + " is not a PostCSS plugin");
					}
					return normalized;
				}
				process(css, opts = {}) {
					if (!this.plugins.length && !opts.parser && !opts.stringifier && !opts.syntax) return new NoWorkResult(this, css, opts);
					else return new LazyResult(this, css, opts);
				}
				use(plugin) {
					this.plugins = this.plugins.concat(this.normalize([plugin]));
					return this;
				}
			}
			processor = Processor;
			Processor.default = Processor;
			Root.registerProcessor(Processor);
			Document2.registerProcessor(Processor);
			return processor;
		}
		function requireFromJSON() {
			if (hasRequiredFromJSON) return fromJSON_1;
			hasRequiredFromJSON = 1;
			let Declaration = requireDeclaration();
			let PreviousMap = requirePreviousMap();
			let Comment = requireComment();
			let AtRule = requireAtRule();
			let Input = requireInput();
			let Root = requireRoot();
			let Rule = requireRule();
			function fromJSON(json, inputs) {
				if (Array.isArray(json)) return json.map((n2) => fromJSON(n2));
				let { inputs: ownInputs, ...defaults } = json;
				if (ownInputs) {
					inputs = [];
					for (let input2 of ownInputs) {
						let inputHydrated = {
							...input2,
							__proto__: Input.prototype
						};
						if (inputHydrated.map) inputHydrated.map = {
							...inputHydrated.map,
							__proto__: PreviousMap.prototype
						};
						inputs.push(inputHydrated);
					}
				}
				if (defaults.nodes) defaults.nodes = json.nodes.map((n2) => fromJSON(n2, inputs));
				if (defaults.source) {
					let { inputId, ...source } = defaults.source;
					defaults.source = source;
					if (inputId != null) defaults.source.input = inputs[inputId];
				}
				if (defaults.type === "root") return new Root(defaults);
				else if (defaults.type === "decl") return new Declaration(defaults);
				else if (defaults.type === "rule") return new Rule(defaults);
				else if (defaults.type === "comment") return new Comment(defaults);
				else if (defaults.type === "atrule") return new AtRule(defaults);
				else throw new Error("Unknown node type: " + json.type);
			}
			fromJSON_1 = fromJSON;
			fromJSON.default = fromJSON;
			return fromJSON_1;
		}
		function requirePostcss() {
			if (hasRequiredPostcss) return postcss_1;
			hasRequiredPostcss = 1;
			let CssSyntaxError = requireCssSyntaxError();
			let Declaration = requireDeclaration();
			let LazyResult = requireLazyResult();
			let Container = requireContainer();
			let Processor = requireProcessor();
			let stringify = requireStringify();
			let fromJSON = requireFromJSON();
			let Document2 = requireDocument();
			let Warning = requireWarning();
			let Comment = requireComment();
			let AtRule = requireAtRule();
			let Result = requireResult();
			let Input = requireInput();
			let parse = requireParse();
			let list = requireList();
			let Rule = requireRule();
			let Root = requireRoot();
			let Node2 = requireNode();
			function postcss2(...plugins) {
				if (plugins.length === 1 && Array.isArray(plugins[0])) plugins = plugins[0];
				return new Processor(plugins);
			}
			postcss2.plugin = function plugin(name, initializer) {
				let warningPrinted = false;
				function creator(...args) {
					if (console && console.warn && !warningPrinted) {
						warningPrinted = true;
						console.warn(name + ": postcss.plugin was deprecated. Migration guide:\nhttps://evilmartians.com/chronicles/postcss-8-plugin-migration");
						if (process.env.LANG && process.env.LANG.startsWith("cn")) console.warn(name + ": 里面 postcss.plugin 被弃用. 迁移指南:\nhttps://www.w3ctech.com/topic/2226");
					}
					let transformer = initializer(...args);
					transformer.postcssPlugin = name;
					transformer.postcssVersion = new Processor().version;
					return transformer;
				}
				let cache;
				Object.defineProperty(creator, "postcss", { get() {
					if (!cache) cache = creator();
					return cache;
				} });
				creator.process = function(css, processOpts, pluginOpts) {
					return postcss2([creator(pluginOpts)]).process(css, processOpts);
				};
				return creator;
			};
			postcss2.stringify = stringify;
			postcss2.parse = parse;
			postcss2.fromJSON = fromJSON;
			postcss2.list = list;
			postcss2.comment = (defaults) => new Comment(defaults);
			postcss2.atRule = (defaults) => new AtRule(defaults);
			postcss2.decl = (defaults) => new Declaration(defaults);
			postcss2.rule = (defaults) => new Rule(defaults);
			postcss2.root = (defaults) => new Root(defaults);
			postcss2.document = (defaults) => new Document2(defaults);
			postcss2.CssSyntaxError = CssSyntaxError;
			postcss2.Declaration = Declaration;
			postcss2.Container = Container;
			postcss2.Processor = Processor;
			postcss2.Document = Document2;
			postcss2.Comment = Comment;
			postcss2.Warning = Warning;
			postcss2.AtRule = AtRule;
			postcss2.Result = Result;
			postcss2.Input = Input;
			postcss2.Rule = Rule;
			postcss2.Root = Root;
			postcss2.Node = Node2;
			LazyResult.registerPostcss(postcss2);
			postcss_1 = postcss2;
			postcss2.default = postcss2;
			return postcss_1;
		}
		function parseCSSText(cssText) {
			const res = {};
			const listDelimiter = /;(?![^(]*\))/g;
			const propertyDelimiter = /:(.+)/;
			cssText.replace(/\/\*.*?\*\//g, "").split(listDelimiter).forEach(function(item) {
				if (item) {
					const tmp = item.split(propertyDelimiter);
					tmp.length > 1 && (res[camelize(tmp[0].trim())] = tmp[1].trim());
				}
			});
			return res;
		}
		function toCSSText(style) {
			const properties = [];
			for (const name in style) {
				const value = style[name];
				if (typeof value !== "string") continue;
				const normalizedName = hyphenate(name);
				properties.push(`${normalizedName}: ${value};`);
			}
			return properties.join(" ");
		}
		function appendChild(parent, newChild) {
			if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
			if (parent.lastChild) {
				parent.lastChild.nextSibling = newChild;
				newChild.previousSibling = parent.lastChild;
			} else {
				parent.firstChild = newChild;
				newChild.previousSibling = null;
			}
			parent.lastChild = newChild;
			newChild.nextSibling = null;
			newChild.parentNode = parent;
			newChild.parentElement = parent;
			newChild.ownerDocument = parent.ownerDocument;
			return newChild;
		}
		function insertBefore(parent, newChild, refChild) {
			if (!refChild) return appendChild(parent, newChild);
			if (refChild.parentNode !== parent) throw new Error("Failed to execute 'insertBefore' on 'RRNode': The RRNode before which the new node is to be inserted is not a child of this RRNode.");
			if (newChild === refChild) return newChild;
			if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
			newChild.previousSibling = refChild.previousSibling;
			refChild.previousSibling = newChild;
			newChild.nextSibling = refChild;
			if (newChild.previousSibling) newChild.previousSibling.nextSibling = newChild;
			else parent.firstChild = newChild;
			newChild.parentElement = parent;
			newChild.parentNode = parent;
			newChild.ownerDocument = parent.ownerDocument;
			return newChild;
		}
		function removeChild(parent, child) {
			if (child.parentNode !== parent) throw new Error("Failed to execute 'removeChild' on 'RRNode': The RRNode to be removed is not a child of this RRNode.");
			if (child.previousSibling) child.previousSibling.nextSibling = child.nextSibling;
			else parent.firstChild = child.nextSibling;
			if (child.nextSibling) child.nextSibling.previousSibling = child.previousSibling;
			else parent.lastChild = child.previousSibling;
			child.previousSibling = null;
			child.nextSibling = null;
			child.parentElement = null;
			child.parentNode = null;
			return child;
		}
		function diff(oldTree, newTree, replayer, rrnodeMirror = newTree.mirror || newTree.ownerDocument.mirror) {
			oldTree = diffBeforeUpdatingChildren(oldTree, newTree, replayer, rrnodeMirror);
			diffChildren(oldTree, newTree, replayer, rrnodeMirror);
			diffAfterUpdatingChildren(oldTree, newTree, replayer);
		}
		function diffBeforeUpdatingChildren(oldTree, newTree, replayer, rrnodeMirror) {
			var _a2;
			if (replayer.afterAppend && !createdNodeSet) {
				createdNodeSet = /* @__PURE__ */ new WeakSet();
				setTimeout(() => {
					createdNodeSet = null;
				}, 0);
			}
			if (!sameNodeType(oldTree, newTree)) {
				const calibratedOldTree = createOrGetNode(newTree, replayer.mirror, rrnodeMirror);
				(_a2 = oldTree.parentNode) == null || _a2.replaceChild(calibratedOldTree, oldTree);
				oldTree = calibratedOldTree;
			}
			switch (newTree.RRNodeType) {
				case NodeType$1.Document:
					if (!nodeMatching(oldTree, newTree, replayer.mirror, rrnodeMirror)) {
						const newMeta = rrnodeMirror.getMeta(newTree);
						if (newMeta) {
							replayer.mirror.removeNodeFromMap(oldTree);
							oldTree.close();
							oldTree.open();
							replayer.mirror.add(oldTree, newMeta);
							createdNodeSet?.add(oldTree);
						}
					}
					break;
				case NodeType$1.Element: {
					const oldElement = oldTree;
					const newRRElement = newTree;
					switch (newRRElement.tagName) {
						case "IFRAME": {
							const oldContentDocument = oldTree.contentDocument;
							if (!oldContentDocument) break;
							diff(oldContentDocument, newTree.contentDocument, replayer, rrnodeMirror);
							break;
						}
					}
					if (newRRElement.shadowRoot) {
						if (!oldElement.shadowRoot) oldElement.attachShadow({ mode: "open" });
						diffChildren(oldElement.shadowRoot, newRRElement.shadowRoot, replayer, rrnodeMirror);
					}
					diffProps(oldElement, newRRElement, rrnodeMirror);
					break;
				}
			}
			return oldTree;
		}
		function diffAfterUpdatingChildren(oldTree, newTree, replayer) {
			var _a2;
			switch (newTree.RRNodeType) {
				case NodeType$1.Document: {
					const scrollData = newTree.scrollData;
					scrollData && replayer.applyScroll(scrollData, true);
					break;
				}
				case NodeType$1.Element: {
					const oldElement = oldTree;
					const newRRElement = newTree;
					newRRElement.scrollData && replayer.applyScroll(newRRElement.scrollData, true);
					newRRElement.inputData && replayer.applyInput(newRRElement.inputData);
					switch (newRRElement.tagName) {
						case "AUDIO":
						case "VIDEO": {
							const oldMediaElement = oldTree;
							const newMediaRRElement = newRRElement;
							if (newMediaRRElement.paused !== void 0) newMediaRRElement.paused ? oldMediaElement.pause() : oldMediaElement.play();
							if (newMediaRRElement.muted !== void 0) oldMediaElement.muted = newMediaRRElement.muted;
							if (newMediaRRElement.volume !== void 0) oldMediaElement.volume = newMediaRRElement.volume;
							if (newMediaRRElement.currentTime !== void 0) oldMediaElement.currentTime = newMediaRRElement.currentTime;
							if (newMediaRRElement.playbackRate !== void 0) oldMediaElement.playbackRate = newMediaRRElement.playbackRate;
							if (newMediaRRElement.loop !== void 0) oldMediaElement.loop = newMediaRRElement.loop;
							break;
						}
						case "CANVAS": {
							const rrCanvasElement = newTree;
							if (rrCanvasElement.rr_dataURL !== null) {
								const image = document.createElement("img");
								image.onload = () => {
									const ctx = oldElement.getContext("2d");
									if (ctx) ctx.drawImage(image, 0, 0, image.width, image.height);
								};
								image.src = rrCanvasElement.rr_dataURL;
							}
							rrCanvasElement.canvasMutations.forEach((canvasMutation2) => replayer.applyCanvas(canvasMutation2.event, canvasMutation2.mutation, oldTree));
							break;
						}
						case "STYLE": {
							const styleSheet = oldElement.sheet;
							styleSheet && newTree.rules.forEach((data) => replayer.applyStyleSheetMutation(data, styleSheet));
							break;
						}
						case "DIALOG": {
							const dialog = oldElement;
							const rrDialog = newRRElement;
							const wasOpen = dialog.open;
							const wasModal = dialog.matches("dialog:modal");
							const shouldBeOpen = rrDialog.open;
							const shouldBeModal = rrDialog.isModal;
							const modalChanged = wasModal !== shouldBeModal;
							const openChanged = wasOpen !== shouldBeOpen;
							if (modalChanged || wasOpen && openChanged) dialog.close();
							if (shouldBeOpen && (openChanged || modalChanged)) try {
								if (shouldBeModal) dialog.showModal();
								else dialog.show();
							} catch (e2) {
								console.warn(e2);
							}
							break;
						}
					}
					break;
				}
				case NodeType$1.Text:
				case NodeType$1.Comment:
				case NodeType$1.CDATA:
					if (oldTree.textContent !== newTree.data) oldTree.textContent = newTree.data;
					break;
			}
			if (createdNodeSet == null ? void 0 : createdNodeSet.has(oldTree)) {
				createdNodeSet.delete(oldTree);
				(_a2 = replayer.afterAppend) == null || _a2.call(replayer, oldTree, replayer.mirror.getId(oldTree));
			}
		}
		function diffProps(oldTree, newTree, rrnodeMirror) {
			const oldAttributes = oldTree.attributes;
			const newAttributes = newTree.attributes;
			for (const name in newAttributes) {
				const newValue = newAttributes[name];
				const sn = rrnodeMirror.getMeta(newTree);
				if ((sn == null ? void 0 : sn.isSVG) && NAMESPACES[name]) oldTree.setAttributeNS(NAMESPACES[name], name, newValue);
				else if (newTree.tagName === "CANVAS" && name === "rr_dataURL") {
					const image = document.createElement("img");
					image.src = newValue;
					image.onload = () => {
						const ctx = oldTree.getContext("2d");
						if (ctx) ctx.drawImage(image, 0, 0, image.width, image.height);
					};
				} else if (newTree.tagName === "IFRAME" && name === "srcdoc") continue;
				else try {
					oldTree.setAttribute(name, newValue);
				} catch (err) {
					console.warn(err);
				}
			}
			for (const { name } of Array.from(oldAttributes)) if (!(name in newAttributes)) oldTree.removeAttribute(name);
			newTree.scrollLeft && (oldTree.scrollLeft = newTree.scrollLeft);
			newTree.scrollTop && (oldTree.scrollTop = newTree.scrollTop);
		}
		function diffChildren(oldTree, newTree, replayer, rrnodeMirror) {
			const oldChildren = Array.from(oldTree.childNodes);
			const newChildren = newTree.childNodes;
			if (oldChildren.length === 0 && newChildren.length === 0) return;
			let oldStartIndex = 0, oldEndIndex = oldChildren.length - 1, newStartIndex = 0, newEndIndex = newChildren.length - 1;
			let oldStartNode = oldChildren[oldStartIndex], oldEndNode = oldChildren[oldEndIndex], newStartNode = newChildren[newStartIndex], newEndNode = newChildren[newEndIndex];
			let oldIdToIndex = void 0, indexInOld = void 0;
			while (oldStartIndex <= oldEndIndex && newStartIndex <= newEndIndex) if (oldStartNode === void 0) oldStartNode = oldChildren[++oldStartIndex];
			else if (oldEndNode === void 0) oldEndNode = oldChildren[--oldEndIndex];
			else if (nodeMatching(oldStartNode, newStartNode, replayer.mirror, rrnodeMirror)) {
				oldStartNode = oldChildren[++oldStartIndex];
				newStartNode = newChildren[++newStartIndex];
			} else if (nodeMatching(oldEndNode, newEndNode, replayer.mirror, rrnodeMirror)) {
				oldEndNode = oldChildren[--oldEndIndex];
				newEndNode = newChildren[--newEndIndex];
			} else if (nodeMatching(oldStartNode, newEndNode, replayer.mirror, rrnodeMirror)) {
				try {
					oldTree.insertBefore(oldStartNode, oldEndNode.nextSibling);
				} catch (e2) {
					console.warn(e2);
				}
				oldStartNode = oldChildren[++oldStartIndex];
				newEndNode = newChildren[--newEndIndex];
			} else if (nodeMatching(oldEndNode, newStartNode, replayer.mirror, rrnodeMirror)) {
				try {
					oldTree.insertBefore(oldEndNode, oldStartNode);
				} catch (e2) {
					console.warn(e2);
				}
				oldEndNode = oldChildren[--oldEndIndex];
				newStartNode = newChildren[++newStartIndex];
			} else {
				if (!oldIdToIndex) {
					oldIdToIndex = {};
					for (let i2 = oldStartIndex; i2 <= oldEndIndex; i2++) {
						const oldChild2 = oldChildren[i2];
						if (oldChild2 && replayer.mirror.hasNode(oldChild2)) oldIdToIndex[replayer.mirror.getId(oldChild2)] = i2;
					}
				}
				indexInOld = oldIdToIndex[rrnodeMirror.getId(newStartNode)];
				const nodeToMove = oldChildren[indexInOld];
				if (indexInOld !== void 0 && nodeToMove && nodeMatching(nodeToMove, newStartNode, replayer.mirror, rrnodeMirror)) {
					try {
						oldTree.insertBefore(nodeToMove, oldStartNode);
					} catch (e2) {
						console.warn(e2);
					}
					oldChildren[indexInOld] = void 0;
				} else {
					const newNode = createOrGetNode(newStartNode, replayer.mirror, rrnodeMirror);
					if (oldTree.nodeName === "#document" && oldStartNode && (newNode.nodeType === newNode.DOCUMENT_TYPE_NODE && oldStartNode.nodeType === oldStartNode.DOCUMENT_TYPE_NODE || newNode.nodeType === newNode.ELEMENT_NODE && oldStartNode.nodeType === oldStartNode.ELEMENT_NODE)) {
						oldTree.removeChild(oldStartNode);
						replayer.mirror.removeNodeFromMap(oldStartNode);
						oldStartNode = oldChildren[++oldStartIndex];
					}
					try {
						oldTree.insertBefore(newNode, oldStartNode || null);
					} catch (e2) {
						console.warn(e2);
					}
				}
				newStartNode = newChildren[++newStartIndex];
			}
			if (oldStartIndex > oldEndIndex) {
				const referenceRRNode = newChildren[newEndIndex + 1];
				let referenceNode = null;
				if (referenceRRNode) referenceNode = replayer.mirror.getNode(rrnodeMirror.getId(referenceRRNode));
				for (; newStartIndex <= newEndIndex; ++newStartIndex) {
					const newNode = createOrGetNode(newChildren[newStartIndex], replayer.mirror, rrnodeMirror);
					try {
						oldTree.insertBefore(newNode, referenceNode);
					} catch (e2) {
						console.warn(e2);
					}
				}
			} else if (newStartIndex > newEndIndex) for (; oldStartIndex <= oldEndIndex; oldStartIndex++) {
				const node2 = oldChildren[oldStartIndex];
				if (!node2 || node2.parentNode !== oldTree) continue;
				try {
					oldTree.removeChild(node2);
					replayer.mirror.removeNodeFromMap(node2);
				} catch (e2) {
					console.warn(e2);
				}
			}
			let oldChild = oldTree.firstChild;
			let newChild = newTree.firstChild;
			while (oldChild !== null && newChild !== null) {
				diff(oldChild, newChild, replayer, rrnodeMirror);
				oldChild = oldChild.nextSibling;
				newChild = newChild.nextSibling;
			}
		}
		function createOrGetNode(rrNode, domMirror, rrnodeMirror) {
			const nodeId = rrnodeMirror.getId(rrNode);
			const sn = rrnodeMirror.getMeta(rrNode);
			let node2 = null;
			if (nodeId > -1) node2 = domMirror.getNode(nodeId);
			if (node2 !== null && sameNodeType(node2, rrNode)) return node2;
			switch (rrNode.RRNodeType) {
				case NodeType$1.Document:
					node2 = new Document();
					break;
				case NodeType$1.DocumentType:
					node2 = document.implementation.createDocumentType(rrNode.name, rrNode.publicId, rrNode.systemId);
					break;
				case NodeType$1.Element: {
					let tagName = rrNode.tagName.toLowerCase();
					tagName = SVGTagMap[tagName] || tagName;
					if (sn && "isSVG" in sn && (sn == null ? void 0 : sn.isSVG)) node2 = document.createElementNS(NAMESPACES["svg"], tagName);
					else node2 = document.createElement(rrNode.tagName);
					break;
				}
				case NodeType$1.Text:
					node2 = document.createTextNode(rrNode.data);
					break;
				case NodeType$1.Comment:
					node2 = document.createComment(rrNode.data);
					break;
				case NodeType$1.CDATA:
					node2 = document.createCDATASection(rrNode.data);
					break;
			}
			if (sn) domMirror.add(node2, { ...sn });
			try {
				createdNodeSet?.add(node2);
			} catch (e2) {}
			return node2;
		}
		function sameNodeType(node1, node2) {
			if (node1.nodeType !== node2.nodeType) return false;
			return node1.nodeType !== node1.ELEMENT_NODE || node1.tagName.toUpperCase() === node2.tagName;
		}
		function nodeMatching(node1, node2, domMirror, rrdomMirror) {
			const node1Id = domMirror.getId(node1);
			const node2Id = rrdomMirror.getId(node2);
			if (node1Id === -1 || node1Id !== node2Id) return false;
			return sameNodeType(node1, node2);
		}
		function getValidTagName(element) {
			if (element instanceof HTMLFormElement) return "FORM";
			return element.tagName.toUpperCase();
		}
		function buildFromNode(node2, rrdom, domMirror, parentRRNode) {
			let rrNode;
			switch (node2.nodeType) {
				case NodeType$2.DOCUMENT_NODE:
					if (parentRRNode && parentRRNode.nodeName === "IFRAME") rrNode = parentRRNode.contentDocument;
					else {
						rrNode = rrdom;
						rrNode.compatMode = node2.compatMode;
					}
					break;
				case NodeType$2.DOCUMENT_TYPE_NODE: {
					const documentType = node2;
					rrNode = rrdom.createDocumentType(documentType.name, documentType.publicId, documentType.systemId);
					break;
				}
				case NodeType$2.ELEMENT_NODE: {
					const elementNode = node2;
					const tagName = getValidTagName(elementNode);
					rrNode = rrdom.createElement(tagName);
					const rrElement = rrNode;
					for (const { name, value } of Array.from(elementNode.attributes)) rrElement.attributes[name] = value;
					elementNode.scrollLeft && (rrElement.scrollLeft = elementNode.scrollLeft);
					elementNode.scrollTop && (rrElement.scrollTop = elementNode.scrollTop);
					break;
				}
				case NodeType$2.TEXT_NODE:
					rrNode = rrdom.createTextNode(node2.textContent || "");
					break;
				case NodeType$2.CDATA_SECTION_NODE:
					rrNode = rrdom.createCDATASection(node2.data);
					break;
				case NodeType$2.COMMENT_NODE:
					rrNode = rrdom.createComment(node2.textContent || "");
					break;
				case NodeType$2.DOCUMENT_FRAGMENT_NODE:
					rrNode = parentRRNode.attachShadow({ mode: "open" });
					break;
				default: return null;
			}
			let sn = domMirror.getMeta(node2);
			if (rrdom instanceof RRDocument) {
				if (!sn) {
					sn = getDefaultSN(rrNode, rrdom.unserializedId);
					domMirror.add(node2, sn);
				}
				rrdom.mirror.add(rrNode, { ...sn });
			}
			return rrNode;
		}
		function buildFromDom(dom, domMirror = createMirror$1(), rrdom = new RRDocument()) {
			function walk2(node2, parentRRNode) {
				const rrNode = buildFromNode(node2, rrdom, domMirror, parentRRNode);
				if (rrNode === null) return;
				if ((parentRRNode == null ? void 0 : parentRRNode.nodeName) !== "IFRAME" && node2.nodeType !== NodeType$2.DOCUMENT_FRAGMENT_NODE) {
					parentRRNode?.appendChild(rrNode);
					rrNode.parentNode = parentRRNode;
					rrNode.parentElement = parentRRNode;
				}
				if (node2.nodeName === "IFRAME") {
					const iframeDoc = node2.contentDocument;
					iframeDoc && walk2(iframeDoc, rrNode);
				} else if (node2.nodeType === NodeType$2.DOCUMENT_NODE || node2.nodeType === NodeType$2.ELEMENT_NODE || node2.nodeType === NodeType$2.DOCUMENT_FRAGMENT_NODE) {
					if (node2.nodeType === NodeType$2.ELEMENT_NODE && node2.shadowRoot) walk2(node2.shadowRoot, rrNode);
					node2.childNodes.forEach((childNode) => walk2(childNode, rrNode));
				}
			}
			walk2(dom, null);
			return rrdom;
		}
		function createMirror() {
			return new Mirror22();
		}
		function getDefaultSN(node2, id) {
			switch (node2.RRNodeType) {
				case NodeType$1.Document: return {
					id,
					type: node2.RRNodeType,
					childNodes: []
				};
				case NodeType$1.DocumentType: {
					const doctype = node2;
					return {
						id,
						type: node2.RRNodeType,
						name: doctype.name,
						publicId: doctype.publicId,
						systemId: doctype.systemId
					};
				}
				case NodeType$1.Element: return {
					id,
					type: node2.RRNodeType,
					tagName: node2.tagName.toLowerCase(),
					attributes: {},
					childNodes: []
				};
				case NodeType$1.Text: return {
					id,
					type: node2.RRNodeType,
					textContent: node2.textContent || ""
				};
				case NodeType$1.Comment: return {
					id,
					type: node2.RRNodeType,
					textContent: node2.textContent || ""
				};
				case NodeType$1.CDATA: return {
					id,
					type: node2.RRNodeType,
					textContent: ""
				};
			}
		}
		function getUntaintedPrototype(key) {
			if (untaintedBasePrototype[key]) return untaintedBasePrototype[key];
			const defaultObj = globalThis[key];
			const defaultPrototype = defaultObj.prototype;
			const accessorNames = key in testableAccessors ? testableAccessors[key] : void 0;
			const isUntaintedAccessors = Boolean(accessorNames && accessorNames.every((accessor) => {
				var _a2, _b;
				return Boolean((_b = (_a2 = Object.getOwnPropertyDescriptor(defaultPrototype, accessor)) == null ? void 0 : _a2.get) == null ? void 0 : _b.toString().includes("[native code]"));
			}));
			const methodNames = key in testableMethods ? testableMethods[key] : void 0;
			const isUntaintedMethods = Boolean(methodNames && methodNames.every((method) => {
				var _a2;
				return typeof defaultPrototype[method] === "function" && ((_a2 = defaultPrototype[method]) == null ? void 0 : _a2.toString().includes("[native code]"));
			}));
			if (isUntaintedAccessors && isUntaintedMethods && !isAngularZonePresent()) {
				untaintedBasePrototype[key] = defaultObj.prototype;
				return defaultObj.prototype;
			}
			try {
				const iframeEl = document.createElement("iframe");
				iframeEl.style.display = "none";
				document.body.appendChild(iframeEl);
				const win = iframeEl.contentWindow;
				if (!win) return defaultObj.prototype;
				const untaintedObject = win[key].prototype;
				if (!untaintedObject) {
					iframeEl.remove();
					return defaultPrototype;
				}
				const ua = navigator.userAgent;
				if (ua.includes("Safari") && !ua.includes("Chrome")) {
					iframeEl.classList.add("rr-block");
					iframeEl.setAttribute("__rrwebUntaintedMutationObserver", "");
					untaintedBaseIframeCleanup[key] = () => iframeEl.remove();
				} else iframeEl.remove();
				return untaintedBasePrototype[key] = untaintedObject;
			} catch {
				return defaultPrototype;
			}
		}
		function getUntaintedAccessor(key, instance, accessor) {
			var _a2, _b;
			const cached = (_a2 = untaintedAccessorCache[key]) == null ? void 0 : _a2[accessor];
			if (cached) return cached.call(instance);
			const untaintedPrototype = getUntaintedPrototype(key);
			const untaintedAccessor = (_b = Object.getOwnPropertyDescriptor(untaintedPrototype, accessor)) == null ? void 0 : _b.get;
			if (!untaintedAccessor) return instance[accessor];
			(untaintedAccessorCache[key] || (untaintedAccessorCache[key] = {}))[accessor] = untaintedAccessor;
			return untaintedAccessor.call(instance);
		}
		function getUntaintedMethod(key, instance, method) {
			const cacheKey = `${key}.${String(method)}`;
			if (untaintedMethodCache[cacheKey]) return untaintedMethodCache[cacheKey].bind(instance);
			const untaintedMethod = getUntaintedPrototype(key)[method];
			if (typeof untaintedMethod !== "function") return instance[method];
			untaintedMethodCache[cacheKey] = untaintedMethod;
			return untaintedMethod.bind(instance);
		}
		function ownerDocument(n2) {
			return getUntaintedAccessor("Node", n2, "ownerDocument");
		}
		function childNodes(n2) {
			return getUntaintedAccessor("Node", n2, "childNodes");
		}
		function parentNode(n2) {
			return getUntaintedAccessor("Node", n2, "parentNode");
		}
		function parentElement(n2) {
			return getUntaintedAccessor("Node", n2, "parentElement");
		}
		function textContent(n2) {
			return getUntaintedAccessor("Node", n2, "textContent");
		}
		function firstChild(n2) {
			return getUntaintedAccessor("Node", n2, "firstChild");
		}
		function lastChild(n2) {
			return getUntaintedAccessor("Node", n2, "lastChild");
		}
		function nextSibling(n2) {
			return getUntaintedAccessor("Node", n2, "nextSibling");
		}
		function previousSibling(n2) {
			return getUntaintedAccessor("Node", n2, "previousSibling");
		}
		function contains(n2, other) {
			return getUntaintedMethod("Node", n2, "contains")(other);
		}
		function getRootNode(n2) {
			return getUntaintedMethod("Node", n2, "getRootNode")();
		}
		function host(n2) {
			if (!n2 || !("host" in n2)) return null;
			return getUntaintedAccessor("ShadowRoot", n2, "host");
		}
		function styleSheets(n2) {
			return n2.styleSheets;
		}
		function shadowRoot(n2) {
			if (!n2 || !("shadowRoot" in n2)) return null;
			return getUntaintedAccessor("Element", n2, "shadowRoot");
		}
		function querySelector(n2, selectors) {
			return getUntaintedAccessor("Element", n2, "querySelector")(selectors);
		}
		function querySelectorAll(n2, selectors) {
			return getUntaintedAccessor("Element", n2, "querySelectorAll")(selectors);
		}
		function mutationObserverCtor() {
			const prototype = getUntaintedPrototype("MutationObserver");
			mutationObserverUsers++;
			let stopCalled = false;
			return [prototype.constructor, () => {
				if (stopCalled) return;
				stopCalled = true;
				if (--mutationObserverUsers !== 0) return;
				const cleanup = untaintedBaseIframeCleanup["MutationObserver"];
				if (!cleanup) return;
				try {
					cleanup();
				} finally {
					delete untaintedBasePrototype["MutationObserver"];
					delete untaintedBaseIframeCleanup["MutationObserver"];
				}
			}];
		}
		function patch(source, name, replacement) {
			try {
				if (!(name in source)) return () => {};
				const original = source[name];
				const wrapped = replacement(original);
				if (typeof wrapped === "function") {
					wrapped.prototype = wrapped.prototype || {};
					Object.defineProperties(wrapped, { __rrweb_original__: {
						enumerable: false,
						value: original
					} });
				}
				source[name] = wrapped;
				return () => {
					source[name] = original;
				};
			} catch {
				return () => {};
			}
		}
		function on(type, fn, target = document) {
			const options = {
				capture: true,
				passive: true
			};
			target.addEventListener(type, fn, options);
			return () => target.removeEventListener(type, fn, options);
		}
		function throttle(func, wait, options = {}) {
			let timeout = null;
			let previous = 0;
			return function(...args) {
				const now = Date.now();
				if (!previous && options.leading === false) previous = now;
				const remaining = wait - (now - previous);
				const context = this;
				if (remaining <= 0 || remaining > wait) {
					if (timeout) {
						clearTimeout(timeout);
						timeout = null;
					}
					previous = now;
					func.apply(context, args);
				} else if (!timeout && options.trailing !== false) timeout = setTimeout(() => {
					previous = options.leading === false ? 0 : Date.now();
					timeout = null;
					func.apply(context, args);
				}, remaining);
			};
		}
		function hookSetter(target, key, d, isRevoked, win = window) {
			const original = win.Object.getOwnPropertyDescriptor(target, key);
			win.Object.defineProperty(target, key, isRevoked ? d : { set(value) {
				setTimeout(() => {
					d.set.call(this, value);
				}, 0);
				if (original && original.set) original.set.call(this, value);
			} });
			return () => hookSetter(target, key, original || {}, true);
		}
		function getWindowScroll(win) {
			var _a2, _b, _c, _d;
			const doc = win.document;
			return {
				left: doc.scrollingElement ? doc.scrollingElement.scrollLeft : win.pageXOffset !== void 0 ? win.pageXOffset : doc.documentElement.scrollLeft || (doc == null ? void 0 : doc.body) && ((_a2 = index.parentElement(doc.body)) == null ? void 0 : _a2.scrollLeft) || ((_b = doc == null ? void 0 : doc.body) == null ? void 0 : _b.scrollLeft) || 0,
				top: doc.scrollingElement ? doc.scrollingElement.scrollTop : win.pageYOffset !== void 0 ? win.pageYOffset : (doc == null ? void 0 : doc.documentElement.scrollTop) || (doc == null ? void 0 : doc.body) && ((_c = index.parentElement(doc.body)) == null ? void 0 : _c.scrollTop) || ((_d = doc == null ? void 0 : doc.body) == null ? void 0 : _d.scrollTop) || 0
			};
		}
		function getWindowHeight() {
			return window.innerHeight || document.documentElement && document.documentElement.clientHeight || document.body && document.body.clientHeight;
		}
		function getWindowWidth() {
			return window.innerWidth || document.documentElement && document.documentElement.clientWidth || document.body && document.body.clientWidth;
		}
		function closestElementOfNode(node2) {
			if (!node2) return null;
			return node2.nodeType === node2.ELEMENT_NODE ? node2 : index.parentElement(node2);
		}
		function isBlocked(node2, blockClass, blockSelector, checkAncestors) {
			if (!node2) return false;
			const el = closestElementOfNode(node2);
			if (!el) return false;
			try {
				if (typeof blockClass === "string") {
					if (el.classList.contains(blockClass)) return true;
					if (checkAncestors && el.closest("." + blockClass) !== null) return true;
				} else if (classMatchesRegex(el, blockClass, checkAncestors)) return true;
			} catch (e2) {}
			if (blockSelector) {
				if (el.matches(blockSelector)) return true;
				if (checkAncestors && el.closest(blockSelector) !== null) return true;
			}
			return false;
		}
		function isSerialized(n2, mirror2) {
			return mirror2.getId(n2) !== -1;
		}
		function isIgnored(n2, mirror2, slimDOMOptions) {
			if (n2.tagName === "TITLE" && slimDOMOptions.headTitleMutations) return true;
			return mirror2.getId(n2) === IGNORED_NODE;
		}
		function isAncestorRemoved(target, mirror2) {
			if (isShadowRoot(target)) return false;
			const id = mirror2.getId(target);
			if (!mirror2.has(id)) return true;
			const parent = index.parentNode(target);
			if (parent && parent.nodeType === target.DOCUMENT_NODE) return false;
			if (!parent) return true;
			return isAncestorRemoved(parent, mirror2);
		}
		function legacy_isTouchEvent(event) {
			return Boolean(event.changedTouches);
		}
		function polyfill$1(win = window) {
			if ("NodeList" in win && !win.NodeList.prototype.forEach) win.NodeList.prototype.forEach = Array.prototype.forEach;
			if ("DOMTokenList" in win && !win.DOMTokenList.prototype.forEach) win.DOMTokenList.prototype.forEach = Array.prototype.forEach;
		}
		function queueToResolveTrees(queue) {
			const queueNodeMap = {};
			const putIntoMap = (m, parent) => {
				const nodeInTree = {
					value: m,
					parent,
					children: []
				};
				queueNodeMap[m.node.id] = nodeInTree;
				return nodeInTree;
			};
			const queueNodeTrees = [];
			for (const mutation of queue) {
				const { nextId, parentId } = mutation;
				if (nextId && nextId in queueNodeMap) {
					const nextInTree = queueNodeMap[nextId];
					if (nextInTree.parent) {
						const idx = nextInTree.parent.children.indexOf(nextInTree);
						nextInTree.parent.children.splice(idx, 0, putIntoMap(mutation, nextInTree.parent));
					} else {
						const idx = queueNodeTrees.indexOf(nextInTree);
						queueNodeTrees.splice(idx, 0, putIntoMap(mutation, null));
					}
					continue;
				}
				if (parentId in queueNodeMap) {
					const parentInTree = queueNodeMap[parentId];
					parentInTree.children.push(putIntoMap(mutation, parentInTree));
					continue;
				}
				queueNodeTrees.push(putIntoMap(mutation, null));
			}
			return queueNodeTrees;
		}
		function iterateResolveTree(tree, cb) {
			cb(tree.value);
			for (let i2 = tree.children.length - 1; i2 >= 0; i2--) iterateResolveTree(tree.children[i2], cb);
		}
		function isSerializedIframe(n2, mirror2) {
			return Boolean(n2.nodeName === "IFRAME" && mirror2.getMeta(n2));
		}
		function isSerializedStylesheet(n2, mirror2) {
			return Boolean(n2.nodeName === "LINK" && n2.nodeType === n2.ELEMENT_NODE && n2.getAttribute && n2.getAttribute("rel") === "stylesheet" && mirror2.getMeta(n2));
		}
		function getBaseDimension(node2, rootIframe) {
			var _a2, _b;
			const frameElement = (_b = (_a2 = node2.ownerDocument) == null ? void 0 : _a2.defaultView) == null ? void 0 : _b.frameElement;
			if (!frameElement || frameElement === rootIframe) return {
				x: 0,
				y: 0,
				relativeScale: 1,
				absoluteScale: 1
			};
			const frameDimension = frameElement.getBoundingClientRect();
			const frameBaseDimension = getBaseDimension(frameElement, rootIframe);
			const relativeScale = frameDimension.height / frameElement.clientHeight;
			return {
				x: frameDimension.x * frameBaseDimension.relativeScale + frameBaseDimension.x,
				y: frameDimension.y * frameBaseDimension.relativeScale + frameBaseDimension.y,
				relativeScale,
				absoluteScale: frameBaseDimension.absoluteScale * relativeScale
			};
		}
		function hasShadowRoot(n2) {
			if (!n2) return false;
			if (n2 instanceof BaseRRNode && "shadowRoot" in n2) return Boolean(n2.shadowRoot);
			return Boolean(index.shadowRoot(n2));
		}
		function getNestedRule(rules2, position) {
			const rule2 = rules2 == null ? void 0 : rules2[position[0]];
			if (!rule2) return null;
			if (position.length === 1) return rule2;
			else return getNestedRule(rule2.cssRules, position.slice(1));
		}
		function getPositionsAndIndex(nestedIndex) {
			const positions = [...nestedIndex];
			return {
				positions,
				index: positions.pop()
			};
		}
		function uniqueTextMutations(mutations) {
			const idSet = /* @__PURE__ */ new Set();
			const uniqueMutations = [];
			for (let i2 = mutations.length; i2--;) {
				const mutation = mutations[i2];
				if (!idSet.has(mutation.id)) {
					uniqueMutations.push(mutation);
					idSet.add(mutation.id);
				}
			}
			return uniqueMutations;
		}
		function getShadowHost(n2) {
			var _a2;
			let shadowHost = null;
			if ("getRootNode" in n2 && ((_a2 = index.getRootNode(n2)) == null ? void 0 : _a2.nodeType) === Node.DOCUMENT_FRAGMENT_NODE && index.host(index.getRootNode(n2))) shadowHost = index.host(index.getRootNode(n2));
			return shadowHost;
		}
		function getRootShadowHost(n2) {
			let rootShadowHost = n2;
			let shadowHost;
			while (shadowHost = getShadowHost(rootShadowHost)) rootShadowHost = shadowHost;
			return rootShadowHost;
		}
		function shadowHostInDom(n2) {
			const doc = index.ownerDocument(n2);
			if (!doc) return false;
			const shadowHost = getRootShadowHost(n2);
			return index.contains(doc, shadowHost);
		}
		function inDom(n2) {
			const doc = index.ownerDocument(n2);
			if (!doc) return false;
			return index.contains(doc, n2) || shadowHostInDom(n2);
		}
		function deepDelete(addsSet, n2) {
			addsSet.delete(n2);
			index.childNodes(n2).forEach((childN) => deepDelete(addsSet, childN));
		}
		function processRemoves(n2, cache) {
			const queue = [n2];
			while (queue.length) {
				const next = queue.pop();
				if (cache.has(next)) continue;
				cache.add(next);
				index.childNodes(next).forEach((n22) => queue.push(n22));
			}
		}
		function isSelfOrAncestorInSet(set, n2) {
			if (set.size === 0) return false;
			return _isSelfOrAncestorInSet(set, n2);
		}
		function _isSelfOrAncestorInSet(set, n2) {
			if (set.has(n2)) return true;
			const parent = index.parentNode(n2);
			if (!parent) return false;
			return _isSelfOrAncestorInSet(set, parent);
		}
		function registerErrorHandler(handler) {
			errorHandler = handler;
		}
		function unregisterErrorHandler() {
			errorHandler = void 0;
		}
		function getEventTarget(event) {
			try {
				if ("composedPath" in event) {
					const path = event.composedPath();
					if (path.length) return path[0];
				} else if ("path" in event && event.path.length) return event.path[0];
			} catch {}
			return event && event.target;
		}
		function initMutationObserver(options, rootEl) {
			const mutationBuffer = new MutationBuffer();
			mutationBuffers.add(mutationBuffer);
			mutationBuffer.init(options);
			const [ObserverCtor, releaseObserverConstructor] = mutationObserverCtor();
			const observer = new ObserverCtor(callbackWrapper(mutationBuffer.processMutations.bind(mutationBuffer)));
			observer.observe(rootEl, {
				attributes: true,
				attributeOldValue: true,
				characterData: true,
				characterDataOldValue: true,
				childList: true,
				subtree: true
			});
			const stop = () => {
				observer.disconnect();
				mutationBuffers.delete(mutationBuffer);
				releaseObserverConstructor();
			};
			return stop;
		}
		function initMoveObserver({ mousemoveCb, sampling, doc, mirror: mirror2 }) {
			if (sampling.mousemove === false) return () => {};
			const threshold = typeof sampling.mousemove === "number" ? sampling.mousemove : 50;
			const callbackThreshold = typeof sampling.mousemoveCallback === "number" ? sampling.mousemoveCallback : 500;
			let positions = [];
			let timeBaseline;
			const wrappedCb = throttle(callbackWrapper((source) => {
				const totalOffset = Date.now() - timeBaseline;
				mousemoveCb(positions.map((p) => {
					p.timeOffset -= totalOffset;
					return p;
				}), source);
				positions = [];
				timeBaseline = null;
			}), callbackThreshold);
			const updatePosition = callbackWrapper(throttle(callbackWrapper((evt) => {
				const target = getEventTarget(evt);
				const { clientX, clientY } = legacy_isTouchEvent(evt) ? evt.changedTouches[0] : evt;
				if (!timeBaseline) timeBaseline = nowTimestamp();
				positions.push({
					x: clientX,
					y: clientY,
					id: mirror2.getId(target),
					timeOffset: nowTimestamp() - timeBaseline
				});
				wrappedCb(typeof DragEvent !== "undefined" && evt instanceof DragEvent ? IncrementalSource.Drag : evt instanceof MouseEvent ? IncrementalSource.MouseMove : IncrementalSource.TouchMove);
			}), threshold, { trailing: false }));
			const handlers = [
				on("mousemove", updatePosition, doc),
				on("touchmove", updatePosition, doc),
				on("drag", updatePosition, doc)
			];
			return callbackWrapper(() => {
				handlers.forEach((h) => h());
			});
		}
		function initMouseInteractionObserver({ mouseInteractionCb, doc, mirror: mirror2, blockClass, blockSelector, sampling }) {
			if (sampling.mouseInteraction === false) return () => {};
			const disableMap = sampling.mouseInteraction === true || sampling.mouseInteraction === void 0 ? {} : sampling.mouseInteraction;
			const handlers = [];
			let currentPointerType = null;
			const getHandler = (eventKey) => {
				return (event) => {
					const target = getEventTarget(event);
					if (isBlocked(target, blockClass, blockSelector, true)) return;
					let pointerType = null;
					let thisEventKey = eventKey;
					if ("pointerType" in event) {
						switch (event.pointerType) {
							case "mouse":
								pointerType = PointerTypes.Mouse;
								break;
							case "touch":
								pointerType = PointerTypes.Touch;
								break;
							case "pen":
								pointerType = PointerTypes.Pen;
								break;
						}
						if (pointerType === PointerTypes.Touch) {
							if (MouseInteractions[eventKey] === MouseInteractions.MouseDown) thisEventKey = "TouchStart";
							else if (MouseInteractions[eventKey] === MouseInteractions.MouseUp) thisEventKey = "TouchEnd";
						} else if (pointerType === PointerTypes.Pen);
					} else if (legacy_isTouchEvent(event)) pointerType = PointerTypes.Touch;
					if (pointerType !== null) {
						currentPointerType = pointerType;
						if (thisEventKey.startsWith("Touch") && pointerType === PointerTypes.Touch || thisEventKey.startsWith("Mouse") && pointerType === PointerTypes.Mouse) pointerType = null;
					} else if (MouseInteractions[eventKey] === MouseInteractions.Click) {
						pointerType = currentPointerType;
						currentPointerType = null;
					}
					const e2 = legacy_isTouchEvent(event) ? event.changedTouches[0] : event;
					if (!e2) return;
					const id = mirror2.getId(target);
					const { clientX, clientY } = e2;
					callbackWrapper(mouseInteractionCb)({
						type: MouseInteractions[thisEventKey],
						id,
						x: clientX,
						y: clientY,
						...pointerType !== null && { pointerType }
					});
				};
			};
			Object.keys(MouseInteractions).filter((key) => Number.isNaN(Number(key)) && !key.endsWith("_Departed") && disableMap[key] !== false).forEach((eventKey) => {
				let eventName = toLowerCase(eventKey);
				const handler = getHandler(eventKey);
				if (window.PointerEvent) switch (MouseInteractions[eventKey]) {
					case MouseInteractions.MouseDown:
					case MouseInteractions.MouseUp:
						eventName = eventName.replace("mouse", "pointer");
						break;
					case MouseInteractions.TouchStart:
					case MouseInteractions.TouchEnd: return;
				}
				handlers.push(on(eventName, handler, doc));
			});
			return callbackWrapper(() => {
				handlers.forEach((h) => h());
			});
		}
		function initScrollObserver({ scrollCb, doc, mirror: mirror2, blockClass, blockSelector, sampling }) {
			return on("scroll", callbackWrapper(throttle(callbackWrapper((evt) => {
				const target = getEventTarget(evt);
				if (!target || isBlocked(target, blockClass, blockSelector, true)) return;
				const id = mirror2.getId(target);
				if (target === doc && doc.defaultView) {
					const scrollLeftTop = getWindowScroll(doc.defaultView);
					scrollCb({
						id,
						x: scrollLeftTop.left,
						y: scrollLeftTop.top
					});
				} else scrollCb({
					id,
					x: target.scrollLeft,
					y: target.scrollTop
				});
			}), sampling.scroll || 100)), doc);
		}
		function initViewportResizeObserver({ viewportResizeCb }, { win }) {
			let lastH = -1;
			let lastW = -1;
			return on("resize", callbackWrapper(throttle(callbackWrapper(() => {
				const height = getWindowHeight();
				const width = getWindowWidth();
				if (lastH !== height || lastW !== width) {
					viewportResizeCb({
						width: Number(width),
						height: Number(height)
					});
					lastH = height;
					lastW = width;
				}
			}), 200)), win);
		}
		function initInputObserver({ inputCb, doc, mirror: mirror2, blockClass, blockSelector, ignoreClass, ignoreSelector, maskInputOptions, maskInputFn, sampling, userTriggeredOnInput }) {
			function eventHandler(event) {
				let target = getEventTarget(event);
				const userTriggered = event.isTrusted;
				const tagName = target && target.tagName;
				if (target && tagName === "OPTION") target = index.parentElement(target);
				if (!target || !tagName || INPUT_TAGS.indexOf(tagName) < 0 || isBlocked(target, blockClass, blockSelector, true)) return;
				if (target.classList.contains(ignoreClass) || ignoreSelector && target.matches(ignoreSelector)) return;
				let text = target.value;
				let isChecked = false;
				const type = getInputType(target) || "";
				if (type === "radio" || type === "checkbox") isChecked = target.checked;
				else if (maskInputOptions[tagName.toLowerCase()] || maskInputOptions[type]) text = maskInputValue({
					element: target,
					maskInputOptions,
					tagName,
					type,
					value: text,
					maskInputFn
				});
				cbWithDedup(target, userTriggeredOnInput ? {
					text,
					isChecked,
					userTriggered
				} : {
					text,
					isChecked
				});
				const name = target.name;
				if (type === "radio" && name && isChecked) doc.querySelectorAll(`input[type="radio"][name="${name}"]`).forEach((el) => {
					if (el !== target) {
						const text2 = el.value;
						cbWithDedup(el, userTriggeredOnInput ? {
							text: text2,
							isChecked: !isChecked,
							userTriggered: false
						} : {
							text: text2,
							isChecked: !isChecked
						});
					}
				});
			}
			function cbWithDedup(target, v2) {
				const lastInputValue = lastInputValueMap.get(target);
				if (!lastInputValue || lastInputValue.text !== v2.text || lastInputValue.isChecked !== v2.isChecked) {
					lastInputValueMap.set(target, v2);
					const id = mirror2.getId(target);
					callbackWrapper(inputCb)({
						...v2,
						id
					});
				}
			}
			const handlers = (sampling.input === "last" ? ["change"] : ["input", "change"]).map((eventName) => on(eventName, callbackWrapper(eventHandler), doc));
			const currentWindow = doc.defaultView;
			if (!currentWindow) return () => {
				handlers.forEach((h) => h());
			};
			const propertyDescriptor = currentWindow.Object.getOwnPropertyDescriptor(currentWindow.HTMLInputElement.prototype, "value");
			const hookProperties = [
				[currentWindow.HTMLInputElement.prototype, "value"],
				[currentWindow.HTMLInputElement.prototype, "checked"],
				[currentWindow.HTMLSelectElement.prototype, "value"],
				[currentWindow.HTMLTextAreaElement.prototype, "value"],
				[currentWindow.HTMLSelectElement.prototype, "selectedIndex"],
				[currentWindow.HTMLOptionElement.prototype, "selected"]
			];
			if (propertyDescriptor && propertyDescriptor.set) handlers.push(...hookProperties.map((p) => hookSetter(p[0], p[1], { set() {
				callbackWrapper(eventHandler)({
					target: this,
					isTrusted: false
				});
			} }, false, currentWindow)));
			return callbackWrapper(() => {
				handlers.forEach((h) => h());
			});
		}
		function getNestedCSSRulePositions(rule2) {
			const positions = [];
			function recurse(childRule, pos) {
				if (hasNestedCSSRule("CSSGroupingRule") && childRule.parentRule instanceof CSSGroupingRule || hasNestedCSSRule("CSSMediaRule") && childRule.parentRule instanceof CSSMediaRule || hasNestedCSSRule("CSSSupportsRule") && childRule.parentRule instanceof CSSSupportsRule || hasNestedCSSRule("CSSConditionRule") && childRule.parentRule instanceof CSSConditionRule) {
					const index2 = Array.from(childRule.parentRule.cssRules).indexOf(childRule);
					pos.unshift(index2);
					return recurse(childRule.parentRule, pos);
				} else if (childRule.parentStyleSheet) {
					const index2 = Array.from(childRule.parentStyleSheet.cssRules).indexOf(childRule);
					pos.unshift(index2);
				}
				return pos;
			}
			return recurse(rule2, positions);
		}
		function getIdAndStyleId(sheet, mirror2, styleMirror) {
			let id, styleId;
			if (!sheet) return {};
			if (sheet.ownerNode) id = mirror2.getId(sheet.ownerNode);
			else styleId = styleMirror.getId(sheet);
			return {
				styleId,
				id
			};
		}
		function initStyleSheetObserver({ styleSheetRuleCb, mirror: mirror2, stylesheetManager }, { win }) {
			if (!win.CSSStyleSheet || !win.CSSStyleSheet.prototype) return () => {};
			const insertRule = win.CSSStyleSheet.prototype.insertRule;
			win.CSSStyleSheet.prototype.insertRule = new Proxy(insertRule, { apply: callbackWrapper((target, thisArg, argumentsList) => {
				const [rule2, index2] = argumentsList;
				const { id, styleId } = getIdAndStyleId(thisArg, mirror2, stylesheetManager.styleMirror);
				if (id && id !== -1 || styleId && styleId !== -1) styleSheetRuleCb({
					id,
					styleId,
					adds: [{
						rule: rule2,
						index: index2
					}]
				});
				return target.apply(thisArg, argumentsList);
			}) });
			win.CSSStyleSheet.prototype.addRule = function(selector, styleBlock, index2 = this.cssRules.length) {
				const rule2 = `${selector} { ${styleBlock} }`;
				return win.CSSStyleSheet.prototype.insertRule.apply(this, [rule2, index2]);
			};
			const deleteRule = win.CSSStyleSheet.prototype.deleteRule;
			win.CSSStyleSheet.prototype.deleteRule = new Proxy(deleteRule, { apply: callbackWrapper((target, thisArg, argumentsList) => {
				const [index2] = argumentsList;
				const { id, styleId } = getIdAndStyleId(thisArg, mirror2, stylesheetManager.styleMirror);
				if (id && id !== -1 || styleId && styleId !== -1) styleSheetRuleCb({
					id,
					styleId,
					removes: [{ index: index2 }]
				});
				return target.apply(thisArg, argumentsList);
			}) });
			win.CSSStyleSheet.prototype.removeRule = function(index2) {
				return win.CSSStyleSheet.prototype.deleteRule.apply(this, [index2]);
			};
			let replace;
			if (win.CSSStyleSheet.prototype.replace) {
				replace = win.CSSStyleSheet.prototype.replace;
				win.CSSStyleSheet.prototype.replace = new Proxy(replace, { apply: callbackWrapper((target, thisArg, argumentsList) => {
					const [text] = argumentsList;
					const { id, styleId } = getIdAndStyleId(thisArg, mirror2, stylesheetManager.styleMirror);
					if (id && id !== -1 || styleId && styleId !== -1) styleSheetRuleCb({
						id,
						styleId,
						replace: text
					});
					return target.apply(thisArg, argumentsList);
				}) });
			}
			let replaceSync;
			if (win.CSSStyleSheet.prototype.replaceSync) {
				replaceSync = win.CSSStyleSheet.prototype.replaceSync;
				win.CSSStyleSheet.prototype.replaceSync = new Proxy(replaceSync, { apply: callbackWrapper((target, thisArg, argumentsList) => {
					const [text] = argumentsList;
					const { id, styleId } = getIdAndStyleId(thisArg, mirror2, stylesheetManager.styleMirror);
					if (id && id !== -1 || styleId && styleId !== -1) styleSheetRuleCb({
						id,
						styleId,
						replaceSync: text
					});
					return target.apply(thisArg, argumentsList);
				}) });
			}
			const supportedNestedCSSRuleTypes = {};
			if (canMonkeyPatchNestedCSSRule("CSSGroupingRule")) supportedNestedCSSRuleTypes.CSSGroupingRule = win.CSSGroupingRule;
			else {
				if (canMonkeyPatchNestedCSSRule("CSSMediaRule")) supportedNestedCSSRuleTypes.CSSMediaRule = win.CSSMediaRule;
				if (canMonkeyPatchNestedCSSRule("CSSConditionRule")) supportedNestedCSSRuleTypes.CSSConditionRule = win.CSSConditionRule;
				if (canMonkeyPatchNestedCSSRule("CSSSupportsRule")) supportedNestedCSSRuleTypes.CSSSupportsRule = win.CSSSupportsRule;
			}
			const unmodifiedFunctions = {};
			Object.entries(supportedNestedCSSRuleTypes).forEach(([typeKey, type]) => {
				unmodifiedFunctions[typeKey] = {
					insertRule: type.prototype.insertRule,
					deleteRule: type.prototype.deleteRule
				};
				type.prototype.insertRule = new Proxy(unmodifiedFunctions[typeKey].insertRule, { apply: callbackWrapper((target, thisArg, argumentsList) => {
					const [rule2, index2] = argumentsList;
					const { id, styleId } = getIdAndStyleId(thisArg.parentStyleSheet, mirror2, stylesheetManager.styleMirror);
					if (id && id !== -1 || styleId && styleId !== -1) styleSheetRuleCb({
						id,
						styleId,
						adds: [{
							rule: rule2,
							index: [...getNestedCSSRulePositions(thisArg), index2 || 0]
						}]
					});
					return target.apply(thisArg, argumentsList);
				}) });
				type.prototype.deleteRule = new Proxy(unmodifiedFunctions[typeKey].deleteRule, { apply: callbackWrapper((target, thisArg, argumentsList) => {
					const [index2] = argumentsList;
					const { id, styleId } = getIdAndStyleId(thisArg.parentStyleSheet, mirror2, stylesheetManager.styleMirror);
					if (id && id !== -1 || styleId && styleId !== -1) styleSheetRuleCb({
						id,
						styleId,
						removes: [{ index: [...getNestedCSSRulePositions(thisArg), index2] }]
					});
					return target.apply(thisArg, argumentsList);
				}) });
			});
			return callbackWrapper(() => {
				win.CSSStyleSheet.prototype.insertRule = insertRule;
				win.CSSStyleSheet.prototype.deleteRule = deleteRule;
				replace && (win.CSSStyleSheet.prototype.replace = replace);
				replaceSync && (win.CSSStyleSheet.prototype.replaceSync = replaceSync);
				Object.entries(supportedNestedCSSRuleTypes).forEach(([typeKey, type]) => {
					type.prototype.insertRule = unmodifiedFunctions[typeKey].insertRule;
					type.prototype.deleteRule = unmodifiedFunctions[typeKey].deleteRule;
				});
			});
		}
		function initAdoptedStyleSheetObserver({ mirror: mirror2, stylesheetManager }, host2) {
			var _a2, _b, _c;
			let hostId = null;
			if (host2.nodeName === "#document") hostId = mirror2.getId(host2);
			else hostId = mirror2.getId(index.host(host2));
			const patchTarget = host2.nodeName === "#document" ? (_a2 = host2.defaultView) == null ? void 0 : _a2.Document : (_c = (_b = host2.ownerDocument) == null ? void 0 : _b.defaultView) == null ? void 0 : _c.ShadowRoot;
			const originalPropertyDescriptor = (patchTarget == null ? void 0 : patchTarget.prototype) ? Object.getOwnPropertyDescriptor(patchTarget == null ? void 0 : patchTarget.prototype, "adoptedStyleSheets") : void 0;
			if (hostId === null || hostId === -1 || !patchTarget || !originalPropertyDescriptor) return () => {};
			Object.defineProperty(host2, "adoptedStyleSheets", {
				configurable: originalPropertyDescriptor.configurable,
				enumerable: originalPropertyDescriptor.enumerable,
				get() {
					var _a3;
					return (_a3 = originalPropertyDescriptor.get) == null ? void 0 : _a3.call(this);
				},
				set(sheets) {
					var _a3;
					const result2 = (_a3 = originalPropertyDescriptor.set) == null ? void 0 : _a3.call(this, sheets);
					if (hostId !== null && hostId !== -1) try {
						stylesheetManager.adoptStyleSheets(sheets, hostId);
					} catch (e2) {}
					return result2;
				}
			});
			return callbackWrapper(() => {
				Object.defineProperty(host2, "adoptedStyleSheets", {
					configurable: originalPropertyDescriptor.configurable,
					enumerable: originalPropertyDescriptor.enumerable,
					get: originalPropertyDescriptor.get,
					set: originalPropertyDescriptor.set
				});
			});
		}
		function initStyleDeclarationObserver({ styleDeclarationCb, mirror: mirror2, ignoreCSSAttributes, stylesheetManager }, { win }) {
			const setProperty = win.CSSStyleDeclaration.prototype.setProperty;
			win.CSSStyleDeclaration.prototype.setProperty = new Proxy(setProperty, { apply: callbackWrapper((target, thisArg, argumentsList) => {
				var _a2;
				const [property, value, priority] = argumentsList;
				if (ignoreCSSAttributes.has(property)) return setProperty.apply(thisArg, [
					property,
					value,
					priority
				]);
				const { id, styleId } = getIdAndStyleId((_a2 = thisArg.parentRule) == null ? void 0 : _a2.parentStyleSheet, mirror2, stylesheetManager.styleMirror);
				if (id && id !== -1 || styleId && styleId !== -1) styleDeclarationCb({
					id,
					styleId,
					set: {
						property,
						value,
						priority
					},
					index: getNestedCSSRulePositions(thisArg.parentRule)
				});
				return target.apply(thisArg, argumentsList);
			}) });
			const removeProperty = win.CSSStyleDeclaration.prototype.removeProperty;
			win.CSSStyleDeclaration.prototype.removeProperty = new Proxy(removeProperty, { apply: callbackWrapper((target, thisArg, argumentsList) => {
				var _a2;
				const [property] = argumentsList;
				if (ignoreCSSAttributes.has(property)) return removeProperty.apply(thisArg, [property]);
				const { id, styleId } = getIdAndStyleId((_a2 = thisArg.parentRule) == null ? void 0 : _a2.parentStyleSheet, mirror2, stylesheetManager.styleMirror);
				if (id && id !== -1 || styleId && styleId !== -1) styleDeclarationCb({
					id,
					styleId,
					remove: { property },
					index: getNestedCSSRulePositions(thisArg.parentRule)
				});
				return target.apply(thisArg, argumentsList);
			}) });
			return callbackWrapper(() => {
				win.CSSStyleDeclaration.prototype.setProperty = setProperty;
				win.CSSStyleDeclaration.prototype.removeProperty = removeProperty;
			});
		}
		function initMediaInteractionObserver({ mediaInteractionCb, blockClass, blockSelector, mirror: mirror2, sampling, doc }) {
			const handler = callbackWrapper((type) => throttle(callbackWrapper((event) => {
				const target = getEventTarget(event);
				if (!target || isBlocked(target, blockClass, blockSelector, true)) return;
				const { currentTime, volume, muted, playbackRate, loop } = target;
				mediaInteractionCb({
					type,
					id: mirror2.getId(target),
					currentTime,
					volume,
					muted,
					playbackRate,
					loop
				});
			}), sampling.media || 500));
			const handlers = [
				on("play", handler(MediaInteractions.Play), doc),
				on("pause", handler(MediaInteractions.Pause), doc),
				on("seeked", handler(MediaInteractions.Seeked), doc),
				on("volumechange", handler(MediaInteractions.VolumeChange), doc),
				on("ratechange", handler(MediaInteractions.RateChange), doc)
			];
			return callbackWrapper(() => {
				handlers.forEach((h) => h());
			});
		}
		function initFontObserver({ fontCb, doc }) {
			const win = doc.defaultView;
			if (!win) return () => {};
			const handlers = [];
			const fontMap = /* @__PURE__ */ new WeakMap();
			const originalFontFace = win.FontFace;
			win.FontFace = function FontFace2(family, source, descriptors) {
				const fontFace = new originalFontFace(family, source, descriptors);
				fontMap.set(fontFace, {
					family,
					buffer: typeof source !== "string",
					descriptors,
					fontSource: typeof source === "string" ? source : JSON.stringify(Array.from(new Uint8Array(source)))
				});
				return fontFace;
			};
			const restoreHandler = patch(doc.fonts, "add", function(original) {
				return function(fontFace) {
					setTimeout(callbackWrapper(() => {
						const p = fontMap.get(fontFace);
						if (p) {
							fontCb(p);
							fontMap.delete(fontFace);
						}
					}), 0);
					return original.apply(this, [fontFace]);
				};
			});
			handlers.push(() => {
				win.FontFace = originalFontFace;
			});
			handlers.push(restoreHandler);
			return callbackWrapper(() => {
				handlers.forEach((h) => h());
			});
		}
		function initSelectionObserver(param) {
			const { doc, mirror: mirror2, blockClass, blockSelector, selectionCb } = param;
			let collapsed = true;
			const updateSelection = callbackWrapper(() => {
				const selection = doc.getSelection();
				if (!selection || collapsed && (selection == null ? void 0 : selection.isCollapsed)) return;
				collapsed = selection.isCollapsed || false;
				const ranges = [];
				const count = selection.rangeCount || 0;
				for (let i2 = 0; i2 < count; i2++) {
					const { startContainer, startOffset, endContainer, endOffset } = selection.getRangeAt(i2);
					if (isBlocked(startContainer, blockClass, blockSelector, true) || isBlocked(endContainer, blockClass, blockSelector, true)) continue;
					ranges.push({
						start: mirror2.getId(startContainer),
						startOffset,
						end: mirror2.getId(endContainer),
						endOffset
					});
				}
				selectionCb({ ranges });
			});
			updateSelection();
			return on("selectionchange", updateSelection);
		}
		function initCustomElementObserver({ doc, customElementCb }) {
			const win = doc.defaultView;
			if (!win || !win.customElements) return () => {};
			return patch(win.customElements, "define", function(original) {
				return function(name, constructor, options) {
					try {
						customElementCb({ define: { name } });
					} catch (e2) {
						console.warn(`Custom element callback failed for ${name}`);
					}
					return original.apply(this, [
						name,
						constructor,
						options
					]);
				};
			});
		}
		function mergeHooks(o2, hooks) {
			const { mutationCb, mousemoveCb, mouseInteractionCb, scrollCb, viewportResizeCb, inputCb, mediaInteractionCb, styleSheetRuleCb, styleDeclarationCb, canvasMutationCb, fontCb, selectionCb, customElementCb } = o2;
			o2.mutationCb = (...p) => {
				if (hooks.mutation) hooks.mutation(...p);
				mutationCb(...p);
			};
			o2.mousemoveCb = (...p) => {
				if (hooks.mousemove) hooks.mousemove(...p);
				mousemoveCb(...p);
			};
			o2.mouseInteractionCb = (...p) => {
				if (hooks.mouseInteraction) hooks.mouseInteraction(...p);
				mouseInteractionCb(...p);
			};
			o2.scrollCb = (...p) => {
				if (hooks.scroll) hooks.scroll(...p);
				scrollCb(...p);
			};
			o2.viewportResizeCb = (...p) => {
				if (hooks.viewportResize) hooks.viewportResize(...p);
				viewportResizeCb(...p);
			};
			o2.inputCb = (...p) => {
				if (hooks.input) hooks.input(...p);
				inputCb(...p);
			};
			o2.mediaInteractionCb = (...p) => {
				if (hooks.mediaInteaction) hooks.mediaInteaction(...p);
				mediaInteractionCb(...p);
			};
			o2.styleSheetRuleCb = (...p) => {
				if (hooks.styleSheetRule) hooks.styleSheetRule(...p);
				styleSheetRuleCb(...p);
			};
			o2.styleDeclarationCb = (...p) => {
				if (hooks.styleDeclaration) hooks.styleDeclaration(...p);
				styleDeclarationCb(...p);
			};
			o2.canvasMutationCb = (...p) => {
				if (hooks.canvasMutation) hooks.canvasMutation(...p);
				canvasMutationCb(...p);
			};
			o2.fontCb = (...p) => {
				if (hooks.font) hooks.font(...p);
				fontCb(...p);
			};
			o2.selectionCb = (...p) => {
				if (hooks.selection) hooks.selection(...p);
				selectionCb(...p);
			};
			o2.customElementCb = (...c2) => {
				if (hooks.customElement) hooks.customElement(...c2);
				customElementCb(...c2);
			};
		}
		function initObservers(o2, hooks = {}) {
			const currentWindow = o2.doc.defaultView;
			if (!currentWindow) return () => {};
			mergeHooks(o2, hooks);
			let stopMutationObserver;
			if (o2.recordDOM) stopMutationObserver = initMutationObserver(o2, o2.doc);
			const mousemoveHandler = initMoveObserver(o2);
			const mouseInteractionHandler = initMouseInteractionObserver(o2);
			const scrollHandler = initScrollObserver(o2);
			const viewportResizeHandler = initViewportResizeObserver(o2, { win: currentWindow });
			const inputHandler = initInputObserver(o2);
			const mediaInteractionHandler = initMediaInteractionObserver(o2);
			let styleSheetObserver = () => {};
			let adoptedStyleSheetObserver = () => {};
			let styleDeclarationObserver = () => {};
			let fontObserver = () => {};
			if (o2.recordDOM) {
				styleSheetObserver = initStyleSheetObserver(o2, { win: currentWindow });
				adoptedStyleSheetObserver = initAdoptedStyleSheetObserver(o2, o2.doc);
				styleDeclarationObserver = initStyleDeclarationObserver(o2, { win: currentWindow });
				if (o2.collectFonts) fontObserver = initFontObserver(o2);
			}
			const selectionObserver = initSelectionObserver(o2);
			const customElementObserver = initCustomElementObserver(o2);
			const pluginHandlers = [];
			for (const plugin of o2.plugins) pluginHandlers.push(plugin.observer(plugin.callback, currentWindow, plugin.options));
			return callbackWrapper(() => {
				stopMutationObserver?.();
				mousemoveHandler();
				mouseInteractionHandler();
				scrollHandler();
				viewportResizeHandler();
				inputHandler();
				mediaInteractionHandler();
				styleSheetObserver();
				adoptedStyleSheetObserver();
				styleDeclarationObserver();
				fontObserver();
				selectionObserver();
				customElementObserver();
				pluginHandlers.forEach((h) => h());
			});
		}
		function hasNestedCSSRule(prop) {
			return typeof window[prop] !== "undefined";
		}
		function canMonkeyPatchNestedCSSRule(prop) {
			return Boolean(typeof window[prop] !== "undefined" && window[prop].prototype && "insertRule" in window[prop].prototype && "deleteRule" in window[prop].prototype);
		}
		function runHandler(handler) {
			try {
				handler();
			} catch (e2) {}
		}
		function variableListFor$1(ctx, ctor) {
			let contextMap = canvasVarMap.get(ctx);
			if (!contextMap) {
				contextMap = /* @__PURE__ */ new Map();
				canvasVarMap.set(ctx, contextMap);
			}
			if (!contextMap.has(ctor)) contextMap.set(ctor, []);
			return contextMap.get(ctor);
		}
		function serializeArg(value, win, ctx) {
			if (value instanceof Array) return value.map((arg) => serializeArg(arg, win, ctx));
			else if (value === null) return value;
			else if (value instanceof Float32Array || value instanceof Float64Array || value instanceof Int32Array || value instanceof Uint32Array || value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Int16Array || value instanceof Int8Array || value instanceof Uint8ClampedArray) return {
				rr_type: value.constructor.name,
				args: [Object.values(value)]
			};
			else if (value instanceof ArrayBuffer) return {
				rr_type: value.constructor.name,
				base64: encode(value)
			};
			else if (value instanceof DataView) return {
				rr_type: value.constructor.name,
				args: [
					serializeArg(value.buffer, win, ctx),
					value.byteOffset,
					value.byteLength
				]
			};
			else if (value instanceof HTMLImageElement) {
				const name = value.constructor.name;
				const { src } = value;
				return {
					rr_type: name,
					src
				};
			} else if (value instanceof HTMLCanvasElement) return {
				rr_type: "HTMLImageElement",
				src: value.toDataURL()
			};
			else if (value instanceof ImageData) return {
				rr_type: value.constructor.name,
				args: [
					serializeArg(value.data, win, ctx),
					value.width,
					value.height
				]
			};
			else if (isInstanceOfWebGLObject(value, win) || typeof value === "object") return {
				rr_type: value.constructor.name,
				index: saveWebGLVar(value, win, ctx)
			};
			return value;
		}
		function initCanvas2DMutationObserver(cb, win, blockClass, blockSelector) {
			const handlers = [];
			const props2D = Object.getOwnPropertyNames(win.CanvasRenderingContext2D.prototype);
			for (const prop of props2D) try {
				if (typeof win.CanvasRenderingContext2D.prototype[prop] !== "function") continue;
				const restoreHandler = patch(win.CanvasRenderingContext2D.prototype, prop, function(original) {
					return function(...args) {
						if (!isBlocked(this.canvas, blockClass, blockSelector, true)) setTimeout(() => {
							const recordArgs = serializeArgs(args, win, this);
							cb(this.canvas, {
								type: CanvasContext["2D"],
								property: prop,
								args: recordArgs
							});
						}, 0);
						return original.apply(this, args);
					};
				});
				handlers.push(restoreHandler);
			} catch {
				const hookHandler = hookSetter(win.CanvasRenderingContext2D.prototype, prop, { set(v2) {
					cb(this.canvas, {
						type: CanvasContext["2D"],
						property: prop,
						args: [v2],
						setter: true
					});
				} });
				handlers.push(hookHandler);
			}
			return () => {
				handlers.forEach((h) => h());
			};
		}
		function getNormalizedContextName(contextType) {
			return contextType === "experimental-webgl" ? "webgl" : contextType;
		}
		function initCanvasContextObserver(win, blockClass, blockSelector, setPreserveDrawingBufferToTrue) {
			const handlers = [];
			try {
				const restoreHandler = patch(win.HTMLCanvasElement.prototype, "getContext", function(original) {
					return function(contextType, ...args) {
						if (!isBlocked(this, blockClass, blockSelector, true)) {
							const ctxName = getNormalizedContextName(contextType);
							if (!("__context" in this)) this.__context = ctxName;
							if (setPreserveDrawingBufferToTrue && ["webgl", "webgl2"].includes(ctxName)) if (args[0] && typeof args[0] === "object") {
								const contextAttributes = args[0];
								if (!contextAttributes.preserveDrawingBuffer) contextAttributes.preserveDrawingBuffer = true;
							} else args.splice(0, 1, { preserveDrawingBuffer: true });
						}
						return original.apply(this, [contextType, ...args]);
					};
				});
				handlers.push(restoreHandler);
			} catch {
				console.error("failed to patch HTMLCanvasElement.prototype.getContext");
			}
			return () => {
				handlers.forEach((h) => h());
			};
		}
		function patchGLPrototype(prototype, type, cb, blockClass, blockSelector, win) {
			const handlers = [];
			const props = Object.getOwnPropertyNames(prototype);
			for (const prop of props) {
				if ([
					"isContextLost",
					"canvas",
					"drawingBufferWidth",
					"drawingBufferHeight"
				].includes(prop)) continue;
				try {
					if (typeof prototype[prop] !== "function") continue;
					const restoreHandler = patch(prototype, prop, function(original) {
						return function(...args) {
							const result2 = original.apply(this, args);
							saveWebGLVar(result2, win, this);
							if ("tagName" in this.canvas && !isBlocked(this.canvas, blockClass, blockSelector, true)) {
								const recordArgs = serializeArgs(args, win, this);
								const mutation = {
									type,
									property: prop,
									args: recordArgs
								};
								cb(this.canvas, mutation);
							}
							return result2;
						};
					});
					handlers.push(restoreHandler);
				} catch {
					const hookHandler = hookSetter(prototype, prop, { set(v2) {
						cb(this.canvas, {
							type,
							property: prop,
							args: [v2],
							setter: true
						});
					} });
					handlers.push(hookHandler);
				}
			}
			return handlers;
		}
		function initCanvasWebGLMutationObserver(cb, win, blockClass, blockSelector) {
			const handlers = [];
			if (typeof win.WebGLRenderingContext !== "undefined") handlers.push(...patchGLPrototype(win.WebGLRenderingContext.prototype, CanvasContext.WebGL, cb, blockClass, blockSelector, win));
			if (typeof win.WebGL2RenderingContext !== "undefined") handlers.push(...patchGLPrototype(win.WebGL2RenderingContext.prototype, CanvasContext.WebGL2, cb, blockClass, blockSelector, win));
			return () => {
				handlers.forEach((h) => h());
			};
		}
		function WorkerWrapper(options) {
			let objURL;
			try {
				objURL = blob && (self.URL || self.webkitURL).createObjectURL(blob);
				if (!objURL) throw "";
				const worker = new Worker(objURL, { name: options == null ? void 0 : options.name });
				worker.addEventListener("error", () => {
					(self.URL || self.webkitURL).revokeObjectURL(objURL);
				});
				return worker;
			} catch (e2) {
				return new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(jsContent), { name: options == null ? void 0 : options.name });
			} finally {
				objURL && (self.URL || self.webkitURL).revokeObjectURL(objURL);
			}
		}
		function record(options = {}) {
			const { emit, checkoutEveryNms, checkoutEveryNth, blockClass = "rr-block", blockSelector = null, ignoreClass = "rr-ignore", ignoreSelector = null, maskTextClass = "rr-mask", maskTextSelector = null, inlineStylesheet = true, maskAllInputs, maskInputOptions: _maskInputOptions, slimDOMOptions: _slimDOMOptions, maskInputFn, maskTextFn, hooks, packFn, sampling = {}, dataURLOptions = {}, mousemoveWait, recordDOM = true, recordCanvas = false, recordCrossOriginIframes = false, recordAfter = options.recordAfter === "DOMContentLoaded" ? options.recordAfter : "load", userTriggeredOnInput = false, collectFonts = false, inlineImages = false, plugins, keepIframeSrcFn = () => false, ignoreCSSAttributes = /* @__PURE__ */ new Set([]), errorHandler: errorHandler2 } = options;
			registerErrorHandler(errorHandler2);
			const inEmittingFrame = recordCrossOriginIframes ? window.parent === window : true;
			let passEmitsToParent = false;
			if (!inEmittingFrame) try {
				if (window.parent.document) passEmitsToParent = false;
			} catch (e2) {
				passEmitsToParent = true;
			}
			if (inEmittingFrame && !emit) throw new Error("emit function is required");
			if (!inEmittingFrame && !passEmitsToParent) return () => {};
			if (mousemoveWait !== void 0 && sampling.mousemove === void 0) sampling.mousemove = mousemoveWait;
			mirror.reset();
			const maskInputOptions = maskAllInputs === true ? {
				color: true,
				date: true,
				"datetime-local": true,
				email: true,
				month: true,
				number: true,
				range: true,
				search: true,
				tel: true,
				text: true,
				time: true,
				url: true,
				week: true,
				textarea: true,
				select: true,
				password: true
			} : _maskInputOptions !== void 0 ? _maskInputOptions : { password: true };
			const slimDOMOptions = slimDOMDefaults(_slimDOMOptions);
			polyfill$1();
			let lastFullSnapshotEvent;
			let incrementalSnapshotCount = 0;
			const eventProcessor = (e2) => {
				for (const plugin of plugins || []) if (plugin.eventProcessor) e2 = plugin.eventProcessor(e2);
				if (packFn && !passEmitsToParent) e2 = packFn(e2);
				return e2;
			};
			wrappedEmit = (r2, isCheckout) => {
				const e2 = r2;
				e2.timestamp = nowTimestamp();
				if (e2.type !== EventType.FullSnapshot && !(e2.type === EventType.IncrementalSnapshot && e2.data.source === IncrementalSource.Mutation)) {
					canvasManager.unfreeze();
					for (const buf of mutationBuffers) if (buf.isFrozen()) buf.unfreeze();
					else break;
				}
				if (inEmittingFrame) emit?.(eventProcessor(e2), isCheckout);
				else if (passEmitsToParent) {
					const message = {
						type: "rrweb",
						event: eventProcessor(e2),
						origin: window.location.origin,
						isCheckout
					};
					window.parent.postMessage(message, "*");
				}
				if (e2.type === EventType.FullSnapshot) {
					lastFullSnapshotEvent = e2;
					incrementalSnapshotCount = 0;
				} else if (e2.type === EventType.IncrementalSnapshot) {
					if (e2.data.source === IncrementalSource.Mutation && e2.data.isAttachIframe) return;
					incrementalSnapshotCount++;
					const exceedCount = checkoutEveryNth && incrementalSnapshotCount >= checkoutEveryNth;
					const exceedTime = checkoutEveryNms && e2.timestamp - lastFullSnapshotEvent.timestamp > checkoutEveryNms;
					if (exceedCount || exceedTime) takeFullSnapshot$1(true);
				}
			};
			const wrappedMutationEmit = (m) => {
				wrappedEmit({
					type: EventType.IncrementalSnapshot,
					data: {
						source: IncrementalSource.Mutation,
						...m
					}
				});
			};
			const wrappedScrollEmit = (p) => wrappedEmit({
				type: EventType.IncrementalSnapshot,
				data: {
					source: IncrementalSource.Scroll,
					...p
				}
			});
			const wrappedCanvasMutationEmit = (p) => wrappedEmit({
				type: EventType.IncrementalSnapshot,
				data: {
					source: IncrementalSource.CanvasMutation,
					...p
				}
			});
			const wrappedAdoptedStyleSheetEmit = (a2) => wrappedEmit({
				type: EventType.IncrementalSnapshot,
				data: {
					source: IncrementalSource.AdoptedStyleSheet,
					...a2
				}
			});
			const stylesheetManager = new StylesheetManager({
				mutationCb: wrappedMutationEmit,
				adoptedStyleSheetCb: wrappedAdoptedStyleSheetEmit
			});
			const iframeManager = new IframeManager({
				mirror,
				mutationCb: wrappedMutationEmit,
				stylesheetManager,
				recordCrossOriginIframes,
				wrappedEmit
			});
			for (const plugin of plugins || []) if (plugin.getMirror) plugin.getMirror({
				nodeMirror: mirror,
				crossOriginIframeMirror: iframeManager.crossOriginIframeMirror,
				crossOriginIframeStyleMirror: iframeManager.crossOriginIframeStyleMirror
			});
			const processedNodeManager = new ProcessedNodeManager();
			canvasManager = new CanvasManager({
				recordCanvas,
				mutationCb: wrappedCanvasMutationEmit,
				win: window,
				blockClass,
				blockSelector,
				mirror,
				sampling: sampling.canvas,
				dataURLOptions
			});
			const shadowDomManager = new ShadowDomManager({
				mutationCb: wrappedMutationEmit,
				scrollCb: wrappedScrollEmit,
				bypassOptions: {
					blockClass,
					blockSelector,
					maskTextClass,
					maskTextSelector,
					inlineStylesheet,
					maskInputOptions,
					dataURLOptions,
					maskTextFn,
					maskInputFn,
					recordCanvas,
					inlineImages,
					sampling,
					slimDOMOptions,
					iframeManager,
					stylesheetManager,
					canvasManager,
					keepIframeSrcFn,
					processedNodeManager
				},
				mirror
			});
			takeFullSnapshot$1 = (isCheckout = false) => {
				if (!recordDOM) return;
				wrappedEmit({
					type: EventType.Meta,
					data: {
						href: window.location.href,
						width: getWindowWidth(),
						height: getWindowHeight()
					}
				}, isCheckout);
				stylesheetManager.reset();
				shadowDomManager.init();
				canvasManager.lock();
				mutationBuffers.forEach((buf) => buf.lock());
				const node2 = snapshot(document, {
					mirror,
					blockClass,
					blockSelector,
					maskTextClass,
					maskTextSelector,
					inlineStylesheet,
					maskAllInputs: maskInputOptions,
					maskTextFn,
					maskInputFn,
					slimDOM: slimDOMOptions,
					dataURLOptions,
					recordCanvas,
					inlineImages,
					onSerialize: (n2) => {
						if (isSerializedIframe(n2, mirror)) iframeManager.addIframe(n2);
						if (isSerializedStylesheet(n2, mirror)) stylesheetManager.trackLinkElement(n2);
						if (hasShadowRoot(n2)) shadowDomManager.addShadowRoot(index.shadowRoot(n2), document);
					},
					onIframeLoad: (iframe, childSn) => {
						iframeManager.attachIframe(iframe, childSn);
						shadowDomManager.observeAttachShadow(iframe);
					},
					onStylesheetLoad: (linkEl, childSn) => {
						stylesheetManager.attachLinkElement(linkEl, childSn);
					},
					keepIframeSrcFn
				});
				if (!node2) return console.warn("Failed to snapshot the document");
				wrappedEmit({
					type: EventType.FullSnapshot,
					data: {
						node: node2,
						initialOffset: getWindowScroll(window)
					}
				}, isCheckout);
				canvasManager.unlock();
				mutationBuffers.forEach((buf) => buf.unlock());
				if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0) stylesheetManager.adoptStyleSheets(document.adoptedStyleSheets, mirror.getId(document));
			};
			try {
				const handlers = [];
				const observe = (doc) => {
					var _a2;
					return callbackWrapper(initObservers)({
						mutationCb: wrappedMutationEmit,
						mousemoveCb: (positions, source) => wrappedEmit({
							type: EventType.IncrementalSnapshot,
							data: {
								source,
								positions
							}
						}),
						mouseInteractionCb: (d) => wrappedEmit({
							type: EventType.IncrementalSnapshot,
							data: {
								source: IncrementalSource.MouseInteraction,
								...d
							}
						}),
						scrollCb: wrappedScrollEmit,
						viewportResizeCb: (d) => wrappedEmit({
							type: EventType.IncrementalSnapshot,
							data: {
								source: IncrementalSource.ViewportResize,
								...d
							}
						}),
						inputCb: (v2) => wrappedEmit({
							type: EventType.IncrementalSnapshot,
							data: {
								source: IncrementalSource.Input,
								...v2
							}
						}),
						mediaInteractionCb: (p) => wrappedEmit({
							type: EventType.IncrementalSnapshot,
							data: {
								source: IncrementalSource.MediaInteraction,
								...p
							}
						}),
						styleSheetRuleCb: (r2) => wrappedEmit({
							type: EventType.IncrementalSnapshot,
							data: {
								source: IncrementalSource.StyleSheetRule,
								...r2
							}
						}),
						styleDeclarationCb: (r2) => wrappedEmit({
							type: EventType.IncrementalSnapshot,
							data: {
								source: IncrementalSource.StyleDeclaration,
								...r2
							}
						}),
						canvasMutationCb: wrappedCanvasMutationEmit,
						fontCb: (p) => wrappedEmit({
							type: EventType.IncrementalSnapshot,
							data: {
								source: IncrementalSource.Font,
								...p
							}
						}),
						selectionCb: (p) => {
							wrappedEmit({
								type: EventType.IncrementalSnapshot,
								data: {
									source: IncrementalSource.Selection,
									...p
								}
							});
						},
						customElementCb: (c2) => {
							wrappedEmit({
								type: EventType.IncrementalSnapshot,
								data: {
									source: IncrementalSource.CustomElement,
									...c2
								}
							});
						},
						blockClass,
						ignoreClass,
						ignoreSelector,
						maskTextClass,
						maskTextSelector,
						maskInputOptions,
						inlineStylesheet,
						sampling,
						recordDOM,
						recordCanvas,
						inlineImages,
						userTriggeredOnInput,
						collectFonts,
						doc,
						maskInputFn,
						maskTextFn,
						keepIframeSrcFn,
						blockSelector,
						slimDOMOptions,
						dataURLOptions,
						mirror,
						iframeManager,
						stylesheetManager,
						shadowDomManager,
						processedNodeManager,
						canvasManager,
						ignoreCSSAttributes,
						plugins: ((_a2 = plugins == null ? void 0 : plugins.filter((p) => p.observer)) == null ? void 0 : _a2.map((p) => ({
							observer: p.observer,
							options: p.options,
							callback: (payload) => wrappedEmit({
								type: EventType.Plugin,
								data: {
									plugin: p.name,
									payload
								}
							})
						}))) || []
					}, hooks);
				};
				const iframeObservers = /* @__PURE__ */ new Map();
				iframeManager.addLoadListener((iframeEl) => {
					try {
						const doc = iframeEl.contentDocument;
						if (iframeObservers.has(doc)) return;
						iframeObservers.set(doc, observe(doc));
					} catch (error) {
						console.warn(error);
					}
				});
				iframeManager.addUnloadListener((doc) => {
					const stopObserving = iframeObservers.get(doc);
					if (!stopObserving) return;
					iframeObservers.delete(doc);
					stopObserving();
					shadowDomManager.removeShadowRootsIn(doc);
					mirror.removeNodeFromMap(doc);
				});
				const init = () => {
					takeFullSnapshot$1();
					handlers.push(observe(document));
					recording = true;
				};
				if (["interactive", "complete"].includes(document.readyState)) init();
				else {
					handlers.push(on("DOMContentLoaded", () => {
						wrappedEmit({
							type: EventType.DomContentLoaded,
							data: {}
						});
						if (recordAfter === "DOMContentLoaded") init();
					}));
					handlers.push(on("load", () => {
						wrappedEmit({
							type: EventType.Load,
							data: {}
						});
						if (recordAfter === "load") init();
					}, window));
				}
				return () => {
					[...handlers, ...iframeObservers.values()].forEach((handler) => {
						try {
							handler();
						} catch (error) {
							if (!String(error).toLowerCase().includes("cross-origin")) console.warn(error);
						}
					});
					iframeObservers.clear();
					iframeManager.destroy();
					processedNodeManager.destroy();
					shadowDomManager.reset();
					canvasManager.reset();
					recording = false;
					unregisterErrorHandler();
				};
			} catch (error) {
				console.warn(error);
			}
		}
		function mitt$1(n2) {
			return {
				all: n2 = n2 || /* @__PURE__ */ new Map(),
				on: function(t2, e2) {
					var i2 = n2.get(t2);
					i2 ? i2.push(e2) : n2.set(t2, [e2]);
				},
				off: function(t2, e2) {
					var i2 = n2.get(t2);
					i2 && (e2 ? i2.splice(i2.indexOf(e2) >>> 0, 1) : n2.set(t2, []));
				},
				emit: function(t2, e2) {
					var i2 = n2.get(t2);
					i2 && i2.slice().map(function(n3) {
						n3(e2);
					}), (i2 = n2.get("*")) && i2.slice().map(function(n3) {
						n3(t2, e2);
					});
				}
			};
		}
		function polyfill(w = window, d = document) {
			if ("scrollBehavior" in d.documentElement.style && w.__forceSmoothScrollPolyfill__ !== true) return;
			const Element2 = w.HTMLElement || w.Element;
			const SCROLL_TIME = 468;
			const original = {
				scroll: w.scroll || w.scrollTo,
				scrollBy: w.scrollBy,
				elementScroll: Element2.prototype.scroll || scrollElement,
				scrollIntoView: Element2.prototype.scrollIntoView
			};
			const now = w.performance && w.performance.now ? w.performance.now.bind(w.performance) : Date.now;
			function isMicrosoftBrowser(userAgent) {
				return new RegExp([
					"MSIE ",
					"Trident/",
					"Edge/"
				].join("|")).test(userAgent);
			}
			const ROUNDING_TOLERANCE = isMicrosoftBrowser(w.navigator.userAgent) ? 1 : 0;
			function scrollElement(x, y) {
				this.scrollLeft = x;
				this.scrollTop = y;
			}
			function ease(k) {
				return .5 * (1 - Math.cos(Math.PI * k));
			}
			function shouldBailOut(firstArg) {
				if (firstArg === null || typeof firstArg !== "object" || firstArg.behavior === void 0 || firstArg.behavior === "auto" || firstArg.behavior === "instant") return true;
				if (typeof firstArg === "object" && firstArg.behavior === "smooth") return false;
				throw new TypeError("behavior member of ScrollOptions " + firstArg.behavior + " is not a valid value for enumeration ScrollBehavior.");
			}
			function hasScrollableSpace(el, axis) {
				if (axis === "Y") return el.clientHeight + ROUNDING_TOLERANCE < el.scrollHeight;
				if (axis === "X") return el.clientWidth + ROUNDING_TOLERANCE < el.scrollWidth;
			}
			function canOverflow(el, axis) {
				const overflowValue = w.getComputedStyle(el, null)["overflow" + axis];
				return overflowValue === "auto" || overflowValue === "scroll";
			}
			function isScrollable(el) {
				const isScrollableY = hasScrollableSpace(el, "Y") && canOverflow(el, "Y");
				const isScrollableX = hasScrollableSpace(el, "X") && canOverflow(el, "X");
				return isScrollableY || isScrollableX;
			}
			function findScrollableParent(el) {
				while (el !== d.body && isScrollable(el) === false) el = el.parentNode || el.host;
				return el;
			}
			function step(context) {
				const time = now();
				let value;
				let currentX;
				let currentY;
				let elapsed = (time - context.startTime) / SCROLL_TIME;
				elapsed = elapsed > 1 ? 1 : elapsed;
				value = ease(elapsed);
				currentX = context.startX + (context.x - context.startX) * value;
				currentY = context.startY + (context.y - context.startY) * value;
				context.method.call(context.scrollable, currentX, currentY);
				if (currentX !== context.x || currentY !== context.y) w.requestAnimationFrame(step.bind(w, context));
			}
			function smoothScroll(el, x, y) {
				let scrollable;
				let startX;
				let startY;
				let method;
				const startTime = now();
				if (el === d.body) {
					scrollable = w;
					startX = w.scrollX || w.pageXOffset;
					startY = w.scrollY || w.pageYOffset;
					method = original.scroll;
				} else {
					scrollable = el;
					startX = el.scrollLeft;
					startY = el.scrollTop;
					method = scrollElement;
				}
				step({
					scrollable,
					method,
					startTime,
					startX,
					startY,
					x,
					y
				});
			}
			w.scroll = w.scrollTo = function() {
				if (arguments[0] === void 0) return;
				if (shouldBailOut(arguments[0]) === true) {
					original.scroll.call(w, arguments[0].left !== void 0 ? arguments[0].left : typeof arguments[0] !== "object" ? arguments[0] : w.scrollX || w.pageXOffset, arguments[0].top !== void 0 ? arguments[0].top : arguments[1] !== void 0 ? arguments[1] : w.scrollY || w.pageYOffset);
					return;
				}
				smoothScroll.call(w, d.body, arguments[0].left !== void 0 ? ~~arguments[0].left : w.scrollX || w.pageXOffset, arguments[0].top !== void 0 ? ~~arguments[0].top : w.scrollY || w.pageYOffset);
			};
			w.scrollBy = function() {
				if (arguments[0] === void 0) return;
				if (shouldBailOut(arguments[0])) {
					original.scrollBy.call(w, arguments[0].left !== void 0 ? arguments[0].left : typeof arguments[0] !== "object" ? arguments[0] : 0, arguments[0].top !== void 0 ? arguments[0].top : arguments[1] !== void 0 ? arguments[1] : 0);
					return;
				}
				smoothScroll.call(w, d.body, ~~arguments[0].left + (w.scrollX || w.pageXOffset), ~~arguments[0].top + (w.scrollY || w.pageYOffset));
			};
			Element2.prototype.scroll = Element2.prototype.scrollTo = function() {
				if (arguments[0] === void 0) return;
				if (shouldBailOut(arguments[0]) === true) {
					if (typeof arguments[0] === "number" && arguments[1] === void 0) throw new SyntaxError("Value could not be converted");
					original.elementScroll.call(this, arguments[0].left !== void 0 ? ~~arguments[0].left : typeof arguments[0] !== "object" ? ~~arguments[0] : this.scrollLeft, arguments[0].top !== void 0 ? ~~arguments[0].top : arguments[1] !== void 0 ? ~~arguments[1] : this.scrollTop);
					return;
				}
				const left = arguments[0].left;
				const top = arguments[0].top;
				smoothScroll.call(this, this, typeof left === "undefined" ? this.scrollLeft : ~~left, typeof top === "undefined" ? this.scrollTop : ~~top);
			};
			Element2.prototype.scrollBy = function() {
				if (arguments[0] === void 0) return;
				if (shouldBailOut(arguments[0]) === true) {
					original.elementScroll.call(this, arguments[0].left !== void 0 ? ~~arguments[0].left + this.scrollLeft : ~~arguments[0] + this.scrollLeft, arguments[0].top !== void 0 ? ~~arguments[0].top + this.scrollTop : ~~arguments[1] + this.scrollTop);
					return;
				}
				this.scroll({
					left: ~~arguments[0].left + this.scrollLeft,
					top: ~~arguments[0].top + this.scrollTop,
					behavior: arguments[0].behavior
				});
			};
			Element2.prototype.scrollIntoView = function() {
				if (shouldBailOut(arguments[0]) === true) {
					original.scrollIntoView.call(this, arguments[0] === void 0 ? true : arguments[0]);
					return;
				}
				const scrollableParent = findScrollableParent(this);
				const parentRects = scrollableParent.getBoundingClientRect();
				const clientRects = this.getBoundingClientRect();
				if (scrollableParent !== d.body) {
					smoothScroll.call(this, scrollableParent, scrollableParent.scrollLeft + clientRects.left - parentRects.left, scrollableParent.scrollTop + clientRects.top - parentRects.top);
					if (w.getComputedStyle(scrollableParent).position !== "fixed") w.scrollBy({
						left: parentRects.left,
						top: parentRects.top,
						behavior: "smooth"
					});
				} else w.scrollBy({
					left: clientRects.left,
					top: clientRects.top,
					behavior: "smooth"
				});
			};
		}
		function addDelay(event, baselineTime) {
			if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.MouseMove && event.data.positions && event.data.positions.length) {
				const firstOffset = event.data.positions[0].timeOffset;
				const firstTimestamp = event.timestamp + firstOffset;
				event.delay = firstTimestamp - baselineTime;
				return firstTimestamp - baselineTime;
			}
			event.delay = event.timestamp - baselineTime;
			return event.delay;
		}
		/*! *****************************************************************************
		Copyright (c) Microsoft Corporation.
		
		Permission to use, copy, modify, and/or distribute this software for any
		purpose with or without fee is hereby granted.
		
		THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
		REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
		AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
		INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
		LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
		OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
		PERFORMANCE OF THIS SOFTWARE.
		***************************************************************************** */
		function t(t2, n2) {
			var e2 = "function" == typeof Symbol && t2[Symbol.iterator];
			if (!e2) return t2;
			var r2, o2, i2 = e2.call(t2), a2 = [];
			try {
				for (; (void 0 === n2 || n2-- > 0) && !(r2 = i2.next()).done;) a2.push(r2.value);
			} catch (t3) {
				o2 = { error: t3 };
			} finally {
				try {
					r2 && !r2.done && (e2 = i2.return) && e2.call(i2);
				} finally {
					if (o2) throw o2.error;
				}
			}
			return a2;
		}
		function r(t2) {
			return void 0 === t2 ? [] : [].concat(t2);
		}
		function o(t2) {
			return {
				type: "xstate.assign",
				assignment: t2
			};
		}
		function i(t2, n2) {
			return "string" == typeof (t2 = "string" == typeof t2 && n2 && n2[t2] ? n2[t2] : t2) ? { type: t2 } : "function" == typeof t2 ? {
				type: t2.name,
				exec: t2
			} : t2;
		}
		function a(t2) {
			return function(n2) {
				return t2 === n2;
			};
		}
		function u(t2) {
			return "string" == typeof t2 ? { type: t2 } : t2;
		}
		function c(t2, n2) {
			return {
				value: t2,
				context: n2,
				actions: [],
				changed: false,
				matches: a(t2)
			};
		}
		function f(t2, n2, e2) {
			var r2 = n2, o2 = false;
			return [
				t2.filter(function(t3) {
					if ("xstate.assign" === t3.type) {
						o2 = true;
						var n3 = Object.assign({}, r2);
						return "function" == typeof t3.assignment ? n3 = t3.assignment(r2, e2) : Object.keys(t3.assignment).forEach(function(o3) {
							n3[o3] = "function" == typeof t3.assignment[o3] ? t3.assignment[o3](r2, e2) : t3.assignment[o3];
						}), r2 = n3, false;
					}
					return true;
				}),
				r2,
				o2
			];
		}
		function s(n2, o2) {
			void 0 === o2 && (o2 = {});
			var s2 = t(f(r(n2.states[n2.initial].entry).map(function(t2) {
				return i(t2, o2.actions);
			}), n2.context, e), 2), l2 = s2[0], v2 = s2[1], y = {
				config: n2,
				_options: o2,
				initialState: {
					value: n2.initial,
					actions: l2,
					context: v2,
					matches: a(n2.initial)
				},
				transition: function(e2, o3) {
					var s3, l3, v3 = "string" == typeof e2 ? {
						value: e2,
						context: n2.context
					} : e2, p = v3.value, g = v3.context, d = u(o3), x = n2.states[p];
					if (x.on) {
						var m = r(x.on[d.type]);
						try {
							for (var h = function(t2) {
								var n3 = "function" == typeof Symbol && Symbol.iterator, e3 = n3 && t2[n3], r2 = 0;
								if (e3) return e3.call(t2);
								if (t2 && "number" == typeof t2.length) return { next: function() {
									return t2 && r2 >= t2.length && (t2 = void 0), {
										value: t2 && t2[r2++],
										done: !t2
									};
								} };
								throw new TypeError(n3 ? "Object is not iterable." : "Symbol.iterator is not defined.");
							}(m), b = h.next(); !b.done; b = h.next()) {
								var S = b.value;
								if (void 0 === S) return c(p, g);
								var w = "string" == typeof S ? { target: S } : S, j = w.target, E = w.actions, R = void 0 === E ? [] : E, N = w.cond, O = void 0 === N ? function() {
									return true;
								} : N, _ = void 0 === j, k = null != j ? j : p, T = n2.states[k];
								if (O(g, d)) {
									var q = t(f((_ ? r(R) : [].concat(x.exit, R, T.entry).filter(function(t2) {
										return t2;
									})).map(function(t2) {
										return i(t2, y._options.actions);
									}), g, d), 3), z = q[0], A = q[1], B = q[2], C = null != j ? j : p;
									return {
										value: C,
										context: A,
										actions: z,
										changed: j !== p || z.length > 0 || B,
										matches: a(C)
									};
								}
							}
						} catch (t2) {
							s3 = { error: t2 };
						} finally {
							try {
								b && !b.done && (l3 = h.return) && l3.call(h);
							} finally {
								if (s3) throw s3.error;
							}
						}
					}
					return c(p, g);
				}
			};
			return y;
		}
		function v(t2) {
			var r2 = t2.initialState, o2 = n.NotStarted, i2 = /* @__PURE__ */ new Set(), c2 = {
				_machine: t2,
				send: function(e2) {
					o2 === n.Running && (r2 = t2.transition(r2, e2), l(r2, u(e2)), i2.forEach(function(t3) {
						return t3(r2);
					}));
				},
				subscribe: function(t3) {
					return i2.add(t3), t3(r2), { unsubscribe: function() {
						return i2.delete(t3);
					} };
				},
				start: function(i3) {
					if (i3) {
						var u2 = "object" == typeof i3 ? i3 : {
							context: t2.config.context,
							value: i3
						};
						r2 = {
							value: u2.value,
							actions: [],
							context: u2.context,
							matches: a(u2.value)
						};
					}
					return o2 = n.Running, l(r2, e), c2;
				},
				stop: function() {
					return o2 = n.Stopped, i2.clear(), c2;
				},
				get state() {
					return r2;
				},
				get status() {
					return o2;
				}
			};
			return c2;
		}
		function discardPriorSnapshots(events, baselineTime) {
			for (let idx = events.length - 1; idx >= 0; idx--) {
				const event = events[idx];
				if (event.type === EventType.Meta) {
					if (event.timestamp <= baselineTime) return events.slice(idx);
				}
			}
			return events;
		}
		function createPlayerService(context, { getCastFn, applyEventsSynchronously, emitter }) {
			return v(s({
				id: "player",
				context,
				initial: "paused",
				states: {
					playing: { on: {
						PAUSE: {
							target: "paused",
							actions: ["pause"]
						},
						CAST_EVENT: {
							target: "playing",
							actions: "castEvent"
						},
						END: {
							target: "paused",
							actions: ["resetLastPlayedEvent", "pause"]
						},
						ADD_EVENT: {
							target: "playing",
							actions: ["addEvent"]
						}
					} },
					paused: { on: {
						PLAY: {
							target: "playing",
							actions: ["recordTimeOffset", "play"]
						},
						CAST_EVENT: {
							target: "paused",
							actions: "castEvent"
						},
						TO_LIVE: {
							target: "live",
							actions: ["startLive"]
						},
						ADD_EVENT: {
							target: "paused",
							actions: ["addEvent"]
						}
					} },
					live: { on: {
						ADD_EVENT: {
							target: "live",
							actions: ["addEvent"]
						},
						CAST_EVENT: {
							target: "live",
							actions: ["castEvent"]
						}
					} }
				}
			}, { actions: {
				castEvent: o({ lastPlayedEvent: (ctx, event) => {
					if (event.type === "CAST_EVENT") return event.payload.event;
					return ctx.lastPlayedEvent;
				} }),
				recordTimeOffset: o((ctx, event) => {
					let timeOffset = ctx.timeOffset;
					if ("payload" in event && "timeOffset" in event.payload) timeOffset = event.payload.timeOffset;
					return {
						...ctx,
						timeOffset,
						baselineTime: ctx.events[0].timestamp + timeOffset
					};
				}),
				play(ctx) {
					var _a2;
					const { timer, events, baselineTime, lastPlayedEvent } = ctx;
					timer.clear();
					for (const event of events) addDelay(event, baselineTime);
					const neededEvents = discardPriorSnapshots(events, baselineTime);
					let lastPlayedTimestamp = lastPlayedEvent == null ? void 0 : lastPlayedEvent.timestamp;
					if ((lastPlayedEvent == null ? void 0 : lastPlayedEvent.type) === EventType.IncrementalSnapshot && lastPlayedEvent.data.source === IncrementalSource.MouseMove) lastPlayedTimestamp = lastPlayedEvent.timestamp + ((_a2 = lastPlayedEvent.data.positions[0]) == null ? void 0 : _a2.timeOffset);
					if (baselineTime < (lastPlayedTimestamp || 0)) emitter.emit(ReplayerEvents.PlayBack);
					const syncEvents = new Array();
					for (const event of neededEvents) {
						if (lastPlayedTimestamp && lastPlayedTimestamp < baselineTime && (event.timestamp <= lastPlayedTimestamp || event === lastPlayedEvent)) continue;
						if (event.timestamp < baselineTime) syncEvents.push(event);
						else {
							const castFn = getCastFn(event, false);
							timer.addAction({
								doAction: () => {
									castFn();
								},
								delay: event.delay
							});
						}
					}
					applyEventsSynchronously(syncEvents);
					emitter.emit(ReplayerEvents.Flush);
					timer.start();
				},
				pause(ctx) {
					ctx.timer.clear();
				},
				resetLastPlayedEvent: o((ctx) => {
					return {
						...ctx,
						lastPlayedEvent: null
					};
				}),
				startLive: o({ baselineTime: (ctx, event) => {
					ctx.timer.start();
					if (event.type === "TO_LIVE" && event.payload.baselineTime) return event.payload.baselineTime;
					return Date.now();
				} }),
				addEvent: o((ctx, machineEvent) => {
					const { baselineTime, timer, events } = ctx;
					if (machineEvent.type === "ADD_EVENT") {
						const { event } = machineEvent.payload;
						addDelay(event, baselineTime);
						let end = events.length - 1;
						if (!events[end] || events[end].timestamp <= event.timestamp) events.push(event);
						else {
							let insertionIndex = -1;
							let start = 0;
							while (start <= end) {
								const mid = Math.floor((start + end) / 2);
								if (events[mid].timestamp <= event.timestamp) start = mid + 1;
								else end = mid - 1;
							}
							if (insertionIndex === -1) insertionIndex = start;
							events.splice(insertionIndex, 0, event);
						}
						const isSync = event.timestamp < baselineTime;
						const castFn = getCastFn(event, isSync);
						if (isSync) castFn();
						else if (timer.isActive()) timer.addAction({
							doAction: () => {
								castFn();
							},
							delay: event.delay
						});
					}
					return {
						...ctx,
						events
					};
				})
			} }));
		}
		function createSpeedService(context) {
			return v(s({
				id: "speed",
				context,
				initial: "normal",
				states: {
					normal: { on: {
						FAST_FORWARD: {
							target: "skipping",
							actions: ["recordSpeed", "setSpeed"]
						},
						SET_SPEED: {
							target: "normal",
							actions: ["setSpeed"]
						}
					} },
					skipping: { on: {
						BACK_TO_NORMAL: {
							target: "normal",
							actions: ["restoreSpeed"]
						},
						SET_SPEED: {
							target: "normal",
							actions: ["setSpeed"]
						}
					} }
				}
			}, { actions: {
				setSpeed: (ctx, event) => {
					if ("payload" in event) ctx.timer.setSpeed(event.payload.speed);
				},
				recordSpeed: o({ normalSpeed: (ctx) => ctx.timer.speed }),
				restoreSpeed: (ctx) => {
					ctx.timer.setSpeed(ctx.normalSpeed);
				}
			} }));
		}
		function variableListFor(ctx, ctor) {
			let contextMap = webGLVarMap.get(ctx);
			if (!contextMap) {
				contextMap = /* @__PURE__ */ new Map();
				webGLVarMap.set(ctx, contextMap);
			}
			if (!contextMap.has(ctor)) contextMap.set(ctor, []);
			return contextMap.get(ctor);
		}
		function deserializeArg(imageMap, ctx, preload) {
			return async (arg) => {
				if (arg && typeof arg === "object" && "rr_type" in arg) {
					if (preload) preload.isUnchanged = false;
					if (arg.rr_type === "ImageBitmap" && "args" in arg) {
						const args = await deserializeArg(imageMap, ctx, preload)(arg.args);
						return await createImageBitmap.apply(null, args);
					} else if ("index" in arg) {
						if (preload || ctx === null) return arg;
						const { rr_type: name, index: index2 } = arg;
						return variableListFor(ctx, name)[index2];
					} else if ("args" in arg) {
						const { rr_type: name, args } = arg;
						const ctor = window[name];
						return new ctor(...await Promise.all(args.map(deserializeArg(imageMap, ctx, preload))));
					} else if ("base64" in arg) return decode(arg.base64);
					else if ("src" in arg) {
						const image = imageMap.get(arg.src);
						if (image) return image;
						else {
							const image2 = new Image();
							image2.src = arg.src;
							imageMap.set(arg.src, image2);
							return image2;
						}
					} else if ("data" in arg && arg.rr_type === "Blob") {
						const blobContents = await Promise.all(arg.data.map(deserializeArg(imageMap, ctx, preload)));
						return new Blob(blobContents, { type: arg.type });
					}
				} else if (Array.isArray(arg)) return await Promise.all(arg.map(deserializeArg(imageMap, ctx, preload)));
				return arg;
			};
		}
		function getContext(target, type) {
			try {
				if (type === CanvasContext.WebGL) return target.getContext("webgl") || target.getContext("experimental-webgl");
				return target.getContext("webgl2");
			} catch (e2) {
				return null;
			}
		}
		function saveToWebGLVarMap(ctx, result2) {
			if (!(result2 == null ? void 0 : result2.constructor)) return;
			const { name } = result2.constructor;
			if (!WebGLVariableConstructorsNames.includes(name)) return;
			const variables = variableListFor(ctx, name);
			if (!variables.includes(result2)) variables.push(result2);
		}
		async function webglMutation({ mutation, target, type, imageMap, errorHandler: errorHandler2 }) {
			try {
				const ctx = getContext(target, type);
				if (!ctx) return;
				if (mutation.setter) {
					ctx[mutation.property] = mutation.args[0];
					return;
				}
				const original = ctx[mutation.property];
				const args = await Promise.all(mutation.args.map(deserializeArg(imageMap, ctx)));
				saveToWebGLVarMap(ctx, original.apply(ctx, args));
			} catch (error) {
				errorHandler2(mutation, error);
			}
		}
		async function canvasMutation$1({ event, mutations, target, imageMap, errorHandler: errorHandler2 }) {
			const ctx = target.getContext("2d");
			if (!ctx) {
				errorHandler2(mutations[0], /* @__PURE__ */ new Error("Canvas context is null"));
				return;
			}
			const mutationArgsPromises = mutations.map(async (mutation) => {
				return Promise.all(mutation.args.map(deserializeArg(imageMap, ctx)));
			});
			(await Promise.all(mutationArgsPromises)).forEach((args2, index2) => {
				const mutation = mutations[index2];
				try {
					if (mutation.setter) {
						ctx[mutation.property] = mutation.args[0];
						return;
					}
					const original = ctx[mutation.property];
					if (mutation.property === "drawImage" && typeof mutation.args[0] === "string") {
						imageMap.get(event);
						original.apply(ctx, mutation.args);
					} else original.apply(ctx, args2);
				} catch (error) {
					errorHandler2(mutation, error);
				}
			});
		}
		async function canvasMutation({ event, mutation, target, imageMap, canvasEventMap, errorHandler: errorHandler2 }) {
			try {
				const precomputedMutation = canvasEventMap.get(event) || mutation;
				const commands = "commands" in precomputedMutation ? precomputedMutation.commands : [precomputedMutation];
				if ([CanvasContext.WebGL, CanvasContext.WebGL2].includes(mutation.type)) {
					for (let i2 = 0; i2 < commands.length; i2++) {
						const command = commands[i2];
						await webglMutation({
							mutation: command,
							type: mutation.type,
							target,
							imageMap,
							errorHandler: errorHandler2
						});
					}
					return;
				}
				await canvasMutation$1({
					event,
					mutations: commands,
					target,
					imageMap,
					errorHandler: errorHandler2
				});
			} catch (error) {
				errorHandler2(mutation, error);
			}
		}
		function applyDialogToTopLevel(node2, attributeMutation) {
			if (node2.nodeName !== "DIALOG" || node2 instanceof BaseRRNode) return;
			const dialog = node2;
			const oldIsOpen = dialog.open;
			const oldIsModalState = oldIsOpen && dialog.matches("dialog:modal");
			const rrOpenMode = dialog.getAttribute("rr_open_mode");
			const newIsOpen = typeof (attributeMutation == null ? void 0 : attributeMutation.attributes.open) === "string" || typeof dialog.getAttribute("open") === "string";
			const newIsModalState = rrOpenMode === "modal";
			if (oldIsOpen && !(oldIsModalState && rrOpenMode === "non-modal" || !oldIsModalState && newIsModalState)) return;
			if (!dialog.isConnected) {
				console.warn("dialog is not attached to the dom", dialog);
				return;
			}
			if (oldIsOpen) dialog.close();
			if (!newIsOpen) return;
			if (newIsModalState) dialog.showModal();
			else dialog.show();
		}
		function removeDialogFromTopLevel(node2, attributeMutation) {
			if (node2.nodeName !== "DIALOG" || node2 instanceof BaseRRNode) return;
			const dialog = node2;
			if (!dialog.isConnected) {
				console.warn("dialog is not attached to the dom", dialog);
				return;
			}
			if (attributeMutation.attributes.open === null) {
				dialog.removeAttribute("open");
				dialog.removeAttribute("rr_open_mode");
			}
		}
		function indicatesTouchDevice(e2) {
			return e2.type == EventType.IncrementalSnapshot && (e2.data.source == IncrementalSource.TouchMove || e2.data.source == IncrementalSource.MouseInteraction && e2.data.type == MouseInteractions.TouchStart);
		}
		var __defProp, __defNormalProp, __publicField, _a, __defProp$1, __defNormalProp$1, __publicField$1, NodeType$3, testableAccessors$2, testableMethods$2, untaintedBasePrototype$2, untaintedBaseIframeCleanup$2, mutationObserverUsers$2, isAngularZonePresent$2, untaintedAccessorCache$2, untaintedMethodCache$2, nowTimestamp$2, index$2, Mirror, ORIGINAL_ATTRIBUTE_NAME, URL_IN_CSS_REF, URL_PROTOCOL_MATCH, URL_WWW_MATCH, DATA_URI, cssNormalizeBase, cssNormalizeRe, cssNormalizeReNoPx, _id, tagNameRegex, IGNORED_NODE, canvasService, canvasCtx, SRCSET_NOT_SPACES, SRCSET_COMMAS_OR_SPACES, cachedDocument, MEDIA_SELECTOR_GLOBAL, mediaSelectorPlugin, pseudoClassPlugin, picocolors_browser$1, hasRequiredPicocolors_browser$1, require$$2$1, cssSyntaxError$1, hasRequiredCssSyntaxError$1, symbols$1, hasRequiredSymbols$1, stringifier$1, hasRequiredStringifier$1, stringify_1$1, hasRequiredStringify$1, node$1, hasRequiredNode$1, declaration$1, hasRequiredDeclaration$1, nonSecure$1, hasRequiredNonSecure$1, previousMap$1, hasRequiredPreviousMap$1, input$1, hasRequiredInput$1, mapGenerator$1, hasRequiredMapGenerator$1, comment$1, hasRequiredComment$1, container$1, hasRequiredContainer$1, document$1$1, hasRequiredDocument$1, warnOnce$1, hasRequiredWarnOnce$1, warning$1, hasRequiredWarning$1, result$1, hasRequiredResult$1, tokenize$1, hasRequiredTokenize$1, atRule$1, hasRequiredAtRule$1, root$1, hasRequiredRoot$1, list_1$1, hasRequiredList$1, rule$1, hasRequiredRule$1, parser$1, hasRequiredParser$1, parse_1$1, hasRequiredParse$1, lazyResult$1, hasRequiredLazyResult$1, noWorkResult$1, hasRequiredNoWorkResult$1, processor$1, hasRequiredProcessor$1, fromJSON_1$1, hasRequiredFromJSON$1, postcss_1$1, hasRequiredPostcss$1, postcss$1, tagMap, REBUILD_TARGET_ERROR, SANDBOXED_IFRAME_ROOT_ERROR, sandboxedRebuildDocuments, __defProp2, __defNormalProp2, __publicField2, __defProp22, __defNormalProp22, __publicField22, testableAccessors$1, testableMethods$1, untaintedBasePrototype$1, untaintedBaseIframeCleanup$1, mutationObserverUsers$1, isAngularZonePresent$1, untaintedAccessorCache$1, untaintedMethodCache$1, nowTimestamp$1, index$1, Mirror$1, picocolors_browser, hasRequiredPicocolors_browser, require$$2, cssSyntaxError, hasRequiredCssSyntaxError, symbols, hasRequiredSymbols, stringifier, hasRequiredStringifier, stringify_1, hasRequiredStringify, node, hasRequiredNode, declaration, hasRequiredDeclaration, nonSecure, hasRequiredNonSecure, previousMap, hasRequiredPreviousMap, input, hasRequiredInput, mapGenerator, hasRequiredMapGenerator, comment, hasRequiredComment, container, hasRequiredContainer, document$1, hasRequiredDocument, warnOnce, hasRequiredWarnOnce, warning, hasRequiredWarning, result, hasRequiredResult, tokenize, hasRequiredTokenize, atRule, hasRequiredAtRule, root, hasRequiredRoot, list_1, hasRequiredList, rule, hasRequiredRule, parser, hasRequiredParser, parse_1, hasRequiredParse, lazyResult, hasRequiredLazyResult, noWorkResult, hasRequiredNoWorkResult, processor, hasRequiredProcessor, fromJSON_1, hasRequiredFromJSON, postcss_1, hasRequiredPostcss, postcss, NodeType$1, camelizeRE, CUSTOM_PROPERTY_REGEX, camelize, hyphenateRE, hyphenate, BaseRRNode, BaseRRDocument, BaseRRDocumentType, BaseRRElement, BaseRRMediaElement, BaseRRDialogElement, BaseRRText, BaseRRComment, BaseRRCDATASection, ClassList, NodeType$2, NAMESPACES, SVGTagMap, createdNodeSet, RRDocument, RRDocumentType, RRElement, RRMediaElement, RRDialogElement, RRCanvasElement, RRStyleElement, RRIFrameElement, RRText, RRComment, RRCDATASection, Mirror22, testableAccessors, testableMethods, untaintedBasePrototype, untaintedBaseIframeCleanup, mutationObserverUsers, isAngularZonePresent, untaintedAccessorCache, untaintedMethodCache, nowTimestamp, index, DEPARTED_MIRROR_ACCESS_WARNING, _mirror, StyleSheetMirror, utils, EventType, IncrementalSource, MouseInteractions, PointerTypes, CanvasContext, MediaInteractions, ReplayerEvents, NodeType, moveKey, MutationBuffer, errorHandler, callbackWrapper, mutationBuffers, INPUT_TAGS, lastInputValueMap, CrossOriginIframeMirror, IframeManager, ShadowDomManager, chars, lookup, i$1, encode, decode, canvasVarMap, saveWebGLVar, serializeArgs, isInstanceOfWebGLObject, jsContent, blob, CanvasManager, StylesheetManager, ProcessedNodeManager, wrappedEmit, takeFullSnapshot$1, canvasManager, recording, mirror, Timer, n, e, l, rules, webGLVarMap, WebGLVariableConstructorsNames, MediaManager, SKIP_TIME_INTERVAL, mitt, REPLAY_CONSOLE_PREFIX, defaultMouseTailConfig, Replayer, addCustomEvent, addAnnotation, freezePage, takeFullSnapshot;
		var init_rrweb = __esmMin((() => {
			__defProp = Object.defineProperty;
			__defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, {
				enumerable: true,
				configurable: true,
				writable: true,
				value
			}) : obj[key] = value;
			__publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
			__defProp$1 = Object.defineProperty;
			__defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, {
				enumerable: true,
				configurable: true,
				writable: true,
				value
			}) : obj[key] = value;
			__publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
			NodeType$3 = /* @__PURE__ */ ((NodeType2) => {
				NodeType2[NodeType2["Document"] = 0] = "Document";
				NodeType2[NodeType2["DocumentType"] = 1] = "DocumentType";
				NodeType2[NodeType2["Element"] = 2] = "Element";
				NodeType2[NodeType2["Text"] = 3] = "Text";
				NodeType2[NodeType2["CDATA"] = 4] = "CDATA";
				NodeType2[NodeType2["Comment"] = 5] = "Comment";
				return NodeType2;
			})(NodeType$3 || {});
			testableAccessors$2 = {
				Node: [
					"childNodes",
					"parentNode",
					"parentElement",
					"textContent",
					"ownerDocument",
					"firstChild",
					"lastChild",
					"nextSibling",
					"previousSibling"
				],
				ShadowRoot: ["host", "styleSheets"],
				Element: [
					"shadowRoot",
					"querySelector",
					"querySelectorAll"
				],
				MutationObserver: []
			};
			testableMethods$2 = {
				Node: ["contains", "getRootNode"],
				ShadowRoot: ["getSelection"],
				Element: [],
				MutationObserver: ["constructor"]
			};
			untaintedBasePrototype$2 = {};
			untaintedBaseIframeCleanup$2 = {};
			mutationObserverUsers$2 = 0;
			isAngularZonePresent$2 = () => {
				return !!globalThis.Zone;
			};
			untaintedAccessorCache$2 = {};
			untaintedMethodCache$2 = {};
			nowTimestamp$2 = Date.now;
			if (!/* @__PURE__ */ /[1-9][0-9]{12}/.test(Date.now().toString())) nowTimestamp$2 = () => (/* @__PURE__ */ new Date()).getTime();
			index$2 = {
				ownerDocument: ownerDocument$2,
				childNodes: childNodes$2,
				parentNode: parentNode$2,
				parentElement: parentElement$2,
				textContent: textContent$2,
				firstChild: firstChild$2,
				lastChild: lastChild$2,
				nextSibling: nextSibling$2,
				previousSibling: previousSibling$2,
				contains: contains$2,
				getRootNode: getRootNode$2,
				host: host$2,
				styleSheets: styleSheets$2,
				shadowRoot: shadowRoot$2,
				querySelector: querySelector$2,
				querySelectorAll: querySelectorAll$2,
				nowTimestamp: nowTimestamp$2,
				mutationObserverCtor: mutationObserverCtor$2,
				patch: patch$2
			};
			Mirror = class {
				constructor() {
					__publicField$1(this, "idNodeMap", /* @__PURE__ */ new Map());
					__publicField$1(this, "nodeMetaMap", /* @__PURE__ */ new WeakMap());
				}
				getId(n2) {
					var _a2;
					if (!n2) return -1;
					return ((_a2 = this.getMeta(n2)) == null ? void 0 : _a2.id) ?? -1;
				}
				getNode(id) {
					return this.idNodeMap.get(id) || null;
				}
				getIds() {
					return Array.from(this.idNodeMap.keys());
				}
				getMeta(n2) {
					return this.nodeMetaMap.get(n2) || null;
				}
				removeNodeFromMap(n2) {
					const id = this.getId(n2);
					this.idNodeMap.delete(id);
					if (n2.childNodes) n2.childNodes.forEach((childNode) => this.removeNodeFromMap(childNode));
					const shadowRoot2 = index$2.shadowRoot(n2);
					if (shadowRoot2) this.removeNodeFromMap(shadowRoot2);
				}
				has(id) {
					return this.idNodeMap.has(id);
				}
				hasNode(node2) {
					return this.nodeMetaMap.has(node2);
				}
				add(n2, meta) {
					const id = meta.id;
					this.idNodeMap.set(id, n2);
					this.nodeMetaMap.set(n2, meta);
				}
				replace(id, n2) {
					const oldNode = this.getNode(id);
					if (oldNode) {
						const meta = this.nodeMetaMap.get(oldNode);
						if (meta) this.nodeMetaMap.set(n2, meta);
					}
					this.idNodeMap.set(id, n2);
				}
				reset() {
					this.idNodeMap = /* @__PURE__ */ new Map();
					this.nodeMetaMap = /* @__PURE__ */ new WeakMap();
				}
			};
			ORIGINAL_ATTRIBUTE_NAME = "__rrweb_original__";
			URL_IN_CSS_REF = /url\((?:(')([^']*)'|(")(.*?)"|([^)]*))\)/gm;
			URL_PROTOCOL_MATCH = /^(?:[a-z+]+:)?\/\//i;
			URL_WWW_MATCH = /^www\..*/i;
			DATA_URI = /^(data:)([^,]*),(.*)/i;
			cssNormalizeBase = "(?:/\\*[^*]*\\*/)|[\\s;]";
			cssNormalizeRe = new RegExp(`${cssNormalizeBase}|\\b(0)px?`, "g");
			cssNormalizeReNoPx = new RegExp(cssNormalizeBase, "g");
			_id = 1;
			tagNameRegex = /* @__PURE__ */ new RegExp("[^a-z0-9-_:]");
			IGNORED_NODE = -2;
			SRCSET_NOT_SPACES = /^[^ \t\n\r\u000c]+/;
			SRCSET_COMMAS_OR_SPACES = /^[, \t\n\r\u000c]+/;
			cachedDocument = /* @__PURE__ */ new WeakMap();
			MEDIA_SELECTOR_GLOBAL = new RegExp(/(max|min)-device-(width|height)/.source, "g");
			mediaSelectorPlugin = {
				postcssPlugin: "postcss-custom-selectors",
				prepare() {
					return {
						postcssPlugin: "postcss-custom-selectors",
						AtRule: function(atrule) {
							if (atrule.params.match(MEDIA_SELECTOR_GLOBAL)) atrule.params = atrule.params.replace(MEDIA_SELECTOR_GLOBAL, "$1-$2");
						}
					};
				}
			};
			pseudoClassPlugin = {
				postcssPlugin: "postcss-hover-classes",
				prepare: function() {
					const fixed = [];
					return { Rule: function(rule2) {
						if (fixed.indexOf(rule2) !== -1) return;
						fixed.push(rule2);
						rule2.selectors.forEach(function(selector) {
							if (selector.includes(":hover")) rule2.selector += ",\n" + selector.replace(/:hover/g, ".\\:hover");
						});
					} };
				}
			};
			picocolors_browser$1 = { exports: {} };
			require$$2$1 = /* @__PURE__ */ getAugmentedNamespace$1(/* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
				__proto__: null,
				default: {}
			}, Symbol.toStringTag, { value: "Module" })));
			symbols$1 = {};
			postcss$1 = /* @__PURE__ */ getDefaultExportFromCjs$1(requirePostcss$1());
			postcss$1.stringify;
			postcss$1.fromJSON;
			postcss$1.plugin;
			postcss$1.parse;
			postcss$1.list;
			postcss$1.document;
			postcss$1.comment;
			postcss$1.atRule;
			postcss$1.rule;
			postcss$1.decl;
			postcss$1.root;
			postcss$1.CssSyntaxError;
			postcss$1.Declaration;
			postcss$1.Container;
			postcss$1.Processor;
			postcss$1.Document;
			postcss$1.Comment;
			postcss$1.Warning;
			postcss$1.AtRule;
			postcss$1.Result;
			postcss$1.Input;
			postcss$1.Rule;
			postcss$1.Root;
			postcss$1.Node;
			tagMap = {
				script: "noscript",
				altglyph: "altGlyph",
				altglyphdef: "altGlyphDef",
				altglyphitem: "altGlyphItem",
				animatecolor: "animateColor",
				animatemotion: "animateMotion",
				animatetransform: "animateTransform",
				clippath: "clipPath",
				feblend: "feBlend",
				fecolormatrix: "feColorMatrix",
				fecomponenttransfer: "feComponentTransfer",
				fecomposite: "feComposite",
				feconvolvematrix: "feConvolveMatrix",
				fediffuselighting: "feDiffuseLighting",
				fedisplacementmap: "feDisplacementMap",
				fedistantlight: "feDistantLight",
				fedropshadow: "feDropShadow",
				feflood: "feFlood",
				fefunca: "feFuncA",
				fefuncb: "feFuncB",
				fefuncg: "feFuncG",
				fefuncr: "feFuncR",
				fegaussianblur: "feGaussianBlur",
				feimage: "feImage",
				femerge: "feMerge",
				femergenode: "feMergeNode",
				femorphology: "feMorphology",
				feoffset: "feOffset",
				fepointlight: "fePointLight",
				fespecularlighting: "feSpecularLighting",
				fespotlight: "feSpotLight",
				fetile: "feTile",
				feturbulence: "feTurbulence",
				foreignobject: "foreignObject",
				glyphref: "glyphRef",
				lineargradient: "linearGradient",
				radialgradient: "radialGradient"
			};
			REBUILD_TARGET_ERROR = "rrweb-snapshot.rebuild() cannot rebuild into an unprotected browser document. Use rebuildIntoSandboxedIframe() or set UNSAFE_allowUnprotectedRebuild: true only when you accept the script-execution risk.";
			SANDBOXED_IFRAME_ROOT_ERROR = "rrweb-snapshot.createSandboxedIframe() requires root to be connected to a document before creating a sandboxed iframe.";
			sandboxedRebuildDocuments = /* @__PURE__ */ new WeakSet();
			__defProp2 = Object.defineProperty;
			__defNormalProp2 = (obj, key, value) => key in obj ? __defProp2(obj, key, {
				enumerable: true,
				configurable: true,
				writable: true,
				value
			}) : obj[key] = value;
			__publicField2 = (obj, key, value) => __defNormalProp2(obj, typeof key !== "symbol" ? key + "" : key, value);
			__defProp22 = Object.defineProperty;
			__defNormalProp22 = (obj, key, value) => key in obj ? __defProp22(obj, key, {
				enumerable: true,
				configurable: true,
				writable: true,
				value
			}) : obj[key] = value;
			__publicField22 = (obj, key, value) => __defNormalProp22(obj, typeof key !== "symbol" ? key + "" : key, value);
			testableAccessors$1 = {
				Node: [
					"childNodes",
					"parentNode",
					"parentElement",
					"textContent",
					"ownerDocument",
					"firstChild",
					"lastChild",
					"nextSibling",
					"previousSibling"
				],
				ShadowRoot: ["host", "styleSheets"],
				Element: [
					"shadowRoot",
					"querySelector",
					"querySelectorAll"
				],
				MutationObserver: []
			};
			testableMethods$1 = {
				Node: ["contains", "getRootNode"],
				ShadowRoot: ["getSelection"],
				Element: [],
				MutationObserver: ["constructor"]
			};
			untaintedBasePrototype$1 = {};
			untaintedBaseIframeCleanup$1 = {};
			mutationObserverUsers$1 = 0;
			isAngularZonePresent$1 = () => {
				return !!globalThis.Zone;
			};
			untaintedAccessorCache$1 = {};
			untaintedMethodCache$1 = {};
			nowTimestamp$1 = Date.now;
			if (!/* @__PURE__ */ /[1-9][0-9]{12}/.test(Date.now().toString())) nowTimestamp$1 = () => (/* @__PURE__ */ new Date()).getTime();
			index$1 = {
				ownerDocument: ownerDocument$1,
				childNodes: childNodes$1,
				parentNode: parentNode$1,
				parentElement: parentElement$1,
				textContent: textContent$1,
				firstChild: firstChild$1,
				lastChild: lastChild$1,
				nextSibling: nextSibling$1,
				previousSibling: previousSibling$1,
				contains: contains$1,
				getRootNode: getRootNode$1,
				host: host$1,
				styleSheets: styleSheets$1,
				shadowRoot: shadowRoot$1,
				querySelector: querySelector$1,
				querySelectorAll: querySelectorAll$1,
				nowTimestamp: nowTimestamp$1,
				mutationObserverCtor: mutationObserverCtor$1,
				patch: patch$1
			};
			Mirror$1 = class Mirror2 {
				constructor() {
					__publicField22(this, "idNodeMap", /* @__PURE__ */ new Map());
					__publicField22(this, "nodeMetaMap", /* @__PURE__ */ new WeakMap());
				}
				getId(n2) {
					var _a2;
					if (!n2) return -1;
					return ((_a2 = this.getMeta(n2)) == null ? void 0 : _a2.id) ?? -1;
				}
				getNode(id) {
					return this.idNodeMap.get(id) || null;
				}
				getIds() {
					return Array.from(this.idNodeMap.keys());
				}
				getMeta(n2) {
					return this.nodeMetaMap.get(n2) || null;
				}
				removeNodeFromMap(n2) {
					const id = this.getId(n2);
					this.idNodeMap.delete(id);
					if (n2.childNodes) n2.childNodes.forEach((childNode) => this.removeNodeFromMap(childNode));
					const shadowRoot2 = index$1.shadowRoot(n2);
					if (shadowRoot2) this.removeNodeFromMap(shadowRoot2);
				}
				has(id) {
					return this.idNodeMap.has(id);
				}
				hasNode(node2) {
					return this.nodeMetaMap.has(node2);
				}
				add(n2, meta) {
					const id = meta.id;
					this.idNodeMap.set(id, n2);
					this.nodeMetaMap.set(n2, meta);
				}
				replace(id, n2) {
					const oldNode = this.getNode(id);
					if (oldNode) {
						const meta = this.nodeMetaMap.get(oldNode);
						if (meta) this.nodeMetaMap.set(n2, meta);
					}
					this.idNodeMap.set(id, n2);
				}
				reset() {
					this.idNodeMap = /* @__PURE__ */ new Map();
					this.nodeMetaMap = /* @__PURE__ */ new WeakMap();
				}
			};
			picocolors_browser = { exports: {} };
			require$$2 = /* @__PURE__ */ getAugmentedNamespace(/* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
				__proto__: null,
				default: {}
			}, Symbol.toStringTag, { value: "Module" })));
			symbols = {};
			postcss = /* @__PURE__ */ getDefaultExportFromCjs(requirePostcss());
			postcss.stringify;
			postcss.fromJSON;
			postcss.plugin;
			postcss.parse;
			postcss.list;
			postcss.document;
			postcss.comment;
			postcss.atRule;
			postcss.rule;
			postcss.decl;
			postcss.root;
			postcss.CssSyntaxError;
			postcss.Declaration;
			postcss.Container;
			postcss.Processor;
			postcss.Document;
			postcss.Comment;
			postcss.Warning;
			postcss.AtRule;
			postcss.Result;
			postcss.Input;
			postcss.Rule;
			postcss.Root;
			postcss.Node;
			NodeType$1 = /* @__PURE__ */ ((NodeType2) => {
				NodeType2[NodeType2["Document"] = 0] = "Document";
				NodeType2[NodeType2["DocumentType"] = 1] = "DocumentType";
				NodeType2[NodeType2["Element"] = 2] = "Element";
				NodeType2[NodeType2["Text"] = 3] = "Text";
				NodeType2[NodeType2["CDATA"] = 4] = "CDATA";
				NodeType2[NodeType2["Comment"] = 5] = "Comment";
				return NodeType2;
			})(NodeType$1 || {});
			camelizeRE = /-([a-z])/g;
			CUSTOM_PROPERTY_REGEX = /^--[a-zA-Z0-9-]+$/;
			camelize = (str) => {
				if (CUSTOM_PROPERTY_REGEX.test(str)) return str;
				return str.replace(camelizeRE, (_, c2) => c2 ? c2.toUpperCase() : "");
			};
			hyphenateRE = /\B([A-Z])/g;
			hyphenate = (str) => {
				return str.replace(hyphenateRE, "-$1").toLowerCase();
			};
			BaseRRNode = class BaseRRNode {
				constructor(..._args) {
					__publicField2(this, "parentElement", null);
					__publicField2(this, "parentNode", null);
					__publicField2(this, "ownerDocument");
					__publicField2(this, "firstChild", null);
					__publicField2(this, "lastChild", null);
					__publicField2(this, "previousSibling", null);
					__publicField2(this, "nextSibling", null);
					__publicField2(this, "ELEMENT_NODE", 1);
					__publicField2(this, "TEXT_NODE", 3);
					__publicField2(this, "nodeType");
					__publicField2(this, "nodeName");
					__publicField2(this, "RRNodeType");
				}
				get childNodes() {
					const childNodes2 = [];
					let childIterator = this.firstChild;
					while (childIterator) {
						childNodes2.push(childIterator);
						childIterator = childIterator.nextSibling;
					}
					return childNodes2;
				}
				contains(node2) {
					if (!(node2 instanceof BaseRRNode)) return false;
					else if (node2.ownerDocument !== this.ownerDocument) return false;
					else if (node2 === this) return true;
					while (node2.parentNode) {
						if (node2.parentNode === this) return true;
						node2 = node2.parentNode;
					}
					return false;
				}
				appendChild(_newChild) {
					throw new Error(`RRDomException: Failed to execute 'appendChild' on 'RRNode': This RRNode type does not support this method.`);
				}
				insertBefore(_newChild, _refChild) {
					throw new Error(`RRDomException: Failed to execute 'insertBefore' on 'RRNode': This RRNode type does not support this method.`);
				}
				removeChild(_node) {
					throw new Error(`RRDomException: Failed to execute 'removeChild' on 'RRNode': This RRNode type does not support this method.`);
				}
				toString() {
					return "RRNode";
				}
			};
			BaseRRDocument = class BaseRRDocument extends BaseRRNode {
				constructor(...args) {
					super(args);
					__publicField2(this, "nodeType", 9);
					__publicField2(this, "nodeName", "#document");
					__publicField2(this, "compatMode", "CSS1Compat");
					__publicField2(this, "RRNodeType", NodeType$1.Document);
					__publicField2(this, "textContent", null);
					this.ownerDocument = this;
				}
				get documentElement() {
					return this.childNodes.find((node2) => node2.RRNodeType === NodeType$1.Element && node2.tagName === "HTML") || null;
				}
				get body() {
					var _a2;
					return ((_a2 = this.documentElement) == null ? void 0 : _a2.childNodes.find((node2) => node2.RRNodeType === NodeType$1.Element && node2.tagName === "BODY")) || null;
				}
				get head() {
					var _a2;
					return ((_a2 = this.documentElement) == null ? void 0 : _a2.childNodes.find((node2) => node2.RRNodeType === NodeType$1.Element && node2.tagName === "HEAD")) || null;
				}
				get implementation() {
					return this;
				}
				get firstElementChild() {
					return this.documentElement;
				}
				appendChild(newChild) {
					const nodeType = newChild.RRNodeType;
					if (nodeType === NodeType$1.Element || nodeType === NodeType$1.DocumentType) {
						if (this.childNodes.some((s2) => s2.RRNodeType === nodeType)) throw new Error(`RRDomException: Failed to execute 'appendChild' on 'RRNode': Only one ${nodeType === NodeType$1.Element ? "RRElement" : "RRDoctype"} on RRDocument allowed.`);
					}
					const child = appendChild(this, newChild);
					child.parentElement = null;
					return child;
				}
				insertBefore(newChild, refChild) {
					const nodeType = newChild.RRNodeType;
					if (nodeType === NodeType$1.Element || nodeType === NodeType$1.DocumentType) {
						if (this.childNodes.some((s2) => s2.RRNodeType === nodeType)) throw new Error(`RRDomException: Failed to execute 'insertBefore' on 'RRNode': Only one ${nodeType === NodeType$1.Element ? "RRElement" : "RRDoctype"} on RRDocument allowed.`);
					}
					const child = insertBefore(this, newChild, refChild);
					child.parentElement = null;
					return child;
				}
				removeChild(node2) {
					return removeChild(this, node2);
				}
				open() {
					this.firstChild = null;
					this.lastChild = null;
				}
				close() {}
				/**
				* Adhoc implementation for setting xhtml namespace in rebuilt.ts (rrweb-snapshot).
				* There are two lines used this function:
				* 1. doc.write('\<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ""\>')
				* 2. doc.write('\<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" ""\>')
				*/
				write(content) {
					let publicId;
					if (content === "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"\">") publicId = "-//W3C//DTD XHTML 1.0 Transitional//EN";
					else if (content === "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.0 Transitional//EN\" \"\">") publicId = "-//W3C//DTD HTML 4.0 Transitional//EN";
					if (publicId) {
						const doctype = this.createDocumentType("html", publicId, "");
						this.open();
						this.appendChild(doctype);
					}
				}
				createDocument(_namespace, _qualifiedName, _doctype) {
					return new BaseRRDocument();
				}
				createDocumentType(qualifiedName, publicId, systemId) {
					const doctype = new BaseRRDocumentType(qualifiedName, publicId, systemId);
					doctype.ownerDocument = this;
					return doctype;
				}
				createElement(tagName) {
					const element = new BaseRRElement(tagName);
					element.ownerDocument = this;
					return element;
				}
				createElementNS(_namespaceURI, qualifiedName) {
					return this.createElement(qualifiedName);
				}
				createTextNode(data) {
					const text = new BaseRRText(data);
					text.ownerDocument = this;
					return text;
				}
				createComment(data) {
					const comment2 = new BaseRRComment(data);
					comment2.ownerDocument = this;
					return comment2;
				}
				createCDATASection(data) {
					const CDATASection = new BaseRRCDATASection(data);
					CDATASection.ownerDocument = this;
					return CDATASection;
				}
				toString() {
					return "RRDocument";
				}
			};
			BaseRRDocumentType = class extends BaseRRNode {
				constructor(qualifiedName, publicId, systemId) {
					super();
					__publicField2(this, "nodeType", 10);
					__publicField2(this, "RRNodeType", NodeType$1.DocumentType);
					__publicField2(this, "name");
					__publicField2(this, "publicId");
					__publicField2(this, "systemId");
					__publicField2(this, "textContent", null);
					this.name = qualifiedName;
					this.publicId = publicId;
					this.systemId = systemId;
					this.nodeName = qualifiedName;
				}
				toString() {
					return "RRDocumentType";
				}
			};
			BaseRRElement = class extends BaseRRNode {
				constructor(tagName) {
					super();
					__publicField2(this, "nodeType", 1);
					__publicField2(this, "RRNodeType", NodeType$1.Element);
					__publicField2(this, "tagName");
					__publicField2(this, "attributes", {});
					__publicField2(this, "shadowRoot", null);
					__publicField2(this, "scrollLeft");
					__publicField2(this, "scrollTop");
					this.tagName = tagName.toUpperCase();
					this.nodeName = tagName.toUpperCase();
				}
				get textContent() {
					let result2 = "";
					this.childNodes.forEach((node2) => result2 += node2.textContent);
					return result2;
				}
				set textContent(textContent2) {
					this.firstChild = null;
					this.lastChild = null;
					this.appendChild(this.ownerDocument.createTextNode(textContent2));
				}
				get classList() {
					return new ClassList(this.attributes.class, (newClassName) => {
						this.attributes.class = newClassName;
					});
				}
				get id() {
					return this.attributes.id || "";
				}
				get className() {
					return this.attributes.class || "";
				}
				get style() {
					const style = this.attributes.style ? parseCSSText(this.attributes.style) : {};
					const hyphenateRE2 = /\B([A-Z])/g;
					style.setProperty = (name, value, priority) => {
						if (hyphenateRE2.test(name)) return;
						const normalizedName = camelize(name);
						if (!value) delete style[normalizedName];
						else style[normalizedName] = value;
						if (priority === "important") style[normalizedName] += " !important";
						this.attributes.style = toCSSText(style);
					};
					style.removeProperty = (name) => {
						if (hyphenateRE2.test(name)) return "";
						const normalizedName = camelize(name);
						const value = style[normalizedName] || "";
						delete style[normalizedName];
						this.attributes.style = toCSSText(style);
						return value;
					};
					return style;
				}
				getAttribute(name) {
					if (this.attributes[name] === void 0) return null;
					return this.attributes[name];
				}
				setAttribute(name, attribute) {
					this.attributes[name] = attribute;
				}
				setAttributeNS(_namespace, qualifiedName, value) {
					this.setAttribute(qualifiedName, value);
				}
				removeAttribute(name) {
					delete this.attributes[name];
				}
				appendChild(newChild) {
					return appendChild(this, newChild);
				}
				insertBefore(newChild, refChild) {
					return insertBefore(this, newChild, refChild);
				}
				removeChild(node2) {
					return removeChild(this, node2);
				}
				attachShadow(_init) {
					const shadowRoot2 = this.ownerDocument.createElement("SHADOWROOT");
					this.shadowRoot = shadowRoot2;
					return shadowRoot2;
				}
				dispatchEvent(_event) {
					return true;
				}
				toString() {
					let attributeString = "";
					for (const attribute in this.attributes) attributeString += `${attribute}="${this.attributes[attribute]}" `;
					return `${this.tagName} ${attributeString}`;
				}
			};
			BaseRRMediaElement = class extends BaseRRElement {
				constructor() {
					super(...arguments);
					__publicField2(this, "currentTime");
					__publicField2(this, "volume");
					__publicField2(this, "paused");
					__publicField2(this, "muted");
					__publicField2(this, "playbackRate");
					__publicField2(this, "loop");
				}
				attachShadow(_init) {
					throw new Error(`RRDomException: Failed to execute 'attachShadow' on 'RRElement': This RRElement does not support attachShadow`);
				}
				play() {
					this.paused = false;
				}
				pause() {
					this.paused = true;
				}
			};
			BaseRRDialogElement = class extends BaseRRElement {
				constructor() {
					super(...arguments);
					__publicField2(this, "tagName", "DIALOG");
					__publicField2(this, "nodeName", "DIALOG");
				}
				get isModal() {
					return this.getAttribute("rr_open_mode") === "modal";
				}
				get open() {
					return this.getAttribute("open") !== null;
				}
				close() {
					this.removeAttribute("open");
					this.removeAttribute("rr_open_mode");
				}
				show() {
					this.setAttribute("open", "");
					this.setAttribute("rr_open_mode", "non-modal");
				}
				showModal() {
					this.setAttribute("open", "");
					this.setAttribute("rr_open_mode", "modal");
				}
			};
			BaseRRText = class extends BaseRRNode {
				constructor(data) {
					super();
					__publicField2(this, "nodeType", 3);
					__publicField2(this, "nodeName", "#text");
					__publicField2(this, "RRNodeType", NodeType$1.Text);
					__publicField2(this, "data");
					this.data = data;
				}
				get textContent() {
					return this.data;
				}
				set textContent(textContent2) {
					this.data = textContent2;
				}
				toString() {
					return `RRText text=${JSON.stringify(this.data)}`;
				}
			};
			BaseRRComment = class extends BaseRRNode {
				constructor(data) {
					super();
					__publicField2(this, "nodeType", 8);
					__publicField2(this, "nodeName", "#comment");
					__publicField2(this, "RRNodeType", NodeType$1.Comment);
					__publicField2(this, "data");
					this.data = data;
				}
				get textContent() {
					return this.data;
				}
				set textContent(textContent2) {
					this.data = textContent2;
				}
				toString() {
					return `RRComment text=${JSON.stringify(this.data)}`;
				}
			};
			BaseRRCDATASection = class extends BaseRRNode {
				constructor(data) {
					super();
					__publicField2(this, "nodeName", "#cdata-section");
					__publicField2(this, "nodeType", 4);
					__publicField2(this, "RRNodeType", NodeType$1.CDATA);
					__publicField2(this, "data");
					this.data = data;
				}
				get textContent() {
					return this.data;
				}
				set textContent(textContent2) {
					this.data = textContent2;
				}
				toString() {
					return `RRCDATASection data=${JSON.stringify(this.data)}`;
				}
			};
			ClassList = class {
				constructor(classText, onChange) {
					__publicField2(this, "onChange");
					__publicField2(this, "classes", []);
					__publicField2(this, "add", (...classNames) => {
						for (const item of classNames) {
							const className = String(item);
							if (this.classes.indexOf(className) >= 0) continue;
							this.classes.push(className);
						}
						this.onChange && this.onChange(this.classes.join(" "));
					});
					__publicField2(this, "remove", (...classNames) => {
						this.classes = this.classes.filter((item) => classNames.indexOf(item) === -1);
						this.onChange && this.onChange(this.classes.join(" "));
					});
					if (classText) {
						const classes = classText.trim().split(/\s+/);
						this.classes.push(...classes);
					}
					this.onChange = onChange;
				}
			};
			NodeType$2 = /* @__PURE__ */ ((NodeType2) => {
				NodeType2[NodeType2["PLACEHOLDER"] = 0] = "PLACEHOLDER";
				NodeType2[NodeType2["ELEMENT_NODE"] = 1] = "ELEMENT_NODE";
				NodeType2[NodeType2["ATTRIBUTE_NODE"] = 2] = "ATTRIBUTE_NODE";
				NodeType2[NodeType2["TEXT_NODE"] = 3] = "TEXT_NODE";
				NodeType2[NodeType2["CDATA_SECTION_NODE"] = 4] = "CDATA_SECTION_NODE";
				NodeType2[NodeType2["ENTITY_REFERENCE_NODE"] = 5] = "ENTITY_REFERENCE_NODE";
				NodeType2[NodeType2["ENTITY_NODE"] = 6] = "ENTITY_NODE";
				NodeType2[NodeType2["PROCESSING_INSTRUCTION_NODE"] = 7] = "PROCESSING_INSTRUCTION_NODE";
				NodeType2[NodeType2["COMMENT_NODE"] = 8] = "COMMENT_NODE";
				NodeType2[NodeType2["DOCUMENT_NODE"] = 9] = "DOCUMENT_NODE";
				NodeType2[NodeType2["DOCUMENT_TYPE_NODE"] = 10] = "DOCUMENT_TYPE_NODE";
				NodeType2[NodeType2["DOCUMENT_FRAGMENT_NODE"] = 11] = "DOCUMENT_FRAGMENT_NODE";
				return NodeType2;
			})(NodeType$2 || {});
			NAMESPACES = {
				svg: "http://www.w3.org/2000/svg",
				"xlink:href": "http://www.w3.org/1999/xlink",
				xmlns: "http://www.w3.org/2000/xmlns/"
			};
			SVGTagMap = {
				altglyph: "altGlyph",
				altglyphdef: "altGlyphDef",
				altglyphitem: "altGlyphItem",
				animatecolor: "animateColor",
				animatemotion: "animateMotion",
				animatetransform: "animateTransform",
				clippath: "clipPath",
				feblend: "feBlend",
				fecolormatrix: "feColorMatrix",
				fecomponenttransfer: "feComponentTransfer",
				fecomposite: "feComposite",
				feconvolvematrix: "feConvolveMatrix",
				fediffuselighting: "feDiffuseLighting",
				fedisplacementmap: "feDisplacementMap",
				fedistantlight: "feDistantLight",
				fedropshadow: "feDropShadow",
				feflood: "feFlood",
				fefunca: "feFuncA",
				fefuncb: "feFuncB",
				fefuncg: "feFuncG",
				fefuncr: "feFuncR",
				fegaussianblur: "feGaussianBlur",
				feimage: "feImage",
				femerge: "feMerge",
				femergenode: "feMergeNode",
				femorphology: "feMorphology",
				feoffset: "feOffset",
				fepointlight: "fePointLight",
				fespecularlighting: "feSpecularLighting",
				fespotlight: "feSpotLight",
				fetile: "feTile",
				feturbulence: "feTurbulence",
				foreignobject: "foreignObject",
				glyphref: "glyphRef",
				lineargradient: "linearGradient",
				radialgradient: "radialGradient"
			};
			createdNodeSet = null;
			RRDocument = class RRDocument extends BaseRRDocument {
				constructor(mirror2) {
					super();
					__publicField2(this, "UNSERIALIZED_STARTING_ID", -2);
					__publicField2(this, "_unserializedId", this.UNSERIALIZED_STARTING_ID);
					__publicField2(this, "mirror", createMirror());
					__publicField2(this, "scrollData", null);
					if (mirror2) this.mirror = mirror2;
				}
				/**
				* Every time the id is used, it will minus 1 automatically to avoid collisions.
				*/
				get unserializedId() {
					return this._unserializedId--;
				}
				createDocument(_namespace, _qualifiedName, _doctype) {
					return new RRDocument();
				}
				createDocumentType(qualifiedName, publicId, systemId) {
					const documentTypeNode = new RRDocumentType(qualifiedName, publicId, systemId);
					documentTypeNode.ownerDocument = this;
					return documentTypeNode;
				}
				createElement(tagName) {
					const upperTagName = tagName.toUpperCase();
					let element;
					switch (upperTagName) {
						case "AUDIO":
						case "VIDEO":
							element = new RRMediaElement(upperTagName);
							break;
						case "IFRAME":
							element = new RRIFrameElement(upperTagName, this.mirror);
							break;
						case "CANVAS":
							element = new RRCanvasElement(upperTagName);
							break;
						case "STYLE":
							element = new RRStyleElement(upperTagName);
							break;
						case "DIALOG":
							element = new RRDialogElement(upperTagName);
							break;
						default:
							element = new RRElement(upperTagName);
							break;
					}
					element.ownerDocument = this;
					return element;
				}
				createComment(data) {
					const commentNode = new RRComment(data);
					commentNode.ownerDocument = this;
					return commentNode;
				}
				createCDATASection(data) {
					const sectionNode = new RRCDATASection(data);
					sectionNode.ownerDocument = this;
					return sectionNode;
				}
				createTextNode(data) {
					const textNode = new RRText(data);
					textNode.ownerDocument = this;
					return textNode;
				}
				destroyTree() {
					this.firstChild = null;
					this.lastChild = null;
					this.mirror.reset();
				}
				open() {
					super.open();
					this._unserializedId = this.UNSERIALIZED_STARTING_ID;
				}
			};
			RRDocumentType = BaseRRDocumentType;
			RRElement = class extends BaseRRElement {
				constructor() {
					super(...arguments);
					__publicField2(this, "inputData", null);
					__publicField2(this, "scrollData", null);
				}
			};
			RRMediaElement = class extends BaseRRMediaElement {};
			RRDialogElement = class extends BaseRRDialogElement {};
			RRCanvasElement = class extends RRElement {
				constructor() {
					super(...arguments);
					__publicField2(this, "rr_dataURL", null);
					__publicField2(this, "canvasMutations", []);
				}
				/**
				* This is a dummy implementation to distinguish RRCanvasElement from real HTMLCanvasElement.
				*/
				getContext() {
					return null;
				}
			};
			RRStyleElement = class extends RRElement {
				constructor() {
					super(...arguments);
					__publicField2(this, "rules", []);
				}
			};
			RRIFrameElement = class extends RRElement {
				constructor(upperTagName, mirror2) {
					super(upperTagName);
					__publicField2(this, "contentDocument", new RRDocument());
					this.contentDocument.mirror = mirror2;
				}
			};
			RRText = BaseRRText;
			RRComment = BaseRRComment;
			RRCDATASection = BaseRRCDATASection;
			Mirror22 = class {
				constructor() {
					__publicField2(this, "idNodeMap", /* @__PURE__ */ new Map());
					__publicField2(this, "nodeMetaMap", /* @__PURE__ */ new WeakMap());
				}
				getId(n2) {
					var _a2;
					if (!n2) return -1;
					return ((_a2 = this.getMeta(n2)) == null ? void 0 : _a2.id) ?? -1;
				}
				getNode(id) {
					return this.idNodeMap.get(id) || null;
				}
				getIds() {
					return Array.from(this.idNodeMap.keys());
				}
				getMeta(n2) {
					return this.nodeMetaMap.get(n2) || null;
				}
				removeNodeFromMap(n2) {
					const id = this.getId(n2);
					this.idNodeMap.delete(id);
					if (n2.childNodes) n2.childNodes.forEach((childNode) => this.removeNodeFromMap(childNode));
				}
				has(id) {
					return this.idNodeMap.has(id);
				}
				hasNode(node2) {
					return this.nodeMetaMap.has(node2);
				}
				add(n2, meta) {
					const id = meta.id;
					this.idNodeMap.set(id, n2);
					this.nodeMetaMap.set(n2, meta);
				}
				replace(id, n2) {
					const oldNode = this.getNode(id);
					if (oldNode) {
						const meta = this.nodeMetaMap.get(oldNode);
						if (meta) this.nodeMetaMap.set(n2, meta);
					}
					this.idNodeMap.set(id, n2);
				}
				reset() {
					this.idNodeMap = /* @__PURE__ */ new Map();
					this.nodeMetaMap = /* @__PURE__ */ new WeakMap();
				}
			};
			testableAccessors = {
				Node: [
					"childNodes",
					"parentNode",
					"parentElement",
					"textContent",
					"ownerDocument",
					"firstChild",
					"lastChild",
					"nextSibling",
					"previousSibling"
				],
				ShadowRoot: ["host", "styleSheets"],
				Element: [
					"shadowRoot",
					"querySelector",
					"querySelectorAll"
				],
				MutationObserver: []
			};
			testableMethods = {
				Node: ["contains", "getRootNode"],
				ShadowRoot: ["getSelection"],
				Element: [],
				MutationObserver: ["constructor"]
			};
			untaintedBasePrototype = {};
			untaintedBaseIframeCleanup = {};
			mutationObserverUsers = 0;
			isAngularZonePresent = () => {
				return !!globalThis.Zone;
			};
			untaintedAccessorCache = {};
			untaintedMethodCache = {};
			nowTimestamp = Date.now;
			if (!/* @__PURE__ */ /[1-9][0-9]{12}/.test(Date.now().toString())) nowTimestamp = () => (/* @__PURE__ */ new Date()).getTime();
			index = {
				ownerDocument,
				childNodes,
				parentNode,
				parentElement,
				textContent,
				firstChild,
				lastChild,
				nextSibling,
				previousSibling,
				contains,
				getRootNode,
				host,
				styleSheets,
				shadowRoot,
				querySelector,
				querySelectorAll,
				nowTimestamp,
				mutationObserverCtor,
				patch
			};
			DEPARTED_MIRROR_ACCESS_WARNING = "Please stop import mirror directly. Instead of that,\r\nnow you can use replayer.getMirror() to access the mirror instance of a replayer,\r\nor you can use record.mirror to access the mirror instance during recording.";
			_mirror = {
				map: {},
				getId() {
					console.error(DEPARTED_MIRROR_ACCESS_WARNING);
					return -1;
				},
				getNode() {
					console.error(DEPARTED_MIRROR_ACCESS_WARNING);
					return null;
				},
				removeNodeFromMap() {
					console.error(DEPARTED_MIRROR_ACCESS_WARNING);
				},
				has() {
					console.error(DEPARTED_MIRROR_ACCESS_WARNING);
					return false;
				},
				reset() {
					console.error(DEPARTED_MIRROR_ACCESS_WARNING);
				}
			};
			if (typeof window !== "undefined" && window.Proxy && window.Reflect) _mirror = new Proxy(_mirror, { get(target, prop, receiver) {
				if (prop === "map") console.error(DEPARTED_MIRROR_ACCESS_WARNING);
				return Reflect.get(target, prop, receiver);
			} });
			StyleSheetMirror = class {
				constructor() {
					__publicField(this, "id", 1);
					__publicField(this, "styleIDMap", /* @__PURE__ */ new WeakMap());
					__publicField(this, "idStyleMap", /* @__PURE__ */ new Map());
				}
				getId(stylesheet) {
					return this.styleIDMap.get(stylesheet) ?? -1;
				}
				has(stylesheet) {
					return this.styleIDMap.has(stylesheet);
				}
				/**
				* @returns If the stylesheet is in the mirror, returns the id of the stylesheet. If not, return the new assigned id.
				*/
				add(stylesheet, id) {
					if (this.has(stylesheet)) return this.getId(stylesheet);
					let newId;
					if (id === void 0) newId = this.id++;
					else newId = id;
					this.styleIDMap.set(stylesheet, newId);
					this.idStyleMap.set(newId, stylesheet);
					return newId;
				}
				getStyle(id) {
					return this.idStyleMap.get(id) || null;
				}
				reset() {
					this.styleIDMap = /* @__PURE__ */ new WeakMap();
					this.idStyleMap = /* @__PURE__ */ new Map();
					this.id = 1;
				}
				generateId() {
					return this.id++;
				}
			};
			utils = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
				__proto__: null,
				StyleSheetMirror,
				get _mirror() {
					return _mirror;
				},
				closestElementOfNode,
				getBaseDimension,
				getNestedRule,
				getPositionsAndIndex,
				getRootShadowHost,
				getShadowHost,
				getWindowHeight,
				getWindowScroll,
				getWindowWidth,
				hasShadowRoot,
				hookSetter,
				inDom,
				isAncestorRemoved,
				isBlocked,
				isIgnored,
				isSerialized,
				isSerializedIframe,
				isSerializedStylesheet,
				iterateResolveTree,
				legacy_isTouchEvent,
				get nowTimestamp() {
					return nowTimestamp;
				},
				on,
				polyfill: polyfill$1,
				queueToResolveTrees,
				shadowHostInDom,
				throttle,
				uniqueTextMutations
			}, Symbol.toStringTag, { value: "Module" }));
			EventType = /* @__PURE__ */ ((EventType2) => {
				EventType2[EventType2["DomContentLoaded"] = 0] = "DomContentLoaded";
				EventType2[EventType2["Load"] = 1] = "Load";
				EventType2[EventType2["FullSnapshot"] = 2] = "FullSnapshot";
				EventType2[EventType2["IncrementalSnapshot"] = 3] = "IncrementalSnapshot";
				EventType2[EventType2["Meta"] = 4] = "Meta";
				EventType2[EventType2["Custom"] = 5] = "Custom";
				EventType2[EventType2["Plugin"] = 6] = "Plugin";
				EventType2[EventType2["Asset"] = 7] = "Asset";
				EventType2[EventType2["Annotation"] = 8] = "Annotation";
				return EventType2;
			})(EventType || {});
			IncrementalSource = /* @__PURE__ */ ((IncrementalSource2) => {
				IncrementalSource2[IncrementalSource2["Mutation"] = 0] = "Mutation";
				IncrementalSource2[IncrementalSource2["MouseMove"] = 1] = "MouseMove";
				IncrementalSource2[IncrementalSource2["MouseInteraction"] = 2] = "MouseInteraction";
				IncrementalSource2[IncrementalSource2["Scroll"] = 3] = "Scroll";
				IncrementalSource2[IncrementalSource2["ViewportResize"] = 4] = "ViewportResize";
				IncrementalSource2[IncrementalSource2["Input"] = 5] = "Input";
				IncrementalSource2[IncrementalSource2["TouchMove"] = 6] = "TouchMove";
				IncrementalSource2[IncrementalSource2["MediaInteraction"] = 7] = "MediaInteraction";
				IncrementalSource2[IncrementalSource2["StyleSheetRule"] = 8] = "StyleSheetRule";
				IncrementalSource2[IncrementalSource2["CanvasMutation"] = 9] = "CanvasMutation";
				IncrementalSource2[IncrementalSource2["Font"] = 10] = "Font";
				IncrementalSource2[IncrementalSource2["Log"] = 11] = "Log";
				IncrementalSource2[IncrementalSource2["Drag"] = 12] = "Drag";
				IncrementalSource2[IncrementalSource2["StyleDeclaration"] = 13] = "StyleDeclaration";
				IncrementalSource2[IncrementalSource2["Selection"] = 14] = "Selection";
				IncrementalSource2[IncrementalSource2["AdoptedStyleSheet"] = 15] = "AdoptedStyleSheet";
				IncrementalSource2[IncrementalSource2["CustomElement"] = 16] = "CustomElement";
				return IncrementalSource2;
			})(IncrementalSource || {});
			MouseInteractions = /* @__PURE__ */ ((MouseInteractions2) => {
				MouseInteractions2[MouseInteractions2["MouseUp"] = 0] = "MouseUp";
				MouseInteractions2[MouseInteractions2["MouseDown"] = 1] = "MouseDown";
				MouseInteractions2[MouseInteractions2["Click"] = 2] = "Click";
				MouseInteractions2[MouseInteractions2["ContextMenu"] = 3] = "ContextMenu";
				MouseInteractions2[MouseInteractions2["DblClick"] = 4] = "DblClick";
				MouseInteractions2[MouseInteractions2["Focus"] = 5] = "Focus";
				MouseInteractions2[MouseInteractions2["Blur"] = 6] = "Blur";
				MouseInteractions2[MouseInteractions2["TouchStart"] = 7] = "TouchStart";
				MouseInteractions2[MouseInteractions2["TouchMove_Departed"] = 8] = "TouchMove_Departed";
				MouseInteractions2[MouseInteractions2["TouchEnd"] = 9] = "TouchEnd";
				MouseInteractions2[MouseInteractions2["TouchCancel"] = 10] = "TouchCancel";
				return MouseInteractions2;
			})(MouseInteractions || {});
			PointerTypes = /* @__PURE__ */ ((PointerTypes2) => {
				PointerTypes2[PointerTypes2["Mouse"] = 0] = "Mouse";
				PointerTypes2[PointerTypes2["Pen"] = 1] = "Pen";
				PointerTypes2[PointerTypes2["Touch"] = 2] = "Touch";
				return PointerTypes2;
			})(PointerTypes || {});
			CanvasContext = /* @__PURE__ */ ((CanvasContext2) => {
				CanvasContext2[CanvasContext2["2D"] = 0] = "2D";
				CanvasContext2[CanvasContext2["WebGL"] = 1] = "WebGL";
				CanvasContext2[CanvasContext2["WebGL2"] = 2] = "WebGL2";
				return CanvasContext2;
			})(CanvasContext || {});
			MediaInteractions = /* @__PURE__ */ ((MediaInteractions2) => {
				MediaInteractions2[MediaInteractions2["Play"] = 0] = "Play";
				MediaInteractions2[MediaInteractions2["Pause"] = 1] = "Pause";
				MediaInteractions2[MediaInteractions2["Seeked"] = 2] = "Seeked";
				MediaInteractions2[MediaInteractions2["VolumeChange"] = 3] = "VolumeChange";
				MediaInteractions2[MediaInteractions2["RateChange"] = 4] = "RateChange";
				return MediaInteractions2;
			})(MediaInteractions || {});
			ReplayerEvents = /* @__PURE__ */ ((ReplayerEvents2) => {
				ReplayerEvents2["Start"] = "start";
				ReplayerEvents2["Pause"] = "pause";
				ReplayerEvents2["Resume"] = "resume";
				ReplayerEvents2["Resize"] = "resize";
				ReplayerEvents2["Finish"] = "finish";
				ReplayerEvents2["FullsnapshotRebuilded"] = "fullsnapshot-rebuilded";
				ReplayerEvents2["LoadStylesheetStart"] = "load-stylesheet-start";
				ReplayerEvents2["LoadStylesheetEnd"] = "load-stylesheet-end";
				ReplayerEvents2["SkipStart"] = "skip-start";
				ReplayerEvents2["SkipEnd"] = "skip-end";
				ReplayerEvents2["MouseInteraction"] = "mouse-interaction";
				ReplayerEvents2["EventCast"] = "event-cast";
				ReplayerEvents2["CustomEvent"] = "custom-event";
				ReplayerEvents2["Annotation"] = "annotation";
				ReplayerEvents2["Flush"] = "flush";
				ReplayerEvents2["StateChange"] = "state-change";
				ReplayerEvents2["PlayBack"] = "play-back";
				ReplayerEvents2["Destroy"] = "destroy";
				return ReplayerEvents2;
			})(ReplayerEvents || {});
			NodeType = /* @__PURE__ */ ((NodeType2) => {
				NodeType2[NodeType2["Document"] = 0] = "Document";
				NodeType2[NodeType2["DocumentType"] = 1] = "DocumentType";
				NodeType2[NodeType2["Element"] = 2] = "Element";
				NodeType2[NodeType2["Text"] = 3] = "Text";
				NodeType2[NodeType2["CDATA"] = 4] = "CDATA";
				NodeType2[NodeType2["Comment"] = 5] = "Comment";
				return NodeType2;
			})(NodeType || {});
			moveKey = (id, parentId) => `${id}@${parentId}`;
			MutationBuffer = class {
				constructor() {
					__publicField(this, "frozen", false);
					__publicField(this, "locked", false);
					__publicField(this, "texts", []);
					__publicField(this, "attributes", []);
					__publicField(this, "attributeMap", /* @__PURE__ */ new WeakMap());
					__publicField(this, "removes", []);
					__publicField(this, "mapRemoves", []);
					__publicField(this, "movedMap", {});
					/**
					* the browser MutationObserver emits multiple mutations after
					* a delay for performance reasons, making tracing added nodes hard
					* in our `processMutations` callback function.
					* For example, if we append an element el_1 into body, and then append
					* another element el_2 into el_1, these two mutations may be passed to the
					* callback function together when the two operations were done.
					* Generally we need to trace child nodes of newly added nodes, but in this
					* case if we count el_2 as el_1's child node in the first mutation record,
					* then we will count el_2 again in the second mutation record which was
					* duplicated.
					* To avoid of duplicate counting added nodes, we use a Set to store
					* added nodes and its child nodes during iterate mutation records. Then
					* collect added nodes from the Set which have no duplicate copy. But
					* this also causes newly added nodes will not be serialized with id ASAP,
					* which means all the id related calculation should be lazy too.
					*/
					__publicField(this, "addedSet", /* @__PURE__ */ new Set());
					__publicField(this, "movedSet", /* @__PURE__ */ new Set());
					__publicField(this, "droppedSet", /* @__PURE__ */ new Set());
					__publicField(this, "removesSubTreeCache", /* @__PURE__ */ new Set());
					__publicField(this, "mutationCb");
					__publicField(this, "blockClass");
					__publicField(this, "blockSelector");
					__publicField(this, "maskTextClass");
					__publicField(this, "maskTextSelector");
					__publicField(this, "inlineStylesheet");
					__publicField(this, "maskInputOptions");
					__publicField(this, "maskTextFn");
					__publicField(this, "maskInputFn");
					__publicField(this, "keepIframeSrcFn");
					__publicField(this, "recordCanvas");
					__publicField(this, "inlineImages");
					__publicField(this, "slimDOMOptions");
					__publicField(this, "dataURLOptions");
					__publicField(this, "doc");
					__publicField(this, "mirror");
					__publicField(this, "iframeManager");
					__publicField(this, "stylesheetManager");
					__publicField(this, "shadowDomManager");
					__publicField(this, "processedNodeManager");
					__publicField(this, "unattachedDoc");
					__publicField(this, "processMutations", (mutations) => {
						mutations.forEach(this.processMutation);
						this.emit();
					});
					__publicField(this, "emit", () => {
						if (this.frozen || this.locked) return;
						const adds = [];
						const addedIds = /* @__PURE__ */ new Set();
						while (this.mapRemoves.length) this.mirror.removeNodeFromMap(this.mapRemoves.shift());
						for (const n22 of this.movedSet) {
							const parentNode22 = index.parentNode(n22);
							if (this.removesSubTreeCache.has(parentNode22) && !this.movedSet.has(parentNode22)) continue;
							this.addedSet.add(n22);
						}
						let n2 = null;
						let parentNode2 = null;
						let parentId = -1;
						let nextSibling2 = null;
						let ancestorBad = false;
						const missingParents = /* @__PURE__ */ new Set();
						const iter = this.addedSet.values();
						let curr = iter.next();
						while (this.addedSet.size) {
							if (n2 !== null && this.addedSet.has(index.previousSibling(n2))) {
								nextSibling2 = n2;
								n2 = index.previousSibling(n2);
							} else {
								if (!this.addedSet.has(curr.value)) curr = iter.next();
								n2 = curr.value;
								while (true) {
									parentNode2 = index.parentNode(n2);
									if (this.addedSet.has(parentNode2)) {
										n2 = parentNode2;
										continue;
									}
									break;
								}
								if (missingParents.has(parentNode2)) parentNode2 = null;
								else if (parentNode2) {
									if (!inDom(parentNode2)) ancestorBad = true;
									else {
										ancestorBad = isSelfOrAncestorInSet(this.droppedSet, parentNode2) || this.removesSubTreeCache.has(parentNode2);
										if (ancestorBad && isSelfOrAncestorInSet(this.movedSet, n2)) ancestorBad = false;
									}
									if (this.addedSet.has(index.lastChild(parentNode2))) {
										n2 = index.lastChild(parentNode2);
										nextSibling2 = null;
									} else while (true) {
										nextSibling2 = index.nextSibling(n2);
										if (this.addedSet.has(nextSibling2)) {
											n2 = nextSibling2;
											continue;
										}
										break;
									}
									parentId = isShadowRoot(parentNode2) ? this.mirror.getId(getShadowHost(n2)) : this.mirror.getId(parentNode2);
									if (parentId === -1 && parentNode2.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
										const shadowHost = index.host(parentNode2);
										parentId = this.mirror.getId(shadowHost);
									}
								}
							}
							this.addedSet.delete(n2);
							if (!parentNode2 || parentId === -1) {
								missingParents.add(n2);
								continue;
							} else if (ancestorBad) {
								this.droppedSet.add(n2);
								continue;
							}
							let cssCaptured = false;
							if (n2.nodeType === Node.TEXT_NODE) {
								const parentTag = parentNode2.tagName;
								if (parentTag === "TEXTAREA") continue;
								else if (parentTag === "STYLE" && addedIds.has(parentId)) cssCaptured = true;
							}
							let nextId = nextSibling2 ? this.mirror.getId(nextSibling2) : null;
							while (nextId === IGNORED_NODE) {
								nextSibling2 = nextSibling2 && index.nextSibling(nextSibling2);
								nextId = nextSibling2 && this.mirror.getId(nextSibling2);
							}
							if (nextId === -1) {
								console.warn("Couldn't record new node. Couldn't find mirror id for nextSibling:", nextSibling2);
								n2 = null;
								continue;
							}
							const sn = serializeNodeWithId(n2, {
								doc: this.doc,
								mirror: this.mirror,
								blockClass: this.blockClass,
								blockSelector: this.blockSelector,
								maskTextClass: this.maskTextClass,
								maskTextSelector: this.maskTextSelector,
								skipChild: true,
								newlyAddedElement: true,
								inlineStylesheet: this.inlineStylesheet,
								maskInputOptions: this.maskInputOptions,
								maskTextFn: this.maskTextFn,
								maskInputFn: this.maskInputFn,
								slimDOMOptions: this.slimDOMOptions,
								dataURLOptions: this.dataURLOptions,
								recordCanvas: this.recordCanvas,
								inlineImages: this.inlineImages,
								onSerialize: (currentN) => {
									if (isSerializedIframe(currentN, this.mirror)) this.iframeManager.addIframe(currentN);
									if (isSerializedStylesheet(currentN, this.mirror)) this.stylesheetManager.trackLinkElement(currentN);
									if (hasShadowRoot(n2)) this.shadowDomManager.addShadowRoot(index.shadowRoot(n2), this.doc);
								},
								onIframeLoad: (iframe, childSn) => {
									this.iframeManager.attachIframe(iframe, childSn);
									this.shadowDomManager.observeAttachShadow(iframe);
								},
								onStylesheetLoad: (link, childSn) => {
									this.stylesheetManager.attachLinkElement(link, childSn);
								},
								cssCaptured
							});
							if (sn) {
								adds.push({
									parentId,
									nextId,
									node: sn
								});
								addedIds.add(sn.id);
							}
						}
						const payload = {
							texts: this.texts.map((text) => {
								const n22 = text.node;
								const parent = index.parentNode(n22);
								if (parent && parent.tagName === "TEXTAREA") this.genTextAreaValueMutation(parent);
								return {
									id: this.mirror.getId(n22),
									value: text.value
								};
							}).filter((text) => !addedIds.has(text.id)).filter((text) => this.mirror.has(text.id)),
							attributes: this.attributes.map((attribute) => {
								const { attributes } = attribute;
								if (typeof attributes.style === "string") {
									const diffAsStr = JSON.stringify(attribute.styleDiff);
									const unchangedAsStr = JSON.stringify(attribute._unchangedStyles);
									if (diffAsStr.length < attributes.style.length) {
										if ((diffAsStr + unchangedAsStr).split("var(").length === attributes.style.split("var(").length) attributes.style = attribute.styleDiff;
									}
								}
								return {
									id: this.mirror.getId(attribute.node),
									attributes
								};
							}).filter((attribute) => !addedIds.has(attribute.id)).filter((attribute) => this.mirror.has(attribute.id)),
							removes: this.removes,
							adds
						};
						if (!payload.texts.length && !payload.attributes.length && !payload.removes.length && !payload.adds.length) return;
						this.texts = [];
						this.attributes = [];
						this.attributeMap = /* @__PURE__ */ new WeakMap();
						this.removes = [];
						this.addedSet = /* @__PURE__ */ new Set();
						this.movedSet = /* @__PURE__ */ new Set();
						this.droppedSet = /* @__PURE__ */ new Set();
						this.removesSubTreeCache = /* @__PURE__ */ new Set();
						this.movedMap = {};
						this.mutationCb(payload);
					});
					__publicField(this, "genTextAreaValueMutation", (textarea) => {
						let item = this.attributeMap.get(textarea);
						if (!item) {
							item = {
								node: textarea,
								attributes: {},
								styleDiff: {},
								_unchangedStyles: {}
							};
							this.attributes.push(item);
							this.attributeMap.set(textarea, item);
						}
						const value = Array.from(index.childNodes(textarea), (cn) => index.textContent(cn) || "").join("");
						item.attributes.value = maskInputValue({
							element: textarea,
							maskInputOptions: this.maskInputOptions,
							tagName: textarea.tagName,
							type: getInputType(textarea),
							value,
							maskInputFn: this.maskInputFn
						});
					});
					__publicField(this, "processMutation", (m) => {
						if (isIgnored(m.target, this.mirror, this.slimDOMOptions)) return;
						switch (m.type) {
							case "characterData": {
								const value = index.textContent(m.target);
								if (!isBlocked(m.target, this.blockClass, this.blockSelector, false) && value !== m.oldValue) this.texts.push({
									value: needMaskingText(m.target, this.maskTextClass, this.maskTextSelector, true) && value ? this.maskTextFn ? this.maskTextFn(value, closestElementOfNode(m.target)) : value.replace(/[\S]/g, "*") : value,
									node: m.target
								});
								break;
							}
							case "attributes": {
								const target = m.target;
								const tagNameLower = toLowerCase(target.tagName);
								let attributeName = m.attributeName;
								let value = m.target.getAttribute(attributeName);
								if (attributeName === "value") {
									const type = getInputType(target);
									value = maskInputValue({
										element: target,
										maskInputOptions: this.maskInputOptions,
										tagName: target.tagName,
										type,
										value,
										maskInputFn: this.maskInputFn
									});
								}
								if (isBlocked(m.target, this.blockClass, this.blockSelector, false) || value === m.oldValue) return;
								let item = this.attributeMap.get(m.target);
								if (tagNameLower === "iframe" && attributeName === "src" && !this.keepIframeSrcFn(value)) if (!target.contentDocument) attributeName = "rr_src";
								else return;
								if (!item) {
									item = {
										node: m.target,
										attributes: {},
										styleDiff: {},
										_unchangedStyles: {}
									};
									this.attributes.push(item);
									this.attributeMap.set(m.target, item);
								}
								if (attributeName === "type" && tagNameLower === "input" && (m.oldValue || "").toLowerCase() === "password") target.setAttribute("data-rr-is-password", "true");
								if (!ignoreAttribute(tagNameLower, attributeName)) {
									item.attributes[attributeName] = transformAttribute(this.doc, tagNameLower, toLowerCase(attributeName), value);
									if (attributeName === "style") {
										if (!this.unattachedDoc) try {
											this.unattachedDoc = document.implementation.createHTMLDocument();
										} catch (e2) {
											this.unattachedDoc = this.doc;
										}
										const old = this.unattachedDoc.createElement("span");
										if (m.oldValue) old.setAttribute("style", m.oldValue);
										for (const pname of Array.from(target.style)) {
											const newValue = target.style.getPropertyValue(pname);
											const newPriority = target.style.getPropertyPriority(pname);
											if (newValue !== old.style.getPropertyValue(pname) || newPriority !== old.style.getPropertyPriority(pname)) if (newPriority === "") item.styleDiff[pname] = newValue;
											else item.styleDiff[pname] = [newValue, newPriority];
											else item._unchangedStyles[pname] = [newValue, newPriority];
										}
										for (const pname of Array.from(old.style)) if (target.style.getPropertyValue(pname) === "") item.styleDiff[pname] = false;
									} else if (attributeName === "open" && target.tagName === "DIALOG") if (target.matches("dialog:modal")) item.attributes["rr_open_mode"] = "modal";
									else item.attributes["rr_open_mode"] = "non-modal";
								}
								break;
							}
							case "childList":
								if (isBlocked(m.target, this.blockClass, this.blockSelector, true)) return;
								if (m.target.tagName === "TEXTAREA") {
									this.genTextAreaValueMutation(m.target);
									return;
								}
								m.addedNodes.forEach((n2) => this.genAdds(n2, m.target));
								m.removedNodes.forEach((n2) => {
									if (!inDom(n2)) this.shadowDomManager.removeShadowRootsIn(n2);
									const nodeId = this.mirror.getId(n2);
									const parentId = isShadowRoot(m.target) ? this.mirror.getId(index.host(m.target)) : this.mirror.getId(m.target);
									if (isBlocked(m.target, this.blockClass, this.blockSelector, false) || isIgnored(n2, this.mirror, this.slimDOMOptions) || !isSerialized(n2, this.mirror)) return;
									if (this.addedSet.has(n2)) {
										deepDelete(this.addedSet, n2);
										this.droppedSet.add(n2);
									} else if (this.addedSet.has(m.target) && nodeId === -1);
									else if (isAncestorRemoved(m.target, this.mirror));
									else if (this.movedSet.has(n2) && this.movedMap[moveKey(nodeId, parentId)]) deepDelete(this.movedSet, n2);
									else {
										this.removes.push({
											parentId,
											id: nodeId,
											isShadow: isShadowRoot(m.target) && isNativeShadowDom(m.target) ? true : void 0
										});
										processRemoves(n2, this.removesSubTreeCache);
									}
									this.mapRemoves.push(n2);
								});
								break;
						}
					});
					/**
					* Make sure you check if `n`'s parent is blocked before calling this function
					* */
					__publicField(this, "genAdds", (n2, target) => {
						if (this.processedNodeManager.inOtherBuffer(n2, this)) return;
						if (this.addedSet.has(n2) || this.movedSet.has(n2)) return;
						if (this.mirror.hasNode(n2)) {
							if (isIgnored(n2, this.mirror, this.slimDOMOptions)) return;
							this.movedSet.add(n2);
							let targetId = null;
							if (target && this.mirror.hasNode(target)) targetId = this.mirror.getId(target);
							if (targetId && targetId !== -1) this.movedMap[moveKey(this.mirror.getId(n2), targetId)] = true;
						} else {
							this.addedSet.add(n2);
							this.droppedSet.delete(n2);
						}
						if (!isBlocked(n2, this.blockClass, this.blockSelector, false)) {
							index.childNodes(n2).forEach((childN) => this.genAdds(childN));
							if (hasShadowRoot(n2)) index.childNodes(index.shadowRoot(n2)).forEach((childN) => {
								this.processedNodeManager.add(childN, this);
								this.genAdds(childN, n2);
							});
						}
					});
				}
				init(options) {
					[
						"mutationCb",
						"blockClass",
						"blockSelector",
						"maskTextClass",
						"maskTextSelector",
						"inlineStylesheet",
						"maskInputOptions",
						"maskTextFn",
						"maskInputFn",
						"keepIframeSrcFn",
						"recordCanvas",
						"inlineImages",
						"slimDOMOptions",
						"dataURLOptions",
						"doc",
						"mirror",
						"iframeManager",
						"stylesheetManager",
						"shadowDomManager",
						"processedNodeManager"
					].forEach((key) => {
						this[key] = options[key];
					});
				}
				freeze() {
					this.frozen = true;
				}
				unfreeze() {
					this.frozen = false;
					this.emit();
				}
				isFrozen() {
					return this.frozen;
				}
				lock() {
					this.locked = true;
				}
				unlock() {
					this.locked = false;
					this.emit();
				}
			};
			callbackWrapper = (cb) => {
				if (!errorHandler) return cb;
				const rrwebWrapped = (...rest) => {
					try {
						return cb(...rest);
					} catch (error) {
						if (errorHandler && errorHandler(error) === true) return;
						throw error;
					}
				};
				return rrwebWrapped;
			};
			mutationBuffers = /* @__PURE__ */ new Set();
			INPUT_TAGS = [
				"INPUT",
				"TEXTAREA",
				"SELECT"
			];
			lastInputValueMap = /* @__PURE__ */ new WeakMap();
			CrossOriginIframeMirror = class {
				constructor(generateIdFn) {
					__publicField(this, "iframeIdToRemoteIdMap", /* @__PURE__ */ new WeakMap());
					__publicField(this, "iframeRemoteIdToIdMap", /* @__PURE__ */ new WeakMap());
					this.generateIdFn = generateIdFn;
				}
				getId(iframe, remoteId, idToRemoteMap, remoteToIdMap) {
					const idToRemoteIdMap = idToRemoteMap || this.getIdToRemoteIdMap(iframe);
					const remoteIdToIdMap = remoteToIdMap || this.getRemoteIdToIdMap(iframe);
					let id = idToRemoteIdMap.get(remoteId);
					if (!id) {
						id = this.generateIdFn();
						idToRemoteIdMap.set(remoteId, id);
						remoteIdToIdMap.set(id, remoteId);
					}
					return id;
				}
				getIds(iframe, remoteId) {
					const idToRemoteIdMap = this.getIdToRemoteIdMap(iframe);
					const remoteIdToIdMap = this.getRemoteIdToIdMap(iframe);
					return remoteId.map((id) => this.getId(iframe, id, idToRemoteIdMap, remoteIdToIdMap));
				}
				getRemoteId(iframe, id, map) {
					const remoteIdToIdMap = map || this.getRemoteIdToIdMap(iframe);
					if (typeof id !== "number") return id;
					const remoteId = remoteIdToIdMap.get(id);
					if (!remoteId) return -1;
					return remoteId;
				}
				getRemoteIds(iframe, ids) {
					const remoteIdToIdMap = this.getRemoteIdToIdMap(iframe);
					return ids.map((id) => this.getRemoteId(iframe, id, remoteIdToIdMap));
				}
				reset(iframe) {
					if (!iframe) {
						this.iframeIdToRemoteIdMap = /* @__PURE__ */ new WeakMap();
						this.iframeRemoteIdToIdMap = /* @__PURE__ */ new WeakMap();
						return;
					}
					this.iframeIdToRemoteIdMap.delete(iframe);
					this.iframeRemoteIdToIdMap.delete(iframe);
				}
				getIdToRemoteIdMap(iframe) {
					let idToRemoteIdMap = this.iframeIdToRemoteIdMap.get(iframe);
					if (!idToRemoteIdMap) {
						idToRemoteIdMap = /* @__PURE__ */ new Map();
						this.iframeIdToRemoteIdMap.set(iframe, idToRemoteIdMap);
					}
					return idToRemoteIdMap;
				}
				getRemoteIdToIdMap(iframe) {
					let remoteIdToIdMap = this.iframeRemoteIdToIdMap.get(iframe);
					if (!remoteIdToIdMap) {
						remoteIdToIdMap = /* @__PURE__ */ new Map();
						this.iframeRemoteIdToIdMap.set(iframe, remoteIdToIdMap);
					}
					return remoteIdToIdMap;
				}
			};
			IframeManager = class {
				constructor(options) {
					__publicField(this, "iframes", /* @__PURE__ */ new WeakMap());
					__publicField(this, "crossOriginIframeMap", /* @__PURE__ */ new WeakMap());
					__publicField(this, "crossOriginIframeMirror", new CrossOriginIframeMirror(genId));
					__publicField(this, "crossOriginIframeStyleMirror");
					__publicField(this, "crossOriginIframeRootIdMap", /* @__PURE__ */ new WeakMap());
					__publicField(this, "mirror");
					__publicField(this, "mutationCb");
					__publicField(this, "wrappedEmit");
					__publicField(this, "loadListener");
					__publicField(this, "unloadListener");
					__publicField(this, "attachedWindows", /* @__PURE__ */ new Map());
					__publicField(this, "messageHandler", (message) => this.handleMessage(message));
					__publicField(this, "stylesheetManager");
					__publicField(this, "recordCrossOriginIframes");
					this.mutationCb = options.mutationCb;
					this.wrappedEmit = options.wrappedEmit;
					this.stylesheetManager = options.stylesheetManager;
					this.recordCrossOriginIframes = options.recordCrossOriginIframes;
					this.crossOriginIframeStyleMirror = new CrossOriginIframeMirror(this.stylesheetManager.styleMirror.generateId.bind(this.stylesheetManager.styleMirror));
					this.mirror = options.mirror;
					if (this.recordCrossOriginIframes) window.addEventListener("message", this.messageHandler);
				}
				addIframe(iframeEl) {
					this.iframes.set(iframeEl, true);
					if (iframeEl.contentWindow) this.crossOriginIframeMap.set(iframeEl.contentWindow, iframeEl);
				}
				addLoadListener(cb) {
					this.loadListener = cb;
				}
				addUnloadListener(cb) {
					this.unloadListener = cb;
				}
				attachIframe(iframeEl, childSn) {
					var _a2;
					this.mutationCb({
						adds: [{
							parentId: this.mirror.getId(iframeEl),
							nextId: null,
							node: childSn
						}],
						removes: [],
						texts: [],
						attributes: [],
						isAttachIframe: true
					});
					this.watchIframeWindow(iframeEl);
					(_a2 = this.loadListener) == null || _a2.call(this, iframeEl);
					if (iframeEl.contentDocument && iframeEl.contentDocument.adoptedStyleSheets && iframeEl.contentDocument.adoptedStyleSheets.length > 0) this.stylesheetManager.adoptStyleSheets(iframeEl.contentDocument.adoptedStyleSheets, this.mirror.getId(iframeEl.contentDocument));
				}
				destroy() {
					window.removeEventListener("message", this.messageHandler);
					this.attachedWindows.forEach((stop) => stop());
				}
				watchIframeWindow(iframeEl) {
					const win = iframeEl.contentWindow;
					if (!win || this.attachedWindows.has(win)) return;
					const handlers = [];
					const stop = () => {
						this.attachedWindows.delete(win);
						handlers.forEach((handler) => {
							try {
								handler();
							} catch {}
						});
					};
					this.attachedWindows.set(win, stop);
					if (this.recordCrossOriginIframes) handlers.push(on("message", this.messageHandler, win));
					handlers.push(on("pagehide", (event) => {
						var _a2;
						if (event.persisted) return;
						const doc = win.document;
						stop();
						(_a2 = this.unloadListener) == null || _a2.call(this, doc);
					}, win));
				}
				handleMessage(message) {
					const crossOriginMessageEvent = message;
					if (crossOriginMessageEvent.data.type !== "rrweb" || crossOriginMessageEvent.origin !== crossOriginMessageEvent.data.origin) return;
					if (!message.source) return;
					const iframeEl = this.crossOriginIframeMap.get(message.source);
					if (!iframeEl) return;
					const transformedEvent = this.transformCrossOriginEvent(iframeEl, crossOriginMessageEvent.data.event);
					if (transformedEvent) this.wrappedEmit(transformedEvent, crossOriginMessageEvent.data.isCheckout);
				}
				transformCrossOriginEvent(iframeEl, e2) {
					var _a2;
					switch (e2.type) {
						case EventType.FullSnapshot: {
							this.crossOriginIframeMirror.reset(iframeEl);
							this.crossOriginIframeStyleMirror.reset(iframeEl);
							this.replaceIdOnNode(e2.data.node, iframeEl);
							const rootId = e2.data.node.id;
							this.crossOriginIframeRootIdMap.set(iframeEl, rootId);
							this.patchRootIdOnNode(e2.data.node, rootId);
							return {
								timestamp: e2.timestamp,
								type: EventType.IncrementalSnapshot,
								data: {
									source: IncrementalSource.Mutation,
									adds: [{
										parentId: this.mirror.getId(iframeEl),
										nextId: null,
										node: e2.data.node
									}],
									removes: [],
									texts: [],
									attributes: [],
									isAttachIframe: true
								}
							};
						}
						case EventType.Meta:
						case EventType.Load:
						case EventType.DomContentLoaded: return false;
						case EventType.Annotation:
						case EventType.Plugin: return e2;
						case EventType.Custom:
							this.replaceIds(e2.data.payload, iframeEl, [
								"id",
								"parentId",
								"previousId",
								"nextId"
							]);
							return e2;
						case EventType.IncrementalSnapshot: switch (e2.data.source) {
							case IncrementalSource.Mutation:
								e2.data.adds.forEach((n2) => {
									this.replaceIds(n2, iframeEl, [
										"parentId",
										"nextId",
										"previousId"
									]);
									this.replaceIdOnNode(n2.node, iframeEl);
									const rootId = this.crossOriginIframeRootIdMap.get(iframeEl);
									rootId && this.patchRootIdOnNode(n2.node, rootId);
								});
								e2.data.removes.forEach((n2) => {
									this.replaceIds(n2, iframeEl, ["parentId", "id"]);
								});
								e2.data.attributes.forEach((n2) => {
									this.replaceIds(n2, iframeEl, ["id"]);
								});
								e2.data.texts.forEach((n2) => {
									this.replaceIds(n2, iframeEl, ["id"]);
								});
								return e2;
							case IncrementalSource.Drag:
							case IncrementalSource.TouchMove:
							case IncrementalSource.MouseMove:
								e2.data.positions.forEach((p) => {
									this.replaceIds(p, iframeEl, ["id"]);
								});
								return e2;
							case IncrementalSource.ViewportResize: return false;
							case IncrementalSource.MediaInteraction:
							case IncrementalSource.MouseInteraction:
							case IncrementalSource.Scroll:
							case IncrementalSource.CanvasMutation:
							case IncrementalSource.Input:
								this.replaceIds(e2.data, iframeEl, ["id"]);
								return e2;
							case IncrementalSource.StyleSheetRule:
							case IncrementalSource.StyleDeclaration:
								this.replaceIds(e2.data, iframeEl, ["id"]);
								this.replaceStyleIds(e2.data, iframeEl, ["styleId"]);
								return e2;
							case IncrementalSource.Font: return e2;
							case IncrementalSource.Selection:
								e2.data.ranges.forEach((range) => {
									this.replaceIds(range, iframeEl, ["start", "end"]);
								});
								return e2;
							case IncrementalSource.AdoptedStyleSheet:
								this.replaceIds(e2.data, iframeEl, ["id"]);
								this.replaceStyleIds(e2.data, iframeEl, ["styleIds"]);
								(_a2 = e2.data.styles) == null || _a2.forEach((style) => {
									this.replaceStyleIds(style, iframeEl, ["styleId"]);
								});
								return e2;
						}
					}
					return false;
				}
				replace(iframeMirror, obj, iframeEl, keys) {
					for (const key of keys) {
						if (!Array.isArray(obj[key]) && typeof obj[key] !== "number") continue;
						if (Array.isArray(obj[key])) obj[key] = iframeMirror.getIds(iframeEl, obj[key]);
						else obj[key] = iframeMirror.getId(iframeEl, obj[key]);
					}
					return obj;
				}
				replaceIds(obj, iframeEl, keys) {
					return this.replace(this.crossOriginIframeMirror, obj, iframeEl, keys);
				}
				replaceStyleIds(obj, iframeEl, keys) {
					return this.replace(this.crossOriginIframeStyleMirror, obj, iframeEl, keys);
				}
				replaceIdOnNode(node2, iframeEl) {
					this.replaceIds(node2, iframeEl, ["id", "rootId"]);
					if ("childNodes" in node2) node2.childNodes.forEach((child) => {
						this.replaceIdOnNode(child, iframeEl);
					});
				}
				patchRootIdOnNode(node2, rootId) {
					if (node2.type !== NodeType.Document && !node2.rootId) node2.rootId = rootId;
					if ("childNodes" in node2) node2.childNodes.forEach((child) => {
						this.patchRootIdOnNode(child, rootId);
					});
				}
			};
			ShadowDomManager = class {
				constructor(options) {
					/** Observed shadow roots and the handlers that stop observing them. */
					__publicField(this, "shadowDoms", /* @__PURE__ */ new Map());
					__publicField(this, "mutationCb");
					__publicField(this, "scrollCb");
					__publicField(this, "bypassOptions");
					__publicField(this, "mirror");
					__publicField(this, "restoreHandlers", []);
					this.mutationCb = options.mutationCb;
					this.scrollCb = options.scrollCb;
					this.bypassOptions = options.bypassOptions;
					this.mirror = options.mirror;
					this.init();
				}
				init() {
					this.reset();
					this.patchAttachShadow(Element, document);
				}
				addShadowRoot(shadowRoot2, doc) {
					if (!isNativeShadowDom(shadowRoot2)) return;
					if (this.shadowDoms.has(shadowRoot2)) return;
					const handlers = [];
					this.shadowDoms.set(shadowRoot2, handlers);
					const stopMutationObserver = initMutationObserver({
						...this.bypassOptions,
						doc,
						mutationCb: this.mutationCb,
						mirror: this.mirror,
						shadowDomManager: this
					}, shadowRoot2);
					handlers.push(stopMutationObserver);
					handlers.push(initScrollObserver({
						...this.bypassOptions,
						scrollCb: this.scrollCb,
						doc: shadowRoot2,
						mirror: this.mirror
					}));
					setTimeout(() => {
						if (this.shadowDoms.get(shadowRoot2) !== handlers) return;
						if (shadowRoot2.adoptedStyleSheets && shadowRoot2.adoptedStyleSheets.length > 0) this.bypassOptions.stylesheetManager.adoptStyleSheets(shadowRoot2.adoptedStyleSheets, this.mirror.getId(index.host(shadowRoot2)));
						handlers.push(initAdoptedStyleSheetObserver({
							mirror: this.mirror,
							stylesheetManager: this.bypassOptions.stylesheetManager
						}, shadowRoot2));
					}, 0);
				}
				removeShadowRootsIn(n2) {
					if (this.shadowDoms.size === 0) return;
					const shadowRoot2 = index.shadowRoot(n2);
					if (shadowRoot2) {
						if (this.shadowDoms.has(shadowRoot2)) this.removeShadowRoot(shadowRoot2);
						this.removeShadowRootsIn(shadowRoot2);
					}
					index.childNodes(n2).forEach((child) => this.removeShadowRootsIn(child));
				}
				removeShadowRoot(shadowRoot2) {
					const handlers = this.shadowDoms.get(shadowRoot2);
					this.shadowDoms.delete(shadowRoot2);
					handlers?.forEach(runHandler);
				}
				/**
				* Monkey patch 'attachShadow' of an IFrameElement to observe newly added shadow doms.
				*/
				observeAttachShadow(iframeElement) {
					if (!iframeElement.contentWindow || !iframeElement.contentDocument) return;
					this.patchAttachShadow(iframeElement.contentWindow.Element, iframeElement.contentDocument);
				}
				/**
				* Patch 'attachShadow' to observe newly added shadow doms.
				*/
				patchAttachShadow(element, doc) {
					const manager = this;
					this.restoreHandlers.push(patch(element.prototype, "attachShadow", function(original) {
						return function(option) {
							const sRoot = original.call(this, option);
							const shadowRootEl = index.shadowRoot(this);
							if (shadowRootEl && inDom(this)) manager.addShadowRoot(shadowRootEl, doc);
							return sRoot;
						};
					}));
				}
				reset() {
					this.restoreHandlers.forEach(runHandler);
					this.restoreHandlers = [];
					const shadowDoms = this.shadowDoms;
					this.shadowDoms = /* @__PURE__ */ new Map();
					shadowDoms.forEach((handlers) => handlers.forEach(runHandler));
				}
			};
			chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
			lookup = typeof Uint8Array === "undefined" ? [] : /* @__PURE__ */ new Uint8Array(256);
			for (i$1 = 0; i$1 < chars.length; i$1++) lookup[chars.charCodeAt(i$1)] = i$1;
			encode = function(arraybuffer) {
				var bytes = new Uint8Array(arraybuffer), i2, len = bytes.length, base64 = "";
				for (i2 = 0; i2 < len; i2 += 3) {
					base64 += chars[bytes[i2] >> 2];
					base64 += chars[(bytes[i2] & 3) << 4 | bytes[i2 + 1] >> 4];
					base64 += chars[(bytes[i2 + 1] & 15) << 2 | bytes[i2 + 2] >> 6];
					base64 += chars[bytes[i2 + 2] & 63];
				}
				if (len % 3 === 2) base64 = base64.substring(0, base64.length - 1) + "=";
				else if (len % 3 === 1) base64 = base64.substring(0, base64.length - 2) + "==";
				return base64;
			};
			decode = function(base64) {
				var bufferLength = base64.length * .75, len = base64.length, i2, p = 0, encoded1, encoded2, encoded3, encoded4;
				if (base64[base64.length - 1] === "=") {
					bufferLength--;
					if (base64[base64.length - 2] === "=") bufferLength--;
				}
				var arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
				for (i2 = 0; i2 < len; i2 += 4) {
					encoded1 = lookup[base64.charCodeAt(i2)];
					encoded2 = lookup[base64.charCodeAt(i2 + 1)];
					encoded3 = lookup[base64.charCodeAt(i2 + 2)];
					encoded4 = lookup[base64.charCodeAt(i2 + 3)];
					bytes[p++] = encoded1 << 2 | encoded2 >> 4;
					bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
					bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
				}
				return arraybuffer;
			};
			canvasVarMap = /* @__PURE__ */ new Map();
			saveWebGLVar = (value, win, ctx) => {
				if (!value || !(isInstanceOfWebGLObject(value, win) || typeof value === "object")) return;
				const name = value.constructor.name;
				const list = variableListFor$1(ctx, name);
				let index2 = list.indexOf(value);
				if (index2 === -1) {
					index2 = list.length;
					list.push(value);
				}
				return index2;
			};
			serializeArgs = (args, win, ctx) => {
				return args.map((arg) => serializeArg(arg, win, ctx));
			};
			isInstanceOfWebGLObject = (value, win) => {
				const supportedWebGLConstructorNames = [
					"WebGLActiveInfo",
					"WebGLBuffer",
					"WebGLFramebuffer",
					"WebGLProgram",
					"WebGLRenderbuffer",
					"WebGLShader",
					"WebGLShaderPrecisionFormat",
					"WebGLTexture",
					"WebGLUniformLocation",
					"WebGLVertexArrayObject",
					"WebGLVertexArrayObjectOES"
				].filter((name) => typeof win[name] === "function");
				return Boolean(supportedWebGLConstructorNames.find((name) => value instanceof win[name]));
			};
			jsContent = "(function() {\n  \"use strict\";\n  var chars = \"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/\";\n  var lookup = typeof Uint8Array === \"undefined\" ? [] : new Uint8Array(256);\n  for (var i = 0; i < chars.length; i++) {\n    lookup[chars.charCodeAt(i)] = i;\n  }\n  var encode = function(arraybuffer) {\n    var bytes = new Uint8Array(arraybuffer), i2, len = bytes.length, base64 = \"\";\n    for (i2 = 0; i2 < len; i2 += 3) {\n      base64 += chars[bytes[i2] >> 2];\n      base64 += chars[(bytes[i2] & 3) << 4 | bytes[i2 + 1] >> 4];\n      base64 += chars[(bytes[i2 + 1] & 15) << 2 | bytes[i2 + 2] >> 6];\n      base64 += chars[bytes[i2 + 2] & 63];\n    }\n    if (len % 3 === 2) {\n      base64 = base64.substring(0, base64.length - 1) + \"=\";\n    } else if (len % 3 === 1) {\n      base64 = base64.substring(0, base64.length - 2) + \"==\";\n    }\n    return base64;\n  };\n  const lastBlobMap = /* @__PURE__ */ new Map();\n  const transparentBlobMap = /* @__PURE__ */ new Map();\n  async function getTransparentBlobFor(width, height, dataURLOptions) {\n    const id = `${width}-${height}`;\n    if (\"OffscreenCanvas\" in globalThis) {\n      if (transparentBlobMap.has(id)) return transparentBlobMap.get(id);\n      const offscreen = new OffscreenCanvas(width, height);\n      offscreen.getContext(\"2d\");\n      const blob = await offscreen.convertToBlob(dataURLOptions);\n      const arrayBuffer = await blob.arrayBuffer();\n      const base64 = encode(arrayBuffer);\n      transparentBlobMap.set(id, base64);\n      return base64;\n    } else {\n      return \"\";\n    }\n  }\n  const worker = self;\n  worker.onmessage = async function(e) {\n    if (\"OffscreenCanvas\" in globalThis) {\n      const { id, bitmap, width, height, dataURLOptions } = e.data;\n      const transparentBase64 = getTransparentBlobFor(\n        width,\n        height,\n        dataURLOptions\n      );\n      const offscreen = new OffscreenCanvas(width, height);\n      const ctx = offscreen.getContext(\"2d\");\n      ctx.drawImage(bitmap, 0, 0);\n      bitmap.close();\n      const blob = await offscreen.convertToBlob(dataURLOptions);\n      const type = blob.type;\n      const arrayBuffer = await blob.arrayBuffer();\n      const base64 = encode(arrayBuffer);\n      if (!lastBlobMap.has(id) && await transparentBase64 === base64) {\n        lastBlobMap.set(id, base64);\n        return worker.postMessage({ id });\n      }\n      if (lastBlobMap.get(id) === base64) return worker.postMessage({ id });\n      worker.postMessage({\n        id,\n        type,\n        base64,\n        width,\n        height\n      });\n      lastBlobMap.set(id, base64);\n    } else {\n      return worker.postMessage({ id: e.data.id });\n    }\n  };\n})();\n//# sourceMappingURL=image-bitmap-data-url-worker-IJpC7g_b.js.map\n";
			blob = typeof self !== "undefined" && self.Blob && new Blob([jsContent], { type: "text/javascript;charset=utf-8" });
			CanvasManager = class {
				constructor(options) {
					__publicField(this, "pendingCanvasMutations", /* @__PURE__ */ new Map());
					__publicField(this, "rafStamps", {
						latestId: 0,
						invokeId: null
					});
					__publicField(this, "mirror");
					__publicField(this, "mutationCb");
					__publicField(this, "resetObservers");
					__publicField(this, "frozen", false);
					__publicField(this, "locked", false);
					__publicField(this, "processMutation", (target, mutation) => {
						if (this.rafStamps.invokeId && this.rafStamps.latestId !== this.rafStamps.invokeId || !this.rafStamps.invokeId) this.rafStamps.invokeId = this.rafStamps.latestId;
						if (!this.pendingCanvasMutations.has(target)) this.pendingCanvasMutations.set(target, []);
						this.pendingCanvasMutations.get(target).push(mutation);
					});
					const { sampling = "all", win, blockClass, blockSelector, recordCanvas, dataURLOptions } = options;
					this.mutationCb = options.mutationCb;
					this.mirror = options.mirror;
					if (recordCanvas && sampling === "all") this.initCanvasMutationObserver(win, blockClass, blockSelector);
					if (recordCanvas && typeof sampling === "number") this.initCanvasFPSObserver(sampling, win, blockClass, blockSelector, { dataURLOptions });
				}
				reset() {
					this.pendingCanvasMutations.clear();
					this.resetObservers && this.resetObservers();
				}
				freeze() {
					this.frozen = true;
				}
				unfreeze() {
					this.frozen = false;
				}
				lock() {
					this.locked = true;
				}
				unlock() {
					this.locked = false;
				}
				initCanvasFPSObserver(fps, win, blockClass, blockSelector, options) {
					const canvasContextReset = initCanvasContextObserver(win, blockClass, blockSelector, true);
					const snapshotInProgressMap = /* @__PURE__ */ new Map();
					const worker = new WorkerWrapper();
					worker.onmessage = (e2) => {
						const { id } = e2.data;
						snapshotInProgressMap.set(id, false);
						if (!("base64" in e2.data)) return;
						const { base64, type, width, height } = e2.data;
						this.mutationCb({
							id,
							type: CanvasContext["2D"],
							commands: [{
								property: "clearRect",
								args: [
									0,
									0,
									width,
									height
								]
							}, {
								property: "drawImage",
								args: [
									{
										rr_type: "ImageBitmap",
										args: [{
											rr_type: "Blob",
											data: [{
												rr_type: "ArrayBuffer",
												base64
											}],
											type
										}]
									},
									0,
									0
								]
							}]
						});
					};
					const timeBetweenSnapshots = 1e3 / fps;
					let lastSnapshotTime = 0;
					let rafId;
					const getCanvas = () => {
						const matchedCanvas = [];
						win.document.querySelectorAll("canvas").forEach((canvas) => {
							if (!isBlocked(canvas, blockClass, blockSelector, true)) matchedCanvas.push(canvas);
						});
						return matchedCanvas;
					};
					const takeCanvasSnapshots = (timestamp) => {
						if (lastSnapshotTime && timestamp - lastSnapshotTime < timeBetweenSnapshots) {
							rafId = requestAnimationFrame(takeCanvasSnapshots);
							return;
						}
						lastSnapshotTime = timestamp;
						getCanvas().forEach(async (canvas) => {
							var _a2;
							const id = this.mirror.getId(canvas);
							if (snapshotInProgressMap.get(id)) return;
							if (canvas.width === 0 || canvas.height === 0) return;
							snapshotInProgressMap.set(id, true);
							if (["webgl", "webgl2"].includes(canvas.__context)) {
								const context = canvas.getContext(canvas.__context);
								if (((_a2 = context == null ? void 0 : context.getContextAttributes()) == null ? void 0 : _a2.preserveDrawingBuffer) === false) context.clear(context.COLOR_BUFFER_BIT);
							}
							const bitmap = await createImageBitmap(canvas);
							worker.postMessage({
								id,
								bitmap,
								width: canvas.width,
								height: canvas.height,
								dataURLOptions: options.dataURLOptions
							}, [bitmap]);
						});
						rafId = requestAnimationFrame(takeCanvasSnapshots);
					};
					rafId = requestAnimationFrame(takeCanvasSnapshots);
					this.resetObservers = () => {
						canvasContextReset();
						cancelAnimationFrame(rafId);
					};
				}
				initCanvasMutationObserver(win, blockClass, blockSelector) {
					this.startRAFTimestamping();
					this.startPendingCanvasMutationFlusher();
					const canvasContextReset = initCanvasContextObserver(win, blockClass, blockSelector, false);
					const canvas2DReset = initCanvas2DMutationObserver(this.processMutation.bind(this), win, blockClass, blockSelector);
					const canvasWebGL1and2Reset = initCanvasWebGLMutationObserver(this.processMutation.bind(this), win, blockClass, blockSelector);
					this.resetObservers = () => {
						canvasContextReset();
						canvas2DReset();
						canvasWebGL1and2Reset();
					};
				}
				startPendingCanvasMutationFlusher() {
					requestAnimationFrame(() => this.flushPendingCanvasMutations());
				}
				startRAFTimestamping() {
					const setLatestRAFTimestamp = (timestamp) => {
						this.rafStamps.latestId = timestamp;
						requestAnimationFrame(setLatestRAFTimestamp);
					};
					requestAnimationFrame(setLatestRAFTimestamp);
				}
				flushPendingCanvasMutations() {
					this.pendingCanvasMutations.forEach((_values, canvas) => {
						const id = this.mirror.getId(canvas);
						this.flushPendingCanvasMutationFor(canvas, id);
					});
					requestAnimationFrame(() => this.flushPendingCanvasMutations());
				}
				flushPendingCanvasMutationFor(canvas, id) {
					if (this.frozen || this.locked) return;
					const valuesWithType = this.pendingCanvasMutations.get(canvas);
					if (!valuesWithType || id === -1) return;
					const values = valuesWithType.map((value) => {
						const { type: type2, ...rest } = value;
						return rest;
					});
					const { type } = valuesWithType[0];
					this.mutationCb({
						id,
						type,
						commands: values
					});
					this.pendingCanvasMutations.delete(canvas);
				}
			};
			StylesheetManager = class {
				constructor(options) {
					__publicField(this, "trackedLinkElements", /* @__PURE__ */ new WeakSet());
					__publicField(this, "mutationCb");
					__publicField(this, "adoptedStyleSheetCb");
					__publicField(this, "styleMirror", new StyleSheetMirror());
					this.mutationCb = options.mutationCb;
					this.adoptedStyleSheetCb = options.adoptedStyleSheetCb;
				}
				attachLinkElement(linkEl, childSn) {
					if ("_cssText" in childSn.attributes) this.mutationCb({
						adds: [],
						removes: [],
						texts: [],
						attributes: [{
							id: childSn.id,
							attributes: childSn.attributes
						}]
					});
					this.trackLinkElement(linkEl);
				}
				trackLinkElement(linkEl) {
					if (this.trackedLinkElements.has(linkEl)) return;
					this.trackedLinkElements.add(linkEl);
					this.trackStylesheetInLinkElement(linkEl);
				}
				adoptStyleSheets(sheets, hostId) {
					if (sheets.length === 0) return;
					const adoptedStyleSheetData = {
						id: hostId,
						styleIds: []
					};
					const styles = [];
					for (const sheet of sheets) {
						let styleId;
						if (!this.styleMirror.has(sheet)) {
							styleId = this.styleMirror.add(sheet);
							styles.push({
								styleId,
								rules: Array.from(sheet.rules || CSSRule, (r2, index2) => ({
									rule: stringifyRule(r2, sheet.href),
									index: index2
								}))
							});
						} else styleId = this.styleMirror.getId(sheet);
						adoptedStyleSheetData.styleIds.push(styleId);
					}
					if (styles.length > 0) adoptedStyleSheetData.styles = styles;
					this.adoptedStyleSheetCb(adoptedStyleSheetData);
				}
				reset() {
					this.styleMirror.reset();
					this.trackedLinkElements = /* @__PURE__ */ new WeakSet();
				}
				trackStylesheetInLinkElement(_linkEl) {}
			};
			ProcessedNodeManager = class {
				constructor() {
					__publicField(this, "nodeMap", /* @__PURE__ */ new WeakMap());
					__publicField(this, "active", false);
				}
				inOtherBuffer(node2, thisBuffer) {
					const buffers = this.nodeMap.get(node2);
					return buffers && Array.from(buffers).some((buffer) => buffer !== thisBuffer);
				}
				add(node2, buffer) {
					if (!this.active) {
						this.active = true;
						requestAnimationFrame(() => {
							this.nodeMap = /* @__PURE__ */ new WeakMap();
							this.active = false;
						});
					}
					this.nodeMap.set(node2, (this.nodeMap.get(node2) || /* @__PURE__ */ new Set()).add(buffer));
				}
				destroy() {}
			};
			recording = false;
			try {
				if (Array.from([1], (x) => x * 2)[0] !== 2) {
					const cleanFrame = document.createElement("iframe");
					document.body.appendChild(cleanFrame);
					Array.from = ((_a = cleanFrame.contentWindow) == null ? void 0 : _a.Array.from) || Array.from;
					document.body.removeChild(cleanFrame);
				}
			} catch (err) {
				console.debug("Unable to override Array.from", err);
			}
			mirror = createMirror$2();
			record.addCustomEvent = (tag, payload) => {
				if (!recording) throw new Error("please add custom event after start recording");
				wrappedEmit({
					type: EventType.Custom,
					data: {
						tag,
						payload
					}
				});
			};
			record.addAnnotation = (annotation) => {
				if (!recording) throw new Error("please add annotation after recording started");
				wrappedEmit({
					type: EventType.Annotation,
					data: annotation
				});
			};
			record.freezePage = () => {
				canvasManager.freeze();
				mutationBuffers.forEach((buf) => buf.freeze());
			};
			record.takeFullSnapshot = (isCheckout) => {
				if (!recording) throw new Error("please take full snapshot after start recording");
				takeFullSnapshot$1(isCheckout);
			};
			record.mirror = mirror;
			Timer = class {
				constructor(actions = [], config) {
					__publicField(this, "timeOffset", 0);
					__publicField(this, "speed");
					__publicField(this, "actions");
					__publicField(this, "raf", null);
					__publicField(this, "lastTimestamp");
					this.actions = actions;
					this.speed = config.speed;
				}
				/**
				* Add an action, possibly after the timer starts.
				*/
				addAction(action) {
					const rafWasActive = this.raf === true;
					if (!this.actions.length || this.actions[this.actions.length - 1].delay <= action.delay) this.actions.push(action);
					else {
						const index2 = this.findActionIndex(action);
						this.actions.splice(index2, 0, action);
					}
					if (rafWasActive) this.raf = requestAnimationFrame(this.rafCheck.bind(this));
				}
				start() {
					this.timeOffset = 0;
					this.lastTimestamp = performance.now();
					this.raf = requestAnimationFrame(this.rafCheck.bind(this));
				}
				updateLiveTime() {
					if (this.raf === true) this.rafCheck();
				}
				rafCheck() {
					const time = performance.now();
					this.timeOffset += (time - this.lastTimestamp) * this.speed;
					this.lastTimestamp = time;
					while (this.actions.length) {
						const action = this.actions[0];
						if (this.timeOffset >= action.delay) {
							this.actions.shift();
							action.doAction();
						} else break;
					}
					if (this.actions.length > 0) this.raf = requestAnimationFrame(this.rafCheck.bind(this));
					else this.raf = true;
				}
				clear() {
					if (this.raf) {
						if (this.raf !== true) cancelAnimationFrame(this.raf);
						this.raf = null;
					}
					this.actions.length = 0;
				}
				setSpeed(speed) {
					this.speed = speed;
				}
				isActive() {
					return this.raf !== null;
				}
				findActionIndex(action) {
					let start = 0;
					let end = this.actions.length - 1;
					while (start <= end) {
						const mid = Math.floor((start + end) / 2);
						if (this.actions[mid].delay < action.delay) start = mid + 1;
						else if (this.actions[mid].delay > action.delay) end = mid - 1;
						else return mid + 1;
					}
					return start;
				}
			};
			(function(t2) {
				t2[t2.NotStarted = 0] = "NotStarted", t2[t2.Running = 1] = "Running", t2[t2.Stopped = 2] = "Stopped";
			})(n || (n = {}));
			e = { type: "xstate.init" };
			l = function(t2, n2) {
				return t2.actions.forEach(function(e2) {
					var r2 = e2.exec;
					return r2 && r2(t2.context, n2);
				});
			};
			rules = (blockClass) => [`.${blockClass} { background: currentColor }`, "noscript { display: none !important; }"];
			webGLVarMap = /* @__PURE__ */ new Map();
			WebGLVariableConstructorsNames = [
				"WebGLActiveInfo",
				"WebGLBuffer",
				"WebGLFramebuffer",
				"WebGLProgram",
				"WebGLRenderbuffer",
				"WebGLShader",
				"WebGLShaderPrecisionFormat",
				"WebGLTexture",
				"WebGLUniformLocation",
				"WebGLVertexArrayObject"
			];
			MediaManager = class {
				constructor(options) {
					__publicField(this, "mediaMap", /* @__PURE__ */ new Map());
					__publicField(this, "warn");
					__publicField(this, "service");
					__publicField(this, "speedService");
					__publicField(this, "emitter");
					__publicField(this, "getCurrentTime");
					__publicField(this, "metadataCallbackMap", /* @__PURE__ */ new Map());
					this.warn = options.warn;
					this.service = options.service;
					this.speedService = options.speedService;
					this.emitter = options.emitter;
					this.getCurrentTime = options.getCurrentTime;
					this.emitter.on(ReplayerEvents.Start, this.start.bind(this));
					this.emitter.on(ReplayerEvents.SkipStart, this.start.bind(this));
					this.emitter.on(ReplayerEvents.Pause, this.pause.bind(this));
					this.emitter.on(ReplayerEvents.Finish, this.pause.bind(this));
					this.speedService.subscribe(() => {
						this.syncAllMediaElements();
					});
				}
				syncAllMediaElements(options = { pause: false }) {
					this.mediaMap.forEach((_mediaState, target) => {
						this.syncTargetWithState(target);
						if (options.pause) target.pause();
					});
				}
				start() {
					this.syncAllMediaElements();
				}
				pause() {
					this.syncAllMediaElements({ pause: true });
				}
				seekTo({ time, target, mediaState }) {
					if (mediaState.isPlaying) {
						const mediaPlaybackOffset = (time - mediaState.lastInteractionTimeOffset) / 1e3 * mediaState.playbackRate;
						const duration = "duration" in target && target.duration;
						if (Number.isNaN(duration)) {
							this.waitForMetadata(target);
							return;
						}
						let seekToTime = mediaState.currentTimeAtLastInteraction + mediaPlaybackOffset;
						if (target.loop && duration !== false) seekToTime = seekToTime % duration;
						target.currentTime = seekToTime;
					} else {
						target.pause();
						target.currentTime = mediaState.currentTimeAtLastInteraction;
					}
				}
				waitForMetadata(target) {
					if (this.metadataCallbackMap.has(target)) return;
					if (!("addEventListener" in target)) return;
					const onLoadedMetadata = () => {
						this.metadataCallbackMap.delete(target);
						const mediaState = this.mediaMap.get(target);
						if (!mediaState) return;
						this.seekTo({
							time: this.getCurrentTime(),
							target,
							mediaState
						});
					};
					this.metadataCallbackMap.set(target, onLoadedMetadata);
					target.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
				}
				getMediaStateFromMutation({ target, timeOffset, mutation }) {
					const lastState = this.mediaMap.get(target);
					const { type, playbackRate, currentTime, muted, volume, loop } = mutation;
					return {
						isPlaying: type === MediaInteractions.Play || type !== MediaInteractions.Pause && ((lastState == null ? void 0 : lastState.isPlaying) || target.getAttribute("autoplay") !== null),
						currentTimeAtLastInteraction: currentTime ?? (lastState == null ? void 0 : lastState.currentTimeAtLastInteraction) ?? 0,
						lastInteractionTimeOffset: timeOffset,
						playbackRate: playbackRate ?? (lastState == null ? void 0 : lastState.playbackRate) ?? 1,
						volume: volume ?? (lastState == null ? void 0 : lastState.volume) ?? 1,
						muted: muted ?? (lastState == null ? void 0 : lastState.muted) ?? target.getAttribute("muted") === null,
						loop: loop ?? (lastState == null ? void 0 : lastState.loop) ?? target.getAttribute("loop") === null
					};
				}
				syncTargetWithState(target) {
					const mediaState = this.mediaMap.get(target);
					if (!mediaState) return;
					const { muted, loop, volume, isPlaying } = mediaState;
					const playerIsPaused = this.service.state.matches("paused");
					const playbackRate = mediaState.playbackRate * this.speedService.state.context.timer.speed;
					try {
						this.seekTo({
							time: this.getCurrentTime(),
							target,
							mediaState
						});
						if (target.volume !== volume) target.volume = volume;
						target.muted = muted;
						target.loop = loop;
						if (target.playbackRate !== playbackRate) target.playbackRate = playbackRate;
						if (isPlaying && !playerIsPaused) target.play();
						else target.pause();
					} catch (error) {
						this.warn(`Failed to replay media interactions: ${error.message || error}`);
					}
				}
				addMediaElements(node2, timeOffset, mirror2) {
					if (!["AUDIO", "VIDEO"].includes(node2.nodeName)) return;
					const target = node2;
					const serializedNode = mirror2.getMeta(target);
					if (!serializedNode || !("attributes" in serializedNode)) return;
					const playerIsPaused = this.service.state.matches("paused");
					const mediaAttributes = serializedNode.attributes;
					let isPlaying = false;
					if (mediaAttributes.rr_mediaState) isPlaying = mediaAttributes.rr_mediaState === "played";
					else isPlaying = target.getAttribute("autoplay") !== null;
					if (isPlaying && playerIsPaused) target.pause();
					let playbackRate = 1;
					if (typeof mediaAttributes.rr_mediaPlaybackRate === "number") playbackRate = mediaAttributes.rr_mediaPlaybackRate;
					let muted = false;
					if (typeof mediaAttributes.rr_mediaMuted === "boolean") muted = mediaAttributes.rr_mediaMuted;
					else muted = target.getAttribute("muted") !== null;
					let loop = false;
					if (typeof mediaAttributes.rr_mediaLoop === "boolean") loop = mediaAttributes.rr_mediaLoop;
					else loop = target.getAttribute("loop") !== null;
					let volume = 1;
					if (typeof mediaAttributes.rr_mediaVolume === "number") volume = mediaAttributes.rr_mediaVolume;
					let currentTimeAtLastInteraction = 0;
					if (typeof mediaAttributes.rr_mediaCurrentTime === "number") currentTimeAtLastInteraction = mediaAttributes.rr_mediaCurrentTime;
					this.mediaMap.set(target, {
						isPlaying,
						currentTimeAtLastInteraction,
						lastInteractionTimeOffset: timeOffset,
						playbackRate,
						volume,
						muted,
						loop
					});
					this.syncTargetWithState(target);
				}
				mediaMutation({ target, timeOffset, mutation }) {
					this.mediaMap.set(target, this.getMediaStateFromMutation({
						target,
						timeOffset,
						mutation
					}));
					this.syncTargetWithState(target);
				}
				isSupportedMediaElement(node2) {
					return ["AUDIO", "VIDEO"].includes(node2.nodeName);
				}
				reset() {
					this.mediaMap.clear();
				}
			};
			SKIP_TIME_INTERVAL = 5 * 1e3;
			mitt = mitt$1;
			REPLAY_CONSOLE_PREFIX = "[replayer]";
			defaultMouseTailConfig = {
				duration: 500,
				lineCap: "round",
				lineWidth: 3,
				strokeStyle: "red"
			};
			Replayer = class {
				constructor(events, config) {
					__publicField(this, "wrapper");
					__publicField(this, "iframe");
					__publicField(this, "UNSAFE_replayCanvas", false);
					__publicField(this, "service");
					__publicField(this, "speedService");
					__publicField(this, "config");
					__publicField(this, "usingVirtualDom", false);
					__publicField(this, "virtualDom", new RRDocument());
					__publicField(this, "mouse");
					__publicField(this, "mouseTail", null);
					__publicField(this, "tailPositions", []);
					__publicField(this, "emitter", mitt());
					__publicField(this, "nextUserInteractionEvent");
					__publicField(this, "legacy_missingNodeRetryMap", {});
					__publicField(this, "cache", createCache());
					__publicField(this, "imageMap", /* @__PURE__ */ new Map());
					__publicField(this, "canvasEventMap", /* @__PURE__ */ new Map());
					__publicField(this, "mirror", createMirror$2());
					__publicField(this, "styleMirror", new StyleSheetMirror());
					__publicField(this, "mediaManager");
					__publicField(this, "firstFullSnapshot", null);
					__publicField(this, "newDocumentQueue", []);
					__publicField(this, "mousePos", null);
					__publicField(this, "touchActive", null);
					__publicField(this, "lastMouseDownEvent", null);
					__publicField(this, "lastHoveredRootNode");
					__publicField(this, "lastSelectionData", null);
					__publicField(this, "constructedStyleMutations", []);
					__publicField(this, "adoptedStyleSheets", []);
					__publicField(this, "handleResize", (dimension) => {
						this.iframe.style.display = "inherit";
						for (const el of [this.mouseTail, this.iframe]) {
							if (!el) continue;
							el.setAttribute("width", String(dimension.width));
							el.setAttribute("height", String(dimension.height));
						}
					});
					__publicField(this, "applyEventsSynchronously", (events) => {
						for (const event of events) {
							switch (event.type) {
								case EventType.DomContentLoaded:
								case EventType.Load: continue;
								case EventType.FullSnapshot:
								case EventType.Meta:
								case EventType.Plugin:
								case EventType.IncrementalSnapshot: break;
							}
							this.getCastFn(event, true)();
						}
					});
					__publicField(this, "getCastFn", (event, isSync = false) => {
						let castFn;
						switch (event.type) {
							case EventType.DomContentLoaded:
							case EventType.Load: break;
							case EventType.Annotation:
								castFn = () => this.emitter.emit(ReplayerEvents.Annotation, event);
								break;
							case EventType.Custom:
								castFn = () => {
									this.emitter.emit(ReplayerEvents.CustomEvent, event);
								};
								break;
							case EventType.Meta:
								castFn = () => this.emitter.emit(ReplayerEvents.Resize, {
									width: event.data.width,
									height: event.data.height
								});
								break;
							case EventType.FullSnapshot:
								castFn = () => {
									var _a2;
									if (this.firstFullSnapshot) {
										if (this.firstFullSnapshot === event) {
											this.firstFullSnapshot = true;
											return;
										}
									} else this.firstFullSnapshot = true;
									this.mediaManager.reset();
									this.styleMirror.reset();
									this.rebuildFullSnapshot(event, isSync);
									(_a2 = this.iframe.contentWindow) == null || _a2.scrollTo(event.data.initialOffset);
								};
								break;
							case EventType.IncrementalSnapshot:
								castFn = () => {
									this.applyIncremental(event, isSync);
									if (isSync) return;
									if (event === this.nextUserInteractionEvent) {
										this.nextUserInteractionEvent = null;
										this.backToNormal();
									}
									if (this.config.skipInactive && !this.nextUserInteractionEvent) {
										for (const _event of this.service.state.context.events) {
											if (_event.timestamp <= event.timestamp) continue;
											if (this.isUserInteraction(_event)) {
												if (_event.delay - event.delay > this.config.inactivePeriodThreshold * this.speedService.state.context.timer.speed) this.nextUserInteractionEvent = _event;
												break;
											}
										}
										if (this.nextUserInteractionEvent) {
											const skipTime = this.nextUserInteractionEvent.delay - event.delay;
											const payload = { speed: Math.min(Math.round(skipTime / SKIP_TIME_INTERVAL), this.config.maxSpeed) };
											this.speedService.send({
												type: "FAST_FORWARD",
												payload
											});
											this.emitter.emit(ReplayerEvents.SkipStart, payload);
										}
									}
								};
								break;
						}
						const wrappedCastFn = () => {
							if (castFn) castFn();
							for (const plugin of this.config.plugins || []) if (plugin.handler) plugin.handler(event, isSync, { replayer: this });
							this.service.send({
								type: "CAST_EVENT",
								payload: { event }
							});
							const lastIndex = this.service.state.context.events.length - 1;
							if (!this.config.liveMode && event === this.service.state.context.events[lastIndex]) {
								const finish = () => {
									if (lastIndex < this.service.state.context.events.length - 1) return;
									this.backToNormal();
									this.service.send("END");
									this.emitter.emit(ReplayerEvents.Finish);
								};
								let finishBuffer = 50;
								if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.MouseMove && event.data.positions.length) finishBuffer += Math.max(0, -event.data.positions[0].timeOffset);
								setTimeout(finish, finishBuffer);
							}
							this.emitter.emit(ReplayerEvents.EventCast, event);
						};
						return wrappedCastFn;
					});
					if (!(config == null ? void 0 : config.liveMode) && events.length < 2) throw new Error("Replayer need at least 2 events.");
					const defaultConfig = {
						speed: 1,
						maxSpeed: 360,
						root: document.body,
						loadTimeout: 0,
						skipInactive: false,
						inactivePeriodThreshold: 10 * 1e3,
						showWarning: true,
						showDebug: false,
						blockClass: "rr-block",
						liveMode: false,
						insertStyleRules: [],
						triggerFocus: true,
						UNSAFE_replayCanvas: false,
						pauseAnimation: true,
						mouseTail: defaultMouseTailConfig,
						useVirtualDom: true,
						logger: console
					};
					this.config = Object.assign({}, defaultConfig, config);
					this.handleResize = this.handleResize.bind(this);
					this.getCastFn = this.getCastFn.bind(this);
					this.applyEventsSynchronously = this.applyEventsSynchronously.bind(this);
					this.emitter.on(ReplayerEvents.Resize, this.handleResize);
					this.setupDom();
					for (const plugin of this.config.plugins || []) if (plugin.getMirror) plugin.getMirror({ nodeMirror: this.mirror });
					this.emitter.on(ReplayerEvents.Flush, () => {
						if (this.usingVirtualDom) {
							const replayerHandler = {
								mirror: this.mirror,
								applyCanvas: (canvasEvent, canvasMutationData, target) => {
									canvasMutation({
										event: canvasEvent,
										mutation: canvasMutationData,
										target,
										imageMap: this.imageMap,
										canvasEventMap: this.canvasEventMap,
										errorHandler: this.warnCanvasMutationFailed.bind(this)
									});
								},
								applyInput: this.applyInput.bind(this),
								applyScroll: this.applyScroll.bind(this),
								applyStyleSheetMutation: (data, styleSheet) => {
									if (data.source === IncrementalSource.StyleSheetRule) this.applyStyleSheetRule(data, styleSheet);
									else if (data.source === IncrementalSource.StyleDeclaration) this.applyStyleDeclaration(data, styleSheet);
								},
								afterAppend: (node2, id) => {
									for (const plugin of this.config.plugins || []) if (plugin.onBuild) plugin.onBuild(node2, {
										id,
										replayer: this
									});
								}
							};
							if (this.iframe.contentDocument) try {
								diff(this.iframe.contentDocument, this.virtualDom, replayerHandler, this.virtualDom.mirror);
							} catch (e2) {
								this.warn(e2);
							}
							this.virtualDom.destroyTree();
							this.usingVirtualDom = false;
							if (Object.keys(this.legacy_missingNodeRetryMap).length) for (const key in this.legacy_missingNodeRetryMap) try {
								const value = this.legacy_missingNodeRetryMap[key];
								const realNode = createOrGetNode(value.node, this.mirror, this.virtualDom.mirror);
								diff(realNode, value.node, replayerHandler, this.virtualDom.mirror);
								value.node = realNode;
							} catch (error) {
								this.warn(error);
							}
							this.constructedStyleMutations.forEach((data) => {
								this.applyStyleSheetMutation(data);
							});
							this.constructedStyleMutations = [];
							this.adoptedStyleSheets.forEach((data) => {
								this.applyAdoptedStyleSheet(data);
							});
							this.adoptedStyleSheets = [];
						}
						if (this.mousePos) {
							this.moveAndHover(this.mousePos.x, this.mousePos.y, this.mousePos.id, true, this.mousePos.debugData);
							this.mousePos = null;
						}
						if (this.touchActive === true) this.mouse.classList.add("touch-active");
						else if (this.touchActive === false) this.mouse.classList.remove("touch-active");
						this.touchActive = null;
						if (this.lastMouseDownEvent) {
							const [target, event] = this.lastMouseDownEvent;
							target.dispatchEvent(event);
						}
						this.lastMouseDownEvent = null;
						if (this.lastSelectionData) {
							this.applySelection(this.lastSelectionData);
							this.lastSelectionData = null;
						}
					});
					this.emitter.on(ReplayerEvents.PlayBack, () => {
						this.firstFullSnapshot = null;
						this.mirror.reset();
						this.styleMirror.reset();
						this.mediaManager.reset();
					});
					const timer = new Timer([], { speed: this.config.speed });
					this.service = createPlayerService({
						events: events.map((e2) => {
							if (config && config.unpackFn) return config.unpackFn(e2);
							return e2;
						}).sort((a1, a2) => a1.timestamp - a2.timestamp),
						timer,
						timeOffset: 0,
						baselineTime: 0,
						lastPlayedEvent: null
					}, {
						getCastFn: this.getCastFn,
						applyEventsSynchronously: this.applyEventsSynchronously,
						emitter: this.emitter
					});
					this.service.start();
					this.service.subscribe((state) => {
						this.emitter.emit(ReplayerEvents.StateChange, { player: state });
					});
					this.speedService = createSpeedService({
						normalSpeed: -1,
						timer
					});
					this.speedService.start();
					this.speedService.subscribe((state) => {
						this.emitter.emit(ReplayerEvents.StateChange, { speed: state });
					});
					this.mediaManager = new MediaManager({
						warn: this.warn.bind(this),
						service: this.service,
						speedService: this.speedService,
						emitter: this.emitter,
						getCurrentTime: this.getCurrentTime.bind(this)
					});
					const firstMeta = this.service.state.context.events.find((e2) => e2.type === EventType.Meta);
					const firstFullsnapshot = this.service.state.context.events.find((e2) => e2.type === EventType.FullSnapshot);
					if (firstMeta) {
						const { width, height } = firstMeta.data;
						setTimeout(() => {
							this.emitter.emit(ReplayerEvents.Resize, {
								width,
								height
							});
						}, 0);
					}
					if (firstFullsnapshot) setTimeout(() => {
						var _a2;
						if (this.firstFullSnapshot) return;
						this.firstFullSnapshot = firstFullsnapshot;
						this.rebuildFullSnapshot(firstFullsnapshot);
						(_a2 = this.iframe.contentWindow) == null || _a2.scrollTo(firstFullsnapshot.data.initialOffset);
					}, 1);
					if (this.service.state.context.events.find(indicatesTouchDevice)) this.mouse.classList.add("touch-device");
				}
				get timer() {
					return this.service.state.context.timer;
				}
				on(event, handler) {
					this.emitter.on(event, handler);
					return this;
				}
				off(event, handler) {
					this.emitter.off(event, handler);
					return this;
				}
				setConfig(config) {
					Object.keys(config).forEach((key) => {
						config[key];
						this.config[key] = config[key];
					});
					if (!this.config.skipInactive) this.backToNormal();
					if (typeof config.speed !== "undefined") this.speedService.send({
						type: "SET_SPEED",
						payload: { speed: config.speed }
					});
					if (typeof config.mouseTail !== "undefined") if (config.mouseTail === false) {
						if (this.mouseTail) this.mouseTail.style.display = "none";
					} else {
						if (!this.mouseTail) {
							this.mouseTail = document.createElement("canvas");
							this.mouseTail.width = Number.parseFloat(this.iframe.width);
							this.mouseTail.height = Number.parseFloat(this.iframe.height);
							this.mouseTail.classList.add("replayer-mouse-tail");
							this.wrapper.insertBefore(this.mouseTail, this.iframe);
						}
						this.mouseTail.style.display = "inherit";
					}
				}
				getMetaData() {
					const firstEvent = this.service.state.context.events[0];
					const lastEvent = this.service.state.context.events[this.service.state.context.events.length - 1];
					return {
						startTime: firstEvent.timestamp,
						endTime: lastEvent.timestamp,
						totalTime: lastEvent.timestamp - firstEvent.timestamp
					};
				}
				/**
				* Get the actual time offset the player is at now compared to the first event.
				*/
				getCurrentTime() {
					if (this.config.liveMode) this.timer.updateLiveTime();
					return this.timer.timeOffset + this.getTimeOffset();
				}
				/**
				* Get the time offset the player is at now compared to the first event, but without regard for the timer.
				*/
				getTimeOffset() {
					const { baselineTime, events } = this.service.state.context;
					return baselineTime - events[0].timestamp;
				}
				getMirror() {
					return this.mirror;
				}
				/**
				* This API was designed to be used as play at any time offset.
				* Since we minimized the data collected from recorder, we do not
				* have the ability of undo an event.
				* So the implementation of play at any time offset will always iterate
				* all of the events, cast event before the offset synchronously
				* and cast event after the offset asynchronously with timer.
				* @param timeOffset - number
				*/
				play(timeOffset = 0) {
					var _a2, _b;
					if (this.service.state.matches("paused")) this.service.send({
						type: "PLAY",
						payload: { timeOffset }
					});
					else {
						this.service.send({ type: "PAUSE" });
						this.service.send({
							type: "PLAY",
							payload: { timeOffset }
						});
					}
					(_b = (_a2 = this.iframe.contentDocument) == null ? void 0 : _a2.getElementsByTagName("html")[0]) == null || _b.classList.remove("rrweb-paused");
					this.emitter.emit(ReplayerEvents.Start);
				}
				pause(timeOffset) {
					var _a2, _b;
					if (timeOffset === void 0 && this.service.state.matches("playing")) this.service.send({ type: "PAUSE" });
					if (typeof timeOffset === "number") {
						this.play(timeOffset);
						this.service.send({ type: "PAUSE" });
					}
					(_b = (_a2 = this.iframe.contentDocument) == null ? void 0 : _a2.getElementsByTagName("html")[0]) == null || _b.classList.add("rrweb-paused");
					this.emitter.emit(ReplayerEvents.Pause);
				}
				resume(timeOffset = 0) {
					this.warn(`The 'resume' was deprecated in 1.0. Please use 'play' method which has the same interface.`);
					this.play(timeOffset);
					this.emitter.emit(ReplayerEvents.Resume);
				}
				/**
				* Totally destroy this replayer and please be careful that this operation is irreversible.
				* Memory occupation can be released by removing all references to this replayer.
				*/
				destroy() {
					this.pause();
					this.mirror.reset();
					this.styleMirror.reset();
					this.mediaManager.reset();
					this.config.root.removeChild(this.wrapper);
					this.emitter.emit(ReplayerEvents.Destroy);
				}
				startLive(baselineTime) {
					this.service.send({
						type: "TO_LIVE",
						payload: { baselineTime }
					});
				}
				addEvent(rawEvent) {
					const event = this.config.unpackFn ? this.config.unpackFn(rawEvent) : rawEvent;
					if (indicatesTouchDevice(event)) this.mouse.classList.add("touch-device");
					Promise.resolve().then(() => this.service.send({
						type: "ADD_EVENT",
						payload: { event }
					}));
				}
				enableInteract() {
					this.iframe.setAttribute("scrolling", "auto");
					this.iframe.style.pointerEvents = "auto";
				}
				disableInteract() {
					this.iframe.setAttribute("scrolling", "no");
					this.iframe.style.pointerEvents = "none";
				}
				/**
				* Empties the replayer's cache and reclaims memory.
				* The replayer will use this cache to speed up the playback.
				*/
				resetCache() {
					this.cache = createCache();
				}
				setupDom() {
					this.wrapper = document.createElement("div");
					this.wrapper.classList.add("replayer-wrapper");
					this.config.root.appendChild(this.wrapper);
					this.mouse = document.createElement("div");
					this.mouse.classList.add("replayer-mouse");
					this.wrapper.appendChild(this.mouse);
					if (this.config.mouseTail !== false) {
						this.mouseTail = document.createElement("canvas");
						this.mouseTail.classList.add("replayer-mouse-tail");
						this.mouseTail.style.display = "inherit";
						this.wrapper.appendChild(this.mouseTail);
					}
					if (this.config.UNSAFE_replayCanvas) {
						this.iframe = document.createElement("iframe");
						this.iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
						this.wrapper.appendChild(this.iframe);
						this.UNSAFE_replayCanvas = true;
					} else {
						this.iframe = createSandboxedIframe({ root: this.wrapper });
						this.UNSAFE_replayCanvas = false;
					}
					this.iframe.style.display = "none";
					this.disableInteract();
					if (this.iframe.contentWindow && this.iframe.contentDocument) {
						polyfill(this.iframe.contentWindow, this.iframe.contentDocument);
						polyfill$1(this.iframe.contentWindow);
					}
				}
				rebuildFullSnapshot(event, isSync = false) {
					if (!this.iframe.contentDocument) return this.warn("Looks like your replayer has been destroyed.");
					if (Object.keys(this.legacy_missingNodeRetryMap).length) this.warn("Found unresolved missing node map", this.legacy_missingNodeRetryMap);
					this.legacy_missingNodeRetryMap = {};
					const collectedIframes = [];
					const collectedDialogs = /* @__PURE__ */ new Set();
					const afterAppend = (builtNode, id) => {
						if (builtNode.nodeName === "DIALOG") collectedDialogs.add(builtNode);
						this.collectIframeAndAttachDocument(collectedIframes, builtNode);
						if (this.mediaManager.isSupportedMediaElement(builtNode)) {
							const { events } = this.service.state.context;
							this.mediaManager.addMediaElements(builtNode, event.timestamp - events[0].timestamp, this.mirror);
						}
						for (const plugin of this.config.plugins || []) if (plugin.onBuild) plugin.onBuild(builtNode, {
							id,
							replayer: this
						});
					};
					if (this.usingVirtualDom) {
						this.virtualDom.destroyTree();
						this.usingVirtualDom = false;
					}
					this.mirror.reset();
					rebuild(event.data.node, {
						doc: this.iframe.contentDocument,
						afterAppend,
						cache: this.cache,
						mirror: this.mirror,
						UNSAFE_allowUnprotectedRebuild: this.UNSAFE_replayCanvas
					});
					afterAppend(this.iframe.contentDocument, event.data.node.id);
					for (const { mutationInQueue, builtNode } of collectedIframes) {
						this.attachDocumentToIframe(mutationInQueue, builtNode);
						this.newDocumentQueue = this.newDocumentQueue.filter((m) => m !== mutationInQueue);
					}
					const { documentElement, head } = this.iframe.contentDocument;
					this.insertStyleRules(documentElement, head);
					collectedDialogs.forEach((d) => applyDialogToTopLevel(d));
					if (!this.service.state.matches("playing")) this.iframe.contentDocument.getElementsByTagName("html")[0].classList.add("rrweb-paused");
					this.emitter.emit(ReplayerEvents.FullsnapshotRebuilded, event);
					if (!isSync) this.waitForStylesheetLoad();
					if (this.config.UNSAFE_replayCanvas) this.preloadAllImages();
				}
				insertStyleRules(documentElement, head) {
					var _a2;
					const injectStylesRules = rules(this.config.blockClass).concat(this.config.insertStyleRules);
					if (this.config.pauseAnimation) injectStylesRules.push("html.rrweb-paused *, html.rrweb-paused *:before, html.rrweb-paused *:after { animation-play-state: paused !important; }");
					if (!injectStylesRules.length) return;
					if (this.usingVirtualDom) {
						const styleEl = this.virtualDom.createElement("style");
						this.virtualDom.mirror.add(styleEl, getDefaultSN(styleEl, this.virtualDom.unserializedId));
						documentElement.insertBefore(styleEl, head);
						styleEl.rules.push({
							source: IncrementalSource.StyleSheetRule,
							adds: injectStylesRules.map((cssText, index2) => ({
								rule: cssText,
								index: index2
							}))
						});
					} else {
						const styleEl = document.createElement("style");
						documentElement.insertBefore(styleEl, head);
						for (let idx = 0; idx < injectStylesRules.length; idx++) (_a2 = styleEl.sheet) == null || _a2.insertRule(injectStylesRules[idx], idx);
					}
				}
				attachDocumentToIframe(mutation, iframeEl) {
					const mirror2 = this.usingVirtualDom ? this.virtualDom.mirror : this.mirror;
					const collectedIframes = [];
					const collectedDialogs = /* @__PURE__ */ new Set();
					const afterAppend = (builtNode, id) => {
						if (builtNode.nodeName === "DIALOG") collectedDialogs.add(builtNode);
						this.collectIframeAndAttachDocument(collectedIframes, builtNode);
						const sn = mirror2.getMeta(builtNode);
						if ((sn == null ? void 0 : sn.type) === NodeType.Element && (sn == null ? void 0 : sn.tagName.toUpperCase()) === "HTML") {
							const { documentElement, head } = iframeEl.contentDocument;
							this.insertStyleRules(documentElement, head);
						}
						if (this.usingVirtualDom) return;
						for (const plugin of this.config.plugins || []) if (plugin.onBuild) plugin.onBuild(builtNode, {
							id,
							replayer: this
						});
					};
					buildNodeWithSN(mutation.node, {
						doc: iframeEl.contentDocument,
						mirror: mirror2,
						hackCss: true,
						skipChild: false,
						afterAppend,
						cache: this.cache
					});
					afterAppend(iframeEl.contentDocument, mutation.node.id);
					for (const { mutationInQueue, builtNode } of collectedIframes) {
						this.attachDocumentToIframe(mutationInQueue, builtNode);
						this.newDocumentQueue = this.newDocumentQueue.filter((m) => m !== mutationInQueue);
					}
					collectedDialogs.forEach((d) => applyDialogToTopLevel(d));
				}
				collectIframeAndAttachDocument(collected, builtNode) {
					if (isSerializedIframe(builtNode, this.mirror)) {
						const mutationInQueue = this.newDocumentQueue.find((m) => m.parentId === this.mirror.getId(builtNode));
						if (mutationInQueue) collected.push({
							mutationInQueue,
							builtNode
						});
					}
				}
				/**
				* pause when loading style sheet, resume when loaded all timeout exceed
				*/
				waitForStylesheetLoad() {
					var _a2;
					const head = (_a2 = this.iframe.contentDocument) == null ? void 0 : _a2.head;
					if (head) {
						const unloadSheets = /* @__PURE__ */ new Set();
						let timer;
						let beforeLoadState = this.service.state;
						const stateHandler = () => {
							beforeLoadState = this.service.state;
						};
						this.emitter.on(ReplayerEvents.Start, stateHandler);
						this.emitter.on(ReplayerEvents.Pause, stateHandler);
						const unsubscribe = () => {
							this.emitter.off(ReplayerEvents.Start, stateHandler);
							this.emitter.off(ReplayerEvents.Pause, stateHandler);
						};
						head.querySelectorAll("link[rel=\"stylesheet\"]").forEach((css) => {
							if (!css.sheet) {
								unloadSheets.add(css);
								css.addEventListener("load", () => {
									unloadSheets.delete(css);
									if (unloadSheets.size === 0 && timer !== -1) {
										if (beforeLoadState.matches("playing")) this.play(this.getCurrentTime());
										this.emitter.emit(ReplayerEvents.LoadStylesheetEnd);
										if (timer) clearTimeout(timer);
										unsubscribe();
									}
								});
							}
						});
						if (unloadSheets.size > 0) {
							this.service.send({ type: "PAUSE" });
							this.emitter.emit(ReplayerEvents.LoadStylesheetStart);
							timer = setTimeout(() => {
								if (beforeLoadState.matches("playing")) this.play(this.getCurrentTime());
								timer = -1;
								unsubscribe();
							}, this.config.loadTimeout);
						}
					}
				}
				/**
				* pause when there are some canvas drawImage args need to be loaded
				*/
				async preloadAllImages() {
					const promises = [];
					for (const event of this.service.state.context.events) if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.CanvasMutation) {
						promises.push(this.deserializeAndPreloadCanvasEvents(event.data, event));
						("commands" in event.data ? event.data.commands : [event.data]).forEach((c2) => {
							this.preloadImages(c2, event);
						});
					}
					return Promise.all(promises);
				}
				preloadImages(data, event) {
					if (data.property === "drawImage" && typeof data.args[0] === "string" && !this.imageMap.has(event)) {
						const canvas = document.createElement("canvas");
						const ctx = canvas.getContext("2d");
						const imgd = ctx == null ? void 0 : ctx.createImageData(canvas.width, canvas.height);
						ctx?.putImageData(imgd, 0, 0);
					}
				}
				async deserializeAndPreloadCanvasEvents(data, event) {
					if (!this.canvasEventMap.has(event)) {
						const status = { isUnchanged: true };
						if ("commands" in data) {
							const commands = await Promise.all(data.commands.map(async (c2) => {
								const args = await Promise.all(c2.args.map(deserializeArg(this.imageMap, null, status)));
								return {
									...c2,
									args
								};
							}));
							if (status.isUnchanged === false) this.canvasEventMap.set(event, {
								...data,
								commands
							});
						} else {
							const args = await Promise.all(data.args.map(deserializeArg(this.imageMap, null, status)));
							if (status.isUnchanged === false) this.canvasEventMap.set(event, {
								...data,
								args
							});
						}
					}
				}
				applyIncremental(e2, isSync) {
					var _a2, _b, _c;
					const { data: d } = e2;
					switch (d.source) {
						case IncrementalSource.Mutation:
							try {
								this.applyMutation(d, isSync);
							} catch (error) {
								this.warn(`Exception in mutation ${error.message || error}`, d);
							}
							break;
						case IncrementalSource.Drag:
						case IncrementalSource.TouchMove:
						case IncrementalSource.MouseMove:
							if (isSync) {
								const lastPosition = d.positions[d.positions.length - 1];
								this.mousePos = {
									x: lastPosition.x,
									y: lastPosition.y,
									id: lastPosition.id,
									debugData: d
								};
							} else {
								d.positions.forEach((p) => {
									const action = {
										doAction: () => {
											this.moveAndHover(p.x, p.y, p.id, isSync, d);
										},
										delay: p.timeOffset + e2.timestamp - this.service.state.context.baselineTime
									};
									this.timer.addAction(action);
								});
								this.timer.addAction({
									doAction() {},
									delay: e2.delay - ((_a2 = d.positions[0]) == null ? void 0 : _a2.timeOffset)
								});
							}
							break;
						case IncrementalSource.MouseInteraction: {
							if (d.id === -1) break;
							const event = new Event(toLowerCase(MouseInteractions[d.type]));
							const target = this.mirror.getNode(d.id);
							if (!target) return this.debugNodeNotFound(d, d.id);
							this.emitter.emit(ReplayerEvents.MouseInteraction, {
								type: d.type,
								target
							});
							const { triggerFocus } = this.config;
							switch (d.type) {
								case MouseInteractions.Blur:
									if ("blur" in target) target.blur();
									break;
								case MouseInteractions.Focus:
									if (triggerFocus && target.focus) target.focus({ preventScroll: true });
									break;
								case MouseInteractions.Click:
								case MouseInteractions.TouchStart:
								case MouseInteractions.TouchEnd:
								case MouseInteractions.MouseDown:
								case MouseInteractions.MouseUp:
									if (isSync) {
										if (d.type === MouseInteractions.TouchStart) this.touchActive = true;
										else if (d.type === MouseInteractions.TouchEnd) this.touchActive = false;
										if (d.type === MouseInteractions.MouseDown) this.lastMouseDownEvent = [target, event];
										else if (d.type === MouseInteractions.MouseUp) this.lastMouseDownEvent = null;
										this.mousePos = {
											x: d.x || 0,
											y: d.y || 0,
											id: d.id,
											debugData: d
										};
									} else {
										if (d.type === MouseInteractions.TouchStart) this.tailPositions.length = 0;
										this.moveAndHover(d.x || 0, d.y || 0, d.id, isSync, d);
										if (d.type === MouseInteractions.Click) {
											this.mouse.classList.remove("active");
											this.mouse.offsetWidth;
											this.mouse.classList.add("active");
										} else if (d.type === MouseInteractions.TouchStart) {
											this.mouse.offsetWidth;
											this.mouse.classList.add("touch-active");
										} else if (d.type === MouseInteractions.TouchEnd) this.mouse.classList.remove("touch-active");
										else target.dispatchEvent(event);
									}
									break;
								case MouseInteractions.TouchCancel:
									if (isSync) this.touchActive = false;
									else this.mouse.classList.remove("touch-active");
									break;
								default: target.dispatchEvent(event);
							}
							break;
						}
						case IncrementalSource.Scroll:
							if (d.id === -1) break;
							if (this.usingVirtualDom) {
								const target = this.virtualDom.mirror.getNode(d.id);
								if (!target) return this.debugNodeNotFound(d, d.id);
								target.scrollData = d;
								break;
							}
							this.applyScroll(d, isSync);
							break;
						case IncrementalSource.ViewportResize:
							this.emitter.emit(ReplayerEvents.Resize, {
								width: d.width,
								height: d.height
							});
							break;
						case IncrementalSource.Input:
							if (d.id === -1) break;
							if (this.usingVirtualDom) {
								const target = this.virtualDom.mirror.getNode(d.id);
								if (!target) return this.debugNodeNotFound(d, d.id);
								target.inputData = d;
								break;
							}
							this.applyInput(d);
							break;
						case IncrementalSource.MediaInteraction: {
							const target = this.usingVirtualDom ? this.virtualDom.mirror.getNode(d.id) : this.mirror.getNode(d.id);
							if (!target) return this.debugNodeNotFound(d, d.id);
							const mediaEl = target;
							const { events } = this.service.state.context;
							this.mediaManager.mediaMutation({
								target: mediaEl,
								timeOffset: e2.timestamp - events[0].timestamp,
								mutation: d
							});
							break;
						}
						case IncrementalSource.StyleSheetRule:
						case IncrementalSource.StyleDeclaration:
							if (this.usingVirtualDom) {
								if (d.styleId) this.constructedStyleMutations.push(d);
								else if (d.id) (_b = this.virtualDom.mirror.getNode(d.id)) == null || _b.rules.push(d);
							} else this.applyStyleSheetMutation(d);
							break;
						case IncrementalSource.CanvasMutation:
							if (!this.config.UNSAFE_replayCanvas) return;
							if (this.usingVirtualDom) {
								const target = this.virtualDom.mirror.getNode(d.id);
								if (!target) return this.debugNodeNotFound(d, d.id);
								target.canvasMutations.push({
									event: e2,
									mutation: d
								});
							} else {
								const target = this.mirror.getNode(d.id);
								if (!target) return this.debugNodeNotFound(d, d.id);
								canvasMutation({
									event: e2,
									mutation: d,
									target,
									imageMap: this.imageMap,
									canvasEventMap: this.canvasEventMap,
									errorHandler: this.warnCanvasMutationFailed.bind(this)
								});
							}
							break;
						case IncrementalSource.Font:
							try {
								const fontFace = new FontFace(d.family, d.buffer ? new Uint8Array(JSON.parse(d.fontSource)) : d.fontSource, d.descriptors);
								(_c = this.iframe.contentDocument) == null || _c.fonts.add(fontFace);
							} catch (error) {
								this.warn(error);
							}
							break;
						case IncrementalSource.Selection:
							if (isSync) {
								this.lastSelectionData = d;
								break;
							}
							this.applySelection(d);
							break;
						case IncrementalSource.AdoptedStyleSheet:
							if (this.usingVirtualDom) this.adoptedStyleSheets.push(d);
							else this.applyAdoptedStyleSheet(d);
							break;
					}
				}
				/**
				* Apply the mutation to the virtual dom or the real dom.
				* @param d - The mutation data.
				* @param isSync - Whether the mutation should be applied synchronously (while fast-forwarding).
				*/
				applyMutation(d, isSync) {
					if (this.config.useVirtualDom && !this.usingVirtualDom && isSync) {
						this.usingVirtualDom = true;
						buildFromDom(this.iframe.contentDocument, this.mirror, this.virtualDom);
						if (Object.keys(this.legacy_missingNodeRetryMap).length) for (const key in this.legacy_missingNodeRetryMap) try {
							const value = this.legacy_missingNodeRetryMap[key];
							const virtualNode = buildFromNode(value.node, this.virtualDom, this.mirror);
							if (virtualNode) value.node = virtualNode;
						} catch (error) {
							this.warn(error);
						}
					}
					const mirror2 = this.usingVirtualDom ? this.virtualDom.mirror : this.mirror;
					d.removes = d.removes.filter((mutation) => {
						if (!mirror2.getNode(mutation.id)) {
							this.warnNodeNotFound(d, mutation.id);
							return false;
						}
						return true;
					});
					d.removes.forEach((mutation) => {
						var _a2;
						const target = mirror2.getNode(mutation.id);
						if (!target) return;
						let parent = mirror2.getNode(mutation.parentId);
						if (!parent) return this.warnNodeNotFound(d, mutation.parentId);
						if (mutation.isShadow && hasShadowRoot(parent)) parent = parent.shadowRoot;
						mirror2.removeNodeFromMap(target);
						if (parent) try {
							parent.removeChild(target);
							if (this.usingVirtualDom && target.nodeName === "#text" && parent.nodeName === "STYLE" && ((_a2 = parent.rules) == null ? void 0 : _a2.length) > 0) parent.rules = [];
						} catch (error) {
							if (error instanceof DOMException) this.warn("parent could not remove child in mutation", parent, target, d);
							else throw error;
						}
					});
					const legacy_missingNodeMap = { ...this.legacy_missingNodeRetryMap };
					const legacy_queue = [];
					const nextNotInDOM = (mutation) => {
						let next = null;
						if (mutation.nextId) next = mirror2.getNode(mutation.nextId);
						if (mutation.nextId !== null && mutation.nextId !== void 0 && mutation.nextId !== -1 && !next) return true;
						return false;
					};
					const appendNode = (mutation) => {
						var _a2, _b;
						if (!this.iframe.contentDocument) return this.warn("Looks like your replayer has been destroyed.");
						let parent = mirror2.getNode(mutation.parentId);
						if (!parent) {
							if (mutation.node.type === NodeType.Document) return this.newDocumentQueue.push(mutation);
							return legacy_queue.push(mutation);
						}
						if (mutation.node.isShadow) if (!hasShadowRoot(parent)) {
							parent.attachShadow({ mode: "open" });
							parent = parent.shadowRoot;
						} else parent = parent.shadowRoot;
						let previous = null;
						let next = null;
						if (mutation.previousId) previous = mirror2.getNode(mutation.previousId);
						if (mutation.nextId) next = mirror2.getNode(mutation.nextId);
						if (nextNotInDOM(mutation)) return legacy_queue.push(mutation);
						if (mutation.node.rootId && !mirror2.getNode(mutation.node.rootId)) return;
						const targetDoc = mutation.node.rootId ? mirror2.getNode(mutation.node.rootId) : this.usingVirtualDom ? this.virtualDom : this.iframe.contentDocument;
						if (isSerializedIframe(parent, mirror2)) {
							this.attachDocumentToIframe(mutation, parent);
							return;
						}
						const afterAppend = (node2, id) => {
							if (this.usingVirtualDom) return;
							applyDialogToTopLevel(node2);
							for (const plugin of this.config.plugins || []) if (plugin.onBuild) plugin.onBuild(node2, {
								id,
								replayer: this
							});
						};
						const target = buildNodeWithSN(mutation.node, {
							doc: targetDoc,
							mirror: mirror2,
							skipChild: true,
							hackCss: true,
							cache: this.cache,
							/**
							* caveat: `afterAppend` only gets called on child nodes of target
							* we have to call it again below when this target was added to the DOM
							*/
							afterAppend
						});
						if (mutation.previousId === -1 || mutation.nextId === -1) {
							legacy_missingNodeMap[mutation.node.id] = {
								node: target,
								mutation
							};
							return;
						}
						const parentSn = mirror2.getMeta(parent);
						if (parentSn && parentSn.type === NodeType.Element && mutation.node.type === NodeType.Text) {
							const prospectiveSiblings = Array.isArray(parent.childNodes) ? parent.childNodes : Array.from(parent.childNodes);
							if (parentSn.tagName === "textarea") {
								for (const c2 of prospectiveSiblings) if (c2.nodeType === parent.TEXT_NODE) parent.removeChild(c2);
							} else if (parentSn.tagName === "style" && prospectiveSiblings.length === 1) {
								for (const cssText of prospectiveSiblings) if (cssText.nodeType === parent.TEXT_NODE && !mirror2.hasNode(cssText)) {
									target.textContent = cssText.textContent;
									parent.removeChild(cssText);
								}
							}
						} else if ((parentSn == null ? void 0 : parentSn.type) === NodeType.Document) {
							const parentDoc = parent;
							if (mutation.node.type === NodeType.DocumentType && ((_a2 = parentDoc.childNodes[0]) == null ? void 0 : _a2.nodeType) === Node.DOCUMENT_TYPE_NODE) parentDoc.removeChild(parentDoc.childNodes[0]);
							if (target.nodeName === "HTML" && parentDoc.documentElement) parentDoc.removeChild(parentDoc.documentElement);
						}
						if (previous && previous.nextSibling && previous.nextSibling.parentNode) parent.insertBefore(target, previous.nextSibling);
						else if (next && next.parentNode) parent.contains(next) ? parent.insertBefore(target, next) : parent.insertBefore(target, null);
						else parent.appendChild(target);
						afterAppend(target, mutation.node.id);
						if (this.usingVirtualDom && target.nodeName === "#text" && parent.nodeName === "STYLE" && ((_b = parent.rules) == null ? void 0 : _b.length) > 0) parent.rules = [];
						if (isSerializedIframe(target, this.mirror)) {
							const targetId = this.mirror.getId(target);
							const mutationInQueue = this.newDocumentQueue.find((m) => m.parentId === targetId);
							if (mutationInQueue) {
								this.attachDocumentToIframe(mutationInQueue, target);
								this.newDocumentQueue = this.newDocumentQueue.filter((m) => m !== mutationInQueue);
							}
						}
						if (mutation.previousId || mutation.nextId) this.legacy_resolveMissingNode(legacy_missingNodeMap, parent, target, mutation);
					};
					d.adds.forEach((mutation) => {
						appendNode(mutation);
					});
					const startTime = Date.now();
					while (legacy_queue.length) {
						const resolveTrees = queueToResolveTrees(legacy_queue);
						legacy_queue.length = 0;
						if (Date.now() - startTime > 500) {
							this.warn("Timeout in the loop, please check the resolve tree data:", resolveTrees);
							break;
						}
						for (const tree of resolveTrees) if (!mirror2.getNode(tree.value.parentId)) this.debug("Drop resolve tree since there is no parent for the root node.", tree);
						else iterateResolveTree(tree, (mutation) => {
							appendNode(mutation);
						});
					}
					if (Object.keys(legacy_missingNodeMap).length) Object.assign(this.legacy_missingNodeRetryMap, legacy_missingNodeMap);
					uniqueTextMutations(d.texts).forEach((mutation) => {
						var _a2;
						const target = mirror2.getNode(mutation.id);
						if (!target) {
							if (d.removes.find((r2) => r2.id === mutation.id)) return;
							return this.warnNodeNotFound(d, mutation.id);
						}
						const parentEl = target.parentElement;
						if (mutation.value && parentEl && parentEl.tagName === "STYLE") target.textContent = adaptCssForReplay(mutation.value, this.cache);
						else target.textContent = mutation.value;
						if (this.usingVirtualDom) {
							const parent = target.parentNode;
							if (((_a2 = parent == null ? void 0 : parent.rules) == null ? void 0 : _a2.length) > 0) parent.rules = [];
						}
					});
					d.attributes.forEach((mutation) => {
						var _a2;
						const target = mirror2.getNode(mutation.id);
						if (!target) {
							if (d.removes.find((r2) => r2.id === mutation.id)) return;
							return this.warnNodeNotFound(d, mutation.id);
						}
						for (const attributeName in mutation.attributes) if (typeof attributeName === "string") {
							const value = mutation.attributes[attributeName];
							if (value === null) {
								target.removeAttribute(attributeName);
								if (attributeName === "open") removeDialogFromTopLevel(target, mutation);
							} else if (typeof value === "string") try {
								if (attributeName === "_cssText" && (target.nodeName === "LINK" || target.nodeName === "STYLE")) try {
									const newSn = mirror2.getMeta(target);
									const newNode = buildNodeWithSN({
										...newSn,
										attributes: {
											...newSn.attributes,
											...mutation.attributes
										}
									}, {
										doc: target.ownerDocument,
										mirror: mirror2,
										skipChild: true,
										hackCss: true,
										cache: this.cache
									});
									Object.assign(newSn.attributes, mutation.attributes);
									const siblingNode = target.nextSibling;
									const parentNode2 = target.parentNode;
									if (newNode && parentNode2) {
										parentNode2.removeChild(target);
										parentNode2.insertBefore(newNode, siblingNode);
										mirror2.replace(mutation.id, newNode);
										break;
									}
								} catch (e2) {}
								if (attributeName === "value" && target.nodeName === "TEXTAREA") {
									const textarea = target;
									textarea.childNodes.forEach((c2) => textarea.removeChild(c2));
									const tn = (_a2 = target.ownerDocument) == null ? void 0 : _a2.createTextNode(value);
									if (tn) textarea.appendChild(tn);
								} else target.setAttribute(attributeName, value);
								if (attributeName === "rr_open_mode" && target.nodeName === "DIALOG") applyDialogToTopLevel(target, mutation);
							} catch (error) {
								this.warn("An error occurred may due to the checkout feature.", error);
							}
							else if (attributeName === "style") {
								const styleValues = value;
								const targetEl = target;
								for (const s2 in styleValues) if (styleValues[s2] === false) targetEl.style.removeProperty(s2);
								else if (styleValues[s2] instanceof Array) {
									const svp = styleValues[s2];
									targetEl.style.setProperty(s2, svp[0], svp[1]);
								} else {
									const svs = styleValues[s2];
									targetEl.style.setProperty(s2, svs);
								}
							}
						}
					});
				}
				/**
				* Apply the scroll data on real elements.
				* If the replayer is in sync mode, smooth scroll behavior should be disabled.
				* @param d - the scroll data
				* @param isSync - whether the replayer is in sync mode(fast-forward)
				*/
				applyScroll(d, isSync) {
					var _a2, _b;
					const target = this.mirror.getNode(d.id);
					if (!target) return this.debugNodeNotFound(d, d.id);
					const sn = this.mirror.getMeta(target);
					if (target === this.iframe.contentDocument) (_a2 = this.iframe.contentWindow) == null || _a2.scrollTo({
						top: d.y,
						left: d.x,
						behavior: isSync ? "auto" : "smooth"
					});
					else if ((sn == null ? void 0 : sn.type) === NodeType.Document) (_b = target.defaultView) == null || _b.scrollTo({
						top: d.y,
						left: d.x,
						behavior: isSync ? "auto" : "smooth"
					});
					else try {
						target.scrollTo({
							top: d.y,
							left: d.x,
							behavior: isSync ? "auto" : "smooth"
						});
					} catch (error) {}
				}
				applyInput(d) {
					const target = this.mirror.getNode(d.id);
					if (!target) return this.debugNodeNotFound(d, d.id);
					try {
						target.checked = d.isChecked;
						target.value = d.text;
					} catch (error) {}
				}
				applySelection(d) {
					try {
						const selectionSet = /* @__PURE__ */ new Set();
						const ranges = d.ranges.map(({ start, startOffset, end, endOffset }) => {
							const startContainer = this.mirror.getNode(start);
							const endContainer = this.mirror.getNode(end);
							if (!startContainer || !endContainer) return;
							const result2 = new Range();
							result2.setStart(startContainer, startOffset);
							result2.setEnd(endContainer, endOffset);
							const doc = startContainer.ownerDocument;
							const selection = doc == null ? void 0 : doc.getSelection();
							selection && selectionSet.add(selection);
							return {
								range: result2,
								selection
							};
						});
						selectionSet.forEach((s2) => s2.removeAllRanges());
						ranges.forEach((r2) => {
							var _a2;
							return r2 && ((_a2 = r2.selection) == null ? void 0 : _a2.addRange(r2.range));
						});
					} catch (error) {}
				}
				applyStyleSheetMutation(data) {
					var _a2;
					let styleSheet = null;
					if (data.styleId) styleSheet = this.styleMirror.getStyle(data.styleId);
					else if (data.id) styleSheet = ((_a2 = this.mirror.getNode(data.id)) == null ? void 0 : _a2.sheet) || null;
					if (!styleSheet) return;
					if (data.source === IncrementalSource.StyleSheetRule) this.applyStyleSheetRule(data, styleSheet);
					else if (data.source === IncrementalSource.StyleDeclaration) this.applyStyleDeclaration(data, styleSheet);
				}
				applyStyleSheetRule(data, styleSheet) {
					var _a2, _b, _c, _d;
					(_a2 = data.adds) == null || _a2.forEach(({ rule: rule2, index: nestedIndex }) => {
						try {
							if (Array.isArray(nestedIndex)) {
								const { positions, index: index2 } = getPositionsAndIndex(nestedIndex);
								getNestedRule(styleSheet.cssRules, positions)?.insertRule(rule2, index2);
							} else {
								const index2 = nestedIndex === void 0 ? void 0 : Math.min(nestedIndex, styleSheet.cssRules.length);
								styleSheet?.insertRule(rule2, index2);
							}
						} catch (e2) {}
					});
					(_b = data.removes) == null || _b.forEach(({ index: nestedIndex }) => {
						try {
							if (Array.isArray(nestedIndex)) {
								const { positions, index: index2 } = getPositionsAndIndex(nestedIndex);
								getNestedRule(styleSheet.cssRules, positions)?.deleteRule(index2 || 0);
							} else styleSheet?.deleteRule(nestedIndex);
						} catch (e2) {}
					});
					if (typeof data.replace === "string") try {
						(_c = styleSheet.replace) == null || _c.call(styleSheet, data.replace);
					} catch (e2) {}
					if (typeof data.replaceSync === "string") try {
						(_d = styleSheet.replaceSync) == null || _d.call(styleSheet, data.replaceSync);
					} catch (e2) {}
				}
				/**
				* Apply a StyleDeclaration event (setProperty/removeProperty) to a stylesheet.
				*
				* Uses defensive null checks because the rule may not exist:
				* - Timing issues: The rule was added by a previous StyleSheetRule event
				*   that hasn't been processed yet
				* - Dynamic stylesheets: Constructed stylesheets or adopted stylesheets
				*   may not be fully synchronized
				* - Nested rules: Rules inside @media/@supports require the parent rule
				*   to exist first
				*/
				applyStyleDeclaration(data, styleSheet) {
					if (data.set) {
						const rule2 = getNestedRule(styleSheet.rules, data.index);
						if (rule2 == null ? void 0 : rule2.style) rule2.style.setProperty(data.set.property, data.set.value, data.set.priority);
					}
					if (data.remove) {
						const rule2 = getNestedRule(styleSheet.rules, data.index);
						if (rule2 == null ? void 0 : rule2.style) rule2.style.removeProperty(data.remove.property);
					}
				}
				applyAdoptedStyleSheet(data) {
					var _a2;
					const targetHost = this.mirror.getNode(data.id);
					if (!targetHost) return;
					(_a2 = data.styles) == null || _a2.forEach((style) => {
						var _a3;
						let newStyleSheet = null;
						let hostWindow = null;
						if (hasShadowRoot(targetHost)) hostWindow = ((_a3 = targetHost.ownerDocument) == null ? void 0 : _a3.defaultView) || null;
						else if (targetHost.nodeName === "#document") hostWindow = targetHost.defaultView;
						if (!hostWindow) return;
						try {
							newStyleSheet = new hostWindow.CSSStyleSheet();
							this.styleMirror.add(newStyleSheet, style.styleId);
							this.applyStyleSheetRule({
								source: IncrementalSource.StyleSheetRule,
								adds: style.rules
							}, newStyleSheet);
						} catch (e2) {}
					});
					const MAX_RETRY_TIME = 10;
					let count = 0;
					const adoptStyleSheets = (targetHost2, styleIds) => {
						const stylesToAdopt = styleIds.map((styleId) => this.styleMirror.getStyle(styleId)).filter((style) => style !== null);
						if (hasShadowRoot(targetHost2)) targetHost2.shadowRoot.adoptedStyleSheets = stylesToAdopt;
						else if (targetHost2.nodeName === "#document") targetHost2.adoptedStyleSheets = stylesToAdopt;
						if (stylesToAdopt.length !== styleIds.length && count < MAX_RETRY_TIME) {
							setTimeout(() => adoptStyleSheets(targetHost2, styleIds), 0 + 100 * count);
							count++;
						}
					};
					adoptStyleSheets(targetHost, data.styleIds);
				}
				legacy_resolveMissingNode(map, parent, target, targetMutation) {
					const { previousId, nextId } = targetMutation;
					const previousInMap = previousId && map[previousId];
					const nextInMap = nextId && map[nextId];
					if (previousInMap) {
						const { node: node2, mutation } = previousInMap;
						parent.insertBefore(node2, target);
						delete map[mutation.node.id];
						delete this.legacy_missingNodeRetryMap[mutation.node.id];
						if (mutation.previousId || mutation.nextId) this.legacy_resolveMissingNode(map, parent, node2, mutation);
					}
					if (nextInMap) {
						const { node: node2, mutation } = nextInMap;
						parent.insertBefore(node2, target.nextSibling);
						delete map[mutation.node.id];
						delete this.legacy_missingNodeRetryMap[mutation.node.id];
						if (mutation.previousId || mutation.nextId) this.legacy_resolveMissingNode(map, parent, node2, mutation);
					}
				}
				moveAndHover(x, y, id, isSync, debugData) {
					const target = this.mirror.getNode(id);
					if (!target) return this.debugNodeNotFound(debugData, id);
					const base = getBaseDimension(target, this.iframe);
					const _x = x * base.absoluteScale + base.x;
					const _y = y * base.absoluteScale + base.y;
					this.mouse.style.left = `${_x}px`;
					this.mouse.style.top = `${_y}px`;
					if (!isSync) this.drawMouseTail({
						x: _x,
						y: _y
					});
					this.hoverElements(target);
				}
				drawMouseTail(position) {
					if (!this.mouseTail) return;
					const { lineCap, lineWidth, strokeStyle, duration } = this.config.mouseTail === true ? defaultMouseTailConfig : Object.assign({}, defaultMouseTailConfig, this.config.mouseTail);
					const draw = () => {
						if (!this.mouseTail) return;
						const ctx = this.mouseTail.getContext("2d");
						if (!ctx || !this.tailPositions.length) return;
						ctx.clearRect(0, 0, this.mouseTail.width, this.mouseTail.height);
						ctx.beginPath();
						ctx.lineWidth = lineWidth;
						ctx.lineCap = lineCap;
						ctx.strokeStyle = strokeStyle;
						ctx.moveTo(this.tailPositions[0].x, this.tailPositions[0].y);
						this.tailPositions.forEach((p) => ctx.lineTo(p.x, p.y));
						ctx.stroke();
					};
					this.tailPositions.push(position);
					draw();
					setTimeout(() => {
						this.tailPositions = this.tailPositions.filter((p) => p !== position);
						draw();
					}, duration / this.speedService.state.context.timer.speed);
				}
				hoverElements(el) {
					var _a2;
					(_a2 = this.lastHoveredRootNode || this.iframe.contentDocument) == null || _a2.querySelectorAll(".\\:hover").forEach((hoveredEl) => {
						hoveredEl.classList.remove(":hover");
					});
					this.lastHoveredRootNode = el.getRootNode();
					let currentEl = el;
					while (currentEl) {
						if (currentEl.classList) currentEl.classList.add(":hover");
						currentEl = currentEl.parentElement;
					}
				}
				isUserInteraction(event) {
					if (event.type !== EventType.IncrementalSnapshot) return false;
					return event.data.source > IncrementalSource.Mutation && event.data.source <= IncrementalSource.Input;
				}
				backToNormal() {
					this.nextUserInteractionEvent = null;
					if (this.speedService.state.matches("normal")) return;
					this.speedService.send({ type: "BACK_TO_NORMAL" });
					this.emitter.emit(ReplayerEvents.SkipEnd, { speed: this.speedService.state.context.normalSpeed });
				}
				warnNodeNotFound(d, id) {
					this.warn(`Node with id '${id}' not found. `, d);
				}
				warnCanvasMutationFailed(d, error) {
					this.warn(`Has error on canvas update`, error, "canvas mutation:", d);
				}
				debugNodeNotFound(d, id) {
					this.debug(`Node with id '${id}' not found. `, d);
				}
				warn(...args) {
					if (!this.config.showWarning) return;
					this.config.logger.warn(REPLAY_CONSOLE_PREFIX, ...args);
				}
				debug(...args) {
					if (!this.config.showDebug) return;
					this.config.logger.log(REPLAY_CONSOLE_PREFIX, ...args);
				}
			};
			({addCustomEvent, addAnnotation} = record);
			({freezePage} = record);
			({takeFullSnapshot} = record);
		}));
		//#endregion
		//#region src/client/mirror.ts
		/**
		* The clock a live replay starts from.
		*
		* Not `Date.now()`. rrweb applies every event older than the live baseline
		* through its synchronous path, which stages mutations in a virtual tree that
		* only reaches the replay on a flush; measured in a real browser, a checkpoint
		* fed against `Date.now()` renders its snapshot and silently drops the
		* increments behind it, while the same events against the recording's own clock
		* replay correctly. Starting at the recording's first timestamp puts the batch
		* on the timeline instead, so the replay catches up to the live edge and events
		* that arrive later queue behind it at their own offsets — which is what "live"
		* has to mean when the panel can attach in the middle of a recording.
		* @param events - the checkpoint batch a replay is being built from.
		* @returns the replay's baseline timestamp in milliseconds.
		*/
		function liveBaseline(events) {
			const first = events[0];
			const timestamp = typeof first === "object" && first !== null ? first.timestamp : void 0;
			return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now();
		}
		/**
		* The production factory: rrweb's replayer, in live mode.
		* @param root - element the mirror is mounted into.
		* @param events - the checkpoint batch to draw first; may be empty.
		* @returns the handle the panel keeps until it rebuilds or unmounts.
		*/
		async function createRrwebMirror(root, events) {
			const replayer = new (await (Promise.resolve().then(() => (init_rrweb(), rrweb_exports)))).Replayer([], {
				root,
				liveMode: true
			});
			replayer.startLive(liveBaseline(events));
			const append = (event) => {
				replayer.addEvent(event);
			};
			for (const event of events) append(event);
			return {
				addEvent: append,
				destroy: () => {
					replayer.destroy();
				}
			};
		}
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
			/** Top chrome row: address display, connection state, lane switch, refresh. */
			toolbar: "toolbar",
			/** The read-only address display of the streamed page. */
			address: "address",
			/** The lane switch: DOM mirror or pixel stream. */
			mode: "mode",
			/** The controlled browser's tab chips; drawn only when it holds several. */
			tabs: "tabs",
			/** The live frame image. */
			frame: "frame",
			/** The replayed DOM mirror of the streamed page. */
			mirror: "mirror",
			/** Why the mirror is not running and the pixel lane took over. */
			mirrorNotice: "mirror-notice",
			/** Placeholder shown while the mirror is being armed. */
			mirrorStarting: "mirror-starting",
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
				case "frame": {
					if (typeof candidate.tabId !== "string") return null;
					if (typeof candidate.seq !== "number") return null;
					if (typeof candidate.width !== "number") return null;
					if (typeof candidate.height !== "number") return null;
					if (typeof candidate.data !== "string") return null;
					const format = candidate.format === "webp" ? "webp" : "jpeg";
					return {
						v: 1,
						kind: "frame",
						tabId: candidate.tabId,
						seq: candidate.seq,
						width: candidate.width,
						height: candidate.height,
						format,
						data: candidate.data
					};
				}
				case "dom":
					if (typeof candidate.tabId !== "string") return null;
					if (typeof candidate.seq !== "number") return null;
					if (!Array.isArray(candidate.events)) return null;
					return {
						v: 1,
						kind: "dom",
						tabId: candidate.tabId,
						seq: candidate.seq,
						reset: candidate.reset === true,
						events: candidate.events
					};
				case "mirror":
					if (typeof candidate.tabId !== "string") return null;
					if (typeof candidate.available !== "boolean") return null;
					return {
						v: 1,
						kind: "mirror",
						tabId: candidate.tabId,
						available: candidate.available,
						...typeof candidate.reason === "string" ? { reason: candidate.reason } : {}
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
			/** Last mirror batch drawn per tab; one recording is a stream, not a value. */
			const lastDomSeqByTab = /* @__PURE__ */ new Map();
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
					case "dom": {
						const previous = lastDomSeqByTab.get(event.tabId);
						if (previous !== void 0 && event.seq <= previous) return;
						lastDomSeqByTab.set(event.tabId, event.seq);
						handlers.onDom?.({
							tabId: event.tabId,
							seq: event.seq,
							reset: event.reset === true,
							events: event.events
						});
						return;
					}
					case "mirror":
						handlers.onMirror?.({
							tabId: event.tabId,
							available: event.available,
							...event.reason === void 0 ? {} : { reason: event.reason }
						});
						return;
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
					lastDomSeqByTab.clear();
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
		const css = ".WKhQka_tabTitle{align-items:center;gap:5px;min-width:0;max-width:100%;display:inline-flex}.WKhQka_tabTitleMark{flex:none;width:13px;height:13px}.WKhQka_tabTitleText{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}.WKhQka_root{min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);flex-direction:column;flex:auto;display:flex;overflow:hidden}.WKhQka_toolbar{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:5px 6px;display:flex}.WKhQka_tool{width:28px;height:28px;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}@media (hover:hover){.WKhQka_tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}}.WKhQka_tool:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}.WKhQka_tool:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-base), 0 0 0 4px var(--dsw-alias-brand-primary);outline:none}.WKhQka_tool.WKhQka_mode{width:auto;min-width:28px;font:var(--dsw-font-xxxs-11);white-space:nowrap;padding:0 7px}.WKhQka_addressBox{flex:auto;min-width:0;position:relative}.WKhQka_address{box-sizing:border-box;width:100%;height:28px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:0 9px;overflow:hidden}.WKhQka_address::placeholder{color:var(--dsw-alias-label-tertiary)}.WKhQka_address:focus{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.WKhQka_status{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);white-space:nowrap;flex:none;align-items:center;gap:4px;line-height:16px;display:inline-flex}.WKhQka_statusText{text-overflow:ellipsis;max-width:72px;overflow:hidden}.WKhQka_tabs{border-bottom:.5px solid var(--dsw-alias-border-l3);scrollbar-width:none;flex:none;align-items:center;gap:4px;padding:4px 6px;display:flex;overflow-x:auto}.WKhQka_tabs::-webkit-scrollbar{display:none}.WKhQka_tab{max-width:150px;height:24px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);white-space:nowrap;text-overflow:ellipsis;border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:0;flex:none;padding:0 8px;transition:background-color .12s,color .12s;overflow:hidden}@media (hover:hover){.WKhQka_tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}}.WKhQka_tabActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}.WKhQka_tab:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-base), 0 0 0 4px var(--dsw-alias-brand-primary);outline:none}.WKhQka_content{background:var(--dsw-alias-bg-base);flex:auto;min-width:0;min-height:0;display:flex;overflow:auto}.WKhQka_frame{object-fit:contain;max-width:100%;height:auto;margin:auto;display:block}.WKhQka_mirror{background:var(--dsw-alias-bg-base);flex:auto;min-width:0;min-height:0;overflow:auto}.WKhQka_mirror .replayer-wrapper{position:relative}.WKhQka_mirror canvas,.WKhQka_mirror iframe{background:0 0;border:0}.WKhQka_mirrorIdle{display:none}.WKhQka_mirrorNote{color:var(--dsw-alias-label-tertiary);text-align:center;flex-direction:column;align-items:center;gap:6px;margin:auto;padding:20px 16px;font-size:12px;line-height:18px;display:flex}.WKhQka_mirrorNotice{color:var(--dsw-alias-label-tertiary);border-top:.5px solid var(--dsw-alias-border-l3);flex:none;padding:4px 10px;font-size:11px;line-height:16px}.WKhQka_empty,.WKhQka_error{text-align:center;flex-direction:column;align-items:center;gap:6px;margin:auto;padding:20px 16px;display:flex}.WKhQka_emptyTitle,.WKhQka_errorTitle{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px}.WKhQka_emptyHint,.WKhQka_errorBody{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.WKhQka_errorTitle{color:var(--dsw-alias-state-error-primary)}.WKhQka_errorCode{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);font-size:11px;line-height:16px}.WKhQka_trace{border-top:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:8px;max-height:84px;padding:6px 10px;display:flex;overflow:hidden}.WKhQka_traceList{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex;overflow:hidden}.WKhQka_traceIdle{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.WKhQka_traceRow{align-items:baseline;gap:6px;min-width:0;font-size:12px;line-height:18px;display:flex}.WKhQka_traceTool{color:var(--dsw-alias-brand-primary);font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);flex:none;font-size:11px}.WKhQka_traceSummary{min-width:0;color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}";
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
			"mirror": "WKhQka_mirror",
			"mirrorIdle": "WKhQka_mirrorIdle",
			"mirrorNote": "WKhQka_mirrorNote",
			"mirrorNotice": "WKhQka_mirrorNotice",
			"mode": "WKhQka_mode",
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
		* Two lanes. The default is the DOM mirror: the host serializes the page with
		* rrweb and streams its mutations, and this body replays them as real DOM, so
		* text stays crisp and the traffic is event-sized instead of frame-sized. The
		* pixel lane is kept, one click away, because a DOM cannot show a `<video>`, a
		* canvas or native UI - and because it is the fallback when the mirror cannot
		* start, in which case the reason is shown rather than an empty stage. While a
		* mirror is still being armed the pixel lane stays on screen, so the switch
		* never trades a live picture for a blank one.
		*
		* The mirror is read-only. Mapping a click on a replayed node back to a CDP
		* action on the recorded page's element is deliberately not implemented here:
		* rrweb's replayer renders into its own iframe whose nodes are a reconstruction,
		* not the page, so a click would have to be resolved against a node id the host
		* never sees. Input stays on the pixel stage until that mapping exists.
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
		function BrowserViewPanel({ t, sessionId, liveTitle, socketFactory, location, mirrorFactory }) {
			const [state, setState] = (0, react.useState)(EMPTY_STATE);
			const [frame, setFrame] = (0, react.useState)(null);
			const [traces, setTraces] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)(null);
			const [status, setStatus] = (0, react.useState)("connecting");
			/**
			* Lane this panel renders. The DOM mirror is the default because it is the
			* cheap, crisp one; the pixel lane is what the switch and the fallback use.
			*/
			const [lane, setLane] = (0, react.useState)("dom");
			/** Bumped for every checkpoint batch, which is what rebuilds the replayer. */
			const [mirrorCheckpoints, setMirrorCheckpoints] = (0, react.useState)(0);
			/** Whether the replayer is mounted and drawing. */
			const [mirrorReady, setMirrorReady] = (0, react.useState)(false);
			/** Why the mirror is not running; shown beside the pixel picture it fell in to. */
			const [mirrorNotice, setMirrorNotice] = (0, react.useState)(null);
			const socketRef = (0, react.useRef)(null);
			/** Last active tab seen in a state push; a tab switch invalidates the picture. */
			const lastActiveTabRef = (0, react.useRef)(null);
			/** Lane the panel asked the host for, readable from socket callbacks. */
			const laneRef = (0, react.useRef)("dom");
			/** The checkpoint batch the replayer is (re)built from. */
			const mirrorCheckpointRef = (0, react.useRef)([]);
			/** Mounted replayer; live events are pushed into it as they arrive. */
			const mirrorHandleRef = (0, react.useRef)(null);
			/** Element the replayer is mounted into. */
			const mirrorRootRef = (0, react.useRef)(null);
			/**
			* Move to the pixel lane because the mirror cannot be shown, and say why.
			*
			* The host is told, not just the state: it is the side that stops sending
			* frames once a mirror is live, so a panel that quietly stops rendering the
			* mirror would freeze on its last drawn state. Not sending it in the
			* host-driven case is deliberate - there the host has already moved this
			* sink and sending it back would be a round trip that changes nothing.
			* @param reason - what to show the person watching.
			*/
			const fallBackToPixels = (reason, tellHost = true) => {
				if (laneRef.current !== "pixels") {
					laneRef.current = "pixels";
					setLane("pixels");
				}
				setMirrorReady(false);
				setMirrorNotice(reason);
				if (tellHost) socketRef.current?.send({
					v: 1,
					kind: "mode",
					mode: "pixels"
				});
			};
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
						if (next !== "open") return;
						socketRef.current?.send({
							v: 1,
							kind: "mode",
							mode: laneRef.current
						});
						if (!announcedRef.current) socketRef.current?.send({
							v: 1,
							kind: "stream",
							enabled: false
						});
					},
					onState: (next) => {
						if (lastActiveTabRef.current !== next.activeTabId) {
							lastActiveTabRef.current = next.activeTabId;
							setFrame(null);
							mirrorCheckpointRef.current = [];
							setMirrorCheckpoints(0);
							setMirrorReady(false);
						}
						setState(next);
					},
					onFrame: (next) => {
						setError(null);
						frameFormatRef.current = next.format ?? "jpeg";
						setFrame(next);
					},
					onDom: (batch) => {
						if (lastActiveTabRef.current !== null && batch.tabId !== lastActiveTabRef.current) return;
						if (batch.reset) {
							mirrorCheckpointRef.current = batch.events;
							setMirrorReady(false);
							setMirrorCheckpoints((current) => current + 1);
							return;
						}
						for (const event of batch.events) mirrorHandleRef.current?.addEvent(event);
					},
					onMirror: (mirror) => {
						if (mirror.available) return;
						if (lastActiveTabRef.current !== null && mirror.tabId !== lastActiveTabRef.current) return;
						fallBackToPixels(mirror.reason ?? t("panel.mirror.unavailable"), false);
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
			(0, react.useEffect)(() => {
				if (lane !== "dom" || mirrorCheckpoints === 0) return;
				const root = mirrorRootRef.current;
				if (root === null) return;
				const build = mirrorFactory ?? createRrwebMirror;
				let cancelled = false;
				let handle = null;
				Promise.resolve().then(() => build(root, mirrorCheckpointRef.current)).then((created) => {
					if (cancelled) {
						created.destroy();
						return;
					}
					handle = created;
					mirrorHandleRef.current = created;
					setMirrorReady(true);
				}).catch((failure) => {
					if (cancelled) return;
					fallBackToPixels(failure instanceof Error ? failure.message : String(failure));
				});
				return () => {
					cancelled = true;
					handle?.destroy();
					mirrorHandleRef.current = null;
					setMirrorReady(false);
				};
			}, [
				lane,
				mirrorCheckpoints,
				mirrorFactory
			]);
			const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
			const loading = activeTab?.loading === true || status !== "open";
			const hostError = state.message !== void 0 && state.message.length > 0 ? {
				code: "",
				message: state.message
			} : null;
			const effectiveError = error ?? hostError;
			const visibleFrame = effectiveError === null ? frame : null;
			const dataUrl = visibleFrame === null ? null : `data:image/${visibleFrame.format ?? "jpeg"};base64,${visibleFrame.data}`;
			const frameRef = (0, react.useRef)(null);
			const canvasRef = (0, react.useRef)(null);
			const lastMoveAtRef = (0, react.useRef)(0);
			const MOVE_THROTTLE_MS = 33;
			const [dcActive, setDcActive] = (0, react.useState)(false);
			const pcRef = (0, react.useRef)(null);
			const rtcTriedRef = (0, react.useRef)(false);
			const rtcAnswerRef = (0, react.useRef)(void 0);
			/** Encoding of the last frame seen over the socket; the DataChannel path has
			*  no per-message header field for it, so it inherits the stream's. */
			const frameFormatRef = (0, react.useRef)("jpeg");
			/** Panel root, observed to learn whether this tab is actually on screen. */
			const rootRef = (0, react.useRef)(null);
			/** Whether this panel last told the host it is watching (the host's default). */
			const announcedRef = (0, react.useRef)(true);
			/** Reassembles chunked DataChannel frames. */
			const assemblerRef = (0, react.useRef)(new FrameAssembler());
			/** One lane switch: the panel tells the host and moves its own stage. */
			const switchLane = (next) => {
				laneRef.current = next;
				setLane(next);
				setMirrorNotice(null);
				setMirrorReady(false);
				socketRef.current?.send({
					v: 1,
					kind: "mode",
					mode: next
				});
			};
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
				const element = rootRef.current;
				if (element === null || typeof IntersectionObserver === "undefined") return;
				let intersecting = element.getClientRects().length > 0;
				const rendered = () => {
					if (document.visibilityState !== "visible") return false;
					if (!intersecting) return false;
					const box = element.getBoundingClientRect();
					if (box.width < 2 || box.height < 2) return false;
					for (let node = element; node !== null; node = node.parentElement) {
						const style = getComputedStyle(node);
						if (style.display === "none" || style.visibility === "hidden") return false;
						if (style.contentVisibility === "hidden") return false;
					}
					return true;
				};
				const announce = () => {
					const visible = rendered();
					if (announcedRef.current === visible) return;
					announcedRef.current = visible;
					socketRef.current?.send({
						v: 1,
						kind: "stream",
						enabled: visible
					});
				};
				const observer = new IntersectionObserver((entries) => {
					intersecting = entries.some((entry) => entry.isIntersecting);
					announce();
				});
				observer.observe(element);
				document.addEventListener("visibilitychange", announce);
				const poll = window.setInterval(announce, 1e3);
				return () => {
					observer.disconnect();
					document.removeEventListener("visibilitychange", announce);
					window.clearInterval(poll);
				};
			}, []);
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
				assemblerRef.current.reset();
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
					const chunk = readFrameChunk(event.data);
					if (chunk === null) return;
					const complete = assemblerRef.current.push(chunk);
					if (complete === null) return;
					const blob = new Blob([complete], { type: `image/${frameFormatRef.current}` });
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
				ref: rootRef,
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
								className: cx(panel_module_css_default.tool, panel_module_css_default.mode),
								"data-dsh-part": BROWSER_VIEW_PARTS.mode,
								"data-mode": lane,
								title: t("panel.mode.switch"),
								"aria-label": t("panel.mode.switch"),
								disabled: activeTab === null,
								onClick: () => {
									switchLane(lane === "dom" ? "pixels" : "dom");
								},
								children: lane === "dom" ? t("panel.mode.dom") : t("panel.mode.pixels")
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
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [lane === "dom" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							ref: mirrorRootRef,
							className: cx(panel_module_css_default.mirror, !mirrorReady && panel_module_css_default.mirrorIdle),
							"data-dsh-part": BROWSER_VIEW_PARTS.mirror
						}), lane === "dom" && mirrorReady ? null : dataUrl === null || visibleFrame === null ? lane === "dom" && activeTab !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: panel_module_css_default.mirrorNote,
							"data-dsh-part": BROWSER_VIEW_PARTS.mirrorStarting,
							children: t("panel.mirror.starting")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						})] })
					}),
					mirrorNotice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: panel_module_css_default.mirrorNotice,
						"data-dsh-part": BROWSER_VIEW_PARTS.mirrorNotice,
						role: "status",
						children: [t("panel.mirror.unavailable"), mirrorNotice]
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