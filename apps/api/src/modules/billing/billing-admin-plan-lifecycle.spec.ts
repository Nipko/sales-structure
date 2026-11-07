import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BillingAdminController, PLAN_SLUG_PATTERN } from './billing-admin.controller';

/**
 * Crear y archivar planes desde el superadmin.
 *
 * Archivar no mueve a nadie: los tenants que ya están en el plan lo conservan.
 * Lo que se corta es asignarlo de nuevo.
 */

const source = {
    id: 'plan-pro', slug: 'pro', name: 'Pro', priceUsdCents: 9900, trialDays: 14, requiresCardForTrial: false,
    maxAgents: 3, maxAiMessages: 20000, features: { maxContacts: 1000, customerPayments: true },
    priceLocalOverrides: { CO: { currency: 'COP', amountCents: 39900000, mpPlanId: 'mp-remote', syncedAmountCents: 39900000, syncedCurrency: 'COP' } },
    isActive: true, sortOrder: 3, updatedAt: new Date('2026-11-01T00:00:00Z'),
};

function harness(plans: Record<string, any> = { pro: source }, tenantsOnPlan = 4) {
    const store: Record<string, any> = { ...plans };
    const tx: any = {
        $queryRawUnsafe: jest.fn(),
        billingPlan: {
            findUnique: jest.fn(async ({ where }: any) => store[where.slug] ?? null),
            findFirst: jest.fn(async () => ({ sortOrder: 7 })),
            create: jest.fn(async ({ data }: any) => (store[data.slug] = { id: `plan-${data.slug}`, ...data })),
            update: jest.fn(async ({ where, data }: any) => (store[where.slug] = { ...store[where.slug], ...data })),
        },
        tenant: { count: jest.fn().mockResolvedValue(tenantsOnPlan) },
        auditLog: { create: jest.fn() },
    };
    const prisma: any = {
        $transaction: jest.fn((fn: any) => fn(tx)),
        billingPlan: { findUnique: jest.fn(async ({ where }: any) => store[where.slug] ?? null) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1', plan: 'pro' }), update: jest.fn() },
        auditLog: { create: jest.fn() },
    };
    const throttle: any = { invalidatePlanCacheForSlug: jest.fn().mockResolvedValue(tenantsOnPlan) };
    const controller = new BillingAdminController({} as any, prisma, throttle, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn((controller as any).logger, 'error').mockImplementation(() => undefined);
    return { controller, tx, prisma, throttle, store };
}

const req = { user: { id: 'admin-1' } };

describe('POST billing-admin/plans', () => {
    it('valida el slug en el DTO', () => {
        expect(PLAN_SLUG_PATTERN.test('plan-basico')).toBe(true);
        for (const slug of ['Pro', '-pro', 'p', 'pro_plus', 'a'.repeat(43)]) expect(PLAN_SLUG_PATTERN.test(slug)).toBe(false);
        const CreateDto = (Reflect.getMetadata('design:paramtypes', BillingAdminController.prototype, 'createPlan') as any[])[0];
        const errors = validateSync(plainToInstance(CreateDto, { slug: 'Mal Slug', name: 'X' }));
        expect(errors.map(error => error.property)).toContain('slug');
    });

    it('copia features, límites y montos de otro plan, sin los ids del proveedor', async () => {
        const h = harness();

        const result = await h.controller.createPlan({ slug: 'pro-lite', name: 'Pro Lite', copyFrom: 'pro',
            features: { toolFamilies: ['faqs', 'appointments'] } } as any, req);

        const data = h.tx.billingPlan.create.mock.calls[0][0].data;
        expect(data).toEqual(expect.objectContaining({
            slug: 'pro-lite', name: 'Pro Lite', priceUsdCents: 9900, maxAgents: 3, maxAiMessages: 20000, trialDays: 14,
            isActive: true, sortOrder: 8,
            features: { maxContacts: 1000, customerPayments: true, toolFamilies: ['faqs', 'appointments'] },
        }));
        expect(data.priceLocalOverrides.CO).toEqual({ currency: 'COP', amountCents: 39900000 });
        expect(JSON.stringify(data.priceLocalOverrides)).not.toContain('mp-remote');
        expect(h.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'billing_plan_created', resource: 'billing-plans/pro-lite' }) });
        expect(h.throttle.invalidatePlanCacheForSlug).toHaveBeenCalledWith('pro-lite');
        expect(result).toMatchObject({ success: true, data: { slug: 'pro-lite', tenantCount: 0 }, cacheInvalidationPending: false });
    });

    it('rechaza un slug que ya existe', async () => {
        const h = harness();
        await expect(h.controller.createPlan({ slug: 'pro', name: 'Otro' } as any, req)).rejects.toMatchObject({ status: 409 });
        expect(h.tx.billingPlan.create).not.toHaveBeenCalled();
    });

    it('rechaza un plan de origen inexistente y campos obligatorios faltantes', async () => {
        const h = harness();
        await expect(h.controller.createPlan({ slug: 'nuevo', name: 'Nuevo', copyFrom: 'ghost' } as any, req)).rejects.toMatchObject({ status: 404 });
        await expect(h.controller.createPlan({ slug: 'nuevo', name: 'Nuevo', priceUsdCents: 100 } as any, req))
            .rejects.toMatchObject({ response: expect.objectContaining({ error: 'plan_fields_required', missing: ['maxAgents', 'maxAiMessages'] }) });
        expect(h.tx.billingPlan.create).not.toHaveBeenCalled();
    });

    it('valida las features contra el registro, incluidas las familias de tools', async () => {
        const h = harness();
        await expect(h.controller.createPlan({ slug: 'nuevo', name: 'Nuevo', copyFrom: 'pro',
            features: { toolFamilies: ['faqs', 'teleportation'] } } as any, req))
            .rejects.toMatchObject({ response: expect.objectContaining({ error: 'invalid_features', unknownKeys: ['toolFamilies.teleportation'] }) });
        await expect(h.controller.createPlan({ slug: 'nuevo', name: 'Nuevo', copyFrom: 'pro', features: { notAFeature: 1 } } as any, req))
            .rejects.toMatchObject({ status: 400 });
        expect(h.tx.billingPlan.create).not.toHaveBeenCalled();
    });
});

