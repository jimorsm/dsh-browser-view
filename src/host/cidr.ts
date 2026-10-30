/**
 * The opt-in widening of the panel socket fence beyond loopback.
 *
 * The default fence is and stays loopback-only (the generated
 * `loopback.ts` copy, whose semantics this module composes with instead of
 * editing). An operator whose GUI is legitimately reached from a trusted
 * network range — a home LAN, a wireguard interface — can list IPv4 CIDRs in
 * `DSH_BROWSER_VIEW_ALLOWED_CIDRS`; a request from an address inside any
 * listed range is then admitted by the same gates the loopback fence applies
 * to its socket half (no forwarding headers, a parseable Host header, no
 * cross-site fetch metadata, same-origin Origin when present).
 *
 * Unset or empty means exactly the previous behavior: widening is opt-in and
 * listable, never implicit. IPv6 ::1 stays loopback always; the list is IPv4
 * only, because the requests that motivate it come from LAN interfaces.
 *
 * A second, separately opt-in path admits forwarding proxies:
 * `DSH_BROWSER_VIEW_TRUSTED_PROXY_CIDRS` lists the socket ranges a reverse
 * proxy may sit on, `DSH_BROWSER_VIEW_ALLOWED_CIDRS` then constrains the
 * forwarded client address from `X-Forwarded-For`, and
 * `DSH_BROWSER_VIEW_PUBLIC_ORIGIN` replaces the same-origin check the proxy
 * invalidates with an explicit list of public origins. Without all three the
 * forwarded refusal is unchanged.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/host/cidr
 */

import type { IncomingMessage } from 'node:http'
import { isProxiedRequest } from './loopback.ts'

/** Environment variable carrying the comma-separated CIDR list. */
export const ALLOWED_CIDRS_ENV = 'DSH_BROWSER_VIEW_ALLOWED_CIDRS'

/**
 * Environment variable listing the socket ranges a forwarding proxy may sit
 * on. Unset or empty keeps the default posture: any request that carries a
 * forwarding header is refused outright, no matter which other lists exist.
 */
export const TRUSTED_PROXY_CIDRS_ENV = 'DSH_BROWSER_VIEW_TRUSTED_PROXY_CIDRS'

/**
 * Environment variable carrying the public origin or origins browsers use to
 * reach the GUI through the trusted proxy (`https://host:port`, comma
 * separated when the GUI answers under several names). Required for the proxy
 * path to admit anything: the Host header a proxy rewrites and the Origin
 * header a browser sends describe two different authorities, so the
 * same-origin rule needs the public ones spelled out, not guessed.
 */
export const PUBLIC_ORIGIN_ENV = 'DSH_BROWSER_VIEW_PUBLIC_ORIGIN'

/** The parsed fence configuration the route family is built with. */
export interface SocketFenceConfig {
  /** Direct (unforwarded) requests from these socket ranges may pass. */
  allowedCidrs: readonly Cidr4[]
  /** Socket ranges a forwarding proxy may sit on; empty or absent disables the proxy path. */
  trustedProxyCidrs?: readonly Cidr4[]
  /** The public origins a trusted-proxy request's Origin must be one of. */
  publicOrigins?: readonly string[]
}

/**
 * Parse the public-origin environment value: comma-separated origins; an
 * empty or unset value is an empty list (the proxy path stays closed).
 * Each entry must parse as an absolute URL; the stored form is its normalized
 * origin (`scheme://host:port`), so a trailing slash or default port in the
 * env never breaks the comparison.
 * @param raw - the env value.
 * @returns the normalized origins, in order, duplicates collapsed.
 * @throws Error naming the offending entry when one is not an absolute URL.
 */
export function parsePublicOriginList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  const origins: string[] = []
  for (const entry of raw.split(',')) {
    const text = entry.trim()
    if (text === '') continue
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      throw new Error(`${PUBLIC_ORIGIN_ENV} entry "${text}" is not an absolute origin like https://host:30082`)
    }
    if (parsed.origin === 'null') {
      throw new Error(`${PUBLIC_ORIGIN_ENV} entry "${text}" is not an absolute origin like https://host:30082`)
    }
    if (!origins.includes(parsed.origin)) origins.push(parsed.origin)
  }
  return origins
}

/** One IPv4 CIDR range, address and mask as 32-bit integers. */
export interface Cidr4 {
  /** Network address as a 32-bit integer, host bits already zeroed. */
  network: number
  /** Prefix length, 0 to 32. */
  bits: number
}

/**
 * Parse one dotted-quad IPv4 address into a 32-bit integer.
 * @param text - `a.b.c.d`.
 * @returns the integer, or undefined when the octets are not a valid IPv4 address.
 */
export function parseIPv4(text: string): number | undefined {
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    value = (value * 256) + octet
  }
  return value >>> 0
}

