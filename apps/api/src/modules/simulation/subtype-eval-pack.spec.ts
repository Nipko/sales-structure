import {
    CARE_FIRST_INDUSTRIES,
    avoidedTermsFor,
    composeSubtypeEvalPack,
    listVerticalCapabilityConfigurations,
} from '@parallext/shared';

/**
 * El set dorado con el que se mide un agente antes de activarlo.
 *
 * Eran cuatro escenarios genéricos —saludo, precio, agendar, fuera de tema—
 * iguales para los 76 perfiles. Ninguno tocaba lo que de verdad puede salir
 * mal en cada rubro: que el agente abra una venta sobre un síntoma, que le
 * prometa una mesa a una cocina que no tiene salón, o que improvise sobre algo
 * que su perfil declara que NO hace.
 */
describe('subtype eval pack', () => {
    const keysOf = (input: Parameters<typeof composeSubtypeEvalPack>[0]) =>
        composeSubtypeEvalPack(input).map((scenario) => scenario.key);

    it('always keeps the four universal scenarios', () => {
        expect(keysOf({})).toEqual(['greeting', 'price_question', 'booking_intent', 'off_topic']);
    });

    it('adds a no-pitch scenario exactly where the rubro starts with a problem', () => {
        for (const industry of CARE_FIRST_INDUSTRIES) {
            expect(keysOf({ industry })).toContain('no_pitch_sensitive');
        }
        expect(keysOf({ industry: 'retail' })).not.toContain('no_pitch_sensitive');
        expect(keysOf({ industry: 'restaurantes' })).not.toContain('no_pitch_sensitive');
    });

    /**
     * La regla prohíbe ABRIR la venta, no responder lo que preguntan. Un
     * criterio que castigara responder un precio enseñaría a callar, que es
     * peor que vender de más.
     */
    it('states that answering a direct price question is still correct', () => {
        const scenario = composeSubtypeEvalPack({ industry: 'salud' })
            .find((s) => s.key === 'no_pitch_sensitive');
        expect(scenario?.messages).toHaveLength(2);
        expect(scenario?.criteria).toMatch(/prohíbe abrir la venta/i);
    });

    it('adds a vocabulary scenario only where the profile declares forbidden words', () => {
        const darkKitchen = composeSubtypeEvalPack({
            industry: 'restaurantes', subtype: 'dark_kitchen',
        }).find((s) => s.key === 'avoid_terms');
        expect(darkKitchen?.criteria).toContain('reserva de mesa');

        expect(keysOf({ industry: 'salud', subtype: 'dental' })).not.toContain('avoid_terms');
    });

    /** Cada palabra prohibida del perfil tiene que estar en el criterio. */
    it('names every forbidden word of the profile in its criteria', () => {
        const scenario = composeSubtypeEvalPack({
            industry: 'salud', subtype: 'farmacia',
        }).find((s) => s.key === 'avoid_terms');
        for (const word of avoidedTermsFor('salud', 'farmacia')) {
            expect(scenario?.criteria).toContain(word);
        }
    });

    it('turns a declared exclusion into a scenario the agent must decline', () => {
        const scenario = composeSubtypeEvalPack({
            industry: 'salud', subtype: 'farmacia',
        }).find((s) => s.key === 'declared_limit');
        expect(scenario).toBeDefined();
        expect(scenario?.criteria).toMatch(/NO hace/);
        expect(scenario?.criteria).toMatch(/derivar/);
    });

    it('does not invent scenarios for a profile the registry does not know', () => {
        expect(keysOf({ industry: 'salud', subtype: 'no_existe' }))
            .not.toContain('declared_limit');
    });

    /** El origen viaja con el escenario para que nadie lo borre por error. */
    it('says where each scenario came from', () => {
        const pack = composeSubtypeEvalPack({ industry: 'salud', subtype: 'farmacia' });
        expect(new Set(pack.map((s) => s.origin)))
            .toEqual(new Set(['universal', 'no_pitch', 'avoid_terms', 'declared_limit']));
    });

    /** Una clave repetida se pisaría sola en el `ON CONFLICT (key)` del seed. */
    it('never produces two scenarios with the same key, for any profile', () => {
        for (const manifest of listVerticalCapabilityConfigurations()) {
            const keys = keysOf({ industry: manifest.industry, subtype: manifest.subtype });
            expect(new Set(keys).size).toBe(keys.length);
            expect(keys.length).toBeGreaterThanOrEqual(4);
        }
    });

    it('gives every scenario a message and a criterion the judge can score', () => {
        for (const manifest of listVerticalCapabilityConfigurations()) {
            for (const scenario of composeSubtypeEvalPack({
                industry: manifest.industry, subtype: manifest.subtype,
            })) {
                expect(scenario.messages.length).toBeGreaterThan(0);
                expect(scenario.messages.every((m) => m.trim().length > 0)).toBe(true);
                expect(scenario.criteria.trim().length).toBeGreaterThan(20);
            }
        }
    });
});
