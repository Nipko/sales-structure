import { VERTICAL_REGISTRY } from './vertical-definitions';
import {
    selectQuotaAwareVerticalDefaults,
    VerticalsService,
    VERTICAL_PROVISIONING_VERSION,
} from './verticals.service';
import { resolveVerticalSelection } from './vertical-identifiers';
import {
    SUBTYPE_ALIASES,
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
    listVerticalCapabilityConfigurations,
} from '@parallext/shared';
import { resolveVerticalSubtypePersonaContract } from '../persona/vertical-subtype-persona-contract';

describe('selectQuotaAwareVerticalDefaults', () => {
    const plans = {
        emprendedor: { pipelineStages: 7, appointmentServices: 4 },
        starter: { pipelineStages: 7, appointmentServices: 4 },
        pro: { pipelineStages: 15, appointmentServices: -1 },
        enterprise: { pipelineStages: -1, appointmentServices: -1 },
        custom: { pipelineStages: -1, appointmentServices: -1 },
    };

    it('keeps all 20 vertical defaults within every real plan quota', () => {
        expect(Object.keys(VERTICAL_REGISTRY)).toHaveLength(20);
        for (const [industry, definition] of Object.entries(VERTICAL_REGISTRY)) {
            for (const [plan, limits] of Object.entries(plans)) {
                const selected = selectQuotaAwareVerticalDefaults(
                    definition,
                    definition.services,
                    limits,
                );
                if (limits.pipelineStages !== -1) {
                    expect(
                        selected.pipelineStages.length,
                    ).toBeLessThanOrEqual(limits.pipelineStages);
                }
                if (limits.appointmentServices !== -1) {
                    expect(
                        selected.services.length,
                    ).toBeLessThanOrEqual(limits.appointmentServices);
                }
                expect(selected.pipelineStages.length).toBeGreaterThan(0);
                expect(selected.pipelineStages).toHaveLength(definition.pipeline.stages.length);

                const won = definition.pipeline.stages.find(
                    (stage) => stage.isTerminal && stage.terminalOutcome === 'won',
                );
                const lost = definition.pipeline.stages.find(
                    (stage) => stage.isTerminal && stage.terminalOutcome === 'lost',
                );
                if (won) expect(selected.pipelineStages.map((stage) => stage.slug)).toContain(won.slug);
                if (lost) expect(selected.pipelineStages.map((stage) => stage.slug)).toContain(lost.slug);
                expect(`${industry}/${plan}`).toBeTruthy();
            }
        }
    });

    it('resolves quota-safe defaults for all 75 subtype pairs plus the subtype-less other vertical', () => {
        const configurations: Array<{
            industry: string;
            subType: string | null;
            definition: (typeof VERTICAL_REGISTRY)[string];
        }> = [];
        for (const manifest of listVerticalCapabilityConfigurations()) {
            configurations.push({
                industry: manifest.industry,
                subType: manifest.subtype,
                definition: VERTICAL_REGISTRY[manifest.industry],
            });
        }

        expect(configurations).toHaveLength(76);
        expect(configurations.filter(({ subType }) => subType !== null)).toHaveLength(75);
        expect(configurations).toContainEqual(expect.objectContaining({ industry: 'otro', subType: null }));

        for (const configuration of configurations) {
            const target = configuration.subType
                ? SUBTYPE_ALIASES[`${configuration.industry}/${configuration.subType}`]
                : undefined;
            const [expectedIndustry, expectedSubType] = target
                ? target.split('/')
                : [configuration.industry, configuration.subType];
            expect(resolveVerticalSelection(configuration.industry, configuration.subType)).toEqual({
                industry: expectedIndustry,
                subType: expectedSubType,
            });
            for (const [plan, limits] of Object.entries(plans)) {
                const selected = selectQuotaAwareVerticalDefaults(
                    configuration.definition,
                    configuration.definition.services,
                    limits,
                );
                expect(selected.pipelineStages).toHaveLength(configuration.definition.pipeline.stages.length);
                if (limits.appointmentServices !== -1) {
                    expect(selected.services.length).toBeLessThanOrEqual(limits.appointmentServices);
                }
                expect(`${configuration.industry}/${configuration.subType ?? 'none'}/${plan}`).toBeTruthy();
            }
        }
    });

    it('reserves quota for custom content and refuses an already-over-limit tenant', () => {
        const definition = VERTICAL_REGISTRY.inmobiliaria;
        const selected = selectQuotaAwareVerticalDefaults(
            definition,
            definition.services,
            { pipelineStages: 8, appointmentServices: 2 },
            { stageSlugs: ['custom_stage'], serviceNames: ['Servicio propio'] },
        );
        expect(selected.pipelineStages).toHaveLength(7);
        expect(selected.services).toHaveLength(1);
        expect(selected.pipelineStages.length + 1).toBe(8);
        expect(selected.services.length + 1).toBe(2);

        expect(() => selectQuotaAwareVerticalDefaults(
            definition,
            definition.services,
            { pipelineStages: 3, appointmentServices: 2 },
        )).toThrow(/below canonical minimum/);
    });
});

