import { ConversationsService } from './conversations.service';

async function collect(stream: AsyncGenerator<string, void, unknown>): Promise<string> {
    let output = '';
    for await (const chunk of stream) output += chunk;
    return output;
}

describe('ConversationsService widget containment', () => {
    function makeService(overrides: Record<string, any> = {}) {
        const service: any = Object.create(ConversationsService.prototype);
        const redis = {
            acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
            renewLockToken: jest.fn().mockResolvedValue(true),
            releaseLockToken: jest.fn().mockResolvedValue(true),
            getJson: jest.fn().mockResolvedValue(null),
            ...overrides.redis,
        };
        const prisma = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                if (sql.includes('SELECT id, direction, content_text FROM messages')) return [
                    { id: 'old-2', direction: 'outbound', content_text: 'previous answer' },
                    { id: 'old-1', direction: 'inbound', content_text: 'previous question' },
                ];
                if (sql.includes('SELECT * FROM conversations')) {
                    return [{ id: 'conversation-1', status: 'active' }];
                }
                return [];
            }),
            tenant: { findUnique: jest.fn().mockResolvedValue({ language: 'es' }) },
            ...overrides.prisma,
        };
        const throttle = {
            getPlanFeatures: jest.fn().mockResolvedValue({
                widget: true,
                llmTier: 'tier_2',
                llmCostBudgetUsdCents: 100,
            }),
            getLlmSpendUsdCents: jest.fn().mockResolvedValue(100),
            getAiMessageUsage: jest.fn().mockResolvedValue({ used: 2, limit: 10 }),
            incrementAiMessageCount: jest.fn().mockResolvedValue(3),
            ...overrides.throttle,
        };
        const llmRouter = {
            executeStream: jest.fn().mockImplementation(() => (async function* () {
                yield 'safe reply';
            })()),
            ...overrides.llmRouter,
        };
        Object.assign(service, {
            redis,
            prisma,
            throttle,
            llmRouter,
            personaService: {
                resolvePersonaForChannel: jest.fn().mockResolvedValue({
                    agentId: '11111111-1111-4111-8111-111111111111',
                    version: 3,
                    config: {
                        language: 'en',
                        hours: { timezone: 'Europe/Paris' },
                        llm: { temperature: 0.4, maxTokens: 500 },
                        persona: { name: 'Widget Agent' },
                    },
                }),
            },
            handoffService: {
                shouldHandoff: jest.fn().mockReturnValue(null),
                executeHandoff: jest.fn(),
            },
            languageDetector: { detect: jest.fn().mockReturnValue('en') },
            promptAssembler: {
                assemble: jest.fn().mockReturnValue('<contract/><persona/><turn/>'),
                computeUpcomingDays: jest.fn().mockReturnValue([]),
            },
            activeOperationsContext: { populateTurnContext: jest.fn() },
            businessInfoService: { getPrimary: jest.fn().mockResolvedValue(null) },
            logger: { warn: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn() },
        });
        service.loadTenantBusinessHours = jest.fn().mockResolvedValue({
            timezone: 'Europe/Paris',
            is247: false,
            schedule: Object.fromEntries([
                'sunday', 'monday', 'tuesday', 'wednesday',
                'thursday', 'friday', 'saturday',
            ].map((day) => [day, { enabled: false }])),
        });
        service.buildQuotaFallbackMessage = jest.fn().mockResolvedValue('quota fallback');
        return { service: service as ConversationsService, redis, prisma, throttle, llmRouter };
    }

    it('fails closed without calling the provider when the conversation lock is unavailable', async () => {
        const { service, throttle, llmRouter } = makeService({
            redis: { acquireLockToken: jest.fn().mockRejectedValue(new Error('redis unavailable')) },
        });

        const output = await collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'hello', 'inbound-1',
        ));

        expect(output).toContain('previous message');
        expect(throttle.getPlanFeatures).not.toHaveBeenCalled();
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('uses recent history, excludes the exact inbound and applies plan/budget routing', async () => {
        const { service, prisma, throttle, llmRouter, redis } = makeService();

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'current question', 'inbound-1',
        ))).resolves.toBe('safe reply');

        const historyCall = prisma.executeInTenantSchema.mock.calls.find(
            (call: any[]) => String(call[1]).includes('SELECT id, direction, content_text FROM messages'),
        );
        expect(historyCall).toBeDefined();
        const [, historySql, historyParams] = historyCall!;
        expect(historySql).toContain('id <> $2::uuid');
        expect(historySql).toContain('ORDER BY created_at DESC, id DESC LIMIT 20');
        expect(historyParams).toEqual(['conversation-1', 'inbound-1']);

        const request = llmRouter.executeStream.mock.calls[0][0];
        expect(request.model).toBeUndefined();
        expect(request.task).toBe('conversation');
        expect(request.allowedTiers).toEqual(['tier_3_efficient', 'tier_4_budget']);
        expect(request.temperature).toBe(0.4);
        expect(request.maxTokens).toBe(500);
        expect(request.messages).toEqual([
            { role: 'user', content: 'previous question' },
            { role: 'assistant', content: 'previous answer' },
            { role: 'user', content: 'current question' },
        ]);
        expect(throttle.incrementAiMessageCount).toHaveBeenCalledWith('tenant-1');
        expect(redis.releaseLockToken).toHaveBeenCalledWith('lock:conv:conversation-1', 'lock-token');
        expect((service as any).promptAssembler.assemble).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                language: 'en',
                timezone: 'Europe/Paris',
                businessHoursStatus: 'closed',
                channelType: 'web_widget',
            }),
        );
    });

    it('does not call the provider after the monthly quota is exhausted', async () => {
        const { service, prisma, throttle, llmRouter } = makeService({
            throttle: {
                getAiMessageUsage: jest.fn().mockResolvedValue({ used: 10, limit: 10 }),
            },
        });

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'hello', 'inbound-1',
        ))).resolves.toBe('quota fallback');
        expect(throttle.incrementAiMessageCount).not.toHaveBeenCalled();
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema.mock.calls.some(
            (call: any[]) => String(call[1]).includes('SET agent_persona_id'),
        )).toBe(false);
    });

    it('fails closed on handoff routing until human widget delivery is verified', async () => {
        const { service, llmRouter } = makeService();
        const handoff = (service as any).handoffService;
        handoff.shouldHandoff.mockReturnValue('human_requested');

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'human please', 'inbound-1',
        ))).resolves.toContain('cannot transfer');

        expect(handoff.executeHandoff).not.toHaveBeenCalled();
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('does not attribute a widget conversation already owned by a human', async () => {
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('SELECT id, direction, content_text FROM messages')) return [];
            if (sql.includes('SELECT * FROM conversations')) {
                return [{ id: 'conversation-1', status: 'with_human' }];
            }
            return [];
        });
        const { service, llmRouter } = makeService({
            prisma: { executeInTenantSchema },
        });

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'human follow-up', 'inbound-1',
        ))).resolves.toBe('');

        expect(executeInTenantSchema.mock.calls.some(
            (call: any[]) => String(call[1]).includes('SET agent_persona_id'),
        )).toBe(false);
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('routes handoff only when an authenticated human-delivery adapter is explicitly evidenced', async () => {
        const { service, llmRouter } = makeService();
        const handoff = (service as any).handoffService;
        handoff.shouldHandoff.mockReturnValue('human_requested');

        const output = await collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'human please', 'inbound-1',
            { allowHumanHandoff: true },
        ));

        expect(output).toContain('support team');
        expect(handoff.executeHandoff).toHaveBeenCalledTimes(1);
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('rolls back a concurrent over-limit reservation and never reaches the provider', async () => {
        const incrementAiMessageCount = jest.fn()
            .mockResolvedValueOnce(11)
            .mockResolvedValueOnce(10);
        const { service, llmRouter } = makeService({
            throttle: {
                getAiMessageUsage: jest.fn().mockResolvedValue({ used: 9, limit: 10 }),
                incrementAiMessageCount,
            },
        });

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'hello', 'inbound-1',
        ))).resolves.toBe('quota fallback');
        expect(incrementAiMessageCount).toHaveBeenNthCalledWith(1, 'tenant-1');
        expect(incrementAiMessageCount).toHaveBeenNthCalledWith(2, 'tenant-1', -1);
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });
});
