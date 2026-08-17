import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { TenantsService, TENANT_PLAN_SLUGS } from './tenants.service';

describe('TenantsService administrative provisioning', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const requestedSchemaName = 'tenant_clinica_norte';
    const effectiveSchemaName = `${requestedSchemaName}_${tenantId.replace(/-/g, '')}`;

    function setup() {
        let storedTenant: any = null;
        let schemaReady = false;
        let activeAgents = 0;
        let verticalConfig: any = null;
        let storedOwner: any = null;
        let storedInvitation: any = null;

        const prisma: any = {
            $transaction: jest.fn().mockImplementation(async (cb: (tx: any) => unknown) => cb(prisma)),
            tenant: {
                findUnique: jest.fn(async ({ where, select }: any) => {
                    const matches = storedTenant && (
                        (where.slug && where.slug === storedTenant.slug)
                        || (where.id && where.id === storedTenant.id)
                    );
                    if (!matches) return null;
                    if (!select) return { ...storedTenant };
                    return Object.fromEntries(
                        Object.keys(select).map((key) => [key, storedTenant[key]]),
                    );
                }),
                create: jest.fn(async ({ data }: any) => {
                    storedTenant = {
                        subscriptionStatus: 'trialing',
                        ...data,
                        id: tenantId,
                    };
                    return { ...storedTenant };
                }),
                update: jest.fn(async ({ data }: any) => {
                    storedTenant = { ...storedTenant, ...data };
                    return { ...storedTenant };
                }),
            },
            user: {
                findUnique: jest.fn(async ({ where }: any) => (
                    storedOwner && where.email === storedOwner.email ? { ...storedOwner } : null
                )),
                create: jest.fn(async ({ data }: any) => {
                    storedOwner = { id: 'owner-1', password: null, ...data };
                    return { ...storedOwner };
                }),
                update: jest.fn(async ({ data }: any) => {
                    storedOwner = { ...storedOwner, ...data };
                    return { ...storedOwner };
                }),
            },
            tenantInvitation: {
                findFirst: jest.fn(async () => storedInvitation ? { id: storedInvitation.id } : null),
            },
            billingPlan: {
                findFirst: jest.fn(async ({ where }: any) => (
                    TENANT_PLAN_SLUGS.includes(where.slug) && where.isActive
                        ? { slug: where.slug }
                        : null
                )),
                findMany: jest.fn(async () => [
                    { slug: 'emprendedor' },
                    { slug: 'starter' },
                    { slug: 'professional' },
                    { slug: 'pro' },
                    { slug: 'enterprise' },
                    { slug: 'custom' },
                ]),
            },
            createTenantSchema: jest.fn(async (schemaName: string) => {
                expect(schemaName).toBe(requestedSchemaName);
                schemaReady = true;
                storedTenant.schemaName = effectiveSchemaName;
                return effectiveSchemaName;
            }),
            $executeRawUnsafe: jest.fn(async (
                sql: string,
                id: string,
                patch: string,
                industry: string | null,
                isActive: boolean | null,
                hasOnboardingCompletedAt: boolean,
                onboardingCompletedAt: string | null,
            ) => {
                if (!sql.includes('UPDATE public.tenants') || id !== storedTenant?.id || !storedTenant) return 0;
                storedTenant = {
                    ...storedTenant,
                    settings: { ...(storedTenant.settings || {}), ...JSON.parse(patch) },
                    ...(industry !== null ? { industry } : {}),
                    ...(isActive !== null ? { isActive } : {}),
                    ...(hasOnboardingCompletedAt
                        ? { onboardingCompletedAt: new Date(onboardingCompletedAt!) }
                        : {}),
                };
                return 1;
            }),
            $queryRawUnsafe: jest.fn(async (sql: string) => {
                if (sql.includes('information_schema.tables')) {
                    return schemaReady
                        ? ['agent_personas', 'companies', 'pipeline_stages', 'faqs']
                            .map((table_name) => ({ table_name }))
                        : [];
                }
                if (sql.includes('.agent_personas WHERE is_active = true')) {
                    return [{ cnt: activeAgents }];
                }
                throw new Error(`Unexpected SQL in test: ${sql}`);
            }),
            auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
        };
        const redis: any = {
            getJson: jest.fn(),
            setJson: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            acquireLockToken: jest.fn(async () => 'provision-lock-token'),
            renewLockToken: jest.fn(async () => true),
            releaseLockToken: jest.fn(async () => undefined),
        };
        const persona: any = {
            createDefaultAgentFromGoals: jest.fn(async () => { activeAgents = 1; }),
        };
        const businessInfo: any = {
            upsertPrimary: jest.fn(async () => ({ id: 'company-1' })),
        };
        const verticals: any = {
            bootstrapVertical: jest.fn(async (_id: string, industry: string, subType: string | null) => {
                if (!storedOwner?.isActive
                    || storedOwner.role !== 'tenant_admin'
                    || storedOwner.tenantId !== storedTenant?.id) {
                    throw new Error('booking owner missing');
                }
                verticalConfig = { industry, subType };
            }),
            getVerticalConfig: jest.fn(async () => verticalConfig),
        };
        const invitations: any = {
            create: jest.fn(async (data: any) => {
                storedInvitation = { id: 'invite-1', ...data };
                return { ...storedInvitation };
            }),
        };
        const throttle: any = {
            enforcePlanLimit: jest.fn(async () => undefined),
        };
        const queue = {} as any;
        const service = new TenantsService(
            prisma,
            redis,
            throttle,
            persona,
            businessInfo,
            verticals,
            invitations,
            queue,
            queue,
            queue,
            queue,
            queue,
        );

        return {
            service,
            prisma,
            redis,
            persona,
            businessInfo,
            verticals,
            invitations,
            throttle,
            getStoredTenant: () => storedTenant,
            getStoredOwner: () => storedOwner,
            setStoredOwner: (owner: any) => { storedOwner = owner; },
            setSchemaReady: (ready: boolean) => { schemaReady = ready; },
        };
    }

    const input = {
        name: 'Clínica Norte',
        slug: 'clinica-norte',
        industry: 'salud',
        subType: 'dental',
        language: 'es-CO',
        plan: 'starter',
        isInternal: true,
        ownerEmail: 'owner@clinicanorte.com',
        ownerFirstName: 'Laura',
        ownerLastName: 'Gómez',
    };

    it('keeps the tenant inactive until all minimum stages pass and uses the effective UUID schema', async () => {
        const ctx = setup();

        const result = await ctx.service.create(input);

        expect(ctx.prisma.tenant.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                isActive: false,
                schemaName: requestedSchemaName,
                industry: 'salud',
                settings: expect.objectContaining({ subType: 'dental' }),
            }),
        }));
        expect(ctx.prisma.createTenantSchema).toHaveBeenCalledWith(requestedSchemaName);
        expect(ctx.prisma.user.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                email: 'owner@clinicanorte.com',
                role: 'tenant_admin',
                tenantId,
                authProvider: 'invitation',
                isActive: true,
            }),
        });
        expect(ctx.persona.createDefaultAgentFromGoals)
            .toHaveBeenCalledWith(tenantId, [], 'super_admin', 'salud', 'dental');
        expect(ctx.businessInfo.upsertPrimary)
            .toHaveBeenCalledWith(tenantId, { companyName: 'Clínica Norte', industry: 'salud' });
        expect(ctx.verticals.bootstrapVertical)
            .toHaveBeenCalledWith(
                tenantId,
                'salud',
                'dental',
                'es',
                expect.objectContaining({ assertLifecycleOwned: expect.any(Function) }),
            );
        expect(ctx.prisma.user.create.mock.invocationCallOrder[0])
            .toBeLessThan(ctx.verticals.bootstrapVertical.mock.invocationCallOrder[0]);
        expect(ctx.invitations.create).toHaveBeenCalledWith({
            tenantId,
            email: 'owner@clinicanorte.com',
            role: 'tenant_admin',
            invitedByUserId: undefined,
        });
        expect(ctx.prisma.$queryRawUnsafe.mock.calls.some(
            ([sql]: [string]) => sql.includes(`"${effectiveSchemaName}".agent_personas`),
        )).toBe(true);
        expect(result).toEqual(expect.objectContaining({
            schemaName: effectiveSchemaName,
            isActive: true,
        }));
        expect(ctx.getStoredTenant().settings.provisioning).toEqual(expect.objectContaining({
            status: 'complete',
            stages: {
                owner: true,
                schema: true,
                agent: true,
                businessInfo: true,
                vertical: true,
                invitation: true,
                activation: true,
            },
        }));
        expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                action: 'tenant_created',
                details: expect.objectContaining({ schemaName: effectiveSchemaName }),
            }),
        }));
        expect(ctx.redis.releaseLockToken)
            .toHaveBeenCalledWith('lock:tenant-provision:slug:clinica-norte', 'provision-lock-token');
    });

    it('always runs the UUID allocator even when a stale placeholder schema looks ready', async () => {
        const ctx = setup();
        ctx.setSchemaReady(true);

        const result = await ctx.service.create(input);

        expect(ctx.prisma.createTenantSchema).toHaveBeenCalledWith(requestedSchemaName);
        expect(result.schemaName).toBe(effectiveSchemaName);
        expect(ctx.prisma.$queryRawUnsafe.mock.calls.some(
            ([sql]: [string]) => sql.includes(`"${effectiveSchemaName}".agent_personas`),
        )).toBe(true);
    });

    it('persists an explicit failed stage and resumes without repeating completed stages', async () => {
        const ctx = setup();
        ctx.verticals.bootstrapVertical.mockRejectedValueOnce(new Error('vertical seed failed'));

        await expect(ctx.service.create(input)).rejects.toBeInstanceOf(InternalServerErrorException);
        expect(ctx.getStoredTenant()).toEqual(expect.objectContaining({ isActive: false }));
        expect(ctx.getStoredTenant().settings.provisioning).toEqual(expect.objectContaining({
            status: 'failed',
            currentStage: 'vertical',
            stages: {
                owner: true,
                schema: true,
                agent: true,
                businessInfo: true,
                vertical: false,
                invitation: false,
                activation: false,
            },
        }));

        const result = await ctx.service.create(input);

        expect(result.isActive).toBe(true);
        expect(ctx.prisma.createTenantSchema).toHaveBeenCalledTimes(1);
        expect(ctx.persona.createDefaultAgentFromGoals).toHaveBeenCalledTimes(1);
        expect(ctx.businessInfo.upsertPrimary).toHaveBeenCalledTimes(1);
        expect(ctx.verticals.bootstrapVertical).toHaveBeenCalledTimes(2);
        expect(ctx.prisma.user.create).toHaveBeenCalledTimes(1);
        expect(ctx.invitations.create).toHaveBeenCalledTimes(1);
        expect(ctx.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('keeps the tenant inactive on invitation failure and retries only that final stage', async () => {
        const ctx = setup();
        ctx.invitations.create.mockRejectedValueOnce(new Error('invitation insert failed'));

        await expect(ctx.service.create(input)).rejects.toBeInstanceOf(InternalServerErrorException);
        expect(ctx.getStoredTenant()).toEqual(expect.objectContaining({ isActive: false }));
        expect(ctx.getStoredTenant().settings.provisioning).toEqual(expect.objectContaining({
            status: 'failed',
            currentStage: 'invitation',
            stages: {
                owner: true,
                schema: true,
                agent: true,
                businessInfo: true,
                vertical: true,
                invitation: false,
                activation: false,
            },
        }));

        await expect(ctx.service.create(input)).resolves.toEqual(expect.objectContaining({ isActive: true }));
        expect(ctx.prisma.user.create).toHaveBeenCalledTimes(1);
        expect(ctx.prisma.createTenantSchema).toHaveBeenCalledTimes(1);
        expect(ctx.persona.createDefaultAgentFromGoals).toHaveBeenCalledTimes(1);
        expect(ctx.businessInfo.upsertPrimary).toHaveBeenCalledTimes(1);
        expect(ctx.verticals.bootstrapVertical).toHaveBeenCalledTimes(1);
        expect(ctx.invitations.create).toHaveBeenCalledTimes(2);
    });

    it('attaches an established unassigned tenant admin without creating a placeholder or invitation', async () => {
        const ctx = setup();
        ctx.setStoredOwner({
            id: 'existing-owner',
            email: input.ownerEmail,
            tenantId: null,
            role: 'tenant_admin',
            isActive: true,
            authProvider: 'email',
            password: 'existing-password-hash',
            emailVerified: true,
        });

        await expect(ctx.service.create(input)).resolves.toEqual(expect.objectContaining({ isActive: true }));

        expect(ctx.prisma.user.create).not.toHaveBeenCalled();
        expect(ctx.prisma.user.update).toHaveBeenCalledWith({
            where: { id: 'existing-owner' },
            data: { tenantId, onboardingCompleted: true },
        });
        expect(ctx.invitations.create).not.toHaveBeenCalled();
        expect(ctx.getStoredOwner()).toEqual(expect.objectContaining({ tenantId }));
    });

    it('keeps an administratively provisioned commercial tenant inactive until billing onboarding', async () => {
        const ctx = setup();

        const result = await ctx.service.create({ ...input, isInternal: false });

        expect(result).toEqual(expect.objectContaining({
            isInternal: false,
            isActive: false,
            onboardingCompletedAt: null,
        }));
        expect(ctx.getStoredOwner()).toEqual(expect.objectContaining({
            onboardingCompleted: false,
        }));
        expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                details: expect.objectContaining({
                    isInternal: false,
                    accessState: 'commercial_onboarding_required',
                }),
            }),
        }));
    });

    it('rejects concurrent provisioning before any stage can run', async () => {
        const ctx = setup();
        ctx.redis.acquireLockToken.mockResolvedValueOnce(null);

        await expect(ctx.service.create(input)).rejects.toBeInstanceOf(ConflictException);
        expect(ctx.getStoredTenant()).toBeNull();
        expect(ctx.prisma.tenant.create).not.toHaveBeenCalled();
        expect(ctx.prisma.createTenantSchema).not.toHaveBeenCalled();
        expect(ctx.persona.createDefaultAgentFromGoals).not.toHaveBeenCalled();
    });

    it('fences before the first insert when renewal can no longer prove ownership', async () => {
        const ctx = setup();
        ctx.redis.renewLockToken
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        await expect(ctx.service.create(input)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'tenant_provisioning_lock_lost' }),
        });
        expect(ctx.prisma.tenant.create).not.toHaveBeenCalled();
        expect(ctx.getStoredTenant()).toBeNull();
    });

    it('does not commit a finished stage or activate the tenant after mid-flow lock loss', async () => {
        const ctx = setup();
        const originalBootstrap = ctx.verticals.bootstrapVertical.getMockImplementation();
        ctx.verticals.bootstrapVertical.mockImplementationOnce(async (...args: any[]) => {
            await originalBootstrap!(...args);
            ctx.redis.renewLockToken.mockResolvedValue(false);
        });

        await expect(ctx.service.create(input)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'tenant_provisioning_lock_lost' }),
        });
        expect(ctx.getStoredTenant().isActive).toBe(false);
        expect(ctx.getStoredTenant().settings.provisioning.stages.vertical).toBe(false);
        expect(ctx.invitations.create).not.toHaveBeenCalled();
    });

    it('revalidates owner ownership before returning an already-complete retry', async () => {
        const ctx = setup();
        await ctx.service.create(input);
        ctx.setStoredOwner({
            ...ctx.getStoredOwner(),
            tenantId: '99999999-9999-4999-8999-999999999999',
        });

        await expect(ctx.service.create(input)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'tenant_owner_invalid' }),
        });
    });

    it('rejects unsupported plan and invalid subtype before creating any tenant', async () => {
        const unsupported = setup();
        await expect(unsupported.service.create({ ...input, plan: 'professional' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(unsupported.prisma.tenant.create).not.toHaveBeenCalled();

        const invalidVertical = setup();
        await expect(invalidVertical.service.create({ ...input, subType: 'hotel' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(invalidVertical.prisma.tenant.create).not.toHaveBeenCalled();

        const invalidLanguage = setup();
        await expect(invalidLanguage.service.create({ ...input, language: 'xx-ZZ' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(invalidLanguage.prisma.tenant.create).not.toHaveBeenCalled();
    });

    it('only publishes active canonical plans and never exposes professional', async () => {
        const { service } = setup();

        await expect(service.getProvisioningPlans()).resolves.toEqual([
            'emprendedor', 'starter', 'pro', 'enterprise', 'custom',
        ]);
    });

    it('blocks vertical drift on edit while accepting the same canonical selection', async () => {
        const ctx = setup();
        await ctx.service.create(input);

        await expect(ctx.service.update(tenantId, {
            industry: 'educacion',
            subType: 'idiomas',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'vertical_migration_required' }),
        });

        await expect(ctx.service.update(tenantId, {
            industry: 'salud',
            subType: 'dental',
            name: 'Clínica Norte Actualizada',
        })).resolves.toEqual(expect.objectContaining({
            industry: 'salud',
            name: 'Clínica Norte Actualizada',
        }));

        await expect(ctx.service.update(tenantId, {
            industry: 'health',
            name: 'Clínica Norte Alias',
        })).resolves.toEqual(expect.objectContaining({
            industry: 'salud',
            name: 'Clínica Norte Alias',
        }));

        await expect(ctx.service.update(tenantId, {
            industry: 'salud',
            subType: 'hotel',
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('merges ordinary settings atomically without overwriting concurrent keys', async () => {
        const ctx = setup();
        await ctx.service.create(input);
        ctx.getStoredTenant().settings.concurrentBillingKey = { status: 'trialing' };
        ctx.getStoredTenant().settings.verticalConfig = { industry: 'salud', subType: 'dental' };

        const updated = await ctx.service.update(tenantId, {
            settings: {
                timezone: 'America/Lima',
                verticalConfig: { industry: 'retail' },
                provisioning: { status: 'forged' },
            },
        });

        expect(updated.settings).toEqual(expect.objectContaining({
            concurrentBillingKey: { status: 'trialing' },
            timezone: 'America/Lima',
        }));
        expect((updated.settings as any).verticalConfig).toEqual(expect.objectContaining({ industry: 'salud' }));
        expect((updated.settings as any).provisioning.status).toBe('complete');
    });

    it('rejects tenantPayments before the generic settings merge', async () => {
        const ctx = setup();
        await ctx.service.create(input);
        const mergeCallsBeforeUpdate = ctx.prisma.$executeRawUnsafe.mock.calls.length;

        await expect(ctx.service.update(tenantId, {
            settings: {
                timezone: 'America/Bogota',
                tenantPayments: { provider: 'wompi', privateKey: 'forged' },
            },
        })).rejects.toMatchObject({
            response: expect.objectContaining({
                error: 'reserved_tenant_setting',
                key: 'tenantPayments',
            }),
        });

        expect(ctx.prisma.$executeRawUnsafe).toHaveBeenCalledTimes(mergeCallsBeforeUpdate);
        expect(ctx.getStoredTenant().settings).not.toHaveProperty('tenantPayments');
    });
});

describe('TenantsService secure tenant detail', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const otherTenantId = '22222222-2222-4222-8222-222222222222';
    const now = new Date('2026-08-11T12:00:00.000Z');

    const databaseRecord = {
        id: tenantId,
        name: 'Clínica Norte',
        slug: 'clinica-norte',
        industry: 'salud',
        language: 'es-CO',
        isActive: true,
        plan: 'pro',
        settings: {
            timezone: 'America/Bogota',
            tenantPayments: {
                provider: 'wompi',
                encryptedPrivateKey: 'ciphertext',
            },
        },
        operatingCurrency: 'COP',
        operatingCurrencyLockedAt: now,
        subscriptionStatus: 'active',
        trialEndsAt: null,
        currentPeriodEnd: now,
        onboardingCompletedAt: now,
        firstChannelConnectedAt: now,
        firstMessageAt: now,
        createdAt: now,
        updatedAt: now,
        schemaName: 'tenant_private_schema',
        paymentProviderCustomerId: 'provider-secret-customer-id',
        channelAccounts: [{
            id: 'channel-1',
            tenantId,
            channelType: 'whatsapp',
            accountId: '+573001112233',
            displayName: 'Soporte',
            accessToken: 'encrypted-access-token',
            refreshToken: 'encrypted-refresh-token',
            webhookSecret: 'webhook-secret',
            metadata: { botToken: 'metadata-secret' },
            isActive: true,
            createdAt: now,
            updatedAt: now,
        }],
        _count: { users: 3 },
    };

    function setup(options?: { cached?: any; record?: any }) {
        const prisma: any = {
            $transaction: jest.fn().mockImplementation(async (cb: (tx: any) => unknown) => cb(prisma)),
            tenant: {
                findUnique: jest.fn(async () => options?.record === undefined
                    ? databaseRecord
                    : options.record),
                findMany: jest.fn(async () => [options?.record === undefined
                    ? databaseRecord
                    : options.record].filter(Boolean)),
                count: jest.fn(async () => options?.record === null ? 0 : 1),
                update: jest.fn(async ({ data }: any) => ({
                    id: tenantId, name: 'Clínica Norte', isInternal: data.isInternal,
                })),
            },
            billingCouponRedemption: { findMany: jest.fn(async () => []) },
            billingSubscription: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
            billingChargeAttempt: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
            auditLog: { create: jest.fn(async () => ({})) },
        };
        const redis: any = {
            getJson: jest.fn(async () => options?.cached ?? null),
            setJson: jest.fn(async () => undefined),
            del: jest.fn(async () => undefined),
        };
        const queue = {} as any;
        const service = new TenantsService(
            prisma,
            redis,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            queue,
            queue,
            queue,
            queue,
            queue,
        );
        return { service, prisma, redis };
    }

    it('invalida la ficha cacheada al marcar un tenant como propio', async () => {
        // La ficha se sirve de una caché de 5 minutos. Sin este del(), el panel
        // seguía mostrando el estado anterior y el operador marcaba sin ver
        // ningún cambio — que es exactamente como se reportó.
        const { service, redis } = setup();

        await service.setInternal(tenantId, true, { userId: 'u1', email: 'admin@x.com' }, 'cuenta de demo');

        expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(`tenant:${tenantId}:detail-safe:v`));
        expect(redis.del).toHaveBeenCalledWith(`sub_internal:${tenantId}`);
    });

    it('deja el motivo y el actor en auditoría al marcar', async () => {
        const { service, prisma } = setup();

        await service.setInternal(tenantId, true, { userId: 'u1', email: 'admin@x.com' }, 'cuenta de demo');

        const [[call]] = prisma.auditLog.create.mock.calls;
        expect(call.data).toMatchObject({
            action: 'tenant.marked_internal',
            details: { reason: 'cuenta de demo', actor: 'admin@x.com' },
        });
    });

    it('rejects cross-tenant reads before touching Redis or Prisma', async () => {
        const { service, prisma, redis } = setup();

        await expect(service.findById(otherTenantId, {
            role: 'tenant_admin',
            tenantId,
        })).rejects.toBeInstanceOf(ForbiddenException);

        expect(redis.getJson).not.toHaveBeenCalled();
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('allows own-tenant and super-admin reads while returning only the allow-listed DTO', async () => {
        const own = setup();

        const result = await own.service.findById(tenantId, {
            role: 'tenant_admin',
            tenantId,
        });

        expect(result).toEqual(expect.objectContaining({
            id: tenantId,
            name: 'Clínica Norte',
            settings: { timezone: 'America/Bogota' },
            _count: { users: 3 },
        }));
        expect(result).not.toHaveProperty('schemaName');
        expect(result).not.toHaveProperty('paymentProviderCustomerId');
        expect(result.channelAccounts).toEqual([{
            id: 'channel-1',
            channelType: 'whatsapp',
            displayName: 'Soporte',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        }]);
        expect(result.channelAccounts[0]).not.toHaveProperty('accountId');
        expect(result.channelAccounts[0]).not.toHaveProperty('accessToken');
        expect(result.channelAccounts[0]).not.toHaveProperty('refreshToken');
        expect(result.channelAccounts[0]).not.toHaveProperty('webhookSecret');
        expect(result.channelAccounts[0]).not.toHaveProperty('metadata');

        expect(own.prisma.tenant.findUnique).toHaveBeenCalledWith({
            where: { id: tenantId },
            select: expect.objectContaining({
                channelAccounts: {
                    select: {
                        id: true,
                        channelType: true,
                        displayName: true,
                        isActive: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            }),
        });
        // Versionada, no la clave legada del modelo completo. El número se
        // matchea por patrón: subirlo es un cambio legítimo cada vez que el DTO
        // cambia de forma, y no tiene por qué romper esta prueba.
        expect(own.redis.getJson).toHaveBeenCalledWith(
            expect.stringContaining(`tenant:${tenantId}:detail-safe:v`),
        );
        expect(own.redis.setJson).toHaveBeenCalledWith(
            expect.stringContaining(`tenant:${tenantId}:detail-safe:v`),
            expect.objectContaining({ data: result }),
            300,
        );

        const administrative = setup();
        await expect(administrative.service.findById(tenantId, {
            role: 'super_admin',
            tenantId: null,
        })).resolves.toEqual(result);
    });

    it('never reads the legacy full-model cache and re-sanitizes the versioned cache', async () => {
        const legacy = setup();
        legacy.redis.getJson.mockImplementation(async (key: string) => (
            key === `tenant:${tenantId}:config`
                ? databaseRecord
                : null
        ));

        await legacy.service.findById(tenantId, { role: 'super_admin' });

        expect(legacy.redis.getJson).toHaveBeenCalledTimes(1);
        expect(legacy.redis.getJson).toHaveBeenCalledWith(
            expect.stringContaining(`tenant:${tenantId}:detail-safe:v`),
        );
        expect(legacy.prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

        const cached = setup({
            cached: { version: 2, data: databaseRecord },
        });
        const cachedResult = await cached.service.findById(tenantId, { role: 'super_admin' });

        expect(cached.prisma.tenant.findUnique).not.toHaveBeenCalled();
        expect(cachedResult.channelAccounts[0]).toEqual({
            id: 'channel-1',
            channelType: 'whatsapp',
            displayName: 'Soporte',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        });
        expect(cachedResult.channelAccounts[0]).not.toHaveProperty('accessToken');
        expect(cachedResult.channelAccounts[0]).not.toHaveProperty('metadata');
        expect(cachedResult.settings).toEqual({ timezone: 'America/Bogota' });
    });

    it('redacts tenantPayments from list results without mutating the database record', async () => {
        const { service } = setup();

        const result = await service.findAll(1, 20);

        expect(result.tenants[0].settings).toEqual({ timezone: 'America/Bogota' });
        expect(databaseRecord.settings).toHaveProperty('tenantPayments');
    });
});
