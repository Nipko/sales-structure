import { AIToolExecutorService } from './ai-tool-executor.service';
import { allergenClaimsIn, allergenHonestText, allergenItemsFrom, guardAllergenClaim } from './allergen-claim';
import { extractVerifiedFacts } from './runtime/facts-extractors';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { pinClock } from './__fixtures__/pinned-clock';

/**
 * F4300-26 (production QA 2026-10-23, restaurant whose only dish has `allergens: []`, `tags: []`). The agent told a
 * lactose-intolerant, a celiac and a nut-allergic customer that the dish was free of the allergen. An empty allergen
 * list is "not informed", never "free of".
 */
const SPARK = { id: '11111111-1111-4111-8111-111111111111', name: 'Spark QA Plato', price: 13500, currency: 'COP', tags: [], allergens: [] };
const menuResult = (items: any[]) => ({ count: items.length, items });

describe('F4300-26 data layer: get_menu says "not_informed" for an empty allergen list', () => {
    async function menu(rows: any[]) {
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        executor.restaurantsService = { searchMenu: jest.fn().mockResolvedValue(rows) };
        return executor.getMenu('tenant_synthetic', {});
    }
    it('an empty or NULL list is "not_informed", with the notice; a recorded list is what it is', async () => {
        const result = await menu([
            { ...SPARK, prep_time_minutes: 10 },
            { ...SPARK, id: 'b', name: 'Sin ficha', allergens: null, prep_time_minutes: 10 },
            { ...SPARK, id: 'c', name: 'Pan', allergens: ['gluten'], prep_time_minutes: 10 },
        ]);
        expect(result.items.map((i: any) => i.allergens)).toEqual(['not_informed', 'not_informed', ['gluten']]);
        expect(result.allergenInfoNotice).toMatch(/not registered/);
        expect(result.allergenInfoNotice).toMatch(/NOT "free of allergens"/);
    });
    it('no notice when every dish has recorded allergens', async () => {
        const result = await menu([{ ...SPARK, allergens: ['huevo'], prep_time_minutes: 10 }]);
        expect(result.items[0].allergens).toEqual(['huevo']);
        expect(result.allergenInfoNotice).toBeUndefined();
    });
    it('the "not informed" state reaches the verified facts, so a later turn reads it from context too', async () => {
        const result = await menu([{ ...SPARK, prep_time_minutes: 10 }]);
        const { facts } = extractVerifiedFacts([{ name: 'get_menu', result }], new Date('2026-10-23T12:00:00Z'));
        expect(facts.find(f => f.field === 'allergens')?.value).toBe('not_informed');
    });
});

