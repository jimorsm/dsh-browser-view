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
/**
 * One panel's frame relay. Created per accepted `rtc-offer`; the service keeps
 * it next to the panel's sink and feeds frames through it while it is open.
 */
export declare class RtcFrameRelay {
    /** The werift peer connection; absent until the offer is accepted. */
    private pc;
    /** The unreliable channel the panel created in its offer. */
    private channel;
    /** Whether the channel is open and frames may flow. */
    open: boolean;
    /**
     * Accept the panel's offer and return the local answer as a JSON string
     * (`{type, sdp}`), ready to travel back over the WebSocket.
     * @param offerSdpJson - the panel's `RTCSessionDescriptionInit` as JSON.
     * @param onClosed - called once when the connection fails or closes.
     * @returns the answer description JSON.
     */
    acceptOffer(offerSdpJson: string, onClosed: () => void): Promise<string>;
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
    sendFrame(seq: number, jpeg: Buffer): boolean;
    /** Tear the peer connection down; safe to call more than once. */
    dispose(): void;
}
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
export declare function chunkFrame(seq: number, bytes: Buffer, payloadBytes?: number): Buffer[] | null;
