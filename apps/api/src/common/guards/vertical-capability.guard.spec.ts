import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    VERTICAL_MANIFEST_INDUSTRIES,
    listVerticalCapabilityCompatibilityConfigurations,
    type VerticalCapability,
} from '@parallext/shared';
import { REQUIRE_VERTICAL_CAPABILITY_KEY } from '../decorators/require-vertical-capability.decorator';
import {
    VerticalCapabilityGuard,
    decideVerticalCapabilityAccess,
    industriesWithCapability,
} from './vertical-capability.guard';
import { RestaurantsController } from '../../modules/restaurants/restaurants.controller';
import { GymsController } from '../../modules/gyms/gyms.controller';
import { ToursController } from '../../modules/tours/tours.controller';
import { VacationRentalController } from '../../modules/vacation-rental/vacation-rental.controller';
import { EducationController } from '../../modules/education/education.controller';
import { InsuranceController } from '../../modules/insurance/insurance.controller';
import { TreatmentPlansController } from '../../modules/treatment-plans/treatment-plans.controller';
import { RepairOrdersController } from '../../modules/repair-orders/repair-orders.controller';
import { HomeServicesController } from '../../modules/home-services/home-services.controller';
import { PhotographyController } from '../../modules/photography/photography.controller';
import { ListingsController } from '../../modules/listings/listings.controller';
import { PetsController } from '../../modules/pets/pets.controller';
import { ResourceRentalsController } from '../../modules/resource-rentals/resource-rentals.controller';
import { VehicleInventoryController } from '../../modules/verticals/vehicle-inventory.controller';

/**
 * Same capability sets the dashboard uses to decide whether a vertical's page
 * is visible (CAPABILITY_ITEMS in vertical-dashboard-resolver.ts). If a
 * controller drifts from this table, a tenant that sees the page would get a
 * 403 from its API, or a tenant that must not reach it would pass.
 */
const GUARDED: Array<[string, Function, VerticalCapability[]]> = [
    ['restaurants', RestaurantsController, ['restaurant_ordering']],
    ['gyms', GymsController, ['membership_management']],
    ['tours', ToursController, ['tour_booking']],
    ['vacation-rental', VacationRentalController, ['nightly_booking']],
    ['education', EducationController, ['course_enrollment']],
    ['insurance', InsuranceController, ['insurance_operations']],
    ['treatment-plans', TreatmentPlansController, ['treatment_management']],
    ['repair-orders', RepairOrdersController, ['repair_orders']],
    ['home-services', HomeServicesController, ['service_requests']],
    ['photography', PhotographyController, ['photo_sessions']],
    ['listings', ListingsController, ['real_estate_listings']],
    ['pets', PetsController, ['pet_records', 'pet_services']],
    ['resource-rentals', ResourceRentalsController, ['vehicle_rentals', 'pet_boarding']],
    ['vehicles', VehicleInventoryController, ['vehicle_inventory']],
];

