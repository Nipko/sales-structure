import {
    listSubtypeExperienceProfileIds,
    resolveVerticalCapabilityManifest,
    subtypeTerminologyFor,
    TERMINOLOGY_LANGUAGES,
} from '@parallext/shared';

/**
 * 15 de 76 perfiles declaran su propia terminología; los 61 restantes **heredan
 * la de su industria por decisión**. La decisión es razonable —una clínica
 * dental y una dermatológica dicen "paciente" igual— y nadie verificaba que
 * siguiera siéndolo.
 *
 * Verificar los 61 uno por uno necesita a alguien que conozca cada rubro. Lo
 * que SÍ se puede verificar sin un experto es la contradicción mecánica: **un
 * subtipo cuyo objeto primario difiere del de sus hermanos no puede heredar el
 * mismo sustantivo que ellos.**
 *
 * Esa regla encontró `technology/hardware`: el rubro entero habla como un SaaS
 * B2B —"solución", "deal", "demo"— y tres de sus cuatro subtipos venden
 * justamente eso. `hardware` vende **equipos**; su objeto primario es
 * `catalog_item`, no una cita. Llamarle "solución" a un switch y "deal" a una
 * venta de mostrador es el idioma de otro negocio.
 */

const PROFILES = listSubtypeExperienceProfileIds();

function manifestFor(id: string) {
    const [industry, subtype] = id.split('/');
    try {
        return resolveVerticalCapabilityManifest(
            industry, subtype === '__none__' ? undefined : subtype,
        );
    } catch {
        return null;
    }
}

describe('la herencia de terminología no puede ser ambigua', () => {
    it('ningún grupo de herederos mezcla objetos primarios distintos', () => {
        // Si dos subtipos de la misma industria heredan el MISMO sustantivo y
        // venden cosas distintas, uno de los dos está mal nombrado — y el
        // agente se lo dice así al cliente.
        const inherited: Record<string, Set<string>> = {};
        for (const id of PROFILES) {
            const [industry, subtype] = id.split('/');
            if (subtypeTerminologyFor(industry, subtype)) continue;
            const manifest = manifestFor(id);
            if (!manifest) continue;
            (inherited[industry] ??= new Set()).add(manifest.primaryObject);
        }
        const ambiguous = Object.entries(inherited)
            .filter(([, objects]) => objects.size > 1)
            .map(([industry, objects]) => `${industry}: ${[...objects].join(', ')}`);
        expect(ambiguous).toEqual([]);
    });

    it('un subtipo que vende otra cosa declara su propio vocabulario', () => {
        const hardware = subtypeTerminologyFor('technology', 'hardware');
        expect(hardware).toBeTruthy();
        expect(hardware!.primaryObject!.es).toBe('Equipo');
        // Y prohíbe explícitamente el idioma del que se separó.
        expect(hardware!.avoid).toEqual(expect.arrayContaining(['solución', 'deal']));
    });

    it('toda terminología propia está en los cuatro idiomas', () => {
        // Un sustantivo a medias es peor que ninguno: el agente cae al español
        // en una conversación en portugués y suena a error de sistema.
        for (const id of PROFILES) {
            const [industry, subtype] = id.split('/');
            const terminology = subtypeTerminologyFor(industry, subtype);
            if (!terminology) continue;
            for (const term of [
                terminology.primaryObject,
                terminology.primaryObjectPlural,
                terminology.customerNoun,
                terminology.transactionNoun,
            ]) {
                if (!term) continue;
                for (const language of TERMINOLOGY_LANGUAGES) {
                    expect(typeof term[language]).toBe('string');
                    expect(term[language].length).toBeGreaterThan(0);
                }
            }
        }
    });

    it('una avoid-list no prohíbe la palabra que el propio perfil usa', () => {
        // Prohibir el sustantivo propio dejaría al agente sin forma de nombrar
        // lo que el negocio vende.
        for (const id of PROFILES) {
            const [industry, subtype] = id.split('/');
            const terminology = subtypeTerminologyFor(industry, subtype);
            if (!terminology?.avoid?.length) continue;
            const own = [
                terminology.primaryObject?.es,
                terminology.primaryObjectPlural?.es,
                terminology.transactionNoun?.es,
            ].filter(Boolean).map(word => String(word).toLowerCase());
            for (const forbidden of terminology.avoid) {
                expect(own).not.toContain(forbidden.toLowerCase());
            }
        }
    });
});
