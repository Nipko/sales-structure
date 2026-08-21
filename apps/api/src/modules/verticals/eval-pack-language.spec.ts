import {
    EVAL_LANGUAGES,
    RIOPLATENSE_MARKERS,
    composeSubtypeEvalPack,
    listSubtypeExperienceProfileIds,
    localizedPhrase,
    phrase,
    rioplatenseMarkersIn,
    type EvalLanguageCode,
} from '@parallext/shared';

/**
 * ═══ EL SET DORADO ESTABA EN ESPAÑOL EN LOS CUATRO IDIOMAS ═══
 *
 * `composeSubtypeEvalPack` acepta un idioma y devolvía, para todos:
 *
 * - Los cuatro escenarios universales con `language: 'es'` **fijo**, mensajes y
 *   criterio en español, en cualquier paquete.
 * - Los de no-pitch, vocabulario y límite declarado **estampados** con el idioma
 *   pedido y escritos en español. Peor que los universales: dicen estar en
 *   inglés y no lo están.
 *
 * Medir un agente en portugués con un cliente simulado que escribe en español y
 * un criterio en español no mide al agente: mide si entiende español. Y el
 * punto 16 —correr los golden evals en ES/EN/PT/FR— no se puede cumplir
 * mientras el paquete sea el mismo en los cuatro.
 *
 * ═══ Y EL ESPAÑOL ERA UNO SOLO, EN VOSEO ═══
 *
 * `¿Qué opinás de la política?`, `¿me ayudás con lo que ofrecen?`, `resolvelo
 * vos`, `Che, ¿ustedes hacen X?`. La plataforma **ya sabe** la forma de trato de
 * cada país y el set dorado no la miraba: un tenant colombiano —cuyo agente
 * habla de `usted`— medía contra un cliente simulado rioplatense.
 */

const PROFILES = listSubtypeExperienceProfileIds();
/** Una muestra ancha y estable: los 76 × 4 idiomas es lento y no agrega señal. */
const SAMPLE = PROFILES.filter((_, index) => index % 6 === 0);

describe('el paquete se compone en el idioma que dice hablar', () => {
    it.each(EVAL_LANGUAGES)('en %s, ningún escenario se estampa con otro idioma', (language) => {
        for (const id of SAMPLE) {
            const [industry, subtype] = id.split('/');
            const pack = composeSubtypeEvalPack({
                industry, subtype: subtype === '__none__' ? null : subtype, language,
            });
            expect(pack.length).toBeGreaterThan(0);
            const wrong = pack.filter(s => s.language !== language).map(s => s.key);
            expect({ profile: id, wrong }).toEqual({ profile: id, wrong: [] });
        }
    });

    it('el saludo cambia de verdad entre idiomas', () => {
        // Estampar el idioma correcto y devolver el mismo texto sería la misma
        // mentira con otra forma.
        const greeting = (language: EvalLanguageCode) => composeSubtypeEvalPack({
            industry: 'moda_belleza', subtype: 'barberia', language,
        }).find(s => s.key === 'greeting')!.messages[0];

        const seen = EVAL_LANGUAGES.map(l => greeting(l));
        expect(new Set(seen).size).toBe(EVAL_LANGUAGES.length);
    });

    it('el criterio también, no sólo el mensaje', () => {
        // El criterio es lo que lee el juez. Un criterio en español evaluando
        // una conversación en francés mide otra cosa.
        const criteria = (language: EvalLanguageCode) => composeSubtypeEvalPack({
            industry: 'salud', subtype: 'dental', language,
        }).find(s => s.key === 'no_pitch_sensitive')!.criteria;

        expect(new Set(EVAL_LANGUAGES.map(criteria)).size).toBe(EVAL_LANGUAGES.length);
    });

    it('un idioma que no medimos cae al español en vez de romper', () => {
        const pack = composeSubtypeEvalPack({
            industry: 'salud', subtype: 'dental', language: 'de',
        });
        expect(pack.every(s => s.language === 'es')).toBe(true);
    });
});

