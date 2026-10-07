import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { randomUUID } from 'crypto';

/**
 * Service-level replays of the production regression 2026-10-07 (store tenant, Telegram):
 *  - a product price shown as «119,900 COP» instead of «119.900»;
 *  - a Portuguese refund question answered in Spanish after a long Spanish conversation.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT = { id: 'p1', name: 'Audífono QA Aurora', price: '119900', currency: 'COP', stock: 3, mentioned: true, total: '1' };
const answer = (content: string) => ({ content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });

function fixture() {
    const f = agentTurnFixture();
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'retail', tools: { catalog: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    publishTools(f, ['search_faqs']);
    f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => /FROM\s+products/i.test(sql) ? [PRODUCT] : []);
    f.toolExecutor.execute.mockImplementation(async () => ({ results: [] }));
    let id: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id }, {
            evalMode: true, sandboxContactId: '00000000-0000-4000-8000-00000000eba1', sandboxConversationId: conversationId,
            sandboxNamespace: namespace, sandboxInboundMessageId: randomUUID(),
        });
        id = result.debug.runtimeSessionId;
        return result;
    };
    const session = (): AgentTurnSession => (f.service as any).sessions.sessions.get(id).session;
    return { f, turn, session };
}

describe('a product price keeps the grouping of the reply language', () => {
    it.each([
        ['El Audífono QA Aurora cuesta 119,900 COP.', '119.900 COP'],
        ['El Audífono QA Aurora cuesta $119,900 COP.', '$119.900 COP'],
        ['El Audífono QA Aurora cuesta 119900 COP.', '119.900 COP'],
    ])('«%s» reaches the customer as %s and the figure is still authorised by the catalog', async (modelText, shown) => {
        const h = fixture();
        h.f.llmRouter.execute.mockResolvedValue(answer(modelText));
        const result = await h.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toContain(shown);
        expect(result.reply).not.toContain('119,900');
    });

    it('a figure that is not in the catalog is still blocked, whatever its grouping', async () => {
        const h = fixture();
        h.f.llmRouter.execute.mockResolvedValue(answer('El Audífono QA Aurora cuesta 99,900 COP.'));
        const result = await h.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        expect(result.reply).not.toMatch(/99[.,]900/);
    });
});

describe('a Portuguese question after a long Spanish conversation', () => {
    const SPANISH_REPLY = 'Nuestra política de reembolso permite devolver el producto dentro de los treinta días siguientes a la compra, con el empaque original y la factura.';
    const PORTUGUESE_REPLY = 'Nossa política de reembolso permite devolver o produto em até trinta dias após a compra, com a embalagem original e a nota fiscal.';

    it('is answered in Portuguese even when the model drifts back to Spanish', async () => {
        const h = fixture();
        for (const text of ['hola', '¿tienen audífonos?', '¿cuánto demora el envío a Medellín?']) await h.turn(text);
        h.session().metadata.detectedLanguage = 'es';
        h.f.llmRouter.execute.mockClear();
        h.f.llmRouter.execute.mockResolvedValueOnce(answer(SPANISH_REPLY)).mockResolvedValueOnce(answer(PORTUGUESE_REPLY));
        const result = await h.turn('Qual é a política de reembolso?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toContain('Nossa política de reembolso');
        expect(result.reply).not.toContain('Nuestra política');
        const prompts = h.f.llmRouter.execute.mock.calls.map((call: any[]) => String(call[0].systemPrompt ?? ''));
        expect(prompts[0]).toMatch(/<language>pt<\/language>/);
    });

    it('leaves a reply that is already Portuguese alone (no second model call)', async () => {
        const h = fixture();
        await h.turn('hola');
        h.session().metadata.detectedLanguage = 'es';
        h.f.llmRouter.execute.mockClear();
        h.f.llmRouter.execute.mockResolvedValue(answer(PORTUGUESE_REPLY));
        const result = await h.turn('Qual é a política de reembolso?');
        expect(result.reply).toContain('Nossa política');
        expect(h.f.llmRouter.execute).toHaveBeenCalledTimes(1);
    });
});
