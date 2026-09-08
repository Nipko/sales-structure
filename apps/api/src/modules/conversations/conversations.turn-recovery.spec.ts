import { ConversationsService } from './conversations.service';

/**
 * What a replay of an interrupted turn is owed.
 *
 * Redis held the words under `turn:reply:*` and nothing else, so a crash between
 * generating the answer and dispatching it replayed the text and lost the
 * payment link, the pictures and the learned sources — and the answer that
 * finally arrived was a different answer. These tests drive the real `runTurn`
 * against a ledger double and assert on what reaches the customer.
 */
describe('recovering a turn from its ledger', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const inboundMessageId = '44444444-4444-4444-8444-444444444444';

    function fixture(ledgerRow: any, options: { duplicate?: boolean } = {}) {
        const service: any = Object.create(ConversationsService.prototype);
        const conversation = { id: conversationId, contact_id: contactId, status: 'active', updated_at: new Date(), metadata: {} };
        const ledger = {
            open: jest.fn().mockResolvedValue(ledgerRow),
            read: jest.fn().mockResolvedValue(ledgerRow),
            recordResult: jest.fn(async (_schema: string, input: any) => ({ ...input, state: 'result_recorded' })),
            recordDelivery: jest.fn().mockResolvedValue(undefined),
            recordHandoff: jest.fn().mockResolvedValue(undefined),
            settle: jest.fn().mockResolvedValue(undefined),
        };
        const sends: any[] = [];
        Object.assign(service, {
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            redis: {
                acquireLockToken: jest.fn().mockResolvedValue('owned'),
                releaseLockToken: jest.fn().mockResolvedValue(true),
                renewLockToken: jest.fn().mockResolvedValue(true),
                get: jest.fn().mockResolvedValue(null),
                set: jest.fn().mockResolvedValue(undefined),
                getJson: jest.fn().mockResolvedValue(null),
                setJson: jest.fn().mockResolvedValue(undefined),
                del: jest.fn().mockResolvedValue(undefined),
                incr: jest.fn().mockResolvedValue(1),
                expire: jest.fn().mockResolvedValue(undefined),
            },
            turnLedger: ledger,
            debounceBurst: jest.fn().mockResolvedValue(undefined),
            resolveConversation: jest.fn().mockResolvedValue({ contact: { id: contactId }, conversation, lead: { id: 'lead' } }),
            tenantSchema: jest.fn().mockResolvedValue('tenant_recovery'),
            prisma: { executeInTenantSchema: jest.fn().mockResolvedValue([]) },
            analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
            nurturingService: { cancelFollowUp: jest.fn().mockResolvedValue(undefined), scheduleFollowUp: jest.fn().mockResolvedValue(undefined) },
            dripSequenceService: { stopOnReply: jest.fn().mockResolvedValue(undefined) },
            pipelineService: {
                resolveTenantStage: jest.fn().mockResolvedValue({ slug: 'initial' }),
                autoProgressFromConversation: jest.fn().mockResolvedValue(undefined),
            },
            leadScoring: { scoreAfterMessage: jest.fn().mockResolvedValue(undefined) },
            personaService: {
                resolvePersonaForChannel: jest.fn().mockResolvedValue({
                    config: { language: 'es', hours: { aiOutsideHours: true } },
                    agentId: '55555555-5555-4555-8555-555555555555', version: 3,
                }),
            },
            llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0 },
            throttle: { hasAiMessageQuota: jest.fn().mockResolvedValue(true), incrementAiMessageCount: jest.fn().mockResolvedValue(undefined) },
            handoffService: { isInHandoff: jest.fn().mockResolvedValue(false),
                shouldHandoff: jest.fn().mockReturnValue(null), executeHandoff: jest.fn().mockResolvedValue(undefined) },
            complianceService: { detectOptOut: jest.fn().mockReturnValue(false) },
            isWithinBusinessHours: jest.fn().mockReturnValue(true),
            loadTenantBusinessHours: jest.fn().mockResolvedValue(null),
            persistConversationPersonaResolution: jest.fn().mockResolvedValue(undefined),
            saveMessage: jest.fn().mockResolvedValue({ id: inboundMessageId, duplicate: options.duplicate ?? true }),
            saveAiMessage: jest.fn().mockResolvedValue(undefined),
            recordAgentSignal: jest.fn(),
            generateResponse: jest.fn().mockResolvedValue('una respuesta nueva'),
            sendAfterHoursMessage: jest.fn(),
            sendResponse: jest.fn(async (_t: string, text: string) => { sends.push({ kind: 'text', text }); }),
            sendPaymentLink: jest.fn(async (_t: string, _m: any, url: string) => { sends.push({ kind: 'payment_link', url }); }),
            sendMedia: jest.fn(async (_t: string, _m: any, url: string, caption?: string) => { sends.push({ kind: 'media', url, caption }); }),
            dispatchReplyThroughOutbox: jest.fn().mockResolvedValue(false),
            resumeOwnedDispatchBatch: jest.fn().mockResolvedValue(false),
        });
        const message: any = {
            id: 'provider-message', tenantId, contactId: '573001112233', channelType: 'whatsapp',
            channelAccountId: 'account-one', content: { type: 'text', text: 'hola' }, metadata: {},
        };
        return { service, message, ledger, sends };
    }

    const storedEnvelope = {
        text: 'Te dejo el enlace y la foto',
        chunks: ['Te dejo el enlace y la foto'],
        paymentLinks: ['https://checkout.example/abc'],
        media: [{ url: 'https://cdn.example/one.jpg', caption: 'la foto' }],
        learningFootprints: [{ version: 1, tenantId, agentId: '55555555-5555-4555-8555-555555555555', entries: [] }],
    };

    it('reuses the recorded answer with its link and its pictures, and asks no model', async () => {
        const { service, message, sends } = fixture({
            state: 'result_recorded', attempts: 2, envelope: storedEnvelope,
            writers: [{ tool: 'create_appointment', status: 'succeeded', ledgerId: null, receipt: 'appt-1' }],
        });
        await service.runTurn(message);

        expect(service.generateResponse).not.toHaveBeenCalled();
        expect(sends).toEqual([
            { kind: 'text', text: 'Te dejo el enlace y la foto' },
            { kind: 'payment_link', url: 'https://checkout.example/abc' },
            { kind: 'media', url: 'https://cdn.example/one.jpg', caption: 'la foto' },
        ]);
    });

    it('hands the recovered effects to the durable path instead of losing them', async () => {
        const { service, message } = fixture({
            state: 'result_recorded', attempts: 2, envelope: storedEnvelope, writers: [],
        });
        service.dispatchReplyThroughOutbox = jest.fn().mockResolvedValue(true);
        await service.runTurn(message);

        expect(service.dispatchReplyThroughOutbox).toHaveBeenCalledWith(expect.objectContaining({
            chunks: ['Te dejo el enlace y la foto'],
            paymentLinks: ['https://checkout.example/abc'],
            media: [{ url: 'https://cdn.example/one.jpg', caption: 'la foto' }],
            learningFootprints: storedEnvelope.learningFootprints,
        }));
    });

    it('stops a turn the ledger says was already answered to the end', async () => {
        const { service, message, sends } = fixture({ state: 'settled', attempts: 2, envelope: storedEnvelope, writers: [] });
        await service.runTurn(message);

        expect(service.generateResponse).not.toHaveBeenCalled();
        expect(sends).toEqual([]);
    });

    it('records the whole result before anything is sent', async () => {
        const { service, message, ledger } = fixture({ state: 'open', attempts: 1, envelope: null, writers: [] },
            { duplicate: false });
        const order: string[] = [];
        ledger.recordResult.mockImplementation(async (_schema: string, input: any) => {
            order.push('record'); return { ...input, state: 'result_recorded' };
        });
        service.generateResponse = jest.fn(async (...args: any[]) => {
            const sink = args[args.length - 1];
            sink.paymentLinks.push('https://checkout.example/new');
            sink.media.push({ url: 'https://cdn.example/new.jpg' });
            sink.writers.push({ tool: 'place_catalog_order', status: 'succeeded', ledgerId: null, receipt: 'order-9' });
            return 'la respuesta';
        });
        service.sendResponse = jest.fn(async () => { order.push('send'); });

        await service.runTurn(message);

        expect(order[0]).toBe('record');
        expect(order).toContain('send');
        expect(ledger.recordResult).toHaveBeenCalledWith('tenant_recovery', expect.objectContaining({
            inboundMessageId,
            envelope: expect.objectContaining({
                text: 'la respuesta',
                paymentLinks: ['https://checkout.example/new'],
                media: [{ url: 'https://cdn.example/new.jpg' }],
            }),
            writers: [expect.objectContaining({ tool: 'place_catalog_order', receipt: 'order-9' })],
            agentVersion: 3,
        }));
    });

    it('adopts the answer a concurrent attempt recorded first', async () => {
        const { service, message, ledger, sends } = fixture({ state: 'open', attempts: 1, envelope: null, writers: [] },
            { duplicate: false });
        ledger.recordResult.mockResolvedValue({ state: 'result_recorded', envelope: storedEnvelope, writers: [] });
        await service.runTurn(message);

        expect(sends[0]).toEqual({ kind: 'text', text: 'Te dejo el enlace y la foto' });
        expect(sends).toContainEqual({ kind: 'payment_link', url: 'https://checkout.example/abc' });
    });

    it('sends nothing at all when the learned provenance of the words cannot be stated', async () => {
        const { service, message, sends, ledger } = fixture({ state: 'open', attempts: 1, envelope: null, writers: [] },
            { duplicate: false });
        service.generateResponse = jest.fn(async (...args: any[]) => {
            const sink = args[args.length - 1];
            sink.learningProvenanceRefused = true;
            return 'palabras derivadas de un ejemplo aprendido';
        });

        await service.runTurn(message);

        expect(sends).toEqual([]);
        expect(service.dispatchReplyThroughOutbox).not.toHaveBeenCalled();
        expect(ledger.recordResult).not.toHaveBeenCalled();
        expect(service.recordAgentSignal).toHaveBeenCalledWith(tenantId, 'learning_provenance_refused');
    });

    it('stamps the turn as finished in PostgreSQL, not only in Redis', async () => {
        const { service, message, ledger } = fixture({ state: 'open', attempts: 1, envelope: null, writers: [] },
            { duplicate: false });
        service.processIncomingMessage = ConversationsService.prototype.processIncomingMessage.bind(service);
        await service.runTurn(message);
        expect((message as any).turnLedgerRef).toEqual({ schemaName: 'tenant_recovery', inboundMessageId });
    });
});
