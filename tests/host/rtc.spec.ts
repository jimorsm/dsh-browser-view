/**
 * The DataChannel frame framing: the host half that splits a frame into
 * DataChannel-sized messages, and the panel half that puts them back together.
 *
 * Both are tested against each other rather than against a written-out byte
 * expectation, so a change to one half that the other does not follow fails
 * here instead of freezing a user's panel.
 *
 * @module tests/host/rtc
 */
import { describe, expect, it } from 'vitest'
import { chunkFrame } from '../../src/host/rtc.ts'
import { DC_HEADER_BYTES, FrameAssembler, readFrameChunk } from '../../src/client/frame-assembly.ts'

/** Build a recognisable frame of a given size. */
function frame(bytes: number): Buffer {
  return Buffer.from(Array.from({ length: bytes }, (_, index) => index % 251))
}

/** Feed every chunk through the panel assembler and return the rebuilt frame. */
function reassemble(chunks: Buffer[]): Uint8Array | null {
  const assembler = new FrameAssembler()
  let complete: ArrayBuffer | null = null
  for (const chunk of chunks) {
    const view = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
    const parsed = readFrameChunk(view)
    expect(parsed).not.toBeNull()
    complete = assembler.push(parsed!) ?? complete
  }
  return complete === null ? null : new Uint8Array(complete)
}

describe('chunkFrame', () => {
  it('a frame under one chunk travels as a single message', () => {
    // Given a frame far below the payload size
    const bytes = frame(1_000)
    // When it is chunked
    const chunks = chunkFrame(7, bytes)
    // Then one message carries the frame and says so in its header
    expect(chunks).toHaveLength(1)
    expect(chunks![0]!.readUInt32BE(0)).toBe(7)
    expect(chunks![0]!.readUInt8(4)).toBe(0)
    expect(chunks![0]!.readUInt8(5)).toBe(1)
    expect(chunks![0]!.byteLength).toBe(DC_HEADER_BYTES + bytes.byteLength)
  })

  it('a frame above the payload size is split and rebuilds byte for byte', () => {
    // Given a frame that needs three chunks at a 1 KiB payload
    const bytes = frame(1_000 * 2 + 137)
    // When it is chunked and reassembled
    const chunks = chunkFrame(42, bytes, 1_000)
    // Then the count and indices are exact, and the panel rebuilds the frame
    expect(chunks).toHaveLength(3)
    expect(chunks!.map(chunk => chunk.readUInt8(4))).toEqual([0, 1, 2])
    expect(chunks!.every(chunk => chunk.readUInt8(5) === 3)).toBe(true)
    expect(chunks!.every(chunk => chunk.readUInt32BE(0) === 42)).toBe(true)
    expect(reassemble(chunks!)).toEqual(new Uint8Array(bytes))
  })

  it('every chunk stays inside the DataChannel message cap', () => {
    // Given a frame of the size a heavy page produces (250 KB measured)
    const chunks = chunkFrame(1, frame(250 * 1_024))
    // Then no message exceeds 64 KiB, which is the cap both sides enforce
    expect(chunks).not.toBeNull()
    expect(Math.max(...chunks!.map(chunk => chunk.byteLength))).toBeLessThanOrEqual(64 * 1_024)
  })

  it('a frame too large to express is refused instead of truncated', () => {
    // Given a frame needing more chunks than the count byte can hold
    // When it is chunked with a tiny payload
    const chunks = chunkFrame(1, frame(300), 1)
    // Then nothing is sent, so the caller can fall back to the WebSocket
    expect(chunks).toBeNull()
  })
})

describe('FrameAssembler', () => {
  it('chunks arriving out of order still rebuild the frame', () => {
    // Given a three-chunk frame delivered back to front
    const chunks = chunkFrame(9, frame(2_500), 1_000)!
    // When they are reassembled in that order
    const rebuilt = reassemble([chunks[2]!, chunks[1]!, chunks[0]!])
    // Then the frame is whole
    expect(rebuilt).toEqual(new Uint8Array(frame(2_500)))
  })

  it('a chunk from a newer frame abandons the partial one', () => {
    // Given the first chunk of frame 1 was received
    const assembler = new FrameAssembler()
    const older = chunkFrame(1, frame(2_500), 1_000)!
    const toChunk = (buffer: Buffer) => readFrameChunk(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    )!
    expect(assembler.push(toChunk(older[0]!))).toBeNull()
    // When a complete newer frame arrives as a single chunk
    const newer = chunkFrame(2, frame(600), 1_000)!
    expect(newer).toHaveLength(1)
    // Then the newer frame completes and the abandoned partial frame never
    // reaches the canvas
    expect(new Uint8Array(assembler.push(toChunk(newer[0]!))!)).toEqual(new Uint8Array(frame(600)))
  })

  it('a duplicated chunk is not counted twice', () => {
    // Given a two-chunk frame whose first chunk arrives twice
    const assembler = new FrameAssembler()
    const chunks = chunkFrame(3, frame(1_500), 1_000)!
    const toChunk = (buffer: Buffer) => readFrameChunk(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    )!
    // When the duplicate and then the second chunk arrive
    expect(assembler.push(toChunk(chunks[0]!))).toBeNull()
    expect(assembler.push(toChunk(chunks[0]!))).toBeNull()
    // Then the frame still completes exactly once
    expect(new Uint8Array(assembler.push(toChunk(chunks[1]!))!)).toEqual(new Uint8Array(frame(1_500)))
  })

  it('reset drops a partial frame', () => {
    // Given a partial frame is held
    const assembler = new FrameAssembler()
    const chunks = chunkFrame(4, frame(1_500), 1_000)!
    const toChunk = (buffer: Buffer) => readFrameChunk(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    )!
    assembler.push(toChunk(chunks[0]!))
    // When the transport is reset and the second chunk arrives
    assembler.reset()
    // Then it starts a fresh frame instead of completing the abandoned one
    expect(assembler.push(toChunk(chunks[1]!))).toBeNull()
  })
})

describe('readFrameChunk', () => {
  it('rejects a message shorter than the header', () => {
    // Given a message with no room for a header
    expect(readFrameChunk(new ArrayBuffer(DC_HEADER_BYTES - 1))).toBeNull()
  })

  it('rejects an index outside its own count', () => {
    // Given a header claiming chunk 3 of 1
    const buffer = new ArrayBuffer(DC_HEADER_BYTES + 4)
    const view = new DataView(buffer)
    view.setUint8(4, 3)
    view.setUint8(5, 1)
    expect(readFrameChunk(buffer)).toBeNull()
  })
})
