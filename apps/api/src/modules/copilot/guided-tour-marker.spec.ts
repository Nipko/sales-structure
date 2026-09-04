import {
    GuidedTourDefinition,
    canRoleRunGuidedTour,
    extractGuidedTourMarker,
    findGuidedTourForQualityCode,
    getGuidedTour,
    guidedToursForArticles,
} from '@parallext/shared';

/**
 * The copilot lets the model ASK for a guided tour with a bounded marker, and
 * then decides on the server whether that tour may run. These tests pin the
 * shared helpers exactly as `CopilotService.chat` uses them: an id the model
 * invents, or one outside the turn's allowlist, must never become an action —
 * and must never survive as literal text in the reply either.
 */

const allowed = (...ids: string[]): GuidedTourDefinition[] =>
    ids.map((id) => getGuidedTour(id)).filter((tour): tour is GuidedTourDefinition => !!tour);

describe('guided tour markers as used by Parallly Assist', () => {
    it('keeps the first allowed marker when the model emits several', () => {
        const result = extractGuidedTourMarker(
            'Primero acá [[tour:knowledge_base]] y después acá [[tour:connect_channel]].',
            allowed('connect_channel', 'knowledge_base'),
        );

        expect(result.tourId).toBe('knowledge_base');
    });

    it('removes every marker from the reply, allowed or not', () => {
        const result = extractGuidedTourMarker(
            'Uno [[tour:knowledge_base]] dos [[tour:connect_channel]] tres [[tour:delete_everything]].',
            allowed('knowledge_base'),
        );

        expect(result.text).not.toContain('[[tour:');
        expect(result.text).toBe('Uno  dos  tres .');
        expect(result.tourId).toBe('knowledge_base');
    });

    it('normalises the whitespace the removed marker leaves behind', () => {
        const result = extractGuidedTourMarker(
            'Se conecta en Canales. [[tour:connect_channel]]\n\n[[tour:connect_channel]]\n',
            allowed('connect_channel'),
        );

        expect(result.text).toBe('Se conecta en Canales.');
        expect(result.tourId).toBe('connect_channel');
    });

    it('ignores an id that is not in the registry', () => {
        const result = extractGuidedTourMarker(
            'Listo.\n[[tour:delete_everything]]',
            allowed('knowledge_base'),
        );

        expect(result.text).toBe('Listo.');
        expect(result.tourId).toBeNull();
    });

    it('ignores a registered id that is outside this turn\'s allowlist', () => {
        const result = extractGuidedTourMarker(
            'Listo.\n[[tour:connect_channel]]',
            allowed('knowledge_base'),
        );

        expect(result.text).toBe('Listo.');
        expect(result.tourId).toBeNull();
    });

    it('strips markers even when no tour is available this turn', () => {
        const result = extractGuidedTourMarker('Respuesta. [[tour:knowledge_base]]', []);

        expect(result.text).toBe('Respuesta.');
        expect(result.tourId).toBeNull();
    });

    it('resolves the tour for a quality signal in both code forms', () => {
        expect(findGuidedTourForQualityCode('fix_channel_connection')?.id).toBe('connect_channel');
        expect(findGuidedTourForQualityCode('channel_connection')?.id).toBe('connect_channel');
        expect(findGuidedTourForQualityCode('collect_production_evidence')?.id).toBe('agent_quality_center');
        expect(findGuidedTourForQualityCode('fix_nothing_at_all')).toBeNull();
    });

    it('gates an admin-only tour by the authenticated role', () => {
        const connectChannel = getGuidedTour('connect_channel')!;
        const qualityCenter = getGuidedTour('agent_quality_center')!;

        expect(canRoleRunGuidedTour(connectChannel, 'tenant_admin')).toBe(true);
        expect(canRoleRunGuidedTour(connectChannel, 'super_admin')).toBe(true);
        expect(canRoleRunGuidedTour(connectChannel, 'tenant_supervisor')).toBe(false);
        expect(canRoleRunGuidedTour(qualityCenter, 'tenant_supervisor')).toBe(true);
        expect(canRoleRunGuidedTour(qualityCenter, 'tenant_agent')).toBe(false);
    });

    it('builds the turn allowlist from the retrieved KB articles and the role', () => {
        expect(guidedToursForArticles(['base-conocimiento'], 'tenant_admin').map((tour) => tour.id))
            .toEqual(['knowledge_base']);
        expect(guidedToursForArticles(['base-conocimiento'], 'tenant_agent')).toEqual([]);
        expect(guidedToursForArticles(['facturacion-planes'], 'tenant_admin')).toEqual([]);
    });
});