describe('VerticalsService resumable bootstrap', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const ownerId = '22222222-2222-4222-8222-222222222222';
    const schemaName = 'tenant_vertical_test';

    let prisma: any;
    let redis: any;
    let throttle: any;
    let service: VerticalsService;
    let settings: any;
    let seedPipelineStages: jest.SpyInstance;
    let patchDefaultAgent: jest.SpyInstance;
    let seedFaqs: jest.SpyInstance;
    let seedServices: jest.SpyInstance;
    let assertInvariants: jest.SpyInstance;

    beforeEach(() => {
        settings = {};
        prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue(schemaName),
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: jest.fn(async (schema: string, callback: any) => callback(
                async (sql: string, params?: any[]) => {
                    if (sql.includes('SELECT id FROM pipelines')) {
                        return [{ id: '33333333-3333-4333-8333-333333333333' }];
                    }
                    if (sql.includes('AS has_orphans')) return [{ has_orphans: false }];
                    if (sql.includes('FROM public.users')) return [{ id: ownerId }];
                    if (sql.includes('UPDATE public.tenants')) {
                        settings = { ...settings, ...JSON.parse(params?.[1] || '{}') };
                        return [{ id: tenantId }];
                    }
                    return prisma.executeInTenantSchema(schema, sql, params);
                },
            )),
            tenant: {
                findUnique: jest.fn().mockImplementation(async () => ({ settings })),
                update: jest.fn().mockImplementation(async ({ data }: any) => {
                    settings = data.settings;
                    return { settings };
                }),
            },
            user: {
                findFirst: jest.fn().mockResolvedValue({ id: ownerId }),
            },
            $executeRawUnsafe: jest.fn().mockImplementation(async (
                _sql: string,
                _tenantId: string,
                patch: string,
            ) => {
                settings = { ...settings, ...JSON.parse(patch) };
                return 1;
            }),
        };
        redis = {
            acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
            renewLockToken: jest.fn().mockResolvedValue(true),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
            get: jest.fn().mockResolvedValue(null),
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
        };
        throttle = {
            getTenantPlan: jest.fn().mockResolvedValue('pro'),
            getPlanFeatures: jest.fn().mockResolvedValue({ pipelineStages: 15, appointmentsServices: -1 }),
        };
        service = new VerticalsService(prisma, redis, throttle);

        seedPipelineStages = jest.spyOn(service as any, 'seedPipelineStages').mockResolvedValue(undefined);
        patchDefaultAgent = jest.spyOn(service as any, 'patchDefaultAgent').mockResolvedValue(undefined);
        seedFaqs = jest.spyOn(service as any, 'seedFaqs').mockResolvedValue(undefined);
        seedServices = jest.spyOn(service as any, 'seedServices').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'enableSimpleTool').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'disableSimpleTool').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'restoreAppointmentsTool').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'seedToursExtras').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'seedDentalExtras').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'seedInmobiliariaExtras').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'seedMembershipPlans').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'invalidateRuntimeCaches').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'readQuotaUsage').mockResolvedValue({ stageSlugs: [], serviceNames: [] });
        assertInvariants = jest.spyOn(service as any, 'assertProvisioningInvariants').mockResolvedValue({
            pipelineStages: 1,
            appointmentServices: 0,
            availabilitySlots: 0,
            publishedFaqs: 5,
            activeAgents: 1,
            requiredTools: ['faqs'],
        });
    });

    it('keeps turismo/hotel on property-night booking and skips generic agenda', async () => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, 'turismo', 'hotel', 'es');

        expect(seedServices).not.toHaveBeenCalled();
        expect(seedAvailability).not.toHaveBeenCalled();
        expect((service as any).enableSimpleTool).toHaveBeenCalledWith(
            schemaName, 'properties', expect.any(Function),
        );
        expect(settings.verticalConfig).toMatchObject({
            industry: 'turismo',
            subType: 'hotel',
            bookingEnabled: false,
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            effectiveCapabilities: expect.arrayContaining(['crm_pipeline', 'faq_search', 'nightly_booking']),
        });
        expect(settings.verticalConfig.effectiveCapabilities).not.toContain('appointment_booking');
    });

    it('canonicalizes subtype aliases even when bootstrap is called directly', async () => {
        await service.bootstrapVertical(
            tenantId, 'veterinaria', 'peluqueria_canina', 'es',
        );

        expect(settings.verticalConfig).toMatchObject({
            industry: 'pet_services',
            subType: 'peluqueria',
        });
        expect(patchDefaultAgent).toHaveBeenCalledWith(
            schemaName,
            expect.objectContaining({ industry: 'pet_services' }),
            'peluqueria',
            'es',
            expect.any(Function),
        );
    });

    it('provisions tour operators with tour bookings and no generic agenda', async () => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, 'turismo', 'tours', 'es');

        expect(seedServices).not.toHaveBeenCalled();
        expect(seedAvailability).not.toHaveBeenCalled();
        expect((service as any).enableSimpleTool).toHaveBeenCalledWith(
            schemaName, 'tours', expect.any(Function),
        );
        const seededDefinition = seedPipelineStages.mock.calls[0][2] as any;
        expect(seededDefinition.pipeline.stages.flatMap((stage: any) => stage.transitionRules || []))
            .toContainEqual({ type: 'tour_booking_required' });
        expect(settings.verticalConfig).toMatchObject({
            industry: 'turismo',
            subType: 'tours',
            bookingEnabled: false,
            effectiveCapabilities: expect.arrayContaining(['tour_booking']),
        });
        expect(settings.verticalConfig.effectiveCapabilities).not.toContain('appointment_booking');
    });

    it('provisions fast food with real orders and no table-reservation agenda', async () => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, 'restaurantes', 'comida_rapida', 'es');

        expect(seedServices).not.toHaveBeenCalled();
        expect(seedAvailability).not.toHaveBeenCalled();
        const seededDefinition = seedPipelineStages.mock.calls[0][2] as any;
        expect(seededDefinition.pipeline.stages.flatMap((stage: any) => stage.transitionRules || []))
            .toContainEqual({ type: 'food_order_required' });
        expect(settings.verticalConfig.bookingEnabled).toBe(false);
        expect(settings.verticalConfig.effectiveCapabilities).toContain('restaurant_ordering');
        expect(settings.verticalConfig.effectiveCapabilities).not.toContain('appointment_booking');
    });

    it('provisions home services through scheduled service requests only', async () => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, 'servicios_hogar', 'plomeria', 'es');

        expect(seedServices).toHaveBeenCalledTimes(1);
        expect((seedServices.mock.calls[0][1] as any).services).toEqual([
            expect.objectContaining({ category: 'plomeria', durationMinutes: 90 }),
        ]);
        expect(seedAvailability).not.toHaveBeenCalled();
        const seededDefinition = seedPipelineStages.mock.calls[0][2] as any;
        expect(seededDefinition.pipeline.stages.flatMap((stage: any) => stage.transitionRules || []))
            .toContainEqual({ type: 'service_request_scheduled_required' });
        expect(settings.verticalConfig.bookingEnabled).toBe(false);
        expect(settings.verticalConfig.effectiveCapabilities).toContain('service_requests');
        expect(settings.verticalConfig.effectiveCapabilities).not.toContain('appointment_booking');
    });

    it('provisions retail/home delivery capacity without enabling agenda for other retail subtypes', async () => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, 'retail', 'hogar', 'es');

        expect(seedServices).toHaveBeenCalledTimes(1);
        expect((seedServices.mock.calls[0][1] as any).services).toEqual([
            expect.objectContaining({ category: 'entrega', durationMinutes: 120 }),
            expect.objectContaining({ category: 'instalacion', durationMinutes: 180 }),
        ]);
        expect(seedAvailability).toHaveBeenCalledTimes(1);
        expect(settings.verticalConfig.bookingEnabled).toBe(true);
        expect(settings.verticalConfig.effectiveCapabilities).toContain('appointment_booking');
    });

    it('seeds the pet-hotel catalog without reusing appointment slots', async () => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, 'pet_services', 'hotel', 'es');

        expect(seedServices).toHaveBeenCalledTimes(1);
        expect((seedServices.mock.calls[0][1] as any).services).toEqual([
            expect.objectContaining({ category: 'hotel', durationType: 'open', durationMinutes: 1_440 }),
        ]);
        expect(seedAvailability).not.toHaveBeenCalled();
        expect((service as any).enableSimpleTool).toHaveBeenCalledWith(
            schemaName, 'petServices', expect.any(Function),
        );
        expect((service as any).enableSimpleTool).toHaveBeenCalledWith(
            schemaName, 'pets', expect.any(Function),
        );
        const seededDefinition = seedPipelineStages.mock.calls[0][2] as any;
        expect(seededDefinition.pipeline.stages.flatMap((stage: any) => stage.transitionRules || []))
            .toContainEqual({ type: 'pet_boarding_required' });
        expect(settings.verticalConfig).toMatchObject({
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            bookingEnabled: false,
            effectiveCapabilities: expect.arrayContaining(['pet_boarding', 'pet_services', 'pet_records']),
        });
        expect(settings.verticalConfig.effectiveCapabilities).not.toContain('appointment_booking');
    });

    it.each([
        ['automotriz', 'repuestos', 'order_required', 'catalog_search', 'catalog'],
        ['automotriz', 'alquiler', 'vehicle_rental_required', 'vehicle_rentals', 'vehicles'],
        ['technology', 'hardware', 'order_required', 'catalog_search', 'catalog'],
    ])('uses a native non-appointment engine for %s/%s', async (
        industry,
        subType,
        expectedRule,
        expectedCapability,
        expectedTool,
    ) => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, industry, subType, 'es');

        expect(seedServices).not.toHaveBeenCalled();
        expect(seedAvailability).not.toHaveBeenCalled();
        expect((service as any).enableSimpleTool).toHaveBeenCalledWith(
            schemaName, expectedTool, expect.any(Function),
        );
        const seededDefinition = seedPipelineStages.mock.calls[0][2] as any;
        expect(seededDefinition.pipeline.stages.flatMap((stage: any) => stage.transitionRules || []))
            .toContainEqual({ type: expectedRule });
        expect(settings.verticalConfig.bookingEnabled).toBe(false);
        expect(settings.verticalConfig.effectiveCapabilities).toContain(expectedCapability);
        expect(settings.verticalConfig.effectiveCapabilities).not.toContain('appointment_booking');
        if (industry === 'automotriz' && subType === 'repuestos') {
            expect((service as any).disableSimpleTool).toHaveBeenCalledWith(
                schemaName, 'vehicles', expect.any(Function),
            );
        }
    });

    /**
     * Un estudio de fotos NO agenda franjas, pero SÍ vende paquetes. La versión
     * anterior de esta prueba afirmaba que no se sembraba ninguno de los dos, y
     * eso era exactamente el defecto: el tenant arrancaba con cero paquetes y
     * `list_photo_packages` devolvía vacío el primer día.
     */
    it('seeds photography packages without seeding a second appointment calendar', async () => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, 'fotografia', 'estudio', 'es');

        expect(seedServices).toHaveBeenCalledTimes(1);
        const seededServices = (seedServices.mock.calls[0][1] as any).services;
        expect(seededServices.map((s: any) => s.name.es)).toEqual([
            'Sesión familiar', 'Retrato individual', 'Book profesional',
        ]);
        // Sin agenda no hay horarios semanales que sembrar.
        expect(seedAvailability).not.toHaveBeenCalled();
        const seededDefinition = seedPipelineStages.mock.calls[0][2] as any;
        expect(seededDefinition.pipeline.stages.flatMap((stage: any) => stage.transitionRules || []))
            .toContainEqual({ type: 'photo_session_scheduled_required' });
        expect(settings.verticalConfig).toMatchObject({
            bookingEnabled: false,
            effectiveCapabilities: expect.arrayContaining(['photo_sessions']),
        });
        expect(settings.verticalConfig.effectiveCapabilities).not.toContain('appointment_booking');
    });

    it('fails closed instead of resolving a new manifest from an unversioned cached config', async () => {
        settings.verticalProvisioning = { version: 1, status: 'complete' };
        redis.getJson.mockResolvedValueOnce({
            industry: 'turismo',
            subType: 'hotel',
            terminology: VERTICAL_REGISTRY.turismo.terminology,
            sidebar: VERTICAL_REGISTRY.turismo.sidebar,
            dashboard: VERTICAL_REGISTRY.turismo.dashboard,
            bookingEnabled: false,
        });

        const config = await service.getVerticalConfig(tenantId);

        expect(config?.manifestVersion).toBeUndefined();
        expect(config?.effectiveCapabilities).toEqual([]);
        expect(settings.verticalConfig.manifestVersion).toBeUndefined();
        expect(settings.verticalConfig.effectiveCapabilities).toEqual([]);
        expect(prisma.tenant.findUnique.mock.invocationCallOrder[0])
            .toBeLessThan(redis.getJson.mock.invocationCallOrder[0]);
    });

    it('preserves the published v1 capability contract until v2 reconciliation succeeds', async () => {
        const legacyConfig = {
            industry: 'turismo',
            subType: 'hotel',
            terminology: VERTICAL_REGISTRY.turismo.terminology,
            sidebar: VERTICAL_REGISTRY.turismo.sidebar,
            dashboard: VERTICAL_REGISTRY.turismo.dashboard,
            bookingEnabled: true,
            manifestVersion: 1,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'appointment_booking'],
        };
        settings.verticalProvisioning = { version: 1, status: 'complete' };
        settings.verticalConfig = legacyConfig;
        redis.getJson.mockResolvedValueOnce({
            ...legacyConfig,
            bookingEnabled: false,
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'nightly_booking'],
        });

        const config = await service.getVerticalConfig(tenantId);

        // Capability publication stays on v1, while navigation receives the
        // additive subtype projection. Persisting those labels/order is safe;
        // the v1 capability array itself remains the publication fence until
        // reconciliation succeeds.
        expect(config).toEqual({
            ...legacyConfig,
            sidebar: {
                ...legacyConfig.sidebar,
                itemOrder: ['stays', 'properties'],
                labelOverrides: {
                    ...legacyConfig.sidebar.labelOverrides,
                    properties: { es: 'Habitaciones', en: 'Rooms', pt: 'Quartos', fr: 'Chambres' },
                },
            },
        });
        expect(settings.verticalConfig).toEqual(config);
        expect(settings.verticalConfig).toMatchObject({
            manifestVersion: 1,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'appointment_booking'],
        });
    });

    it('preserves the published v1 contract of a tenant onboarded before verticalProvisioning existed', async () => {
        // La clave `verticalProvisioning` recién existe desde ago 2026. Todo tenant
        // anterior no la tiene: ausencia de estado no puede leerse como fallo, o el
        // deploy apaga los módulos verticales de toda la población vieja.
        const legacyConfig = {
            industry: 'turismo',
            subType: 'hotel',
            terminology: VERTICAL_REGISTRY.turismo.terminology,
            sidebar: VERTICAL_REGISTRY.turismo.sidebar,
            dashboard: VERTICAL_REGISTRY.turismo.dashboard,
            bookingEnabled: true,
            manifestVersion: 1,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'appointment_booking'],
        };
        delete settings.verticalProvisioning;
        settings.verticalConfig = legacyConfig;

        const config = await service.getVerticalConfig(tenantId);

        expect(config).toEqual({
            ...legacyConfig,
            sidebar: {
                ...legacyConfig.sidebar,
                itemOrder: ['stays', 'properties'],
                labelOverrides: {
                    ...legacyConfig.sidebar.labelOverrides,
                    properties: { es: 'Habitaciones', en: 'Rooms', pt: 'Quartos', fr: 'Chambres' },
                },
            },
        });
        expect(settings.verticalConfig).toEqual(config);
        expect(settings.verticalConfig).toMatchObject({
            manifestVersion: 1,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'appointment_booking'],
        });
    });

    it('still fails closed for a pre-provisioning tenant with no published capability array', async () => {
        delete settings.verticalProvisioning;
        settings.verticalConfig = {
            industry: 'turismo',
            subType: 'hotel',
            terminology: VERTICAL_REGISTRY.turismo.terminology,
            sidebar: VERTICAL_REGISTRY.turismo.sidebar,
            dashboard: VERTICAL_REGISTRY.turismo.dashboard,
            bookingEnabled: true,
        };

        const config = await service.getVerticalConfig(tenantId);

        expect(config?.manifestVersion).toBeUndefined();
        expect(config?.effectiveCapabilities).toEqual([]);
    });

    it('does not trust a v1 config whose provisioning state failed', async () => {
        settings.verticalProvisioning = { version: 1, status: 'failed' };
        settings.verticalConfig = {
            industry: 'turismo',
            subType: 'hotel',
            terminology: VERTICAL_REGISTRY.turismo.terminology,
            sidebar: VERTICAL_REGISTRY.turismo.sidebar,
            dashboard: VERTICAL_REGISTRY.turismo.dashboard,
            bookingEnabled: true,
            manifestVersion: 1,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'appointment_booking'],
        };

        const config = await service.getVerticalConfig(tenantId);

        expect(config?.manifestVersion).toBeUndefined();
        expect(config?.effectiveCapabilities).toEqual([]);
    });

    it('does not publish cached manifest metadata after provisioning failed', async () => {
        settings.verticalProvisioning = { version: VERTICAL_PROVISIONING_VERSION, status: 'failed' };
        redis.getJson.mockResolvedValueOnce({
            industry: 'turismo',
            subType: 'hotel',
            terminology: VERTICAL_REGISTRY.turismo.terminology,
            sidebar: VERTICAL_REGISTRY.turismo.sidebar,
            dashboard: VERTICAL_REGISTRY.turismo.dashboard,
            bookingEnabled: false,
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'nightly_booking'],
        });

        const config = await service.getVerticalConfig(tenantId);

        expect(config?.manifestVersion).toBeUndefined();
        expect(config?.effectiveCapabilities).toEqual([]);
        expect(settings.verticalConfig.manifestVersion).toBeUndefined();
        expect(settings.verticalConfig.effectiveCapabilities).toEqual([]);
        expect(redis.setJson).toHaveBeenCalledWith(
            `vertical:${tenantId}`,
            expect.objectContaining({ effectiveCapabilities: [] }),
            600,
        );
    });

    it('returns an authoritative empty capability list when no prior config is published', async () => {
        settings.verticalProvisioning = { version: VERTICAL_PROVISIONING_VERSION, status: 'failed' };
        settings.subType = 'hotel';
        prisma.tenant.findUnique.mockResolvedValueOnce({ settings, industry: 'turismo' });

        const config = await service.getVerticalConfig(tenantId);

        expect(config).toMatchObject({
            industry: 'turismo',
            subType: 'hotel',
            effectiveCapabilities: [],
        });
        expect(config?.manifestVersion).toBeUndefined();
    });

    it('publishes the current manifest when durable provisioning v2 is complete', async () => {
        settings.verticalProvisioning = {
            version: VERTICAL_PROVISIONING_VERSION,
            status: 'complete',
        };
        redis.getJson.mockResolvedValueOnce({
            industry: 'turismo',
            subType: 'hotel',
            terminology: VERTICAL_REGISTRY.turismo.terminology,
            sidebar: VERTICAL_REGISTRY.turismo.sidebar,
            dashboard: VERTICAL_REGISTRY.turismo.dashboard,
            bookingEnabled: false,
        });

        const config = await service.getVerticalConfig(tenantId);

        expect(config).toMatchObject({
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            effectiveCapabilities: expect.arrayContaining(['nightly_booking']),
        });
        expect(config?.effectiveCapabilities).not.toContain('appointment_booking');
        expect(settings.verticalConfig).toMatchObject({
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
        });
        expect(redis.setJson).toHaveBeenCalledWith(
            `vertical:${tenantId}`,
            expect.objectContaining({ manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION }),
            600,
        );
    });

    it('fences a persisted alias until the canonical profile is reprovisioned', async () => {
        settings.verticalProvisioning = {
            version: VERTICAL_PROVISIONING_VERSION,
            status: 'complete',
            industry: 'veterinaria',
            subType: 'peluqueria_canina',
            completedSteps: ['persona', 'vertical_tools', 'invariants'],
        };
        settings.verticalConfig = {
            industry: 'veterinaria',
            subType: 'peluqueria_canina',
            terminology: VERTICAL_REGISTRY.veterinaria.terminology,
            sidebar: VERTICAL_REGISTRY.veterinaria.sidebar,
            dashboard: VERTICAL_REGISTRY.veterinaria.dashboard,
            bookingEnabled: true,
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            effectiveCapabilities: ['appointment_booking'],
        };

        const config = await service.getVerticalConfig(tenantId);

        expect(config).toMatchObject({
            industry: 'pet_services',
            subType: 'peluqueria',
            effectiveCapabilities: [],
        });
        expect(settings.verticalProvisioning).toMatchObject({
            status: 'pending',
            industry: 'pet_services',
            subType: 'peluqueria',
            completedSteps: [],
        });
    });

    it('seeds seven real 24-hour slots for veterinaria/hospital_24h', async () => {
        prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (sql.includes('SELECT COUNT(*)')) return [{ cnt: 0 }];
            return [];
        });

        await service.bootstrapVertical(tenantId, 'veterinaria', 'hospital_24h', 'es');

        const inserts = prisma.executeInTenantSchema.mock.calls.filter(
            (call: any[]) => String(call[1]).includes('INSERT INTO availability_slots'),
        );
        expect(inserts).toHaveLength(7);
        expect(inserts.map((call: any[]) => call[2][2]).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
        for (const call of inserts) {
            expect(call[2][3]).toBe('00:00');
            expect(call[2][4]).toBe('23:59');
        }
    });

    it('keeps a normal subtype on the vertical weekly schedule', async () => {
        prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (sql.includes('SELECT COUNT(*)')) return [{ cnt: 0 }];
            return [];
        });

        await service.bootstrapVertical(tenantId, 'veterinaria', 'clinica_general', 'es');

        const inserts = prisma.executeInTenantSchema.mock.calls.filter(
            (call: any[]) => String(call[1]).includes('INSERT INTO availability_slots'),
        );
        expect(inserts).toHaveLength(6);
        expect(inserts.map((call: any[]) => call[2][2]).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('rolls back the attempt and replays every step after a failure', async () => {
        seedFaqs.mockRejectedValueOnce(new Error('injected FAQ failure'));

        await expect(service.bootstrapVertical(tenantId, 'retail', 'moda', 'es'))
            .rejects.toThrow('injected FAQ failure');

        expect(settings.verticalProvisioning).toMatchObject({
            version: VERTICAL_PROVISIONING_VERSION,
            status: 'failed',
            failure: { step: 'knowledge', message: 'injected FAQ failure' },
            completedSteps: [],
        });
        expect(seedPipelineStages).toHaveBeenCalledTimes(1);
        expect(patchDefaultAgent).toHaveBeenCalledTimes(1);

        await service.bootstrapVertical(tenantId, 'retail', 'moda', 'es');

        expect(seedPipelineStages).toHaveBeenCalledTimes(2);
        expect(patchDefaultAgent).toHaveBeenCalledTimes(2);
        expect(seedFaqs).toHaveBeenCalledTimes(2);
        expect(settings.verticalProvisioning.status).toBe('complete');
        expect(settings.verticalProvisioning.completedSteps).toContain('invariants');
        expect(settings.verticalProvisioning.attempt).toBe(2);
    });

    it('rolls back every live tenant mutation and preserves published v1 after a late failure', async () => {
        const legacyConfig = {
            industry: 'veterinaria',
            subType: 'clinica_general',
            terminology: VERTICAL_REGISTRY.veterinaria.terminology,
            sidebar: VERTICAL_REGISTRY.veterinaria.sidebar,
            dashboard: VERTICAL_REGISTRY.veterinaria.dashboard,
            bookingEnabled: true,
            manifestVersion: 1,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'appointment_booking'],
        };
        settings = {
            verticalConfig: legacyConfig,
            verticalProvisioning: { version: 1, status: 'complete' },
        };
        const initialLive = {
            pipeline: 'original',
            persona: 'original',
            faqs: 'original',
            services: 'original',
            availability: 'original',
            tools: 'original',
        };
        let live = { ...initialLive };
        let transactionCount = 0;
        prisma.transactionInTenantSchema.mockImplementation(async (
            _schema: string,
            callback: any,
            options?: { timeout?: number },
        ) => {
            transactionCount++;
            expect(options?.timeout).toBe(90_000);
            const working = { ...live };
            const query = async (sql: string) => {
                if (sql.startsWith('TEST_MUTATION:')) {
                    const key = sql.slice('TEST_MUTATION:'.length) as keyof typeof working;
                    working[key] = 'mutated';
                }
                return [];
            };
            const result = await callback(query);
            live = working;
            return result;
        });

        seedPipelineStages.mockImplementation(async (...args: any[]) =>
            args[4]('TEST_MUTATION:pipeline'));
        patchDefaultAgent.mockImplementation(async (...args: any[]) =>
            args[4]('TEST_MUTATION:persona'));
        seedFaqs.mockImplementation(async (...args: any[]) =>
            args[3]('TEST_MUTATION:faqs'));
        seedServices.mockImplementation(async (...args: any[]) =>
            args[3]('TEST_MUTATION:services'));
        jest.spyOn(service as any, 'seedAvailability').mockImplementation(async (...args: any[]) =>
            args[4]('TEST_MUTATION:availability'));
        (service as any).enableSimpleTool.mockImplementation(async (...args: any[]) =>
            args[2]('TEST_MUTATION:tools'));
        (service as any).restoreAppointmentsTool.mockImplementation(async (...args: any[]) =>
            args[2]('TEST_MUTATION:tools'));
        assertInvariants.mockImplementation(async (...args: any[]) => {
            await args[10]('TEST_MUTATION:tools');
            throw new Error('late invariant failure');
        });

        await expect(service.bootstrapVertical(
            tenantId,
            'veterinaria',
            'clinica_general',
            'es',
        )).rejects.toThrow('late invariant failure');

        expect(transactionCount).toBe(1);
        expect(live).toEqual(initialLive);
        expect(settings.verticalConfig).toEqual(legacyConfig);
        expect(settings.verticalProvisioning).toMatchObject({
            version: VERTICAL_PROVISIONING_VERSION,
            status: 'failed',
            completedSteps: [],
            publishedManifestVersion: 1,
            failure: { step: 'invariants', message: 'late invariant failure' },
        });
        expect((service as any).invalidateRuntimeCaches).not.toHaveBeenCalled();
    });

    it('keeps the current manifest unpublished after an invariant failure and replays idempotent steps', async () => {
        const legacyConfig = {
            industry: 'retail',
            subType: 'moda',
            terminology: VERTICAL_REGISTRY.retail.terminology,
            sidebar: VERTICAL_REGISTRY.retail.sidebar,
            dashboard: VERTICAL_REGISTRY.retail.dashboard,
            bookingEnabled: false,
            manifestVersion: 1,
            effectiveCapabilities: ['crm_pipeline', 'faq_search', 'catalog_search'],
        };
        settings.verticalProvisioning = { version: 1, status: 'complete' };
        settings.verticalConfig = legacyConfig;
        assertInvariants
            .mockRejectedValueOnce(new Error('injected readiness mismatch'))
            .mockResolvedValueOnce({
                pipelineStages: 5,
                appointmentServices: 3,
                availabilitySlots: 6,
                publishedFaqs: 5,
                activeAgents: 1,
                requiredTools: ['faqs', 'appointments', 'catalog'],
            });

        await expect(service.bootstrapVertical(tenantId, 'retail', 'moda', 'es'))
            .rejects.toThrow('injected readiness mismatch');
        expect(settings.verticalProvisioning).toMatchObject({
            status: 'failed',
            failure: { step: 'invariants' },
        });
        expect(settings.verticalConfig).toEqual(legacyConfig);
        expect(settings.verticalProvisioning.publishedManifestVersion).toBe(1);
        expect(settings.verticalConfigPending).toBeUndefined();
        await expect(service.getVerticalConfig(tenantId)).resolves.toEqual({
            ...legacyConfig,
            sidebar: {
                ...legacyConfig.sidebar,
                itemOrder: ['orders', 'inventory'],
                labelOverrides: {
                    ...legacyConfig.sidebar.labelOverrides,
                    inventory: { es: 'productos', en: 'products', pt: 'produtos', fr: 'produits' },
                },
            },
        });

        await service.bootstrapVertical(tenantId, 'retail', 'moda', 'es');

        expect(seedPipelineStages).toHaveBeenCalledTimes(2);
        expect(patchDefaultAgent).toHaveBeenCalledTimes(2);
        expect(seedFaqs).toHaveBeenCalledTimes(2);
        expect(settings.verticalProvisioning.status).toBe('complete');
        expect(settings.verticalProvisioning.attempt).toBe(2);
        expect(settings.verticalConfig.manifestVersion).toBe(VERTICAL_CAPABILITY_MANIFEST_VERSION);
        expect(settings.verticalConfigPending).toBeNull();
    });

    it('fences the bootstrap when ownership is lost before a stage commit', async () => {
        seedFaqs.mockImplementationOnce(async () => {
            redis.renewLockToken.mockResolvedValue(false);
        });

        await expect(service.bootstrapVertical(tenantId, 'retail', 'marketplace', 'es'))
            .rejects.toMatchObject({
                response: expect.objectContaining({ error: 'vertical_provisioning_lock_lost' }),
            });

        expect(seedFaqs).toHaveBeenCalledTimes(1);
        expect(seedServices).not.toHaveBeenCalled();
        expect(settings.verticalProvisioning.status).not.toBe('complete');
    });

    it('requires the appointments tool whenever booking is effectively enabled', () => {
        expect((service as any).requiredTools('retail', 'marketplace', true))
            .toEqual(expect.arrayContaining(['faqs', 'appointments', 'catalog']));
        expect((service as any).requiredTools('retail', 'marketplace', false))
            .not.toContain('appointments');
    });

    it('re-verifies a completed specialized engine from its published config after pending is cleared', async () => {
        (service as any).assertProvisioningInvariants.mockRestore();

        prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (sql.includes('pipeline_stages')) {
                return [
                    { slug: 'consulta', terminal_outcome: null },
                    { slug: 'cotizacion', terminal_outcome: null },
                    { slug: 'reserva', terminal_outcome: null },
                    { slug: 'confirmado', terminal_outcome: null },
                    { slug: 'completado', terminal_outcome: 'won' },
                    { slug: 'cancelado', terminal_outcome: 'lost' },
                ];
            }
            if (sql.includes('SELECT name FROM services')) {
                return [
                    { name: 'Tour día completo' },
                    { name: 'Paquete fin de semana' },
                    { name: 'Excursión medio día' },
                ];
            }
            if (sql.includes('availability_slots')) {
                return [{ slots: 7, faqs: 5 }];
            }
            if (sql.includes('question FROM faqs')) {
                return [
                    { question: '¿Qué destinos manejan?' },
                    { question: '¿Qué incluye el paquete?' },
                    { question: '¿Cuál es la política de cancelación?' },
                    { question: '¿Necesito seguro de viaje?' },
                    { question: '¿Qué documentos necesito para viajar?' },
                ];
            }
            if (sql.includes('agent_personas')) {
                return [
                    {
                        config_json: {
                            tools: {
                                faqs: { enabled: true },
                                tours: { enabled: true },
                                appointments: { enabled: false },
                            },
                        },
                    },
                ];
            }
            return [];
        });

        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
                verticalConfig: {
                    industry: 'turismo',
                    subType: 'tours',
                    bookingEnabled: false,
                },
            },
        } as any);

        const definition = VERTICAL_REGISTRY['turismo'];
        const result = await (service as any).assertProvisioningInvariants(
            tenantId,
            schemaName,
            definition,
            'tours',
            'es',
            { pipelineStages: -1, appointmentServices: -1, availabilitySlots: -1, publishedFaqs: -1, selectedStageSlugs: [], selectedServiceIndexes: [] },
            definition.pipeline.stages,
            [],
            false,
            {
                industry: 'turismo',
                subType: 'tours',
                bookingEnabled: false,
            },
        );

        expect(result).toBeDefined();
        expect(result.pipelineStages).toBe(6);
    });

    it('reopens completed specialized provisioning when an old agent still has appointments enabled', async () => {
        (service as any).assertProvisioningInvariants.mockRestore();

        prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (sql.includes('pipeline_stages')) {
                return VERTICAL_REGISTRY.turismo.pipeline.stages.map((stage) => ({
                    slug: stage.slug,
                    terminal_outcome: stage.isTerminal ? stage.terminalOutcome : null,
                    transition_rules: stage.transitionRules || [],
                }));
            }
            if (sql.includes('SELECT name FROM services')) return [];
            if (sql.includes('availability_slots')) {
                return [{ slots: 0, faqs: VERTICAL_REGISTRY.turismo.faqs.length }];
            }
            if (sql.includes('question FROM faqs')) {
                return VERTICAL_REGISTRY.turismo.faqs.map((faq) => ({ question: faq.question.es }));
            }
            if (sql.includes('agent_personas')) {
                return [{
                    config_json: {
                        tools: {
                            faqs: { enabled: true },
                            tours: { enabled: true },
                            appointments: { enabled: true },
                        },
                    },
                }];
            }
            return [];
        });
        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
                verticalConfigPending: {
                    industry: 'turismo',
                    subType: 'tours',
                    bookingEnabled: false,
                },
            },
        } as any);

        await expect((service as any).assertProvisioningInvariants(
            tenantId,
            schemaName,
            VERTICAL_REGISTRY.turismo,
            'tours',
            'es',
            {
                pipelineStages: -1,
                appointmentServices: -1,
                availabilitySlots: -1,
                publishedFaqs: -1,
                selectedStageSlugs: [],
                selectedServiceIndexes: [],
            },
            VERTICAL_REGISTRY.turismo.pipeline.stages,
            [],
            false,
        )).rejects.toThrow(/retains appointments outside appointment_booking capability/);
    });
});

