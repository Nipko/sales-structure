import { ConversationsService } from './conversations.service';
import { randomUUID } from 'crypto';
import type { WidgetAgentReplyReceipt } from '../widget/widget-agent-reply.store';
import { handoffNoticeText } from '../handoff/handoff-notice';
import type { HandoffReceipt } from '../handoff/handoff-receipt';

const storedTexts = new Map<string, string>();
async function collect(pending: Promise<WidgetAgentReplyReceipt | null>): Promise<string> {
    const receipt = await pending;
    return receipt?.status === 'stored' ? receipt.messages.map(ref => storedTexts.get(ref.messageId) || '').join('') : '';
}

describe('ConversationsService widget containment', () => {
    function makeService(overrides: Record<string, any> = {}) {
        const service: any = Object.create(ConversationsService.prototype);
        const receipts = new Map<string, WidgetAgentReplyReceipt>();
        const widgetAgentReplies = {
            lookup: jest.fn(async (_tenant: string, input: any) => receipts.get(input.inboundMessageId) || null),
            commit: jest.fn(async (input: any): Promise<WidgetAgentReplyReceipt> => {
                const messageId = randomUUID();
                storedTexts.set(messageId, input.text);
                const receipt: WidgetAgentReplyReceipt = { status: 'stored',
                    messages: [{ tenantId: input.tenantId, conversationId: input.conversationId, messageId }] };
                receipts.set(input.inboundMessageId, receipt);
                return receipt;
            }),
            historyFootprints: jest.fn(async () => ({ footprints: [], trustedMessageIds: [] })),
            // Mirrors the store: the sentence comes from the receipt, never from
            // the caller, and the turn's own answer precedes it when it exists.
            commitHandoffNotice: jest.fn(async (input: any): Promise<WidgetAgentReplyReceipt | null> => {
                const handoff = handoffReceipts.get(input.inboundMessageId);
                if (!handoff) throw new Error('widget_agent_reply_handoff_receipt_required');
                const text = [input.precedingText, handoffNoticeText(handoff.noticeKind, handoff.noticeLanguage)]
                    .filter(Boolean).join('\n\n');
                if (!text) return null;
                const messageId = randomUUID();
                storedTexts.set(messageId, text);
                const receipt: WidgetAgentReplyReceipt = { status: 'stored',
                    messages: [{ tenantId: input.tenantId, conversationId: input.conversationId, messageId }] };
                receipts.set(input.inboundMessageId, receipt);
                return receipt;
            }),
        };
        const handoffReceipts = new Map<string, HandoffReceipt>();
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
                    return [{ id: '20000000-0000-4000-8000-000000000002', contact_id: '30000000-0000-4000-8000-000000000003', channel_account_id: 'widget', status: 'active', updated_at: new Date() }];
                }
                if (sql.includes('SELECT * FROM contacts')) return [{ id: '30000000-0000-4000-8000-000000000003', name: 'Alice', external_id: 'widget_alice' }];
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
            widgetAgentReplies,
            llmRouter,
            personaService: {
                resolvePersonaForChannel: jest.fn().mockResolvedValue({
                    agentId: '11111111-1111-4111-8111-111111111111',
                    version: 3,
                    operationalHash: 'a'.repeat(64),
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
                // One transfer per inbound; a repeat recovers what it recorded.
                executeHandoffOnce: jest.fn(async (_tenant: string, conversationId: string,
                    _message: any, reason: string, request: any): Promise<HandoffReceipt> => {
                    const existing = handoffReceipts.get(request.inboundMessageId);
                    if (existing) return existing;
                    const receipt = Object.freeze({
                        id: randomUUID(), conversationId, contactId: request.contactId,
                        inboundMessageId: request.inboundMessageId, channelType: 'web_widget',
                        channelAccountId: 'widget', reason, fromStatus: 'active', toStatus: 'waiting_human',
                        noticeKind: request.noticeKind, noticeLanguage: request.noticeLanguage, traceId: null,
                    }) as HandoffReceipt;
                    handoffReceipts.set(request.inboundMessageId, receipt);
                    return receipt;
                }),
                lookupHandoffReceipt: jest.fn(async (_tenant: string, lookup: any) =>
                    handoffReceipts.get(lookup.inboundMessageId) || null),
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
        return { service: service as ConversationsService, redis, prisma, throttle, llmRouter, widgetAgentReplies };
    }

    it('fails closed without calling the provider when the conversation lock is unavailable', async () => {
        const { service, throttle, llmRouter } = makeService({
            redis: { acquireLockToken: jest.fn().mockRejectedValue(new Error('redis unavailable')) },
        });

        await expect(collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'hello', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }))).rejects.toThrow('conversation_locked');
        expect(throttle.getPlanFeatures).not.toHaveBeenCalled();
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('delegates to the shared domain coordinator with contact, channel and inbound identity', async () => {
        const { service, prisma, throttle, llmRouter, redis } = makeService();

        await expect(collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'current question', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }))).resolves.toBe('safe reply');

        expect((service as any).generateResponse).toHaveBeenCalledWith(
            '10000000-0000-4000-8000-000000000001', expect.objectContaining({ id: '20000000-0000-4000-8000-000000000002' }),
            expect.objectContaining({ channelType: 'web_widget', channelAccountId: 'widget', content: { type: 'text', text: 'current question' } }),
            expect.anything(), expect.objectContaining({ id: '30000000-0000-4000-8000-000000000003' }), { id: 'lead-1' },
            expect.any(Date), expect.objectContaining({ timezone: 'Europe/Paris' }),
            '40000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', undefined, 3,
            expect.objectContaining({ kind: 'agent', version: 3, operationalHash: 'a'.repeat(64) }),
            expect.objectContaining({ addExamples: expect.any(Function), getFootprints: expect.any(Function) }),
        );
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
        expect(throttle.incrementAiMessageCount).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001');
        expect(redis.releaseLockToken).toHaveBeenCalledWith('lock:conv:20000000-0000-4000-8000-000000000002', 'lock-token');
        expect(prisma.executeInTenantSchema.mock.calls[0][1]).toContain('contact_id = $2::uuid AND channel_type = $3');
    });

    it('uses the current widget connection for persona routing and rejects a different conversation account', async () => {
        const { service, prisma } = makeService();
        await collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'hello', { inboundMessageId: '40000000-0000-4000-8000-000000000004', ...{ channelAccountId: 'wgt_current' } }));
        expect((service as any).personaService.resolvePersonaForChannel).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001', 'web_widget', 'wgt_current');
        expect((service as any).generateResponse.mock.calls[0][2].channelAccountId).toBe('wgt_current');
        prisma.executeInTenantSchema.mockResolvedValueOnce([{ id: '20000000-0000-4000-8000-000000000002', contact_id: '30000000-0000-4000-8000-000000000003', channel_account_id: 'wgt_other' }]);
        await expect(collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'hello', { inboundMessageId: '40000000-0000-4000-8000-000000000005', ...{ channelAccountId: 'wgt_current' } }))).rejects.toThrow('widget_conversation_scope_mismatch');
        expect((service as any).generateResponse).toHaveBeenCalledTimes(1);
    });

    it('does not call the provider after the monthly quota is exhausted', async () => {
        const { service, prisma, throttle, llmRouter } = makeService({
            throttle: {
                getAiMessageUsage: jest.fn().mockResolvedValue({ used: 10, limit: 10 }),
            },
        });

        await expect(collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'hello', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }))).resolves.toBe('quota fallback');
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

        await expect(collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'human please', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }))).resolves.toContain('cannot transfer');

        expect(handoff.executeHandoff).not.toHaveBeenCalled();
        expect(handoff.executeHandoffOnce).not.toHaveBeenCalled();
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('does not attribute a widget conversation already owned by a human', async () => {
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('SELECT id, direction, content_text FROM messages')) return [];
            if (sql.includes('SELECT * FROM conversations')) {
                return [{ id: '20000000-0000-4000-8000-000000000002', channel_account_id: 'widget', contact_id: '30000000-0000-4000-8000-000000000003', status: 'with_human' }];
            }
            return [];
        });
        const { service, llmRouter } = makeService({
            prisma: { executeInTenantSchema },
        });

        await expect(collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'human follow-up', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }))).resolves.toBe('');

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

        const output = await collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'human please', { inboundMessageId: '40000000-0000-4000-8000-000000000004', ...{ allowHumanHandoff: true } }));

        expect(output).toContain('support team');
        expect(handoff.executeHandoffOnce).toHaveBeenCalledTimes(1);
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

        await expect(collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'hello', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }))).resolves.toBe('quota fallback');
        expect(incrementAiMessageCount).toHaveBeenNthCalledWith(1, '10000000-0000-4000-8000-000000000001');
        expect(incrementAiMessageCount).toHaveBeenNthCalledWith(2, '10000000-0000-4000-8000-000000000001', -1);
        expect(llmRouter.executeStream).not.toHaveBeenCalled();
    });

    it('reuses the finalized inbound reply without repeating tools or usage', async () => {
        const { service, redis, throttle } = makeService();
        const run = () => collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'book', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }));
        await run();
        redis.get.mockResolvedValue(JSON.stringify({ conversationId: '20000000-0000-4000-8000-000000000002', contactId: '30000000-0000-4000-8000-000000000003', text: 'safe reply' }));
        expect(await run()).toBe('safe reply');
        expect((service as any).generateResponse).toHaveBeenCalledTimes(1);
        expect(throttle.incrementAiMessageCount).toHaveBeenCalledTimes(1);
    });

    it('rejects mismatched tenant scope before reading the conversation', async () => {
        const { service, prisma } = makeService();
        (service as any).tenantSchema.mockResolvedValue('tenant_other');
        await expect(collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'hello', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }))).rejects.toThrow('widget_tenant_scope_mismatch');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('stores draft suggestions without customer delivery or handoff', async () => {
        const { service, prisma } = makeService();
        const internal = service as any;
        const persona = await internal.personaService.resolvePersonaForChannel();
        persona.config.behavior = { draftMode: true };
        internal.handoffService.shouldHandoff.mockReturnValue('human_requested');
        expect(await collect(service.processWidgetMessage('10000000-0000-4000-8000-000000000001', 'tenant_1', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'human please', { inboundMessageId: '40000000-0000-4000-8000-000000000004' }))).toBe('');
        expect(internal.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(internal.handoffService.executeHandoffOnce).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema.mock.calls.some((call: any[]) => call[1].includes('pendingDraft'))).toBe(true);
        expect(internal.eventEmitter.emit).toHaveBeenCalledWith('draft.suggested', expect.objectContaining({ text: 'safe reply' }));
    });
});
