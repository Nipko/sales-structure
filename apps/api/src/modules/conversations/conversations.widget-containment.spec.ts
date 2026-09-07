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
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            ...overrides.redis,
        };
        const prisma = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                if (sql.includes('SELECT id, direction, content_text FROM messages')) return [
                    { id: 'old-2', direction: 'outbound', content_text: 'previous answer' },
                    { id: 'old-1', direction: 'inbound', content_text: 'previous question' },
                ];
                if (sql.includes('SELECT * FROM conversations')) {
                    return [{ id: 'conversation-1', contact_id: 'contact-1', channel_account_id: 'widget', status: 'active', updated_at: new Date() }];
                }
                if (sql.includes('SELECT * FROM contacts')) return [{ id: 'contact-1', name: 'Alice', external_id: 'widget_alice' }];
                if (sql.includes('SELECT * FROM leads')) return [{ id: 'lead-1' }];
                return [];
            }),
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    language: 'es',
                    isInternal: false,
                    subscriptionStatus: 'active',
                    subscription: {
                        status: 'active',
                        trialEndsAt: null,
                        cancelAtPeriodEnd: false,
                        currentPeriodEnd: null,
                        cancellationReason: null,
                        dunningStartedAt: null,
                    },
                }),
            },
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
            eventEmitter: { emit: jest.fn() },
            tenantSchema: jest.fn().mockResolvedValue('tenant_1'),
            generateResponse: jest.fn().mockResolvedValue('safe reply'),
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

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'hello', 'inbound-1',
        ))).rejects.toThrow('conversation_locked');
        expect(throttle.getPlanFeatures).not.toHaveBeenCalled();
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('delegates to the shared domain coordinator with contact, channel and inbound identity', async () => {
        const { service, prisma, throttle, llmRouter, redis } = makeService();

        await expect(collect(service.streamWidgetMessage(
            'tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'current question', 'inbound-1',
        ))).resolves.toBe('safe reply');

        expect((service as any).generateResponse).toHaveBeenCalledWith(
            'tenant-1', expect.objectContaining({ id: 'conversation-1' }),
            expect.objectContaining({ channelType: 'web_widget', channelAccountId: 'widget', content: { type: 'text', text: 'current question' } }),
            expect.anything(), expect.objectContaining({ id: 'contact-1' }), { id: 'lead-1' },
            expect.any(Date), expect.objectContaining({ timezone: 'Europe/Paris' }),
            'inbound-1', '11111111-1111-4111-8111-111111111111',
        );
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
        expect(throttle.incrementAiMessageCount).toHaveBeenCalledWith('tenant-1');
        expect(redis.releaseLockToken).toHaveBeenCalledWith('lock:conv:conversation-1', 'lock-token');
        expect(prisma.executeInTenantSchema.mock.calls[0][1]).toContain('contact_id = $2::uuid AND channel_type = $3');
    });

    it('uses the current widget connection for persona routing and rejects a different conversation account', async () => {
        const { service, prisma } = makeService();
        await collect(service.streamWidgetMessage('tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'hello', 'inbound-1', { channelAccountId: 'wgt_current' }));
        expect((service as any).personaService.resolvePersonaForChannel).toHaveBeenCalledWith('tenant-1', 'web_widget', 'wgt_current');
        expect((service as any).generateResponse.mock.calls[0][2].channelAccountId).toBe('wgt_current');
        prisma.executeInTenantSchema.mockResolvedValueOnce([{ id: 'conversation-1', contact_id: 'contact-1', channel_account_id: 'wgt_other' }]);
        await expect(collect(service.streamWidgetMessage('tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'hello', 'inbound-2', { channelAccountId: 'wgt_current' }))).rejects.toThrow('widget_conversation_scope_mismatch');
        expect((service as any).generateResponse).toHaveBeenCalledTimes(1);
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
                return [{ id: 'conversation-1', channel_account_id: 'widget', contact_id: 'contact-1', status: 'with_human' }];
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
            (call: any[]) => String(call[1]).includes('SELECT * FROM conversations'),
        )).toBe(true);
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

    it('reuses the finalized inbound reply without repeating tools or usage', async () => {
        const { service, redis, throttle } = makeService();
        const run = () => collect(service.streamWidgetMessage('tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'book', 'inbound-1'));
        await run();
        redis.get.mockResolvedValue(JSON.stringify({ conversationId: 'conversation-1', contactId: 'contact-1', text: 'safe reply' }));
        expect(await run()).toBe('safe reply');
        expect((service as any).generateResponse).toHaveBeenCalledTimes(1);
        expect(throttle.incrementAiMessageCount).toHaveBeenCalledTimes(1);
    });

    it('rejects mismatched tenant scope before reading the conversation', async () => {
        const { service, prisma } = makeService();
        (service as any).tenantSchema.mockResolvedValue('tenant_other');
        await expect(collect(service.streamWidgetMessage('tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'hello', 'inbound-1'))).rejects.toThrow('widget_tenant_scope_mismatch');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('stores draft suggestions without customer delivery or handoff', async () => {
        const { service, prisma } = makeService();
        const internal = service as any;
        const persona = await internal.personaService.resolvePersonaForChannel();
        persona.config.behavior = { draftMode: true };
        internal.handoffService.shouldHandoff.mockReturnValue('human_requested');
        expect(await collect(service.streamWidgetMessage('tenant-1', 'tenant_1', 'conversation-1', 'contact-1', 'human please', 'inbound-1'))).toBe('');
        expect(internal.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema.mock.calls.some((call: any[]) => call[1].includes('pendingDraft'))).toBe(true);
        expect(internal.eventEmitter.emit).toHaveBeenCalledWith('draft.suggested', expect.objectContaining({ text: 'safe reply' }));
    });
});
