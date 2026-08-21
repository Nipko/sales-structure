import { AuthService } from './auth.service';

describe('AuthService onboarding provisioning retry', () => {
    it('does not issue a session after a critical failure and repairs idempotently on retry', async () => {
        const tenantId = '11111111-1111-4111-8111-111111111111';
        const userId = '22222222-2222-4222-8222-222222222222';
        const canonicalSchema = 'tenant_store_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const user = {
            id: userId,
            email: 'owner@example.com',
            firstName: 'Owner',
            lastName: 'Test',
            role: 'tenant_admin',
            tenantId,
            onboardingCompleted: false,
        };
        const tenant = {
            name: 'Store',
            industry: 'finanzas',
            language: 'es-CO',
            schemaName: canonicalSchema,
            plan: 'starter',
            billingEmail: null,
            billingCountry: null,
            settings: { subType: 'seguros', chatReasons: ['sales'], timezone: 'America/Bogota' },
        };
        const prisma: any = {
            user: {
                findUnique: jest.fn().mockResolvedValue(user),
                update: jest.fn().mockResolvedValue({}),
            },
            tenant: {
                findUnique: jest.fn().mockResolvedValue(tenant),
                update: jest.fn().mockResolvedValue({}),
            },
            billingSubscription: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
            createTenantSchema: jest.fn().mockResolvedValue(canonicalSchema),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        };
        const readinessTx = {
            tenant: { update: jest.fn().mockResolvedValue({}) },
            user: { update: jest.fn().mockResolvedValue({}) },
        };
        prisma.$transaction = jest.fn().mockImplementation((run: any) => run(readinessTx));
        const redis: any = {
            acquireLockToken: jest.fn().mockResolvedValue('onboarding-lock'),
            renewLockToken: jest.fn().mockResolvedValue(true),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
            getJson: jest.fn().mockResolvedValue(null),
            get: jest.fn().mockResolvedValue(null),
        };
        const persona: any = {
            createDefaultAgentFromGoals: jest.fn().mockResolvedValue(undefined),
        };
        const verticals: any = {
            bootstrapVertical: jest.fn()
                .mockRejectedValueOnce(new Error('injected bootstrap failure'))
                .mockResolvedValueOnce(undefined),
            getVerticalConfig: jest.fn().mockResolvedValue({ industry: 'seguros', subType: 'broker' }),
        };
        const businessInfo: any = { upsertPrimary: jest.fn().mockResolvedValue({}) };
        const billingError: any = new Error('payment method required');
        billingError.response = { error: 'card_required_for_trial' };
        const billing: any = {
            createTrialSubscription: jest.fn()
                .mockRejectedValueOnce(billingError)
                .mockResolvedValueOnce({}),
        };
        const service = new AuthService(
            prisma,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            redis,
            persona,
            businessInfo,
            billing,
            {} as any, // coupons — el alta sin couponCode nunca lo toca
            verticals,
            {} as any,
            {} as any,
        );
        const createSession = jest.spyOn(service as any, 'createSession').mockResolvedValue('session-id');
        const generateTokens = jest.spyOn(service as any, 'generateTokens').mockResolvedValue({
            accessToken: 'access',
            refreshToken: 'refresh',
        });

        await expect(service.completeOnboarding(userId, {} as any))
            .rejects.toThrow('injected bootstrap failure');
        expect(createSession).not.toHaveBeenCalled();
        expect(generateTokens).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.$executeRawUnsafe.mock.calls.some((call: any[]) =>
            String(call[0]).includes('UPDATE public.tenants')
            && call[1] === tenantId
            && JSON.parse(call[2]).subType === 'broker'
            && call[3] === 'seguros',
        )).toBe(true);

        // El segundo intento ya repara el bootstrap, pero billing falla. Aún no
        // se emite sesión ni se marca readiness; el tercer retry termina el alta.
        await expect(service.completeOnboarding(userId, {} as any))
            .rejects.toBe(billingError);
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(createSession).not.toHaveBeenCalled();
        expect(generateTokens).not.toHaveBeenCalled();

        const result = await service.completeOnboarding(userId, {} as any);

        expect(prisma.createTenantSchema).toHaveBeenCalledTimes(3);
        expect(prisma.createTenantSchema).toHaveBeenLastCalledWith(canonicalSchema);
        expect(redis.del).toHaveBeenCalledWith(`tenant:${tenantId}:schema`);
        expect(persona.createDefaultAgentFromGoals).toHaveBeenCalledTimes(3);
        expect(persona.createDefaultAgentFromGoals).toHaveBeenNthCalledWith(
            1,
            tenantId,
            ['sales'],
            'owner@example.com',
            'seguros',
            'broker',
        );
        expect(verticals.bootstrapVertical).toHaveBeenCalledTimes(3);
        expect(verticals.bootstrapVertical).toHaveBeenLastCalledWith(
            tenantId, 'seguros', 'broker', 'es', expect.objectContaining({ assertLifecycleOwned: expect.any(Function) }),
        );
        expect(businessInfo.upsertPrimary).toHaveBeenCalledTimes(3);
        expect(billing.createTrialSubscription).toHaveBeenCalledTimes(2);
        expect(readinessTx.user.update).toHaveBeenCalledWith({
            where: { id: userId },
            data: { onboardingCompleted: true },
        });
        expect(result.user.onboardingCompleted).toBe(true);
        expect(result.verticalConfig).toEqual({ industry: 'seguros', subType: 'broker' });
        expect(redis.releaseLockToken).toHaveBeenCalledTimes(6);

        // If the outer lease is lost while the nested vertical work runs, the
        // next fencing boundary must stop billing/readiness/session writes.
        prisma.user.update.mockClear();
        redis.renewLockToken.mockResolvedValue(true);
        verticals.bootstrapVertical.mockImplementationOnce(async () => {
            redis.renewLockToken.mockResolvedValue(false);
        });
        await expect(service.completeOnboarding(userId, {} as any)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'onboarding_lock_lost' }),
        });
        expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('serializes the full onboarding flow so concurrent requests cannot create orphan tenants', async () => {
        const tenantId = '33333333-3333-4333-8333-333333333333';
        const userId = '44444444-4444-4444-8444-444444444444';
        const user = {
            id: userId,
            email: 'race@example.com',
            firstName: 'Race',
            lastName: 'Owner',
            role: 'tenant_admin',
            tenantId: null,
            onboardingCompleted: false,
        };
        const linkedUser = { ...user, tenantId, onboardingCompleted: false };
        const createdTenant = {
            id: tenantId,
            name: 'Race Store',
            schemaName: 'tenant_race_store',
        };
        const tx = {
            tenant: {
                create: jest.fn().mockResolvedValue(createdTenant),
                update: jest.fn().mockResolvedValue(createdTenant),
            },
            user: { update: jest.fn().mockResolvedValue(linkedUser) },
            auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        const prisma: any = {
            user: {
                findUnique: jest.fn().mockResolvedValue(user),
                update: jest.fn().mockResolvedValue({}),
            },
            tenant: {
                findUnique: jest.fn().mockResolvedValue(null),
                update: jest.fn().mockResolvedValue({}),
            },
            auditLog: { create: jest.fn().mockResolvedValue({}) },
            billingSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
            createTenantSchema: jest.fn().mockResolvedValue(
                'tenant_race_store_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            ),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
            $transaction: jest.fn().mockImplementation((run: any) => run(tx)),
        };
        const redis: any = {
            acquireLockToken: jest.fn()
                .mockResolvedValueOnce('race-onboarding-lock')
                .mockResolvedValueOnce('race-lifecycle-lock')
                .mockResolvedValueOnce(null),
            renewLockToken: jest.fn().mockResolvedValue(true),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
            getJson: jest.fn().mockResolvedValue(null),
            get: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
            sadd: jest.fn().mockResolvedValue(undefined),
        };
        let unblockBootstrap!: () => void;
        let signalBootstrapStarted!: () => void;
        const bootstrapBlocked = new Promise<void>((resolve) => { unblockBootstrap = resolve; });
        const bootstrapStarted = new Promise<void>((resolve) => { signalBootstrapStarted = resolve; });
        const verticals: any = {
            bootstrapVertical: jest.fn().mockImplementation(async () => {
                signalBootstrapStarted();
                await bootstrapBlocked;
            }),
            getVerticalConfig: jest.fn().mockResolvedValue({ industry: 'retail', subType: 'moda' }),
        };
        const persona: any = { createDefaultAgentFromGoals: jest.fn().mockResolvedValue(undefined) };
        const service = new AuthService(
            prisma,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            redis,
            persona,
            { upsertPrimary: jest.fn().mockResolvedValue({}) } as any,
            { createTrialSubscription: jest.fn().mockResolvedValue({}) } as any,
            {} as any, // coupons — el alta sin couponCode nunca lo toca
            verticals,
            {} as any,
            {} as any,
        );
        jest.spyOn(service as any, 'createSession').mockResolvedValue('session-id');
        jest.spyOn(service as any, 'generateTokens').mockResolvedValue({
            accessToken: 'access',
            refreshToken: 'refresh',
        });

        const data = {
            // `retail/marketplace` esta cerrado a altas nuevas y la puerta lo
            // rechaza; esta prueba es sobre concurrencia, no sobre verticales.
            company: { name: 'Race Store', industry: 'retail', subType: 'moda' },
            plan: 'starter',
            goals: ['support'],
        } as any;
        const first = service.completeOnboarding(userId, data);
        await bootstrapStarted;

        await expect(service.completeOnboarding(userId, data)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'onboarding_in_progress' }),
        });
        expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.tenant.create).toHaveBeenCalledTimes(1);

        unblockBootstrap();
        await first;
        expect(persona.createDefaultAgentFromGoals).toHaveBeenCalledWith(
            tenantId,
            ['support'],
            'race@example.com',
            'retail',
            'moda',
        );
        expect(redis.releaseLockToken).toHaveBeenCalledTimes(2);
    });
});
