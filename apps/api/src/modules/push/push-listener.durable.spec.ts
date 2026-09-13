import { PushListenerService } from './push-listener.service';

describe('durable operational push listeners', () => {
    it('admits an assigned inbound notification before publishing its queue job', async () => {
        const noticeId = '33333333-3333-4333-8333-333333333333';
        const query = jest.fn(async (sql: string) => {
            if (sql.includes("pg_get_constraintdef")) return [{ definition: "CHECK kind push.domain_event" }];
            if (sql.includes('INSERT INTO operational_notice_outbox')) return [{ id: noticeId }];
            return [];
        });
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_push'),
            executeInTenantSchema: jest.fn().mockResolvedValue([{
                assigned_to: '22222222-2222-4222-8222-222222222222',
                contact_id: '44444444-4444-4444-8444-444444444444',
            }]),
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(query)),
            tenant: { findUnique: jest.fn().mockResolvedValue({ language: 'es' }) },
        };
        const push = { sendToUser: jest.fn(), sendToTenantRole: jest.fn() };
        const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
        const listener = new PushListenerService(push as any, prisma as any, queue as any);

        await listener.onInboundMessage({
            tenantId: '11111111-1111-4111-8111-111111111111',
            conversationId: '55555555-5555-4555-8555-555555555555',
            messageId: '66666666-6666-4666-8666-666666666666',
            text: 'Necesito ayuda',
        });

        expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO operational_notice_outbox'),
            expect.arrayContaining(['push:message.inbound:66666666-6666-4666-8666-666666666666']));
        expect(queue.add).toHaveBeenCalledWith('operational-notice', {
            operationalNotice: { tenantId: '11111111-1111-4111-8111-111111111111', noticeId },
        }, expect.any(Object));
        expect(push.sendToUser).not.toHaveBeenCalled();
    });
});
