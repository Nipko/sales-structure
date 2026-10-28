import { timingSafeEqual } from 'crypto';

const STATIC_ASSET = /^\/static\/|\.(js|css|svg)$/;

function tokenMatches(candidate: unknown, expected: string): boolean {
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Gate for the Bull Board UI mounted at /api/v1/admin/queues.
 *
 * Static assets are let through without the token, but the decision is made
 * on `req.path` (no query string) and only for GET/HEAD. Testing `req.url`
 * let `GET .../api/queues?x=/static/` reach the job API unauthenticated.
 */
export function bullBoardAuthMiddleware(token: string | undefined) {
    return (req: any, res: any, next: any) => {
        if (!token) {
            return res.status(503).json({ message: 'Bull Board disabled — BULL_BOARD_TOKEN not configured' });
        }
        const isRead = req.method === 'GET' || req.method === 'HEAD';
        if (isRead && STATIC_ASSET.test(req.path ?? '')) {
            return next();
        }
        if (!tokenMatches(req.query?.token, token) && !tokenMatches(req.headers?.['x-admin-token'], token)) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        next();
    };
}
