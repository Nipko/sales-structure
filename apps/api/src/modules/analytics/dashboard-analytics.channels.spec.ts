import {
    ANALYTICS_CONVERSATIONAL_CHANNELS,
    DashboardAnalyticsService,
} from './dashboard-analytics.service';

describe('Dashboard analytics channel coverage', () => {
    const prisma = {
        $queryRawUnsafe: jest.fn(),
        tenant: { findUnique: jest.fn() },
    };
    const redis = {
        get: jest.fn().mockResolvedValue('tenant_schema'),
        set: jest.fn(),
    };
    const service = new DashboardAnalyticsService(prisma as any, redis as any);

    beforeEach(() => jest.clearAllMocks());

    it('pivots Web Chat instead of silently dropping a certified channel', async () => {
        prisma.$queryRawUnsafe.mockResolvedValue([
            { date: '2026-08-24', channel: 'whatsapp', count: 2 },
            { date: '2026-08-24', channel: 'web_widget', count: 3 },
        ]);

        await expect(service.getConversationsVolume(
            '11111111-1111-4111-8111-111111111111',
            '2026-08-24',
            '2026-08-24',
        )).resolves.toEqual({
            series: [{
                date: '2026-08-24',
                whatsapp: 2, instagram: 0, messenger: 0, telegram: 0, web_widget: 3,
            }],
        });
    });

    it('keeps the certified channel inventory explicit', () => {
        expect(ANALYTICS_CONVERSATIONAL_CHANNELS).toEqual([
            'whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget',
        ]);
    });

    it('includes Web Chat in CSV and BI breakdowns', async () => {
        jest.spyOn(service, 'getOverviewKPIs').mockResolvedValue({ kpis: [] });
        jest.spyOn(service, 'getConversationsVolume').mockResolvedValue({
            series: [{
                date: '2026-08-24',
                whatsapp: 1, instagram: 2, messenger: 3, telegram: 4, web_widget: 5,
            }],
        });
        jest.spyOn(service, 'getResponseTimes').mockResolvedValue({ series: [] });
        jest.spyOn(service, 'getAIMetrics').mockResolvedValue({
            resolutionRate: 0, containmentRate: 0, totalConversations: 0,
            aiResolved: 0, handoffs: 0, avgCostPerConversation: 0,
            totalCost: 0, modelUsage: [], handoffReasons: [],
        } as any);
        jest.spyOn(service, 'getChannelAccountBreakdown').mockResolvedValue({
            totals: {}, accounts: [], unattributed: 0,
        });

        const csv = await service.exportCSV('tenant', '2026-08-24', '2026-08-24');
        expect(csv).toContain('Date,WhatsApp,Instagram,Messenger,Telegram,Web Chat');
        expect(csv).toContain('2026-08-24,1,2,3,4,5');

        const bi = await service.getBIData('tenant', '2026-08-24', '2026-08-24');
        expect(bi.channelBreakdown).toContainEqual({ channel: 'web_widget', count: 5 });
    });
});
