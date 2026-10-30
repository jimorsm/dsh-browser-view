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
import type { IncomingMessage } from 'node:http';
/** Environment variable carrying the comma-separated CIDR list. */
export declare const ALLOWED_CIDRS_ENV = "DSH_BROWSER_VIEW_ALLOWED_CIDRS";
/**
 * Environment variable listing the socket ranges a forwarding proxy may sit
 * on. Unset or empty keeps the default posture: any request that carries a
 * forwarding header is refused outright, no matter which other lists exist.
 */
export declare const TRUSTED_PROXY_CIDRS_ENV = "DSH_BROWSER_VIEW_TRUSTED_PROXY_CIDRS";
/**
 * Environment variable carrying the public origin or origins browsers use to
 * reach the GUI through the trusted proxy (`https://host:port`, comma
 * separated when the GUI answers under several names). Required for the proxy
 * path to admit anything: the Host header a proxy rewrites and the Origin
 * header a browser sends describe two different authorities, so the
 * same-origin rule needs the public ones spelled out, not guessed.
 */
export declare const PUBLIC_ORIGIN_ENV = "DSH_BROWSER_VIEW_PUBLIC_ORIGIN";
/** The parsed fence configuration the route family is built with. */
export interface SocketFenceConfig {
    /** Direct (unforwarded) requests from these socket ranges may pass. */
    allowedCidrs: readonly Cidr4[];
    /** Socket ranges a forwarding proxy may sit on; empty or absent disables the proxy path. */
    trustedProxyCidrs?: readonly Cidr4[];
    /** The public origins a trusted-proxy request's Origin must be one of. */
    publicOrigins?: readonly string[];
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
export declare function parsePublicOriginList(raw: string | undefined): string[];
/** One IPv4 CIDR range, address and mask as 32-bit integers. */
export interface Cidr4 {
    /** Network address as a 32-bit integer, host bits already zeroed. */
    network: number;
    /** Prefix length, 0 to 32. */
    bits: number;
}
/**
 * Parse one dotted-quad IPv4 address into a 32-bit integer.
 * @param text - `a.b.c.d`.
 * @returns the integer, or undefined when the octets are not a valid IPv4 address.
 */
export declare function parseIPv4(text: string): number | undefined;
/**
 * Parse one CIDR entry: `a.b.c.d` (host bits implicitly zero) or `a.b.c.d/len`.
 * @param text - one entry, surrounding whitespace allowed.
 * @returns the range, or undefined when the entry is not valid IPv4 CIDR syntax.
 */
export declare function parseCidr(text: string): Cidr4 | undefined;
/**
 * Parse the whole environment value: comma-separated entries; an empty or
 * unset value is an empty list (default fence).
 * @param raw - the env value.
 * @returns the parsed ranges, in order.
 * @throws Error naming the offending entry when one is not valid CIDR syntax.
 */
export declare function parseCidrList(raw: string | undefined, envName?: string): Cidr4[];
/**
 * Whether one socket remote address falls inside any listed range. An
 * IPv4-mapped IPv6 form (`::ffff:192.168.1.7`) is unwrapped first, as the
 * loopback fence already does; a pure IPv6 address (::1 included) never
 * matches an IPv4 list.
 * @param list - the parsed ranges.
 * @param address - the socket remote address.
 * @returns true when the address is inside a listed range.
 */
export declare function cidrMatches(list: readonly Cidr4[], address: string | undefined): boolean;
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
export declare function requestAllowedByCidr(request: IncomingMessage, list: readonly Cidr4[]): boolean;
/**
 * The client address a trusted forwarding proxy vouches for: the last entry
 * of `X-Forwarded-For`, which the nearest proxy appends. Only a dotted quad
 * qualifies; the lists stay IPv4-only, so a forwarded IPv6 client (or a
 * forged non-address) simply does not match.
 * @param request - the incoming request.
 * @returns the address text, or undefined when no usable IPv4 entry exists.
 */
export declare function forwardedClientAddress(request: IncomingMessage): string | undefined;
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
export declare function requestAllowedThroughProxy(request: IncomingMessage, config: SocketFenceConfig): boolean;
