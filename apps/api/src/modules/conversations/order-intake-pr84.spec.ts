import { detectOrderIntake, orderChoiceText, type IntakeProduct } from './order-intake';
import { resolveListChoice } from './list-choice';

// PR #84 review: an order needs more than a verb and a product, a complaint is not an order, and the «el N» of a list is only the
// option when the list is a list of times that the reply asks to choose from.
const AURORA: IntakeProduct = { id: 'p-aurora', title: 'Audífono QA Aurora', price: 119900, currency: 'COP', stock: 2 };
const NOVA: IntakeProduct = { id: 'p-nova', title: 'Cargador QA Nova', price: 45000, currency: 'COP', stock: 10 };
const PRO: IntakeProduct = { id: 'p-pro', title: 'Audífono QA Aurora Pro', price: 229900, currency: 'COP', stock: 4 };
const CATALOG = [AURORA, NOVA];

describe('a complaint, an apology or a request about a product already bought is not an order', () => {
    it.each([
        // es
        'quiero pedir perdón, el Audífono QA Aurora llegó roto', 'quiero pedir disculpas porque el Audífono QA Aurora no funciona',
        'Quiero pedir la garantía del Audífono QA Aurora', 'quiero pedir el cambio del Audífono QA Aurora', 'El Audífono QA Aurora está dañado, quiero pedir 1 nuevo',
        'quiero pedir una devolución del Audífono QA Aurora', 'quiero pedir 1 Audífono QA Aurora, es que el otro no sirve', 'quiero pedir 1 Audífono QA Aurora defectuoso',
        'Quiero pedir un reclamo por el Audífono QA Aurora', 'quiero pedir la factura del Audífono QA Aurora', 'tengo un problema, quiero pedir 1 Audífono QA Aurora',
        // en
        'I want to order a refund for the Audífono QA Aurora', 'I want to buy a new one, the Audífono QA Aurora arrived broken', 'sorry, I want to order 1 Audífono QA Aurora',
        'I want to order a replacement, my Audífono QA Aurora is damaged', 'I want to buy 1 Audífono QA Aurora, the warranty claim is open',
        // pt
        'Quero comprar 1 Audífono QA Aurora, mas o outro chegou quebrado', 'desculpe, quero pedir 1 Audífono QA Aurora', 'Quero pedir a fatura do Audífono QA Aurora',
        'Quero comprar 1 Audífono QA Aurora defeituoso', 'Quero pedir reembolso do Audífono QA Aurora',
        // fr
        'Je voudrais commander 1 Audífono QA Aurora mais il est arrivé cassé', 'Je voudrais commander un retour du Audífono QA Aurora', 'désolé, je voudrais commander 1 Audífono QA Aurora',
        'Je voudrais commander la facture du Audífono QA Aurora', 'Je voudrais commander 1 Audífono QA Aurora, il est endommagé',
    ])('«%s»', text => {
        expect(detectOrderIntake(text, CATALOG)).toBeNull();
    });
});

describe('an order says how many, or puts the product right after the buying verb, or takes it', () => {
    it('a verb and a product far apart, with no quantity, are not enough', () => {
        expect(detectOrderIntake('quiero pedir, aunque no sé, el Audífono QA Aurora', CATALOG)).toBeNull();
        expect(detectOrderIntake('quiero pedir algo de lo que vi: el Audífono QA Aurora', CATALOG)).toBeNull();
        expect(detectOrderIntake('I want to order whatever you recommend, maybe the Audífono QA Aurora', CATALOG)).toBeNull();
    });

    it.each([
        ['quisiera comprar audífonos aurora', 'p-aurora', 1], ['quiero pedir el Audífono QA Aurora', 'p-aurora', 1], ['Quiero comprar un Cargador QA Nova', 'p-nova', 1],
        ['quiero pedir 2 Audífono QA Aurora', 'p-aurora', 2],
        ['me lo vende, el Audífono QA Aurora', 'p-aurora', 1], ['lo compro, el Audífono QA Aurora', 'p-aurora', 1], ['me llevo el Cargador QA Nova', 'p-nova', 1],
        ['I want to buy the Audífono QA Aurora', 'p-aurora', 1], ['I\'ll buy it, the Cargador QA Nova', 'p-nova', 1], ['Quero comprar o Audífono QA Aurora', 'p-aurora', 1],
        ['eu levo o Cargador QA Nova', 'p-nova', 1], ['je le prends, le Cargador QA Nova', 'p-nova', 1], ['Je voudrais commander le Cargador QA Nova', 'p-nova', 1],
    ])('«%s» → %s × %s', (text, id, quantity) => {
        expect(detectOrderIntake(text, CATALOG)).toMatchObject({ product: { id }, quantity });
    });
});

