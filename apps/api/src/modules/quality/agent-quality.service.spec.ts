import { NotFoundException } from '@nestjs/common';
import { AGENT_CONFIG_TOOL_FAMILIES, AGENT_QUALITY_DIMENSIONS, AgentQualityOverview } from '@parallext/shared';
import { AgentQualityService } from './agent-quality.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'tenant_quality_test';
const NOW = new Date('2026-08-11T12:00:00.000Z');

const completeConfig: any = {
    language: 'es',
    persona: {
        name: 'Luna',
        role: 'asesora',
        personality: { tone: 'amable', formality: 'professional' },
        greeting: 'Hola, ¿cómo puedo ayudarte?',
        fallbackMessage: 'No tengo esa información; te comunico con una persona.',
    },
    behavior: {
        rules: ['Haz una pregunta por mensaje'],
        forbiddenTopics: ['Asesoría legal'],
        handoffTriggers: ['El cliente solicita una persona'],
    },
    rag: { enabled: true, chunkSize: 500, topK: 5, similarityThreshold: 0.65 },
    tools: {},
    hours: { is247: true },
    llm: { maxTokens: 800, temperature: 0.2 },
};

type HarnessOptions = {
    tenantSchema?: string | null;
    agent?: Record<string, any> | null;
    config?: any;
    company?: Record<string, any> | null;
    tenantSettings?: Record<string, any>;
    tenantUpdatedAt?: string;
    channelRows?: any[];
    failedQueries?: string[];
    widgetRows?: any[];
    whatsappCredential?: Record<string, any> | null;
    credentialRows?: Record<string, any>[];
    credentialLookupFails?: boolean;
    legacyWhatsAppRows?: any[];
    boundChannelBindings?: string[];
    activeHumans?: number;
    knowledgeChunks?: number;
    knowledgeUpdatedAt?: string | null;
    faqs?: number;
    policies?: number;
    privacyPolicies?: number;
    mediaProcessing?: { audioPerMonth: number; imagePerMonth: number };
    planLookupFails?: boolean;
    services?: number;
    slots?: number;
    testDriveServices?: number;
    testDriveSlots?: number;
    vehicles?: number;
    products?: number;
    orders?: number;
    offers?: number;
    boardingServices?: number;
    examplePriceServices?: number;
    examplePricePlans?: number;
    /** Active services / plans with no amount at all (confirmed or NULL status, `price IS NULL`). */
    noPriceServices?: number;
    noPricePlans?: number;
    industry?: string;
    paymentConfig?: { ready: boolean; activeProvider: string | null } | Error;
    verticalCatalogs?: Record<string, number>;
    latestEval?: Record<string, any> | null;
    latestSimulation?: Record<string, any> | null;
    attributionColumns?: boolean;
    quality?: Record<string, any>;
    conversations?: Record<string, any>;
    issueRows?: any[];
    tools?: Record<string, any>;
    gaps?: Record<string, any>;
    listRows?: any[];
    /**
     * What the pipeline's resolver (`readServingPersona`) answers for a
     * connection, keyed by `type:account`: the serving agent id, `null` = no
     * active agent, `'conflict'` = two owners, `'error'` = unreadable. Default:
     * the harness agent answers everything, as the default agent of a
     * single-agent tenant does.
     */
    serving?: Record<string, string | null>;
    /** The active agent that owns routing gaps. Default: the harness agent. */
    primaryAgentId?: string | null;
    rosterFails?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
    const agent = options.agent === null ? null : {
        id: AGENT_ID,
        name: 'Luna',
        is_active: true,
        config_json: options.config ?? completeConfig,
        channels: ['whatsapp'],
        channel_bindings: [],
        version: 2,
        updated_at: '2026-08-01T00:00:00.000Z',
        ...(options.agent || {}),
    };
    const latestEval = options.latestEval === null ? null : {
        id: 'eval-1',
        k: 5,
        threshold: 7,
        passed: true,
        avg_score: 8,
        eval_activable: true,
        trigger: 'manual',
        created_at: '2026-08-10T00:00:00.000Z',
        ...(options.latestEval || {}),
    };
    const latestSimulation = options.latestSimulation === null ? null : {
        id: 'sim-1',
        persona_version: 2,
        scenario_source: 'synthetic',
        status: 'completed',
        scenario_count: 10,
        avg_score: 8.4,
        resolved_rate: 0.8,
        created_at: '2026-08-10T00:00:00.000Z',
        completed_at: '2026-08-10T00:05:00.000Z',
        ...(options.latestSimulation || {}),
    };
    const calls: Array<{ query: string; params: any[] }> = [];
    const executeInTenantSchema = jest.fn(async (_schema: string, query: string, params: any[] = []) => {
        calls.push({ query, params });
        if (options.failedQueries?.some(part => query.includes(part))) throw new Error('Source unavailable');
        if (query.includes('SELECT id, name, is_default, is_active')) {
            return options.listRows ?? [{ id: AGENT_ID, name: 'Luna', is_default: true, is_active: true }];
        }
        if (query.includes('unnest(COALESCE(channel_bindings')) {
            return (options.boundChannelBindings ?? []).map((binding) => ({ binding }));
        }
        if (query.includes('WITH ranked AS')) {
            // readServingPersona's own query: shaped exactly as it reads it.
            const [binding] = params;
            const served = options.serving && binding in options.serving ? options.serving[binding] : AGENT_ID;
            if (served === 'error') throw new Error('resolution unavailable');
            const owner = (id: string) => ({ id, name: 'Agent', config_json: completeConfig, version: 2, channels: [],
                channel_bindings: [], schedule_mode: '24_7', is_active: true, is_default: false });
            const matches = served === null ? null
                : served === 'conflict' ? [owner('33333333-3333-4333-8333-333333333333'), owner('44444444-4444-4444-8444-444444444444')]
                    : [owner(served)];
            return [{ matches, has_agents: true, legacy_config: null }];
        }
        if (query.includes('ORDER BY is_default DESC, created_at ASC')) {
            if (options.rosterFails) throw new Error('roster unavailable');
            const primary = options.primaryAgentId === undefined ? AGENT_ID : options.primaryAgentId;
            return primary ? [{ id: primary }] : [];
        }
        if (query.includes('FROM agent_personas')) return agent ? [agent] : [];
        if (query.includes('FROM whatsapp_channels')) return options.legacyWhatsAppRows ?? [];
        if (query.includes('FROM companies')) {
            const company = options.company === null ? null : {
                name: 'Parallly Demo',
                about: 'Ayudamos a negocios a atender mejor.',
                phone: '+573001234567',
                email: null,
                website: null,
                address: null,
                updated_at: '2026-08-01T00:00:00.000Z',
                ...(options.company || {}),
            };
            return company ? [company] : [];
        }
        if (query.includes('FROM knowledge_embeddings')) return [{ count: options.knowledgeChunks ?? 1, updated_at: options.knowledgeUpdatedAt ?? '2026-08-01T00:00:00.000Z' }];
        if (query.includes('FROM faqs')) return [{ count: options.faqs ?? 0, updated_at: null }];
        if (query.includes('FROM policies')) return [{ count: options.policies ?? 0, privacy_count: options.privacyPolicies ?? 0, updated_at: null }];
        if (query.includes('FROM properties') && query.includes('tour_packages')) return [options.verticalCatalogs ?? {}];
        if (query.includes('FROM services') && query.includes('availability_slots')) return [{ services: options.services ?? 0, slots: options.slots ?? 0, example_price_services: options.examplePriceServices ?? 0, no_price_services: options.noPriceServices ?? 0, test_drive_services: options.testDriveServices ?? 0, test_drive_slots: options.testDriveSlots ?? 0, boarding_services: options.boardingServices ?? 0 }];
        if (query.includes('FROM membership_plans') && query.includes('price_status')) return [{ count: options.examplePricePlans ?? 0, no_price: options.noPricePlans ?? 0 }];
        if (query.includes('FROM vehicles')) return [{ count: options.vehicles ?? 0 }];
        if (query.includes('FROM products')) return [{ count: options.products ?? 0 }];
        if (query.includes('FROM orders')) return [{ count: options.orders ?? 0 }];
        if (query.includes('FROM commercial_offers')) return [{ count: options.offers ?? 0 }];
        if (query.includes('FROM eval_runs')) return latestEval ? [latestEval] : [];
        if (query.includes('FROM simulation_runs')) return latestSimulation ? [latestSimulation] : [];
        if (query.includes('information_schema.columns')) return [{
            quality_agent: options.attributionColumns ?? true,
            conversation_agent: options.attributionColumns ?? true,
            conversation_conflict: options.attributionColumns ?? true,
        }];
        if (query.includes('FROM conversation_quality_scores') && query.includes('AVG(overall_score)')) {
            return [{
                sample_size: 20,
                avg_overall: 8,
                verified_total: 20,
                verified_success: 18,
                attributed_since: '2026-08-02T00:00:00.000Z',
                ...(options.quality || {}),
            }];
        }
        if (query.includes('FROM conversations') && query.includes('AS conversations')) {
            return [{ conversations: 20, handoffs: 2, attributed_since: '2026-08-02T00:00:00.000Z', ...(options.conversations || {}) }];
        }
        if (query.includes('SELECT conversation_id, flags')) return options.issueRows ?? [];
        if (query.includes('FROM tool_execution_ledger')) {
            return [{ total: 100, failures: 0, reconciliations: 0, conversation_ids: [], ...(options.tools || {}) }];
        }
        if (query.includes('FROM kb_retrieval_log')) return [{ count: 0, conversation_ids: [], ...(options.gaps || {}) }];
        throw new Error(`Unhandled test SQL: ${query}`);
    });
    const prisma: any = {
        getTenantSchemaName: jest.fn().mockResolvedValue(options.tenantSchema === undefined ? SCHEMA : options.tenantSchema),
        executeInTenantSchema,
        tenant: {
            findUnique: jest.fn().mockResolvedValue({
                settings: options.tenantSettings ?? {
                    businessHours: { is247: true },
                    chatReasons: ['ventas'],
                    customerTypes: ['personas'],
                },
                industry: options.industry ?? 'saas',
                updatedAt: options.tenantUpdatedAt ?? '2026-08-01T00:00:00.000Z',
            }),
        },
        whatsappCredential: {
            findMany: jest.fn(() => options.credentialLookupFails
                ? Promise.reject(new Error('credential lookup failed'))
                : Promise.resolve(options.credentialRows
                    ?? (options.whatsappCredential === null ? [] : [{
                        credentialType: 'system_user_token',
                        rotationState: 'active',
                        expiresAt: null,
                        ...(options.whatsappCredential || {}),
                    }]))),
        },
        $queryRawUnsafe: jest.fn(async (query: string) => {
            if (options.failedQueries?.some(part => query.includes(part))) throw new Error('Source unavailable');
            if (query.includes('FROM channel_accounts')) {
                return options.channelRows ?? [{ channel_type: 'whatsapp', account_id: 'wa-1', waba_timezone: 'America/Bogota' }];
            }
            if (query.includes('widget_configs')) return options.widgetRows ?? [];
            if (query.includes('FROM users')) return [{ count: options.activeHumans ?? 1 }];
            throw new Error(`Unhandled global test SQL: ${query}`);
        }),
    };
    const throttle: any = {
        getPlanFeatures: jest.fn(() => options.planLookupFails
            ? Promise.reject(new Error('plan lookup failed'))
            : Promise.resolve({ mediaProcessing: options.mediaProcessing ?? { audioPerMonth: 0, imagePerMonth: 0 } })),
    };
    const tenantPayments: any = {
        getConfig: jest.fn(() => options.paymentConfig instanceof Error
            ? Promise.reject(options.paymentConfig)
            : Promise.resolve(options.paymentConfig ?? { ready: false, activeProvider: null })),
    };
    return { service: new AgentQualityService(prisma, throttle, tenantPayments), prisma, calls };
}

