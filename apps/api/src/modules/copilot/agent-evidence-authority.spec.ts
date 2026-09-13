import { Test } from '@nestjs/testing';
import { buildDomainContractDraft, composeSubtypeEvalPack, EVAL_LANGUAGES } from '@parallext/shared';
import { AppModule } from '../../app.module';
import { EvaluationRevisionService } from '../evaluation-revision/evaluation-revision.service';
import { AgentAssessmentService } from './agent-assessment.service';
import { evaluationSnapshot, sealEvaluationSnapshot, type AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { evaluationKnowledgeFixture } from '../conversations/__fixtures__/evaluation-knowledge.fixture';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { revisionHash, sealRevision } from '../evaluation-revision/evaluation-revision';
import { sealStructuredKnowledgeCapture } from '../evaluation-revision/evaluation-structured-knowledge';
import { releaseRunContext, sealReleaseRun, type AgentReleaseRunEvidence } from '../simulation/agent-release-policy';

/**
 * Whether the assessment can recognise evidence that is still current.
 *
 * `intentEvidence` has always demanded the full authority of the configuration
 * being assessed, and the assessment called it without one — so every task of
 * every mission read `not_verified`, permanently, however many evaluations the
 * tenant ran. The literal it replaced said the same thing forever; so did the
 * call that replaced it.
 *
 * These exercise the service itself, not a helper: the snapshots are sealed the
 * way the executor seals them, the runs are sealed the way the release policy
 * seals them, and the authority is the same revision comparison the evaluation
 * service uses.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'tenant_test';
const INDUSTRY = 'restaurantes', SUBTYPE = 'casual_dining';
const DOMAIN = buildDomainContractDraft(INDUSTRY, SUBTYPE);
const INTENT = DOMAIN.intents[0].key;
const SETTINGS_AT = new Date('2026-09-10T00:00:00.000Z');

const CONFIG = {
    persona: { role: 'Atender pedidos', name: 'Luna' },
    language: 'es',
    mission: { version: 1, objective: 'Tomar reservas y pedidos', intentKeys: [INTENT],
        successCriteria: ['El cliente recibe confirmación'], handoffConditions: ['Pide un humano'] },
};

/** The live half of the tenant's dependency manifest, as the capture returns it. */
const liveManifest = (hash: string) =>
    sealRevision(TENANT, [{ key: 'tenant.menu_items', state: 'present', hash: revisionHash(hash) }], []);

/** A snapshot sealed the way the evaluation executor seals one. */
function snapshotFor(over: { version?: number; dependency?: string; tenantId?: string } = {}): AgentEvaluationSnapshot {
    const snapshot = evaluationSnapshot(TENANT, AGENT, { version: over.version ?? 2, config_json: CONFIG });
    snapshot.mcpTools = []; snapshot.mcpToolsHash = revisionHash([]);
    snapshot.procedures = []; snapshot.proceduresHash = revisionHash([]);
    snapshot.runtimeInputs = { providerHealth: {}, planFeatures: {}, llmSpendUsdCents: 0, mcpDiscoveredCount: 0, mcpApprovedCount: 0 };
    snapshot.runtimeInputsHash = revisionHash(snapshot.runtimeInputs);
    snapshot.contextInputs = { version: 1, tenantId: TENANT, businessHours: null, business: null, activeObjectPolicy: {},
        regional: new RegionalProfileService({} as any, {} as any).compose(TENANT, {}), vertical: { es: null, en: null, pt: null, fr: null } };
    snapshot.structuredKnowledgeInputs = sealStructuredKnowledgeCapture({ version: 1, tenantId: TENANT, sourceSchema: SCHEMA,
        capturedAt: snapshot.capturedAt, faqs: { state: 'present', rows: [] }, policies: { state: 'present', rows: [] } });
    snapshot.knowledgeInputs = evaluationKnowledgeFixture(TENANT, AGENT, SCHEMA);
    snapshot.manifest = liveManifest(over.dependency ?? 'menu-v1');
    sealEvaluationSnapshot(snapshot);
    if (over.tenantId) snapshot.tenantId = over.tenantId;
    return snapshot;
}

/** Every canonical case of the mission's task, per language, exactly once. */
function missionScenarios(): any[] {
    return EVAL_LANGUAGES.flatMap(language => composeSubtypeEvalPack({ industry: INDUSTRY, subtype: SUBTYPE, language })
        .filter(entry => entry.key.startsWith(`intent_${INTENT}_`))
        // `key` is the storage identity, unique per language; `managedSeedKey`
        // is the canonical case, the same in all four. This is how the eval
        // service seeds them.
        .map(entry => ({ ...entry, key: entry.storageKey ?? entry.key, managedSeedKey: entry.key,
            profileId: DOMAIN.profileId, language })));
}

function runFor(snapshot: AgentEvaluationSnapshot, over: { channelType?: string; passed?: boolean } = {}): AgentReleaseRunEvidence {
    const scenarios = missionScenarios();
    const body = { agentId: AGENT, dependencyRevision: snapshot.manifest!.revision, configHash: snapshot.configHash,
        channelType: over.channelType ?? 'web_widget', status: 'completed', k: 1, passPolicy: 'all', threshold: 8,
        models: ['gpt-4o-mini'] };
    const contextHash = releaseRunContext(body as any);
    return sealReleaseRun({ ...body, scenarios, results: scenarios.map(entry => ({
        key: entry.key, contextHash, scenarioHash: revisionHash(entry),
        passed: over.passed !== false, k: 1, passes: over.passed === false ? 0 : 1,
        runs: [{ passed: over.passed !== false, flags: [], score: over.passed === false ? 4 : 9,
            models: ['gpt-4o-mini'], actionChecks: (entry.expectedActions ?? []).map(() => ({ ok: true })) }],
    })) } as any);
}

interface StoredRun { id: string; created_at: string; release_evidence: AgentReleaseRunEvidence; agent_snapshot: any; accepted?: boolean | null }

function harness(options: {
    rows?: StoredRun[];
    table?: boolean;
    acceptanceColumn?: boolean;
    liveDependency?: string;
    authority?: boolean;
    readFails?: boolean;
    channels?: string[];
    writersBlocked?: boolean;
    excluded?: any[];
    versionAfter?: number;
} = {}) {
    const rows = options.rows ?? [];
    const query = jest.fn(async (_schema: string, sql: string) => sql.startsWith('SELECT version')
        ? [{ version: options.versionAfter ?? 2 }]
        : [{ id: AGENT, version: 2, template_id: 'restaurant', channels: options.channels ?? ['web_chat'],
            channel_bindings: [], config_json: CONFIG }]);
    const transaction = jest.fn(async (_schema: string, work: any) => {
        if (options.readFails) throw new Error('eval_runs unreadable');
        return work(async (sql: string) => {
            if (sql.includes('AS name')) return [{ name: options.table === false ? null : `${SCHEMA}.eval_runs` }];
            if (sql.includes('AS marked')) return [{ marked: true, releases: options.acceptanceColumn ? `${SCHEMA}.agent_release_evaluations` : null }];
            if (sql.includes('FROM eval_runs')) {
                return rows.map(row => options.acceptanceColumn ? row : { ...row, accepted: undefined });
            }
            throw new Error(`Unexpected read ${sql}`);
        });
    });
    const prisma = { getTenantSchemaName: jest.fn().mockResolvedValue(SCHEMA), executeInTenantSchema: query,
        transactionInTenantSchema: transaction,
        tenant: { findUnique: jest.fn().mockResolvedValue({ industry: INDUSTRY, updatedAt: SETTINGS_AT,
            settings: { verticalConfig: { industry: INDUSTRY, subType: SUBTYPE } } }) } };
    const check = (code: string, status = 'pass', href?: string) => ({ code, status, evidence: {}, dimension: 'business_scope', critical: true, weight: 1, href });
    // Every setup task passes, so the only unfinished parts left in these cases
    // are the mission's own evidence and its tools.
    const passing = ['channel_assignment', 'channel_connection', 'channel_coverage', 'operational_channel_scope',
        'agent_active', 'persona_identity', 'custom_prompt', 'fallback_message', 'behavior_rules', 'handoff_triggers',
        'business_identity', 'business_contact', 'knowledge_coverage', 'rag_knowledge', 'rag_configuration',
        'tool_faqs', 'tool_policies', 'human_handoff_route', 'business_hours', 'after_hours_behavior'];
    const quality = { getOverview: jest.fn().mockResolvedValue({
        agent: { id: AGENT, version: 2, name: 'Luna' }, status: 'ready_for_pilot',
        preparation: { dimensions: [{ checks: [...passing.map(code => check(code)), check('tool_menu', 'pass', '/admin/menu')] }] },
        tested: { status: 'ready', stale: false } }) };
    const excluded = options.excluded ?? [];
    const capabilities = { resolve: jest.fn().mockResolvedValue({ contract: {
        subtypeProfileId: DOMAIN.profileId,
        publishedTools: [...new Set(DOMAIN.intents.flatMap(intent => intent.toolPlan))]
            .filter(tool => !excluded.some(entry => entry.subject === tool)),
        excluded, unmetReadiness: [], degraded: false,
        writersBlocked: options.writersBlocked === true, resolvedAt: '2026-09-10T00:00:00Z' } }) };
    const revisions = { capture: jest.fn(async () => liveManifest(options.liveDependency ?? 'menu-v1')) };
    // The authority is a DECLARED constructor dependency now, not a container
    // lookup: `CopilotModule` imports `EvaluationRevisionModule`, so a missing
    // provider is a red bootstrap rather than an assessment that reports its
    // evidence source unreadable at runtime. `authority: false` is how a case
    // asks for it to be absent.
    const authority = options.authority === false ? undefined : revisions;
    return { service: new AgentAssessmentService(prisma as any, quality as any, capabilities as any, authority as any),
        prisma, revisions, capabilities };
}

const stored = (snapshot: AgentEvaluationSnapshot, evidence: AgentReleaseRunEvidence,
    over: Partial<StoredRun> = {}): StoredRun => ({
    id: '33333333-3333-4333-8333-333333333333', created_at: '2026-09-09T10:00:00.000Z',
    release_evidence: evidence, agent_snapshot: snapshot, ...over });

describe('the assessment recognises evidence that is still current', () => {
    it('reports a proven task as verified without capturing a new snapshot', async () => {
        const snapshot = snapshotFor();
        const { service, revisions, prisma } = harness({ rows: [stored(snapshot, runFor(snapshot))] });
        const assessment = await service.getAssessment(TENANT, AGENT);
        const test = assessment.requiredTests.find(entry => entry.intentKey === INTENT)!;
        expect(test.evidence).toBe('verified');
        expect(test.state).toBe('tested');
        // One dependency capture for the whole assessment, and nothing that
        // leases a replica, freezes a turn or reaches an MCP server.
        expect(revisions.capture).toHaveBeenCalledTimes(1);
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        // The private snapshot stays private: it is validation input, not output.
        expect(JSON.stringify(assessment)).not.toContain(snapshot.knowledgeInputs!.lease.token);
    });

    it('moves the mission task from pending to tested once valid evidence exists', async () => {
        const snapshot = snapshotFor();
        const before = await harness().service.getAssessment(TENANT, AGENT);
        expect(before.requiredTests[0].evidence).toBe('not_verified');
        expect(before.requiredTests[0].state).toBe('pending');
        expect(before.tasks.find(task => task.key === 'tests')!.state).toBe('pending');
        // The quality overview says a run happened — `tested: ready` — and that
        // alone used to close this task while not one task of the mission had
        // been proven by it.
        expect(before.tasks.find(task => task.key === 'tests')!.status).toBe('warning');
        const after = await harness({ rows: [stored(snapshot, runFor(snapshot))] }).service.getAssessment(TENANT, AGENT);
        expect(after.requiredTests[0].state).toBe('tested');
        expect(after.tasks.find(task => task.key === 'tests')!.state).toBe('tested');
        expect(after.tasks.find(task => task.key === 'tests')!.status).toBe('pass');
    });

    it('captures no dependency manifest when there is no candidate evidence', async () => {
        const { service, revisions } = harness({ table: false });
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(revisions.capture).not.toHaveBeenCalled();
        expect(assessment.requiredTests[0].evidence).toBe('not_verified');
        expect(assessment.requiredTests[0].state).toBe('pending');
    });

    it('stops accrediting the task when a live dependency changed', async () => {
        const snapshot = snapshotFor();
        const { service } = harness({ rows: [stored(snapshot, runFor(snapshot))], liveDependency: 'menu-v2' });
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(assessment.requiredTests[0].evidence).toBe('stale');
        expect(assessment.requiredTests[0].state).toBe('degraded');
    });

    it.each([
        ['a snapshot of another tenant', () => {
            const snapshot = snapshotFor({ tenantId: '99999999-9999-4999-8999-999999999999' });
            return stored(snapshot, runFor(snapshot));
        }],
        ['a run whose hashes do not name its snapshot', () => {
            const snapshot = snapshotFor();
            const evidence = runFor(snapshot);
            return stored(snapshot, sealReleaseRun({ ...evidence, configHash: 'c'.repeat(64) } as any));
        }],
        ['a snapshot whose seal was edited', () => {
            const snapshot = snapshotFor();
            const evidence = runFor(snapshot);
            return stored({ ...snapshot, config: { ...CONFIG, language: 'fr' } } as any, evidence);
        }],
    ])('refuses %s', async (_name, build) => {
        const { service } = harness({ rows: [build()] });
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(assessment.requiredTests[0].evidence).not.toBe('verified');
    });

    it('reads web_chat and web_widget as one channel, and lets whatsapp inherit nothing', async () => {
        const snapshot = snapshotFor();
        const row = stored(snapshot, runFor(snapshot, { channelType: 'web_widget' }));
        // The agent is assigned under the configuration-surface spelling.
        const widget = await harness({ rows: [row], channels: ['web_chat'] }).service.getAssessment(TENANT, AGENT);
        expect(widget.requiredTests[0].evidence).toBe('verified');
        // The stored run keeps its own spelling; nothing was rewritten.
        expect(row.release_evidence.channelType).toBe('web_widget');
        const whatsapp = await harness({ rows: [row], channels: ['whatsapp'] }).service.getAssessment(TENANT, AGENT);
        expect(whatsapp.requiredTests[0].evidence).not.toBe('verified');
    });

    it('lets the newest accepted attempt replace an earlier failure, and never the other way round', async () => {
        const snapshot = snapshotFor();
        const failed = stored(snapshot, runFor(snapshot, { passed: false }),
            { id: '44444444-4444-4444-8444-444444444444', created_at: '2026-09-09T09:00:00.000Z' });
        const passed = stored(snapshot, runFor(snapshot),
            { id: '55555555-5555-4555-8555-555555555555', created_at: '2026-09-09T11:00:00.000Z' });
        const recovered = await harness({ rows: [passed, failed] }).service.getAssessment(TENANT, AGENT);
        expect(recovered.requiredTests[0].evidence).toBe('verified');
        const regressed = await harness({ rows: [
            { ...failed, created_at: '2026-09-09T12:00:00.000Z' }, passed,
        ] }).service.getAssessment(TENANT, AGENT);
        expect(regressed.requiredTests[0].evidence).toBe('failed');
    });

    it('does not let a run whose own snapshot failed validation condemn one that passed', async () => {
        const snapshot = snapshotFor();
        const passed = stored(snapshot, runFor(snapshot),
            { id: '55555555-5555-4555-8555-555555555555', created_at: '2026-09-09T11:00:00.000Z' });
        // Same revision as the validated run, so sharing one is not enough: this
        // row's own snapshot no longer hashes to its configuration.
        const tampered = stored({ ...snapshot, config: { ...CONFIG, language: 'fr' } } as any,
            runFor(snapshot, { passed: false }),
            { id: '77777777-7777-4777-8777-777777777777', created_at: '2026-09-09T14:00:00.000Z' });
        expect(tampered.release_evidence.dependencyRevision).toBe(passed.release_evidence.dependencyRevision);
        const { service } = harness({ rows: [tampered, passed] });
        expect((await service.getAssessment(TENANT, AGENT)).requiredTests[0].evidence).toBe('verified');
    });

    it('does not let a rejected retry replace an accepted result', async () => {
        const snapshot = snapshotFor();
        const passed = stored(snapshot, runFor(snapshot),
            { id: '55555555-5555-4555-8555-555555555555', created_at: '2026-09-09T11:00:00.000Z', accepted: true });
        const rejected = stored(snapshot, runFor(snapshot, { passed: false }),
            { id: '66666666-6666-4666-8666-666666666666', created_at: '2026-09-09T13:00:00.000Z', accepted: false });
        const { service } = harness({ rows: [rejected, passed], acceptanceColumn: true });
        expect((await service.getAssessment(TENANT, AGENT)).requiredTests[0].evidence).toBe('verified');
        // The same attempt, accepted, does replace it.
        const accepted = harness({ rows: [{ ...rejected, accepted: true }, passed], acceptanceColumn: true });
        expect((await accepted.service.getAssessment(TENANT, AGENT)).requiredTests[0].evidence).toBe('failed');
    });

    it('reports a changed agent during the capture as unreadable instead of publishing a mixture', async () => {
        const snapshot = snapshotFor();
        // The version re-read after the dependency capture no longer matches the
        // agent the rest of the assessment was built from.
        const { service } = harness({ rows: [stored(snapshot, runFor(snapshot))], versionAfter: 2 });
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(assessment.requiredTests[0].evidence).toBe('verified');
        const drifted = harness({ rows: [stored(snapshot, runFor(snapshot))] });
        (drifted.prisma.executeInTenantSchema as jest.Mock)
            .mockImplementation(async (_schema: string, sql: string) => sql.startsWith('SELECT version')
                ? [{ version: (drifted.revisions.capture as jest.Mock).mock.calls.length ? 7 : 2 }]
                : [{ id: AGENT, version: 2, template_id: 'restaurant', channels: ['web_chat'], channel_bindings: [], config_json: CONFIG }]);
        const mixed = await drifted.service.getAssessment(TENANT, AGENT);
        expect(mixed.requiredTests[0].state).toBe('unknown');
    });
});

describe('the assessment summary stays coherent with its parts', () => {
    it('never calls a tool prepared when the evidence source could not be read', async () => {
        const readable = await harness({ rows: [] }).service.getAssessment(TENANT, AGENT);
        expect(readable.tools.every(tool => tool.state !== 'unknown')).toBe(true);
        const unreadable = await harness({ readFails: true }).service.getAssessment(TENANT, AGENT);
        expect(unreadable.tools.some(tool => tool.state === 'prepared')).toBe(false);
        expect(unreadable.requiredTests[0].state).toBe('unknown');
        expect(unreadable.tasks.find(task => task.key === 'tests')!.state).toBe('unknown');
    });

    it('treats an unavailable dependency authority as unreadable, not as no evidence', async () => {
        const snapshot = snapshotFor();
        const { service } = harness({ rows: [stored(snapshot, runFor(snapshot))], authority: false });
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(assessment.requiredTests[0].state).toBe('unknown');
        expect(assessment.tools.some(tool => tool.state === 'prepared')).toBe(false);
    });

    it('does not call a channel prepared while its contract blocks every writer', async () => {
        const open = await harness().service.getAssessment(TENANT, AGENT);
        expect(open.channels.every(channel => channel.state === 'prepared')).toBe(true);
        const blocked = await harness({ writersBlocked: true }).service.getAssessment(TENANT, AGENT);
        expect(blocked.channels.every(channel => channel.state === 'pending')).toBe(true);
        expect(blocked.state).not.toBe('prepared');
    });

    it('lets the mission tasks and the tools decide the whole, not only the setup tasks', async () => {
        const snapshot = snapshotFor();
        const proven = await harness({ rows: [stored(snapshot, runFor(snapshot))] }).service.getAssessment(TENANT, AGENT);
        expect(proven.tasks.every(task => task.state === null || task.state !== 'degraded')).toBe(true);
        expect(proven.state).not.toBe('degraded');
        // Only the evidence changes; every task and channel stays as it was.
        const failing = await harness({ rows: [stored(snapshot, runFor(snapshot, { passed: false }))] }).service.getAssessment(TENANT, AGENT);
        expect(failing.requiredTests[0].state).toBe('degraded');
        expect(failing.state).toBe('degraded');
        expect(failing.tasks.find(task => task.key === 'tests')!.status).toBe('fail');
        // And a tool the mission needs that a provider took away does the same.
        const tool = DOMAIN.intents.find(intent => intent.key === INTENT)!.toolPlan[0];
        const outage = await harness({ rows: [stored(snapshot, runFor(snapshot))], excluded: [{ subject: tool,
            reason: 'provider_unavailable', detail: { es: 'x', en: 'x', pt: 'x', fr: 'x' }, repairRoute: '/admin/channels' }] })
            .service.getAssessment(TENANT, AGENT);
        expect(outage.tools.find(entry => entry.tool === tool)!.state).toBe('degraded');
        expect(outage.state).toBe('degraded');
    });

    it('names a next action while a tool the mission needs is not operating', async () => {
        const snapshot = snapshotFor();
        const tool = DOMAIN.intents.find(intent => intent.key === INTENT)!.toolPlan[0];
        const settled = await harness({ rows: [stored(snapshot, runFor(snapshot))] }).service.getAssessment(TENANT, AGENT);
        const outage = await harness({ rows: [stored(snapshot, runFor(snapshot))], excluded: [{ subject: tool,
            reason: 'provider_unavailable', detail: { es: 'x', en: 'x', pt: 'x', fr: 'x' }, repairRoute: '/admin/knowledge' }] })
            .service.getAssessment(TENANT, AGENT);
        // Nothing is left to do when every part is settled, and something is
        // named the moment a tool of the mission stops working.
        expect(settled.nextTask).toBe(null);
        expect(outage.nextTask).not.toBe(null);
    });
});

/**
 * The dependency authority is resolved from the application container instead
 * of being declared in CopilotModule, which does not import the module that
 * provides it. That is a runtime lookup, so it has to be proven at runtime:
 * a compile check cannot tell a resolvable provider from an unreachable one,
 * and an unreachable one silently turns every task back into "not verified".
 */
describe('the dependency authority is reachable from the module that reads it', () => {
    const previousJwtSecret = process.env.JWT_SECRET;
    const previousEncryptionKey = process.env.ENCRYPTION_KEY;
    beforeAll(() => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'bootstrap-test-only-jwt-secret-at-least-32-bytes';
        process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
    });
    afterAll(() => {
        if (previousJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousJwtSecret;
        if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previousEncryptionKey;
    });

    it('resolves the evaluation revision service through the assessment own container', async () => {
        const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
        const assessment = app.get(AgentAssessmentService, { strict: false });
        expect((assessment as any).revisionAuthority()).toBeInstanceOf(EvaluationRevisionService);
        await app.close();
    }, 60_000);
});
