# dsh-browser-view · Live Browser View for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-BSD--3--Clause-blue?style=flat-square" alt="License">
</p>

> A browser the agent drives, watched from a tab beside the chat. The host half owns a dedicated Chromium over the devtools protocol; the browser half contributes one right-sidebar tab type, so the page stays in view while the agent verifies it.

This package is an external plugin for DeepSeek Harness (DSH), structured as a cordis bundle: `src/index.ts` is the host half (Chrome process, CDP sessions, tab registry, WebSocket fan-out, agent tools) and `src/client/` is the browser half (the sidebar tab body and its chip).

## What it does

- **A live tab, not a screenshot poll**: CDP `Page.startScreencast` frames arrive over one WebSocket and are painted as they come. The tab shows the active page, its URL and title, and what the agent last did.
- **Eleven agent tools**: `browser_navigate`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_snapshot`, `browser_screenshot`, `browser_console`, `browser_network`, `browser_tabs`, `browser_close` (closes only the tabs this session opened).
- **Evidence in the conversation**: every `browser_screenshot` result carries the image, so the transcript keeps the picture the agent acted on instead of only a sentence about it.
- **One dedicated browser**: the plugin launches its own Chromium with a throwaway profile. It never attaches to a browser you are signed into unless you opt in with `DSH_BROWSER_VIEW_ATTACH_PORT` (see Security model).
- **Signs itself in to this host's own GUI**: a fresh profile has no session cookie, so the viewer would only ever see the 401 challenge. When a navigation lands on that challenge over loopback, the plugin asks the host's connection service for the same ticketed URL `dsh web` printed, and retries once. The cookie that mints lives in the throwaway profile and dies with it.

## How it works

```text
agent tool call ──► host half ──► CDP ──► dedicated Chromium
                        │
                        └─ screencast frames ──► WebSocket ──► sidebar tab body
```

The host half starts Chrome lazily on the first tool call or the first tab mount, pins a viewport, and keeps a ring of console entries and network requests per tab so a verification can be read back without re-running the page. A top-level document replacement clears both rings; a same-document navigation (hash, query, SPA pushState) keeps them.

## Frame transport and bandwidth

Frames default to the WebSocket (JSON + base64). After mounting, the panel additionally performs a WebRTC handshake with the host: the panel creates an **unreliable, unordered** DataChannel (drops beat stalls, exactly what a frame stream wants) and the host answers with [werift](https://github.com/shinyoshiaki/werift-webrtc), a pure-TypeScript WebRTC implementation with zero native dependencies. Once the channel opens, binary frames travel there; the control plane (state, actions, commands, input) stays on the WebSocket. Every failure - including a single frame the channel cannot send - falls back to the WebSocket, and costs **that frame only**: the panel is never dropped from the broadcast.

One frame is split into chunks of at most 60 KiB, each prefixed with `[u32 sequence][u8 index][u8 count]`, and the panel rebuilds it before decoding. This is not optional: a DataChannel message is capped at 64 KiB, while real pages routinely exceed it (measured at 1280x800 and quality 70: 111 KB for a Wikipedia article, 250 KB for a heavy DOM page), so an unchunked frame throws every single time.

Bandwidth is designed for "look when you need to, step in when you must", not for watching video:

| Measure | Effect |
| --- | --- |
| Frame encoding | WebP at quality 50 (was JPEG at 70), visibly the same at a clearly smaller size |
| Capture box | Captured at 1024x640 (the browser viewport stays 1280x800); pointer coordinates are scaled back up, so clicking stays exact |
| Frame budget | At most about 15 fps while nobody interacts, opened to about 30 fps for three seconds after any input |
| Invisible means stopped | A collapsed sidebar, another chip in front, or a hidden browser tab tells the host; the **last** watching panel leaving stops the screencast outright - nothing is captured, encoded or sent - and returning restores it with one fresh frame |

## Interface seats

| Seat | Kind | What lands there |
| --- | --- | --- |
| `sidebar.right.pane.tab` | keyed, session | the tab body |
| `sidebar.right.pane.tab.title` | keyed, session | the chip text and glyph |

The conversation header carries no entry for this tab: the column's own tab strip and the guide capsule already open it, and a third place to click was only crowding that row.

The tab type is registered with `ctx.sidebarRightTabs.register` and opened with `ctx.sidebarRight.openTabIn`. Its kind is `browser-view`, deliberately **not** `browser`: the shipped `@deepseek-ai/dsh-client-ui-sidebar-browser` owns that kind, and a second registration in the extension band takes a kind over, which would shadow the shipped tab out of existence.

The single-occupant `rightbar` / `rightbar.session` seats are still not touched: they belong to the column itself, not to the tabs inside it.

## Security model

- **Loopback only**: the panel socket is fenced to loopback requests; a non-local client is rejected before the upgrade. Whoever can establish the socket can also send input to the watched page (clicks, keys, wheel), so the fence and CIDR lists should stay limited to the ranges that genuinely serve the GUI.
- **Opt-in CIDR widening**: setting `DSH_BROWSER_VIEW_ALLOWED_CIDRS` to a comma-separated list of IPv4 CIDR ranges (for example `192.168.1.0/24`) admits panel socket requests whose socket address falls inside a listed range. The widening keeps the other request-level gates: a request carrying forwarding headers (a proxy or tunnel in front of the host) is still refused, as is a cross-site request or one whose Origin does not match the Host. Unset or empty means loopback-only, unchanged. A listed range can drive the browser tools from that network, so list the narrowest range that actually serves the GUI; `::1` stays always allowed and the list never admits pure IPv6 addresses.
- **Trusted proxy is a separate, narrower opt-in**: with a reverse proxy in front of the host, the forwarded-header refusal disables the CIDR widening above (the proxy appends forwarding headers and rewrites Host). Three variables must all be set to open this path: `DSH_BROWSER_VIEW_TRUSTED_PROXY_CIDRS` lists the socket ranges the proxy sits on (for example `127.0.0.1/32`), `DSH_BROWSER_VIEW_ALLOWED_CIDRS` constrains the client address taken from the last `X-Forwarded-For` entry, and `DSH_BROWSER_VIEW_PUBLIC_ORIGIN` declares the public origin the browser actually uses (comma-separated for several, for example `https://100.64.0.10:30082,https://10.76.144.1:30082`), which the request's Origin must equal one of. Missing any one keeps the path closed; cross-site requests stay refused. The trust boundary is real: a host inside the trusted range can forge `X-Forwarded-For` to impersonate a listed client, so trust only the narrowest range around the proxy itself and keep the proxy-to-host path on the machine.
- **Throwaway profile**: Chrome runs on a fresh `--user-data-dir` under the system temp directory with a random debugging port, so no cookie, session or extension of the user's real browser is reachable.
- **Attach mode is opt-in and hands-off**: setting `DSH_BROWSER_VIEW_ATTACH_PORT` to a DevTools debugging port makes the plugin drive that already-running browser instead of launching one. The plugin never enables remote debugging itself; the operator starts the browser with `--remote-debugging-port=<port>` on a loopback address. In attach mode the plugin does not kill the browser and does not touch any profile — dispose only closes the tabs the plugin itself created and its own protocol session. The trade-off is real: the agent is now driving a browser that holds your sessions, so in attach mode every agent tool may only operate tabs the calling session created via the tools; a foreign target (your own page) is refused with the list of allowed tabs, and `browser_close` closes only session-created tabs and never falls through to anything else. Only turn attach mode on for a browser profile you accept the agent working inside.
- **Headless by default**: nothing pops up on the desktop; the tab is the only view.
- **Process lifetime**: in spawn mode the Chromium child is killed when the plugin disposes. Nothing is left running behind a closed session. In attach mode the browser is yours and outlives the plugin by design.
- **Token handling**: the launch token is minted per navigation, held in memory, and never written to disk; the retry only happens on a loopback target whose document is DSH's own challenge, so no other local service is ever handed the token.

