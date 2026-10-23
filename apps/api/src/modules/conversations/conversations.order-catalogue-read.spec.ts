import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { pinClock } from './__fixtures__/pinned-clock';
import { STORE, AURORA, world } from './__fixtures__/live-world';
import { mightBeMenuOrderRequest, mightBeOrderRequest } from './order-intake';
import { CATALOGUE_ORDER_NOTE, MENU_ORDER_NOTE, withOrderNote } from './order-catalogue-read';

/**
 * Production QA (restaurant with ONE dish on the menu; store that sells only the Aurora headphones): «Quiero el combo de hamburguesa
 * con papas», «quiero pedir una pizza» and «quiero comprar un cargador» reached the model with no current menu / catalogue, and it
 * started taking the order (allergies, address, «las pizzas que sí ofrecemos»). The server now reads the menu / catalogue first, read
 * only, and the model sees a note: what is not there is said before anything else is asked. Order creation already rejected unknown items.
 */
pinClock();

const DISH = '11111111-1111-4111-8111-111111111111';
function restaurant(allowed = ['get_menu', 'place_order', 'search_faqs']) {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 5, config_json: { language: 'es', industry: 'restaurantes', rag: { enabled: false }, llm: {} } });
    publishTools(f, allowed);
    let menu: any = { count: 1, items: [{ id: DISH, name: 'Bandeja QA Paisa', description: 'Plato único de prueba.', price: 32000, currency: 'COP', category: null }] };
    // The automatic FAQ lookup of every turn (search_faqs is what the production turn had) finds nothing.
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => (name === 'search_faqs' ? { faqs: [] } : menu));
    const turn = (message: string) => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram' }, { agentSnapshot: undefined });
    const toolMessages = () => (f.llmRouter.execute.mock.calls[0]?.[0]?.messages ?? []).filter((m: any) => m.role === 'tool').map((m: any) => String(m.content));
    return { f, turn, toolMessages, failMenu: (result: any) => { menu = result; } };
}
/** The tools the turn ran besides the automatic FAQ lookup. */
const names = (f: ReturnType<typeof agentTurnFixture>) => f.toolExecutor.execute.mock.calls.map((c: any[]) => c[3]).filter((name: string) => name !== 'search_faqs');

describe('a restaurant order reads the current menu before the model takes it', () => {
    it.each(['Quiero el combo de hamburguesa con papas', 'quiero pedir una pizza'])('«%s»: get_menu, read only, and the note', async message => {
        const h = restaurant();
        const r = await h.turn(message);
        expect(r.debug.runtimeError).toBeUndefined();
        expect(names(h.f)).toEqual(['get_menu']);
        const call = h.f.toolExecutor.execute.mock.calls.find((c: any[]) => c[3] === 'get_menu')!;
        expect(call[4]).toEqual({});
        expect(call[6].executionContext.persistence).toBe('disabled');
        expect(call[6].authority).toBeDefined();
        const menu = h.toolMessages().find((content: string) => content.includes('Bandeja QA Paisa'));
        expect(menu).toBeDefined();
        expect(JSON.parse(menu!).order_note).toBe(MENU_ORDER_NOTE);
    });

    // Production QA after #189: asked as a question, the order reached the model with no menu read, and it called the real dish's price
    // «no confirmado» while asking for an address.
    it.each(['¿me puedes pedir una lasaña?', '¿me pides un burrito?'])('question form «%s»: get_menu, read only, and the note', async message => {
        const h = restaurant();
        const r = await h.turn(message);
        expect(r.debug.runtimeError).toBeUndefined();
        expect(names(h.f)).toEqual(['get_menu']);
        const call = h.f.toolExecutor.execute.mock.calls.find((c: any[]) => c[3] === 'get_menu')!;
        expect(call[6].executionContext.persistence).toBe('disabled');
        const menu = h.toolMessages().find((content: string) => content.includes('Bandeja QA Paisa'));
        expect(menu).toBeDefined();
        expect(JSON.parse(menu!).order_note).toBe(MENU_ORDER_NOTE);
    });

    it.each(['¿cuánto vale el plato?', '¿tienen postres?'])('information question «%s» carries no order note', async message => {
        const h = restaurant();
        await h.turn(message);
        expect(h.toolMessages().some((content: string) => content.includes('order_note'))).toBe(false);
    });

    it('a message that is not an order reads nothing', async () => {
        const h = restaurant();
        await h.turn('¿A qué hora abren hoy?');
        expect(names(h.f)).toEqual([]);
        expect(h.toolMessages().some((content: string) => content.includes('order_note'))).toBe(false);
    });

    it('without place_order published the order words read nothing', async () => {
        const h = restaurant(['get_menu', 'search_faqs']);
        await h.turn('quiero pedir una pizza');
        expect(names(h.f)).toEqual([]);
    });

    it('an order that also asks for a description reads the menu once', async () => {
        const h = restaurant();
        await h.turn('Quiero pedir el plato Bandeja QA Paisa, con su descripción');
        expect(names(h.f)).toEqual(['get_menu']);
        expect(h.toolMessages().filter((content: string) => content.includes('Bandeja QA Paisa'))).toHaveLength(1);
    });

    it('a description request alone carries no order note (unchanged)', async () => {
        const h = restaurant();
        await h.turn('¿Qué dice la descripción del plato Bandeja QA Paisa?');
        expect(names(h.f)).toEqual(['get_menu']);
        expect(h.toolMessages().some((content: string) => content.includes('order_note'))).toBe(false);
    });

    it('a failed menu read stays an admission, with no note', async () => {
        const h = restaurant();
        h.failMenu({ error: 'permission_denied' });
        await h.turn('quiero pedir una pizza');
        const read = h.toolMessages().find((content: string) => content.includes('permission_denied'));
        expect(read).toBeDefined();
        expect(read).not.toContain('order_note');
    });
});