/**
 * Parse one CIDR entry: `a.b.c.d` (host bits implicitly zero) or `a.b.c.d/len`.
 * @param text - one entry, surrounding whitespace allowed.
 * @returns the range, or undefined when the entry is not valid IPv4 CIDR syntax.
 */
export function parseCidr(text: string): Cidr4 | undefined {
  const [addressText, bitsText, extra] = text.trim().split('/')
  if (extra !== undefined) return undefined
  const address = parseIPv4(addressText ?? '')
  if (address === undefined) return undefined
  if (bitsText === undefined) return { network: address, bits: 32 }
  if (!/^\d{1,2}$/.test(bitsText)) return undefined
  const bits = Number(bitsText)
  if (bits > 32) return undefined
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
  return { network: (address & mask) >>> 0, bits }
}

/**
 * Parse the whole environment value: comma-separated entries; an empty or
 * unset value is an empty list (default fence).
 * @param raw - the env value.
 * @returns the parsed ranges, in order.
 * @throws Error naming the offending entry when one is not valid CIDR syntax.
 */
export function parseCidrList(raw: string | undefined, envName: string = ALLOWED_CIDRS_ENV): Cidr4[] {
  if (raw === undefined || raw.trim() === '') return []
  const list: Cidr4[] = []
  for (const entry of raw.split(',')) {
    if (entry.trim() === '') continue
    const parsed = parseCidr(entry)
    if (parsed === undefined) {
      throw new Error(`${envName} entry "${entry.trim()}" is not an IPv4 CIDR range like 192.168.1.0/24`)
    }
    list.push(parsed)
  }
  return list
}

/**
 * Whether one socket remote address falls inside any listed range. An
 * IPv4-mapped IPv6 form (`::ffff:192.168.1.7`) is unwrapped first, as the
 * loopback fence already does; a pure IPv6 address (::1 included) never
 * matches an IPv4 list.
 * @param list - the parsed ranges.
 * @param address - the socket remote address.
 * @returns true when the address is inside a listed range.
 */
export function cidrMatches(list: readonly Cidr4[], address: string | undefined): boolean {
  if (address === undefined || list.length === 0) return false
  const normalized = address.toLowerCase()
  const v4 = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized
  const value = parseIPv4(v4)
  if (value === undefined) return false
  return list.some(({ network, bits }) => {
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
    return ((value & mask) >>> 0) === network
  })
}

/**
 * The CIDR half of the widened fence: same request-level gates as the
 * loopback fence, but the socket address must sit inside a listed range
 * instead of being loopback. A forwarded request is still refused outright —
 * a proxy in front of the host makes the socket address describe the proxy,
 * and X-Forwarded-For is never evidence for trust.
 * @param request - node HTTP request.
 * @param list - the parsed ranges; an empty list admits nothing.
 * @returns true when the request may pass on CIDR grounds.
 */
export function requestAllowedByCidr(request: IncomingMessage, list: readonly Cidr4[]): boolean {
  if (list.length === 0) return false
  if (isProxiedRequest(request)) return false
  if (!cidrMatches(list, request.socket.remoteAddress)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * The client address a trusted forwarding proxy vouches for: the last entry
 * of `X-Forwarded-For`, which the nearest proxy appends. Only a dotted quad
 * qualifies; the lists stay IPv4-only, so a forwarded IPv6 client (or a
 * forged non-address) simply does not match.
 * @param request - the incoming request.
 * @returns the address text, or undefined when no usable IPv4 entry exists.
 */
export function forwardedClientAddress(request: IncomingMessage): string | undefined {
  const raw = request.headers['x-forwarded-for']
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const entries = raw.split(',')
  const last = entries[entries.length - 1]?.trim()
  if (last === undefined || last === '') return undefined
  return parseIPv4(last) === undefined ? undefined : last
}

/**
 * The trusted-proxy half of the widened fence: a request that arrives through
 * a proxy whose socket address is explicitly listed may name its client via
 * `X-Forwarded-For`, and the client address then has to sit inside the
 * allowed list. The public origin must be configured and match the Origin
 * header, because behind a proxy the rewritten Host header no longer
 * describes the authority the browser actually used. Every default stays
 * closed: without the trusted list, the allowed list, and the public origin,
 * this path admits nothing.
 * @param request - the incoming request.
 * @param config - the parsed fence configuration.
 * @returns true when the forwarded request may pass.
 */
export function requestAllowedThroughProxy(request: IncomingMessage, config: SocketFenceConfig): boolean {
  const trusted = config.trustedProxyCidrs ?? []
  if (trusted.length === 0) return false
  const publicOrigins = config.publicOrigins ?? []
  if (publicOrigins.length === 0) return false
  if (!isProxiedRequest(request)) return false
  if (!cidrMatches(trusted, request.socket.remoteAddress)) return false
  const client = forwardedClientAddress(request)
  if (client === undefined || !cidrMatches(config.allowedCidrs, client)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return false
  try {
    return publicOrigins.includes(new URL(origin).origin)
  } catch {
    return false
  }
}