describe('el español respeta la forma de trato del país', () => {
    it('sin país declarado, ningún escenario habla rioplatense', () => {
        // Es el default y cubre quince de los dieciocho países del mapa.
        const offenders: string[] = [];
        for (const id of SAMPLE) {
            const [industry, subtype] = id.split('/');
            const pack = composeSubtypeEvalPack({
                industry, subtype: subtype === '__none__' ? null : subtype, language: 'es',
            });
            for (const scenario of pack) {
                for (const text of [scenario.title, scenario.criteria, ...scenario.messages]) {
                    for (const marker of rioplatenseMarkersIn(text)) {
                        offenders.push(`${id}/${scenario.key}:${marker}`);
                    }
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('con `vos` declarado, el cliente simulado sí lo usa', () => {
        // La capacidad no se borró: se puso donde corresponde. Un tenant
        // argentino debe medirse contra un cliente que habla como su cliente.
        const pack = composeSubtypeEvalPack({
            industry: 'moda_belleza', subtype: 'barberia',
            language: 'es', addressForm: 'vos',
        });
        const offTopic = pack.find(s => s.key === 'off_topic')!;
        expect(offTopic.messages[0]).toContain('opinás');
    });

    it('con `tu` declarado, tampoco habla de vos', () => {
        const pack = composeSubtypeEvalPack({
            industry: 'moda_belleza', subtype: 'barberia',
            language: 'es', addressForm: 'tu',
        });
        const offTopic = pack.find(s => s.key === 'off_topic')!;
        expect(offTopic.messages[0]).toContain('opinas');
        expect(rioplatenseMarkersIn(offTopic.messages[0])).toEqual([]);
    });

    it('la forma de trato no toca los otros tres idiomas', () => {
        for (const language of ['en', 'pt', 'fr'] as EvalLanguageCode[]) {
            const neutral = composeSubtypeEvalPack({
                industry: 'moda_belleza', subtype: 'barberia', language,
            });
            const vos = composeSubtypeEvalPack({
                industry: 'moda_belleza', subtype: 'barberia', language, addressForm: 'vos',
            });
            expect(neutral.map(s => s.messages)).toEqual(vos.map(s => s.messages));
        }
    });
});

describe('el detector de rioplatense', () => {
    it('reconoce las formas verbales, no palabras de cualquier registro', () => {
        expect(rioplatenseMarkersIn('¿Me podés ayudar?')).toEqual(['podés']);
        // "Dale" solo es común en medio continente; sólo se marca la muletilla.
        expect(rioplatenseMarkersIn('Dale, gracias')).toEqual([]);
        expect(rioplatenseMarkersIn('¿Me puede ayudar?')).toEqual([]);
        expect(rioplatenseMarkersIn(null)).toEqual([]);
    });

    it('la lista no está vacía: un detector vacío pasa todo en verde', () => {
        expect(RIOPLATENSE_MARKERS.length).toBeGreaterThan(10);
    });
});

describe('el resolutor de frase', () => {
    const value = phrase('usted puede', 'you can', 'você pode', 'vous pouvez',
        { esVos: 'podés', esTu: 'puedes' });

    it('sin forma de trato devuelve el neutro', () => {
        expect(localizedPhrase(value, 'es')).toBe('usted puede');
        expect(localizedPhrase(value, 'es', null)).toBe('usted puede');
    });

    it('con forma de trato devuelve la suya', () => {
        expect(localizedPhrase(value, 'es', 'vos')).toBe('podés');
        expect(localizedPhrase(value, 'es', 'tu')).toBe('puedes');
        expect(localizedPhrase(value, 'es', 'usted')).toBe('usted puede');
    });

    it('una frase que no se conjuga no necesita variantes', () => {
        // Duplicarla sólo agregaría un lugar donde desincronizar.
        const flat = phrase('¿Cuánto cuesta?', 'How much?', 'Quanto custa?', 'Combien ?');
        expect(localizedPhrase(flat, 'es', 'vos')).toBe('¿Cuánto cuesta?');
    });

    it('los otros idiomas ignoran la forma de trato', () => {
        expect(localizedPhrase(value, 'pt', 'vos')).toBe('você pode');
        expect(localizedPhrase(value, 'fr', 'vos')).toBe('vous pouvez');
    });
});