describe('vertical endpoints check the tenant industry server-side', () => {
    it.each(GUARDED)('%s declares its capability and runs the guard', (_name, controller, capabilities) => {
        expect(Reflect.getMetadata(REQUIRE_VERTICAL_CAPABILITY_KEY, controller)).toEqual(capabilities);
        const guards: Function[] = Reflect.getMetadata('__guards__', controller) ?? [];
        expect(guards).toContain(VerticalCapabilityGuard);
    });

    it('never denies a tenant whose own configuration (any canonical or legacy subtype) has the surface', () => {
        const denied: string[] = [];
        for (const configuration of listVerticalCapabilityCompatibilityConfigurations()) {
            for (const [name, , capabilities] of GUARDED) {
                if (!capabilities.some((c) => configuration.capabilities.includes(c))) continue;
                const decision = decideVerticalCapabilityAccess({
                    tenantIndustry: configuration.industry,
                    settings: { verticalConfig: { industry: configuration.industry, subType: configuration.subtype } },
                    required: capabilities,
                });
                if (!decision.allowed) denied.push(`${configuration.industry}/${configuration.subtype} -> ${name}`);
            }
        }
        expect(denied).toEqual([]);
    });

    it('denies a tenant of an industry that has none of the capabilities', () => {
        const cases: Array<[string, string]> = [
            ['salud', 'restaurants'],
            ['restaurantes', 'repair-orders'],
            ['turismo', 'vehicles'],
            ['inmobiliaria', 'gyms'],
            ['gimnasios', 'listings'],
            ['otro', 'photography'],
        ];
        for (const [industry, name] of cases) {
            const capabilities = GUARDED.find(([n]) => n === name)![2];
            expect(industriesWithCapability(capabilities[0]).has(industry)).toBe(false);
            expect(decideVerticalCapabilityAccess({ tenantIndustry: industry, settings: {}, required: capabilities }))
                .toEqual({ allowed: false, reason: 'industry_lacks_capability', industry });
        }
    });

    it('allows the owning industry, reads legacy aliases, and prefers the published verticalConfig', () => {
        expect(decideVerticalCapabilityAccess({
            tenantIndustry: 'restaurantes', settings: {}, required: ['restaurant_ordering'],
        }).allowed).toBe(true);
        // Legacy identifier stored in tenants.industry.
        expect(decideVerticalCapabilityAccess({
            tenantIndustry: 'real_estate', settings: {}, required: ['real_estate_listings'],
        }).allowed).toBe(true);
        // verticalConfig is what navigation uses: a stale tenants.industry must not win over it.
        expect(decideVerticalCapabilityAccess({
            tenantIndustry: 'restaurantes',
            settings: { verticalConfig: { industry: 'salud' } },
            required: ['restaurant_ordering'],
        }).allowed).toBe(false);
    });

    it('keeps the pre-existing behaviour for an industry string no vertical recognises', () => {
        expect(decideVerticalCapabilityAccess({
            tenantIndustry: 'algo_viejo', settings: null, required: ['repair_orders'],
        })).toEqual({ allowed: true, reason: 'industry_unresolved' });
    });

    it('honours capabilities a generic tenant explicitly published', () => {
        expect(decideVerticalCapabilityAccess({
            tenantIndustry: 'otro',
            settings: { verticalConfig: { industry: 'otro', effectiveCapabilities: ['crm_pipeline', 'photo_sessions'] } },
            required: ['photo_sessions'],
        })).toEqual({ allowed: true, reason: 'declared_effective_capability' });
    });

    it('covers every canonical industry in the manifest without throwing', () => {
        for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
            expect(() => decideVerticalCapabilityAccess({
                tenantIndustry: industry, settings: {}, required: ['repair_orders'],
            })).not.toThrow();
        }
    });

    describe('guard', () => {
        function run(opts: { role?: string; industry?: string; required?: VerticalCapability[] | undefined; noTenantRow?: boolean }) {
            const prisma = {
                tenant: {
                    findUnique: jest.fn().mockResolvedValue(
                        opts.noTenantRow ? null : { industry: opts.industry ?? 'salud', settings: {} },
                    ),
                },
            };
            const reflector = new Reflector();
            jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(opts.required);
            const guard = new VerticalCapabilityGuard(reflector, prisma as any);
            const context: any = {
                getType: () => 'http',
                getHandler: () => undefined,
                getClass: () => undefined,
                switchToHttp: () => ({
                    getRequest: () => ({
                        user: { role: opts.role ?? 'tenant_admin', tenantId: 't1' },
                        tenantId: 't1',
                        params: { tenantId: 't1' },
                    }),
                }),
            };
            return { guard, context, prisma };
        }

        it('answers 403 vertical_not_available for a cross-industry call', async () => {
            const { guard, context } = run({ industry: 'salud', required: ['restaurant_ordering'] });
            await expect(guard.canActivate(context)).rejects.toMatchObject({
                constructor: ForbiddenException,
                response: expect.objectContaining({ error: 'vertical_not_available', industry: 'salud' }),
            });
        });

        it('passes the right industry, super_admin, undecorated routes and a missing tenant row', async () => {
            const own = run({ industry: 'restaurantes', required: ['restaurant_ordering'] });
            await expect(own.guard.canActivate(own.context)).resolves.toBe(true);

            const root = run({ role: 'super_admin', industry: 'salud', required: ['restaurant_ordering'] });
            await expect(root.guard.canActivate(root.context)).resolves.toBe(true);
            expect(root.prisma.tenant.findUnique).not.toHaveBeenCalled();

            const open = run({ industry: 'salud', required: undefined });
            await expect(open.guard.canActivate(open.context)).resolves.toBe(true);

            const gone = run({ required: ['restaurant_ordering'], noTenantRow: true });
            await expect(gone.guard.canActivate(gone.context)).resolves.toBe(true);
        });
    });
});