describe('F4300-26 output check: a free-of / safe-for claim without data is replaced', () => {
    const fromTool = [menuResult([SPARK])];
    const fromNotInformed = [menuResult([{ ...SPARK, allergens: 'not_informed' }])];

    const PRODUCTION: Array<[string, string, readonly unknown[]]> = [
        ['es', 'El plato Spark no contiene lácteos según la información disponible.', fromTool],
        ['es', 'El plato Spark no contiene lácteos según la información disponible, por lo que podría ser adecuado para usted si es intolerante a la lactosa.', fromNotInformed],
        ['pt', 'The Spark dish is our only option, which is listed as a gluten-free option.', fromTool],
        ['es', "Tenemos una opción sin gluten llamada 'Spark QA Plato', ¿desea pedirla?", fromTool],
        ['en', 'Based on the menu, the Spark dish does not list nuts as an allergen. Would you like to proceed with this dish?', fromTool],
    ];
    it.each(PRODUCTION)('production regression (%s): «%s»', (lang, reply, sources) => {
        const result = guardAllergenClaim({ reply, sources, lang, canOfferPerson: true });
        expect(result.replaced).toBe(true);
        expect(result.situation).toBe('not_informed');
        expect(result.text).toBe(allergenHonestText('not_informed', lang, true));
    });

    it('the menu read in an earlier turn (verified facts in context, no tool this turn) does not back the claim either', () => {
        const views = [{ kind: 'attribute', subjectType: 'menu_item', subjectId: SPARK.id, subjectName: SPARK.name, field: 'allergens', value: 'not_informed', source: 'get_menu', ageMinutes: 3 }];
        expect(guardAllergenClaim({ reply: 'El plato Spark no contiene lácteos.', sources: [views], lang: 'es', canOfferPerson: false }).replaced).toBe(true);
        expect(guardAllergenClaim({ reply: 'El plato Spark no contiene lácteos.', sources: [], lang: 'es', canOfferPerson: false }).replaced).toBe(true);
    });

    it.each([
        'The Spark dish is dairy-free.', 'Es apto para celíacos.', 'O prato Spark é sem glúten e sem lactose.', 'O prato não contém glúten.',
        'Le plat Spark est sans gluten.', 'Le plat ne contient pas de lactose.', 'It contains no peanuts.', 'Spark is nut free.',
        'El Spark no lleva ningún tipo de mariscos.', 'Es seguro para personas con alergia al maní.', 'Libre de gluten y de lácteos.',
        "It doesn't contain eggs.", 'The Spark dish is safe for people with a nut allergy.',
    ])('the claim family is recognised: «%s»', reply => {
        expect(allergenClaimsIn(reply).length).toBeGreaterThan(0);
        expect(guardAllergenClaim({ reply, sources: fromTool, lang: 'es', canOfferPerson: false }).replaced).toBe(true);
    });

    it('a tagged item that records the allergen is never called free of it', () => {
        const sources = [menuResult([{ ...SPARK, allergens: ['Gluten'], tags: ['gluten_free'] }])];
        const result = guardAllergenClaim({ reply: 'El plato Spark es sin gluten.', sources, lang: 'es', canOfferPerson: false });
        expect(result).toMatchObject({ replaced: true, situation: 'contains' });
        expect(result.text).toBe(allergenHonestText('contains', 'es', false));
    });

    it('a recorded list that lacks the allergen, with no explicit tag, does not back «sin gluten» either', () => {
        const sources = [menuResult([{ ...SPARK, allergens: ['huevo'], tags: [] }])];
        expect(guardAllergenClaim({ reply: 'El plato Spark no contiene gluten.', sources, lang: 'es', canOfferPerson: false }).replaced).toBe(true);
    });

    it('the replacement is localized, usted in Spanish, and offers a person only when one can be reached', () => {
        expect(allergenHonestText('not_informed', 'es', true)).toMatch(/no ha registrado información de alérgenos.*confírmelo directamente con el negocio antes de consumirlo.*¿Quiere que le pida/);
        expect(allergenHonestText('not_informed', 'en', false)).toBe('The business has not registered allergen information for that dish or product, so I cannot confirm whether it is safe for you. Please confirm it directly with the business before consuming it.');
        expect(allergenHonestText('not_informed', 'pt', false)).toMatch(/não registrou informações sobre alérgenos/);
        expect(allergenHonestText('not_informed', 'fr', false)).toMatch(/n’a pas enregistré d’informations sur les allergènes/);
    });
});

