/**
 * The socket fence and its opt-in CIDR widening: parsing, the allow and deny
 * matrix, and the default (unset or empty means loopback-only, unchanged).
 * Requests are plain objects shaped like IncomingMessage; only the fields the
 * fence reads are present.
 */

import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_CIDRS_ENV,
  cidrMatches,
  forwardedClientAddress,
  parseCidr,
  parseCidrList,
  parseIPv4,
  requestAllowedByCidr,
  requestAllowedThroughProxy,
  parsePublicOriginList,
  PUBLIC_ORIGIN_ENV,
} from '../../src/host/cidr.ts'
import { isRequestFenced } from '../../src/host/routes.ts'

/** A minimal stand-in for one incoming request. */
function requestOf(address: string | undefined, headers: Record<string, string>): IncomingMessage {
  return { socket: { remoteAddress: address }, headers } as unknown as IncomingMessage
}

describe('parseIPv4', () => {
  it('accepts dotted quads and rejects everything else', () => {
    expect(parseIPv4('192.168.1.7')).toBe(((192 << 24) + (168 << 16) + (1 << 8) + 7) >>> 0)
    expect(parseIPv4('0.0.0.0')).toBe(0)
    expect(parseIPv4('256.1.1.1')).toBeUndefined()
    expect(parseIPv4('1.2.3')).toBeUndefined()
    expect(parseIPv4('::1')).toBeUndefined()
    expect(parseIPv4('a.b.c.d')).toBeUndefined()
  })
})

describe('parseCidr', () => {
  it('defaults to /32 and zeroes host bits', () => {
    expect(parseCidr('192.168.1.7')).toEqual({ network: parseIPv4('192.168.1.7'), bits: 32 })
    expect(parseCidr('192.168.1.7/24')).toEqual({ network: parseIPv4('192.168.1.0'), bits: 24 })
    expect(parseCidr('0.0.0.0/0')).toEqual({ network: 0, bits: 0 })
    expect(parseCidr('10.0.0.0/33')).toBeUndefined()
    expect(parseCidr('10.0.0.0/xx')).toBeUndefined()
    expect(parseCidr('10.0.0.0/8/9')).toBeUndefined()
  })
})

describe('parseCidrList', () => {
  it('unset and empty mean no widening', () => {
    expect(parseCidrList(undefined)).toEqual([])
    expect(parseCidrList('')).toEqual([])
    expect(parseCidrList('  ')).toEqual([])
  })

  it('splits on commas and tolerates blank entries', () => {
    expect(parseCidrList('192.168.0.0/16, ,10.0.0.0/8')).toHaveLength(2)
  })

  it('refuses an invalid entry loudly, naming the variable', () => {
    expect(() => parseCidrList('192.168.0.0/16,banana')).toThrow(new RegExp(ALLOWED_CIDRS_ENV))
  })
})

describe('cidrMatches', () => {
  const list = parseCidrList('192.168.1.0/24,127.0.0.0/8')

  it('allows addresses inside a listed range and denies the rest', () => {
    expect(cidrMatches(list, '192.168.1.7')).toBe(true)
    expect(cidrMatches(list, '192.168.1.255')).toBe(true)
    expect(cidrMatches(list, '192.168.2.1')).toBe(false)
    expect(cidrMatches(list, '10.0.0.1')).toBe(false)
  })

  it('unwraps IPv4-mapped forms and never matches pure IPv6', () => {
    expect(cidrMatches(list, '::ffff:192.168.1.7')).toBe(true)
    expect(cidrMatches(list, '::ffff:127.0.0.1')).toBe(true)
    expect(cidrMatches(list, '::1')).toBe(false)
    expect(cidrMatches(list, 'fd00::1')).toBe(false)
  })

  it('a missing address or an empty list admits nothing', () => {
    expect(cidrMatches(list, undefined)).toBe(false)
    expect(cidrMatches([], '192.168.1.7')).toBe(false)
  })
})

