import {
    listVerticalCapabilityConfigurations,
    resolveVerticalCapabilityManifest,
} from '@parallext/shared';
import { getVerticalDefinition } from './vertical-definitions';
import { resolveVerticalPipelineStages } from './vertical-pipeline-contract';

const ruleTypes = (industry: string, subType?: string) =>
    resolveVerticalPipelineStages(getVerticalDefinition(industry), subType)
        .flatMap((stage) => (stage.transitionRules || []).map((rule: any) => rule.type));

describe('vertical pipeline contract by subtype', () => {
    it.each([
        ['turismo', 'agencia_viajes'],
        ['turismo', 'tours'],
    ])('%s/%s requires a tour booking, never a generic appointment', (industry, subType) => {
        expect(ruleTypes(industry, subType)).toContain('tour_booking_required');
        expect(ruleTypes(industry, subType)).not.toContain('appointment_required');
    });

    it.each([
        ['turismo', 'hotel'],
        ['turismo', 'alquiler_vacacional'],
    ])('%s/%s requires a property booking, never a generic appointment', (industry, subType) => {
        expect(ruleTypes(industry, subType)).toContain('property_booking_required');
        expect(ruleTypes(industry, subType)).not.toContain('appointment_required');
    });

    it.each([
        ['restaurantes', 'comida_rapida'],
        ['restaurantes', 'dark_kitchen'],
        ['restaurantes', 'delivery'],
    ])('%s/%s requires a food order, never a generic commerce order', (industry, subType) => {
        expect(ruleTypes(industry, subType)).toContain('food_order_required');
        expect(ruleTypes(industry, subType)).not.toContain('order_required');
        expect(ruleTypes(industry, subType)).not.toContain('appointment_required');
    });

    it.each([
        'estudio',
        'bodas',
        'eventos',
        'producto',
        'wedding_planner',
    ])('fotografia/%s requires a scheduled native photo session', (subType) => {
        expect(ruleTypes('fotografia', subType)).toContain('photo_session_scheduled_required');
        expect(ruleTypes('fotografia', subType)).not.toContain('appointment_required');
    });

    it('also resolves legacy fotografia tenants without a subtype', () => {
        expect(ruleTypes('fotografia')).toContain('photo_session_scheduled_required');
        expect(ruleTypes('fotografia')).not.toContain('appointment_required');
    });

    it.each(['guarderia', 'hotel'])(
        'pet_services/%s requires a native pet boarding reservation',
        (subType) => {
            expect(ruleTypes('pet_services', subType)).toContain('pet_boarding_required');
            expect(ruleTypes('pet_services', subType)).not.toContain('appointment_required');
        },
    );

    it('uses native commerce and rental evidence for automotive specializations', () => {
        expect(ruleTypes('automotriz', 'repuestos')).toContain('order_required');
        expect(ruleTypes('automotriz', 'repuestos')).not.toContain('appointment_required');

        expect(ruleTypes('automotriz', 'alquiler')).toContain('vehicle_rental_required');
        expect(ruleTypes('automotriz', 'alquiler')).not.toContain('appointment_required');
    });

    it('uses generic commerce evidence for technology hardware sales', () => {
        expect(ruleTypes('technology', 'hardware')).toContain('order_required');
        expect(ruleTypes('technology', 'hardware')).not.toContain('appointment_required');
    });

    it.each([
        ['salud', 'farmacia'],
        ['moda_belleza', 'boutique'],
    ])('%s/%s does not retain an impossible appointment gate', (industry, subType) => {
        expect(ruleTypes(industry, subType)).not.toContain('appointment_required');
    });

    it('keeps generic appointment rules only where the manifest exposes appointments', () => {
        const configurations = [
            ['salud', 'dental'],
            ['moda_belleza', 'salon_belleza'],
            ['restaurantes', 'casual_dining'],
            ['restaurantes', 'cafeteria'],
            ['automotriz', 'concesionario'],
            ['automotriz', 'taller'],
            ['pet_services', 'peluqueria'],
            ['pet_services', 'paseos'],
            ['pet_services', 'adiestramiento'],
        ] as const;
        for (const [industry, subType] of configurations) {
            expect(resolveVerticalCapabilityManifest(industry, subType).capabilities)
                .toContain('appointment_booking');
            expect(ruleTypes(industry, subType)).toContain('appointment_required');
        }
    });

    it('never leaves appointment_required on any canonical subtype without appointment capability', () => {
        for (const manifest of listVerticalCapabilityConfigurations()) {
            if (manifest.capabilities.includes('appointment_booking')) continue;
            expect(ruleTypes(manifest.industry, manifest.subtype || ''))
                .not.toContain('appointment_required');
        }
    });
});
