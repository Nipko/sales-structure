import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export const OUTBOUND_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const OUTBOUND_MAX_REQUEST_BYTES = 1024 * 1024;
export const OUTBOUND_DNS_TIMEOUT_MS = 5_000;

export interface PinnedHttpsTarget {
    url: URL;
    hostname: string;
    address: string;
    family: 4 | 6;
    httpsAgent: HttpsAgent;
}

function normalizedHostname(value: string): string {
    return value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/**
 * Parse the portion that is under tenant control before doing any DNS work.
 * Callers still decide which public hostnames and paths make sense for their
 * provider; this function enforces the transport-level invariants shared by
 * every outbound HTTPS integration.
 */
export function parseSafeHttpsUrl(rawValue: unknown, label = 'destino'): URL {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
        throw new BadRequestException(`Falta la URL de ${label}`);
    }

    let parsed: URL;
    try {
        parsed = new URL(rawValue.trim());
    } catch {
        throw new BadRequestException(`URL de ${label} invalida`);
    }

    if (parsed.protocol !== 'https:') {
        throw new BadRequestException(`La URL de ${label} debe usar HTTPS`);
    }
    if (parsed.username || parsed.password) {
        throw new BadRequestException(`La URL de ${label} no puede incluir credenciales`);
    }
    if (parsed.port) {
        throw new BadRequestException(`La URL de ${label} debe usar el puerto HTTPS estandar`);
    }
    if (parsed.hash) {
        throw new BadRequestException(`La URL de ${label} no puede incluir fragmento`);
    }

    const hostname = normalizedHostname(parsed.hostname);
    if (isUnsafeHostname(hostname)) {
        throw new BadRequestException(`Hostname de ${label} no permitido`);
    }

    // Remove a terminal DNS dot so the allowlist, TLS SNI and Host header all
    // use one canonical name. URL keeps the original hostname for the request;
    // assigning it here also prevents a second spelling from bypassing checks.
    parsed.hostname = hostname;
    return parsed;
}

export function isUnsafeHostname(hostnameValue: string): boolean {
    const hostname = normalizedHostname(hostnameValue);
    if (!hostname || isIP(hostname) !== 0) return true;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) {
        return true;
    }
    return hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname.endsWith('.local')
        || hostname.endsWith('.internal')
        || hostname.endsWith('.home')
        || hostname.endsWith('.lan');
}

function ipv6Hextets(rawAddress: string): number[] | null {
    let address = rawAddress.toLowerCase().replace(/^\[|\]$/g, '').split('%', 1)[0];
    const ipv4Match = address.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv4Match) {
        const octets = ipv4Match[1].split('.').map(Number);
        if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
            return null;
        }
        const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
        address = `${address.slice(0, address.length - ipv4Match[1].length)}${replacement}`;
    }

    const halves = address.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

    const values = [
        ...left,
        ...Array.from({ length: Math.max(0, missing) }, () => '0'),
        ...right,
    ].map((part) => Number.parseInt(part, 16));
    if (values.length !== 8 || values.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) {
        return null;
    }
    return values;
}

export function isPrivateOrReservedAddress(rawAddress: string): boolean {
    const address = rawAddress.toLowerCase().replace(/^\[|\]$/g, '').split('%', 1)[0];
    const version = isIP(address);
    if (version === 4) {
        const [a, b, c] = address.split('.').map(Number);
        return a === 0
            || a === 10
            || a === 127
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 0)
            || (a === 192 && b === 88 && c === 99)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19))
            || (a === 198 && b === 51 && c === 100)
            || (a === 203 && b === 0 && c === 113)
            || a >= 224;
    }
    if (version === 6) {
        const hextets = ipv6Hextets(address);
        if (!hextets) return true;

        // IPv4-mapped/compatible IPv6 can otherwise disguise 127.0.0.1 or a
        // metadata address. Translate the final 32 bits and apply IPv4 policy.
        const mappedPrefix = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff;
        if (mappedPrefix) {
            const ipv4 = `${hextets[6] >> 8}.${hextets[6] & 0xff}.${hextets[7] >> 8}.${hextets[7] & 0xff}`;
            return isPrivateOrReservedAddress(ipv4);
        }
        if (hextets.slice(0, 6).every((part) => part === 0)) return true;

        // Today publicly routable unicast IPv6 lives in 2000::/3. Excluding
        // the protocol/special-use blocks inside it also closes Teredo/6to4
        // paths that could encode a private IPv4 destination.
        if ((hextets[0] & 0xe000) !== 0x2000) return true;
        if (hextets[0] === 0x2001 && hextets[1] <= 0x01ff) return true;
        if (hextets[0] === 0x2001 && hextets[1] === 0x0db8) return true;
        if (hextets[0] === 0x2002) return true;
        if ((hextets[0] & 0xfff0) === 0x3ff0) return true;
        return false;
    }
    return true;
}

/**
 * Resolve once, reject mixed public/private answers, and install a lookup
 * callback that always returns that exact public address. Axios therefore
 * cannot perform a second DNS resolution between validation and connection.
 * The request URL still contains the hostname, preserving TLS SNI and Host.
 */
export async function pinSafeHttpsUrl(parsed: URL, label = 'destino'): Promise<PinnedHttpsTarget> {
    const hostname = normalizedHostname(parsed.hostname);
    let addresses: Array<{ address: string; family: number }>;
    try {
        let timer: NodeJS.Timeout | undefined;
        try {
            addresses = await Promise.race([
                dns.lookup(hostname, { all: true, verbatim: true }),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error('DNS lookup deadline exceeded')),
                        OUTBOUND_DNS_TIMEOUT_MS,
                    );
                    timer.unref?.();
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    } catch {
        throw new BadRequestException(`No se pudo resolver de forma segura el hostname de ${label}`);
    }

    if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
        throw new BadRequestException(`El hostname de ${label} resuelve a una red privada o reservada`);
    }

    const pinned = addresses[0];
    const family = isIP(pinned.address);
    if (family !== 4 && family !== 6) {
        throw new BadRequestException(`El hostname de ${label} no devolvio una direccion valida`);
    }

    const lookup: LookupFunction = (requestedHostname, options, callback) => {
        if (normalizedHostname(requestedHostname) !== hostname) {
            const error = Object.assign(new Error('El destino HTTPS cambio despues de validarse'), {
                code: 'EAI_FAIL',
                hostname: requestedHostname,
            }) as NodeJS.ErrnoException;
            callback(error, '', 0);
            return;
        }

        if (options?.all) {
            callback(null, [{ address: pinned.address, family }]);
            return;
        }
        callback(null, pinned.address, family);
    };

    return {
        url: parsed,
        hostname,
        address: pinned.address,
        family,
        httpsAgent: new HttpsAgent({ keepAlive: false, lookup }),
    };
}

export async function prepareSafeHttpsTarget(rawValue: unknown, label = 'destino'): Promise<PinnedHttpsTarget> {
    return pinSafeHttpsUrl(parseSafeHttpsUrl(rawValue, label), label);
}

export function safeAxiosOptions(target: PinnedHttpsTarget, timeout: number) {
    return {
        timeout,
        // Axios' `timeout` is a socket-inactivity timeout. A peer can keep the
        // socket alive indefinitely by dripping bytes below that threshold, so
        // enforce the same value as an absolute wall-clock deadline as well.
        signal: AbortSignal.timeout(timeout),
        maxRedirects: 0,
        maxContentLength: OUTBOUND_MAX_RESPONSE_BYTES,
        maxBodyLength: OUTBOUND_MAX_REQUEST_BYTES,
        proxy: false as const,
        httpsAgent: target.httpsAgent,
    };
}
