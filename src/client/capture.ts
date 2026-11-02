/**
 * Panel-side tab-capture player.
 *
 * The host records the watched tab and streams WebM chunks; this module plays
 * them. The player is a `MediaSource` feeding a `<video>`: chunks are appended
 * to one `SourceBuffer` as they arrive, which turns a 200 ms-latency chunk
 * stream into a continuous picture - the nearest thing to `<video>` semantics a
 * browser offers for a byte stream, and the reason the panel does not have to
 * decode anything itself.
 *
 * Two things this module deliberately does not do:
 *
 * - No audio. The recording has no audio track at all (see src/core/capture.ts),
 *   so there is no audio element and no audio code path here. A `<video>` is
 *   still the right element for a video-only stream.
 * - No `<canvas>`. Unlike the pixel lane, there is no per-frame image to paint:
 *   the chunks are an encoded stream, not pictures, and re-decoding them into a
 *   canvas would double the decode work for nothing.
 *
 * Memory. A `SourceBuffer` grows for as long as it is appended to, so this
 * player bounds both ends of that: at most {@link CAPTURE_PENDING_LIMIT} chunks
 * wait for the decoder (a slower-than-realtime panel loses old chunks instead of
 * accumulating them), and played-out media older than {@link CAPTURE_KEEP_SECONDS}
 * is removed from the buffer. That, together with the host's own per-sink socket
 * ceiling, is what keeps a slow panel from growing either process without bound.
 *
 * Loaded behind a factory seam: jsdom has no `MediaSource`, so the panel tests
 * inject their own player exactly as they do for the rrweb replayer.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/client/capture
 */

import { CAPTURE_MIME } from '../core/protocol.ts'

/** Chunks allowed to wait for the decoder before the oldest is dropped. */
export const CAPTURE_PENDING_LIMIT = 8

/** Seconds of played-out media kept in the source buffer. */
export const CAPTURE_KEEP_SECONDS = 30

/** A mounted capture player, as the panel uses it. */
export interface BrowserViewCaptureHandle {
  /** Append one WebM chunk; the recorder's first chunk carries the header. */
  append(chunk: Uint8Array<ArrayBuffer>): void
  /** Detach the element and release the media source. */
  destroy(): void
}

/**
 * Builds a capture player over one video element.
 *
 * A seam, not an abstraction: the real implementation is {@link createMseCapture},
 * and a test supplies its own so the panel's wiring (when a player is built,
 * rebuilt, fed and torn down) is testable without MSE. A factory that throws or
 * rejects is the panel's signal to fall back to the pixel lane with the reason.
 */
export type BrowserViewCaptureFactory = (
  video: HTMLVideoElement,
) => BrowserViewCaptureHandle | Promise<BrowserViewCaptureHandle>

/**
 * Decode one base64 chunk from the wire.
 *
 * Tolerant on purpose: the depth of validation the socket layer already applied
 * is a string, and a string that is not base64 means one unreadable chunk, which
 * is a reason to drop that chunk and keep playing - not to tear the lane down.
 * @param data - base64 as it arrived.
 * @returns the bytes, or null when the value is not decodable.
 */
export function decodeCaptureChunk(data: string): Uint8Array<ArrayBuffer> | null {
  if (typeof atob !== 'function') return null
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

/**
 * The production player: one `MediaSource` and one `SourceBuffer`.
 * @param video - the element the capture is drawn into.
 * @returns the handle the panel keeps until it rebuilds or unmounts.
 * @throws Error when this browser cannot play the capture's codec through MSE.
 */
export async function createMseCapture(video: HTMLVideoElement): Promise<BrowserViewCaptureHandle> {
  // Checked before anything is created, so an unsupported browser produces the
  // panel's fallback reason instead of a source buffer that fails on every
  // append. `MediaSource.isTypeSupported` is the same question the `addSourceBuffer`
  // call below would answer by throwing.
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(CAPTURE_MIME)) {
    throw new Error(`this browser cannot play ${CAPTURE_MIME} through MSE`)
  }
  const mediaSource = new MediaSource()
  const objectUrl = URL.createObjectURL(mediaSource)
  const pending: Array<Uint8Array<ArrayBuffer>> = []
  let sourceBuffer: SourceBuffer | null = null
  let destroyed = false

  /** Append the oldest waiting chunk, if the decoder is free. */
  const appendNext = (): void => {
    if (destroyed || sourceBuffer === null || sourceBuffer.updating) return
    if (mediaSource.readyState !== 'open') return
    const chunk = pending.shift()
    if (chunk === undefined) return
    try {
      sourceBuffer.appendBuffer(chunk)
    } catch {
      // A chunk the decoder refuses (a corrupt one, or a format this build
      // cannot take) is dropped with the rest of the backlog: re-appending it
      // would fail the same way, and the next chunk still plays.
      pending.length = 0
    }
  }

  /** Drop media that has already been played past the retention window. */
  const trim = (): void => {
    if (destroyed || sourceBuffer === null || sourceBuffer.updating) return
    if (mediaSource.readyState !== 'open' || sourceBuffer.buffered.length === 0) return
    const start = sourceBuffer.buffered.start(0)
    const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1)
    if (end - start <= CAPTURE_KEEP_SECONDS) return
    try {
      sourceBuffer.remove(start, end - CAPTURE_KEEP_SECONDS)
    } catch {
      // A remove the browser declines is not a reason to stop playing; the next
      // updateend tries again.
    }
  }

  mediaSource.addEventListener('sourceopen', () => {
    if (destroyed) return
    try {
      sourceBuffer = mediaSource.addSourceBuffer(CAPTURE_MIME)
    } catch {
      return
    }
    sourceBuffer.mode = 'segments'
    sourceBuffer.addEventListener('updateend', () => {
      trim()
      appendNext()
    })
    appendNext()
  })

  video.muted = true
  video.playsInline = true
  video.src = objectUrl
  // Autoplay is allowed for a muted video; a rejection (a stricter policy on
  // some builds) leaves the picture paused rather than dropping the lane.
  void Promise.resolve(video.play()).catch(() => undefined)

  return {
    append(chunk: Uint8Array<ArrayBuffer>): void {
      if (destroyed) return
      pending.push(chunk)
      // The bound: a panel that cannot decode as fast as the host records drops
      // its oldest waiting chunk instead of growing an unbounded backlog.
      while (pending.length > CAPTURE_PENDING_LIMIT) pending.shift()
      appendNext()
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      pending.length = 0
      sourceBuffer = null
      try {
        video.removeAttribute('src')
        video.load()
      } catch {
        // An element already detached needs no second teardown.
      }
      URL.revokeObjectURL(objectUrl)
      if (mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream()
        } catch {
          // Already closed by the element detaching.
        }
      }
    },
  }
}
