import { AnalyticsService } from './analytics.service';

describe('vertical dashboard message count', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function harness(dbMessages: number, received = 0, sent = 0, messagesUnavailable = false, leadsUnavailable = false) {
        const redis = {
            get: jest.fn(async (key: string) => {
                if (key === `tenant:${tenantId}:schema`) return 'tenant_demo';
                if (key.endsWith(':total')) return '100';
                if (key.endsWith(':message_received')) return String(received);
                if (key.endsWith(':message_sent')) return String(sent);
                return '0';
            }),
        };
        const prisma = {
            tenant: { findUnique: jest.fn(async () => ({ schemaName: 'tenant_demo' })) },
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                if (leadsUnavailable && sql.includes('FROM leads')) throw new Error('legacy leads unavailable');
                if (sql.includes('FROM messages')) {
                    if (messagesUnavailable) throw new Error('message count unavailable');
                    return [{ cnt: String(dbMessages) }];
                }
                return [{ cnt: '0' }];
            }),
        };
        return { service: new AnalyticsService(prisma as any, redis as any), redis };
    }

    it('counts messages without adding model, lead and booking events', async () => {
        const { service, redis } = harness(6, 3, 3);
        const stats = await service.getCommercialOverview(tenantId);
        expect(stats.messagesProcessed).toBe(6);
        expect(redis.get.mock.calls.some(([key]) => key.endsWith(':total'))).toBe(false);
    });

    it('keeps persisted messages when event counters are absent', async () => {
        expect((await harness(6).service.getCommercialOverview(tenantId)).messagesProcessed).toBe(6);
    });

    it('keeps the persisted count when retries inflate event counters', async () => {
        expect((await harness(6, 10, 10).service.getCommercialOverview(tenantId)).messagesProcessed).toBe(6);
    });

    it('keeps a successful zero count when event counters are stale', async () => {
        expect((await harness(0, 10, 10).service.getCommercialOverview(tenantId)).messagesProcessed).toBe(0);
    });

    it('keeps the message count when an unrelated legacy table fails', async () => {
        expect((await harness(6, 10, 10, false, true).service.getCommercialOverview(tenantId)).messagesProcessed).toBe(6);
    });

    it('falls back to message events when the message count is unavailable', async () => {
        expect((await harness(0, 2, 2, true).service.getCommercialOverview(tenantId)).messagesProcessed).toBe(4);
    });
});
