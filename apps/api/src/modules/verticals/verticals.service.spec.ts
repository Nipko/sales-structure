import { VERTICAL_REGISTRY } from './vertical-definitions';
import {
    selectQuotaAwareVerticalDefaults,
    VerticalsService,
    VERTICAL_PROVISIONING_VERSION,
} from './verticals.service';
import { resolveVerticalSelection } from './vertical-identifiers';

describe('selectQuotaAwareVerticalDefaults', () => {
    const plans = {
        emprendedor: { pipelineStages: 7, appointmentServices: 4 },
        starter: { pipelineStages: 7, appointmentServices: 4 },
        pro: { pipelineStages: 15, appointmentServices: -1 },
        enterprise: { pipelineStages: -1, appointmentServices: -1 },
        custom: { pipelineStages: -1, appointmentServices: -1 },
    };

    it('keeps all 18 vertical defaults within every real plan quota', () => {
        expect(Object.keys(VERTICAL_REGISTRY)).toHaveLength(18);
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
        for (const [industry, definition] of Object.entries(VERTICAL_REGISTRY)) {
            if (definition.subTypes.length === 0) {
                configurations.push({ industry, subType: null, definition });
            } else {
                for (const subType of definition.subTypes) {
                    configurations.push({ industry, subType: subType.key, definition });
                }
            }
        }

        expect(configurations).toHaveLength(76);
        expect(configurations.filter(({ subType }) => subType !== null)).toHaveLength(75);
        expect(configurations).toContainEqual(expect.objectContaining({ industry: 'otro', subType: null }));

        for (const configuration of configurations) {
            expect(resolveVerticalSelection(configuration.industry, configuration.subType)).toEqual({
                industry: configuration.industry,
                subType: configuration.subType,
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
        expect((service as any).enableSimpleTool).toHaveBeenCalledWith(schemaName, 'properties');
    });

    it('does not leak turismo/hotel skipAgenda into pet_services/hotel', async () => {
        const seedAvailability = jest.spyOn(service as any, 'seedAvailability').mockResolvedValue(undefined);

        await service.bootstrapVertical(tenantId, 'pet_services', 'hotel', 'es');

        expect(seedServices).toHaveBeenCalledTimes(1);
        expect((seedServices.mock.calls[0][1] as any).services).toHaveLength(3);
        expect(seedAvailability).toHaveBeenCalledTimes(1);
        expect((service as any).enableSimpleTool).toHaveBeenCalledWith(schemaName, 'petServices');
        expect((service as any).enableSimpleTool).toHaveBeenCalledWith(schemaName, 'pets');
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

    it('persists failure and resumes after the last completed step', async () => {
        seedFaqs.mockRejectedValueOnce(new Error('injected FAQ failure'));

        await expect(service.bootstrapVertical(tenantId, 'retail', 'moda', 'es'))
            .rejects.toThrow('injected FAQ failure');

        expect(settings.verticalProvisioning).toMatchObject({
            version: VERTICAL_PROVISIONING_VERSION,
            status: 'failed',
            failure: { step: 'knowledge', message: 'injected FAQ failure' },
            completedSteps: ['quota_plan', 'pipeline', 'persona'],
        });
        expect(seedPipelineStages).toHaveBeenCalledTimes(1);
        expect(patchDefaultAgent).toHaveBeenCalledTimes(1);

        await service.bootstrapVertical(tenantId, 'retail', 'moda', 'es');

        expect(seedPipelineStages).toHaveBeenCalledTimes(1);
        expect(patchDefaultAgent).toHaveBeenCalledTimes(1);
        expect(seedFaqs).toHaveBeenCalledTimes(2);
        expect(settings.verticalProvisioning.status).toBe('complete');
        expect(settings.verticalProvisioning.completedSteps).toContain('invariants');
        expect(settings.verticalProvisioning.attempt).toBe(2);
    });

    it('replays idempotent steps after an invariant failure instead of getting stuck', async () => {
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

        await expect(service.bootstrapVertical(tenantId, 'retail', 'marketplace', 'es'))
            .rejects.toThrow('injected readiness mismatch');
        expect(settings.verticalProvisioning).toMatchObject({
            status: 'failed',
            failure: { step: 'invariants' },
        });

        await service.bootstrapVertical(tenantId, 'retail', 'marketplace', 'es');

        expect(seedPipelineStages).toHaveBeenCalledTimes(2);
        expect(patchDefaultAgent).toHaveBeenCalledTimes(2);
        expect(seedFaqs).toHaveBeenCalledTimes(2);
        expect(settings.verticalProvisioning.status).toBe('complete');
        expect(settings.verticalProvisioning.attempt).toBe(2);
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

    it('passes assertProvisioningInvariants when specialized agent template intentionally disables appointments', async () => {
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
                    bookingEnabled: true,
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
            definition.services,
            true,
        );

        expect(result).toBeDefined();
        expect(result.pipelineStages).toBe(6);
    });
});
