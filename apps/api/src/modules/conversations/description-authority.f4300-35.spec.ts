import { AIToolExecutorService } from './ai-tool-executor.service';
import { attachDescriptionAuthority, carriesDescription, DESCRIPTION_AUTHORITY_NOTE, guardDescriptionStatusClaim } from './description-authority';
import { PromptAssemblerService } from './prompt-assembler.service';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { pinClock } from './__fixtures__/pinned-clock';

/**
 * F4300-35 (production QA 2026-10-24, Telegram QA tenants). The dish «Spark QA Plato» is is_active = true, is_available = true,
 * 13.500 COP; its description says it is a synthetic QA dish «no vender». Asked its ingredients (es/en/fr/pt, 4 of 4) or the menu
 * (en) the agent said it is not for sale (and in the list case then offered to order it); asked price/availability it said it can
 * be ordered. The hotel room «Spark QA Habitacion» (active) was «habitación sintética para pruebas, no comercializable» next to its
 * price and check-in. The structured fields are the only source of sellability; a description is marketing text.
 */
const DISH_DESCRIPTION = 'Plato sintético de QA para pruebas del agente. No vender.';
const SPARK = { id: '11111111-1111-4111-8111-111111111111', name: 'Spark QA Plato', description: DISH_DESCRIPTION, price: 13500,
    priceStatus: 'confirmed', currency: 'COP', category: 'Principales', tags: [], allergens: 'not_informed', prepTimeMinutes: 15 };
const menuResult = (items: any[]) => ({ count: items.length, items });
const ROOM = { id: '22222222-2222-4222-8222-222222222222', name: 'Spark QA Habitacion', description: 'Habitación sintética para pruebas, no comercializable.',
    nightPrice: 180000, priceStatus: 'confirmed', currency: 'COP', checkInTime: '15:00', checkOutTime: '11:00', maxGuests: 2 };

describe('the catalogue reads say a description is not a status', () => {
    it('every catalogue reader with a description row carries the note; other results do not', () => {
        expect(attachDescriptionAuthority('get_menu', menuResult([SPARK]))).toMatchObject({ descriptionAuthority: DESCRIPTION_AUTHORITY_NOTE });
        expect(attachDescriptionAuthority('get_property_details', ROOM)).toMatchObject({ descriptionAuthority: DESCRIPTION_AUTHORITY_NOTE });
        expect(attachDescriptionAuthority('list_properties', { properties: [ROOM] })).toHaveProperty('descriptionAuthority');
        expect(attachDescriptionAuthority('search_products', { products: [{ name: 'X', description: 'Y' }] })).toHaveProperty('descriptionAuthority');
        // No description, an error, or a tool that is not a catalogue read: unchanged.
        expect(attachDescriptionAuthority('get_menu', menuResult([{ ...SPARK, description: '' }]))).not.toHaveProperty('descriptionAuthority');
        expect(attachDescriptionAuthority('get_menu', { error: 'read_failed', description: 'x' })).not.toHaveProperty('descriptionAuthority');
        expect(attachDescriptionAuthority('get_appointment_details', { description: 'x' })).not.toHaveProperty('descriptionAuthority');
        expect(carriesDescription(null)).toBe(false);
        expect(DESCRIPTION_AUTHORITY_NOTE).toMatch(/NEVER states whether the item is for sale/);
    });

    it('the executor attaches it to a real get_menu read (active and available dish)', async () => {
        const restaurantsService = { searchMenu: jest.fn().mockResolvedValue([{ ...SPARK, prep_time_minutes: 15, category_name: 'Principales', allergens: [] }]) };
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), $executeRawUnsafe: jest.fn(), executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        const control = { preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }), complete: jest.fn(), fail: jest.fn() };
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        Object.assign(executor, { restaurantsService, prisma, toolExecutionControl: control, logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() } });
        const direct = await executor.getMenu('tenant_qa', {});
        expect(attachDescriptionAuthority('get_menu', direct).descriptionAuthority).toBe(DESCRIPTION_AUTHORITY_NOTE);
        expect(direct.items[0].description).toBe(DISH_DESCRIPTION);
    });

    it('the contract carries rule 13h', () => {
        const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona/>' } as any);
        const contract = (assembler as any).buildContractLayer() as string;
        expect(contract).toContain('13h. A DESCRIPTION IS NOT A STATUS');
        expect(contract).toMatch(/never to state its availability or sale status/);
    });
});

