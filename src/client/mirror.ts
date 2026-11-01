/**
 * Panel-side DOM mirror renderer.
 *
 * The host streams rrweb recording events; this module turns them back into a
 * live document with rrweb's own replayer, mounted into the stage the panel
 * gives it. Nothing here parses the events: the recording is rrweb's format,
 * replayed by rrweb's replayer, which is the only combination that can render
 * every mutation the recorder knows how to emit.
 *
 * Live, never finished: the replayer is built in `liveMode` and told to start
 * live as soon as it has a checkpoint, then fed events as they arrive. Waiting
 * for a recording to "end" would mean never showing anything, because a page
 * somebody is watching does not end.
 *
 * Loaded lazily and behind a factory seam. rrweb is a large module that only a
 * mirror ever needs, and the panel tests cannot use a real replayer at all
 * (jsdom has no layout and no rrweb-compatible snapshot), so the default
 * factory below is the only place the dependency is touched.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/client/mirror
 */

/** One rrweb recording event, as it arrives over the wire. */
export type RecordedEvent = Parameters<import('rrweb').Replayer['addEvent']>[0]

/**
 * A mounted replayer, as the panel uses it.
 */
export interface BrowserViewMirrorHandle {
  /** Append one live event to the running replay. */
  addEvent(event: unknown): void
  /** Tear the replay down and release its DOM. */
  destroy(): void
}

/**
 * Builds a replayer over one root element.
 *
 * A seam, not an abstraction: the real implementation is {@link createRrwebMirror},
 * and a test supplies its own so the panel's wiring (when a replayer is built,
 * rebuilt, fed and torn down) is testable without rrweb's engine.
 */
export type BrowserViewMirrorFactory = (
  root: HTMLElement,
  events: ReadonlyArray<unknown>,
) => BrowserViewMirrorHandle | Promise<BrowserViewMirrorHandle>

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
export function liveBaseline(events: ReadonlyArray<unknown>): number {
  const first = events[0]
  const timestamp = typeof first === 'object' && first !== null
    ? (first as { timestamp?: unknown }).timestamp
    : undefined
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : Date.now()
}

/**
 * The production factory: rrweb's replayer, in live mode.
 * @param root - element the mirror is mounted into.
 * @param events - the checkpoint batch to draw first; may be empty.
 * @returns the handle the panel keeps until it rebuilds or unmounts.
 */
export async function createRrwebMirror(
  root: HTMLElement,
  events: ReadonlyArray<unknown>,
): Promise<BrowserViewMirrorHandle> {
  const rrweb = await import('rrweb')
  // Built empty and fed by hand rather than handed the batch to its
  // constructor: in live mode a replayer applies what arrives through
  // `addEvent`, and this way the checkpoint batch and the events behind it
  // travel the same path.
  const replayer = new rrweb.Replayer([], { root, liveMode: true })
  replayer.startLive(liveBaseline(events))
  const append = (event: unknown): void => { replayer.addEvent(event as RecordedEvent) }
  for (const event of events) append(event)
  return {
    addEvent: append,
    destroy: () => { replayer.destroy() },
  }
}
