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

import { RTCPeerConnection } from 'werift'

/** Seconds to wait for ICE gathering before answering with what we have. */
const GATHER_TIMEOUT_MS = 3_000

/**
 * Header in front of every chunk: a big-endian u32 sequence, the chunk index,
 * and the chunk count. Mirrored by DC_HEADER_BYTES in the panel.
 */
const CHUNK_HEADER_BYTES = 6

/**
 * Payload per chunk. A DataChannel message is capped (werift enforces 64 KiB
 * and the browser side caps at the same figure), and a frame routinely exceeds
 * that: a 1280x800 page at quality 50 runs to a few hundred kilobytes, where
 * the same page on JPEG/quality 70 measured 111 KB and a heavy page 250 KB.
 * Chunking keeps one oversized frame from being unsendable.
 */
const CHUNK_PAYLOAD_BYTES = 60 * 1024

/** A frame needing more chunks than the count byte can express is not sent. */
const MAX_CHUNKS = 255

/**
 * One panel's frame relay. Created per accepted `rtc-offer`; the service keeps
 * it next to the panel's sink and feeds frames through it while it is open.
 */
export class RtcFrameRelay {
  /** The werift peer connection; absent until the offer is accepted. */
  private pc: RTCPeerConnection | undefined
  /** The unreliable channel the panel created in its offer. */
  private channel: { send: (data: Buffer) => void } | undefined
  /** Whether the channel is open and frames may flow. */
  open = false

  /**
   * Accept the panel's offer and return the local answer as a JSON string
   * (`{type, sdp}`), ready to travel back over the WebSocket.
   * @param offerSdpJson - the panel's `RTCSessionDescriptionInit` as JSON.
   * @param onClosed - called once when the connection fails or closes.
   * @returns the answer description JSON.
   */
  async acceptOffer(offerSdpJson: string, onClosed: () => void): Promise<string> {
    const pc = new RTCPeerConnection({})
    this.pc = pc
    pc.onDataChannel.subscribe((channel) => {
      this.channel = channel
      channel.stateChanged.subscribe((state) => {
        if (state === 'open') {
          this.open = true
        } else if (state === 'closed') {
          this.open = false
          onClosed()
        }
      })
    })
    pc.connectionStateChange.subscribe((state) => {
      if (state === 'failed' || state === 'closed') {
        this.open = false
        onClosed()
      }
    })
    await pc.setRemoteDescription(JSON.parse(offerSdpJson))
    await pc.setLocalDescription(await pc.createAnswer())
    if (pc.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, GATHER_TIMEOUT_MS)
        pc.iceGatheringStateChange.subscribe((state) => {
          if (state === 'complete') {
            clearTimeout(timer)
            resolve()
          }
        })
      })
    }
    return JSON.stringify(pc.localDescription)
  }

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
  sendFrame(seq: number, jpeg: Buffer): boolean {
    if (!this.open || this.channel === undefined) return false
    const chunks = chunkFrame(seq, jpeg)
    if (chunks === null) return false
    try {
      for (const chunk of chunks) this.channel.send(chunk)
      return true
    } catch {
      return false
    }
  }

  /** Tear the peer connection down; safe to call more than once. */
  dispose(): void {
    this.open = false
    try {
      this.pc?.close()
    } catch {
      // A connection that never finished gathering has nothing to close.
    }
    this.pc = undefined
    this.channel = undefined
  }
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
export function chunkFrame(seq: number, bytes: Buffer, payloadBytes: number = CHUNK_PAYLOAD_BYTES): Buffer[] | null {
  const count = Math.max(1, Math.ceil(bytes.length / payloadBytes))
  if (count > MAX_CHUNKS) return null
  const head = Buffer.alloc(CHUNK_HEADER_BYTES)
  head.writeUInt32BE(seq >>> 0, 0)
  head.writeUInt8(count, 5)
  const chunks: Buffer[] = []
  for (let index = 0; index < count; index += 1) {
    head.writeUInt8(index, 4)
    const start = index * payloadBytes
    chunks.push(Buffer.concat([head, bytes.subarray(start, start + payloadBytes)]))
  }
  return chunks
}
