import { BusinessInfoService } from '../business-info/business-info.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ServicesService } from '../appointments/services.service';
import { InventoryService } from '../inventory/inventory.service';
import { InternalController } from '../internal/internal.controller';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from './agent-quality-events';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_quality_dependencies';

describe('Agent Quality dependency mutation events', () => {
    it('emits business identity only after a successful durable upsert', async () => {
        const row = {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Parallly', about: 'Asistente comercial', is_primary: true,
            social_links: {}, created_at: new Date(), updated_at: new Date(),
        };
        const events = { emit: jest.fn() };
        const prisma: any = {
            $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
            $queryRawUnsafe: jest.fn(async (sql: string) =>
                sql.includes('SELECT id') ? [] : [row]),
        };
        const service = new BusinessInfoService(
            prisma,
            { del: jest.fn() } as any,
            { getSchemaName: jest.fn().mockResolvedValue(SCHEMA) } as any,
            events as any,
        );

        await service.upsertPrimary(TENANT_ID, {
            companyName: 'Parallly',
            about: 'Asistente comercial',
        });

        expect(events.emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId: TENANT_ID,
            source: 'business_info',
        });

        events.emit.mockClear();
        prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id')) return [];
            throw new Error('insert failed');
        });
        await expect(service.upsertPrimary(TENANT_ID, { companyName: 'Fallará' })).rejects.toThrow('insert failed');
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('emits after a knowledge document deletion and never before a failed delete', async () => {
        const events = { emit: jest.fn() };
        const prisma: any = {
            getTenantSchemaName: jest.fn().mockResolvedValue(SCHEMA),
            executeInTenantSchema: jest.fn().mockResolvedValue(undefined),
        };
        const redis: any = {
            tenantKey: jest.fn((_tenantId: string, suffix: string) => `tenant:${TENANT_ID}:${suffix}`),
            del: jest.fn().mockResolvedValue(undefined),
        };
        const service = new KnowledgeService(
            prisma, redis, {} as any, {} as any, {} as any, {} as any, events as any,
        );

        await service.deleteDocument(TENANT_ID, '33333333-3333-4333-8333-333333333333');
        expect(events.emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId: TENANT_ID,
            source: 'knowledge',
        });

        events.emit.mockClear();
        prisma.executeInTenantSchema.mockRejectedValueOnce(new Error('delete failed'));
        await expect(service.deleteDocument(TENANT_ID, '33333333-3333-4333-8333-333333333333'))
            .rejects.toThrow('delete failed');
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('emits after a bookable service is persisted and readable', async () => {
        const events = { emit: jest.fn() };
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) =>
                sql.includes('SELECT * FROM services') ? [{
                    id: '44444444-4444-4444-8444-444444444444',
                    name: 'Consulta', duration_minutes: 30, buffer_minutes: 0,
                    price: '0', currency: 'COP', color: '#6c5ce7', is_active: true,
                    required_fields: [],
                }] : []),
        };
        const service = new ServicesService(
            prisma,
            { del: jest.fn().mockResolvedValue(undefined) } as any,
            events as any,
        );

        await service.create(SCHEMA, { name: 'Consulta', durationMinutes: 30 }, TENANT_ID);

        expect(events.emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId: TENANT_ID,
            source: 'services',
        });
    });

    it('emits after an inventory product is committed', async () => {
        const events = { emit: jest.fn() };
        const prisma: any = {
            executeInTenantSchema: jest.fn().mockResolvedValue([
                { id: '55555555-5555-4555-8555-555555555555' },
            ]),
        };
        const redis: any = {
            get: jest.fn(async (key: string) => key.startsWith('tenant:') ? SCHEMA : 'true'),
        };
        const service = new InventoryService(prisma, redis, events as any);

        await service.createProduct(TENANT_ID, {
            name: 'Producto', sku: 'SKU-1', price: 10, stock: 1,
        });

        expect(events.emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId: TENANT_ID,
            source: 'catalog',
        });
    });

    it('bridges the trusted WhatsApp process into the same tenant dependency event', async () => {
        const events = { emit: jest.fn() };
        const controller = new InternalController(
            {} as any, {} as any, {} as any, events as any,
        );

        await expect(controller.agentQualityChannelUpdated(
            { user: { isInternalService: true } },
            { tenantId: TENANT_ID },
        ))
            .resolves.toEqual({ accepted: true });
        expect(events.emit).toHaveBeenCalledWith(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId: TENANT_ID,
            source: 'channel_credential',
        });
    });

    it('rejects dashboard JWT callers and malformed tenant ids on the internal bridge', async () => {
        const events = { emit: jest.fn() };
        const controller = new InternalController(
            {} as any, {} as any, {} as any, events as any,
        );

        await expect(controller.agentQualityChannelUpdated(
            { user: { isInternalService: false } },
            { tenantId: TENANT_ID },
        )).rejects.toMatchObject({ status: 403 });
        await expect(controller.agentQualityChannelUpdated(
            { user: { isInternalService: true } },
            { tenantId: 'not-a-tenant-id' },
        )).rejects.toMatchObject({ status: 400 });
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('keeps every internal endpoint unavailable to dashboard JWT callers', async () => {
        const inboundQueue = { enqueue: jest.fn() };
        const throttle = { enforceChannelAccountLimit: jest.fn() };
        const prisma = { channelAccount: { count: jest.fn() } };
        const controller = new InternalController(
            prisma as any, throttle as any, inboundQueue as any, { emit: jest.fn() } as any,
        );
        const dashboardRequest = { user: { isInternalService: false } };

        await expect(controller.receiveInboundMessage(dashboardRequest, {
            id: 'provider-message',
            tenantId: TENANT_ID,
            channelType: 'whatsapp',
            channelAccountId: 'phone-number-id',
            contactId: 'contact-id',
            conversationId: 'conversation-id',
            direction: 'inbound',
            content: { type: 'text', text: 'hello' },
            timestamp: new Date(),
            status: 'delivered',
            metadata: {},
        })).rejects.toMatchObject({ status: 403 });
        await expect(controller.channelAccountQuotaCheck(
            dashboardRequest,
            { tenantId: TENANT_ID, channelType: 'whatsapp' },
        )).rejects.toMatchObject({ status: 403 });
        expect(inboundQueue.enqueue).not.toHaveBeenCalled();
        expect(prisma.channelAccount.count).not.toHaveBeenCalled();
        expect(throttle.enforceChannelAccountLimit).not.toHaveBeenCalled();
    });

    it('accepts bounded internal inbound and quota requests after validating tenant and channel', async () => {
        const inboundQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
        const throttle = { enforceChannelAccountLimit: jest.fn().mockResolvedValue(undefined) };
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue({
                subscriptionStatus: 'active',
                subscription: {
                    status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null,
                },
            }) },
            channelAccount: { count: jest.fn().mockResolvedValue(1) },
        };
        const controller = new InternalController(
            prisma as any, throttle as any, inboundQueue as any, { emit: jest.fn() } as any,
        );
        const internalRequest = { user: { isInternalService: true } };
        const payload = {
            id: 'provider-message',
            tenantId: TENANT_ID,
            channelType: 'whatsapp' as const,
            channelAccountId: 'phone-number-id',
            contactId: 'contact-id',
            conversationId: 'conversation-id',
            direction: 'inbound' as const,
            content: { type: 'text' as const, text: 'hello' },
            timestamp: new Date(),
            status: 'delivered' as const,
            metadata: {},
        };

        await expect(controller.receiveInboundMessage(internalRequest, payload))
            .resolves.toEqual({ received: true });
        await expect(controller.channelAccountQuotaCheck(
            internalRequest,
            { tenantId: TENANT_ID, channelType: 'whatsapp' },
        )).resolves.toEqual({ allowed: true });
        await expect(controller.channelAccountQuotaCheck(
            internalRequest,
            { tenantId: TENANT_ID, channelType: 'email' },
        )).rejects.toMatchObject({ status: 400 });
        expect(inboundQueue.enqueue).toHaveBeenCalledWith(payload);
        expect(throttle.enforceChannelAccountLimit).toHaveBeenCalledWith(TENANT_ID, 'whatsapp', 1);
    });

    it('blocks internal channel work before queue/quota effects for pending payment authorization', async () => {
        const inboundQueue = { enqueue: jest.fn() };
        const throttle = { enforceChannelAccountLimit: jest.fn() };
        const prisma = {
            tenant: { findUnique: jest.fn().mockResolvedValue({
                subscriptionStatus: 'pending_auth',
                subscription: {
                    status: 'pending_auth', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null,
                },
            }) },
            channelAccount: { count: jest.fn() },
        };
        const controller = new InternalController(
            prisma as any, throttle as any, inboundQueue as any, { emit: jest.fn() } as any,
        );
        const internalRequest = { user: { isInternalService: true } };

        await expect(controller.channelAccountQuotaCheck(
            internalRequest,
            { tenantId: TENANT_ID, channelType: 'whatsapp' },
        )).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'payment_method_required' }),
        });
        expect(prisma.channelAccount.count).not.toHaveBeenCalled();
        expect(throttle.enforceChannelAccountLimit).not.toHaveBeenCalled();
    });
});