describe('a store order the deterministic intake does not match reads the catalogue first', () => {
    const store = () => world({ tools: STORE, industry: 'retail', products: [AURORA] });
    const toolMessages = (h: ReturnType<typeof store>) => h.f.llmRouter.execute.mock.calls
        .flatMap((c: any[]) => (c[0]?.messages ?? []).filter((m: any) => m.role === 'tool').map((m: any) => String(m.content)));

    it('«quiero comprar un cargador» (not sold): search_products with the default args, read only, and the note', async () => {
        const h = store();
        const r = await h.turn('quiero comprar un cargador');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(h.ran('search_products')).toHaveLength(1);
        expect(h.ran('search_products')[0].args).toEqual({ query: '', limit: 20 });
        const call = h.f.toolExecutor.execute.mock.calls.find((c: any[]) => c[3] === 'search_products')!;
        expect(call[6].executionContext.persistence).toBe('disabled');
        expect(h.ran('place_catalog_order')).toHaveLength(0);
        const notes = toolMessages(h).filter((content: string) => content.includes('order_note'));
        expect(notes.length).toBeGreaterThan(0);
        expect(JSON.parse(notes[0]).order_note).toBe(CATALOGUE_ORDER_NOTE);
    });

    it('«Quiero pedir 1 Audífono QA Aurora» (sold) is still the intake\'s: proposal, no extra read', async () => {
        const h = store();
        const r = await h.turn('Quiero pedir 1 Audífono QA Aurora');
        expect(h.ran('search_products')).toHaveLength(0);
        expect(h.ran('place_catalog_order').map(call => call.result.error)).toEqual(['confirmation_required']);
        expect(r.reply).toContain('Audífono QA Aurora');
        expect(toolMessages(h).some((content: string) => content.includes('order_note'))).toBe(false);
    });

    it('a message that is not an order reads nothing extra', async () => {
        const h = store();
        await h.turn('hola, buenas tardes');
        expect(h.ran('search_products')).toHaveLength(0);
    });
});

describe('the words that gate the read', () => {
    it.each(['Quiero el combo de hamburguesa con papas', 'quiero pedir una pizza', 'Quisiera una limonada', 'me trae dos empanadas por favor'])('«%s» is a menu order', text => {
        expect(mightBeMenuOrderRequest(text)).toBe(true);
    });
    it.each(['¿Tienen pizza?', 'no quiero la pizza', 'quiero la información del menú', 'quiero cancelar mi pedido', 'hola', 'quiero saber el precio de la pizza'])('«%s» is not', text => {
        expect(mightBeMenuOrderRequest(text)).toBe(false);
    });
    it.each([
        '¿me puedes pedir una lasaña?', '¿me pides un burrito?', 'Hola, ¿me podrías traer dos empanadas?', '¿me mandas una pizza?', '¿puedes traerme una limonada?',
        'Você pode me trazer um suco?', 'pode trazer-me uma pizza?',
        'Vous pouvez me commander une pizza ?', "Pouvez-vous m'apporter une salade ?",
        'Can you get me a burger?', 'can I order a pizza?',
    ])('question-form order «%s» is a menu order', text => {
        expect(mightBeMenuOrderRequest(text)).toBe(true);
    });
    it.each([
        '¿cuánto vale el plato?', '¿tienen postres?', '¿qué platos hay?', '¿me puedes traer la cuenta?', '¿me puedes mandar el menú?',
        '¿me puedes cancelar el pedido?', '¿me pueden devolver el dinero de la pizza?', '¿no me puedes traer una pizza?', '¿me puedes explicar el plato?',
        'Quanto custa a pizza?', 'Vous avez des desserts ?', 'how much is the pizza?', 'can you tell me the price of a pizza?',
    ])('question «%s» is not', text => {
        expect(mightBeMenuOrderRequest(text)).toBe(false);
    });
    it('the store gate is unchanged: a desire with no buying verb is not a store order', () => {
        expect(mightBeOrderRequest('¿me puedes pedir una lasaña?')).toBe(false);
        expect(mightBeOrderRequest('Quiero el combo de hamburguesa con papas')).toBe(false);
        expect(mightBeOrderRequest('quiero comprar un cargador')).toBe(true);
    });
    it('the note goes on a successful read only', () => {
        expect(withOrderNote({ items: [] }, MENU_ORDER_NOTE)).toEqual({ items: [], order_note: MENU_ORDER_NOTE });
        expect(withOrderNote({ error: 'x' }, MENU_ORDER_NOTE)).toEqual({ error: 'x' });
        expect(withOrderNote({ status: 'error', errorCode: 'READ_FAILED' }, MENU_ORDER_NOTE)).toEqual({ status: 'error', errorCode: 'READ_FAILED' });
        expect(withOrderNote(null, MENU_ORDER_NOTE)).toBeNull();
    });
});
