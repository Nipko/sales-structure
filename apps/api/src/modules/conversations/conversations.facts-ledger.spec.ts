import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { FACTS_LEDGER_FLAG } from '../throttle/feature-flags.service';
import { buildUnverifiedPriceReply } from './response-validator.service';

/**
 * Operations runtime PR3 through the real turn (Agent Test runtime session, two turns).
 *
 * F4300-22, restaurant, production 2026-10-22: turn 1 read get_menu and quoted the confirmed 13.500 COP; turn 2, without
 * reading again, said «el precio no está confirmado». With `agentRuntime.factsLedger` on, the price read in turn 1 is a
 * verified fact of the conversation: turn 2 sees it in <verified_facts> and the price guardrail lets it through. The flag
 * is read from the sealed snapshot: Agent Test turns never query the tenant for it.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MENU = { count: 1, items: [{ id: 'dish-paisa', name: 'Bandeja paisa', price: 13500, priceStatus: 'confirmed', currency: 'COP', allergens: [] }] };
const TURN1 = 'Hola, ¿cuánto cuesta la bandeja paisa?';
const TURN2 = '¿Y entonces cuánto me sale la bandeja paisa?';
const REPLY1 = 'La bandeja paisa cuesta 13.500 COP.';
const REPLY2 = 'Como le comenté, la bandeja paisa cuesta 13.500 COP.';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };

function fixture(flag: boolean) {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'restaurantes', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'restaurantes', subType: 'restaurante' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: flag ? { featureFlags: { [FACTS_LEDGER_FLAG]: true } } : {} });
    publishTools(f, ['get_menu']);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
        name === 'get_menu' ? MENU : { error: `unexpected tool ${name}` });
    let n = 0;
    // Turn 1: the model reads the menu, then answers. Turn 2: it answers from what it already knows, reading nothing.
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        const last = [...req.messages].reverse().find((m: any) => m.role === 'user')?.content;
        if (last === TURN1 && req.tools && !req.messages.some((m: any) => m.role === 'tool')) {
            return { ...usage, content: '', toolCalls: [{ id: `c${++n}`, type: 'function', function: { name: 'get_menu', arguments: '{}' } }] };
        }
        return { ...usage, content: last === TURN1 || req.messages.some((m: any) => m.role === 'tool') ? REPLY1 : REPLY2 };
    });
    let id: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id }, { agentSnapshot: undefined });
        id = result.debug.runtimeSessionId;
        return result;
    };
    const session = () => (f.service as any).sessions.sessions.get(id).session;
    const menuReads = () => f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[3] === 'get_menu').length;
    return { f, turn, session, menuReads };
}

afterEach(() => jest.restoreAllMocks());

describe('facts ledger through the turn', () => {
    it('flag on: turn 2 quotes the 13.500 read in turn 1 without reading again', async () => {
        const h = fixture(true);
        const first = await h.turn(TURN1);
        expect(first.debug.runtimeError).toBeUndefined();
        expect(first.reply).toBe(REPLY1);
        expect(h.menuReads()).toBe(1);
        expect(h.session().metadata.verifiedFacts).toEqual(expect.arrayContaining([expect.objectContaining({
            kind: 'money', subject: { type: 'menu_item', id: 'dish-paisa', name: 'Bandeja paisa' }, value: 13500, currency: 'COP', priceStatus: 'confirmed',
        })]));
        const tenantReads = h.f.prisma.tenant.findUnique.mock.calls.length;

        const second = await h.turn(TURN2);
        expect(second.debug.runtimeError).toBeUndefined();
        expect(h.menuReads()).toBe(1);
        expect(second.reply).toBe(REPLY2);
        expect(second.debug.systemPrompt).toContain('subject_id="dish-paisa" subject="Bandeja paisa" field="price" value="13500" currency="COP" price_status="confirmed" source="get_menu"');
        expect(second.debug.systemPrompt).toContain('22c. FACTS VS HISTORY');
        // The flag comes from the sealed snapshot: the second Agent Test turn makes no tenant query.
        expect(h.f.prisma.tenant.findUnique.mock.calls.length).toBe(tenantReads);
    });

    it('flag off: no ledger, no <verified_facts>, the contract unchanged — turn 2 is exactly the previous behaviour', async () => {
        const h = fixture(false);
        await h.turn(TURN1);
        expect(h.session().metadata.verifiedFacts).toBeUndefined();
        const second = await h.turn(TURN2);
        expect(h.menuReads()).toBe(1);
        expect(second.debug.systemPrompt).not.toContain('verified_facts');
        expect(second.debug.systemPrompt).not.toContain('22c.');
        expect(second.debug.systemPrompt).toContain('For a current price, read it from a catalogue result of THIS turn');
        // Without the ledger the amount of turn 1 is not authority in turn 2: the price guardrail fails closed, as before.
        expect(second.reply).toBe(buildUnverifiedPriceReply('<language>es</language>'));
    });
});