describe('archivar y desarchivar planes', () => {
    it('archivar conserva a los tenants, lo reporta, audita e invalida la caché', async () => {
        const h = harness();

        const result = await h.controller.archivePlan('pro', { reason: 'reempaquetado' }, req);

        expect(h.tx.billingPlan.update).toHaveBeenCalledWith({ where: { slug: 'pro' }, data: { isActive: false } });
        expect(h.prisma.tenant.update).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, changed: true, tenantsOnPlan: 4, data: { isActive: false } });
        expect(h.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            action: 'billing_plan_archived', details: { slug: 'pro', tenantsOnPlan: 4, reason: 'reempaquetado' } }) });
        expect(h.throttle.invalidatePlanCacheForSlug).toHaveBeenCalledWith('pro');
    });

    it('es idempotente: archivar un plan ya archivado no audita ni invalida', async () => {
        const h = harness({ pro: { ...source, isActive: false } });
        const result = await h.controller.archivePlan('pro', {}, req);
        expect(result).toMatchObject({ changed: false, tenantsOnPlan: 4 });
        expect(h.tx.billingPlan.update).not.toHaveBeenCalled();
        expect(h.tx.auditLog.create).not.toHaveBeenCalled();
        expect(h.throttle.invalidatePlanCacheForSlug).not.toHaveBeenCalled();
    });

    it('el plan de respaldo no se archiva, ni por el endpoint ni por la edición completa', async () => {
        const h = harness({ starter: { ...source, slug: 'starter' } });
        await expect(h.controller.archivePlan('starter', {}, req)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'default_plan_not_archivable' }) });
        await expect(h.controller.updatePlan('starter', { expectedUpdatedAt: source.updatedAt.toISOString(), isActive: false } as any, req))
            .rejects.toMatchObject({ response: expect.objectContaining({ error: 'default_plan_not_archivable' }) });
        expect(h.tx.billingPlan.update).not.toHaveBeenCalled();
    });

    it('desarchivar vuelve a habilitar el plan', async () => {
        const h = harness({ pro: { ...source, isActive: false } });
        const result = await h.controller.unarchivePlan('pro', {}, req);
        expect(result).toMatchObject({ changed: true, data: { isActive: true } });
        expect(h.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'billing_plan_unarchived' }) });
    });

    it('un plan archivado no se puede asignar a un tenant', async () => {
        const h = harness({ pro: { ...source, isActive: false } });
        await expect(h.controller.setTenantPlan('t1', { planSlug: 'pro' } as any, req)).rejects.toMatchObject({
            status: 404, response: expect.objectContaining({ error: 'plan_archived' }) });
        expect(h.prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('un cambio confirmado no se reporta como fallido si la caché pide reintento', async () => {
        const h = harness();
        h.throttle.invalidatePlanCacheForSlug.mockRejectedValue(new Error('redis down'));
        await expect(h.controller.archivePlan('pro', {}, req)).resolves.toMatchObject({ success: true, cacheInvalidationPending: true });
    });
});
