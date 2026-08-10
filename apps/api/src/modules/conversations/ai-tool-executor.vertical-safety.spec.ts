import { AIToolExecutorService } from './ai-tool-executor.service';

describe('AIToolExecutorService vertical safety contracts', () => {
    const schemaName = 'tenant_vertical';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const gatedClaimTools: Array<[string, Record<string, any>]> = [
        ['file_claim', {
            policyNumber: 'POL-1',
            incidentType: 'collision',
            incidentAt: '2026-08-08',
            description: 'Minor collision',
        }],
        ['list_my_claims', { policyNumber: 'POL-1' }],
    ];

    function createHarness() {
        const prisma = {
            $queryRawUnsafe: jest.fn(),
            $executeRawUnsafe: jest.fn(),
        };
        const eventEmitter = { emit: jest.fn() };
        const restaurantsService = { createOrder: jest.fn() };
        const insuranceService = {
            getPolicyByNumber: jest.fn(),
            fileClaim: jest.fn(),
        };
        const chatIdentity = {
            isVerified: jest.fn(),
            startVerification: jest.fn(),
            verifyCode: jest.fn(),
        };
        const executor = new AIToolExecutorService(
            prisma as any,
            {} as any,
            eventEmitter as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            restaurantsService as any,
            {} as any,
            {} as any,
            insuranceService as any,
            chatIdentity as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {
                preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
                complete: jest.fn(),
                fail: jest.fn(),
            } as any,
            {} as any,
            {} as any,
        );
        return {
            executor,
            prisma,
            eventEmitter,
            restaurantsService,
            insuranceService,
            chatIdentity,
        };
    }

    it.each(gatedClaimTools)('requires out-of-band identity verification before %s', async (toolName, args) => {
        const harness = createHarness();
        harness.chatIdentity.isVerified.mockResolvedValue(false);
        harness.chatIdentity.startVerification.mockResolvedValue({
            status: 'sent',
            via: 'email',
            hint: 'm***@example.com',
        });

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            toolName,
            args,
            conversationId,
            { channelType: 'whatsapp' },
        );

        expect(result).toMatchObject({
            needsVerification: true,
            sentVia: 'email',
            sentTo: 'm***@example.com',
        });
        expect(harness.insuranceService.getPolicyByNumber).not.toHaveBeenCalled();
        expect(harness.insuranceService.fileClaim).not.toHaveBeenCalled();
        expect(harness.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it.each(gatedClaimTools)('fails closed before %s when conversation context is absent', async (toolName, args) => {
        const harness = createHarness();

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            toolName,
            args,
            undefined,
            { channelType: 'whatsapp' },
        );

        expect(result).toMatchObject({
            error: 'identity_context_required',
            shouldHandoff: false,
        });
        expect(harness.chatIdentity.isVerified).not.toHaveBeenCalled();
        expect(harness.chatIdentity.startVerification).not.toHaveBeenCalled();
        expect(harness.insuranceService.getPolicyByNumber).not.toHaveBeenCalled();
        expect(harness.insuranceService.fileClaim).not.toHaveBeenCalled();
    });

    it('keeps the ownership check after OTP verification for claim filing', async () => {
        const harness = createHarness();
        harness.chatIdentity.isVerified.mockResolvedValue(true);
        harness.insuranceService.getPolicyByNumber.mockResolvedValue({
            id: '44444444-4444-4444-8444-444444444444',
            policy_number: 'POL-OTHER',
            contact_id: '55555555-5555-4555-8555-555555555555',
            status: 'active',
        });

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'file_claim',
            {
                policyNumber: 'POL-OTHER',
                incidentType: 'collision',
                incidentAt: '2026-08-08',
                description: 'Minor collision',
            },
            conversationId,
        );

        expect(result.error).toContain('No policy with that number is linked to this customer');
        expect(harness.insuranceService.fileClaim).not.toHaveBeenCalled();
    });

    it('scopes verified claim history to policies owned by the current contact', async () => {
        const harness = createHarness();
        harness.chatIdentity.isVerified.mockResolvedValue(true);
        harness.prisma.$queryRawUnsafe.mockResolvedValue([]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'list_my_claims',
            { policyNumber: 'POL-1' },
            conversationId,
        );

        expect(result).toEqual({ claims: [] });
        expect(harness.prisma.$queryRawUnsafe).toHaveBeenCalledWith(
            expect.stringContaining('WHERE p.contact_id = $1::uuid'),
            contactId,
            'POL-1',
        );
    });

    it('uses catalog currency and preparation data for the order ETA response', async () => {
        const harness = createHarness();
        const menuItemId = '66666666-6666-4666-8666-666666666666';
        const estimatedAt = new Date('2026-08-08T18:22:00.000Z');
        harness.prisma.$queryRawUnsafe.mockResolvedValue([{
            id: menuItemId,
            name: 'Tacos',
            price: '12.00',
            currency: 'MXN',
            prep_time_minutes: 22,
        }]);
        harness.restaurantsService.createOrder.mockResolvedValue({
            id: '77777777-7777-4777-8777-777777777777',
            order_type: 'delivery',
            status: 'received',
            total: 24,
            currency: 'MXN',
            items: [{ menu_item_id: menuItemId }],
            estimated_delivery_minutes: 22,
            estimated_delivery_at: estimatedAt,
        });

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'place_order',
            {
                orderType: 'delivery',
                deliveryAddress: 'Av. Reforma 1',
                items: [{ menuItemId, name: 'fake', quantity: 2, unitPrice: 1 }],
            },
            conversationId,
        );

        expect(harness.prisma.$queryRawUnsafe.mock.calls[0][0]).toContain(
            'SELECT id, name, price, currency, prep_time_minutes',
        );
        expect(harness.restaurantsService.createOrder).toHaveBeenCalledWith(
            schemaName,
            expect.objectContaining({
                currency: 'MXN',
                items: [expect.objectContaining({
                    menuItemId,
                    name: 'Tacos',
                    quantity: 2,
                    unitPrice: 12,
                    currency: 'MXN',
                    prepTimeMinutes: 22,
                })],
            }),
        );
        expect(result).toMatchObject({
            currency: 'MXN',
            estimatedDelivery: '22 minutos',
            estimatedDeliveryAt: estimatedAt,
        });
        expect(harness.eventEmitter.emit).not.toHaveBeenCalledWith(
            'food_order.created',
            expect.anything(),
        );
    });

    it('keeps raw email, phone and arbitrary metadata out of LLM customer context', async () => {
        const harness = createHarness();
        harness.prisma.$queryRawUnsafe
            .mockResolvedValueOnce([{
                id: contactId,
                name: 'Cliente',
                email: 'secret@example.com',
                phone: '+573001234567',
                metadata: { accessToken: 'never-return-this' },
                tags: ['vip'],
                first_contact_at: '2026-08-01T00:00:00Z',
                last_contact_at: '2026-08-08T00:00:00Z',
            }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ cnt: 2 }]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'get_customer_context',
            {},
            conversationId,
        );

        const contactSql = harness.prisma.$queryRawUnsafe.mock.calls[0][0];
        expect(contactSql).not.toContain('email');
        expect(contactSql).not.toContain('phone');
        expect(contactSql).not.toContain('metadata');
        expect(result.contact).toMatchObject({ id: contactId, name: 'Cliente', tags: ['vip'] });
        expect(result.contact).not.toHaveProperty('email');
        expect(result.contact).not.toHaveProperty('phone');
        expect(result.contact).not.toHaveProperty('metadata');
    });
});
