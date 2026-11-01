/**
 * A scriptable stand-in for the CDP transport.
 *
 * Every host-side layer above `src/core/cdp.ts` only needs `send` and `on`, so
 * the tests drive tabs, snapshots, actions, and the service with this fake
 * instead of starting a browser. Each `send` is recorded (method, params,
 * session) and answered from `responses`; `emit` plays a protocol event back.
 *
 * @module tests/helpers/fake-cdp
 */

import type { CdpEventListener, CdpTransport } from '../../src/core/cdp.ts'

/** One recorded protocol command. */
export interface RecordedCall {
  method: string
  params: Record<string, unknown>
  sessionId: string | undefined
}

/** One scripted response; a function receives the command params. */
export type FakeResponse = unknown | ((params: Record<string, unknown>) => unknown)

/**
 * In-memory {@link CdpTransport}.
 */
export class FakeTransport implements CdpTransport {
  /** Every command sent through this transport, in order. */
  readonly calls: RecordedCall[] = []
  /** Method to response map. */
  readonly responses = new Map<string, FakeResponse>()
  /** Event name to subscribers. */
  readonly listeners = new Map<string, Set<CdpEventListener>>()
  /** Set by `close`. */
  closed = false
  /** Listeners waiting for the connection to end. */
  private readonly closeListeners = new Set<() => void>()
  /** Called synchronously for every command, before it resolves. */
  onSend: ((call: RecordedCall) => void) | undefined

  /** Record and answer one command. */
  async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const call: RecordedCall = { method, params, sessionId }
    this.calls.push(call)
    this.onSend?.(call)
    const response = this.responses.get(method)
    const value = typeof response === 'function'
      ? (response as (params: Record<string, unknown>) => unknown)(params)
      : response
    return (value ?? {}) as T
  }

  /** Subscribe one handler. */
  on(method: string, handler: CdpEventListener): () => void {
    let set = this.listeners.get(method)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(method, set)
    }
    set.add(handler)
    return () => { set?.delete(handler) }
  }

  /**
   * Run `listener` when the transport closes, as the real client does for a
   * dropped DevTools socket; an already-closed transport runs it immediately.
   * @param listener - callback for the loss of the connection.
   * @returns an unsubscribe function.
   */
  onClose(listener: () => void): () => void {
    if (this.closed) listener()
    else this.closeListeners.add(listener)
    return () => { this.closeListeners.delete(listener) }
  }

  /** Mark the transport closed and tell everyone waiting on it. */
  close(): void {
    this.closed = true
    const listeners = [...this.closeListeners]
    this.closeListeners.clear()
    for (const listener of listeners) listener()
  }

  /** Deliver one protocol event to its subscribers. */
  emit(method: string, params: Record<string, unknown> = {}, sessionId?: string): void {
    for (const handler of [...this.listeners.get(method) ?? []]) handler(params, sessionId)
  }

  /** Every recorded call of one method. */
  callsOf(method: string): RecordedCall[] {
    return this.calls.filter(call => call.method === method)
  }

  /** The last recorded call of one method, or undefined. */
  lastCall(method: string): RecordedCall | undefined {
    return this.callsOf(method).at(-1)
  }
}
