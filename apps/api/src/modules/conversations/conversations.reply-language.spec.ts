import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { randomUUID } from 'crypto';

/**
 * Production 2026-10-07 (store tenant, Telegram): «Qual é a política de reembolso?» was answered in Spanish after
 * a long Spanish conversation, while the appointments tenant answered Portuguese correctly. Service-level, with a
 * Spanish history and the refund/return policy path (handoff classifier) active.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fixture() {
    const f = agentTurnFixture();
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'retail', tools: {}, rag: { enabled: false }, llm: {},
        behavior: { handoffTriggers: ['refund', 'return', 'discount'] },
    } });
    publishTools(f, ['search_faqs']);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'search_faqs') return { results: [] };
        return { items: [] };
    });
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

const promptLanguage = (session: AgentTurnSession): string | undefined =>
    String(session.trace.systemPrompt).match(/<language>\s*([a-z]{2})\s*<\/language>/i)?.[1];

describe('a Portuguese question after a long Spanish conversation', () => {
    it('is answered under a Portuguese turn language, and the prompt tells the model so', async () => {
        const h = fixture();
        for (const text of ['hola', '¿tienen audífonos?', '¿cuánto cuesta el audífono Aurora?', 'gracias, ¿hacen envíos a Medellín?', 'perfecto, ¿cuánto demora el envío?']) {
            await h.turn(text);
        }
        h.session().metadata.detectedLanguage = 'es';
        const result = await h.turn('Qual é a política de reembolso?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(promptLanguage(h.session())).toBe('pt');
        expect(h.session().metadata.detectedLanguage).toBe('pt');
    });
});
