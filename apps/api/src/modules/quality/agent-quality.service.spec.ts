import { NotFoundException } from '@nestjs/common';
import { AGENT_QUALITY_DIMENSIONS, AgentQualityOverview } from '@parallext/shared';
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
    services?: number;
    slots?: number;
    products?: number;
    orders?: number;
    offers?: number;
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
        if (query.includes('SELECT id, name, is_default, is_active')) {
            return options.listRows ?? [{ id: AGENT_ID, name: 'Luna', is_default: true, is_active: true }];
        }
        if (query.includes('unnest(COALESCE(channel_bindings')) {
            return (options.boundChannelBindings ?? []).map((binding) => ({ binding }));
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
        if (query.includes('FROM policies')) return [{ count: options.policies ?? 0, updated_at: null }];
        if (query.includes('FROM properties') && query.includes('tour_packages')) return [options.verticalCatalogs ?? {}];
        if (query.includes('FROM services') && query.includes('availability_slots')) return [{ services: options.services ?? 0, slots: options.slots ?? 0 }];
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
                industry: 'saas',
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
            if (query.includes('FROM channel_accounts')) return options.channelRows ?? [{ channel_type: 'whatsapp', account_id: 'wa-1' }];
            if (query.includes('widget_configs')) return options.widgetRows ?? [];
            if (query.includes('FROM users')) return [{ count: options.activeHumans ?? 1 }];
            throw new Error(`Unhandled global test SQL: ${query}`);
        }),
    };
    return { service: new AgentQualityService(prisma), prisma, calls };
}

function check(overview: AgentQualityOverview, code: string) {
    return overview.preparation.dimensions.flatMap((dimension) => dimension.checks).find((item) => item.code === code)!;
}

describe('AgentQualityService', () => {
    beforeAll(() => jest.useFakeTimers().setSystemTime(NOW));
    afterAll(() => jest.useRealTimers());

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
        expect(check(overview, 'tool_appointments')).toMatchObject({ status: 'fail', critical: true, href: '/admin/appointments' });
        expect(overview.recommendations).toContainEqual(expect.objectContaining({ code: 'fix_tool_appointments', href: '/admin/appointments' }));
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
            expect(call.params).toEqual([AGENT_ID, 2]);
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
});
