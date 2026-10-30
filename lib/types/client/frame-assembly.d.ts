/**
 * The panel half of the DataChannel frame framing: the exact counterpart of
 * chunkFrame in host/rtc.ts.
 *
 * A frame larger than one DataChannel message arrives as several chunks. The
 * channel is unordered and unreliable on purpose (a dropped picture beats a
 * stalled one), so chunks can arrive out of order or not at all, and a chunk
 * belonging to a newer frame can overtake the tail of the previous one. The
 * assembler therefore keys everything on the frame's sequence number and drops
 * a partial frame the moment a newer one starts - a late chunk can never
 * complete a stale picture onto the canvas.
 *
 * Pure and DOM-free, so the two halves of the framing are tested against each
 * other instead of against a hand-written expectation.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/client/frame-assembly
 */
/** Header bytes in front of every chunk: u32 sequence, u8 index, u8 count. */
export declare const DC_HEADER_BYTES = 6;
/** One decoded chunk header plus its payload. */
export interface FrameChunk {
    /** Frame the chunk belongs to. */
    seq: number;
    /** Zero-based position within the frame. */
    index: number;
    /** How many chunks the frame was split into. */
    count: number;
    /** The chunk's bytes. */
    payload: ArrayBuffer;
}
/**
 * Read one DataChannel message.
 * @param data - the raw message.
 * @returns the chunk, or null when the message is not a well-formed chunk.
 */
export declare function readFrameChunk(data: ArrayBuffer): FrameChunk | null;
/** Reassembles chunked frames, one frame at a time. */
export declare class FrameAssembler {
    private partial;
    /**
     * Offer one chunk.
     * @param chunk - a chunk from {@link readFrameChunk}.
     * @returns the complete frame bytes, or null while it is still incomplete.
     */
    push(chunk: FrameChunk): ArrayBuffer | null;
    /** Drop whatever partial frame is held; called when the transport changes. */
    reset(): void;
}
