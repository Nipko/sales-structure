import { attachDescriptionAuthority, DESCRIPTION_AUTHORITY_NOTE, guardDescriptionStatusClaim } from './description-authority';
import { PromptAssemblerService } from './prompt-assembler.service';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { pinClock } from './__fixtures__/pinned-clock';

/**
 * F4300-35 follow-up: production after #215 (386361f4), Telegram QA tenants whose catalogue descriptions say the item is a
 * synthetic QA / test item «no vender»:
 *  1. pt «quais são os ingredientes do prato Spark?» was sent as «Também não há informações sobre alergênicos, então é importante
 *     confirmar… Posso ajudar com mais alguma coisa?»: the guard took the WHOLE first sentence, which also carried the answer
 *     («não há informações sobre os ingredientes»), and «Também» was left hanging. es: «No se ha registrado información sobre
 *     sus ingredientes…» («sus» pointing at nothing);
 *  2. en hotel «The Spark QA Habitacion room is a synthetic room for QA purposes, not for commercial use.» was not caught;
 *  3. en store «tell me about the Audífono QA Aurora» → «…2 units available. It is a fictional test product and does not
 *     correspond to real inventory.» (only search_faqs ran: see conversations.required-reads-tell-about-cues.spec.ts).
 * Only the clauses that make the claim go; the claims «not for commercial use», «not a real offer», «not real inventory»,
 * «synthetic / fictional / test item» are caught in es/en/pt/fr; what the structured data says still stands.
 */
const DISH = { id: '11111111-1111-4111-8111-111111111111', name: 'Spark QA Plato', description: 'Plato sintético de QA para pruebas del agente. No vender.',
    price: 13500, priceStatus: 'confirmed', currency: 'COP', category: 'Principales', tags: [], allergens: 'not_informed', ingredients: [] };
const ROOM = { id: '22222222-2222-4222-8222-222222222222', name: 'Spark QA Habitacion', description: 'Habitación sintética para pruebas, no comercializable.',
    nightPrice: 180000, priceStatus: 'confirmed', currency: 'COP', checkInTime: '15:00', checkOutTime: '11:00', maxGuests: 2 };
const PRODUCT = { id: '33333333-3333-4333-8333-333333333333', name: 'Audífono QA Aurora', description: 'Producto ficticio de prueba. No corresponde a inventario real.',
    price: 119900, currency: 'COP', stock: 2, isAvailable: true, inStock: true };
const menu = { count: 1, items: [DISH] };

describe('1. only the clause that makes the claim goes: the answer in the same sentence stays', () => {
    it('pt (production): the ingredients answer stays, «Também» keeps its antecedent', () => {
        const reply = 'Não há informações sobre os ingredientes do prato Spark, que é um item sintético de teste e não está disponível para venda. '
            + 'Também não há informações sobre alergênicos, então é importante confirmar com o restaurante. Posso ajudar com mais alguma coisa?';
        const out = guardDescriptionStatusClaim({ reply, sources: [menu], lang: 'pt' });
        expect(out).toMatchObject({ changed: true, action: 'removed', items: ['Spark QA Plato'] });
        expect(out.text).toBe('Não há informações sobre os ingredientes do prato Spark. '
            + 'Também não há informações sobre alergênicos, então é importante confirmar com o restaurante. Posso ajudar com mais alguma coisa?');
    });

    it('pt: a first sentence that is all claim goes, and the «Também» it left hanging goes with it', () => {
        const reply = 'O prato Spark é um item sintético de teste e não está à venda. Também não há informações sobre alergênicos. Posso ajudar com mais alguma coisa?';
        const out = guardDescriptionStatusClaim({ reply, sources: [menu], lang: 'pt' });
        expect(out.text).toBe('Não há informações sobre alergênicos. Posso ajudar com mais alguma coisa?');
    });

    it('es (production): «sus ingredientes» gets its antecedent back when the removed sentence was the only one naming the dish', () => {
        const reply = 'El Spark QA Plato es un plato sintético de QA y no está a la venta. No se ha registrado información sobre sus ingredientes. ¿Te ayudo con algo más?';
        const out = guardDescriptionStatusClaim({ reply, sources: [menu], lang: 'es' });
        // F4300-35c: named inside that sentence, no «Según el catálogo … está disponible» in front.
        expect(out.text).toBe('En cuanto a Spark QA Plato, no se ha registrado información sobre sus ingredientes. ¿Te ayudo con algo más?');
        expect(out.text).not.toMatch(/sintético|venta/);
    });

    it.each([
        ['es', 'El Spark QA Plato lleva pollo, arroz y verduras, pero no está a la venta.', 'El Spark QA Plato lleva pollo, arroz y verduras.'],
        ['es', 'El Spark QA Plato, que es un plato de pruebas, cuesta 13.500 COP.', 'El Spark QA Plato, cuesta 13.500 COP.'],
        ['en', 'The Spark QA Plato has chicken and rice, but it is a test dish and cannot be ordered.', 'The Spark QA Plato has chicken and rice.'],
        ['fr', 'Le Spark QA Plato contient du poulet, mais c’est un plat fictif de test qui n’est pas en vente.', 'Le Spark QA Plato contient du poulet.'],
        ['es', 'Tampoco hay información de alérgenos.', null],
    ])('%s «%s»', (lang, reply, expected) => {
        const out = guardDescriptionStatusClaim({ reply, sources: [menu], lang });
        if (expected === null) expect(out.changed).toBe(false);
        else expect(out.text).toBe(expected);
    });

    it('es: «Tampoco» after a removed sentence becomes «No»', () => {
        const out = guardDescriptionStatusClaim({ reply: 'El Spark QA Plato es un plato ficticio y no se vende. Tampoco hay información de alérgenos.', sources: [menu], lang: 'es' });
        expect(out.text).toBe('No hay información de alérgenos.');
    });
});

