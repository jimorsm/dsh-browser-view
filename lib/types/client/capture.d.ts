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
/** Chunks allowed to wait for the decoder before the oldest is dropped. */
export declare const CAPTURE_PENDING_LIMIT = 8;
/** Seconds of played-out media kept in the source buffer. */
export declare const CAPTURE_KEEP_SECONDS = 30;
/** A mounted capture player, as the panel uses it. */
export interface BrowserViewCaptureHandle {
    /** Append one WebM chunk; the recorder's first chunk carries the header. */
    append(chunk: Uint8Array<ArrayBuffer>): void;
    /** Detach the element and release the media source. */
    destroy(): void;
}
/**
 * Builds a capture player over one video element.
 *
 * A seam, not an abstraction: the real implementation is {@link createMseCapture},
 * and a test supplies its own so the panel's wiring (when a player is built,
 * rebuilt, fed and torn down) is testable without MSE. A factory that throws or
 * rejects is the panel's signal to fall back to the pixel lane with the reason.
 */
export type BrowserViewCaptureFactory = (video: HTMLVideoElement) => BrowserViewCaptureHandle | Promise<BrowserViewCaptureHandle>;
/**
 * Decode one base64 chunk from the wire.
 *
 * Tolerant on purpose: the depth of validation the socket layer already applied
 * is a string, and a string that is not base64 means one unreadable chunk, which
 * is a reason to drop that chunk and keep playing - not to tear the lane down.
 * @param data - base64 as it arrived.
 * @returns the bytes, or null when the value is not decodable.
 */
export declare function decodeCaptureChunk(data: string): Uint8Array<ArrayBuffer> | null;
/**
 * The production player: one `MediaSource` and one `SourceBuffer`.
 * @param video - the element the capture is drawn into.
 * @returns the handle the panel keeps until it rebuilds or unmounts.
 * @throws Error when this browser cannot play the capture's codec through MSE.
 */
export declare function createMseCapture(video: HTMLVideoElement): Promise<BrowserViewCaptureHandle>;