/**
 * Regresión del 500 en el alta: `tpl_technology_soporte` declara solo
 * knowledge+crm, sin la clave `appointments`. `restoreAppointmentsTool` la
 * salteaba (`if (!appointments) continue`), la herramienta nunca nacía, y
 * `assertProvisioningInvariants` mataba el signup en toda vertical con agenda.
 *
 * Estos tests ejercitan el método REAL. En el describe de arriba está mockeado
 * globalmente en el beforeEach, que es la razón por la que la línea que decide
 * todo no la corría ningún test del repo.
 */
describe('restoreAppointmentsTool (sin mockear)', () => {
    const schemaName = 'tenant_x';

    function buildService(agentTools: any, counts = { services: 3, slots: 7 }) {
        const updates: any[] = [];
        const prisma: any = {
            executeInTenantSchema: jest.fn().mockImplementation(async (_schema: string, sql: string, params?: any[]) => {
                if (sql.includes('SELECT id, config_json FROM agent_personas')) {
                    return [{ id: 'agent-1', config_json: { tools: agentTools } }];
                }
                if (sql.includes('COUNT(*)::int FROM services')) {
                    return [{ services: counts.services, slots: counts.slots }];
                }
                if (sql.startsWith('UPDATE agent_personas')) {
                    updates.push(JSON.parse(params![0]));
                    return [];
                }
                return [];
            }),
        };
        return { service: new VerticalsService(prisma, {} as any, {} as any), updates };
    }

    it('crea appointments cuando la plantilla no la menciona y el negocio agenda', async () => {
        // La forma literal de tpl_technology_soporte.
        const { service, updates } = buildService({ knowledge: { enabled: true }, crm: { enabled: true } });

        await (service as any).restoreAppointmentsTool(schemaName, true);

        expect(updates).toHaveLength(1);
        expect(updates[0].tools.appointments).toEqual({ enabled: true, canBook: true, canCancel: true });
        // No pisa lo que ya traía la plantilla.
        expect(updates[0].tools.knowledge).toEqual({ enabled: true });
        expect(updates[0].tools.crm).toEqual({ enabled: true });
    });

    it('NO crea appointments cuando la vertical no agenda', async () => {
        const { service, updates } = buildService({ knowledge: { enabled: true } });

        await (service as any).restoreAppointmentsTool(schemaName, false);

        expect(updates).toHaveLength(0);
    });

    it('apaga appointments heredado cuando el manifest usa otro motor', async () => {
        const { service, updates } = buildService({
            tours: { enabled: true },
            appointments: {
                enabled: true,
                canBook: true,
                canCancel: true,
                pendingPrerequisites: true,
            },
        });

        await (service as any).restoreAppointmentsTool(schemaName, false);

        expect(updates).toHaveLength(1);
        expect(updates[0].tools.tours.enabled).toBe(true);
        expect(updates[0].tools.appointments).toEqual({
            enabled: false,
            canBook: true,
            canCancel: true,
        });
    });

    it('no arma un agendador sin agenda detras: sin servicios ni slots queda apagado', async () => {
        const { service, updates } = buildService(
            { knowledge: { enabled: true } },
            { services: 0, slots: 0 },
        );

        await (service as any).restoreAppointmentsTool(schemaName, true);

        expect(updates).toHaveLength(1);
        expect(updates[0].tools.appointments.enabled).toBe(false);
    });

    it('respeta la plantilla que apaga appointments a proposito (tpl_sales, tpl_faq)', async () => {
        const { service, updates } = buildService({
            crm: { enabled: true },
            appointments: { enabled: false },
        });

        await (service as any).restoreAppointmentsTool(schemaName, true);

        expect(updates).toHaveLength(0);
    });

    it('reenciende la que apago el alta por falta de agenda (pendingPrerequisites)', async () => {
        const { service, updates } = buildService({
            appointments: { enabled: false, canBook: true, canCancel: true, pendingPrerequisites: true },
        });

        await (service as any).restoreAppointmentsTool(schemaName, true);

        expect(updates).toHaveLength(1);
        expect(updates[0].tools.appointments.enabled).toBe(true);
        // El marcador se consume siempre.
        expect(updates[0].tools.appointments.pendingPrerequisites).toBeUndefined();
    });
});

