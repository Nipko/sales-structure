import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { FACTS_LEDGER_FLAG } from '../throttle/feature-flags.service';

/**
 * F4300-36 through the real turn (Agent Test runtime session, agentRuntime.factsLedger on), reproducing production (restaurant
 * Telegram tenant, image 57da6e58, 25-oct 11:08 UTC): «¿cuánto cuesta el plato Spark? y si pido dos, cuánto sería?». The turn
 * read get_menu (13.500 COP) and the customer got «No tengo un precio verificado en la información disponible. Puedo ayudarle a
 * confirmarlo con el equipo.» instead of 13.500 and 2 × 13.500 = 27.000. Now the computed total goes out as written; an
 * invented total takes out only its sentence and the real price stays.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MENU = { count: 1, items: [{ id: 'dish-spark', name: 'Spark QA Plato', price: 13500, priceStatus: 'confirmed', currency: 'COP', allergens: [] }] };
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const TEMPLATE = /No tengo un precio verificado|I do not have a verified price|Não tenho um preço verificado|Je ne dispose pas d’un prix vérifié/;

function fixture() {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'restaurantes', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'restaurantes', subType: 'restaurante' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [FACTS_LEDGER_FLAG]: true } } });
    publishTools(f, ['get_menu']);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
        name === 'get_menu' ? MENU : { error: `unexpected tool ${name}` });
    return f;
}

/** One turn: the model reads the menu, then answers `reply` (and the same text again if asked to correct it). */
async function turn(question: string, reply: string) {
    const f = fixture();
    let n = 0;
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.tools && !req.messages.some((m: any) => m.role === 'tool')) {
            return { ...usage, content: '', toolCalls: [{ id: `c${++n}`, type: 'function', function: { name: 'get_menu', arguments: '{}' } }] };
        }
        return { ...usage, content: reply };
    });
    const result = await f.service.test('tenant', AGENT, { message: question, channelType: 'telegram' }, { agentSnapshot: undefined });
    expect(result.debug.runtimeError).toBeUndefined();
    expect(f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[3] === 'get_menu')).toHaveLength(1);
    return result;
}

const CASES: Array<[string, string, string, string]> = [
    ['es', '¿cuánto cuesta el plato Spark? y si pido dos, cuánto sería?',
        'El plato Spark cuesta 13.500 COP. Si pide dos, serían 27.000 COP en total.', 'serían 31.000 COP en total'],
    ['en', 'how much is the Spark dish? and if I order two, how much would it be?',
        'The Spark dish costs 13,500 COP. If you order two, it would be 27,000 COP in total.', 'it would be 31,000 COP in total'],
    ['pt', 'quanto custa o prato Spark? e se eu pedir dois, quanto seria?',
        'O prato Spark custa 13.500 COP. Se pedir dois, seriam 27.000 COP no total.', 'seriam 31.000 COP no total'],
    ['fr', 'combien coûte le plat Spark ? et si j’en commande deux, ça ferait combien ?',
        'Le plat Spark coûte 13 500 COP. Si vous en commandez deux, cela ferait 27 000 COP au total.', 'cela ferait 31 000 COP au total'],
];

afterEach(() => jest.restoreAllMocks());

describe('F4300-36 the production turn: a total computed from the price read', () => {
    it.each(CASES)('[%s] 13.500 and 2 × 13.500 = 27.000 reach the customer as written', async (_lang, question, reply) => {
        const result = await turn(question, reply);
        expect(result.reply).toBe(reply);
        expect(result.reply).not.toMatch(TEMPLATE);
    });

    it.each(CASES)('[%s] an invented total loses its sentence; the real 13.500 stays', async (_lang, question, reply, wrongTail) => {
        const wrong = reply.replace(/(?:serían|it would be|seriam|cela ferait) 27[.,\s]000 COP (?:en total|in total|no total|au total)/, wrongTail);
        expect(wrong).not.toBe(reply);
        const result = await turn(question, wrong);
        expect(result.reply).not.toMatch(/31[.,\s]000/);
        expect(result.reply).toMatch(/13[.,\s]500 COP/);
        expect(result.reply).not.toMatch(TEMPLATE);
    });

    it('an invented unit price with nothing verifiable left still gets the template', async () => {
        const result = await turn('¿cuánto cuesta el plato Spark?', 'El plato Spark cuesta 15.000 COP.');
        expect(result.reply).toMatch(TEMPLATE);
        expect(result.reply).not.toContain('15.000');
    });
});
