// @vitest-environment jsdom
/**
 * The panel-side tab-capture player at its seam: the base64 chunks the wire
 * carries, and the one condition under which the default player must refuse to
 * build rather than fail on every append.
 *
 * jsdom has no `MediaSource`, which is exactly the point: a browser that cannot
 * play the codec must produce the panel's fallback reason, and the tests pin
 * that behaviour instead of pretending MSE exists.
 */
import { describe, expect, it } from 'vitest'
import { CAPTURE_MIME } from '../../src/core/protocol.ts'
import { createMseCapture, decodeCaptureChunk } from '../../src/client/capture.ts'

describe('tab capture chunk decoding', () => {
  it('panel decodes a base64 chunk into the bytes the recorder emitted', () => {
    // Given a chunk as the host framed it
    const bytes = decodeCaptureChunk(btoa('HEADER'))

    // When it is decoded for the player
    // Then the bytes are exactly the recorder's
    expect(bytes).not.toBeNull()
    expect(Array.from(bytes ?? [])).toEqual(Array.from(new TextEncoder().encode('HEADER')))
  })

  it('panel receives a value that is not base64 and the chunk is dropped, not thrown', () => {
    // Given a payload that survived the socket layer's shape check but is not
    // base64 at all
    // When it is decoded
    // Then it yields nothing, because one unreadable chunk is a reason to skip
    // that chunk rather than to tear the lane down
    expect(decodeCaptureChunk('not base64 !!!')).toBeNull()
  })
})

describe('the default capture player', () => {
  it('panel cannot play the capture codec and the player refuses to build', async () => {
    // Given a client environment whose MediaSource cannot take the lane's codec
    // (this is also every jsdom test, which has no MediaSource at all)
    const video = document.createElement('video')

    // When the player is built
    // Then it rejects with a reason the panel can show, instead of creating a
    // source buffer that would refuse every append
    await expect(createMseCapture(video)).rejects.toThrow(new RegExp(`cannot play ${CAPTURE_MIME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  })
})