/**
 * Regresión del "14 pipeline stages exceed quota 7".
 *
 * El bootstrap sembraba con `pipeline_id NULL` fijo. `ensureMultiPipeline`
 * (pipeline.service.ts) adopta las etapas huérfanas dentro de "Pipeline
 * Principal" la primera vez que alguien abre el embudo, y desde ahí
 * `(NULL,'lead')` y `(<default>,'lead')` son claves distintas para
 * `uidx_pipeline_stages_pipeline_slug` (NULLS NOT DISTINCT): el ON CONFLICT
 * dejaba de matchear y cada replay volvia a insertar las 7 etapas.
 */
describe('seedPipelineStages contra el embudo primario', () => {
    const tenantId = 'aaeaf495-92ec-464a-8cd4-9e457d3a12f9';
    const schemaName = 'tenant_x';
    const definition: any = {
        industry: 'technology',
        pipeline: {
            stages: [
                { slug: 'lead', name: { es: 'Lead' }, color: '#111', probability: 10, isTerminal: false },
                { slug: 'demo', name: { es: 'Demo' }, color: '#222', probability: 40, isTerminal: false },
            ],
        },
    };

    function buildService(defaultPipelineId: string | null, hasDuplicateOrphans = false) {
        const inserts: any[][] = [];
        const insertSql: string[] = [];
        const deletes: string[] = [];
        const query = jest.fn(async (sql: string, params: any[] = []) => {
            if (sql.includes('SELECT id FROM pipelines')) {
                return defaultPipelineId ? [{ id: defaultPipelineId }] : [];
            }
            if (sql.includes('AS has_orphans')) {
                return [{ has_orphans: hasDuplicateOrphans }];
            }
            if (sql.includes('AS has_deals')) return [];
            if (sql.trim().startsWith('DELETE FROM pipeline_stages')) {
                deletes.push(sql);
                return [{ id: 'duplicate-stage' }];
            }
            if (sql.includes('INSERT INTO pipeline_stages')) {
                inserts.push(params);
                insertSql.push(sql);
            }
            return [];
        });
        const prisma: any = {
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        return {
            service: new VerticalsService(prisma, {} as any, {} as any),
            inserts,
            insertSql,
            deletes,
            query,
        };
    }

    it('siembra contra el pipeline por defecto cuando ya fue adoptado', async () => {
        const pipelineId = '06f27c5d-314e-49a2-88d9-7b56f11e4966';
        const { service, inserts, insertSql, deletes } = buildService(pipelineId, true);

        await (service as any).seedPipelineStages(tenantId, schemaName, definition, 'es');

        expect(inserts).toHaveLength(2);
        // El pipeline_id resuelto es el ultimo parametro del INSERT: sin esto el
        // upsert no matchea y el replay duplica.
        expect(inserts[0][inserts[0].length - 1]).toBe(pipelineId);
        expect(inserts[1][inserts[1].length - 1]).toBe(pipelineId);
        // Y se limpian las huerfanas que ya quedaron duplicadas.
        expect(deletes).toHaveLength(1);
        expect(insertSql[0]).toContain(
            `'[{"type":"appointment_required"}]'::jsonb`,
        );
        expect(insertSql[0]).toContain('THEN EXCLUDED.transition_rules');
    });

    it('falla cerrado y nunca siembra NULL cuando no puede establecer el embudo primario', async () => {
        const { service, inserts, deletes } = buildService(null);

        await expect((service as any).seedPipelineStages(tenantId, schemaName, definition, 'es'))
            .rejects.toThrow(`Default pipeline could not be established for tenant ${tenantId}`);

        expect(inserts).toHaveLength(0);
        expect(deletes).toHaveLength(0);
    });
});

describe('VerticalsService subtype-aware persona reconciliation', () => {
    it('removes exact legacy demo rules, preserves tenant variants and adds native hardware rules', async () => {
        const legacyRule = 'Agenda demo SOLO con leads calificados (empresa con > 10 empleados o caso de uso claro)';
        const definitionRule = 'Ofrece demos.';
        const tenantVariant = `${legacyRule} — sólo con aprobación del supervisor`;
        let persistedConfig: any = null;
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params?: any[]) => {
                if (sql.includes('SELECT id, name, template_id, config_json')) {
                    return [{
                        id: '11111111-1111-4111-8111-111111111111',
                        name: 'Diego',
                        template_id: 'tpl_technology_ventas',
                        config_json: {
                            persona: { name: 'Diego' },
                            behavior: {
                                rules: [legacyRule, definitionRule, tenantVariant, 'Regla propia'],
                                forbiddenTopics: [],
                                handoffTriggers: [],
                            },
                            tools: { appointments: { enabled: true } },
                        },
                    }];
                }
                if (sql.includes('UPDATE agent_personas SET')) {
                    persistedConfig = JSON.parse(params![1]);
                    return [];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            }),
        };
        const service = new VerticalsService(prisma, {} as any, {} as any);

        await (service as any).patchDefaultAgent(
            'tenant_persona_test',
            VERTICAL_REGISTRY.technology,
            'hardware',
            'es',
        );

        expect(persistedConfig.behavior.rules).not.toContain(legacyRule);
        expect(persistedConfig.behavior.rules).not.toContain(definitionRule);
        expect(persistedConfig.behavior.rules).toEqual(expect.arrayContaining([
            tenantVariant,
            'Regla propia',
            ...resolveVerticalSubtypePersonaContract('technology', 'hardware')!.nativeRules.es,
        ]));
        expect(persistedConfig.tools.appointments).toEqual({ enabled: true });
    });
});

describe('VerticalsService quality attribution cache invalidation', () => {
    it('invalidates both legacy config and agent-resolution keys after bootstrap', async () => {
        const tenantId = '11111111-1111-4111-8111-111111111111';
        const redis = { del: jest.fn().mockResolvedValue(undefined) };
        const prisma = {
            channelAccount: {
                findMany: jest.fn().mockResolvedValue([{
                    channelType: 'whatsapp',
                    accountId: 'phone-1',
                }]),
            },
        };
        const service = new VerticalsService(prisma as any, redis as any, {} as any);

        await (service as any).invalidateRuntimeCaches(tenantId);

        expect(redis.del).toHaveBeenCalledWith(`persona:${tenantId}:channel:whatsapp`);
        expect(redis.del).toHaveBeenCalledWith(`persona-resolution:${tenantId}:channel:whatsapp`);
        expect(redis.del).toHaveBeenCalledWith(`persona:${tenantId}:channel:whatsapp:acct:phone-1`);
        expect(redis.del).toHaveBeenCalledWith(`persona-resolution:${tenantId}:channel:whatsapp:acct:phone-1`);
    });
});