describe('F4300-26 output check: what must pass untouched', () => {
    const fromTool = [menuResult([SPARK])];
    it.each([
        'El negocio no ha registrado información de alérgenos para el plato Spark, así que le recomiendo confirmarlo directamente con el negocio.',
        'No tenemos información sobre si el plato Spark es libre de gluten; por favor confírmelo con el negocio.',
        'The Spark dish has no allergen information on file, so I cannot confirm whether it is gluten-free.',
        'O prato Spark não tem alérgenos registrados, então não posso confirmar se é sem glúten.',
        'Le plat Spark n’a pas d’informations sur les allergènes enregistrées.',
        'El plato Spark no tiene alérgenos registrados.',
        '¿Busca opciones sin gluten? Le cuento lo que tenemos.',
        'Si no tiene alergias, el plato Spark es una gran opción.',
    ])('an honest reply about the missing information: «%s»', reply => {
        expect(guardAllergenClaim({ reply, sources: fromTool, lang: 'es', canOfferPerson: true })).toEqual({ text: reply, replaced: false });
    });

    it('an item whose allergen list lacks gluten and that carries an explicit gluten_free tag', () => {
        const sources = [menuResult([{ ...SPARK, allergens: ['huevo'], tags: ['gluten_free'] }, { ...SPARK, id: 'x', name: 'Pan de la casa', allergens: ['gluten'], tags: [] }])];
        for (const reply of ['El plato Spark es sin gluten.', 'Sí, tenemos una opción sin gluten: el Spark QA Plato.', 'The Spark dish is gluten-free.', 'Tenemos opciones sin gluten.']) {
            expect(guardAllergenClaim({ reply, sources, lang: 'es', canOfferPerson: false }).replaced).toBe(false);
        }
        // The other dish is named: it does not back the claim.
        expect(guardAllergenClaim({ reply: 'El Pan de la casa es sin gluten.', sources, lang: 'es', canOfferPerson: false }).situation).toBe('contains');
    });

    it.each([
        'El envío es sin costo de envío para pedidos de más de 50.000 COP.',
        'Perfecto, anoto el plato Spark sin cebolla.',
        'Free shipping on orders over 50 USD, without any extra fee.',
        'Claro, le preparo el Spark sin sal y sin cebolla.',
    ])('unrelated «sin»: «%s»', reply => {
        expect(guardAllergenClaim({ reply, sources: fromTool, lang: 'es', canOfferPerson: true }).replaced).toBe(false);
    });

    it('reads items from tool messages (JSON text) as well as from results', () => {
        const items = allergenItemsFrom([JSON.stringify(menuResult([{ ...SPARK, allergens: ['maní'], tags: ['sin gluten'] }]))]);
        expect(items).toEqual([{ name: 'Spark QA Plato', allergens: ['maní'], labels: ['sin gluten'] }]);
    });
});

pinClock();
describe('F4300-26 through ConversationsService: the model reads the menu and claims the dish is free of the allergen', () => {
    const answer = (content: string, toolCalls?: any[]) => ({ content, ...(toolCalls ? { toolCalls } : {}), model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
    function restaurant(language: 'es' | 'en', reply: string, dish: any = { ...SPARK, allergens: 'not_informed' }) {
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 5, config_json: { language, industry: 'restaurantes', rag: { enabled: false }, llm: {} } });
        publishTools(f, ['get_menu', 'place_order', 'search_faqs']);
        f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => (name === 'search_faqs' ? { faqs: [] } : menuResult([dish])));
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
            const read = (request.messages ?? []).some((m: any) => m?.role === 'tool' && String(m.content).includes('Spark QA Plato'));
            if ((request.tools?.length ?? 0) > 0 && !read) return answer('', [{ id: 'call-menu', function: { name: 'get_menu', arguments: '{}' } }]);
            return answer(reply);
        });
        return (message: string) => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram' }, { agentSnapshot: undefined });
    }

    it('«el plato Spark tiene lácteos?» → «no contiene lácteos según la información disponible» is replaced', async () => {
        const r = await restaurant('es', 'El plato Spark no contiene lácteos según la información disponible.')('el plato Spark tiene lácteos?');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).not.toMatch(/no contiene lácteos/);
        expect(r.reply).toContain('El negocio no ha registrado información de alérgenos para ese plato o producto');
    });

    it("«does the Spark dish contain nuts? I'm allergic» → «does not list nuts as an allergen» is replaced", async () => {
        const r = await restaurant('en', 'The Spark dish does not list nuts as an allergen. Would you like to proceed with this dish?')("does the Spark dish contain nuts? I'm allergic");
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).not.toMatch(/does not list nuts/);
        expect(r.reply).toContain('The business has not registered allergen information');
    });

    it('a dish tagged gluten_free whose allergens lack gluten: «sin gluten» stands', async () => {
        const reply = 'Sí, el plato Spark es sin gluten.';
        const r = await restaurant('es', reply, { ...SPARK, allergens: ['huevo'], tags: ['gluten_free'] })('el plato Spark es sin gluten?');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).toContain('sin gluten');
        expect(r.reply).not.toContain('no ha registrado información de alérgenos');
    });
});
