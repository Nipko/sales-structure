import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { FaqsService } from '../faqs/faqs.service';
import { sealStructuredKnowledgeCapture } from '../evaluation-revision/evaluation-structured-knowledge';
import { ToolExecutionControlService } from './tool-execution-control.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { AUTOMATIC_FAQ_MAX_ANSWER_CHARS } from '../faqs/automatic-faq-context';

const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUESTION = 'Que incluye la demostración Faro Azul y cuánto dura la visita?';
const FAQ = { id: 'faq-faro', question: '¿Qué incluye la demostración Faro Azul?',
    answer: 'Faro Azul es una demostración de Parallly para una inmobiliaria de prueba en Bogotá. Incluye consultas simuladas sobre compra y arriendo y una visita virtual de prueba de 20 minutos. No hay inmuebles reales disponibles, no se cobra dinero y no se solicitan documentos personales. Si deseas ayuda, el correo de prueba es contacto@example.test.', category: 'demostracion' };

function fixture() {
    const f = agentTurnFixture();
    publishTools(f, ['search_faqs']);
    f.toolExecutor.execute.mockResolvedValue({ faqs: [FAQ] });
    return f;
}

describe('published FAQs enter the first model context automatically', () => {
    it('carries the real FAQ search fallback through the guarded executor into the first prompt', async () => {
        const f = fixture();
        const rows = [{ ...FAQ, is_published: true }, {
            id: 'seed', question: '¿Cómo agendo una visita a la propiedad?',
            answer: 'Te muestro propiedades disponibles y agendamos visita con el asesor.', is_published: true,
        }];
        f.revisions.captureStructuredKnowledge.mockImplementation(async () => sealStructuredKnowledgeCapture({
            version: 1, tenantId: 'tenant', sourceSchema: 'tenant_test', capturedAt: new Date().toISOString(),
            faqs: { state: 'present', rows }, policies: { state: 'present', rows: [] },
        }));
        const query = jest.fn(async (sql: string, _query: string, _limit: number, captured: string) => {
            expect(sql).toContain('jsonb_to_recordset($3::jsonb)');
            return sql.includes('plainto_tsquery') ? [] : JSON.parse(captured);
        });
        const liveSchema = jest.fn(() => { throw new Error('live FAQ schema lookup forbidden'); });
        const faqs = new FaqsService({ $queryRawUnsafe: query } as any, {} as any, { getSchemaName: liveSchema } as any);
        const executor = Object.assign(Object.create(AIToolExecutorService.prototype), {
            faqsService: faqs, paymentOperations: {}, logger: f.logger,
            toolExecutionControl: { preflight: jest.fn().mockResolvedValue({ allowed: true }), complete: jest.fn(), fail: jest.fn() },
        }) as AIToolExecutorService;
        f.toolExecutor.execute.mockImplementation(executor.execute.bind(executor));
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            expect(JSON.stringify(request)).toContain(FAQ.answer);
            expect(JSON.stringify(request)).not.toContain(rows[1].answer);
            return { content: 'La visita virtual de prueba dura 20 minutos.' };
        });
        const result = await f.service.test('tenant', AGENT_ID, { message: QUESTION });
        expect(result.reply).toBe('La visita virtual de prueba dura 20 minutos.');
        expect(result.debug.ragHits).toEqual([expect.objectContaining({ source: 'faq', id: FAQ.id, content: FAQ.answer })]);
        expect(query).toHaveBeenCalledTimes(2);
        expect(liveSchema).not.toHaveBeenCalled();
    });

    it('answers with a FAQ when no document knowledge exists and the model requests no tools', async () => {
        const f = fixture();
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            const prompt = JSON.stringify(request);
            expect(prompt).toContain('source=\\"faq\\"');
            expect(prompt).toContain(FAQ.answer);
            return { content: FAQ.answer };
        });
        const result = await f.service.test('tenant', AGENT_ID, { message: QUESTION });
        expect(result.reply).toBe(FAQ.answer);
        expect(f.toolExecutor.execute).toHaveBeenCalledTimes(1);
        expect(f.toolExecutor.execute).toHaveBeenCalledWith('tenant_test', 'tenant', expect.any(String),
            'search_faqs', { query: QUESTION, limit: 3 }, expect.any(String), expect.objectContaining({
                authority: expect.objectContaining({ allowedTools: ['search_faqs'] }),
                executionContext: expect.objectContaining({ mode: 'agent_test' }),
                structuredKnowledgeInputs: expect.objectContaining({ tenantId: 'tenant' }),
            }));
        expect(result.debug.toolCalls).toEqual([expect.objectContaining({ name: 'search_faqs', result: { faqs: [FAQ] } })]);
        expect(f.knowledgeService.searchRelevant).not.toHaveBeenCalled();
    });

    it('executes the live automatic lookup without DDL, view updates or a central ledger', async () => {
        const f = fixture();
        const tenantId = '11111111-1111-4111-8111-111111111111';
        const contactId = '22222222-2222-4222-8222-222222222222';
        const conversationId = '33333333-3333-4333-8333-333333333333';
        const long = { ...FAQ, id: 'oversized', answer: 'a'.repeat(AUTOMATIC_FAQ_MAX_ANSWER_CHARS + 1) };
        const query = jest.fn(async (sql: string) => {
            if (!sql.trimStart().startsWith('SELECT')) throw new Error('Unexpected FAQ write');
            return [FAQ, long].map(row => ({ ...row, is_published: true }));
        });
        const write = jest.fn(() => { throw new Error('Unexpected persistence'); });
        const prisma = { $queryRawUnsafe: query, $executeRawUnsafe: write, $transaction: write };
        const tenants = { getSchemaName: jest.fn().mockResolvedValue('tenant_test') };
        const faqs = new FaqsService(prisma as any, {} as any, tenants as any);
        const views = jest.spyOn(faqs, 'incrementViews');
        const control = Object.assign(Object.create(ToolExecutionControlService.prototype), { prisma });
        const preflight = jest.spyOn(control, 'preflight');
        const executor = Object.assign(Object.create(AIToolExecutorService.prototype), {
            faqsService: faqs, paymentOperations: {}, logger: f.logger, toolExecutionControl: control,
        }) as AIToolExecutorService;
        const options = { authority: authorityFor('search_faqs'), automaticFaqContext: true,
            executionContext: { mode: 'live', persistence: 'enabled' } as const };
        expect(await executor.execute('tenant_test', tenantId, contactId, 'search_faqs', { query: QUESTION }, conversationId, options))
            .toEqual({ faqs: [FAQ] });
        expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ readOnlyExecution: true }));
        expect(tenants.getSchemaName).toHaveBeenCalledWith(tenantId, expect.objectContaining({ mode: 'live', persistence: 'disabled' }));
        expect(query).toHaveBeenCalledTimes(1);
        expect(write).not.toHaveBeenCalled();
        expect(views).not.toHaveBeenCalled();
        expect(options.executionContext.persistence).toBe('enabled');

        // Explicit audited searches retain complete content; only automatic
        // context has a budget. No persisted FAQ has been altered.
        const explicit = await executor.execute('tenant_test', tenantId, contactId, 'search_faqs', { query: QUESTION }, conversationId,
            { authority: authorityFor('search_faqs'), executionContext: { mode: 'agent_test', persistence: 'disabled' } });
        expect(explicit.faqs).toHaveLength(2);
        expect(explicit.faqs[1].answer).toBe(long.answer);
    });

    it('keeps oversized full answers out of automatic model context and recorded tool results', async () => {
        const f = fixture();
        const oversized = { ...FAQ, id: 'large', answer: `${'a'.repeat(AUTOMATIC_FAQ_MAX_ANSWER_CHARS)} FINAL_CONDITION` };
        const executor = Object.assign(Object.create(AIToolExecutorService.prototype), {
            faqsService: { search: jest.fn().mockResolvedValue([oversized, FAQ]) }, paymentOperations: {}, logger: f.logger,
            toolExecutionControl: { preflight: jest.fn().mockResolvedValue({ allowed: true }), complete: jest.fn(), fail: jest.fn() },
        }) as AIToolExecutorService;
        f.toolExecutor.execute.mockImplementation(executor.execute.bind(executor));
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            expect(JSON.stringify(request)).toContain(FAQ.answer);
            expect(JSON.stringify(request)).not.toContain('FINAL_CONDITION');
            expect(JSON.stringify(request)).not.toContain(oversized.answer.slice(0, 100));
            return { content: FAQ.answer };
        });
        const result = await f.service.test('tenant', AGENT_ID, { message: QUESTION });
        expect(result.debug.ragHits).toEqual([expect.objectContaining({ source: 'faq', id: FAQ.id })]);
        expect(result.debug.toolCalls[0].result.faqs).toEqual([FAQ]);
    });

    it('merges FAQ and document results instead of overwriting either source', async () => {
        const f = fixture();
        f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
            language: 'es', industry: 'retail', tools: {}, rag: { enabled: true },
        } });
        f.knowledgeService.tenantHasKnowledge.mockResolvedValue(true);
        f.knowledgeService.searchRelevant.mockResolvedValue([{
            id: 'chunk', document_id: 'document', title: 'Manual', chunk_text: 'El manual se entrega al terminar.',
            score: 0.9, doc_version: 1,
        }]);
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            expect(JSON.stringify(request)).toContain(FAQ.answer);
            expect(JSON.stringify(request)).toContain('El manual se entrega al terminar.');
            return { content: FAQ.answer };
        });
        await f.service.test('tenant', AGENT_ID, { message: QUESTION });
    });

    it('never prefetches a FAQ tool absent from the published capability', async () => {
        const f = fixture();
        publishTools(f, []);
        await f.service.test('tenant', AGENT_ID, { message: QUESTION });
        expect(f.toolExecutor.execute).not.toHaveBeenCalled();
    });

    it('keeps tool denial content out of retrieved knowledge', async () => {
        const f = fixture();
        f.toolExecutor.execute.mockResolvedValue({ error: 'tool_not_authorised', faqs: [FAQ] });
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            expect(JSON.stringify(request)).not.toContain(FAQ.answer);
            return { content: 'Necesito confirmar esa información.' };
        });
        await f.service.test('tenant', AGENT_ID, { message: QUESTION });
    });

    it('does not prefetch when the evaluation explicitly disables tools', async () => {
        const f = fixture();
        await f.service.test('tenant', AGENT_ID, { message: QUESTION }, { disableTools: true });
        expect(f.toolExecutor.execute).not.toHaveBeenCalled();
    });

    it('propagates a source-authority refusal before the model instead of falling back to live FAQs', async () => {
        const f = fixture();
        f.toolExecutor.execute.mockRejectedValue(new LLMSourceAuthorityUnavailable());
        await expect(f.service.test('tenant', AGENT_ID, { message: QUESTION })).rejects.toThrow();
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
});