describe('the output check: a sentence that states an offered item is not for sale goes', () => {
    const sources = [menuResult([SPARK])];
    it.each([
        ['es', 'El Spark QA Plato lleva pollo, arroz y verduras. Es un plato sintético de QA y no está a la venta.', 'El Spark QA Plato lleva pollo, arroz y verduras.'],
        ['en', 'The Spark QA Plato has chicken, rice and vegetables. However, it is not for sale.', 'The Spark QA Plato has chicken, rice and vegetables.'],
        ['fr', 'Le Spark QA Plato contient du poulet, du riz et des légumes. Cependant, il n’est pas en vente.', 'Le Spark QA Plato contient du poulet, du riz et des légumes.'],
        ['pt', 'O Spark QA Plato leva frango, arroz e legumes. Porém, não está à venda.', 'O Spark QA Plato leva frango, arroz e legumes.'],
    ])('ingredients (%s): the not-for-sale sentence is removed, the ingredients stay', (lang, reply, expected) => {
        const out = guardDescriptionStatusClaim({ reply, sources, lang });
        expect(out).toMatchObject({ changed: true, action: 'removed', text: expected, items: ['Spark QA Plato'] });
    });

    it('the menu list (en): «not for sale» next to the item, then an offer to order it', () => {
        const reply = 'Here is our menu:\n- Spark QA Plato: 13.500 COP. Note: this dish is not for sale.\nWould you like to order the Spark QA Plato?';
        const out = guardDescriptionStatusClaim({ reply, sources, lang: 'en' });
        expect(out.changed).toBe(true);
        expect(out.text).toBe('Here is our menu:\n- Spark QA Plato: 13.500 COP.\nWould you like to order the Spark QA Plato?');
    });

    it('the hotel room: «habitación sintética para pruebas, no comercializable» goes, price and check-in stay', () => {
        const reply = 'La Spark QA Habitacion cuesta 180.000 COP por noche y el check-in es a las 15:00. Es una habitación sintética para pruebas, no comercializable.';
        const out = guardDescriptionStatusClaim({ reply, sources: [ROOM], lang: 'es' });
        expect(out.text).toBe('La Spark QA Habitacion cuesta 180.000 COP por noche y el check-in es a las 15:00.');
    });

    it('nothing else left: the catalogue says it is available', () => {
        const out = guardDescriptionStatusClaim({ reply: 'El Spark QA Plato no está a la venta.', sources: [JSON.stringify(menuResult([SPARK]))], lang: 'es' });
        expect(out).toMatchObject({ changed: true, action: 'fallback', text: 'Según el catálogo, Spark QA Plato está disponible.' });
    });

    it('what the structured data says stands', () => {
        // A sold-out / withdrawn item the reads mark so.
        const soldOut = { products: [{ name: 'QA Agente Stock', description: 'x', isAvailable: false, inStock: false }] };
        expect(guardDescriptionStatusClaim({ reply: 'El QA Agente Stock no está a la venta en este momento.', sources: [soldOut] }).changed).toBe(false);
        // An availability read that says no: a «not available to book» sentence without a name is the data.
        expect(guardDescriptionStatusClaim({ reply: 'Lo siento, no está disponible para reservar en esas fechas.', sources: [ROOM, { available: false }] }).changed).toBe(false);
        // «Not sold out», «not sold separately», «no se vende por separado» are not claims of not for sale.
        expect(guardDescriptionStatusClaim({ reply: 'The Spark QA Plato is not sold out.', sources }).changed).toBe(false);
        expect(guardDescriptionStatusClaim({ reply: 'The sauce of the Spark QA Plato is not sold separately.', sources }).changed).toBe(false);
        expect(guardDescriptionStatusClaim({ reply: 'La salsa del Spark QA Plato no se vende por separado.', sources }).changed).toBe(false);
        // No read of the turn, or a reply that makes no such claim.
        expect(guardDescriptionStatusClaim({ reply: 'El Spark QA Plato no está a la venta.', sources: [] }).changed).toBe(false);
        expect(guardDescriptionStatusClaim({ reply: 'El Spark QA Plato cuesta 13.500 COP.', sources }).changed).toBe(false);
        // An unnamed claim, with a description that does not speak of state: not tied to the description.
        const plain = menuResult([{ ...SPARK, description: 'Pollo con arroz y verduras.' }]);
        expect(guardDescriptionStatusClaim({ reply: 'Ese combo no está a la venta.', sources: [plain] }).changed).toBe(false);
    });
});

pinClock();
describe('through ConversationsService: the model reads the menu and repeats the description as a status', () => {
    const answer = (content: string, toolCalls?: any[]) => ({ content, ...(toolCalls ? { toolCalls } : {}), model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
    function restaurant(language: 'es' | 'en', reply: string) {
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 5, config_json: { language, industry: 'restaurantes', rag: { enabled: false }, llm: {} } });
        publishTools(f, ['get_menu', 'place_order', 'search_faqs']);
        f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
            (name === 'search_faqs' ? { faqs: [] } : attachDescriptionAuthority('get_menu', menuResult([SPARK]))));
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
            const read = (request.messages ?? []).some((m: any) => m?.role === 'tool' && String(m.content).includes('Spark QA Plato'));
            if ((request.tools?.length ?? 0) > 0 && !read) return answer('', [{ id: 'call-menu', function: { name: 'get_menu', arguments: '{}' } }]);
            return answer(reply);
        });
        return { f, turn: (message: string) => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram' }, { agentSnapshot: undefined }) };
    }

    it('«qué ingredientes tiene el Spark QA Plato?» → the «no está a la venta» sentence never reaches the customer', async () => {
        const { turn } = restaurant('es', 'El Spark QA Plato lleva pollo, arroz y verduras. Es un plato de pruebas y no está a la venta.');
        const r = await turn('qué ingredientes tiene el Spark QA Plato?');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).toContain('pollo, arroz y verduras');
        expect(r.reply).not.toMatch(/no está a la venta/);
    });

    it('the menu read the model sees carries the description authority note', async () => {
        const { f, turn } = restaurant('en', 'The Spark QA Plato costs 13.500 COP.');
        const r = await turn('what is on the menu?');
        expect(r.debug.runtimeError).toBeUndefined();
        const toolMessages = f.llmRouter.execute.mock.calls.map((c: any[]) => c[0]).flatMap((req: any) => (req?.messages ?? []).filter((m: any) => m?.role === 'tool'));
        expect(toolMessages.some((m: any) => String(m.content).includes('NEVER states whether the item is for sale'))).toBe(true);
        expect(r.reply).toMatch(/13[.,]500 COP/);
    });
});
