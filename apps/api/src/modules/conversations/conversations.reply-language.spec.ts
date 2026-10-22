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

/**
 * Production 2026-10-22 (hotel / dental / store bots, Telegram): after an English or Portuguese case the customer
 * wrote a plain Spanish (or Portuguese) message and was answered in the PREVIOUS language. The turn language came from
 * the detector, which kept the stored one; the reply guardrail then "aligned" to that stale language too.
 */
describe('the turn language follows a switch in the current message', () => {
    const ENGLISH_REPLY = 'Our standard rooms include breakfast for two guests and you can check the rates with the front desk team.';
    const SPANISH_REPLY = 'Nuestras habitaciones estándar incluyen desayuno para dos huéspedes y puedes consultar las tarifas con recepción.';
    const PORTUGUESE_REPLY = 'Sim, temos estacionamento gratuito para hóspedes, com vagas cobertas e segurança durante a noite toda.';

    function withModel(reply: string) {
        const h = fixture();
        h.f.llmRouter.execute.mockImplementation(async (req: any) => {
            const last = String(req.messages?.[req.messages.length - 1]?.content ?? '');
            const content = /Reescríbela en español/.test(last) ? SPANISH_REPLY : /Reescreva-a em português/.test(last) ? PORTUGUESE_REPLY : reply;
            return { content, model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
        });
        return h;
    }
    const rewriteInstructions = (h: ReturnType<typeof fixture>): string[] => h.f.llmRouter.execute.mock.calls
        .map((call: any[]) => String(call[0]?.messages?.[call[0].messages.length - 1]?.content ?? ''))
        .filter((text: string) => /no está en español|não está em português|is not in English|n.est pas en français/.test(text));

    it.each([
        ['en', 'a cuánto la noche en su hotel?', 'es'],
        ['en', 'me sangra mucho la encía, qué hago?', 'es'],
        ['pt', 'dime el total de pedidos que tengo registrados', 'es'],
    ])('stored %s, «%s» → turn language %s, and an English reply is aligned to it', async (stored, text, expected) => {
        const h = withModel(ENGLISH_REPLY);
        await h.turn('hello');
        h.session().metadata.detectedLanguage = stored;
        h.f.llmRouter.execute.mockClear();
        const result = await h.turn(text);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(promptLanguage(h.session())).toBe(expected);
        expect(h.session().metadata.detectedLanguage).toBe(expected);
        // Guardrail 0 aligned to the CURRENT turn language, never to the stored one.
        expect(rewriteInstructions(h)).toEqual([expect.stringMatching(/Reescríbela en español/)]);
    });

    it('stored en, «e tem estacionamento?» → Portuguese turn language and alignment', async () => {
        const h = withModel(ENGLISH_REPLY);
        await h.turn('Hi, how much is a night in your hotel?');
        expect(h.session().metadata.detectedLanguage).toBe('en');
        h.f.llmRouter.execute.mockClear();
        await h.turn('e tem estacionamento?');
        expect(promptLanguage(h.session())).toBe('pt');
        expect(h.session().metadata.detectedLanguage).toBe('pt');
        expect(rewriteInstructions(h)).toEqual([expect.stringMatching(/Reescreva-a em português/)]);
    });

    it('a short ambiguous «ok» keeps the switched language and does not trigger a rewrite of a Spanish reply', async () => {
        const h = withModel(SPANISH_REPLY);
        await h.turn('Hi, how much is a night in your hotel?');
        await h.turn('a cuánto la noche en su hotel?');
        expect(h.session().metadata.detectedLanguage).toBe('es');
        h.f.llmRouter.execute.mockClear();
        await h.turn('ok');
        expect(promptLanguage(h.session())).toBe('es');
        expect(rewriteInstructions(h)).toEqual([]);
    });
});