describe('requestAllowedByCidr', () => {
  const list = parseCidrList('192.168.1.0/24')

  it('admits a same-origin request from a listed range', () => {
    const req = requestOf('192.168.1.7', { host: '192.168.1.5:3082', origin: 'http://192.168.1.5:3082' })
    expect(requestAllowedByCidr(req, list)).toBe(true)
  })

  it('admits a request without Origin but not a cross-site one', () => {
    expect(requestAllowedByCidr(requestOf('192.168.1.7', { host: '192.168.1.5' }), list)).toBe(true)
    expect(requestAllowedByCidr(requestOf('192.168.1.7', {
      host: '192.168.1.5',
      'sec-fetch-site': 'cross-site',
      origin: 'http://evil.test',
    }), list)).toBe(false)
  })

  it('an address outside the list is denied', () => {
    expect(requestAllowedByCidr(requestOf('10.9.9.9', { host: '192.168.1.5' }), list)).toBe(false)
  })

  it('a forwarded request is denied even inside a listed range', () => {
    const req = requestOf('192.168.1.7', { host: '192.168.1.5', 'x-forwarded-for': '203.0.113.9' })
    expect(requestAllowedByCidr(req, list)).toBe(false)
  })

  it('an empty list admits nothing, keeping the default intact', () => {
    expect(requestAllowedByCidr(requestOf('192.168.1.7', { host: 'x' }), [])).toBe(false)
  })
})

describe('isRequestFenced', () => {
  it('with no widening it is exactly the loopback fence', () => {
    const loopback = requestOf('127.0.0.1', { host: '127.0.0.1:3082' })
    const lan = requestOf('192.168.1.7', { host: '192.168.1.5:3082' })
    expect(isRequestFenced(loopback, { allowedCidrs: [] })).toBe(true)
    expect(isRequestFenced(lan, { allowedCidrs: [] })).toBe(false)
  })

  it('a listed CIDR admits the LAN request while loopback stays allowed', () => {
    const list = parseCidrList('192.168.1.0/24')
    expect(isRequestFenced(requestOf('192.168.1.7', { host: '192.168.1.5:3082' }), { allowedCidrs: list })).toBe(true)
    expect(isRequestFenced(requestOf('127.0.0.1', { host: '127.0.0.1:3082' }), { allowedCidrs: list })).toBe(true)
    expect(isRequestFenced(requestOf('10.0.0.5', { host: '192.168.1.5:3082' }), { allowedCidrs: list })).toBe(false)
  })
})

