import { VerticalsService } from './verticals.service';
import { getVerticalDefinition } from './vertical-definitions';
import { VERTICAL_DOMAIN_CONTRACT_VERSION } from '@parallext/shared';

function service() {
    return new VerticalsService({} as any, {} as any, {} as any);
}

function config(industry: string, subType: string) {
    const definition = getVerticalDefinition(industry);
    return {
        industry, subType,
        terminology: definition.terminology,
        sidebar: definition.sidebar,
        dashboard: definition.dashboard,
        bookingEnabled: false,
    };
}

describe('subtype-aware navigation config', () => {
    it('keeps the pets register named after the pets for a groomer, not after what it sells', () => {
        for (const [industry, subType] of [['pet_services', 'peluqueria'], ['veterinaria', 'peluqueria_canina']] as const) {
            const resolved = (service() as any).withSubtypeNavigation(config(industry, subType));
            expect(resolved.sidebar.itemOrder).toContain('pets');
            expect(resolved.sidebar.labelOverrides.pets?.es).not.toBe('Servicios');
            expect(resolved.sidebar.labelOverrides.pets?.es ?? 'Mascotas').toBe('Mascotas');
        }
    });

    it('keeps the photo sessions register out of the packages catalogue name for wedding photography', () => {
        const resolved = (service() as any).withSubtypeNavigation(config('fotografia', 'bodas'));
        expect(resolved.sidebar.itemOrder).toContain('photoSessions');
        expect(resolved.sidebar.labelOverrides.photoSessions?.es).not.toBe('Paquetes');
        expect(resolved.sidebar.labelOverrides.photoSessions?.es ?? 'Sesiones').toBe('Sesiones');
    });

    it('still renames the primary register for subtypes that were not excluded', () => {
        const resolved = (service() as any).withSubtypeNavigation(config('turismo', 'hotel'));
        expect(resolved.sidebar.labelOverrides.properties.es).toBe('Habitaciones');
    });

    it('puts the hotel booking register before its catalogue without renaming the register as rooms', () => {
        const base = config('turismo', 'hotel');
        base.sidebar.labelOverrides.stays = {
            es: 'Reservas', en: 'Stays', pt: 'Reservas', fr: 'Séjours',
        };
        const resolved = (service() as any).withSubtypeNavigation(base);
        expect(resolved.sidebar.itemOrder.slice(0, 2)).toEqual(['stays', 'properties']);
        expect(resolved.sidebar.labelOverrides.stays).toEqual({
            es: 'Reservas', en: 'Stays', pt: 'Reservas', fr: 'Séjours',
        });
        expect(resolved.sidebar.labelOverrides.properties).toEqual({
            es: 'Habitaciones', en: 'Rooms', pt: 'Quartos', fr: 'Chambres',
        });
        expect(resolved.sidebar.labelOverrides.stays)
            .not.toEqual(resolved.sidebar.labelOverrides.properties);
    });

    it('uses the rental subtype vocabulary independently from hotel', () => {
        const base = config('turismo', 'alquiler_vacacional');
        base.sidebar.labelOverrides.stays = {
            es: 'Reservas', en: 'Stays', pt: 'Reservas', fr: 'Séjours',
        };
        const resolved = (service() as any).withSubtypeNavigation(base);
        expect(resolved.sidebar.itemOrder.slice(0, 2)).toEqual(['stays', 'properties']);
        expect(resolved.sidebar.labelOverrides.stays.es).toBe('Reservas');
        expect(resolved.sidebar.labelOverrides.properties).toEqual({
            es: 'Alojamientos', en: 'Rentals', pt: 'Acomodações', fr: 'Logements',
        });
        expect(resolved.sidebar.labelOverrides.stays.es).not.toBe('Alojamientos');
    });

    it('puts rental operations before fleet inventory and keeps both labels distinct', () => {
        const base = config('automotriz', 'alquiler');
        base.sidebar.labelOverrides.resourceRentals = {
            es: 'Alquileres', en: 'Rentals', pt: 'Aluguéis', fr: 'Locations',
        };
        const resolved = (service() as any).withSubtypeNavigation(base);
        expect(resolved.sidebar.itemOrder.slice(0, 2)).toEqual(['resourceRentals', 'vehicles']);
        expect(resolved.sidebar.labelOverrides.resourceRentals).toEqual({
            es: 'Reservas', en: 'Reservations', pt: 'Reservas', fr: 'Réservations',
        });
        expect(resolved.sidebar.labelOverrides.vehicles).toEqual({
            es: 'Flota', en: 'Fleet', pt: 'Frota', fr: 'Flotte',
        });
        expect(resolved.sidebar.labelOverrides.resourceRentals.es).not.toBe('Flota');
    });

    it('publishes the workshop register and never disguises dealership inventory as work orders', () => {
        const base = config('automotriz', 'taller');
        const resolved = (service() as any).withSubtypeNavigation(base);
        expect(resolved.sidebar.itemOrder[0]).toBe('repairOrders');
        expect(resolved.sidebar.itemOrder).not.toContain('vehicles');
        expect(resolved.sidebar.labelOverrides.repairOrders).toEqual({
            es: 'Órdenes de trabajo', en: 'Work orders',
            pt: 'Ordens de serviço', fr: 'Ordres de travail',
        });
    });

    it('exposes the same domain contract and subtype navigation in the effective profile', async () => {
        const subject = service();
        jest.spyOn(subject, 'getVerticalConfig').mockResolvedValue(
            (subject as any).withSubtypeNavigation(config('turismo', 'hotel')),
        );
        const profile = await subject.getEffectiveProfile('tenant-id') as any;
        expect(profile.domainContract).toMatchObject({
            contractVersion: VERTICAL_DOMAIN_CONTRACT_VERSION,
            profileId: 'turismo/hotel',
        });
        expect(profile.navigation.sidebar.itemOrder.slice(0, 2)).toEqual(['stays', 'properties']);
        expect(profile.navigation.sidebar.labelOverrides.properties.es).toBe('Habitaciones');
        expect(profile.authoring).toMatchObject({
            version: 1,
            requestedProfileId: 'turismo/hotel',
            profileId: 'turismo/hotel',
            governance: { stage: 'mechanically_complete' },
        });
    });

    // Review of 2026-10-08: the salon's menu said "turnos" (derived lowercase
    // regionalism) and its sales pipeline page was titled "Citas".
    it('names the appointments entry "citas" for beauty and for any appointment-first profile', () => {
        for (const [industry, subType] of [['moda_belleza', 'salon_belleza'], ['salud', 'dental']] as const) {
            const base = config(industry, subType);
            const resolved = (service() as any).withSubtypeNavigation(base);
            expect(resolved.sidebar.labelOverrides.appointments.es).toBe('citas');
            expect(JSON.stringify(resolved.sidebar.labelOverrides.appointments)).not.toMatch(/turno/i);
        }
    });

    it('never gives the sales pipeline the appointments word', () => {
        const beauty = getVerticalDefinition('moda_belleza');
        expect(beauty.terminology.pipelineNoun.es).not.toMatch(/cita/i);
        expect(beauty.sidebar.labelOverrides.pipeline.es).not.toMatch(/cita/i);
    });
});