function check(overview: AgentQualityOverview, code: string) {
    return overview.preparation.dimensions.flatMap((dimension) => dimension.checks).find((item) => item.code === code)!;
}

describe('AgentQualityService', () => {
    it('names unsupported assignments without claiming the four live channels are disconnected', async () => {
        const channels = ['whatsapp', 'instagram', 'messenger', 'telegram'];
        const result = await createHarness({ agent: { channels: [...channels, 'email'] },
            channelRows: channels.map(channel_type => ({ channel_type, account_id: `${channel_type}-1`,
                has_account_token: true, metadata: { tokenExpiresAt: '2099-01-01T00:00:00Z' } })),
        }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(result, 'channel_connection')).toMatchObject({ status: 'pass', evidence: { assigned: 4, connected: 4 } });
        expect(check(result, 'operational_channel_scope')).toMatchObject({ status: 'fail',
            href: `/admin/agent/${AGENT_ID}?tab=persona&focus=channels`,
            evidence: { unsupportedAssignments: 1, unsupportedChannelTypes: 'email' } });
    });

    it.each([
        [{ aiOutsideHours: false, afterHoursMessageOverride: 'Volvemos mañana.' }, 'pass'],
        [{}, 'pass'], // Runtime defaults to answering outside business hours.
        [{ aiOutsideHours: false, afterHoursMessageOverride: '   ' }, 'warning'],
    ])('checks the effective after-hours behavior for %j', async (hours, expected) => {
        const result = await createHarness({ config: { ...completeConfig, hours },
            tenantSettings: { businessHours: { is247: false, schedule: { monday: { enabled: true, open: '09:00', close: '17:00' } } } },
        }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(result, 'business_hours').status).toBe('pass');
        expect(check(result, 'after_hours_behavior').status).toBe(expected);
    });

    it('diagnoses every configurable tool family, including the latest native operations', async () => {
        const tools = Object.fromEntries(AGENT_CONFIG_TOOL_FAMILIES.map(family => [family, { enabled: true }]));
        const result = await createHarness({
            config: { ...completeConfig, tools }, vehicles: 0, boardingServices: 0,
            paymentConfig: { ready: false, activeProvider: null },
        }).service.getOverview(TENANT_ID, AGENT_ID);
        const codes = new Set(result.preparation.dimensions.flatMap(dimension => dimension.checks.map(item => item.code)));
        for (const family of Object.keys(tools)) {
            const snake = family.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            expect(codes.has(family === 'knowledge' ? 'rag_knowledge' : `tool_${snake}`)).toBe(true);
        }
        expect(check(result, 'tool_vehicle_rentals')).toMatchObject({ status: 'fail', critical: true, href: '/admin/vehicles' });
        expect(check(result, 'tool_pet_boarding')).toMatchObject({ status: 'fail', critical: true, href: '/admin/service-catalog' });
        expect(check(result, 'tool_repair_orders')).toMatchObject({ status: 'pass' });
        expect(check(result, 'tool_payments')).toMatchObject({ status: 'fail', critical: true, href: '/admin/settings/integrations/payments' });
    });

    it('reports payment-provider inspection failures as unknown', async () => {
        const result = await createHarness({
            config: { ...completeConfig, tools: { payments: { enabled: true } } },
            paymentConfig: new Error('payment authority unavailable'),
        }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(result, 'tool_payments')).toMatchObject({ status: 'unknown', critical: true });
    });
    it('blocks media processing when the plan includes it but no active privacy policy exists', async () => {
        const result = await createHarness({
            mediaProcessing: { audioPerMonth: 100, imagePerMonth: 50 },
            policies: 2,
            privacyPolicies: 0,
        }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(result, 'media_privacy_policy')).toMatchObject({
            status: 'fail',
            critical: true,
            href: '/admin/settings/policies?type=privacy',
            evidence: { activePrivacyPolicies: 0, consentRequiredBeforeProcessing: true },
        });
        expect(result.preparation.criticalBlockers).toContain('media_privacy_policy');
    });

    it('passes media privacy readiness only with an active privacy policy', async () => {
        const result = await createHarness({
            mediaProcessing: { audioPerMonth: -1, imagePerMonth: 0 },
            policies: 1,
            privacyPolicies: 1,
        }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(result, 'media_privacy_policy')).toMatchObject({ status: 'pass', critical: true });
    });

    it('reports plan lookup failure as unknown instead of claiming media is disabled', async () => {
        const result = await createHarness({ planLookupFails: true }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(result, 'media_privacy_policy')).toMatchObject({ status: 'unknown', critical: true });
    });

    it('identifies test-drive prerequisites even when the general agenda has rows', async () => {
        const config = { ...completeConfig, tools: { vehicles: { enabled: true }, appointments: { enabled: true } } };
        const result = await createHarness({ config, services: 1, slots: 1, vehicles: 1 }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(result, 'tool_appointments').status).toBe('pass');
        expect(check(result, 'tool_vehicles').status).toBe('pass');
        expect(check(result, 'test_drive_service')).toMatchObject({ status: 'fail', href: '/admin/appointments?tab=services' });
        expect(check(result, 'test_drive_staff')).toMatchObject({ status: 'fail', href: '/admin/appointments?tab=config' });
    });
    it('keeps the intended test-drive mission pending when booking permission is disabled', async () => {
        const config = { ...completeConfig, tools: { vehicles: { enabled: true }, appointments: { enabled: false } } };
        const result = await createHarness({ config, vehicles: 1, testDriveServices: 1, testDriveSlots: 1 }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(result, 'test_drive_permissions')).toMatchObject({ status: 'fail', href: `/admin/agent/${AGENT_ID}` });
    });
    it('reports verified setup without claiming that the vehicle task has passed evaluation', async () => {
        const config = { ...completeConfig, tools: { vehicles: { enabled: true }, appointments: { enabled: true } } };
        const result = await createHarness({ config, vehicles: 1, testDriveServices: 1, testDriveSlots: 1, latestEval: null, latestSimulation: null }).service.getOverview(TENANT_ID, AGENT_ID);
        for (const code of ['tool_vehicles', 'test_drive_service', 'test_drive_staff', 'test_drive_permissions']) expect(check(result, code).status).toBe('pass');
        expect(result.tested.status).not.toBe('ready');
    });
    it('does not require booking for a mission explicitly limited to finding vehicles', async () => {
        const config = { ...completeConfig, mission: { intentKeys: ['find_vehicle'] }, tools: { vehicles: { enabled: true } } };
        const result = await createHarness({ config, vehicles: 1 }).service.getOverview(TENANT_ID, AGENT_ID);
        for (const code of ['test_drive_service', 'test_drive_staff', 'test_drive_permissions']) expect(check(result, code).status).toBe('not_applicable');
    });
    it('does not present failed inventory or schedule probes as empty data', async () => {
        const config = { ...completeConfig, tools: { vehicles: { enabled: true }, appointments: { enabled: true } } };
        const result = await createHarness({ config, failedQueries: ['FROM vehicles', 'availability_slots'] }).service.getOverview(TENANT_ID, AGENT_ID);
        for (const code of ['tool_vehicles', 'test_drive_service', 'test_drive_staff']) expect(check(result, code)).toMatchObject({ status: 'unknown', evidence: { sourceAvailability: 'unavailable' } });
    });
    beforeAll(() => jest.useFakeTimers().setSystemTime(NOW));
    afterAll(() => jest.useRealTimers());

    it('keeps unavailable readiness evidence distinct from verified missing configuration', async () => {
        const { service } = createHarness({ failedQueries: ['FROM companies', 'FROM knowledge_embeddings', 'FROM users', 'FROM channel_accounts'], legacyWhatsAppRows: [] });
        const result = await service.getOverview(TENANT_ID, AGENT_ID);
        for (const code of ['business_identity', 'rag_knowledge', 'human_handoff_route', 'channel_connection']) {
            expect(check(result, code)).toMatchObject({ status: 'unknown', evidence: { sourceAvailability: 'unavailable' } });
            expect(Object.values(check(result, code).evidence!)).not.toContain(0);
        }
        expect(check(result, 'knowledge_coverage').status).toBe('unknown');
        expect(check(result, 'persona_identity').status).toBe('pass');
    });

    it('preserves observed channel accounts without presenting a partial snapshot as a total', async () => {
        const { service } = createHarness({ failedQueries: ['widget_configs'] });
        await expect(service.getTenantChannelSnapshot(TENANT_ID)).resolves.toMatchObject({
            availability: 'partial', total: null, channels: [expect.objectContaining({ type: 'whatsapp', accounts: 1 })],
        });
        const { service: unavailable } = createHarness({ failedQueries: ['widget_configs', 'FROM channel_accounts', 'FROM whatsapp_channels'] });
        await expect(unavailable.getTenantChannelSnapshot(TENANT_ID)).resolves.toMatchObject({ availability: 'unavailable', total: null });
    });

    it('returns only the minimal tenant-scoped agent selector', async () => {
        const { service, calls } = createHarness({
            listRows: [{ id: AGENT_ID, name: 'Luna', is_default: false, is_active: true, config_json: { secret: 'must-not-leak' } }],
        });

        await expect(service.listAgents(TENANT_ID)).resolves.toEqual([
            { id: AGENT_ID, name: 'Luna', is_default: false, is_active: true },
        ]);
        const selector = calls.find((call) => call.query.includes('is_default'))!;
        expect(selector.query).not.toContain('config_json');
        expect(selector.params).toEqual([]);
    });

    it('rejects an agent outside the resolved tenant and uses a UUID parameter', async () => {
        const { service, calls } = createHarness({ agent: null });

        await expect(service.getOverview(TENANT_ID, AGENT_ID)).rejects.toBeInstanceOf(NotFoundException);
        const lookup = calls.find((call) => call.query.includes('FROM agent_personas'))!;
        expect(lookup.query).toContain('$1::uuid');
        expect(lookup.params).toEqual([AGENT_ID]);
    });

    it('evaluates the six fixed dimensions without averaging away their identity', async () => {
        const { service } = createHarness();

        const overview = await service.getOverview(TENANT_ID, AGENT_ID);
        expect(overview.preparation.dimensions.map((dimension) => dimension.dimension)).toEqual(AGENT_QUALITY_DIMENSIONS);
        expect(overview.preparation.status).toBe('ready');
        expect(overview.preparation.score).toBe(100);
    });

    it('lets a critical blocker override an otherwise high numeric score', async () => {
        const { service } = createHarness({ agent: { is_active: false } });

        const overview = await service.getOverview(TENANT_ID, AGENT_ID);
        expect(overview.preparation.criticalBlockers).toContain('agent_active');
        expect(overview.preparation.status).toBe('blocked');
        expect(overview.status).toBe('configuration_incomplete');
        expect(overview.nextMilestone).toBe('complete_configuration');
        expect(overview.preparation.score).toBeGreaterThan(80);
    });

    it('marks disabled optional tools N/A and excludes them from denominators', async () => {
        const { service } = createHarness();
        const overview = await service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'tool_appointments').status).toBe('not_applicable');
        expect(check(overview, 'tool_catalog').status).toBe('not_applicable');
        const allChecks = overview.preparation.dimensions.flatMap((dimension) => dimension.checks);
        expect(overview.preparation.applicable).toBe(allChecks.filter((item) => item.status !== 'not_applicable').length);
        expect(overview.preparation.applicable).toBeLessThan(allChecks.length);
    });

    it('blocks an enabled appointment tool without real availability and links to its setup', async () => {
        const config = { ...completeConfig, tools: { appointments: { enabled: true } } };
        const { service } = createHarness({ config, services: 1, slots: 0 });

        const overview = await service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(overview, 'tool_appointments')).toMatchObject({ status: 'fail', critical: true, href: '/admin/appointments?tab=config' });
        expect(overview.recommendations).toContainEqual(expect.objectContaining({ code: 'fix_tool_appointments', href: '/admin/appointments?tab=config' }));
    });

    it('opens the service editor when the appointment tool has no services yet', async () => {
        const config = { ...completeConfig, tools: { appointments: { enabled: true } } };
        const overview = await createHarness({ config, services: 0, slots: 0 }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(overview, 'tool_appointments')).toMatchObject({ status: 'fail', href: '/admin/appointments?tab=services' });
    });

    describe('services still carrying an example price', () => {
        const booking = { ...completeConfig, tools: { appointments: { enabled: true } } };

        it('warns, without blocking, while a recipe-seeded price is still unconfirmed', async () => {
            const { service } = createHarness({ config: booking, services: 1, slots: 1, examplePriceServices: 1 });
            const overview = await service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'services_example_price')).toMatchObject({
                status: 'warning', critical: false, weight: 2, href: '/admin/appointments?tab=services',
                evidence: { examplePriceServices: 1 },
            });
            expect(overview.recommendations).toContainEqual(expect.objectContaining({
                code: 'fix_services_example_price', severity: 'medium', href: '/admin/appointments?tab=services',
            }));
            // An example price is a number nobody agreed to, not a broken agenda:
            // the booking check keeps its own verdict and readiness stays untouched.
            expect(check(overview, 'tool_appointments')).toMatchObject({ status: 'pass', critical: true });
            expect(overview.preparation.criticalBlockers).not.toContain('services_example_price');
            expect(overview.preparation.status).toBe('needs_attention');
        });

        it('passes once every active service has a confirmed price', async () => {
            const { service } = createHarness({ config: booking, services: 1, slots: 1, examplePriceServices: 0 });
            const overview = await service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'services_example_price')).toMatchObject({ status: 'pass', critical: false, evidence: { examplePriceServices: 0 } });
            expect(overview.recommendations.map(item => item.code)).not.toContain('fix_services_example_price');
        });

        it('never joins the critical blockers, whatever the agenda looks like', async () => {
            for (const options of [
                { config: booking, services: 1, slots: 0, examplePriceServices: 1 },
                { config: booking, services: 0, slots: 0, examplePriceServices: 3 },
                { config: booking, failedQueries: ['availability_slots'] },
                { config: completeConfig, services: 2, examplePriceServices: 2 },
            ]) {
                const overview = await createHarness(options).service.getOverview(TENANT_ID, AGENT_ID);
                expect(check(overview, 'services_example_price').critical).toBe(false);
                expect(overview.preparation.criticalBlockers).not.toContain('services_example_price');
            }
        });

        it('steps aside when nothing quotes services, and reports a lost probe as unknown rather than confirmed', async () => {
            const idle = await createHarness({ config: completeConfig, services: 0, examplePriceServices: 0 }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(idle, 'services_example_price').status).toBe('not_applicable');

            // Booking is off, but a vertical tool can still quote these services.
            const quoting = await createHarness({ config: completeConfig, services: 2, examplePriceServices: 2 }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(quoting, 'services_example_price')).toMatchObject({ status: 'warning', critical: false });

            const lost = await createHarness({ config: booking, failedQueries: ['availability_slots'] }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(lost, 'services_example_price')).toMatchObject({ status: 'unknown', evidence: { sourceAvailability: 'unavailable' } });
        });

        it('counts gym membership plans still at the example price, and sends the owner to the memberships screen', async () => {
            // get_membership_plans withholds an unconfirmed amount like a
            // service's: a gym whose only pending prices are its plans has an
            // agent that cannot say what the membership costs.
            const gym = await createHarness({ config: completeConfig, services: 0, examplePriceServices: 0, examplePricePlans: 3 })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(gym, 'services_example_price')).toMatchObject({
                status: 'warning', critical: false, href: '/admin/memberships',
                evidence: { examplePriceServices: 0, examplePricePlans: 3 },
            });
            expect(gym.recommendations).toContainEqual(expect.objectContaining({ code: 'fix_services_example_price', href: '/admin/memberships' }));
            expect(gym.preparation.criticalBlockers).not.toContain('services_example_price');

            // Services pending too: their screen, and the evidence keeps both counts apart.
            const both = await createHarness({ config: booking, services: 1, slots: 1, examplePriceServices: 1, examplePricePlans: 2 })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(both, 'services_example_price')).toMatchObject({
                status: 'warning', href: '/admin/appointments?tab=services', evidence: { examplePriceServices: 1, examplePricePlans: 2 },
            });

            const confirmed = await createHarness({ config: completeConfig, services: 0, examplePriceServices: 0, examplePricePlans: 0 })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(confirmed, 'services_example_price').status).toBe('not_applicable');
        });

        it('a lost plan probe is unknown for a gym, and does not touch the services verdict of anyone else', async () => {
            const failedQueries = ['AS count FROM membership_plans'];
            const gym = await createHarness({ config: booking, industry: 'gimnasios', services: 1, slots: 1, examplePriceServices: 0, failedQueries })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(gym, 'services_example_price')).toMatchObject({ status: 'unknown', evidence: { sourceAvailability: 'unavailable' } });

            const clinic = await createHarness({ config: booking, services: 1, slots: 1, examplePriceServices: 0, failedQueries })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(clinic, 'services_example_price')).toMatchObject({ status: 'pass' });
            // The services counts come from their own probe and survive it.
            expect(check(clinic, 'tool_appointments')).toMatchObject({ status: 'pass' });
        });

        /**
         * A service created without a price (Assist never invents one) is
         * stored confirmed with NULL. Every customer projection reads it as "por
         * confirmar" and the panel shows "Sin precio" — and this check, counting
         * only `price_status = 'example'`, stayed green: no nudge anywhere.
         */
        it('counts a service with no amount at all, and keeps it apart from the example ones', async () => {
            const { service, calls } = createHarness({ config: booking, services: 2, slots: 1, examplePriceServices: 0, noPriceServices: 2 });
            const overview = await service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'services_example_price')).toMatchObject({
                status: 'warning', critical: false, href: '/admin/appointments?tab=services',
                evidence: { examplePriceServices: 0, examplePricePlans: 0, noPriceServices: 2, noPricePlans: 0 },
            });
            expect(overview.recommendations).toContainEqual(expect.objectContaining({
                code: 'fix_services_example_price', severity: 'medium', href: '/admin/appointments?tab=services',
            }));
            expect(overview.preparation.criticalBlockers).not.toContain('services_example_price');
            // The same reading as `customerFacingPrice`: not example, not quote, no amount.
            const probe = calls.find((call) => call.query.includes('AS no_price_services'))!.query.replace(/\s+/g, ' ');
            expect(probe).toContain("COALESCE(price_status, 'confirmed') NOT IN ('example', 'quote') AND price IS NULL");
        });

        it('a plan with no amount sends the owner to the memberships screen, like an example one', async () => {
            const overview = await createHarness({ config: completeConfig, services: 0, noPricePlans: 1 })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'services_example_price')).toMatchObject({
                status: 'warning', href: '/admin/memberships',
                evidence: { examplePriceServices: 0, examplePricePlans: 0, noPriceServices: 0, noPricePlans: 1 },
            });
        });

        it('passes only when nothing a customer could ask about is left without a price', async () => {
            const overview = await createHarness({ config: booking, services: 2, slots: 1, examplePriceServices: 0, noPriceServices: 0 })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'services_example_price')).toMatchObject({
                status: 'pass', evidence: { noPriceServices: 0, noPricePlans: 0 },
            });
        });
    });

    it('requires a custom prompt only when the editor is in prompt mode', async () => {
        const guided = await createHarness().service.getOverview(TENANT_ID, AGENT_ID);
        const promptConfig = {
            ...completeConfig,
            editorMode: 'prompt',
            customPrompt: '',
            persona: {},
            behavior: { ...completeConfig.behavior, rules: [], forbiddenTopics: [] },
        };
        const prompt = await createHarness({ config: promptConfig }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(guided, 'custom_prompt').status).toBe('not_applicable');
        expect(check(prompt, 'custom_prompt')).toMatchObject({ status: 'fail', critical: true });
        for (const code of ['persona_identity', 'brand_voice', 'greeting', 'fallback_message', 'behavior_rules', 'forbidden_topics']) {
            expect(check(prompt, code).status).toBe('not_applicable');
        }
        expect(prompt.preparation.criticalBlockers).not.toEqual(expect.arrayContaining([
            'persona_identity', 'fallback_message', 'behavior_rules',
        ]));
    });

    it('blocks invalid RAG settings when grounding is enabled', async () => {
        const config = { ...completeConfig, rag: { enabled: true, chunkSize: 0, topK: 0, similarityThreshold: 3 } };
        const overview = await createHarness({ config }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'rag_configuration')).toMatchObject({ status: 'fail', critical: true });
        expect(overview.preparation.criticalBlockers).toContain('rag_configuration');
    });

    it('does not block an agent whose WhatsApp works because Instagram was never connected', async () => {
        const overview = await createHarness({
            agent: { channels: ['whatsapp', 'instagram'] },
            channelRows: [{ channel_type: 'whatsapp', account_id: 'wa-1' }],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        // It can receive and answer on WhatsApp: that is not an outage.
        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'pass',
            evidence: { assigned: 2, connected: 1, connectedChannels: 'whatsapp' },
        });
        expect(overview.preparation.criticalBlockers).not.toContain('channel_connection');
        // The unusable assignment is still reported, but as coverage, not as a
        // critical action that sends the person to a page showing nothing wrong.
        expect(check(overview, 'channel_coverage')).toMatchObject({
            status: 'fail',
            critical: false,
            href: `/admin/agent/${AGENT_ID}`,
            evidence: { assigned: 2, connected: 1, disconnectedChannels: 'instagram', staleBindings: 0 },
        });
        expect(overview.recommendations).toContainEqual(expect.objectContaining({
            code: 'fix_channel_coverage', severity: 'high', href: `/admin/agent/${AGENT_ID}`,
        }));
    });

    it('blocks as critical only when no assignment can receive anything', async () => {
        const overview = await createHarness({
            agent: { channels: ['instagram'] },
            channelRows: [],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'fail',
            critical: true,
            evidence: { assigned: 1, connected: 0, connectedChannels: '' },
        });
        expect(overview.preparation.criticalBlockers).toContain('channel_connection');
    });

    it('separates a stale account binding from a disconnected channel type', async () => {
        const overview = await createHarness({
            agent: { channels: [], channel_bindings: ['whatsapp:wa-old', 'instagram:ig-1'] },
            channelRows: [
                { channel_type: 'whatsapp', account_id: 'wa-new' },
                { channel_type: 'instagram', account_id: 'ig-1', has_account_token: true, metadata: { tokenExpiresAt: '2026-09-01T00:00:00.000Z' } },
            ],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        // The number was reconnected under a new id: the type is live, the
        // binding is not. "Reasigná el número" is a different fix from "conectá
        // WhatsApp", so the evidence has to tell them apart.
        expect(check(overview, 'channel_coverage')).toMatchObject({
            status: 'fail',
            evidence: { assigned: 2, connected: 1, disconnectedChannels: 'whatsapp', staleBindings: 1 },
        });
        expect(check(overview, 'channel_connection').status).toBe('pass');
    });

    it('fails the connection check when the only assignment is a stale binding', async () => {
        const overview = await createHarness({
            agent: { channels: [], channel_bindings: ['whatsapp:wa-old'] },
            channelRows: [{ channel_type: 'whatsapp', account_id: 'wa-new' }],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'fail',
            evidence: { assigned: 1, connected: 0 },
        });
        expect(overview.preparation.criticalBlockers).toContain('channel_connection');
        // Nothing operational at all: coverage would only duplicate the action.
        expect(check(overview, 'channel_coverage').status).toBe('not_applicable');
    });

    it('leaves both channel checks aside when the agent has no assignment at all', async () => {
        const overview = await createHarness({
            agent: { channels: [], channel_bindings: [] },
            channelRows: [],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_assignment').status).toBe('fail');
        expect(check(overview, 'channel_connection').status).toBe('not_applicable');
        expect(check(overview, 'channel_coverage').status).toBe('not_applicable');
        expect(overview.preparation.criticalBlockers).toContain('channel_assignment');
        expect(overview.preparation.criticalBlockers).not.toContain('channel_connection');
    });

    it('deep-links every editor check to the field that has to change', async () => {
        const overview = await createHarness({
            config: {
                ...completeConfig,
                persona: { ...completeConfig.persona, name: '', fallbackMessage: '' },
                behavior: { rules: [], forbiddenTopics: [], handoffTriggers: [] },
            },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'persona_identity').href).toBe(`/admin/agent/${AGENT_ID}?tab=persona&focus=name`);
        expect(check(overview, 'fallback_message').href).toBe(`/admin/agent/${AGENT_ID}?tab=persona&focus=fallback`);
        expect(check(overview, 'behavior_rules').href).toBe(`/admin/agent/${AGENT_ID}?tab=instructions&focus=rules`);
        expect(check(overview, 'handoff_triggers').href).toBe(`/admin/agent/${AGENT_ID}?tab=instructions&focus=handoff`);
        expect(check(overview, 'channel_assignment').href).toBe(`/admin/agent/${AGENT_ID}?tab=persona&focus=channels`);
    });

    it('describes the tenant channels for the assistant without identifying any account', async () => {
        const snapshot = await createHarness({
            channelRows: [
                { channel_type: 'whatsapp', account_id: 'wa-1', display_name: '+57 300 1234567' },
                { channel_type: 'instagram', account_id: 'ig-a', has_account_token: true, metadata: { tokenExpiresAt: '2026-08-11T11:59:59.000Z' } },
                { channel_type: 'instagram', account_id: 'ig-b', has_account_token: true, metadata: { tokenExpiresAt: '2026-10-01T00:00:00.000Z' } },
            ],
        }).service.getTenantChannelSnapshot(TENANT_ID);

        expect(snapshot).toMatchObject({
            total: 3,
            channels: [
                // Worst account of the type wins: one expired token is not hidden
                // behind a healthy sibling.
                { type: 'instagram', accounts: 2, health: 'expired' },
                { type: 'whatsapp', accounts: 1, health: 'ok' },
            ],
        });
        expect(snapshot.generatedAt).toBe(NOW.toISOString());
        const serialized = JSON.stringify(snapshot);
        for (const secret of ['wa-1', 'ig-a', 'ig-b', '+57 300 1234567', 'account_id', 'display_name']) {
            expect(serialized).not.toContain(secret);
        }
    });

    it('recognizes an active web widget as an operational connected channel', async () => {
        const overview = await createHarness({
            agent: { channels: ['web_widget'] },
            channelRows: [],
            widgetRows: [{ channel_type: 'web_widget', account_id: 'widget-1' }],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_assignment').status).toBe('pass');
        expect(check(overview, 'operational_channel_scope').status).toBe('pass');
        expect(check(overview, 'channel_connection').status).toBe('pass');
    });

    it('accepts an active WhatsApp account when its latest system-user credential is healthy', async () => {
        const { service, prisma } = createHarness({
            whatsappCredential: {
                rotationState: 'active',
                expiresAt: '2026-09-01T00:00:00.000Z',
                encryptedValue: 'must-not-leak',
            },
        });

        const overview = await service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'pass',
            evidence: {
                assigned: 1,
                connected: 1,
                credentialAffectedAssignments: 0,
                hasCredentialIssue: false,
                credentialIssue: null,
            },
        });
        expect(prisma.whatsappCredential.findMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, credentialType: { in: [
                'system_user_token', 'instagram_token', 'messenger_token', 'telegram_token',
            ] } },
            orderBy: { createdAt: 'desc' },
            select: { credentialType: true, rotationState: true, expiresAt: true },
        });
        expect(JSON.stringify(check(overview, 'channel_connection').evidence)).not.toContain('must-not-leak');
    });

    it.each(['error', 'revoked'] as const)(
        'rejects an active WhatsApp account when its system-user credential is %s',
        async (rotationState) => {
            const overview = await createHarness({
                whatsappCredential: { rotationState, expiresAt: null },
            }).service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'channel_connection')).toMatchObject({
                status: 'fail',
                evidence: {
                    assigned: 1,
                    connected: 0,
                    credentialAffectedAssignments: 1,
                    hasCredentialIssue: true,
                    credentialIssue: rotationState,
                },
            });
            expect(overview.preparation.criticalBlockers).toContain('channel_connection');
        },
    );

    it('rejects an active WhatsApp account when its system-user credential is expired', async () => {
        const overview = await createHarness({
            whatsappCredential: { rotationState: 'active', expiresAt: '2026-08-11T11:59:59.000Z' },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'fail',
            evidence: {
                assigned: 1,
                connected: 0,
                credentialAffectedAssignments: 1,
                hasCredentialIssue: true,
                credentialIssue: 'expired',
            },
        });
    });

    it.each([
        ['instagram', 'instagram_token', 'revoked'],
        ['messenger', 'messenger_token', 'error'],
        ['telegram', 'telegram_token', 'expired'],
    ] as const)('rejects an active %s account when its own credential is unhealthy', async (
        channel,
        credentialType,
        issue,
    ) => {
        const overview = await createHarness({
            agent: { channels: [channel] },
            channelRows: [{ channel_type: channel, account_id: `${channel}-1` }],
            credentialRows: [{
                credentialType,
                rotationState: issue === 'expired' ? 'active' : issue,
                expiresAt: issue === 'expired' ? '2026-08-11T11:59:59.000Z' : null,
            }],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'fail',
            evidence: {
                assigned: 1,
                connected: 0,
                credentialAffectedAssignments: 1,
                hasCredentialIssue: true,
                credentialIssue: issue,
            },
        });
    });

    it.each([
        ['missing', { whatsappCredential: null }],
        ['unknown', { credentialLookupFails: true }],
    ] as const)('does not report healthy when a connected WhatsApp credential is %s', async (
        issue,
        harnessOptions,
    ) => {
        const overview = await createHarness(harnessOptions).service.getOverview(TENANT_ID, AGENT_ID);
        expect(check(overview, 'channel_connection')).toMatchObject({
            status: issue === 'missing' ? 'fail' : 'warning',
            evidence: {
                hasCredentialIssue: true,
                credentialIssue: issue,
            },
        });
    });

    it('evaluates Instagram credentials per account binding instead of one tenant-wide token', async () => {
        const overview = await createHarness({
            agent: { channels: [], channel_bindings: ['instagram:ig-a'] },
            channelRows: [
                {
                    channel_type: 'instagram', account_id: 'ig-a', has_account_token: true,
                    metadata: { tokenExpiresAt: '2026-08-11T11:59:59.000Z' },
                },
                {
                    channel_type: 'instagram', account_id: 'ig-b', has_account_token: true,
                    metadata: { tokenExpiresAt: '2026-09-01T00:00:00.000Z' },
                },
            ],
            credentialRows: [{
                credentialType: 'instagram_token', rotationState: 'active', expiresAt: '2026-09-01T00:00:00.000Z',
            }],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'fail',
            evidence: { connected: 0, credentialIssue: 'expired' },
        });
    });

    it('fails a legacy type-level Instagram assignment when any unbound account is expired', async () => {
        const overview = await createHarness({
            agent: { channels: ['instagram'], channel_bindings: [] },
            channelRows: [
                {
                    channel_type: 'instagram', account_id: 'ig-a', has_account_token: true,
                    metadata: { tokenExpiresAt: '2026-08-11T11:59:59.000Z' },
                },
                {
                    channel_type: 'instagram', account_id: 'ig-b', has_account_token: true,
                    metadata: { tokenExpiresAt: '2026-09-01T00:00:00.000Z' },
                },
            ],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'fail',
            evidence: { connected: 0, credentialIssue: 'expired' },
        });
    });

    it('does not charge a legacy channel fallback for an unhealthy account bound to another agent', async () => {
        const overview = await createHarness({
            agent: { channels: ['instagram'], channel_bindings: [] },
            boundChannelBindings: ['instagram:ig-a'],
            channelRows: [
                {
                    channel_type: 'instagram', account_id: 'ig-a', has_account_token: true,
                    metadata: { tokenExpiresAt: '2026-08-11T11:59:59.000Z' },
                },
                {
                    channel_type: 'instagram', account_id: 'ig-b', has_account_token: true,
                    metadata: { tokenExpiresAt: '2026-09-01T00:00:00.000Z' },
                },
            ],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'pass',
            evidence: { connected: 1, hasCredentialIssue: false },
        });
    });

    it('warns before a credential expires without claiming it is healthy', async () => {
        const overview = await createHarness({
            whatsappCredential: { rotationState: 'active', expiresAt: '2026-08-17T12:00:00.000Z' },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_connection')).toMatchObject({
            status: 'warning',
            evidence: { connected: 1, credentialWarningAssignments: 1, credentialIssue: 'expiring' },
        });
    });

    it('does not count Email or SMS as certified conversational assignments', async () => {
        const overview = await createHarness({
            agent: { channels: ['email', 'sms'] },
            channelRows: [{ channel_type: 'email', account_id: 'email-1' }],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'channel_assignment').status).toBe('fail');
        expect(check(overview, 'operational_channel_scope').status).toBe('fail');
    });

    it('marks tests stale by dates and by the exact simulation persona version', async () => {
        const overview = await createHarness({
            agent: { version: 3, updated_at: '2026-08-10T00:00:00.000Z' },
            latestEval: { created_at: '2026-08-09T00:00:00.000Z' },
            latestSimulation: { persona_version: 2, created_at: '2026-08-11T00:00:00.000Z', completed_at: '2026-08-11T00:05:00.000Z' },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.tested.status).toBe('stale');
        expect(overview.tested.staleReasons).toEqual(expect.arrayContaining([
            'agent_configuration_changed_after_eval',
            'simulation_persona_version_mismatch',
        ]));
        expect(overview.status).toBe('review_required');
    });

    it('marks an eval stale when business or knowledge changed after its date', async () => {
        const overview = await createHarness({
            knowledgeUpdatedAt: '2026-08-11T01:00:00.000Z',
            latestEval: { created_at: '2026-08-10T00:00:00.000Z' },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.tested.staleReasons).toContain('business_or_knowledge_changed_after_eval');
    });

    it('degrades gracefully when attribution columns have not rolled out', async () => {
        const overview = await createHarness({ attributionColumns: false }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.production).toMatchObject({ status: 'insufficient_evidence', sampleSize: 0, observedScore: null });
        expect(overview.status).toBe('ready_for_pilot');
        expect(overview.recommendations).toContainEqual(expect.objectContaining({ code: 'collect_production_evidence' }));
    });

    it('requires at least twenty current-version QA samples before exposing an observed score', async () => {
        const overview = await createHarness({ quality: { sample_size: 19, avg_overall: 9 } }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.production).toMatchObject({ status: 'insufficient_evidence', sampleSize: 19, minimumSample: 20, observedScore: null });
    });

    it('groups judge flag variants into a stable PII-safe taxonomy with source IDs', async () => {
        const overview = await createHarness({
            issueRows: [
                { conversation_id: 'conv-1', flags: ['Inventó un precio para Juan'], overall_score: 5, resolution_verified: true },
                { conversation_id: 'conv-2', flags: ['Información incorrecta: juan@example.com'], overall_score: 7, resolution_verified: true },
                { conversation_id: 'conv-3', flags: ['No resolvió la necesidad'], overall_score: 5, resolution_verified: false },
            ],
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.production.topIssues).toContainEqual({
            code: 'qa_knowledge_accuracy',
            label: 'qa_knowledge_accuracy',
            count: 2,
            conversationIds: ['conv-1', 'conv-2'],
        });
        expect(overview.production.topIssues).toContainEqual(expect.objectContaining({ code: 'qa_unresolved_need', count: 1 }));
        expect(JSON.stringify(overview)).not.toContain('juan@example.com');
        expect(JSON.stringify(overview)).not.toContain('Inventó un precio');
    });

    it('keeps handoff separate and does not turn one isolated tool failure into global risk', async () => {
        const overview = await createHarness({
            conversations: { conversations: 20, handoffs: 5 },
            tools: { total: 100, failures: 1, reconciliations: 0, conversation_ids: ['conv-tool'] },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.production.status).toBe('evidenced');
        expect(overview.production.metrics).toContainEqual(expect.objectContaining({ code: 'handoff_rate', value: 25 }));
        expect(overview.production.metrics).toContainEqual(expect.objectContaining({ code: 'tool_failure_rate', value: 1 }));
        expect(overview.recommendations).toContainEqual(expect.objectContaining({ code: 'review_tool_failures', severity: 'medium' }));
    });

    it('never calls production evidenced when verified resolution is zero', async () => {
        const overview = await createHarness({
            quality: { sample_size: 20, avg_overall: 8, verified_total: 20, verified_success: 0 },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.production.status).toBe('needs_attention');
        expect(overview.status).toBe('at_risk');
        expect(overview.recommendations).toContainEqual(expect.objectContaining({
            code: 'improve_verified_resolution',
            severity: 'critical',
        }));
    });

    it('does not certify operations from high text-only scores with unknown outcomes', async () => {
        const overview = await createHarness({
            quality: { sample_size: 50, avg_overall: 9.8, verified_total: 0, verified_success: 0 },
        }).service.getOverview(TENANT_ID, AGENT_ID);
        expect(overview.production.status).toBe('insufficient_evidence');
        expect(overview.production.metrics).toContainEqual(expect.objectContaining({code:'verified_resolution_rate',value:null,denominator:0}));
        expect(overview.recommendations.some(item=>item.code==='improve_verified_resolution')).toBe(false);
    });

    it('elevates critical production reconciliation evidence to at risk', async () => {
        const overview = await createHarness({
            tools: { total: 20, failures: 1, reconciliations: 1, conversation_ids: ['conv-tool'] },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.production.status).toBe('needs_attention');
        expect(overview.status).toBe('at_risk');
    });

    it('treats reconciliation-required as critical before the QA sample threshold', async () => {
        const overview = await createHarness({
            quality: { sample_size: 3, avg_overall: 8, verified_total: 3, verified_success: 3 },
            tools: { total: 1, failures: 1, reconciliations: 1, conversation_ids: ['conv-tool'] },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.production.status).toBe('insufficient_evidence');
        expect(overview.status).toBe('at_risk');
        expect(overview.recommendations).toContainEqual(expect.objectContaining({
            code: 'review_tool_failures', severity: 'critical',
        }));
    });

    it('surfaces recurring/reconciliation tool failures and attributed KB sentinel gaps', async () => {
        const overview = await createHarness({
            tools: { total: 10, failures: 3, reconciliations: 1, conversation_ids: ['conv-tool-1', 'conv-tool-2'] },
            gaps: { count: 2, conversation_ids: ['conv-gap-1', 'conv-gap-2'] },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.production.status).toBe('needs_attention');
        expect(overview.status).toBe('at_risk');
        expect(overview.recommendations).toContainEqual(expect.objectContaining({
            code: 'review_tool_failures', severity: 'critical', evidenceCount: 3,
            conversationIds: ['conv-tool-1', 'conv-tool-2'],
        }));
        expect(overview.recommendations).toContainEqual(expect.objectContaining({
            code: 'resolve_knowledge_gaps', evidenceCount: 2,
            conversationIds: ['conv-gap-1', 'conv-gap-2'],
        }));
    });

    it('reports a current failed eval as at risk', async () => {
        const overview = await createHarness({ latestEval: { passed: false, eval_activable: false, avg_score: 4 } }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(overview.tested.status).toBe('blocked');
        expect(overview.status).toBe('at_risk');
        expect(overview.nextMilestone).toBe('pass_critical_tests');
    });

    it('does not let a noncritical configuration warning mask a failed eval', async () => {
        const overview = await createHarness({
            company: { phone: null, email: null, website: null, address: null },
            latestEval: { passed: false, eval_activable: false, avg_score: 4 },
        }).service.getOverview(TENANT_ID, AGENT_ID);

        expect(check(overview, 'business_contact').status).toBe('warning');
        expect(overview.preparation.status).toBe('needs_attention');
        expect(overview.status).toBe('at_risk');
        expect(overview.nextMilestone).toBe('pass_critical_tests');
    });

    it('parameterizes every production attribution query by current agent and config version', async () => {
        const { service, calls } = createHarness();
        await service.getOverview(TENANT_ID, AGENT_ID);

        const productionCalls = calls.filter((call) =>
            call.query.includes('conversation_quality_scores') && !call.query.includes('information_schema')
            || call.query.includes('AS conversations')
            || call.query.includes('tool_execution_ledger')
            || call.query.includes('kb_retrieval_log'),
        );
        expect(productionCalls).toHaveLength(5);
        for (const call of productionCalls) {
            expect(call.params.slice(0,2)).toEqual([AGENT_ID, 2]);
            if (call.query.includes('FROM conversation_quality_scores')) {
                expect(call.params[2]).toMatch(/^[a-f0-9]{64}$/);
                expect(call.query).toContain('cqs.rubric_hash = $3');
            } else expect(call.params).toHaveLength(2);
            expect(call.query).toContain('$1::uuid');
            expect(call.query).toContain('agent_config_version = $2');
            expect(call.query).toContain('agent_attribution_conflicted');
        }
        const gapQuery = productionCalls.find((call) => call.query.includes('kb_retrieval_log'))!.query;
        expect(gapQuery).toContain('krl.document_id IS NULL');
        expect(gapQuery).toContain('krl.was_used = false');
        expect(gapQuery).not.toContain('kb_unanswered_queries');
    });

    it('counts only the latest QA score for each conversation', async () => {
        const { service, calls } = createHarness();
        await service.getOverview(TENANT_ID, AGENT_ID);

        const qualityQueries = calls.filter((call) =>
            call.query.includes('FROM conversation_quality_scores')
            && !call.query.includes('information_schema'),
        );
        expect(qualityQueries).toHaveLength(2);
        for (const call of qualityQueries) {
            expect(call.query).toContain('SELECT DISTINCT ON (cqs.conversation_id)');
            expect(call.query).toContain('ORDER BY cqs.conversation_id, cqs.created_at DESC');
        }
    });

    /**
     * Ola 6: the quality data has to be able to say "your agent cannot answer".
     * Two outages were invisible here — a connection no agent answers, and a
     * WhatsApp number whose every reply the send admission refuses.
     */
    /**
     * Who answers a connection is `readServingPersona`'s answer, and on a
     * multi-agent tenant the DEFAULT agent answers every connection nobody else
     * claims — without being assigned to it (`bindDefaultAgentToChannel` only
     * assigns when it is the one active agent). Judging it by its explicit
     * list alone raised a false critical on a working tenant, and hid a real
     * one: an expired credential on a connection it answers.
     */
    describe('the default agent answering a connection by fallback', () => {
        const OTHER_AGENT = '55555555-5555-4555-8555-555555555555';
        const whatsapp = { channel_type: 'whatsapp', account_id: 'wa-1', waba_timezone: 'America/Bogota' };
        const instagram = (tokenExpiresAt: string) => ({
            channel_type: 'instagram', account_id: 'ig-1', has_account_token: true, metadata: { tokenExpiresAt },
        });

        it('passes channel_assignment for the agent that answers WhatsApp without being assigned to it', async () => {
            const overview = await createHarness({
                agent: { channels: [], channel_bindings: [], is_default: true },
                channelRows: [whatsapp, instagram('2099-01-01T00:00:00.000Z')],
                // Instagram belongs to another agent; WhatsApp falls to the default one.
                serving: { 'whatsapp:wa-1': AGENT_ID, 'instagram:ig-1': OTHER_AGENT },
            }).service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'channel_assignment')).toMatchObject({
                status: 'pass', critical: true, evidence: { assigned: 0, servedByFallback: 1 },
            });
            expect(check(overview, 'channel_connection')).toMatchObject({
                status: 'pass', evidence: { assigned: 0, servedByFallback: 1, connected: 1, connectedChannels: 'whatsapp' },
            });
            expect(overview.preparation.criticalBlockers).not.toContain('channel_assignment');
            expect(overview.preparation.criticalBlockers).not.toContain('channel_connection');
        });

        it('fails channel_connection when a connection it answers by fallback has an expired credential', async () => {
            const overview = await createHarness({
                agent: { channels: [], channel_bindings: [], is_default: true },
                channelRows: [instagram('2026-08-01T00:00:00.000Z')],
                serving: { 'instagram:ig-1': AGENT_ID },
            }).service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'channel_assignment').status).toBe('pass');
            expect(check(overview, 'channel_connection')).toMatchObject({
                status: 'fail', critical: true,
                evidence: { assigned: 0, servedByFallback: 1, connected: 0, credentialAffectedAssignments: 1, credentialIssue: 'expired' },
            });
            expect(overview.preparation.criticalBlockers).toContain('channel_connection');
        });

        it('sees the expired credential next to a healthy assigned channel, too', async () => {
            const overview = await createHarness({
                agent: { channels: ['whatsapp'], channel_bindings: [], is_default: true },
                channelRows: [whatsapp, instagram('2026-08-01T00:00:00.000Z')],
                serving: { 'whatsapp:wa-1': AGENT_ID, 'instagram:ig-1': AGENT_ID },
            }).service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'channel_connection')).toMatchObject({
                status: 'fail', evidence: { assigned: 1, servedByFallback: 1, credentialAffectedAssignments: 1 },
            });
        });

        it('keeps the assignment coverage about the assignments', async () => {
            // Assigned to an Instagram that is not connected, answering WhatsApp
            // by fallback: it works, so no outage — the unconnected assignment
            // is coverage, counted over the assignments alone.
            const overview = await createHarness({
                agent: { channels: ['instagram'], channel_bindings: [], is_default: true },
                channelRows: [whatsapp],
                serving: { 'whatsapp:wa-1': AGENT_ID },
            }).service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'channel_connection').status).toBe('pass');
            expect(check(overview, 'channel_coverage')).toMatchObject({
                status: 'fail', critical: false, evidence: { assigned: 1, connected: 0, disconnectedChannels: 'instagram' },
            });
        });

        it('still fails an agent that answers nothing: not default, nothing assigned', async () => {
            const overview = await createHarness({
                agent: { channels: [], channel_bindings: [], is_default: false },
                channelRows: [whatsapp],
                serving: { 'whatsapp:wa-1': OTHER_AGENT },
            }).service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'channel_assignment')).toMatchObject({ status: 'fail', evidence: { assigned: 0, servedByFallback: 0 } });
            expect(check(overview, 'channel_connection').status).toBe('not_applicable');
            expect(overview.preparation.criticalBlockers).toContain('channel_assignment');
        });

        it('still fails a single-agent tenant with nothing connected: there is nobody to answer', async () => {
            const overview = await createHarness({
                agent: { channels: [], channel_bindings: [], is_default: true },
                channelRows: [],
            }).service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'channel_assignment')).toMatchObject({ status: 'fail', evidence: { assigned: 0, servedByFallback: 0 } });
            expect(check(overview, 'channel_connection').status).toBe('not_applicable');
        });

        it('says unknown, not "answers nobody", when the default agent\'s routing could not be read', async () => {
            const overview = await createHarness({
                agent: { channels: [], channel_bindings: [], is_default: true },
                channelRows: [whatsapp],
                serving: { 'whatsapp:wa-1': 'error' },
            }).service.getOverview(TENANT_ID, AGENT_ID);

            expect(check(overview, 'channel_assignment').status).toBe('unknown');
        });
    });

    describe('a connection nobody answers (channel_unanswered)', () => {
        const widget = { channel_type: 'web_widget', account_id: 'wgt_1' };
        const whatsapp = { channel_type: 'whatsapp', account_id: 'wa-1', waba_timezone: 'America/Bogota' };

        it('never fires on a single-agent tenant: the default agent answers what it is not assigned to', async () => {
            // Assigned to the web chat only, WhatsApp connected: the resolver
            // still hands WhatsApp to the default agent.
            const overview = await createHarness({
                agent: { channels: ['web_widget'], is_default: true }, widgetRows: [widget], channelRows: [whatsapp],
            }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'channel_unanswered')).toMatchObject({
                status: 'pass', critical: true, evidence: { connected: 2, unanswered: 0, unansweredChannels: '' },
            });
            expect(overview.preparation.criticalBlockers).not.toContain('channel_unanswered');
        });

        it('fails critically when WhatsApp is connected and no active agent answers it', async () => {
            const { service, calls } = createHarness({
                agent: { channels: ['web_widget'] }, widgetRows: [widget], channelRows: [whatsapp],
                serving: { 'whatsapp:wa-1': null },
            });
            const overview = await service.getOverview(TENANT_ID, AGENT_ID);
            // The gap this closes: the agent's own assignment is fine.
            expect(check(overview, 'channel_connection').status).toBe('pass');
            expect(check(overview, 'channel_unanswered')).toMatchObject({
                status: 'fail', critical: true,
                href: `/admin/agent/${AGENT_ID}?tab=persona&focus=channels`,
                evidence: { connected: 2, unanswered: 1, conflicted: 0, unresolved: 0, unansweredChannels: 'whatsapp' },
            });
            expect(overview.preparation.criticalBlockers).toContain('channel_unanswered');
            expect(overview.recommendations).toContainEqual(expect.objectContaining({
                code: 'fix_channel_unanswered', severity: 'critical', checkStatus: 'fail',
            }));
            // Asked of the pipeline's own resolver, per exact connection.
            const resolutions = calls.filter((call) => call.query.includes('WITH ranked AS'));
            expect(resolutions.map((call) => call.params)).toEqual(expect.arrayContaining([
                ['whatsapp:wa-1', 'whatsapp'], ['web_widget:wgt_1', 'web_widget'],
            ]));
        });

        it('is one signal for one cause: only the primary agent carries it', async () => {
            const overview = await createHarness({
                agent: { channels: ['web_widget'] }, widgetRows: [widget], channelRows: [whatsapp],
                serving: { 'whatsapp:wa-1': null }, primaryAgentId: '55555555-5555-4555-8555-555555555555',
            }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'channel_unanswered').status).toBe('not_applicable');
        });

        it('counts two owners of one connection as unanswered: the pipeline refuses to pick', async () => {
            const overview = await createHarness({ serving: { 'whatsapp:wa-1': 'conflict' } })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'channel_unanswered')).toMatchObject({
                status: 'fail', evidence: { unanswered: 0, conflicted: 1, unansweredChannels: 'whatsapp' },
            });
        });

        it('an unreadable resolution is unknown, never a claim of silence', async () => {
            const overview = await createHarness({ serving: { 'whatsapp:wa-1': 'error' } })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'channel_unanswered')).toMatchObject({ status: 'unknown', evidence: { unresolved: 1 } });
            expect(overview.recommendations).toContainEqual(expect.objectContaining({
                code: 'fix_channel_unanswered', severity: 'critical', checkStatus: 'unknown',
            }));
        });

        it('with the roster unreadable, the default agent is the one that carries it', async () => {
            const asDefault = await createHarness({ rosterFails: true, agent: { is_default: true }, serving: { 'whatsapp:wa-1': null } })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(asDefault, 'channel_unanswered').status).toBe('fail');
            const other = await createHarness({ rosterFails: true, agent: { is_default: false }, serving: { 'whatsapp:wa-1': null } })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(other, 'channel_unanswered').status).toBe('not_applicable');
        });

        it('stays out of the way of an agent that is switched off', async () => {
            const overview = await createHarness({ agent: { is_active: false }, serving: { 'whatsapp:wa-1': null } })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'channel_unanswered').status).toBe('not_applicable');
        });
    });

    describe('a WhatsApp number that cannot deliver (whatsapp_delivery)', () => {
        const established = { billingCurrencyEvidence: { currency: 'COP', source: 'meta_waba', observedAt: '2026-09-10T00:00:00.000Z' } };
        const number = (over: Record<string, any> = {}) => ({
            channel_type: 'whatsapp', account_id: 'wa-1', waba_timezone: 'America/Bogota', metadata: established, ...over,
        });
        const livePause = {
            reason: 'funding_not_ready', code: 131042, detail: 'payment issue', since: '2026-09-16T10:00:00.000Z',
            source: 'status_webhook', observations: 3, lastSeen: '2026-09-17T09:00:00.000Z',
        };

        it('passes a number the admission lets through', async () => {
            const overview = await createHarness({ channelRows: [number()] }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'whatsapp_delivery')).toMatchObject({
                status: 'pass', critical: true, href: '/admin/channels/whatsapp',
                evidence: { whatsappNumbers: 1, blockedNumbers: 0, reason: null, reasons: '', enforcement: 'observe' },
            });
        });

        it.each([[null], [''], ['Not/AZone']])('fails critically with no usable billing time zone (%p), even in observe', async (zone) => {
            const overview = await createHarness({ channelRows: [number({ waba_timezone: zone })] })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'whatsapp_delivery')).toMatchObject({
                status: 'fail', critical: true, href: '/admin/channels/whatsapp',
                evidence: { blockedNumbers: 1, reason: 'timezone_missing', enforcement: 'observe' },
            });
            expect(overview.preparation.criticalBlockers).toContain('whatsapp_delivery');
            expect(overview.recommendations).toContainEqual(expect.objectContaining({
                code: 'fix_whatsapp_delivery', severity: 'critical', checkStatus: 'fail', href: '/admin/channels/whatsapp',
                params: expect.objectContaining({ reason: 'timezone_missing' }),
            }));
        });

        it('fails on a live funding pause, and not on a cleared one', async () => {
            const paused = await createHarness({ channelRows: [number({ metadata: { ...established, sendPause: livePause } })] })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(paused, 'whatsapp_delivery')).toMatchObject({
                status: 'fail', evidence: { reason: 'funding_restricted', fundingState: 'restricted' },
            });
            const cleared = await createHarness({ channelRows: [number({
                metadata: { ...established, sendPause: { ...livePause, clearedAt: '2026-09-17T10:00:00.000Z', clearedBy: 'operator' } },
            })] }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(cleared, 'whatsapp_delivery').status).toBe('pass');
        });

        it('reports an unestablished currency only when the tenant enforces spend protection', async () => {
            const row = number({ metadata: {} });
            const observe = await createHarness({ channelRows: [row] }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(observe, 'whatsapp_delivery').status).toBe('pass');
            const enforce = await createHarness({
                channelRows: [row],
                tenantSettings: { businessHours: { is247: true }, chatReasons: ['ventas'], customerTypes: ['personas'], whatsappSpend: { enforcement: 'enforce' } },
            }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(enforce, 'whatsapp_delivery')).toMatchObject({
                status: 'fail', evidence: { reason: 'currency_unknown', enforcement: 'enforce' },
            });
        });

        it('names every reason when there is more than one', async () => {
            const overview = await createHarness({
                channelRows: [number({ waba_timezone: null, metadata: { ...established, sendPause: livePause } })],
            }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'whatsapp_delivery').evidence).toMatchObject({
                reason: 'multiple', reasons: 'funding_restricted,timezone_missing',
            });
        });

        describe('a WABA Meta answered has no payment method', () => {
            afterEach(() => jest.useRealTimers());
            const absentOn = (checkedAt: string) => number({ metadata: {
                ...established, wabaId: 'waba-1',
                fundingReadiness: { state: 'absent', source: 'graph_account_read', checkedAt, wabaId: 'waba-1' },
            } });
            const freeze = (iso: string) => jest.useFakeTimers({
                now: new Date(iso), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'],
            });

            it('is a warning before 1-oct: it still delivers today', async () => {
                freeze('2026-09-20T15:00:00.000Z');
                const overview = await createHarness({ channelRows: [absentOn('2026-09-20T14:00:00.000Z')] })
                    .service.getOverview(TENANT_ID, AGENT_ID);
                expect(check(overview, 'whatsapp_delivery')).toMatchObject({
                    status: 'warning', evidence: { blockedNumbers: 0, reason: 'funding_absent', fundingRequiredFrom: '2026-10-01', fundingState: 'absent' },
                });
                expect(overview.preparation.criticalBlockers).not.toContain('whatsapp_delivery');
                expect(overview.recommendations).toContainEqual(expect.objectContaining({
                    code: 'fix_whatsapp_delivery', severity: 'high', checkStatus: 'warning',
                }));
            });

            it('is a failure from 1-oct: Meta stops delivering', async () => {
                freeze('2026-10-02T15:00:00.000Z');
                const overview = await createHarness({ channelRows: [absentOn('2026-10-02T14:00:00.000Z')] })
                    .service.getOverview(TENANT_ID, AGENT_ID);
                expect(check(overview, 'whatsapp_delivery')).toMatchObject({
                    status: 'fail', evidence: { blockedNumbers: 1, reason: 'funding_absent' },
                });
            });
        });

        it('belongs to the agent that answers the number, not to every agent', async () => {
            const overview = await createHarness({
                agent: { channels: ['web_widget'] },
                channelRows: [number({ waba_timezone: null })],
                serving: { 'whatsapp:wa-1': '66666666-6666-4666-8666-666666666666' },
            }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'whatsapp_delivery').status).toBe('not_applicable');
        });

        it('with the accounts unreadable, only an agent that could serve WhatsApp reads unknown', async () => {
            const serving = await createHarness({ failedQueries: ['FROM channel_accounts'], agent: { channels: ['whatsapp'] } })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(serving, 'whatsapp_delivery').status).toBe('unknown');
            const webOnly = await createHarness({ failedQueries: ['FROM channel_accounts'], agent: { channels: ['web_widget'], is_default: false } })
                .service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(webOnly, 'whatsapp_delivery').status).toBe('not_applicable');
        });

        it('keeps a refused number on an agent that could serve it when the resolution is unreadable', async () => {
            const overview = await createHarness({
                channelRows: [number({ waba_timezone: null })], serving: { 'whatsapp:wa-1': 'error' },
            }).service.getOverview(TENANT_ID, AGENT_ID);
            expect(check(overview, 'whatsapp_delivery')).toMatchObject({ status: 'fail', evidence: { reason: 'timezone_missing' } });
        });
    });

    it('tells a failed critical check from one that could not be run', async () => {
        const overview = await createHarness({ failedQueries: ['FROM channel_accounts', 'widget_configs'] })
            .service.getOverview(TENANT_ID, AGENT_ID);
        expect(overview.recommendations).toContainEqual(expect.objectContaining({
            code: 'fix_channel_connection', severity: 'critical', checkStatus: 'unknown',
        }));
        for (const recommendation of overview.recommendations.filter((item) => item.pillar !== 'preparation')) {
            expect(recommendation.checkStatus).toBeUndefined();
        }
    });

    it('does not resolve serving agents for the Assist channel snapshot', async () => {
        const { service, calls } = createHarness();
        await service.getTenantChannelSnapshot(TENANT_ID);
        expect(calls.some((call) => call.query.includes('WITH ranked AS'))).toBe(false);
    });
});

