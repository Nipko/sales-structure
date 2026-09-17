import { QualityService } from './quality.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';

describe('QualityService agent attribution', () => {
    function buildHarness(agentId: string | null, version: number | null, options: { config?: any; currentVersion?: number; handedOff?: boolean } = {}) {
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, _params: any[] = []) => {
            if (sql.includes('FROM conversations WHERE id=')) {
                return [{
                    contact_id: '44444444-4444-4444-8444-444444444444', qa_revision: '2',
                    resolution_type: 'ai_resolved',
                    was_handed_off: options.handedOff ?? false,
                    agent_persona_id: agentId,
                    agent_config_version: version,
                }];
            }
            if (sql.includes('COUNT(*)::int AS total_messages')) return [{total_messages:2,text_messages:2}];
            if (sql.includes('FROM agent_personas')) return [{version: options.currentVersion ?? version,config_json: options.config ?? {mission:'Answer questions'}}];
            if (sql.includes('INSERT INTO conversation_quality_scores')) return [{id:'evidence-id'}];
            if (sql.includes('FROM messages')) {
                return [
                    { id:'55555555-5555-4555-8555-555555555555', direction: 'inbound', content_text: '¿Tienen disponibilidad?', original_characters:23 },
                    { id:'66666666-6666-4666-8666-666666666666', direction: 'outbound', content_text: 'Sí, mañana a las diez.', original_characters:21 },
                ];
            }
            return [];
        });
        const prisma: any = {
            getTenantSchemaName: jest.fn(async () => 'tenant_quality_test'),
            executeInTenantSchema,
            transactionInTenantSchema: async (schema: string, work: any) => work((sql: string, params: any[] = []) => executeInTenantSchema(schema,sql,params)),
        };
        const redis: any = {
            get: jest.fn(async () => '1'),
            set: jest.fn(),
        };
        const llmRouter: any = {
            execute: jest.fn(async () => ({
                content: JSON.stringify({
                    overall: 9,
                    resolution: 9,
                    tone: 8,
                    accuracy: 8,
                    empathy: 8,
                    flags: [],
                    resolved: true,
                    resolutionReason: 'La consulta quedó resuelta.',
                }),
            })),
        };
        const queue = { add: jest.fn().mockResolvedValue(undefined) };
        const eventEmitter = { emit: jest.fn() };
        return {
            service: new QualityService(
                prisma,
                redis,
                llmRouter,
                queue as any,
                eventEmitter as any,
            ),
            executeInTenantSchema,
            llmRouter,
            queue,
            eventEmitter,
        };
    }

    it('copies immutable conversation agent/config into quality evidence', async () => {
        const { service, executeInTenantSchema, eventEmitter } = buildHarness(AGENT_ID, 5);
        await service.scoreConversation(TENANT_ID, CONVERSATION_ID);

        const insert = (executeInTenantSchema.mock.calls as any[][]).find(
            (call) => String(call[1]).includes('INSERT INTO conversation_quality_scores'),
        );
        expect(insert).toBeDefined();
        expect(insert![1]).toContain('(conversation_id, agent_id, agent_config_version');
        expect(insert![2].slice(0, 3)).toEqual([CONVERSATION_ID, AGENT_ID, 5]);
        expect(eventEmitter.emit).toHaveBeenCalledWith('quality.scored', expect.objectContaining({
            tenantId: TENANT_ID,
            agentId: AGENT_ID,
            agentConfigVersion: 5,
            status: 'scored',
            evidenceId: 'evidence-id', sourceRevision: '2',
        }));
    });

    it('preserves null attribution for historical conversations', async () => {
        const { service, executeInTenantSchema } = buildHarness(null, null);
        await service.scoreConversation(TENANT_ID, CONVERSATION_ID);

        const insert = (executeInTenantSchema.mock.calls as any[][]).find(
            (call) => String(call[1]).includes('INSERT INTO conversation_quality_scores'),
        );
        expect(insert![2].slice(0, 3)).toEqual([CONVERSATION_ID, null, null]);
    });

    it('evaluates the actual version objective, without sending tool credentials', async () => {
        const mission = { version: 1, objective: 'Acordar seguimiento', intentKeys: ['request_follow_up'],
            successCriteria: ['Confirmar el siguiente contacto'], handoffConditions: ['Derivar a una persona si lo solicita'] };
        const { service, llmRouter } = buildHarness(AGENT_ID, 5, { config: { mission, tools: { crm: { enabled: true, token: 'SECRET' } } } });
        await service.scoreConversation(TENANT_ID, CONVERSATION_ID);
        const content = llmRouter.execute.mock.calls[0][0].messages[0].content;
        expect(JSON.parse(content)).toMatchObject({ evaluationContext: { configuration: 'captured', mission: { objective: mission.objective },
            coverage: { complete: true } }, transcript: expect.stringContaining('Cliente:') });
        expect(content).not.toContain('SECRET');
    });

    it.each([{ currentVersion: 6 }, { handedOff: true }])('never judges old or mixed replies against the current agent config: %p', async options => {
        const { service, llmRouter } = buildHarness(AGENT_ID, 5, { ...options, config: { persona: { role: 'NEW OBJECTIVE' } } });
        await service.scoreConversation(TENANT_ID, CONVERSATION_ID);
        const content = llmRouter.execute.mock.calls[0][0].messages[0].content;
        expect(JSON.parse(content).evaluationContext).toMatchObject({ configuration: 'unavailable', mission: null });
        expect(content).not.toContain('NEW OBJECTIVE');
    });

    it('throws malformed judge output so BullMQ retries instead of persisting score zero', async () => {
        const { service, llmRouter, executeInTenantSchema, eventEmitter } = buildHarness(AGENT_ID, 5);
        llmRouter.execute.mockResolvedValue({ content: '{}' });

        await expect(service.scoreConversation(TENANT_ID, CONVERSATION_ID))
            .rejects.toThrow('QA judge returned an invalid response');
        expect((executeInTenantSchema.mock.calls as any[][]).some(
            (call) => String(call[1]).includes('INSERT INTO conversation_quality_scores'),
        )).toBe(false);
        expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('propagates provider errors so the quality job is not marked successful', async () => {
        const { service, llmRouter, executeInTenantSchema } = buildHarness(AGENT_ID, 5);
        llmRouter.execute.mockRejectedValue(new Error('provider unavailable'));

        await expect(service.scoreConversation(TENANT_ID, CONVERSATION_ID))
            .rejects.toThrow('provider unavailable');
        expect((executeInTenantSchema.mock.calls as any[][]).some(
            (call) => String(call[1]).includes('INSERT INTO conversation_quality_scores'),
        )).toBe(false);
    });

    it.each([null, '', '9'])('rejects a nonnumeric score %p instead of coercing it to evidence', async (overall) => {
        const { service, llmRouter } = buildHarness(AGENT_ID,5);
        llmRouter.execute.mockResolvedValue({content:JSON.stringify({overall,resolution:8,tone:8,accuracy:8,empathy:8,flags:[],resolved:true,resolutionReason:'text'})});
        await expect(service.scoreConversation(TENANT_ID,CONVERSATION_ID)).rejects.toThrow('invalid response');
    });

    it.each(['needs_customer_input', 'not_assessable'])('preserves an inconclusive resolution as null: %s', async resolutionStatus => {
        const { service, llmRouter, executeInTenantSchema } = buildHarness(AGENT_ID, 5);
        llmRouter.execute.mockResolvedValue({ content: JSON.stringify({ overall: 8, resolution: 8, tone: 8, accuracy: 8, empathy: 8,
            flags: [], resolved: null, resolutionStatus, resolutionReason: 'Se pidió precisar la consulta; faltan datos del cliente.' }) });
        await service.scoreConversation(TENANT_ID, CONVERSATION_ID);
        const insert = (executeInTenantSchema.mock.calls as any[][]).find(call => call[1].includes('INSERT INTO conversation_quality_scores'))!;
        expect(insert[2][17]).toBeNull();
        expect(insert[1]).toContain("'unknown'");
    });

    const insertOf = (executeInTenantSchema: jest.Mock) => (executeInTenantSchema.mock.calls as any[][])
        .find(call => String(call[1]).includes('INSERT INTO conversation_quality_scores'));
    const verdict = (overrides: Record<string, unknown>) => JSON.stringify({ overall: 8, resolution: 8, tone: 8, accuracy: 8, empathy: 8,
        flags: [], resolutionReason: 'Se pidió precisar la consulta.', ...overrides });

    it('asks the provider for JSON with the exact parameters the rubric hash names', async () => {
        const { service, llmRouter } = buildHarness(AGENT_ID, 5);
        await service.scoreConversation(TENANT_ID, CONVERSATION_ID);
        expect(llmRouter.execute).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 500, jsonMode: true,
        }));
    });

    // The rubric steers greeting-only conversations to needs_customer_input,
    // and a judge that also writes the old boolean `resolved:false` failed all
    // three attempts at temperature 0.2 and reached Sentry. Both fields say
    // "not resolved"; the status says why. The unknown reading is the only one
    // that does not invent a failure the judge did not claim.
    it.each([
        ['needs_customer_input', false], ['not_assessable', false], ['needs_customer_input', undefined],
    ])('keeps an inconclusive verdict unknown when the judge writes %s with resolved:%p', async (resolutionStatus, resolved) => {
        const { service, llmRouter, executeInTenantSchema, eventEmitter } = buildHarness(AGENT_ID, 5);
        llmRouter.execute.mockResolvedValue({ content: verdict({ resolutionStatus, resolved }), finishReason: 'stop' });
        await expect(service.scoreConversation(TENANT_ID, CONVERSATION_ID)).resolves.toMatchObject({ status: 'scored' });
        const insert = insertOf(executeInTenantSchema)!;
        expect(insert[2][17]).toBeNull();
        expect(insert[1]).toContain("'unknown'");
        expect(eventEmitter.emit).toHaveBeenCalledWith('quality.scored', expect.objectContaining({ status: 'scored' }));
    });

    it.each([
        [{ resolved: true, resolutionStatus: 'needs_customer_input' }],
        [{ resolved: true, resolutionStatus: 'unresolved' }],
        [{ resolved: false, resolutionStatus: 'resolved' }],
        [{ resolved: null, resolutionStatus: 'unresolved' }],
        [{ resolved: 'false', resolutionStatus: 'unresolved' }],
        [{ resolved: false, resolutionStatus: 'made_up' }],
        [{ resolved: null }],
    ])('rejects contradictory or invented resolutions rather than choosing a verdict: %p', async (fields) => {
        const { service, llmRouter, executeInTenantSchema, eventEmitter } = buildHarness(AGENT_ID, 5);
        llmRouter.execute.mockResolvedValue({ content: verdict(fields), finishReason: 'stop' });
        await expect(service.scoreConversation(TENANT_ID, CONVERSATION_ID)).rejects.toThrow('invalid response');
        expect(insertOf(executeInTenantSchema)).toBeUndefined();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it.each([
        ['a completion cut by maxTokens', { content: '{"overall": 8, "resolution": 7, "flags": ["Respondió con', finishReason: 'length',
            usage: { promptTokens: 4000, completionTokens: 500, totalTokens: 4500 } }, 'output_truncated', null],
        ['an empty completion', { content: '', finishReason: 'content_filter' }, 'content_filtered', null],
        ['prose instead of JSON', { content: 'Lo siento, no puedo evaluar esto.', finishReason: 'stop' }, 'not_json', null],
        ['a missing score', { content: verdict({ overall: undefined, resolved: true, resolutionStatus: 'resolved' }), finishReason: 'stop' }, 'invalid_score', 'overall'],
        ['an inconsistent resolution', { content: verdict({ resolved: true, resolutionStatus: 'needs_customer_input' }), finishReason: 'stop' }, 'resolution_inconsistent', 'resolved'],
        ['non-string flags', { content: verdict({ flags: [{ problema: 'x' }], resolved: true, resolutionStatus: 'resolved' }), finishReason: 'stop' }, 'invalid_flags', 'flags'],
    ])('names why %s was refused, without logging what the judge wrote', async (_label, response, reason, field) => {
        const { service, llmRouter, executeInTenantSchema } = buildHarness(AGENT_ID, 5);
        const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        // Stands in for anything the judge may quote back from the customer.
        const quoted = 'CUSTOMER-QUOTED-TEXT';
        const content = response.content.replace('Se pidió precisar la consulta.', quoted);
        llmRouter.execute.mockResolvedValue({ ...response, content });

        await expect(service.scoreConversation(TENANT_ID, CONVERSATION_ID)).rejects.toMatchObject({
            message: expect.stringContaining('QA judge returned an invalid response'), reason, field,
        });
        expect(insertOf(executeInTenantSchema)).toBeUndefined();
        const logged = warn.mock.calls.map(call => String(call[0])).join('\n');
        expect(logged).toContain('[QA] Failed to parse judge JSON');
        expect(logged).toContain(`reason=${reason}`);
        expect(logged).toContain(`finishReason=${response.finishReason}`);
        expect(logged).toContain(`contentLength=${content.length}`);
        expect(logged).toContain(`tenant=${TENANT_ID}`);
        expect(logged).not.toContain(quoted);
        expect(logged).not.toContain('Respondió con');
    });

    it('propagates queue outages instead of silently claiming QA was scheduled', async () => {
        const { service, queue } = buildHarness(AGENT_ID, 5);
        queue.add.mockRejectedValue(new Error('redis unavailable'));

        await expect(service.enqueue(TENANT_ID, CONVERSATION_ID)).rejects.toThrow('redis unavailable');
        expect(queue.add).toHaveBeenCalledWith(
            'score',
            { tenantId: TENANT_ID, conversationId: CONVERSATION_ID },
            expect.objectContaining({ attempts: 3, jobId: `q-${CONVERSATION_ID}` }),
        );
    });
});
