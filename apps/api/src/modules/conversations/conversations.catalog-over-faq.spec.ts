import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { CATALOG_OVER_FAQ_FLAG } from '../throttle/feature-flags.service';

/**
 * F4300-24 through the real turn (Agent Test runtime session).
 *
 * Dental tenant, production QA: the catalogue (`list_services`) has «Consulta general», «Consulta especializada» and
 * «Control y seguimiento»; a seeded business-type FAQ says how long an orthodontic treatment lasts. Asked «¿tienen
 * tratamiento de ortodoncia?», the agent read the FAQ and answered «Sí, ofrecemos tratamiento de ortodoncia» (3 cases).
 * With `agentRuntime.catalogOverFaq` on, the catalogue decides: the FAQ reaches the model marked not_in_catalogue, the
 * contract carries rule 20b, and the «sí, ofrecemos» reply is replaced by the not-offered answer listing the catalogue.
 * The flag comes from the sealed snapshot: Agent Test turns never query the tenant for it.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICES = { services: [
    { id: 'svc-general', name: 'Consulta general', durationMinutes: 30 },
    { id: 'svc-especializada', name: 'Consulta especializada', durationMinutes: 45 },
    { id: 'svc-control', name: 'Control y seguimiento', durationMinutes: 30 },
] };
const ORTHO_FAQ = { id: 'faq-ortho', question: '¿Cuánto tiempo dura un tratamiento de ortodoncia?',
    answer: 'Depende de tu caso, pero generalmente entre 12 y 24 meses.', category: 'tratamientos' };
const CONTROL_FAQ = { id: 'faq-control', question: '¿Qué incluye el servicio de control y seguimiento?',
    answer: 'Una revisión del avance de tu tratamiento y ajustes si hacen falta.', category: 'servicios' };
const ORTHO_Q = '¿Tienen tratamiento de ortodoncia?';
const ORTHO_REPLY = 'Sí, ofrecemos tratamiento de ortodoncia. Generalmente dura entre 12 y 24 meses, según tu caso.';
const CONTROL_Q = '¿Qué incluye el control y seguimiento?';
const CONTROL_REPLY = 'El control y seguimiento incluye una revisión del avance de tu tratamiento y ajustes si hacen falta.';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };

function fixture(flag: boolean, faq: typeof ORTHO_FAQ, reply: string, explicitFaqCall = false) {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'salud', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'salud', subType: 'odontologia' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: flag ? { featureFlags: { [CATALOG_OVER_FAQ_FLAG]: true } } : {} });
    publishTools(f, ['list_services', 'search_faqs']);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
        name === 'list_services' ? SERVICES : name === 'search_faqs' ? { faqs: [faq] } : { error: `unexpected tool ${name}` });
    const toolMessages: string[] = [];
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        for (const m of req.messages) if (m.role === 'tool') toolMessages.push(String(m.content));
        if (explicitFaqCall && req.tools && !req.messages.some((m: any) => m.role === 'tool')) {
            return { ...usage, content: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'search_faqs', arguments: JSON.stringify({ query: 'ortodoncia' }) } }] };
        }
        return { ...usage, content: reply };
    });
    let id: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id }, { agentSnapshot: undefined });
        id = result.debug.runtimeSessionId;
        return result;
    };
    const session = () => (f.service as any).sessions.sessions.get(id).session;
    const reads = (name: string) => f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[3] === name).length;
    return { f, turn, session, reads, toolMessages };
}

afterEach(() => jest.restoreAllMocks());

describe('catalogue over FAQ through the turn', () => {
    it('flag on: «¿tienen tratamiento de ortodoncia?» answers that it is not among the services and lists the real ones', async () => {
        const h = fixture(true, ORTHO_FAQ, ORTHO_REPLY, true);
        const result = await h.turn(ORTHO_Q);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toContain('No veo tratamiento de ortodoncia entre nuestros servicios');
        expect(result.reply).toContain('Consulta general, Consulta especializada y Control y seguimiento');
        expect(result.reply).not.toMatch(/s[ií], ofrecemos/i);
        expect(result.reply).not.toContain('12 y 24 meses');
        expect(h.reads('list_services')).toBe(1);
        const prompt: string = result.debug.systemPrompt;
        expect(prompt).toContain('20b. THE CATALOGUE DECIDES WHAT IS OFFERED');
        expect(prompt).toContain('<catalogue_authority kind="services">');
        expect(prompt).toContain('<offered>Consulta especializada</offered>');
        expect(prompt).toContain('<not_in_catalogue>tratamiento de ortodoncia</not_in_catalogue>');
        expect(prompt).toContain('not_in_catalogue="tratamiento de ortodoncia"');
        // The model's own search_faqs call reaches it marked too.
        expect(h.toolMessages.some(content => content.includes('"not_in_catalogue":["tratamiento de ortodoncia"]'))).toBe(true);
        expect(h.session().trace.steps).toEqual(expect.arrayContaining([expect.objectContaining({ signal: 'catalog_over_faq_reply_replaced' })]));
    });

    it('flag on: a FAQ about a service that IS in the catalogue still answers as before', async () => {
        const h = fixture(true, CONTROL_FAQ, CONTROL_REPLY);
        const result = await h.turn(CONTROL_Q);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe(CONTROL_REPLY);
        const prompt: string = result.debug.systemPrompt;
        expect(prompt).toContain('<offered>Control y seguimiento</offered>');
        expect(prompt).not.toContain('<not_in_catalogue>');
        expect(prompt).not.toContain('not_in_catalogue="');
    });

    it('flag off: the baseline — the FAQ answer passes, no rule, no catalogue block, no annotation, no extra read', async () => {
        const h = fixture(false, ORTHO_FAQ, ORTHO_REPLY, true);
        const result = await h.turn(ORTHO_Q);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe(ORTHO_REPLY);
        const prompt: string = result.debug.systemPrompt;
        expect(prompt).not.toContain('20b.');
        expect(prompt).not.toContain('catalogue_authority');
        expect(prompt).not.toContain('not_in_catalogue');
        expect(h.toolMessages.some(content => content.includes('not_in_catalogue'))).toBe(false);
        expect(h.session().snapshot.contextInputs).not.toHaveProperty('catalogOverFaq');
        expect(h.reads('list_services')).toBe(0);
        expect(h.session().trace.steps).not.toEqual(expect.arrayContaining([expect.objectContaining({ signal: 'catalog_over_faq_reply_replaced' })]));
    });

    it('Agent Test reads the flag from the sealed snapshot: later turns make no tenant query for it', async () => {
        const h = fixture(true, ORTHO_FAQ, ORTHO_REPLY);
        await h.turn(ORTHO_Q);
        expect(h.session().snapshot.contextInputs.catalogOverFaq).toBe(true);
        const tenantReads = h.f.prisma.tenant.findUnique.mock.calls.length;
        // The tenant turns the flag off after the capture: the session keeps the sealed value.
        h.f.prisma.tenant.findUnique.mockResolvedValue({ settings: {} });
        const second = await h.turn(ORTHO_Q);
        expect(second.reply).toContain('No veo tratamiento de ortodoncia entre nuestros servicios');
        expect(h.f.prisma.tenant.findUnique.mock.calls.length).toBe(tenantReads);
    });
});
