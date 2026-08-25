import { DashboardAnalyticsService } from './dashboard-analytics.service';

describe('Channel-account analytics', () => {
    it('keeps two accounts separate and reconciles their totals', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('analytics_events') && sql.includes('GROUP BY channel_type')) return [
                { channel_type: 'whatsapp', channel_account_id: 'wa-a', channel_account_label: 'Ventas', first_seen_at: new Date(), last_seen_at: new Date() },
            ];
            if (sql.includes('analytics_events')) return [{ count: 2 }];
            if (sql.includes('.messages m')) return [
                { channel_type: 'whatsapp', channel_account_id: 'wa-a', messages: 5, llm_cost: 0.5 },
                { channel_type: 'whatsapp', channel_account_id: 'wa-b', messages: 4, llm_cost: 0.4 },
            ];
            if (sql.includes('.conversation_assignments a')) return [
                { channel_type: 'whatsapp', channel_account_id: 'wa-a', handoffs: 1 },
            ];
            if (sql.includes('.appointments a')) return [
                { channel_type: 'whatsapp', channel_account_id: 'wa-b', appointments: 1 },
            ];
            if (sql.includes('.leads l')) return [
                { channel_type: 'whatsapp', channel_account_id: 'wa-a', leads: 1 },
            ];
            if (sql.includes('.orders o')) return [
                { channel_type: 'whatsapp', channel_account_id: 'wa-b', orders: 1 },
            ];
            if (sql.includes('.conversations')) return [
                { channel_type: 'whatsapp', channel_account_id: 'wa-a', conversations: 2 },
                { channel_type: 'whatsapp', channel_account_id: 'wa-b', conversations: 1 },
            ];
            return [];
        });
        const prisma = {
            $queryRawUnsafe: query,
            channelAccount: { findMany: jest.fn().mockResolvedValue([
                { channelType: 'whatsapp', accountId: 'wa-a', displayName: 'Ventas actual', isActive: true },
                { channelType: 'whatsapp', accountId: 'wa-b', displayName: 'Soporte', isActive: false },
            ]) },
        };
        const service = new DashboardAnalyticsService(prisma as any, { get: jest.fn().mockResolvedValue('tenant_one') } as any);
        const result = await service.getChannelAccountBreakdown('11111111-1111-4111-8111-111111111111', '2026-08-01', '2026-08-31');

        expect(result.accounts).toHaveLength(2);
        expect(result.accounts.map((account) => account.channelAccountId).sort()).toEqual(['wa-a', 'wa-b']);
        expect(result.totals).toMatchObject({ conversations: 3, messages: 9, handoffs: 1, appointments: 1, leads: 1, orders: 1, llmCost: 0.9 });
        expect(result.unattributed).toBe(2);
        expect(result.accounts.find((account) => account.channelAccountId === 'wa-b')).toMatchObject({ displayName: 'Soporte', isActive: false });
    });

    it('keeps historically ambiguous activity visible without inventing an account', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('analytics_events') && sql.includes('GROUP BY channel_type')) return [];
            if (sql.includes('analytics_events')) return [{ count: 3 }];
            if (sql.includes('.conversations') && !sql.includes('JOIN')) return [{
                channel_type: 'whatsapp', channel_account_id: null, conversations: 2,
            }];
            return [];
        });
        const prisma = {
            $queryRawUnsafe: query,
            channelAccount: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const service = new DashboardAnalyticsService(
            prisma as any,
            { get: jest.fn().mockResolvedValue('tenant_one') } as any,
        );

        const result = await service.getChannelAccountBreakdown(
            '11111111-1111-4111-8111-111111111111', '2026-08-01', '2026-08-31',
        );

        expect(result.accounts).toContainEqual(expect.objectContaining({
            channelType: 'whatsapp',
            channelAccountId: null,
            displayName: 'unknown',
            attributionStatus: 'unattributed',
            conversations: 2,
        }));
        expect(result.unattributed).toBe(3);
    });
});