## Known limits

- The tab is an **interactive view**: clicks, drags, wheel and keyboard travel from the panel into the watched page (the host-side Chromium); your input never passes through an agent session. The address bar stays read-only, and navigation remains the agent's tools' or the tab picker's job.
- The tab lives inside the right sidebar, so it needs that column; a layout that hides the column hides the tab.
- Frames are produced when the page changes, so a static page holds the last frame instead of streaming duplicates.
- Switching chips keeps the body mounted (`keepMounted`), so the socket survives; the frame still waits for the next change.
- The token top-up only covers the site root, because DSH answers the challenge with a 303 to `./` for `GET /` alone.
- One browser process per host; tabs are isolated CDP targets, not separate profiles.
- Chrome must be installed at a standard location (or named by `CHROME_PATH`).

## Install

This repository is a standalone bundle: install it straight from GitHub.

```sh
dsh plugin --profile web add git+https://github.com/jimorsm/dsh-browser-view
```

`lib/` is committed, so the install runs no build script and needs no
`allowBuilds` opt-in; pin a commit or tag with `#<ref>` if you want a frozen
copy. To build locally instead, clone and link the checkout:

```sh
dsh plugin --profile web add link:<this checkout>
```

The plugin row is read at startup, so a DSH restart is required after installing or changing it.

Not published to npm. The upstream project publishes the same plugin as
`@linxin666/dsh-client-ui-browser-view`; **do not install both** - they claim the
same plugin row id (`ui-browser-view`) and the same right-sidebar tab kind
(`browser-view`), so the later one in the loader roster wins silently.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Provenance

Forked from the [dsh-web](https://github.com/zhu1090093659/dsh-web) plugin
`packages/dsh-browser-view` (upstream package `@linxin666/dsh-client-ui-browser-view`,
version 0.4.10), plus this fork's own feature work: panel input relay, the
opt-in trusted-proxy socket fence, and WebRTC DataChannel frame transport. See
[NOTICE](NOTICE) for attribution and licensing; the upstream package name and
npm scope belong to the upstream project and are not used here.
