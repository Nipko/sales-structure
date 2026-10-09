import {
    listVerticalCapabilityCompatibilityConfigurations,
    listVerticalCapabilityConfigurations,
    resolveVerticalCapabilityManifest,
} from '@parallext/shared';
import { planVerticalToolSeed, requiredToolFamilies } from './vertical-tool-seed-plan';
import { resolveSubtypeBootstrap, VerticalsService } from './verticals.service';

/**
 * Contrato: las familias de herramientas que el alta deja encendidas en el
 * agente son exactamente las que el manifiesto de capacidades le da al tipo de
 * negocio. Antes el alta llevaba su propia tabla y `automotriz/alquiler`
 * (`vehicleRentals`) y `pet_services/guarderia|hotel` (`petBoarding`) nacían sin
 * la familia que reserva su objeto principal.
 */

const KEY = (c: { industry: string; subtype: string | null }) => `${c.industry}/${c.subtype ?? '-'}`;

function build(): any {
    const service: any = new VerticalsService({} as any, {} as any, {} as any);
    jest.spyOn(service, 'seedToursExtras').mockResolvedValue(undefined);
    jest.spyOn(service, 'seedDentalExtras').mockResolvedValue(undefined);
    jest.spyOn(service, 'seedInmobiliariaExtras').mockResolvedValue(undefined);
    jest.spyOn(service, 'seedMembershipPlans').mockResolvedValue(undefined);
    return service;
}

describe('vertical tool seed plan', () => {
    const selectable = listVerticalCapabilityConfigurations();
    const everything = listVerticalCapabilityCompatibilityConfigurations();

    it('iterates the whole catalogue, legacy subtypes included, so a new type cannot skip the contract', () => {
        // The catalogue is the source of truth; this only guards against the
        // iteration below silently running over an empty or truncated list.
        expect(selectable.length).toBeGreaterThanOrEqual(72);
        expect(everything.length).toBeGreaterThanOrEqual(selectable.length);
    });

    it.each([
        ['automotriz', 'alquiler', 'vehicleRentals'],
        ['pet_services', 'guarderia', 'petBoarding'],
        ['pet_services', 'hotel', 'petBoarding'],
    ])('enables the %s/%s booking family %s at signup', async (industry, subType, family) => {
        const service = build();
        const enabled = jest.spyOn(service, 'enableSimpleTool').mockResolvedValue(undefined);
        jest.spyOn(service, 'disableSimpleTool').mockResolvedValue(undefined);

        await service.seedVerticalTools(
            't', 'schema', industry, subType, 'es', resolveSubtypeBootstrap(industry, subType),
        );

        expect(enabled.mock.calls.map((call) => call[1])).toContain(family);
        expect(service.requiredTools(industry, subType, false, resolveSubtypeBootstrap(industry, subType)))
            .toContain(family);
    });

    it.each(everything.map((c) => [KEY(c), c.industry, c.subtype] as const))(
        '%s: enabled families equal the manifest tool groups',
        async (_key, industry, subType) => {
            const manifest = resolveVerticalCapabilityManifest(industry, subType);
            const bootstrap = resolveSubtypeBootstrap(industry, subType ?? undefined);
            const service = build();
            const enabled = jest.spyOn(service, 'enableSimpleTool').mockResolvedValue(undefined);
            const disabled = jest.spyOn(service, 'disableSimpleTool').mockResolvedValue(undefined);

            await service.seedVerticalTools('t', 'schema', industry, subType, 'es', bootstrap);

            const seeded = enabled.mock.calls.map((call) => call[1] as string);
            // Siempre las enciende otro paso: el de conocimiento (faqs) y el de
            // agenda (appointments, solo si la agenda quedó sembrada).
            const expected = new Set<string>(manifest.toolGroups);
            expected.delete('faqs');
            expected.delete('appointments');

            expect([...new Set(seeded)].sort()).toEqual([...expected].sort());
            // Nada que el subtipo no opere puede quedar encendido a la vez.
            for (const call of disabled.mock.calls) expect(manifest.toolGroups).not.toContain(call[1]);

            const booking = manifest.capabilities.includes('appointment_booking');
            const required = service.requiredTools(industry, subType, booking, bootstrap) as string[];
            const wanted = new Set<string>([...expected, 'faqs']);
            if (booking) wanted.add('appointments');
            expect([...new Set(required)].sort()).toEqual([...wanted].sort());
        },
    );

    it('derives the plan from the manifest alone, plus the subtype extras', () => {
        const plan = planVerticalToolSeed(
            { industry: 'otro', toolGroups: ['faqs', 'appointments', 'catalog'] },
            ['treatments'],
        );
        expect(plan.enable.sort()).toEqual(['catalog', 'treatments']);
        expect(plan.disable).toEqual([]);
        expect(requiredToolFamilies({ industry: 'otro', toolGroups: ['faqs', 'catalog'] }, true))
            .toEqual(expect.arrayContaining(['faqs', 'appointments', 'catalog']));
    });

    it('turns off inherited vehicle inventory for automotive subtypes that do not operate it', () => {
        const parts = resolveVerticalCapabilityManifest('automotriz', 'repuestos');
        const workshop = resolveVerticalCapabilityManifest('automotriz', 'taller');
        const dealer = resolveVerticalCapabilityManifest('automotriz', 'concesionario');
        expect(planVerticalToolSeed(parts).disable).toEqual(['vehicles']);
        expect(planVerticalToolSeed(workshop).disable).toEqual(['vehicles']);
        expect(planVerticalToolSeed(dealer).disable).toEqual([]);
    });
});
