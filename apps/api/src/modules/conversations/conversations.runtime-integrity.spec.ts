import { ConversationsService } from './conversations.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { ResponseValidatorService } from './response-validator.service';

describe('Shared runtime integrity', () => {
    function fixture(draftMode = false) {
        const service: any = Object.create(ConversationsService.prototype);
        const executor: any = Object.create(AIToolExecutorService.prototype);
        executor.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const domainCreate = jest.fn();
        executor.createAppointment = domainCreate;
        const authority = { source: 'turn_contract', allowedTools: ['search_products', 'create_appointment'], deniedTools: [], commitmentBlocked: null, resolvedAt: new Date().toISOString() };
        const tools = authority.allowedTools.map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } }));
        const llm = jest.fn().mockResolvedValue({ content: 'La consulta cuesta COP 20000.' });
        const query = jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('FROM messages')) return [];
            return [];
        });
        Object.assign(service, {
            logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
            prisma: { executeInTenantSchema: query, tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) } },
            redis: { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn(), del: jest.fn(), set: jest.fn(), incr: jest.fn().mockResolvedValue(1), expire: jest.fn(), sadd: jest.fn(), rpush: jest.fn() },
            llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0, stageToScore: () => 0, execute: llm },
            languageDetector: { detect: () => 'es' },
            tenantSchema: jest.fn().mockResolvedValue('tenant_test'),
            isWithinBusinessHours: jest.fn().mockReturnValue(true),
            loadBookingState: jest.fn().mockResolvedValue({ step: 'idle' }),
            procedureEngine: { getState: jest.fn().mockResolvedValue(null), process: jest.fn().mockResolvedValue({ handled: false }) },
            bookingEngine: { process: jest.fn().mockResolvedValue({ handled: false, state: { step: 'idle' } }) },
            activeOperationsContext: { populateTurnContext: jest.fn() },
            businessInfoService: { getPrimary: jest.fn().mockResolvedValue(null) },
            knowledgeService: {
                tenantHasKnowledge: jest.fn().mockResolvedValue(true),
                searchRelevant: jest.fn().mockResolvedValue([{ id: 'kb-1', title: 'Tarifas', score: 0.95, chunk_text: 'La consulta cuesta COP 20000.' }]),
            },
            rewriteSearchQuery: jest.fn().mockImplementation(async text => text),
            turnCapabilityComposer: { resolve: jest.fn().mockResolvedValue({
                tools, authority, deniedTools: [], commitmentBlocked: null, status: { status: 'ok' },
                contract: { version: 1, publishedTools: authority.allowedTools, resolvedAt: authority.resolvedAt, excluded: [], writersBlocked: false },
            }) },
            toolExecutionControl: { findPendingConfirmation: jest.fn().mockResolvedValue(null) },
            toolExecutor: executor,
            handoffService: { executeHandoff: jest.fn(), isInHandoff: jest.fn().mockResolvedValue(false) },
            promptAssembler: new PromptAssemblerService({ buildSystemPrompt: () => '<persona>Assistant</persona>' } as any),
            responseValidator: new ResponseValidatorService(),
            throttle: { getPlanFeatures: jest.fn().mockResolvedValue({ llmTier: 'tier_2' }) },
            analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
            eventEmitter: { emit: jest.fn() },
            sendMedia: jest.fn(), sendPaymentLink: jest.fn(), sendFlow: jest.fn(),
        });
        const config: any = { language: 'es', industry: 'salud', behavior: { draftMode }, llm: {}, tools: { appointments: { enabled: false } } };
        const conversation = { id: '33333333-3333-4333-8333-333333333333', contact_id: '22222222-2222-4222-8222-222222222222', updated_at: new Date(), metadata: {} };
        const run = (channelType = 'whatsapp', text = '¿Me lo dejas en COP 1000?') => service.generateResponse(
            '11111111-1111-4111-8111-111111111111', conversation,
            { channelType, channelAccountId: channelType === 'web_widget' ? 'widget' : 'wa', content: { type: 'text', text }, metadata: {} },
            config, { id: conversation.contact_id, name: 'Alice' }, {}, conversation.updated_at, {}, '44444444-4444-4444-8444-444444444444', 'agent',
        );
        return { service, run, llm, domainCreate, config, query };
    }

    it.each(['whatsapp', 'web_widget'])('grounds the %s turn in the same business knowledge', async channel => {
        const { service, run, llm, query } = fixture();
        expect(await run(channel)).toBe('La consulta cuesta COP 20000.');
        expect(service.knowledgeService.searchRelevant).toHaveBeenCalledTimes(1);
        expect(llm.mock.calls[0][0].systemPrompt).toContain(`<channel>${channel}</channel>`);
        expect(query.mock.calls.some((call: any[]) => call[1].includes('id <> $2::uuid'))).toBe(true);
    });

    it('does not let the customer-proposed price authorize the live response', async () => {
        const { run, llm } = fixture();
        llm.mockResolvedValue({ content: 'El precio es COP 1000.' });
        expect(await run()).toContain('No tengo un precio verificado');
    });

    it('blocks an unadvertised draft writer at the real executor and skips deterministic effects', async () => {
        const { service, run, llm, domainCreate, config } = fixture(true);
        config.tools.appointments.enabled = true;
        llm.mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'call-1', function: { name: 'create_appointment', arguments: '{}' } }] })
            .mockResolvedValue({ content: 'Podemos revisar los horarios disponibles.' });
        expect(await run()).toBe('Podemos revisar los horarios disponibles.');
        const request = llm.mock.calls[0][0];
        expect(request.tools.map((tool: any) => tool.name)).toEqual(['search_products']);
        expect(request.systemPrompt).toContain('<execution_mode>draft</execution_mode>');
        expect(llm.mock.calls[1][0].messages.some((message: any) => message.role === 'tool' && message.content.includes('draft_action_requires_approval'))).toBe(true);
        expect(domainCreate).not.toHaveBeenCalled();
        expect(service.bookingEngine.process).not.toHaveBeenCalled();
        expect(service.procedureEngine.process).not.toHaveBeenCalled();
        expect(service.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(service.sendMedia).not.toHaveBeenCalled();
        expect(service.sendPaymentLink).not.toHaveBeenCalled();
    });
});