/**
 * The Embedded Signup bridge is ONE call from the `whatsapp` service. When it
 * is lost — the API restarting mid rolling deploy, a 5xx, a timeout — the
 * number is connected and nothing else happened: the default agent is never
 * assigned to WhatsApp, `first_channel_connected_at` stays NULL and the stage
 * never reaches `channel_connected` (the 14-sep "asignar un canal"). The
 * overview reads `channel_accounts` anyway, and is what every reconcile runs,
 * so it is where the lost record is repaired: idempotent, best effort, and
 * only for a tenant under the stage contract whose connection facts are
 * actually missing.
 */
describe('AgentQualityService — repairing a connection whose record was lost', () => {
    const CONNECTED_AT = '2026-09-14T15:04:00.000Z';
    const TENANT_CREATED_AT = '2026-09-14T14:10:00.000Z';
    const whatsappRow = (over: Record<string, unknown> = {}) => ({
        channel_type: 'whatsapp', account_id: 'wa-1', waba_timezone: 'America/Bogota', created_at: CONNECTED_AT, ...over,
    });

    function repairHarness(over: {
        settings?: Record<string, unknown>;
        firstChannelConnectedAt?: Date | null;
        channelRows?: any[];
        failedQueries?: string[];
        updateManyThrows?: boolean;
        settingsThrows?: boolean;
    } = {}) {
        const h = createHarness({
            channelRows: over.channelRows ?? [whatsappRow()],
            failedQueries: over.failedQueries,
            agent: { channels: [], is_default: true },
        });
        const settings = {
            businessHours: { is247: true }, chatReasons: ['ventas'], customerTypes: ['personas'],
            ...(over.settings ?? { onboardingStage: 'agent_reviewed' }),
        };
        h.prisma.tenant.findUnique.mockResolvedValue({
            settings, industry: 'saas', updatedAt: '2026-08-01T00:00:00.000Z',
            createdAt: new Date(TENANT_CREATED_AT),
            firstChannelConnectedAt: over.firstChannelConnectedAt === undefined ? null : over.firstChannelConnectedAt,
        });
        const settingsWrites: Array<Record<string, unknown>> = [];
        const tx = {
            $queryRawUnsafe: jest.fn(async () => {
                if (over.settingsThrows) throw new Error('lock timeout');
                return [{ settings }];
            }),
            $executeRawUnsafe: jest.fn(async (_sql: string, _id: string, json: string) => {
                settingsWrites.push(JSON.parse(json));
                return 1;
            }),
        };
        h.prisma.tenant.updateMany = jest.fn(async () => {
            if (over.updateManyThrows) throw new Error('db unavailable');
            return { count: 1 };
        });
        h.prisma.$transaction = jest.fn(async (work: any) => work(tx));
        // After the assignment the agent row really is a new version: the
        // overview must be computed (and persisted) against that one.
        const original = h.prisma.executeInTenantSchema;
        let assigned = false;
        h.prisma.executeInTenantSchema = jest.fn(async (schema: string, query: string, params: any[] = []) => {
            const result = await original(schema, query, params);
            if (query.includes('UPDATE agent_personas')) assigned = true;
            if (assigned && query.includes('WHERE id = $1::uuid')) {
                return (result as any[]).map((row) => ({ ...row, version: 3, channels: ['whatsapp'] }));
            }
            return result;
        });
        const assignments = () => h.calls.filter((call) => call.query.includes('UPDATE agent_personas'));
        return { ...h, tx, settingsWrites, assignments };
    }

    it('records a WhatsApp connection whose bridge call was lost, dated when the number was connected', async () => {
        const h = repairHarness();

        const overview = await h.service.getOverview(TENANT_ID, AGENT_ID);

        expect(h.prisma.tenant.updateMany).toHaveBeenCalledWith({
            where: { id: TENANT_ID, firstChannelConnectedAt: null },
            data: { firstChannelConnectedAt: new Date(CONNECTED_AT) },
        });
        expect(h.assignments()).toHaveLength(1);
        expect(h.assignments()[0].params).toEqual(['whatsapp']);
        expect(h.settingsWrites).toEqual([expect.objectContaining({ onboardingStage: 'channel_connected' })]);
        // Computed against the agent as it is after the assignment.
        expect(overview.agent.version).toBe(3);
    });

    it('repairs the missing instant for a tenant whose stage already moved on', async () => {
        const h = repairHarness({ settings: { onboardingStage: 'completed' } });

        await h.service.getOverview(TENANT_ID, AGENT_ID);

        expect(h.prisma.tenant.updateMany).toHaveBeenCalledTimes(1);
        expect(h.assignments()).toHaveLength(1);
        // `completed` outranks `channel_connected`: nothing to write there.
        expect(h.settingsWrites).toEqual([]);
    });

    it('repairs a stage that never left "connect later" while a number is live', async () => {
        const h = repairHarness({
            settings: { onboardingStage: 'channel_deferred' }, firstChannelConnectedAt: new Date('2026-09-15T00:00:00.000Z'),
        });

        await h.service.getOverview(TENANT_ID, AGENT_ID);

        expect(h.settingsWrites).toEqual([expect.objectContaining({ onboardingStage: 'channel_connected' })]);
    });

    it('never dates the connection before the tenant existed (a number moved from another tenant)', async () => {
        const h = repairHarness({ channelRows: [whatsappRow({ created_at: '2025-01-01T00:00:00.000Z' })] });

        await h.service.getOverview(TENANT_ID, AGENT_ID);

        expect(h.prisma.tenant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { firstChannelConnectedAt: new Date(TENANT_CREATED_AT) },
        }));
    });

    it.each([
        ['the connection was recorded', { settings: { onboardingStage: 'channel_connected' }, firstChannelConnectedAt: new Date(CONNECTED_AT) }],
        ['the account is live', { settings: { onboardingStage: 'live' }, firstChannelConnectedAt: new Date(CONNECTED_AT) }],
        // A tenant from before the stage contract: its instant may be NULL
        // because it connected before the column existed, and writing "today"
        // (or a stage) would be a false fact about a years-old account.
        ['the tenant predates the stage contract', { settings: {}, firstChannelConnectedAt: null }],
        ['no certified connection is active', { channelRows: [{ channel_type: 'sms', account_id: 'sms-1', created_at: CONNECTED_AT }] }],
        ['nothing is connected', { channelRows: [] }],
        ['the accounts could not be read', { failedQueries: ['FROM channel_accounts'] }],
    ])('writes nothing when %s', async (_label, over) => {
        const h = repairHarness(over as any);

        const overview = await h.service.getOverview(TENANT_ID, AGENT_ID);

        expect(h.prisma.tenant.updateMany).not.toHaveBeenCalled();
        expect(h.assignments()).toHaveLength(0);
        expect(h.prisma.$transaction).not.toHaveBeenCalled();
        expect(overview.agent.version).toBe(2);
    });

    it('never costs the overview when the repair fails', async () => {
        const h = repairHarness({ updateManyThrows: true, settingsThrows: true });

        await expect(h.service.getOverview(TENANT_ID, AGENT_ID)).resolves.toEqual(expect.objectContaining({
            agent: expect.objectContaining({ id: AGENT_ID }),
        }));
    });

    it('is not run by the Assist channel snapshot', async () => {
        const h = repairHarness();

        await h.service.getTenantChannelSnapshot(TENANT_ID);

        expect(h.prisma.tenant.updateMany).not.toHaveBeenCalled();
        expect(h.assignments()).toHaveLength(0);
    });
});
