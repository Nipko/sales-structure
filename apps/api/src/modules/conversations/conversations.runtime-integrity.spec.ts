import { ConversationsService } from './conversations.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { ResponseValidatorService } from './response-validator.service';
import { attributeKnowledgeResponse } from '../knowledge/knowledge-attribution';
import { enrollmentTerms,enrollmentTermsReviewResult } from '../education/enrollment-terms';

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
        let metadata: any = {};
        const query = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
            if (sql.startsWith('SELECT metadata FROM conversations')) return [{ metadata: structuredClone(metadata) }];
            if (sql.startsWith('UPDATE conversations SET metadata=') && params[2]) {
                metadata = { ...metadata, ...JSON.parse(params[2]) }; return [{ id: params[0] }];
            }
            if (sql.includes('FROM messages')) return [];
            return [];
        });
        Object.assign(service, {
            logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
            prisma: { executeInTenantSchema: query, transactionInTenantSchema: (schema: string, work: any) => work((sql: string, params?: any[]) => query(schema, sql, params)), tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) } },
            redis: { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined), incr: jest.fn().mockResolvedValue(1), expire: jest.fn(), sadd: jest.fn(), rpush: jest.fn() },
            llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0, stageToScore: () => 0, execute: llm },
            languageDetector: { detect: () => 'es' },
            tenantSchema: jest.fn().mockResolvedValue('tenant_test'),
            isWithinBusinessHours: jest.fn().mockReturnValue(true),
            loadBookingState: jest.fn().mockResolvedValue({ step: 'idle' }),
            procedureEngine: { getState: jest.fn().mockResolvedValue(null), process: jest.fn().mockResolvedValue({ handled: false }), missionCandidates: jest.fn().mockResolvedValue([]) },
            bookingEngine: { process: jest.fn().mockResolvedValue({ handled: false, state: { step: 'idle' } }) },
            activeOperationsContext: { populateTurnContext: jest.fn() },
            businessInfoService: { getPrimary: jest.fn().mockResolvedValue(null) },
            knowledgeService: {
                tenantHasKnowledge: jest.fn().mockResolvedValue(true),
                searchRelevant: jest.fn().mockResolvedValue([{ id: 'kb-1', title: 'Tarifas', score: 0.95, chunk_text: 'La consulta cuesta COP 20000.' }]),
                recordResponseAttribution: jest.fn(async (_tenant, _conversation, reply, items) => ({ ...attributeKnowledgeResponse(reply, items), persistence: 'disabled' })),
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
        service.bookingEngine.forExecution = () => service.bookingEngine;
        service.procedureEngine.forExecution = () => service.procedureEngine;
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

    it('attributes only the final guarded reply, never a rejected answer with a plausible citation', async () => {
        const { service, run, llm } = fixture();
        service.knowledgeService.searchRelevant.mockResolvedValue([{ id: 'chunk', document_id: 'document', retrievalId: 'retrieval',
            title: 'Tarifas', score: 0.95, chunk_text: 'La consulta cuesta COP 20000.', doc_version: 3 }]);
        llm.mockResolvedValue({ content: 'El precio es COP 1000. [Article: Tarifas]' });
        const reply = await run();
        expect(reply).toContain('No tengo un precio verificado');
        const hook = service.knowledgeService.recordResponseAttribution;
        expect(hook).toHaveBeenCalledTimes(1);
        expect(hook.mock.calls[0][2]).toBe(reply);
        expect(hook.mock.calls[0][3][0]).toMatchObject({ documentId: 'document', retrievalId: 'retrieval', version: 3 });
        expect((await hook.mock.results[0].value).observedDocuments).toBe(0);
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
    it('keeps a changed seat request in consent recovery without escalating or retrying the writer',async()=>{
        const {service,run,llm}=fixture();
        const terms=enrollmentTerms({id:'course',name:'Course',price:100,currency:'COP'},{id:'cohort',starts_at:'2099-01-01'});
        const result={...enrollmentTermsReviewResult(terms,true,'cohort_full_waitlist_requires_consent'),waitlistAvailable:true};
        service.toolExecutionControl.findPendingConfirmation.mockResolvedValue({toolName:'enroll_student',ledgerId:'pending',args:{cohortId:'cohort'}});
        service.toolExecutor={execute:jest.fn().mockResolvedValue(result)};
        llm.mockResolvedValue({content:'El grupo está lleno. ¿Aceptas entrar en la lista de espera con estas condiciones?'});
        const response=await run('whatsapp','Sí, confirmo');
        expect(response).toContain('lista de espera');expect(service.toolExecutor.execute).toHaveBeenCalledTimes(1);
        expect(service.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(llm.mock.calls[0][0].systemPrompt).toContain('La aceptación anterior no autoriza este cambio');
    });
});