describe('2. «not for commercial use», «not a real offer», «not real inventory», «synthetic / fictional / test item» are the same claim', () => {
    it('en hotel (production): the sentence goes, price and check-in stay', () => {
        const reply = 'The Spark QA Habitacion room is a synthetic room for QA purposes, not for commercial use. It costs 180,000 COP per night and check-in is at 15:00.';
        const out = guardDescriptionStatusClaim({ reply, sources: [ROOM], lang: 'en' });
        expect(out).toMatchObject({ changed: true, action: 'removed', items: ['Spark QA Habitacion'] });
        expect(out.text).toBe('Spark QA Habitacion costs 180,000 COP per night and check-in is at 15:00.');
    });

    it.each([
        ['en', 'The Spark QA Habitacion costs 180,000 COP per night. It is not a real offer and is meant for testing only.'],
        ['en', 'The Spark QA Habitacion costs 180,000 COP per night. Note: it is not for commercial use.'],
        ['es', 'La Spark QA Habitacion cuesta 180.000 COP por noche. No es una oferta comercial y no permite reservas reales.'],
        ['es', 'La Spark QA Habitacion cuesta 180.000 COP por noche. Es una habitación de prueba que no corresponde a inventario real.'],
        ['pt', 'A Spark QA Habitacion custa 180.000 COP por noite. É um quarto sintético para testes e não é uma oferta comercial.'],
        ['fr', 'La Spark QA Habitacion coûte 180 000 COP par nuit. C’est un produit fictif de test qui ne correspond pas à un inventaire réel.'],
    ])('%s: «%s» → the claim goes, the price stays', (lang, reply) => {
        const out = guardDescriptionStatusClaim({ reply, sources: [ROOM], lang });
        expect(out).toMatchObject({ changed: true, action: 'removed' });
        expect(out.text).toMatch(/^(La|The|A) Spark QA Habitacion (costs|cuesta|custa|coûte) 180[.,\s]000 COP (per night|por noche|por noite|par nuit)\.$/);
    });

    it('en store (production wording): «It is a fictional test product and does not correspond to real inventory.» after a product read', () => {
        const reply = 'The Audífono QA Aurora costs 119,900 COP and there are 2 units available. It is a fictional test product and does not correspond to real inventory.';
        const out = guardDescriptionStatusClaim({ reply, sources: [{ products: [PRODUCT] }], lang: 'en' });
        expect(out.text).toBe('The Audífono QA Aurora costs 119,900 COP and there are 2 units available.');
    });

    it('a trial offer is a product, not a claim: «clase de prueba», «aula de teste», «séance de test»', () => {
        const course = { courses: [{ name: 'Inglés A1', description: 'Curso de inglés básico. Incluye clase de prueba gratuita.', isActive: true }] };
        for (const [reply, lang] of [
            ['El curso Inglés A1 tiene una clase de prueba gratuita de 30 minutos.', 'es'],
            ['O curso Inglés A1 tem uma aula de teste gratuita.', 'pt'],
            ['Le cours Inglés A1 propose une séance de test gratuite.', 'fr'],
        ] as const) {
            expect(guardDescriptionStatusClaim({ reply, sources: [course], lang }).changed).toBe(false);
        }
    });

    it('a name with «QA» or «Test» in it is a name, not a claim', () => {
        const qaName = { products: [{ ...PRODUCT, name: 'Test Kit Aurora', description: 'Kit de audio.' }] };
        expect(guardDescriptionStatusClaim({ reply: 'El Test Kit Aurora cuesta 119.900 COP.', sources: [qaName] }).changed).toBe(false);
        expect(guardDescriptionStatusClaim({ reply: 'Los ingredientes de Spark QA Plato son pollo y arroz.', sources: [menu] }).changed).toBe(false);
        expect(guardDescriptionStatusClaim({ reply: 'The Spark QA Plato costs 13,500 COP.', sources: [menu] }).changed).toBe(false);
    });

    it('what the structured data says stands', () => {
        // A sold-out product the read marks so: the reads mark an item unavailable, the check stands aside.
        const soldOut = { products: [{ ...PRODUCT, stock: 0, isAvailable: false, inStock: false }] };
        expect(guardDescriptionStatusClaim({ reply: 'El Audífono QA Aurora no está a la venta en este momento.', sources: [soldOut] }).changed).toBe(false);
        expect(guardDescriptionStatusClaim({ reply: 'The Audífono QA Aurora is a fictional test product.', sources: [soldOut] }).changed).toBe(false);
        // An availability read that says no.
        expect(guardDescriptionStatusClaim({ reply: 'Lo siento, no está disponible para reservar en esas fechas.', sources: [ROOM, { available: false }] }).changed).toBe(false);
        // A description that does not speak of state, an unnamed claim: not tied to the description.
        const plain = { products: [{ ...PRODUCT, description: 'Audífonos inalámbricos.' }] };
        expect(guardDescriptionStatusClaim({ reply: 'It is a fictional test product.', sources: [plain] }).changed).toBe(false);
        // No read of the turn.
        expect(guardDescriptionStatusClaim({ reply: 'It is a fictional test product and does not correspond to real inventory.', sources: [] }).changed).toBe(false);
    });

    it('the note and rule 13h name these words too', () => {
        expect(DESCRIPTION_AUTHORITY_NOTE).toMatch(/not a real or commercial offer, is not real inventory, or is only a test, sample, synthetic or fictional item/);
        expect(attachDescriptionAuthority('search_products', { products: [PRODUCT] })).toHaveProperty('descriptionAuthority', DESCRIPTION_AUTHORITY_NOTE);
        const contract = (new PromptAssemblerService({ buildSystemPrompt: () => '<persona/>' } as any) as any).buildContractLayer() as string;
        expect(contract).toMatch(/13h\. A DESCRIPTION IS NOT A STATUS.*is not real inventory, or is only a test, sample, synthetic or fictional item/);
    });
});

