import {
    RECIPE_EXAMPLE_AMOUNT_COUNTRIES,
    recipeExampleAmount,
    recipeSeedPrice,
    roundToPlausibleStep,
} from '@parallext/shared';
import { VERTICAL_REGISTRY, getVerticalDefinition } from './vertical-definitions';
import { formatRecipeLint, lintRecipes } from './recipe-lint';

/**
 * D13 (sep-2026): escribir mil piezas de texto solo es posible si algo revisa
 * cada una. Este spec es ese algo.
 */
describe('the recipe lint', () => {
    const report = lintRecipes({
        registry: VERTICAL_REGISTRY,
        resolve: (industry, subType) => getVerticalDefinition(industry, subType),
    });

    it('finds no recipe that says something the business never confirmed', () => {
        // Un `error` es una receta que MIENTE o que está rota. Un `gap` es una
        // receta que todavía no se escribió, y eso no rompe la suite: si lo
        // hiciera, la única forma de tener verde sería escribir las 18
        // industrias de una sentada.
        expect(formatRecipeLint(report.errors)).toBe('');
    });

    it('cubre cada industria y cada subtipo del registro', () => {
        // El total es industrias + subtipos, que es lo que un tenant puede
        // elegir. Si el registro crece, el lint crece con él sin tocar nada.
        const expected = Object.values(VERTICAL_REGISTRY)
            .reduce((total, def) => total + 1 + (def.subTypes?.length ?? 0), 0);
        expect(report.coverage.total).toBe(expected);
    });

    it('reporta la cobertura en vez de fingir que está completa', () => {
        // Este número sube con cada industria escrita. No se pinnea a un valor
        // exacto a propósito: un spec que hay que editar para avanzar es un
        // spec que se edita sin mirar.
        expect(report.coverage.written).toBeLessThanOrEqual(report.coverage.total);
        expect(report.coverage.scopes).toHaveLength(report.coverage.written);
    });

    it('atrapa un precio inventado, una dirección y un motivo sin disparador', () => {
        const fake = {
            ...getVerticalDefinition('otro'),
            recipe: {
                family: 'booking' as const,
                purchaseModes: ['appointment' as const],
                mainInstructions: { es: 'La consulta cuesta $80.000.', en: 'x', pt: 'x', fr: 'x' },
                handoffReasons: [
                    // Un disparador que no existe en este agente: la ficha diría
                    // "si piden una audiencia con el rey paso a una persona" y el
                    // motor nunca pasaría.
                    { trigger: 'audiencia con el rey', text: { es: 'Quiere una audiencia con el rey', en: 'x', pt: 'x', fr: 'x' } },
                    { trigger: 'queja formal', text: { es: 'Queja formal', en: 'x', pt: 'x', fr: 'x' } },
                    { trigger: 'quiero mi dinero', text: { es: 'Quiere su dinero de vuelta', en: 'x', pt: 'x', fr: 'x' } },
                ],
                canonicalQuestions: [
                    {
                        question: { es: '¿Dónde quedan?', en: 'x', pt: 'x', fr: 'x' },
                        answer: { es: 'Estamos en Calle 93 #12-34.', en: 'x', pt: 'x', fr: 'x' },
                    },
                ],
            },
        };
        const out = lintRecipes({
            registry: { fake } as any,
            resolve: () => fake as any,
        });
        const rules = out.errors.map((f) => f.rule);
        expect(rules).toContain('invented_price');
        expect(rules).toContain('invented_address');
        expect(rules).toContain('handoff_trigger_not_in_agent');
        expect(rules).toContain('questions_count');
    });

    it('no confunde prosa en inglés o francés con un monto', () => {
        // El patrón de dinero llevaba la bandera `i`, así que `[$€R]` aceptaba
        // una `r` minúscula y "a table for 4" o "une table pour 4" se leían como
        // un precio inventado. Un lint que castiga la frase correcta empuja a
        // escribir peor con tal de pasar.
        const fake = {
            ...getVerticalDefinition('otro'),
            recipe: {
                whenUnsure: [
                    { es: 'Te lo confirmo.', en: 'I can book a table for 4.', pt: 'Reservo para 3.', fr: 'Une table pour 4.' },
                    { es: 'Te dejo el dato.', en: 'x', pt: 'x', fr: 'x' },
                    { es: 'Te paso con alguien.', en: 'x', pt: 'x', fr: 'x' },
                ],
            },
        };
        const out = lintRecipes({ registry: { fake } as any, resolve: () => fake as any });
        expect(out.errors.map((f) => f.rule)).not.toContain('invented_price');
    });

    it('sigue atrapando el real brasileño y la moneda escrita con nombre', () => {
        const fake = {
            ...getVerticalDefinition('otro'),
            recipe: {
                whenUnsure: [
                    { es: 'Cuesta 120 Soles.', en: 'x', pt: 'Custa R$ 90.', fr: 'x' },
                    { es: 'Te dejo el dato.', en: 'x', pt: 'x', fr: 'x' },
                    { es: 'Te paso con alguien.', en: 'x', pt: 'x', fr: 'x' },
                ],
            },
        };
        const out = lintRecipes({ registry: { fake } as any, resolve: () => fake as any });
        expect(out.errors.filter((f) => f.rule === 'invented_price')).toHaveLength(2);
    });

    it('acepta el espacio con mayúscula de principio de frase', () => {
        // "[Servicio] cuesta [precio]" es como el propio diseño escribe sus
        // ejemplos; rechazarlo obligaba a reescribir la frase para el lint.
        const fake = {
            ...getVerticalDefinition('otro'),
            recipe: {
                whenUnsure: [
                    { es: '[Servicio] cuesta [precio].', en: 'x', pt: 'x', fr: 'x' },
                    { es: 'Te dejo el dato.', en: 'x', pt: 'x', fr: 'x' },
                    { es: 'Te paso con alguien.', en: 'x', pt: 'x', fr: 'x' },
                ],
            },
        };
        const out = lintRecipes({ registry: { fake } as any, resolve: () => fake as any });
        expect(out.errors.map((f) => f.rule)).not.toContain('blank_unknown');
    });

    it('rechaza un motivo que no dice con qué disparador se cumple', () => {
        // Sin el vínculo escrito, la ficha es una promesa que nadie verificó.
        const fake = {
            ...getVerticalDefinition('otro'),
            recipe: {
                handoffReasons: [
                    { trigger: '', text: { es: 'Queja formal', en: 'x', pt: 'x', fr: 'x' } },
                    { trigger: 'queja formal', text: { es: 'Queja formal', en: 'x', pt: 'x', fr: 'x' } },
                    { trigger: 'quiero mi dinero', text: { es: 'Quiere su dinero', en: 'x', pt: 'x', fr: 'x' } },
                ],
            },
        };
        const out = lintRecipes({ registry: { fake } as any, resolve: () => fake as any });
        expect(out.errors.map((f) => f.rule)).toContain('handoff_reason_without_trigger');
    });

    it('acepta el motivo cuyo disparador sí está en el agente', () => {
        const fake = {
            ...getVerticalDefinition('otro'),
            recipe: {
                handoffReasons: [
                    { trigger: 'queja formal', text: { es: 'Queja formal', en: 'Formal complaint', pt: 'Queixa formal', fr: 'Plainte formelle' } },
                    { trigger: 'reclamo formal', text: { es: 'Reclamo formal', en: 'Formal claim', pt: 'Reclamação formal', fr: 'Réclamation formelle' } },
                    { trigger: 'hablar con una persona', text: { es: 'Pide hablar con una persona', en: 'Asks for a person', pt: 'Pede falar com uma pessoa', fr: 'Demande une personne' } },
                ],
            },
        };
        const out = lintRecipes({ registry: { fake } as any, resolve: () => fake as any });
        expect(out.errors).toEqual([]);
    });

    it('rechaza un espacio en blanco que ninguna pantalla sabe llenar', () => {
        const fake = {
            ...getVerticalDefinition('otro'),
            recipe: {
                whenUnsure: [
                    { es: 'Lo confirmo con [el jefe supremo].', en: 'x', pt: 'x', fr: 'x' },
                    { es: 'Te dejo el dato.', en: 'x', pt: 'x', fr: 'x' },
                    { es: 'Te paso con una persona.', en: 'x', pt: 'x', fr: 'x' },
                ],
            },
        };
        const out = lintRecipes({ registry: { fake } as any, resolve: () => fake as any });
        expect(out.errors.map((f) => f.rule)).toContain('blank_unknown');
    });

    it('rechaza una pregunta que el motor escala antes de responder', () => {
        // "devolución" está entre los disparadores de handoff, así que una
        // pregunta canónica que la contenga nunca llega a contestarse: el dueño
        // ve al agente pasando a una persona algo que él dejó escrito.
        const base = getVerticalDefinition('retail');
        const fake = {
            ...base,
            recipe: {
                canonicalQuestions: [
                    { question: { es: '¿Tienen política de devolución?', en: 'x', pt: 'x', fr: 'x' }, answer: { es: 'Sí, dentro de [días] días.', en: 'x', pt: 'x', fr: 'x' } },
                ],
            },
        };
        const out = lintRecipes({ registry: { fake } as any, resolve: () => fake as any });
        expect(out.errors.map((f) => f.rule)).toContain('question_escalates');
    });

    it('exige que un precio cero diga cuál de sus dos significados tiene', () => {
        const fake = {
            ...getVerticalDefinition('otro'),
            services: [{
                name: { es: 'Visita', en: 'Visit', pt: 'Visita', fr: 'Visite' },
                description: { es: 'x', en: 'x', pt: 'x', fr: 'x' },
                durationMinutes: 60, price: 0, currency: 'COP', category: 'x',
            }],
        };
        const out = lintRecipes({ registry: { fake } as any, resolve: () => fake as any });
        expect(out.errors.map((f) => f.rule)).toContain('zero_price_undeclared');
    });
});

