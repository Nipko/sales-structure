import { getVerticalDefinition, VERTICAL_REGISTRY } from './vertical-definitions';
import {
    InvalidVerticalSelectionError,
    resolveVerticalSelection,
    VERTICAL_IDENTIFIER_CONTRACT_VERSION,
} from './vertical-identifiers';
import { SUBTYPE_ALIASES, listBlockedSubtypeProfiles, subtypeAvailability } from '@parallext/shared';

describe('resolveVerticalSelection', () => {
    it('publishes a versioned identifier contract', () => {
        expect(VERTICAL_IDENTIFIER_CONTRACT_VERSION).toBe(3);
    });

    it('accepts every canonical industry/subtype pair in the registry', () => {
        for (const [industry, definition] of Object.entries(VERTICAL_REGISTRY)) {
            if (definition.subTypes.length === 0) {
                expect(resolveVerticalSelection(industry)).toEqual({ industry, subType: null });
                continue;
            }

            for (const subType of definition.subTypes) {
                const target = SUBTYPE_ALIASES[`${industry}/${subType.key}`];
                const [expectedIndustry, expectedSubType] = target
                    ? target.split('/')
                    : [industry, subType.key];
                expect(resolveVerticalSelection(industry, subType.key)).toEqual({
                    industry: expectedIndustry,
                    subType: expectedSubType,
                });
            }
        }
    });

    it.each([
        ['educacion', 'idiomas', 'education'],
        ['restaurante', 'cafeteria', 'restaurantes'],
        ['belleza', 'spa', 'moda_belleza'],
        ['hogar', 'plomeria', 'servicios_hogar'],
        ['servicios-mascotas', 'hotel', 'pet_services'],
        ['ecommerce', 'marketplace', 'retail'],
        ['tecnologia', 'saas', 'technology'],
        ['other', undefined, 'otro'],
    ])('canonicalizes %s/%s to %s', (input, subType, expectedIndustry) => {
        expect(resolveVerticalSelection(input, subType)).toEqual({
            industry: expectedIndustry,
            subType: subType ?? null,
        });
    });

    it('maps the legacy finanzas/seguros pair to the complete insurance vertical', () => {
        expect(resolveVerticalSelection('finanzas', 'seguros')).toEqual({
            industry: 'seguros',
            subType: 'broker',
        });
    });

    it.each(Object.entries(SUBTYPE_ALIASES))(
        'canoniza el alias de subtipo %s a %s en cada superficie',
        (source, target) => {
            const [industry, subType] = source.split('/');
            const [canonicalIndustry, canonicalSubType] = target.split('/');
            for (const surface of ['signup', 'admin_create', 'existing'] as const) {
                expect(resolveVerticalSelection(industry, subType, surface)).toEqual({
                    industry: canonicalIndustry,
                    subType: canonicalSubType,
                });
            }
        },
    );

    it.each([
        ['', undefined],
        ['inventada', 'algo'],
        ['otro', 'general'],
        ['salud', undefined],
    ])('rejects an invalid pair (%s/%s)', (industry, subType) => {
        expect(() => resolveVerticalSelection(industry, subType))
            .toThrow(InvalidVerticalSelectionError);
    });

    it('never silently falls back to the generic vertical', () => {
        expect(() => getVerticalDefinition('inventada'))
            .toThrow('Unknown vertical definition: inventada');
    });
});

/**
 * Filtrar el `<select>` esconde la opción; no la cierra.
 *
 * `industry` y `subType` son strings libres en el DTO del alta, así que sin una
 * puerta del lado del servidor un POST directo sigue creando un tenant sobre un
 * perfil que no se puede entregar. Y la puerta tiene que ser POR SUPERFICIE: el
 * tenant que ya está adentro debe poder guardar su propio perfil sin que nadie
 * se lo migre en silencio.
 */
describe('disponibilidad por superficie', () => {
    const blocked = listBlockedSubtypeProfiles();

    it('hay perfiles cerrados que probar', () => {
        expect(blocked.length).toBeGreaterThan(0);
    });

    it.each(blocked.map(p => [`${p.industry}/${p.subtype}`, p] as const))(
        '%s se rechaza en un alta self-service',
        (_id, profile) => {
            expect(() => resolveVerticalSelection(profile.industry, profile.subtype, 'signup'))
                .toThrow(InvalidVerticalSelectionError);
        },
    );

    it.each(blocked.map(p => [`${p.industry}/${p.subtype}`, p] as const))(
        '%s se rechaza también para un super_admin',
        (_id, profile) => {
            // Cerrado es cerrado: `pilot` es la puerta del super_admin, no ésta.
            expect(() => resolveVerticalSelection(profile.industry, profile.subtype, 'admin_create'))
                .toThrow(InvalidVerticalSelectionError);
        },
    );

    it.each(blocked.map(p => [`${p.industry}/${p.subtype}`, p] as const))(
        '%s sigue resolviendo para el tenant que ya lo tiene',
        (_id, profile) => {
            // Esto es lo que hace que cerrar la puerta no rompa a nadie.
            expect(resolveVerticalSelection(profile.industry, profile.subtype)).toEqual({
                industry: profile.industry,
                subType: profile.subtype,
            });
            expect(resolveVerticalSelection(profile.industry, profile.subtype, 'existing')).toEqual({
                industry: profile.industry,
                subType: profile.subtype,
            });
        },
    );

    it('un perfil ofrecido se acepta en las tres superficies', () => {
        for (const surface of ['signup', 'admin_create', 'existing'] as const) {
            expect(resolveVerticalSelection('restaurantes', 'comida_rapida', surface)).toEqual({
                industry: 'restaurantes', subType: 'comida_rapida',
            });
        }
    });

    it.each([
        ['finanzas', 'pagos_recaudos'],
        ['retail', 'marketplace'],
        ['event_planning', 'weddings'],
        ['inmobiliaria', 'promotora'],
        ['construccion', 'contratista_general'],
        ['technology', 'soporte_ti_msp'],
        ['seguros', 'aseguradora'],
        ['seguros', 'salud'],
    ])('%s/%s existe pero no puede entrar antes de su gate', (industry, subType) => {
        expect(() => resolveVerticalSelection(industry, subType, 'signup'))
            .toThrow(InvalidVerticalSelectionError);
        expect(() => resolveVerticalSelection(industry, subType, 'admin_create'))
            .toThrow(InvalidVerticalSelectionError);
        expect(resolveVerticalSelection(industry, subType, 'existing'))
            .toEqual({ industry, subType });
    });

    it('un perfil `stop` nuevo queda cerrado sin que nadie lo anote', () => {
        // La disponibilidad se DERIVA de la estrategia cuando no se declara.
        // Anotar las siete a mano habría dejado la puerta abierta a la octava.
        expect(subtypeAvailability({ strategy: 'stop' })).toBe('legacy_only');
        expect(subtypeAvailability({ strategy: 'build' })).toBe('selectable');
        // Y lo declarado gana: `migrate` es vendible, `pilot` es por invitación.
        expect(subtypeAvailability({ strategy: 'build', availability: 'pilot' })).toBe('pilot');
        expect(subtypeAvailability({ strategy: 'stop', availability: 'waitlist' })).toBe('waitlist');
        expect(subtypeAvailability({
            strategy: 'build', availability: 'selectable', catalogStatus: 'legacy',
        })).toBe('legacy_only');
    });
});
