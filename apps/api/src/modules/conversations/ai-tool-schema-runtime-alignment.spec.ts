import { AIToolExecutorService } from './ai-tool-executor.service';
import { APPOINTMENT_TOOLS } from './tools/appointment-tools';
import { INSURANCE_TOOLS } from './tools/insurance-tools';
import { RESTAURANTS_TOOLS } from './tools/restaurants-tools';
import { PET_SERVICES_TOOLS, PHOTOGRAPHY_TOOLS } from './tools/tier3-tools';

describe('AI tool schema and runtime alignment', () => {
    const schemaName = 'tenant_tools';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const conversationId = '33333333-3333-4333-8333-333333333333';

    function tool(tools: Array<{ name: string; description: string; parameters: Record<string, any> }>, name: string) {
        const definition = tools.find(candidate => candidate.name === name);
        if (!definition) throw new Error(`Missing tool definition: ${name}`);
        return definition;
    }

    function createHarness() {
        const transactionQuery = jest.fn();
        const prisma = {
            $queryRawUnsafe: jest.fn(),
            $executeRawUnsafe: jest.fn(),
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => (
                callback(transactionQuery)
            )),
        };
        const eventEmitter = { emit: jest.fn() };
        const photographyService = { create: jest.fn() };
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
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
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
            photographyService as any,
        );
        return { executor, prisma, eventEmitter, photographyService, transactionQuery };
    }

    it('advertises the status vocabulary and ETA that the restaurant runtime returns', () => {
        const cancelOrder = tool(RESTAURANTS_TOOLS, 'cancel_order');
        const checkOrderStatus = tool(RESTAURANTS_TOOLS, 'check_order_status');

        expect(cancelOrder.description).toContain('"received"');
        expect(cancelOrder.description).toContain('legacy "pending" or "confirmed"');
        expect(cancelOrder.description).toContain('"preparing", "ready", "delivered", or "cancelled"');
        expect(checkOrderStatus.description).toContain('estimatedDeliveryAt');
    });

    it('advertises only availability inputs that the daycare and photography handlers use', () => {
        const daycare = tool(PET_SERVICES_TOOLS, 'check_daycare_availability');
        const shootDate = tool(PHOTOGRAPHY_TOOLS, 'check_date_availability');

        expect(Object.keys(daycare.parameters.properties).sort()).toEqual(['checkIn', 'checkOut']);
        expect(daycare.description).toContain('Pet size and special-needs suitability are not represented');
        expect(Object.keys(shootDate.parameters.properties)).toEqual(['date']);
        expect(shootDate.description).toContain('does not return time windows');
    });

    it('describes booking-link and quote withdrawal behavior without unsupported states or prefill', () => {
        const bookingLink = tool(APPOINTMENT_TOOLS, 'send_booking_link');
        const cancelQuote = tool(INSURANCE_TOOLS, 'cancel_quote');

        expect(bookingLink.parameters.properties).toEqual({});
        expect(bookingLink.description).toContain('does not prefill a preferred date or time');
        expect(cancelQuote.description).toContain('"draft" or "sent"');
        expect(cancelQuote.description).toContain('records the withdrawal as "rejected"');
        expect(cancelQuote.description).not.toContain('"pending" status');
    });

    it('advertises exactly the fields persisted by request_photo_quote', () => {
        const photoRequest = tool(PHOTOGRAPHY_TOOLS, 'request_photo_quote');

        expect(Object.keys(photoRequest.parameters.properties).sort()).toEqual([
            'customerName',
            'customerPhone',
            'date',
            'location',
            'packageName',
            'sessionType',
            'specialRequests',
        ]);
        expect(photoRequest.parameters.required).toEqual(['date', 'customerName']);
        expect(photoRequest.description).toContain('does not calculate or promise a price');
    });

    it('returns the stored food-order ETA only for an order owned by the contact', async () => {
        const harness = createHarness();
        const orderId = '44444444-4444-4444-8444-444444444444';
        const estimatedAt = new Date('2026-08-08T19:30:00.000Z');
        harness.prisma.$queryRawUnsafe
            .mockResolvedValueOnce([{
                id: orderId,
                contact_id: contactId,
                status: 'preparing',
                order_type: 'delivery',
                total: '45.00',
                currency: 'COP',
                customer_name: 'Ana',
                delivery_address: 'Calle 1',
                estimated_delivery_at: estimatedAt,
                created_at: new Date('2026-08-08T19:00:00.000Z'),
                updated_at: new Date('2026-08-08T19:05:00.000Z'),
            }])
            .mockResolvedValueOnce([{ name_snapshot: 'Pizza', quantity: 1, unit_price: '45.00' }]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'check_order_status',
            { orderId },
            conversationId,
        );

        expect(harness.prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('estimated_delivery_at');
        expect(result).toMatchObject({
            id: orderId,
            status: 'preparing',
            estimatedDeliveryAt: estimatedAt,
        });
    });

    it('fails closed and emits no event when a photography request cannot be persisted', async () => {
        const harness = createHarness();
        harness.photographyService.create.mockRejectedValue(new Error('photo_sessions unavailable'));

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'request_photo_quote',
            { date: '2026-09-10', customerName: 'Ana' },
            conversationId,
        );

        expect(result).toMatchObject({
            error: 'photo_session_not_created',
            received: false,
        });
        expect(harness.photographyService.create).toHaveBeenCalledTimes(1);
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('delegates a photography request to the canonical service as requested', async () => {
        const harness = createHarness();
        const sessionId = '55555555-5555-4555-8555-555555555555';
        harness.photographyService.create.mockResolvedValue([{ id: sessionId }][0]);

        const args = {
            sessionType: 'wedding',
            packageName: 'Gold',
            date: '2026-09-10',
            location: 'Cartagena',
            customerName: 'Ana',
            customerPhone: '+573001112233',
            specialRequests: 'Ceremonia exterior',
        };
        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'request_photo_quote',
            args,
            conversationId,
        );

        expect(harness.photographyService.create).toHaveBeenCalledWith(
            schemaName,
            {
                contactId,
                conversationId,
                sessionType: 'wedding',
                packageName: 'Gold',
                clientName: 'Ana',
                clientPhone: '+573001112233',
                scheduledAt: '2026-09-10',
                location: 'Cartagena',
                notes: 'Ceremonia exterior',
                status: 'requested',
            },
        );
        expect(harness.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            received: true,
            sessionId,
            sessionType: 'wedding',
        });
    });

    it.each(['requested', 'scheduled'])('atomically cancels an owned %s photo session', async (status) => {
        const harness = createHarness();
        const sessionId = '55555555-5555-4555-8555-555555555555';
        harness.transactionQuery
            .mockResolvedValueOnce([{ id: sessionId, contact_id: contactId, status }])
            .mockResolvedValueOnce([{ id: sessionId }]);

        await expect(harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'cancel_photo_session',
            { sessionId, reason: 'Cambio de planes' },
            conversationId,
        )).resolves.toMatchObject({ success: true });

        expect(harness.prisma.transactionInTenantSchema).toHaveBeenCalledWith(
            schemaName,
            expect.any(Function),
        );
        expect(harness.transactionQuery.mock.calls[0][0]).toContain('FOR UPDATE');
        expect(harness.transactionQuery.mock.calls[1][0]).toContain("status IN ('requested', 'scheduled')");
        expect(harness.transactionQuery.mock.calls[1][1]).toEqual([
            '\n[Cancelled: Cambio de planes]',
            sessionId,
            contactId,
        ]);
    });

    it('does not update a foreign or already-active photo session', async () => {
        const foreign = createHarness();
        foreign.transactionQuery.mockResolvedValueOnce([{
            id: '55555555-5555-4555-8555-555555555555',
            contact_id: '66666666-6666-4666-8666-666666666666',
            status: 'requested',
        }]);
        await expect(foreign.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'cancel_photo_session',
            { sessionId: '55555555-5555-4555-8555-555555555555' },
            conversationId,
        )).resolves.toMatchObject({ error: 'You can only cancel your own sessions' });
        expect(foreign.transactionQuery).toHaveBeenCalledTimes(1);

        const active = createHarness();
        active.transactionQuery.mockResolvedValueOnce([{
            id: '55555555-5555-4555-8555-555555555555',
            contact_id: contactId,
            status: 'in_progress',
        }]);
        await expect(active.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'cancel_photo_session',
            { sessionId: '55555555-5555-4555-8555-555555555555' },
            conversationId,
        )).resolves.toMatchObject({ error: expect.stringContaining('in_progress') });
        expect(active.transactionQuery).toHaveBeenCalledTimes(1);
    });
});
