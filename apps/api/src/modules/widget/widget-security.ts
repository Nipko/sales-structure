import type { Request } from 'express';
import type { Socket } from 'socket.io';

function firstHeader(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0]?.trim();
    return value?.split(',')[0]?.trim();
}

export function resolveWidgetHttpIp(request: Request): string {
    return firstHeader(request.headers['cf-connecting-ip'])
        || firstHeader(request.headers['x-forwarded-for'])
        || request.ip
        || request.socket?.remoteAddress
        || 'unknown';
}

export function resolveWidgetSocketIp(client: Socket): string {
    return firstHeader(client.handshake.headers['cf-connecting-ip'])
        || firstHeader(client.handshake.headers['x-forwarded-for'])
        || client.handshake.address
        || 'unknown';
}

function configuredHostname(value: string): string | null {
    const candidate = value.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
    if (!candidate) return null;
    try {
        const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
        return parsed.hostname.toLowerCase();
    } catch {
        return null;
    }
}

export function originHostname(origin: string | undefined): string | null {
    if (!origin || origin === 'null') return null;
    try {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        return parsed.hostname.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * A public widget request must always carry a syntactically valid browser Origin.
 * An empty allowlist means "any valid web origin", never "missing Origin".
 */
/**
 * The dashboard host serves "El enlace de {Nombre}" (/w/{widgetId}), so it is
 * admitted for THAT widget whatever the owner put in allowed_domains.
 *
 * Only for that one. Admitting it for every widget would turn a site widget
 * restricted to shop.example.com into a page anyone can open — or iframe —
 * from the platform's own origin. A missing Origin is still rejected: the rule
 * widens the allowlist, never the requirement of a browser origin.
 */
export function platformWidgetHostnames(env: NodeJS.ProcessEnv = process.env): string[] {
    const hosts = new Set<string>(['admin.parallly-chat.cloud']);
    // Only outside production: in production the dashboard is never on localhost,
    // and admitting it there would let any local page embed any public link.
    if ((env.NODE_ENV || 'development') !== 'production') hosts.add('localhost');
    for (const key of ['DASHBOARD_URL', 'NEXT_PUBLIC_DASHBOARD_URL']) {
        const host = configuredHostname(env[key] || '');
        if (host) hosts.add(host);
    }
    return [...hosts];
}

export function isWidgetOriginAllowed(
    origin: string | undefined,
    allowedDomains: unknown,
    options?: { platformHosted?: boolean },
): boolean {
    const hostname = originHostname(origin);
    if (!hostname) return false;
    if (options?.platformHosted === true && platformWidgetHostnames().includes(hostname)) return true;

    const domains = Array.isArray(allowedDomains)
        ? allowedDomains
            .filter((value): value is string => typeof value === 'string')
            .map(configuredHostname)
            .filter((value): value is string => !!value)
        : [];

    if (domains.length === 0) return true;
    return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}
