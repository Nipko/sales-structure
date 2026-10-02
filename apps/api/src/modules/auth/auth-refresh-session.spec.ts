jest.mock('bcrypt', () => ({
    hash: () => { throw new Error('Unexpected password hashing in refresh tests'); },
    compare: () => { throw new Error('Unexpected password comparison in refresh tests'); },
}));

import { AuthService } from './auth.service';

describe('refresh rotation remains bound to its original session', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const tenantId = '22222222-2222-4222-8222-222222222222';
    const originalSid = 'original-session';

    function setup(options: {
        legacyWithoutTokenId?: boolean;
        legacyWithoutSessionId?: boolean;
        client?: 'web' | 'mobile';
        initialSession?: { sid: string } | null;
        duringUserLookup?: { sid: string } | null;
        refreshRevoked?: boolean;
    } = {}) {
        let session: { sid: string } | null = options.initialSession === undefined
            ? { sid: originalSid } : options.initialSession;
        const client = options.client ?? 'web';
        const sessionKey = client === 'mobile' ? `session:${userId}:mobile` : `session:${userId}`;
        const decoded = { sub: userId, tid: options.legacyWithoutTokenId ? undefined : 'refresh-id',
            sid: options.legacyWithoutSessionId ? undefined : originalSid, client };
        const redis = {
            getJson: jest.fn(async (key: string) => key === sessionKey ? session
                : key === `refresh:${userId}:refresh-id` && !options.refreshRevoked ? { rememberMe: true } : null),
            del: jest.fn().mockResolvedValue(undefined),
            setJson: jest.fn(async (_key: string, value: { sid: string }) => { session = value; }),
            sadd: jest.fn(),
            getClient: () => ({ sismember: jest.fn().mockResolvedValue(1) }),
        };
        const user = { id: userId, tenantId, email: 'owner@example.test', role: 'tenant_admin', isActive: true };
        const prisma = { user: { findUnique: jest.fn(async () => {
            // Simulate another completed login/logout while the DB lookup was pending.
            if ('duringUserLookup' in options) session = options.duringUserLookup ?? null;
            return user;
        }) } };
        const service = Object.assign(Object.create(AuthService.prototype), {
            redis, prisma,
            jwtService: { verify: jest.fn().mockReturnValue(decoded) },
            configService: { get: jest.fn().mockReturnValue('test-secret') },
        }) as AuthService;
        const tokens = jest.spyOn(service as any, 'generateTokens').mockResolvedValue({
            accessToken: 'renewed-access', refreshToken: 'renewed-refresh',
        });
        const revokeAll = jest.spyOn(service, 'revokeAllUserSessions').mockResolvedValue(undefined);
        const destroySession = jest.spyOn(service as any, 'destroySession').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'resolveReadyTenantIdForUser').mockResolvedValue(tenantId);
        jest.spyOn(service, 'resolveOnboardingFactsForTenant').mockResolvedValue({
            onboardingStage: 'completed', firstReplyAt: null, tenantCreatedAt: null, hasAnyChannel: true,
        });
        return { service, redis, tokens, revokeAll, destroySession, sessionKey, session: () => session };
    }

    it('rotates a valid refresh with its unchanged session and remember-me policy', async () => {
        const h = setup();
        await expect(h.service.refreshToken('signed-refresh')).resolves.toMatchObject({ accessToken: 'renewed-access' });
        expect(h.tokens).toHaveBeenCalledWith(expect.objectContaining({ sub: userId, tenantId }), {
            rememberMe: true, sid: originalSid, clientType: 'web',
        });
        expect(h.redis.del).toHaveBeenCalledWith(`refresh:${userId}:refresh-id`);
        expect(h.redis.setJson).not.toHaveBeenCalled();
    });

    it.each([
        ['a forced login replaced the session', { sid: 'replacement-session' }],
        ['logout or expiry removed the session', null],
    ] as const)('refuses rotation when %s during the user lookup', async (_reason, replacement) => {
        const h = setup({ duringUserLookup: replacement });
        await expect(h.service.refreshToken('signed-refresh')).rejects.toMatchObject({ status: 401 });
        expect(h.tokens).not.toHaveBeenCalled();
        expect(h.redis.setJson).not.toHaveBeenCalled();
        expect(h.revokeAll).not.toHaveBeenCalled();
        expect(h.destroySession).not.toHaveBeenCalled();
        expect(h.session()).toEqual(replacement);
    });

    it.each([{ sid: 'replacement-session' }, null])('also protects a legacy refresh that carries a sid (%j)', async replacement => {
        const h = setup({ legacyWithoutTokenId: true, duringUserLookup: replacement });
        await expect(h.service.refreshToken('signed-refresh')).rejects.toMatchObject({ status: 401 });
        expect(h.tokens).not.toHaveBeenCalled();
        expect(h.redis.del).not.toHaveBeenCalled();
        expect(h.session()).toEqual(replacement);
    });

    it('keeps compatibility for legacy credentials that never carried a sid', async () => {
        const h = setup({ legacyWithoutSessionId: true, legacyWithoutTokenId: true, initialSession: null });
        await expect(h.service.refreshToken('legacy-refresh')).resolves.toMatchObject({ accessToken: 'renewed-access' });
        expect(h.tokens).toHaveBeenCalledWith(expect.any(Object), { sid: undefined, clientType: 'web' });
    });

    it.each([null, { sid: 'replacement-session' }])('rejects a missing or replaced web session before consuming the refresh (%j)', async initialSession => {
        const h = setup({ initialSession });
        await expect(h.service.refreshToken('signed-refresh')).rejects.toMatchObject({ status: 401 });
        expect(h.tokens).not.toHaveBeenCalled();
        expect(h.redis.del).not.toHaveBeenCalled();
    });

    it('preserves mobile TTL recovery with the same signed sid', async () => {
        const h = setup({ client: 'mobile', initialSession: null });
        await expect(h.service.refreshToken('signed-refresh')).resolves.toMatchObject({ accessToken: 'renewed-access' });
        expect(h.redis.setJson).toHaveBeenCalledWith(h.sessionKey, expect.objectContaining({ sid: originalSid, clientType: 'mobile' }), expect.any(Number));
        expect(h.tokens).toHaveBeenCalledWith(expect.any(Object), { rememberMe: true, sid: originalSid, clientType: 'mobile' });
    });

    it('still revokes the client session when an already-consumed refresh is replayed', async () => {
        const h = setup({ refreshRevoked: true });
        await expect(h.service.refreshToken('reused-refresh')).rejects.toMatchObject({ status: 401 });
        expect(h.revokeAll).toHaveBeenCalledWith(userId, 'web');
        expect(h.destroySession).toHaveBeenCalledWith(userId, 'web');
        expect(h.tokens).not.toHaveBeenCalled();
    });
});
