import { isIP } from 'node:net';

type HeaderValue = string | string[] | undefined;

export interface HttpPeerRequest {
    headers?: Record<string, HeaderValue>;
    socket?: { remoteAddress?: string | null };
    connection?: { remoteAddress?: string | null };
    ip?: string;
}

export interface TrustedClientIpOptions {
    /** Comma-separated IPv4 CIDRs or exact IPv4/IPv6 peers allowed to forward. */
    trustedProxyCidrs?: string;
    /**
     * Production's Cloudflare Tunnel reaches the API through Docker's private
     * network. This default is deliberately disabled outside production; local
     * or directly exposed servers must opt in with TRUSTED_PROXY_CIDRS.
     */
    trustPrivateProductionProxy?: boolean;
}

function firstHeader(value: HeaderValue): string | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(',')[0]?.trim() || undefined;
}

/** Normalize the forms Node commonly uses for socket peers. */
export function normalizeIpAddress(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    let candidate = value.trim();
    if (!candidate) return null;

    const bracketed = candidate.match(/^\[([^\]]+)](?::\d+)?$/);
    if (bracketed) candidate = bracketed[1];
    if (candidate.toLowerCase().startsWith('::ffff:')) candidate = candidate.slice(7);

    // IPv4 peers are occasionally rendered with a port by test/proxy adapters.
    const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort) candidate = ipv4WithPort[1];

    // Zone identifiers are meaningful only on the local link, not in a rate key.
    const zoneIndex = candidate.indexOf('%');
    if (zoneIndex >= 0) candidate = candidate.slice(0, zoneIndex);

    return isIP(candidate) ? candidate.toLowerCase() : null;
}

function ipv4Number(ip: string): number | null {
    if (isIP(ip) !== 4) return null;
    return ip.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function matchesIpv4Cidr(ip: string, cidr: string): boolean {
    const [networkRaw, prefixRaw] = cidr.split('/');
    const network = normalizeIpAddress(networkRaw);
    const addressValue = ipv4Number(ip);
    const networkValue = network ? ipv4Number(network) : null;
    const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw);
    if (addressValue === null || networkValue === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        return false;
    }
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (addressValue & mask) === (networkValue & mask);
}

function isExactOrIpv4CidrMatch(ip: string, rule: string): boolean {
    const candidate = rule.trim();
    if (!candidate) return false;
    if (!candidate.includes('/')) return normalizeIpAddress(candidate) === ip;
    return matchesIpv4Cidr(ip, candidate);
}

const PRIVATE_PROXY_CIDRS = [
    '127.0.0.0/8',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16',
];

function isTrustedProxy(peerIp: string, options: TrustedClientIpOptions): boolean {
    const configuredRules = (options.trustedProxyCidrs || '')
        .split(',')
        .map(rule => rule.trim())
        .filter(Boolean);
    if (configuredRules.some(rule => isExactOrIpv4CidrMatch(peerIp, rule))) return true;

    // IPv6 loopback is the only implicit IPv6 proxy peer. Operators using an
    // IPv6 proxy subnet must list its concrete address in TRUSTED_PROXY_CIDRS.
    if (options.trustPrivateProductionProxy && peerIp === '::1') return true;
    return !!options.trustPrivateProductionProxy
        && PRIVATE_PROXY_CIDRS.some(rule => matchesIpv4Cidr(peerIp, rule));
}

/**
 * Resolve the real client without trusting forwarding headers from a direct
 * internet peer. Cloudflare's header wins only when the TCP peer is an approved
 * reverse proxy; X-Forwarded-For is a secondary fallback for another approved
 * proxy that is responsible for sanitizing that header.
 */
export function resolveTrustedClientIp(
    request: HttpPeerRequest,
    options: TrustedClientIpOptions = {},
): string {
    const peerIp = normalizeIpAddress(
        request.socket?.remoteAddress
        || request.connection?.remoteAddress
        || request.ip,
    );
    if (!peerIp) return 'unknown';

    if (isTrustedProxy(peerIp, options)) {
        const cloudflareIp = normalizeIpAddress(firstHeader(request.headers?.['cf-connecting-ip']));
        if (cloudflareIp) return cloudflareIp;

        const forwardedIp = normalizeIpAddress(firstHeader(request.headers?.['x-forwarded-for']));
        if (forwardedIp) return forwardedIp;
    }

    return peerIp;
}
