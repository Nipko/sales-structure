import { ConversationsService } from './conversations.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { ResponseValidatorService } from './response-validator.service';
import { attributeKnowledgeResponse } from '../knowledge/knowledge-attribution';
import { enrollmentTerms,enrollmentTermsReviewResult } from '../education/enrollment-terms';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { HUMAN_OFFER_MARK, policyPersonOfferText } from './human-offer';
import { HandoffService } from '../handoff/handoff.service';

describe('Shared runtime integrity', () => {
    const style=(id='style-one')=>({id,releaseId:'release',releaseHash:'hash',situation:'general',
        responsePattern:`REVIEWED_STYLE_${id}`,rationale:'Tone only',factsRequired:[],authority:'style_only'});
    function addLearning(service:any,revokeAttempt:number){
        let attempt=0;
        service.learning={getRuntimeExamples:jest.fn().mockResolvedValue([style()]),
            runtimeSourceAuthority:jest.fn((_tenant,_agent,_examples)=>async(invoke:any)=>{
                const response=await invoke();if(++attempt===revokeAttempt)throw new LLMSourceAuthorityUnavailable(response.usage);
                return response;
            })};
    }
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
            if(sql.startsWith('SELECT contact_id FROM conversations'))return[{contact_id:'22222222-2222-4222-8222-222222222222'}];
            if(sql.startsWith("UPDATE conversations SET metadata=(COALESCE")){
                metadata={...metadata,...JSON.parse(params[1])};return[{id:params[0]}];
            }
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
            mediaProcessing: {
                handlePendingConsentReply: jest.fn().mockResolvedValue({ handled: false }),
                processMedia: jest.fn(),
                getFallbackMessage: jest.fn(),
            },
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
            config, { id: conversation.contact_id, name: 'Alice' }, {}, conversation.updated_at, {}, '44444444-4444-4444-8444-444444444444', 'agent', undefined, 3,
        );
        return { service, run, llm, domainCreate, config, query };
    }

    // The provenance of a learned reply is proven as the examples arrive, not
    // once the words exist. Aggregating only at the end left a single move when
    // the scope or an example was malformed: hand admission an empty footprint,
    // which reads as "this reply used no learning" — the one claim it cannot
    // make. Now the refusal happens before the prompt is assembled.
    const scope = { kind: 'agent' as const, tenantId: '11111111-1111-4111-8111-111111111111',
        schemaName: 'tenant_test', agentId: '66666666-6666-4666-8666-666666666666', version: 3,
        operationalHash: 'c'.repeat(64), legacyConfigHash: null };
    const provable = (id = '77777777-7777-4777-8777-777777777777') => ({ id,
        releaseId: '88888888-8888-4888-8888-888888888888', releaseHash: 'd'.repeat(64),
        situation: 'general', responsePattern: `REVIEWED_STYLE_${id}`, rationale: 'Tone only',
        factsRequired: [] as string[], authority: 'style_only' as const });
    const withSink = (service: any, conversation: any, config: any, sink: any) => service.generateResponse(
        '11111111-1111-4111-8111-111111111111', conversation,
        { channelType: 'whatsapp', channelAccountId: 'wa', content: { type: 'text', text: 'hola' }, metadata: {} },
        config, { id: conversation.contact_id, name: 'Alice' }, {}, conversation.updated_at, {},
        '44444444-4444-4444-8444-444444444444', scope.agentId, undefined, 3, scope, undefined, sink);

    it('hands up the sources a messaging reply really derives from', async () => {
        const { service, llm } = fixture();
        const conversation = { id: '33333333-3333-4333-8333-333333333333', contact_id: '22222222-2222-4222-8222-222222222222', updated_at: new Date(), metadata: {} };
        const config: any = { language: 'es', industry: 'salud', behavior: {}, llm: {}, tools: { appointments: { enabled: false } } };
        service.learning = { getRuntimeExamples: jest.fn().mockResolvedValue([provable()]),
            runtimeSourceAuthority: jest.fn(() => async (invoke: any) => invoke()) };
        const sink: any = { paymentLinks: [], media: [], learningFootprints: [], writers: [] };
        await withSink(service, conversation, config, sink);

        expect(llm.mock.calls[0][0].systemPrompt).toContain('REVIEWED_STYLE_77777777-7777-4777-8777-777777777777');
        expect(sink.learningProvenanceRefused).toBeUndefined();
        expect(sink.learningFootprints).toEqual([expect.objectContaining({
            agentId: scope.agentId,
            entries: [expect.objectContaining({ releaseId: '88888888-8888-4888-8888-888888888888' })],
        })]);
    });

    it('keeps an example whose provenance cannot be stated out of the prompt and answers without it', async () => {
        const { service, llm } = fixture();
        const conversation = { id: '33333333-3333-4333-8333-333333333333', contact_id: '22222222-2222-4222-8222-222222222222', updated_at: new Date(), metadata: {} };
        const config: any = { language: 'es', industry: 'salud', behavior: {}, llm: {}, tools: { appointments: { enabled: false } } };
        // `releaseId` is not an identifier the collector can attribute anything to.
        service.learning = { getRuntimeExamples: jest.fn().mockResolvedValue([{ ...provable(), releaseId: 'release' }]),
            runtimeSourceAuthority: jest.fn(() => async (invoke: any) => invoke()) };
        const sink: any = { paymentLinks: [], media: [], learningFootprints: [], writers: [] };
        expect(await withSink(service, conversation, config, sink)).toBe('La consulta cuesta COP 20.000.');

        expect(llm.mock.calls[0][0].systemPrompt).not.toContain('REVIEWED_STYLE_');
        expect(llm.mock.calls[0][0].withSourceAuthority).toBeUndefined();
        expect(sink.learningFootprints).toEqual([]);
        expect(sink.learningProvenanceRefused).toBeUndefined();
    });

    it('never asks for a learned example when the turn scope itself cannot hold provenance', async () => {
        const { service } = fixture();
        const conversation = { id: '33333333-3333-4333-8333-333333333333', contact_id: '22222222-2222-4222-8222-222222222222', updated_at: new Date(), metadata: {} };
        const config: any = { language: 'es', industry: 'salud', behavior: {}, llm: {}, tools: { appointments: { enabled: false } } };
        service.learning = { getRuntimeExamples: jest.fn().mockResolvedValue([provable()]),
            runtimeSourceAuthority: jest.fn(() => async (invoke: any) => invoke()) };
        const sink: any = { paymentLinks: [], media: [], learningFootprints: [], writers: [] };
        await service.generateResponse(
            '11111111-1111-4111-8111-111111111111', conversation,
            { channelType: 'whatsapp', channelAccountId: 'wa', content: { type: 'text', text: 'hola' }, metadata: {} },
            config, { id: conversation.contact_id, name: 'Alice' }, {}, conversation.updated_at, {},
            '44444444-4444-4444-8444-444444444444', scope.agentId, undefined, 3,
            { ...scope, operationalHash: 'not-a-hash' }, undefined, sink);

        expect(service.learning.getRuntimeExamples).not.toHaveBeenCalled();
        expect(sink.learningFootprints).toEqual([]);
    });

    it.each(['whatsapp', 'web_widget'])('grounds the %s turn in the same business knowledge', async channel => {
        const { service, run, llm, query } = fixture();
        expect(await run(channel)).toBe('La consulta cuesta COP 20.000.');
        expect(service.knowledgeService.searchRelevant).toHaveBeenCalledTimes(1);
        expect(llm.mock.calls[0][0].systemPrompt).toContain(`<channel>${channel}</channel>`);
        expect(query.mock.calls.some((call: any[]) => call[1].includes('id <> $2::uuid'))).toBe(true);
    });
    it('discards tool requests generated from a revoked learning source and recovers without tools',async()=>{
        const {service,run,llm}=fixture();addLearning(service,1);
        service.toolExecutor={execute:jest.fn()};
        let calls=0;
        llm.mockImplementation(async request=>{
            const invoke=async()=>++calls===1?{content:'REVOKED_MODEL_PROSE',toolCalls:[{id:'call',function:{name:'create_appointment',arguments:'{}'}}]}
                :{content:'La consulta cuesta COP 20000.'};
            return request.withSourceAuthority?request.withSourceAuthority(invoke):invoke();
        });
        expect(await run()).toBe('La consulta cuesta COP 20.000.');
        expect(service.toolExecutor.execute).not.toHaveBeenCalled();
        expect(llm.mock.calls[0][0].systemPrompt).toContain('REVIEWED_STYLE_style-one');
        const recovery=llm.mock.calls[1][0];
        expect(recovery.tools).toBeUndefined();expect(recovery.withSourceAuthority).toBeUndefined();
        expect(recovery.systemPrompt).not.toContain('REVIEWED_STYLE_style-one');
        expect(JSON.stringify(recovery.messages)).not.toContain('REVOKED_MODEL_PROSE');
    });
    it('preserves a committed receipt without repeating its writer when a later learning selection is revoked',async()=>{
        const {service,run,llm,config}=fixture();addLearning(service,2);config.tools.appointments.enabled=true;
        service.intentInterpreter={interpret:jest.fn(async()=>({intent:'other'}))};
        service.learning.getRuntimeExamples.mockResolvedValueOnce([style()]).mockResolvedValue([style('style-two')]);
        service.toolExecutor={execute:jest.fn(async()=>({success:true,status:'confirmed',appointmentId:'55555555-5555-4555-8555-555555555555'}))};
        let calls=0;
        llm.mockImplementation(async request=>{
            const invoke=async()=>{
                calls++;
                if(calls===1)return{content:'OLD_GENERATED_STYLE',toolCalls:[{id:'call',function:{name:'create_appointment',arguments:'{}'}}]};
                if(calls===2)return{content:'REVOKED_CLOSING_STYLE'};
                return{content:'Tu cita está confirmada.'};
            };
            return request.withSourceAuthority?request.withSourceAuthority(invoke):invoke();
        });
        expect(await run('whatsapp','Sí, confirmo')).toBe('Tu cita está confirmada.');
        expect(service.toolExecutor.execute).toHaveBeenCalledTimes(1);
        expect(service.learning.runtimeSourceAuthority.mock.calls[1][2].map((e:any)=>e.id)).toEqual(['style-one','style-two']);
        const recovery=llm.mock.calls[2][0];expect(recovery.tools).toBeUndefined();
        expect(JSON.stringify(recovery.messages)).toContain('55555555-5555-4555-8555-555555555555');
        expect(JSON.stringify(recovery.messages)).not.toMatch(/OLD_GENERATED_STYLE|REVOKED_CLOSING_STYLE/);
        expect(recovery.systemPrompt).not.toContain('REVIEWED_STYLE_');
    });
    it('uses the same authority for corrective rewrites and removes revoked examples from the replacement',async()=>{
        const {service,run,llm}=fixture();addLearning(service,2);
        let calls=0;
        llm.mockImplementation(async request=>{
            const invoke=async()=>({content:++calls<3?'El precio es COP 1000.':'La consulta cuesta COP 20000.'});
            return request.withSourceAuthority?request.withSourceAuthority(invoke):invoke();
        });
        expect(await run()).toBe('La consulta cuesta COP 20.000.');
        expect(llm.mock.calls[1][0].withSourceAuthority).toBeInstanceOf(Function);
        expect(llm.mock.calls[2][0].systemPrompt).not.toContain('REVIEWED_STYLE_');
        expect(llm.mock.calls[2][0].tools).toBeUndefined();
    });
    it('guards the forced closing answer after tool-loop exhaustion',async()=>{
        const {service,run,llm}=fixture();addLearning(service,6);
        service.toolExecutor={execute:jest.fn(async()=>({products:[]}))};
        let calls=0;
        llm.mockImplementation(async request=>{
            const invoke=async()=>{
                calls++;
                if(calls<=5)return{content:'OLD_LOOP_PROSE',toolCalls:[{id:`call-${calls}`,function:{name:'search_products',arguments:'{}'}}]};
                return{content:calls===6?'REVOKED_CLOSING':'La consulta cuesta COP 20000.'};
            };
            return request.withSourceAuthority?request.withSourceAuthority(invoke):invoke();
        });
        expect(await run()).toBe('La consulta cuesta COP 20.000.');
        expect(service.toolExecutor.execute).toHaveBeenCalledTimes(5);
        expect(llm.mock.calls[5][0].withSourceAuthority).toBeInstanceOf(Function);
        expect(llm.mock.calls[6][0].tools).toBeUndefined();
        expect(JSON.stringify(llm.mock.calls[6][0].messages)).not.toMatch(/OLD_LOOP_PROSE|REVOKED_CLOSING/);
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

    it('records the citation for attribution but never lets the marker reach the customer', async () => {
        const { service, run, llm } = fixture();
        service.knowledgeService.searchRelevant.mockResolvedValue([{ id: 'chunk', document_id: 'document', retrievalId: 'retrieval',
            title: 'Tarifas', score: 0.95, chunk_text: 'La consulta cuesta COP 20000.', doc_version: 3 }]);
        llm.mockResolvedValue({ content: 'La consulta cuesta COP 20000. [Article: Tarifas]' });
        const reply = await run();
        expect(reply).toBe('La consulta cuesta COP 20.000.');
        const hook = service.knowledgeService.recordResponseAttribution;
        expect(hook).toHaveBeenCalledTimes(1);
        // Attribution reads the raw reply; only the delivered text is clean.
        expect(hook.mock.calls[0][2]).toBe('La consulta cuesta COP 20.000. [Article: Tarifas]');
        expect(attributeKnowledgeResponse(hook.mock.calls[0][2], hook.mock.calls[0][3]).citedDocuments).toBe(1);
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
    it('does not propose effects under a new version using instructions loaded before publication',async()=>{
        const {run,llm,query,domainCreate}=fixture(true);
        query.mockResolvedValueOnce([{id:'agent',version:4}] as any);
        await run();
        expect(query.mock.calls[0][1]).toContain('SELECT id, version FROM agent_personas');
        expect(llm.mock.calls[0][0].tools.map((tool:any)=>tool.name)).toEqual(['search_products']);
        expect(domainCreate).not.toHaveBeenCalled();
    });

    // A refund question that asks HOW (round 3): the real turn answers it and, only
    // then, offers a person, so a customer who wants the refund says "sí" once.
    describe('the person offered after an action-oriented refund question', () => {
        const OFFER = policyPersonOfferText('es');
        const markWritten = (query: jest.Mock) => query.mock.calls.some((c: any[]) => String(c[1]).includes('{' + HUMAN_OFFER_MARK + '}'));

        it('is appended to the answer and leaves the mark the next "sí" is judged against', async () => {
            const { run, llm, query } = fixture();
            llm.mockResolvedValue({ content: 'La consulta cuesta COP 20000.' });
            expect(await run('whatsapp', '¿Puedo pedir un reembolso?')).toBe('La consulta cuesta COP 20.000.\n\n' + OFFER);
            expect(markWritten(query)).toBe(true);
        });

        it.each([
            '¿Cuál es la política de devoluciones?',
            '¿Aceptan devoluciones?',
            '¿se puede pagar con tarjeta? ¿y hay devoluciones?',
            '¿Es posible un descuento?',
            '¿Cuál es el horario?',
        ])('is not appended to the answer to %s', async (text) => {
            const { run, llm, query } = fixture();
            llm.mockResolvedValue({ content: 'La consulta cuesta COP 20000.' });
            expect(await run('whatsapp', text)).toBe('La consulta cuesta COP 20.000.');
            expect(markWritten(query)).toBe(false);
        });

        it('is not appended when the answer already ends with a question of its own', async () => {
            const { run, llm, query } = fixture();
            llm.mockResolvedValue({ content: 'La consulta cuesta COP 20000. ¿Le sirve ese valor?' });
            expect(await run('whatsapp', '¿Cómo solicito una devolución?')).toBe('La consulta cuesta COP 20.000. ¿Le sirve ese valor?');
            expect(markWritten(query)).toBe(false);
        });

        it('is not appended to the placeholder the pipeline uses when the model produced nothing', async () => {
            const { run, llm } = fixture();
            llm.mockResolvedValue({ content: '' });
            const reply = await run('whatsapp', '¿Puedo pedir un reembolso?');
            expect(reply).toBe('[Error Generating AI Response]');
            expect(reply).not.toContain(OFFER);
        });

        it('is not appended to the fallback the pipeline sends when the tool loop never produces an answer', async () => {
            const { service, run, llm, query } = fixture();
            service.toolExecutor = { execute: jest.fn().mockResolvedValue({ success: true }) };
            llm.mockResolvedValue({ content: '', toolCalls: [{ id: 'call', function: { name: 'search_products', arguments: '{}' } }] });
            const reply = await run('whatsapp', '¿Puedo pedir un reembolso?');
            expect(reply).toContain('estoy teniendo problemas');
            expect(reply).not.toContain(OFFER);
            expect(markWritten(query)).toBe(false);
        });

        it('is not appended where nobody can be offered (a widget without handoff) or in draft mode', async () => {
            const widget = fixture();
            widget.llm.mockResolvedValue({ content: 'La consulta cuesta COP 20000.' });
            expect(await widget.run('web_widget', '¿Puedo pedir un reembolso?')).toBe('La consulta cuesta COP 20.000.');
            expect(markWritten(widget.query)).toBe(false);
            const draft = fixture(true);
            draft.llm.mockResolvedValue({ content: 'La consulta cuesta COP 20000.' });
            expect(String(await draft.run('whatsapp', '¿Puedo pedir un reembolso?'))).not.toContain(OFFER);
            expect(markWritten(draft.query)).toBe(false);
        });
    });

    // The refund / return / discount classifier at turn level: the turn reads its
    // label once, the reply's offer follows it, and a message without the topic
    // never pays for a model call.
    describe('the classifier inside the turn', () => {
        const OFFER = policyPersonOfferText('es');
        const config: any = { behavior: { handoffTriggers: [] } };
        const conv = { id: '33333333-3333-4333-8333-333333333333', metadata: {} };
        const tenantId = '11111111-1111-4111-8111-111111111111';

        function withClassifier(label: string | null) {
            const t = fixture();
            const classify = jest.fn().mockImplementation(async () => {
                if (label === null) throw new Error('classifier down');
                return { content: JSON.stringify({ label }) };
            });
            const handoff: any = Object.create(HandoffService.prototype);
            Object.assign(handoff, { llmRouter: { execute: classify }, logger: { warn: jest.fn() },
                executeHandoff: jest.fn(), isInHandoff: jest.fn().mockResolvedValue(false) });
            t.service.handoffService = handoff;
            t.llm.mockResolvedValue({ content: 'La consulta cuesta COP 20000.' });
            return { ...t, classify, handoff };
        }

        it('is read once for the turn, however many readers it has, and drives the offer', async () => {
            const { service, run, classify } = withClassifier('policy_howto');
            const text = '¿Puedo pedir un reembolso?';
            // the top of the turn decides whether to escalate…
            expect(await (service as any).resolveHandoffReason(text, conv, config, tenantId)).toBeNull();
            // …and the reply is built from the same label, plus the authorisation read inside it
            expect(await run('whatsapp', text)).toBe('La consulta cuesta COP 20.000.\n\n' + OFFER);
            expect(classify).toHaveBeenCalledTimes(1);
        });

        it('a policy_info label means no offer, even for a sentence the rules would offer on', async () => {
            const { service, run, classify } = withClassifier('policy_info');
            const text = '¿Puedo pedir un reembolso?';
            await (service as any).resolveHandoffReason(text, conv, config, tenantId);
            expect(await run('whatsapp', text)).toBe('La consulta cuesta COP 20.000.');
            expect(classify).toHaveBeenCalledTimes(1);
        });

        it('a policy_howto label offers a person for wording the rules never heard of', async () => {
            const { service, run } = withClassifier('policy_howto');
            const text = '¿Qué pasos sigo para devolver un producto?';
            await (service as any).resolveHandoffReason(text, conv, config, tenantId);
            expect(await run('whatsapp', text)).toBe('La consulta cuesta COP 20.000.\n\n' + OFFER);
        });

        it('without a label (the model was down) the rules decide the offer', async () => {
            const { service, run, classify } = withClassifier(null);
            const text = '¿Puedo pedir un reembolso?';
            expect(await (service as any).resolveHandoffReason(text, conv, config, tenantId)).toBeNull();
            expect(await run('whatsapp', text)).toBe('La consulta cuesta COP 20.000.\n\n' + OFFER);
            expect(classify).toHaveBeenCalledTimes(1);
        });

        it('a message without the topic never calls the classifier', async () => {
            const { service, run, classify } = withClassifier('policy_howto');
            const text = '¿Cuál es el horario de atención?';
            await (service as any).resolveHandoffReason(text, conv, config, tenantId);
            expect(await run('whatsapp', text)).toBe('La consulta cuesta COP 20.000.');
            expect(classify).not.toHaveBeenCalled();
        });

        it('escalates for personal_case through the handoff service, and the turn asks the service, not the rules', async () => {
            const { service, classify } = withClassifier('personal_case');
            expect(await (service as any).resolveHandoffReason('ojalá me reembolsen hoy', conv, config, tenantId)).toBe('complaint');
            expect(classify).toHaveBeenCalledTimes(1);
        });

        it('hands the turn execution context to the classifier (read-only turns, spend accounting)', async () => {
            const { service } = withClassifier('policy_info');
            const decide = jest.fn().mockResolvedValue(null);
            (service as any).handoffService = { decideHandoff: decide };
            const ctx = { mode: 'agent_test', persistence: 'disabled' };
            await (service as any).resolveHandoffReason('¿Aceptan devoluciones?', conv, config, tenantId, true, ctx);
            expect(decide).toHaveBeenCalledWith('¿Aceptan devoluciones?', conv, config, undefined, tenantId, ctx);
        });

        it('draft mode and handoff services without a classifier use the rules and never a model', async () => {
            const { service, classify } = withClassifier('personal_case');
            expect(await (service as any).resolveHandoffReason('ojalá me reembolsen hoy', conv, config, tenantId, false)).toBeNull();
            expect(classify).not.toHaveBeenCalled();
            (service as any).handoffService = { shouldHandoff: jest.fn().mockReturnValue('complaint') };
            expect(await (service as any).resolveHandoffReason('quiero mi reembolso', conv, config, tenantId)).toBe('complaint');
            expect((service as any).handoffService.shouldHandoff).toHaveBeenCalledWith('quiero mi reembolso', conv, config);
        });
    });
});
