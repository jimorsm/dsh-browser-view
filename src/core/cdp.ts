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

import WebSocket from 'ws'

/** Protocol failure returned by the browser, or raised by this client. */
export class CdpError extends Error {
  /** CDP error code, or `-1` for client-side failures (timeout, closed socket). */
  readonly code: number
  /** Method whose round-trip failed. */
  readonly method: string

  /**
   * @param method - the protocol method that failed.
   * @param code - CDP error code, `-1` for client-side failures.
   * @param message - the browser's own message, kept verbatim for diagnosis.
   */
  constructor(method: string, code: number, message: string) {
    super(`${method}: ${message}`)
    this.name = 'CdpError'
    this.method = method
    this.code = code
  }
}

/** The subset of the client the upper layers depend on; tests supply a fake. */
export interface CdpTransport {
  /**
   * Send one protocol command and resolve with its result.
   * @param method - CDP method, for example `Page.navigate`.
   * @param params - command parameters.
   * @param sessionId - flat-mode session to address; omitted sends browser-level.
   * @returns the `result` object of the response.
   */
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>
  /**
   * Subscribe to one protocol event.
   * @param method - event name, for example `Page.screencastFrame`.
   * @param handler - receives event params and the originating session, if any.
   * @returns the unsubscribe function.
   */
  on(method: string, handler: CdpEventListener): () => void
  /** Drop the socket; every pending round-trip rejects. */
  /**
   * Subscribe to the connection ending; the listener runs at most once, and a
   * client that already ended runs it immediately.
   * @param listener - called when the socket closes or fails.
   * @returns an unsubscribe function.
   */
  onClose(listener: () => void): () => void
  close(): void
}

/** One protocol event delivery. */
export type CdpEventListener = (params: Record<string, unknown>, sessionId: string | undefined) => void

/** Default per-command deadline; long enough for a navigation, short enough to fail a wedged tab. */
export const CDP_COMMAND_TIMEOUT_MS = 30_000

/** One in-flight round-trip. */
interface PendingCall {
  method: string
  resolve: (value: unknown) => void
  reject: (error: CdpError) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * A single WebSocket carrying browser-level and flat-session protocol traffic.
 */
export class CdpClient implements CdpTransport {
  private readonly socket: WebSocket
  private readonly timeoutMs: number
  private readonly pending = new Map<number, PendingCall>()
  private readonly listeners = new Map<string, Set<CdpEventListener>>()
  private nextId = 1
  private closedReason: string | undefined
  /** Listeners waiting for the connection to end; fired at most once. */
  private readonly closeListeners = new Set<() => void>()

  private constructor(socket: WebSocket, timeoutMs: number) {
    this.socket = socket
    this.timeoutMs = timeoutMs
    socket.on('message', (data: WebSocket.RawData) => { this.handleMessage(data) })
    socket.on('close', () => { this.failAll('the DevTools socket closed') })
    socket.on('error', (error: Error) => { this.failAll(`the DevTools socket failed: ${error.message}`) })
  }