/**
 * D17 (sep-2026): el monto de ejemplo en la moneda del negocio.
 */
describe('example amounts by country', () => {
    it('da monto en los seis países y espacio en blanco en el resto', () => {
        for (const country of RECIPE_EXAMPLE_AMOUNT_COUNTRIES) {
            const { amount, currency } = recipeExampleAmount(80_000, country);
            expect(amount).toBeGreaterThan(0);
            expect(currency).toMatch(/^[A-Z]{3}$/);
        }
        // Uruguay está en el alta pero no tiene montos: la fila nace sin número
        // y con su moneda, para que el dueño escriba el suyo sobre UYU.
        expect(recipeExampleAmount(80_000, 'UY')).toEqual({ amount: null, currency: null });
        expect(recipeSeedPrice(80_000, 'UY')).toEqual({ price: null, currency: 'UYU' });
    });

    it('no inventa una moneda cuando no sabe el país', () => {
        // La columna tiene DEFAULT 'COP': pasar null explícito es lo único que
        // impide que el peso colombiano vuelva a entrar por la puerta de atrás.
        expect(recipeSeedPrice(80_000, null)).toEqual({ price: null, currency: null });
        expect(recipeSeedPrice(80_000, '')).toEqual({ price: null, currency: null });
    });

    it('Colombia se queda con la referencia tal cual', () => {
        expect(recipeSeedPrice(80_000, 'CO')).toEqual({ price: 80_000, currency: 'COP' });
    });

    it('conserva el orden de los servicios de una receta en los seis países', () => {
        // Si un paquete cuesta más que otro en Colombia, tiene que costar más
        // en México: un ejemplo que invierte el orden convierte la lista del
        // dueño en algo que no puede confirmar de un vistazo.
        const references = [35_000, 50_000, 80_000, 120_000, 200_000, 350_000, 600_000, 1_200_000, 3_500_000];
        for (const country of RECIPE_EXAMPLE_AMOUNT_COUNTRIES) {
            const amounts = references.map((r) => recipeExampleAmount(r, country).amount as number);
            expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
        }
    });

    it('redondea a un número que una persona escribiría', () => {
        expect(roundToPlausibleStep(216_216)).toBe(220_000);
        expect(roundToPlausibleStep(1_234)).toBe(1_200);
        expect(roundToPlausibleStep(107)).toBe(110);
        expect(roundToPlausibleStep(31)).toBe(30);
        // Nunca cero: un ejemplo de cero se leería como "gratis", que es una
        // afirmación sobre el negocio y no un espacio vacío.
        expect(roundToPlausibleStep(0.4)).toBe(1);
        expect(roundToPlausibleStep(-5)).toBe(0);
    });

    it('acepta el país como venga del alta', () => {
        expect(recipeExampleAmount(80_000, ' mx ').currency).toBe('MXN');
        expect(recipeExampleAmount(80_000, 'br').currency).toBe('BRL');
    });

    it('trata la referencia cero como cero, no como "sin dato"', () => {
        // Cero significa "esta receta no puso monto"; qué significa eso lo dice
        // `priceStatus`, no el número.
        expect(recipeExampleAmount(0, 'MX')).toEqual({ amount: 0, currency: 'MXN' });
    });
});