pinClock();
describe('through ConversationsService: the reply of the turn', () => {
    const answer = (content: string, toolCalls?: any[]) => ({ content, ...(toolCalls ? { toolCalls } : {}), model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
    function turnWith(language: 'es' | 'en' | 'pt', industry: string, tool: string, result: any, reply: string) {
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 5, config_json: { language, industry, rag: { enabled: false }, llm: {} } });
        publishTools(f, [tool, 'search_faqs']);
        f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
            (name === 'search_faqs' ? { faqs: [] } : attachDescriptionAuthority(tool, result)));
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
            const read = (request.messages ?? []).some((m: any) => m?.role === 'tool' && String(m.content).includes('descriptionAuthority'));
            if ((request.tools?.length ?? 0) > 0 && !read) return answer('', [{ id: 'call-read', function: { name: tool, arguments: '{}' } }]);
            return answer(reply);
        });
        return (message: string) => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram' }, { agentSnapshot: undefined });
    }

    it('pt «quais são os ingredientes do prato Spark?» → the answer about the ingredients reaches the customer', async () => {
        const turn = turnWith('pt', 'restaurantes', 'get_menu', menu,
            'Não há informações sobre os ingredientes do prato Spark, que é um item sintético de teste e não está disponível para venda. '
            + 'Também não há informações sobre alergênicos, então é importante confirmar com o restaurante. Posso ajudar com mais alguma coisa?');
        const r = await turn('quais são os ingredientes do prato Spark?');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).toMatch(/^Não há informações sobre os ingredientes do prato Spark\. Também não há informações sobre alergênicos/);
        expect(r.reply).not.toMatch(/sintético|venda/);
    });

    it('es: «sus ingredientes» is not left without the dish', async () => {
        const turn = turnWith('es', 'restaurantes', 'get_menu', menu,
            'El Spark QA Plato es un plato sintético de QA y no está a la venta. No se ha registrado información sobre sus ingredientes.');
        const r = await turn('¿cuáles son los ingredientes del plato Spark?');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).toMatch(/En cuanto a Spark QA Plato, no se ha registrado información sobre sus ingredientes\./);
        expect(r.reply).not.toMatch(/sintético|a la venta/);
    });

    it('en hotel: «a synthetic room for QA purposes, not for commercial use» never reaches the customer', async () => {
        const turn = turnWith('en', 'turismo', 'get_property_details', ROOM,
            'The Spark QA Habitacion room costs 180,000 COP per night and check-in is at 15:00. It is a synthetic room for QA purposes, not for commercial use.');
        const r = await turn('tell me about the Spark QA Habitacion room');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).toMatch(/180[.,\s]000 COP per night and check-in is at 15:00\.$/);
        expect(r.reply).not.toMatch(/synthetic|commercial/);
    });
});
