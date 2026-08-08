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
            ...overrides.redis,
        };
        const prisma = {
            executeInTenantSchema: jest.fn()
                .mockResolvedValueOnce([
                    { id: 'old-2', direction: 'outbound', content_text: 'previous answer' },
                    { id: 'old-1', direction: 'inbound', content_text: 'previous question' },
                ])
                .mockResolvedValueOnce([{ id: 'conversation-1', status: 'active' }]),
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
                getPersonaForChannel: jest.fn().mockResolvedValue({
                    language: 'es',
                    llm: { temperature: 0.4, maxTokens: 500 },
                    persona: { name: 'Widget Agent' },
                }),
            },
            handoffService: {
                shouldHandoff: jest.fn().mockReturnValue(null),
                executeHandoff: jest.fn(),
            },
            languageDetector: { detect: jest.fn().mockReturnValue('es') },
            promptAssembler: { assemble: jest.fn().mockReturnValue('<contract/><persona/><turn/>') },
            logger: { warn: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn() },
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

        expect(output).toContain('mensaje anterior');
        expect(throttle.getPlanFeatures).not.toHaveBeenCalled();
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('uses recent history, excludes the exact inbound and applies plan/budget routing', async () => {
        const { service, prisma, throttle, llmRouter, redis } = makeService();

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'current question', 'inbound-1',
        ))).resolves.toBe('safe reply');

        const [historySql, historyParams] = prisma.executeInTenantSchema.mock.calls[0].slice(1);
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
    });

    it('does not call the provider after the monthly quota is exhausted', async () => {
        const { service, throttle, llmRouter } = makeService({
            throttle: {
                getAiMessageUsage: jest.fn().mockResolvedValue({ used: 10, limit: 10 }),
            },
        });

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'hello', 'inbound-1',
        ))).resolves.toBe('quota fallback');
        expect(throttle.incrementAiMessageCount).not.toHaveBeenCalled();
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