  /**
   * Open a client against an already-discovered DevTools endpoint.
   * @param url - `webSocketDebuggerUrl` from `/json/version`.
   * @param options - command deadline override.
   * @returns a connected client.
   * @throws CdpError when the socket cannot be established in time.
   */
  static async connect(url: string, options: { timeoutMs?: number } = {}): Promise<CdpClient> {
    const timeoutMs = options.timeoutMs ?? CDP_COMMAND_TIMEOUT_MS
    const socket = new WebSocket(url, { handshakeTimeout: timeoutMs })
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        socket.off('open', onOpen)
        socket.off('error', onError)
      }
      const onOpen = (): void => { cleanup(); resolve() }
      const onError = (error: Error): void => { cleanup(); reject(new CdpError('connect', -1, error.message)) }
      socket.once('open', onOpen)
      socket.once('error', onError)
    })
    return new CdpClient(socket, timeoutMs)
  }

  /**
   * Address one protocol command.
   * @param method - CDP method.
   * @param params - command parameters.
   * @param sessionId - flat-mode session to address.
   * @returns the response `result`.
   */
  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.closedReason !== undefined) {
      return Promise.reject(new CdpError(method, -1, this.closedReason))
    }
    const id = this.nextId++
    const payload: Record<string, unknown> = { id, method, params }
    // Browser-level commands must omit sessionId entirely (the browser rejects
    // an explicit null), so the field is only added for page-level traffic.
    if (sessionId !== undefined) payload.sessionId = sessionId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CdpError(method, -1, `timed out after ${this.timeoutMs} ms`))
      }, this.timeoutMs)
      this.pending.set(id, {
        method,
        timer,
        resolve: value => { resolve(value as T) },
        reject,
      })
      this.socket.send(JSON.stringify(payload), (error: Error | null | undefined) => {
        // `ws` calls back with `null` on a clean write and an Error otherwise;
        // treating null as a failure would reject every successful command.
        if (error === null || error === undefined) return
        const call = this.pending.get(id)
        if (call === undefined) return
        this.pending.delete(id)
        clearTimeout(call.timer)
        call.reject(new CdpError(method, -1, error.message))
      })
    })
  }

  /**
   * Subscribe to one protocol event.
   * @param method - event name.
   * @param handler - event callback.
   * @returns the unsubscribe function.
   */
  on(method: string, handler: CdpEventListener): () => void {
    let set = this.listeners.get(method)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(method, set)
    }
    set.add(handler)
    return () => {
      const current = this.listeners.get(method)
      if (current === undefined) return
      current.delete(handler)
      if (current.size === 0) this.listeners.delete(method)
    }
  }

  /** Drop the socket and reject every in-flight command. */
  /**
   * Run `listener` when the connection ends. A client that already ended runs it
   * immediately, so a subscriber never waits for an event that cannot arrive.
   * @param listener - callback for the loss of the connection.
   * @returns an unsubscribe function.
   */
  onClose(listener: () => void): () => void {
    if (this.closedReason === undefined) this.closeListeners.add(listener)
    else listener()
    return () => { this.closeListeners.delete(listener) }
  }

  close(): void {
    if (this.closedReason !== undefined) return
    this.closedReason = 'the DevTools client was closed'
    this.failAll(this.closedReason)
    try {
      this.socket.close()
    } catch {
      // A socket that already failed its handshake throws here; the pending
      // calls are rejected either way, so there is nothing left to report.
    }
  }

  /** Route one decoded frame to the pending map or the event listeners. */
  private handleMessage(data: WebSocket.RawData): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(data.toString()) as Record<string, unknown>
    } catch {
      return
    }
    const id = message.id
    if (typeof id === 'number') {
      const call = this.pending.get(id)
      if (call === undefined) return
      this.pending.delete(id)
      clearTimeout(call.timer)
      const error = message.error
      if (error !== undefined && error !== null) {
        const shaped = error as { code?: unknown; message?: unknown }
        call.reject(new CdpError(
          call.method,
          typeof shaped.code === 'number' ? shaped.code : -1,
          typeof shaped.message === 'string' ? shaped.message : 'unknown protocol error',
        ))
        return
      }
      call.resolve(message.result ?? {})
      return
    }
    const method = message.method
    if (typeof method !== 'string') return
    const set = this.listeners.get(method)
    if (set === undefined) return
    const params = (message.params ?? {}) as Record<string, unknown>
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId : undefined
    for (const handler of [...set]) {
      try {
        handler(params, sessionId)
      } catch {
        // A listener failure must not stall protocol delivery for the others;
        // the failing action reports through its own command result.
      }
    }
  }

  /** Reject every in-flight command with one reason. */
  private failAll(reason: string): void {
    const first = this.closedReason === undefined
    this.closedReason ??= reason
    if (first) {
      // The connection is gone for good: every close listener runs exactly once,
      // and a listener that throws must not hide the loss from the others.
      const listeners = [...this.closeListeners]
      this.closeListeners.clear()
      for (const listener of listeners) {
        try {
          listener()
        } catch {
          // Reported through the owning session's own state, not through here.
        }
      }
    }
    for (const [id, call] of [...this.pending]) {
      this.pending.delete(id)
      clearTimeout(call.timer)
      call.reject(new CdpError(call.method, -1, reason))
    }
  }
}
