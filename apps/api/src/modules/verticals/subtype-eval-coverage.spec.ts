import {
    composeSubtypeEvalPack,
    deriveSubtypeScenarios,
    EVAL_LANGUAGES,
    listSubtypeExperienceProfileIds,
    MIN_SCENARIOS_PER_PROFILE,
    type EvalLanguage,
} from '@parallext/shared';

/**
 * Cinco escenarios no miden un agente: miden que arranca.
 *
 * El set dorado eran cuatro universales más, con suerte, tres derivados. Lo que
 * de verdad sale mal —pedir un dato que ya tiene, dar por hecha una reserva que
 * la tool rechazó, tratar una duda como una confirmación, prometer una
 * capacidad que el perfil no tiene— no estaba cubierto en **ningún** perfil.
 *
 * Escribir 25 × 76 × 4 escenarios a mano son 7.600 oportunidades de medir una
 * expectativa que nadie escribió. Se derivan de hechos ya declarados, y esta
 * prueba fija tanto el piso de cobertura como la regla que lo hace honesto.
 */

const PROFILES = listSubtypeExperienceProfileIds();

describe('cada perfil llega al piso de cobertura, en los cuatro idiomas', () => {
    it.each(EVAL_LANGUAGES.map(language => [language] as const))(
        'en %s ningún perfil baja del mínimo',
        (language: EvalLanguage) => {
            const short: string[] = [];
            for (const id of PROFILES) {
                const [industry, subtype] = id.split('/');
                const pack = composeSubtypeEvalPack({ industry, subtype, language });
                if (pack.length < MIN_SCENARIOS_PER_PROFILE) {
                    short.push(`${id}: ${pack.length}`);
                }
            }
            expect(short).toEqual([]);
        },
    );

    it('los cuatro idiomas cubren lo mismo: ninguno queda a medias', () => {
        // Un idioma con menos escenarios es un mercado peor medido, y eso no se
        // nota hasta que un cliente escribe en portugués.
        for (const id of PROFILES) {
            const [industry, subtype] = id.split('/');
            const counts = EVAL_LANGUAGES.map(language =>
                composeSubtypeEvalPack({ industry, subtype, language }).length);
            expect(new Set(counts).size).toBe(1);
        }
    });

    it('cada escenario viaja en el idioma que se le pidió', () => {
        for (const language of EVAL_LANGUAGES) {
            const pack = composeSubtypeEvalPack({
                industry: 'restaurantes', subtype: 'comida_rapida', language,
            });
            const derived = pack.filter(s => s.key.startsWith('intent_')
                || s.key.startsWith('profile_')
                || s.key.startsWith('missing_capability_'));
            expect(derived.length).toBeGreaterThan(0);
            for (const scenario of derived) expect(scenario.language).toBe(language);
        }
    });
});

describe('los escenarios salen de hechos declarados', () => {
    it('un perfil que el registro no conoce no recibe ninguno', () => {
        // Medir contra una expectativa inexistente es peor que no medir.
        expect(deriveSubtypeScenarios('salud', 'no_existe_2026', 'es')).toEqual([]);
    });

    it('cada término prohibido tiene su propio escenario', () => {
        // La lista entera en un solo escenario mide la primera palabra y deja
        // las otras sin probar.
        const pack = composeSubtypeEvalPack({
            industry: 'pet_services', subtype: 'peluqueria', language: 'es',
        });
        const avoidScenarios = pack.filter(s => s.key.startsWith('avoid_'));
        expect(avoidScenarios.length).toBeGreaterThan(0);
        expect(new Set(avoidScenarios.map(s => s.key)).size).toBe(avoidScenarios.length);
    });

    it('cada exclusión declarada tiene su propio escenario', () => {
        const pack = composeSubtypeEvalPack({
            industry: 'seguros', subtype: 'broker', language: 'es',
        });
        expect(pack.filter(s => s.key.startsWith('limit_')).length).toBeGreaterThan(0);
    });

    it('un perfil bloqueado se prueba contra intentar cerrar una operación', () => {
        const pack = composeSubtypeEvalPack({
            industry: 'seguros', subtype: 'aseguradora', language: 'es',
        });
        const blocked = pack.find(s => s.key === 'profile_blocked');
        expect(blocked).toBeDefined();
        // Y el criterio prohíbe explícitamente nombrar el motivo interno.
        expect(blocked!.criteria).toMatch(/sin nombrar motivos internos/);
    });

    it('sólo se prueba la capacidad que el perfil NO tiene', () => {
        // Preguntar por lo que sí tiene ya lo cubren los escenarios de intención.
        const pack = composeSubtypeEvalPack({
            industry: 'restaurantes', subtype: 'comida_rapida', language: 'es',
        });
        const missing = pack.filter(s => s.key.startsWith('missing_capability_'));
        expect(missing.length).toBeGreaterThan(0);
        // Una comida rápida SÍ toma pedidos: probarla contra eso mediría una
        // ausencia que no existe.
        expect(missing.some(s => s.key.includes('restaurant_ordering'))).toBe(false);
        // Y sí se la prueba contra lo que de verdad no tiene.
        expect(missing.some(s => s.key.includes('insurance_operations'))).toBe(true);
    });
});

describe('las fallas que se prueban son las que importan', () => {
    const pack = composeSubtypeEvalPack({
        industry: 'salud', subtype: 'dental', language: 'es',
    });

    it.each([
        ['no da por hecho lo que la tool rechazó', 'tool_failed'],
        ['una duda no es una confirmación', 'unconfirmed'],
        ['no inventa el dato que falta', 'missing_slot'],
        ['no vuelve a pedir lo que ya sabe', 'repeat_request'],
    ])('%s', (_case, probe) => {
        expect(pack.some(s => s.key.includes(probe))).toBe(true);
    });

    it('sólo las intenciones que comprometen se prueban contra la falla de la tool', () => {
        // Un escenario de "la reserva falló" sobre una búsqueda de FAQs mide
        // una falla que no existe.
        const failed = pack.filter(s => s.key.endsWith('_tool_failed'));
        expect(failed.length).toBeGreaterThan(0);
        expect(failed.every(s => !s.key.includes('ask_question'))).toBe(true);
    });

    it('el escenario de suplantación está en todo perfil', () => {
        for (const id of PROFILES) {
            const [industry, subtype] = id.split('/');
            const profilePack = composeSubtypeEvalPack({ industry, subtype, language: 'es' });
            expect(profilePack.some(s => s.key === 'profile_identity_impersonation')).toBe(true);
        }
    });

    it('el escenario de conversión de moneda está en todo perfil', () => {
        // Es la misma regla que el contrato del agente ya tiene: convertir un
        // importe sin tipo de cambio es inventarlo.
        for (const id of PROFILES) {
            const [industry, subtype] = id.split('/');
            const profilePack = composeSubtypeEvalPack({ industry, subtype, language: 'es' });
            expect(profilePack.some(s => s.key === 'profile_currency_conversion')).toBe(true);
        }
    });

    it('ningún escenario derivado pisa uno escrito a mano', () => {
        for (const id of PROFILES) {
            const [industry, subtype] = id.split('/');
            const profilePack = composeSubtypeEvalPack({ industry, subtype, language: 'es' });
            const keys = profilePack.map(s => s.key);
            expect(new Set(keys).size).toBe(keys.length);
        }
    });
});
