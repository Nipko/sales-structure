import {
    VERTICAL_CAPABILITY_MANIFEST,
    resolveVerticalCapabilityManifest,
} from '@parallext/shared';
import { getVerticalDefinition } from './vertical-definitions';
import { resolveVerticalAgendaSeedContract } from './verticals.service';
import { READINESS } from './vertical-readiness.service';

/**
 * Fotografía nace con paquetes.
 *
 * La industria declara `bookingEnabled: false` porque un fotógrafo de bodas no
 * vende franjas de 30 minutos — y ese mismo flag apagaba el sembrado de
 * SERVICIOS, que es donde viven los paquetes. El estudio arrancaba con la
 * tabla vacía, `list_photo_packages` devolvía cero y el agente le decía al
 * cliente que no hay nada que ofrecer, mientras la definición de la vertical
 * declaraba tres paquetes que nunca se escribían.
 */
describe('photography packages bootstrap', () => {
    const definition = getVerticalDefinition('fotografia');
    const REAL_PHOTOGRAPHY = ['estudio', 'bodas', 'eventos', 'producto'] as const;

    it.each(REAL_PHOTOGRAPHY)('seeds packages for %s without turning on the agenda', (subtype) => {
        const contract = resolveVerticalAgendaSeedContract(definition, subtype);
        expect(contract.serviceCatalogAllowed).toBe(true);
        expect(contract.agendaAllowed).toBe(false);
        expect(contract.services.length).toBeGreaterThan(0);
    });

    it('gives each subtype its own packages instead of the industry average', () => {
        const bySubtype = new Map(REAL_PHOTOGRAPHY.map((subtype) => [
            subtype,
            resolveVerticalAgendaSeedContract(definition, subtype)
                .services.map((service) => service.name.es).join('|'),
        ]));
        // Un fotógrafo de bodas que recibe "Producto e-commerce" lo borra el
        // día 1; el preset sólo vale si el nombre corresponde al rubro.
        expect(new Set(bySubtype.values()).size).toBe(REAL_PHOTOGRAPHY.length);
        expect(bySubtype.get('bodas')).not.toContain('Producto e-commerce');
        expect(bySubtype.get('producto')).not.toContain('Boda completa');
    });

    it('every seeded package carries the four languages, a price and a duration', () => {
        for (const subtype of REAL_PHOTOGRAPHY) {
            for (const service of resolveVerticalAgendaSeedContract(definition, subtype).services) {
                for (const lang of ['es', 'en', 'pt', 'fr'] as const) {
                    expect(service.name[lang]).toBeTruthy();
                    expect(service.description?.[lang]).toBeTruthy();
                }
                expect(service.durationMinutes).toBeGreaterThan(0);
                expect(service.price).toBeGreaterThan(0);
                expect(service.currency).toBe('COP');
            }
        }
    });

    /**
     * `wedding_planner` organiza bodas; no las fotografía. Sembrarle sesiones
     * de fotos sería confirmarle una promesa falsa. Sin paquetes queda con
     * readiness incumplido, que es la verdad hasta que se separe a su propia
     * experiencia.
     */
    it('does not hand photography packages to the misclassified wedding planner', () => {
        const contract = resolveVerticalAgendaSeedContract(definition, 'wedding_planner');
        expect(contract.services).toEqual(definition.services);
        expect(contract.serviceCatalogAllowed).toBe(false);
    });
});

describe('service catalogue route for agenda-less verticals', () => {
    /**
     * El CTA de readiness apuntaba a `/admin/appointments/config`, una pantalla
     * que estos tenants no tienen en el menú: el consejo era correcto y el
     * destino inalcanzable.
     */
    it('points every service-catalogue readiness key at a route these tenants can open', () => {
        for (const key of ['photo_sessions', 'boarding_capacity'] as const) {
            expect(READINESS[key]?.repairRoute).toBe('/admin/service-catalog');
        }
    });

    it.each([
        ['fotografia', 'estudio'],
        ['fotografia', 'bodas'],
        ['fotografia', 'eventos'],
        ['fotografia', 'producto'],
        ['pet_services', 'guarderia'],
        ['pet_services', 'hotel'],
    ])('publishes the catalogue route for %s/%s', (industry, subtype) => {
        const manifest = resolveVerticalCapabilityManifest(industry, subtype);
        expect(manifest.routes).toContain('/admin/service-catalog');
        // Y sigue SIN Agenda: el catálogo es la alternativa, no la puerta de vuelta.
        expect(manifest.routes).not.toContain('/admin/appointments');
    });

    /** Quien sí tiene Agenda no necesita una segunda pantalla para lo mismo. */
    it('does not duplicate the catalogue for verticals that already have the agenda', () => {
        for (const subtype of VERTICAL_CAPABILITY_MANIFEST.salud.subtypes) {
            const manifest = resolveVerticalCapabilityManifest('salud', subtype);
            if (!manifest.routes.includes('/admin/appointments')) continue;
            expect(manifest.routes).not.toContain('/admin/service-catalog');
        }
    });
});
