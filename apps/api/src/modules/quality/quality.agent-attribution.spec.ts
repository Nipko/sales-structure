import { QualityService } from './quality.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';

describe('QualityService agent attribution', () => {
    function buildHarness(agentId: string | null, version: number | null) {
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, _params: any[] = []) => {
            if (sql.includes('FROM conversations WHERE id=')) {
                return [{
                    contact_id: '44444444-4444-4444-8444-444444444444', qa_revision: '2',
                    resolution_type: 'ai_resolved',
                    was_handed_off: false,
                    agent_persona_id: agentId,
                    agent_config_version: version,
                }];
            }
            if (sql.includes('COUNT(*)::int AS total_messages')) return [{total_messages:2,text_messages:2}];
            if (sql.includes('FROM agent_personas')) return [{version,config_json:{mission:'Answer questions'}}];
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
