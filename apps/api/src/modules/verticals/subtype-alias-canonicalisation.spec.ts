import {
    SUBTYPE_ALIASES,
    avoidedTermsFor,
    canonicalSubtypeId,
    composeSubtypeEvalPack,
    isAliasedSubtype,
    listSubtypeExperienceProfileIds,
    resolveSubtypeExperienceProfile,
    subtypeTerminologyFor,
} from '@parallext/shared';

/*
 * `require` y no `import`: el script es un `.js` CommonJS que tiene que
 * correr con `node` pelado dentro del contenedor, sin pasar por el build de
 * TypeScript. Importarlo como módulo ES lo ataría al build y dejaría de poder
 * invocarse en producción, que es su único motivo de existir.
 *
 * La regla que el proyecto aplica es `no-require-imports`; el `disable` decía
 * `no-var-requires` —el nombre viejo de la regla— así que no silenciaba nada
 * y el lint del deploy cayó. Se nombran las dos: los dos nombres conviven
 * según la versión del plugin.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const migration = require('../../../scripts/migrate-subtype-aliases.js');

/**
 * ═══ EL ALIAS SE APLICABA EN UN SOLO LUGAR ═══
 *
 * `SUBTYPE_ALIASES` existía y lo leía **únicamente**
 * `resolveSubtypeExperienceProfile`. La terminología, la lista de términos a
 * evitar y el paquete de evaluación hacían una búsqueda cruda contra el id
 * guardado.
 *
 * Para un tenant guardado como `veterinaria/peluqueria_canina`: su perfil
 * resuelve a `pet_services/peluqueria` —peluquería canina, no clínica— y su
 * vocabulario se busca bajo el id viejo, que no existe. **Media identidad en
 * cada lado**, sin ningún error: el agente opera como peluquería y habla como
 * veterinaria.
 *
 * Un alias que sólo conoce un resolutor no es un alias: es una excepción que un
 * consumidor recuerda y los demás no.
 */

const ALIASED = Object.keys(SUBTYPE_ALIASES);

describe('un id viejo lleva al mismo lugar por todos los caminos', () => {
    it('hay aliases que revisar', () => {
        expect(ALIASED.length).toBeGreaterThan(0);
    });

    it.each(ALIASED)('%s resuelve igual en perfil, terminología y evals', (aliasId) => {
        const [industry, subtype] = aliasId.split('/');
        const target = SUBTYPE_ALIASES[aliasId];
        const [canonIndustry, canonSubtype] = target.split('/');

        // (1) El perfil ya lo hacía.
        const profile = resolveSubtypeExperienceProfile(industry, subtype);
        expect(profile.id).toBe(target);

        // (2) La terminología no: buscaba el id viejo y no encontraba nada.
        expect(subtypeTerminologyFor(industry, subtype))
            .toEqual(subtypeTerminologyFor(canonIndustry, canonSubtype));

        // (3) La lista de términos a evitar, igual.
        expect(avoidedTermsFor(industry, subtype))
            .toEqual(avoidedTermsFor(canonIndustry, canonSubtype));
    });

    it.each(ALIASED)('%s compone el mismo paquete de evaluación', (aliasId) => {
        const [industry, subtype] = aliasId.split('/');
        const [canonIndustry, canonSubtype] = SUBTYPE_ALIASES[aliasId].split('/');

        // `avoidedTermsFor` recibía el id crudo mientras `safeProfile` recibía
        // el aliasado: el tenant medía el vocabulario de un perfil y la
        // conducta de otro.
        const viaAlias = composeSubtypeEvalPack({ industry, subtype, language: 'es' });
        const viaCanonical = composeSubtypeEvalPack({
            industry: canonIndustry, subtype: canonSubtype, language: 'es',
        });
        expect(viaAlias).toEqual(viaCanonical);
    });
});

describe('el canonizador', () => {
    it('deja pasar sin tocar lo que ya es canónico', () => {
        for (const id of listSubtypeExperienceProfileIds().slice(0, 12)) {
            const [industry, subtype] = id.split('/');
            expect(canonicalSubtypeId(industry, subtype)).toEqual({ industry, subtype });
        }
    });

    it('traduce lo aliasado', () => {
        expect(canonicalSubtypeId('veterinaria', 'peluqueria_canina'))
            .toEqual({ industry: 'pet_services', subtype: 'peluqueria' });
    });

    it('sin industria no hay nada que canonizar', () => {
        expect(canonicalSubtypeId(null, 'peluqueria')).toBeNull();
        expect(canonicalSubtypeId('', 'peluqueria')).toBeNull();
    });

    it('una industria sin subtipo se canoniza contra `__none__`', () => {
        // `otro` no tiene subtipos: sin este caso, la clave de búsqueda quedaba
        // `otro/` y nunca coincidía con nada.
        expect(canonicalSubtypeId('otro', null)).toEqual({ industry: 'otro', subtype: '' });
    });

    it('`isAliasedSubtype` reconoce exactamente los de la tabla', () => {
        expect(isAliasedSubtype('veterinaria', 'peluqueria_canina')).toBe(true);
        expect(isAliasedSubtype('pet_services', 'peluqueria')).toBe(false);
        expect(isAliasedSubtype('rubro', 'inventado')).toBe(false);
    });
});

describe('la migración de lo guardado', () => {
    it('reconoce el mismo conjunto que el runtime', () => {
        // El script no puede importar el resolutor entero, así que lee la
        // tabla. Esto verifica que lea LA tabla y no una copia.
        for (const aliasId of ALIASED) {
            const [industry, subtype] = aliasId.split('/');
            expect({ aliasId, target: migration.aliasFor(industry, subtype) })
                .toEqual({ aliasId, target: SUBTYPE_ALIASES[aliasId] });
        }
    });

    it('no marca lo que ya es canónico', () => {
        expect(migration.aliasFor('pet_services', 'peluqueria')).toBeNull();
        expect(migration.aliasFor(null, 'peluqueria')).toBeNull();
        expect(migration.aliasFor('veterinaria', null)).toBeNull();
    });
});

describe('un alias nunca apunta a un perfil que no existe', () => {
    it.each(ALIASED)('%s apunta a un perfil del registro', (aliasId) => {
        // Un alias hacia un id inexistente convierte la clasificación vieja en
        // un error duro: `resolveSubtypeExperienceProfile` tira, y el turno
        // entero cae con "Unknown subtype experience profile".
        const target = SUBTYPE_ALIASES[aliasId];
        expect(listSubtypeExperienceProfileIds()).toContain(target);
    });

    it('ningún alias apunta a otro alias', () => {
        // Una cadena de aliases resolvería a medias: el canonizador da un solo
        // salto, a propósito — dos saltos abren la puerta a un ciclo.
        for (const target of Object.values(SUBTYPE_ALIASES)) {
            expect({ target, isAlias: ALIASED.includes(target) })
                .toEqual({ target, isAlias: false });
        }
    });
});