describe('the delivery the order message itself gives goes with the order', () => {
    it.each([
        ['Quiero pedir el Audífono QA Aurora, envíelo a la Calle 5 #4-3', 'envíelo a la Calle 5 #4-3'],
        ['Quiero pedir 2 Audífono QA Aurora, sin envío por ahora', 'sin envío por ahora'],
        ['Quiero pedir 1 Cargador QA Nova; lo recojo en la tienda', 'lo recojo en la tienda'],
        ['I want to buy 1 Cargador QA Nova, ship it to 12 Main Street', 'ship it to 12 Main Street'],
    ])('«%s»', (text, notes) => {
        expect(detectOrderIntake(text, CATALOG)).toMatchObject({ notes });
    });

    it('no delivery in it, no notes', () => {
        expect(detectOrderIntake('Quiero pedir 1 Audífono QA Aurora', CATALOG)).not.toHaveProperty('notes');
    });
});

describe('a partial name that a longer product also answers to is asked, never guessed', () => {
    it('«quisiera comprar audífonos aurora» with an «… Pro» on sale', () => {
        const read = detectOrderIntake('quisiera comprar audífonos aurora', [AURORA, PRO, NOVA]) as any;
        expect(read.choose.map((product: IntakeProduct) => product.id)).toEqual(['p-aurora', 'p-pro']);
        expect(read.quantity).toBe(1);
    });

    it('the whole name, or a name no other product answers to, is not asked', () => {
        expect(detectOrderIntake('quisiera comprar 1 Audífono QA Aurora', [AURORA, PRO])).toMatchObject({ product: { id: 'p-aurora' } });
        expect(detectOrderIntake('quisiera comprar audífonos aurora', [AURORA, NOVA])).toMatchObject({ product: { id: 'p-aurora' } });
    });

    it('the question names the options in the customer\'s language and register', () => {
        const options = [AURORA, PRO];
        expect(orderChoiceText(options, 'es', 'usted')).toBe('Tengo más de un producto con ese nombre: Audífono QA Aurora o Audífono QA Aurora Pro. ¿Cuál desea?');
        expect(orderChoiceText(options, 'es', 'tu')).toContain('¿Cuál quieres?');
        expect(orderChoiceText(options, 'en')).toContain('Audífono QA Aurora or Audífono QA Aurora Pro. Which one would you like?');
        expect(orderChoiceText(options, 'pt')).toContain('ou');
        expect(orderChoiceText([AURORA, PRO, NOVA], 'fr')).toContain('Audífono QA Aurora, Audífono QA Aurora Pro ou Cargador QA Nova');
    });
});

describe('«el N» is the option only for a list of times the reply asks to choose from', () => {
    it.each([
        ['2', 'Tengo 9:00, 9:30 y 10:00. ¿Cuál es el número de personas?'],
        ['2', 'Tenemos 9:00 y 10:00 disponibles. ¿Cuántas personas serán?'],
        ['el 2', '1. Pizza 2. Hamburguesa a las 12:00 o 13:00. ¿Cuál prefiere?'],
        ['el 2', 'Menú: 1) Pizza 2) Hamburguesa. Entrega a las 12:00 o 13:00. ¿Cuál prefiere?'],
        ['2', 'Nuestro horario es de 9:00 a 18:00. ¿Cuál producto desea?'],
        ['2', 'Tengo libres 9:00, 9:30 y 10:00. ¿A nombre de quién la agendo?'],
        ['2', 'Tengo libres 9:00, 9:30 y 10:00. ¿Cuál es su correo?'],
    ])('«%s» after «%s» is left as written', (text, reply) => {
        expect(resolveListChoice(text, reply)).toBeNull();
    });

    it.each([
        ['el 2', 'Tengo libres 9:00, 9:30 y 10:00. ¿Cuál horario prefiere?', '9:30'],
        ['el 2', 'Tengo libres 9:00, 9:30 y 10:00. ¿A qué hora le sirve?', '9:30'],
        ['2', 'Para el lunes tengo 9:00, 9:30 y 10:00. ¿Cuál le gustaría reservar?', '9:30'],
        ['the 2', 'I have 9:00 a. m., 9:30 a. m. and 10:00 a. m. Which time do you prefer?', null],
        ['2', 'I have 9:00 a. m., 9:30 a. m. and 10:00 a. m. Which time do you prefer?', '9:30 a. m.'],
        ['2', 'J’ai 9:00, 9:30 et 10:00. Quelle heure préférez-vous ?', '9:30'],
        ['2', 'Tenho 9:00, 9:30 e 10:00. Qual horário prefere?', '9:30'],
    ])('«%s» after «%s» → %s', (text, reply, time) => {
        expect(resolveListChoice(text, reply)?.time ?? null).toBe(time);
    });
});
