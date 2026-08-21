import {
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
    listVerticalCapabilityConfigurations,
    resolveVerticalCapabilityManifest,
} from '@parallext/shared';
import {
    resolveVerticalWorkspace,
    resolveVerticalWorkspaces,
    type VerticalWorkspaceInput,
} from '../verticalWorkspace';

/**
 * El teléfono mostraba menos negocio que la pantalla grande.
 *
 * La app resolvía UN espacio operativo: la primera capacidad de la lista
 * ganaba y el resto desaparecía. Un gimnasio veía las clases y perdía la
 * agenda; una escuela de idiomas veía las inscripciones y perdía las citas de
 * admisión; un restaurante con salón veía los pedidos y perdía las reservas de
 * mesa. Once perfiles declaran más de una operación y en el teléfono se veía
 * una sola.
 */
describe('resolveVerticalWorkspaces', () => {
    const withCapabilities = (industry: string, subtype: string | null): VerticalWorkspaceInput => {
        const manifest = resolveVerticalCapabilityManifest(industry, subtype);
        return {
            industry,
            subType: subtype,
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            effectiveCapabilities: manifest.capabilities,
        };
    };

    it('keeps the first workspace identical to what a single-workspace caller got', () => {
        for (const manifest of listVerticalCapabilityConfigurations()) {
            const input = withCapabilities(manifest.industry, manifest.subtype);
            expect(resolveVerticalWorkspaces(input)[0])
                .toEqual(resolveVerticalWorkspace(input));
        }
    });

    /**
     * Un gimnasio vende membresías Y agenda clases. La app resolvía `classes` y
     * el dueño no llegaba a las membresías desde el teléfono.
     */
    it('shows a gym both its classes and its appointments', () => {
        expect(resolveVerticalWorkspaces(withCapabilities('gimnasios', 'crossfit'))
            .map((workspace) => workspace.kind))
            .toEqual(['classes', 'appointments']);
    });

    it('shows a school both its enrolments and its appointments', () => {
        expect(resolveVerticalWorkspaces(withCapabilities('education', 'idiomas'))
            .map((workspace) => workspace.kind))
            .toEqual(['education', 'appointments']);
    });

    it('shows a casual restaurant its orders and its table bookings', () => {
        expect(resolveVerticalWorkspaces(withCapabilities('restaurantes', 'casual_dining'))
            .map((workspace) => workspace.kind))
            .toEqual(['restaurant', 'appointments']);
    });

    /**
     * Un solo objeto sigue siendo un solo espacio: no se inventan pestañas.
     * Una guardería de mascotas PIERDE la agenda a propósito en el manifiesto,
     * así que su única operación es la estadía.
     */
    it('leaves a single-object profile with a single workspace', () => {
        expect(resolveVerticalWorkspaces(withCapabilities('retail', 'moda')).map((w) => w.kind))
            .toEqual(['orders']);
        expect(resolveVerticalWorkspaces(withCapabilities('pet_services', 'guarderia')).map((w) => w.kind))
            .toEqual(['pet_boarding']);
        expect(resolveVerticalWorkspaces(withCapabilities('automotriz', 'alquiler')).map((w) => w.kind))
            .toEqual(['vehicle_rentals']);
    });

    it('never repeats a workspace, for any of the canonical profiles', () => {
        for (const manifest of listVerticalCapabilityConfigurations()) {
            const kinds = resolveVerticalWorkspaces(
                withCapabilities(manifest.industry, manifest.subtype),
            ).map((workspace) => workspace.kind);
            expect(new Set(kinds).size).toBe(kinds.length);
            expect(kinds.length).toBeGreaterThan(0);
        }
    });

    /**
     * Paridad con la web: cada capacidad operativa que el manifiesto declara
     * tiene su espacio en el teléfono. Si alguien agrega una capacidad y olvida
     * el mapeo, el negocio queda invisible en móvil y nadie se entera.
     */
    it('gives every operational capability of every profile a mobile workspace', () => {
        const OPERATIONAL = new Set([
            'nightly_booking', 'tour_booking', 'restaurant_ordering', 'course_enrollment',
            'membership_management', 'insurance_operations', 'service_requests',
            'photo_sessions', 'vehicle_rentals', 'pet_boarding', 'catalog_search',
            'appointment_booking',
        ]);
        for (const manifest of listVerticalCapabilityConfigurations()) {
            const operational = manifest.capabilities.filter((c) => OPERATIONAL.has(c));
            if (!operational.length) continue;
            const kinds = resolveVerticalWorkspaces(
                withCapabilities(manifest.industry, manifest.subtype),
            ).map((workspace) => workspace.kind);
            expect(`${manifest.industry}/${manifest.subtype}:${kinds.length}`)
                .toBe(`${manifest.industry}/${manifest.subtype}:${operational.length}`);
        }
    });

    /** Las mismas vallas que el resolutor singular: nada se abre por accidente. */
    it('publishes nothing when the profile publishes nothing', () => {
        expect(resolveVerticalWorkspaces({
            industry: 'salud',
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            effectiveCapabilities: [],
        }).map((w) => w.kind)).toEqual(['none']);
    });

    /**
     * Una configuración v1 conserva exactamente el espacio que tenía: sumarle
     * pestañas sería cambiarle la app a un tenant que no reconcilió.
     */
    it('leaves a legacy configuration with the single workspace it already had', () => {
        const legacy: VerticalWorkspaceInput = {
            industry: 'turismo',
            subType: 'hotel',
            manifestVersion: 1,
        };
        expect(resolveVerticalWorkspaces(legacy)).toEqual([resolveVerticalWorkspace(legacy)]);
        expect(resolveVerticalWorkspaces(legacy)).toHaveLength(1);
    });
});
