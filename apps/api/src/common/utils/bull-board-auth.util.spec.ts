import { bullBoardAuthMiddleware } from './bull-board-auth.util';

describe('Bull Board token gate', () => {
    const token = 'dummy-board-token';

    function run(req: { method?: string; path: string; query?: Record<string, unknown>; headers?: Record<string, unknown> }, configured = token) {
        const res = { statusCode: 200, status: jest.fn(function (this: any, code: number) { this.statusCode = code; return this; }), json: jest.fn() };
        const next = jest.fn();
        bullBoardAuthMiddleware(configured)({ method: 'GET', query: {}, headers: {}, ...req }, res, next);
        return { passed: next.mock.calls.length === 1, status: res.statusCode };
    }

    it('lets static assets through without the token', () => {
        expect(run({ path: '/static/js/main.js' }).passed).toBe(true);
        expect(run({ path: '/favicon.svg' }).passed).toBe(true);
    });

    it('rejects the job API without the token', () => {
        expect(run({ path: '/api/queues' })).toEqual({ passed: false, status: 401 });
    });

    it('does not let a query string impersonate a static asset', () => {
        expect(run({ path: '/api/queues', query: { x: '/static/' } })).toEqual({ passed: false, status: 401 });
        expect(run({ path: '/api/queues', query: { x: 'a.js' } })).toEqual({ passed: false, status: 401 });
    });

    it('never exempts mutating requests, even on a static-looking path', () => {
        expect(run({ method: 'PUT', path: '/api/queues/outbound/pause.js' })).toEqual({ passed: false, status: 401 });
    });

    it('accepts the token by header or query', () => {
        expect(run({ path: '/api/queues', headers: { 'x-admin-token': token } }).passed).toBe(true);
        expect(run({ path: '/api/queues', query: { token } }).passed).toBe(true);
    });

    it('rejects a wrong or non-string token', () => {
        expect(run({ path: '/api/queues', query: { token: 'nope' } }).status).toBe(401);
        expect(run({ path: '/api/queues', query: { token: [token] } }).status).toBe(401);
    });

    it('is disabled when no token is configured', () => {
        expect(run({ path: '/api/queues' }, '' as any).status).toBe(503);
    });
});