describe('forwardedClientAddress', () => {
  it('takes the last X-Forwarded-For entry, the nearest proxy vouching', () => {
    expect(forwardedClientAddress(requestOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 100.64.0.11' }))).toBe('100.64.0.11')
    expect(forwardedClientAddress(requestOf('127.0.0.1', { 'x-forwarded-for': '100.64.0.11' }))).toBe('100.64.0.11')
  })

  it('a missing, empty, or non-IPv4 tail yields undefined', () => {
    expect(forwardedClientAddress(requestOf('127.0.0.1', {}))).toBeUndefined()
    expect(forwardedClientAddress(requestOf('127.0.0.1', { 'x-forwarded-for': '  ' }))).toBeUndefined()
    expect(forwardedClientAddress(requestOf('127.0.0.1', { 'x-forwarded-for': '2001:db8::1' }))).toBeUndefined()
    expect(forwardedClientAddress(requestOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, not-an-ip' }))).toBeUndefined()
  })
})

describe('parsePublicOriginList', () => {
  it('unset and empty mean no origins', () => {
    expect(parsePublicOriginList(undefined)).toEqual([])
    expect(parsePublicOriginList('')).toEqual([])
    expect(parsePublicOriginList('  ')).toEqual([])
  })

  it('normalizes entries to origins, collapses duplicates, tolerates blanks', () => {
    expect(parsePublicOriginList('https://100.64.0.10:30082/,, https://10.76.144.1:30082')).toEqual([
      'https://100.64.0.10:30082',
      'https://10.76.144.1:30082',
    ])
    expect(parsePublicOriginList('https://host:30082,https://host:30082')).toEqual(['https://host:30082'])
    expect(parsePublicOriginList('https://host')).toEqual(['https://host'])
  })

  it('refuses a non-URL entry loudly, naming the variable', () => {
    expect(() => parsePublicOriginList('https://ok.test,banana')).toThrow(new RegExp(PUBLIC_ORIGIN_ENV))
    expect(() => parsePublicOriginList('file://x')).toThrow(new RegExp(PUBLIC_ORIGIN_ENV))
  })
})

describe('requestAllowedThroughProxy', () => {
  const allowed = parseCidrList('100.64.0.0/10,10.76.144.0/24')
  const trusted = parseCidrList('127.0.0.0/8')
  const base = {
    allowedCidrs: allowed,
    trustedProxyCidrs: trusted,
    publicOrigins: parsePublicOriginList('https://100.64.0.10:30082,https://10.76.144.1:30082'),
  }

  it('admits a forwarded request whose proxy, client, and Origin all match', () => {
    expect(requestAllowedThroughProxy(requestOf('127.0.0.1', {
      'x-forwarded-for': '100.64.0.11',
      origin: 'https://100.64.0.10:30082',
    }), base)).toBe(true)
    expect(requestAllowedThroughProxy(requestOf('127.0.0.1', {
      'x-forwarded-for': '10.76.144.2',
      origin: 'https://10.76.144.1:30082',
    }), base)).toBe(true)
  })

  it('each missing piece keeps the path closed', () => {
    const req = requestOf('127.0.0.1', { 'x-forwarded-for': '100.64.0.11', origin: 'https://100.64.0.10:30082' })
    expect(requestAllowedThroughProxy(req, { ...base, trustedProxyCidrs: [] })).toBe(false)
    expect(requestAllowedThroughProxy(req, { ...base, publicOrigins: [] })).toBe(false)
    expect(requestAllowedThroughProxy(req, { ...base, allowedCidrs: [] })).toBe(false)
  })

  it('a socket outside the trusted ranges is refused even with matching lists', () => {
    const req = requestOf('10.9.9.9', { 'x-forwarded-for': '100.64.0.11', origin: 'https://100.64.0.10:30082' })
    expect(requestAllowedThroughProxy(req, base)).toBe(false)
  })

  it('a client outside the allowed ranges is refused', () => {
    const req = requestOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.9', origin: 'https://100.64.0.10:30082' })
    expect(requestAllowedThroughProxy(req, base)).toBe(false)
  })

  it('a non-proxy request never enters this path', () => {
    const req = requestOf('100.64.0.11', { origin: 'https://100.64.0.10:30082' })
    expect(requestAllowedThroughProxy(req, base)).toBe(false)
  })

  it('a cross-site fetch or an unlisted Origin is refused', () => {
    expect(requestAllowedThroughProxy(requestOf('127.0.0.1', {
      'x-forwarded-for': '100.64.0.11',
      origin: 'https://100.64.0.10:30082',
      'sec-fetch-site': 'cross-site',
    }), base)).toBe(false)
    expect(requestAllowedThroughProxy(requestOf('127.0.0.1', {
      'x-forwarded-for': '100.64.0.11',
      origin: 'https://evil.test',
    }), base)).toBe(false)
    expect(requestAllowedThroughProxy(requestOf('127.0.0.1', {
      'x-forwarded-for': '100.64.0.11',
    }), base)).toBe(false)
  })
})

describe('isRequestFenced through a trusted proxy', () => {
  const fence = {
    allowedCidrs: parseCidrList('100.64.0.0/10'),
    trustedProxyCidrs: parseCidrList('127.0.0.0/8'),
    publicOrigins: parsePublicOriginList('https://100.64.0.10:30082'),
  }

  it('the proxy path passes the fence end to end', () => {
    const req = requestOf('127.0.0.1', {
      host: '127.0.0.1:3082',
      'x-forwarded-for': '100.64.0.11',
      origin: 'https://100.64.0.10:30082',
    })
    expect(isRequestFenced(req, fence)).toBe(true)
  })

  it('the same forwarded shape stays refused without the proxy widening', () => {
    const req = requestOf('127.0.0.1', {
      host: '127.0.0.1:3082',
      'x-forwarded-for': '100.64.0.11',
      origin: 'https://100.64.0.10:30082',
    })
    expect(isRequestFenced(req, { allowedCidrs: fence.allowedCidrs })).toBe(false)
  })

  it('loopback direct access is unaffected by the proxy configuration', () => {
    expect(isRequestFenced(requestOf('127.0.0.1', { host: '127.0.0.1:3082' }), fence)).toBe(true)
  })
})
