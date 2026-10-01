import { AuthService } from './auth.service';

describe('onboarding completion replay', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';

    function setup(options: {
        role?: string;
        tenantActive?: boolean;
        tenantCompleted?: boolean;
        userCompleted?: boolean;
        subscription?: any;
    } = {}) {
        const tenant = {
            id: tenantId, name: 'Current business', industry: 'retail',
            schemaName: 'tenant_existing_business', language: 'es-CO', plan: 'pro',
            isActive: options.tenantActive ?? true,
            onboardingCompletedAt: options.tenantCompleted === false ? null : new Date('2026-05-25'),
            settings: { subType: 'moda', businessInfoDraft: { companyName: 'Obsolete draft' } },
        };
        const user = {
            id: userId, email: 'owner@example.com', firstName: 'Owner', lastName: 'Test',
            role: options.role ?? 'tenant_admin', tenantId, isActive: true,
            onboardingCompleted: options.userCompleted ?? true,
            emailVerified: false, emailVerificationState: 'unverified', password: 'existing-hash', tenant,
        };
        const prisma: any = {
            user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn() },
            tenant: { findUnique: jest.fn().mockResolvedValue(tenant), update: jest.fn() },
            billingSubscription: { findUnique: jest.fn().mockResolvedValue(options.subscription === undefined
                ? { status: 'pending_auth', plan: { slug: 'pro' }, metadata: { billingCycle: 'annual' } }
                : options.subscription) },
            createTenantSchema: jest.fn().mockResolvedValue(tenant.schemaName),
            $executeRawUnsafe: jest.fn(),
            $queryRawUnsafe: jest.fn(),
            $transaction: jest.fn(async (run: any) => run(prisma)),
        };
        const redis: any = {
            acquireLockToken: jest.fn().mockResolvedValue('owned-lock'),
            renewLockToken: jest.fn().mockResolvedValue(true),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
            get: jest.fn().mockResolvedValue(null),
            getJson: jest.fn().mockResolvedValue({ sid: 'current-session', tenantId }),
            setJson: jest.fn(), sadd: jest.fn(), del: jest.fn(),
        };
        const businessInfo = { upsertPrimary: jest.fn() };
        const persona = { createDefaultAgentFromGoals: jest.fn() };
        const verticals = {
            bootstrapVertical: jest.fn(),
            getVerticalConfig: jest.fn().mockResolvedValue({ industry: 'retail', subType: 'moda' }),
        };
        const billing = { createTrialSubscription: jest.fn() };
        const coupons = { redeemForTenant: jest.fn() };
        const service = Object.create(AuthService.prototype) as AuthService;
        Object.assign(service, {
            prisma, redis, businessInfoService: businessInfo, personaService: persona,
            verticalsService: verticals, billingService: billing, couponsService: coupons,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        });
        const tokens = jest.spyOn(service as any, 'generateTokens').mockResolvedValue({
            accessToken: 'renewed-access', refreshToken: 'renewed-refresh',
        });
        const createSession = jest.spyOn(service as any, 'createSession').mockResolvedValue('new-session');
        jest.spyOn(service, 'resolveOnboardingFactsForTenant').mockResolvedValue({
            onboardingStage: 'completed', firstReplyAt: '2026-05-26T00:00:00.000Z',
            tenantCreatedAt: '2026-05-25T00:00:00.000Z', hasAnyChannel: true,
        });
        const assertNoProvisioning = () => {
            for (const mutation of [prisma.user.update, prisma.tenant.update, prisma.createTenantSchema,
                prisma.$executeRawUnsafe, prisma.$queryRawUnsafe, prisma.$transaction,
                businessInfo.upsertPrimary, persona.createDefaultAgentFromGoals,
                verticals.bootstrapVertical, billing.createTrialSubscription, coupons.redeemForTenant]) {
                expect(mutation).not.toHaveBeenCalled();
            }
        };
        return { service, prisma, redis, verticals, tokens, createSession, assertNoProvisioning };
    }

    it('recovers the completed session without applying a stale form, coupon or new plan', async () => {
        const h = setup();
        const result = await h.service.completeOnboarding(userId, {
            company: { name: 'Stale form', industry: 'salud' },
            plan: 'starter', billingCycle: 'monthly', couponCode: 'ANOTHER-TRIAL',
        });
        h.assertNoProvisioning();
        expect(result.user).toMatchObject({
            tenantId, tenantName: 'Current business', plan: 'pro', onboardingCompleted: true,
            hasPassword: true, emailVerified: false, emailVerificationState: 'unverified',
            onboardingStage: 'completed', hasAnyChannel: true,
            firstReplyAt: '2026-05-26T00:00:00.000Z', tenantCreatedAt: '2026-05-25T00:00:00.000Z',
        });
        expect(result.billingCheckout).toEqual({
            status: 'pending_auth', requiresPaymentMethod: true, planSlug: 'pro', billingCycle: 'annual',
        });
        expect(h.verticals.getVerticalConfig).toHaveBeenCalledWith(tenantId, 0, {
            mode: 'live', persistence: 'disabled',
        });
        expect(h.tokens).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), { sid: 'current-session' });
        expect(h.createSession).not.toHaveBeenCalled();
        expect(h.redis.releaseLockToken).toHaveBeenCalledTimes(2);
    });

    it.each(['tenant_agent', 'tenant_supervisor', 'super_admin'])(
        'refuses onboarding mutations by %s', async (role) => {
            const h = setup({ role });
            await expect(h.service.completeOnboarding(userId, {})).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'onboarding_not_allowed' }),
            });
            h.assertNoProvisioning();
            expect(h.tokens).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['inactive completed tenant', { tenantActive: false }],
        ['user completed but tenant unfinished', { tenantCompleted: false }],
        ['tenant completed but user unfinished', { userCompleted: false }],
    ])('does not reactivate or reprovision an %s', async (_name, options) => {
        const h = setup(options);
        // JWT validation alone permits this active user; it removes tenant
        // claims rather than blocking onboarding for an unfinished signup.
        const requestUser = await h.service.validateUser({ sub: userId, role: 'tenant_admin' } as any);
        expect(requestUser.id).toBe(userId);
        expect(requestUser.tenantId).toBeUndefined();
        await expect(h.service.completeOnboarding(userId, {})).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'tenant_not_ready' }),
        });
        h.assertNoProvisioning();
        expect(h.tokens).not.toHaveBeenCalled();
    });

    it('does not create a replacement subscription for a completed legacy tenant', async () => {
        const h = setup({ subscription: null });
        const result = await h.service.completeOnboarding(userId, {});
        h.assertNoProvisioning();
        expect(result.billingCheckout).toBeUndefined();
        expect(result.user.tenantId).toBe(tenantId);
    });

    it('repairs only the session link when the first response was lost after completion', async () => {
        const h = setup();
        h.redis.getJson.mockResolvedValue({ sid: 'signup-session', loginAt: 1, lastActivity: 2 });
        await h.service.completeOnboarding(userId, {});
        h.assertNoProvisioning();
        expect(h.redis.setJson).toHaveBeenCalledWith(`session:${userId}`,
            { sid: 'signup-session', loginAt: 1, lastActivity: 2, tenantId }, 360);
        expect(h.redis.sadd).toHaveBeenCalledWith(`tenant_sessions:${tenantId}`, userId);
        expect(h.tokens).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), { sid: 'signup-session' });
        expect(h.createSession).not.toHaveBeenCalled();
    });
});
