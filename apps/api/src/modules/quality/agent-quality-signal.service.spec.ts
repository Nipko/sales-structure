import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AgentQualityOverview } from '@parallext/shared';
import { AGENT_QUALITY_DELIVERY_FAILURE_CODES } from '@parallext/shared';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AgentQualitySignalService } from './agent-quality-signal.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const SIGNAL_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const SCHEMA = 'tenant_quality_attention';

const overview: AgentQualityOverview = {
    generatedAt: '2026-08-13T12:00:00.000Z',
    agent: {
        id: AGENT_ID,
        name: 'Luna',
        version: 4,
        isActive: true,
        updatedAt: '2026-08-13T11:00:00.000Z',
    },
    status: 'at_risk',
    nextMilestone: 'pass_critical_tests',
    preparation: {
        status: 'blocked', score: 82, passed: 8, applicable: 10,
        criticalBlockers: ['channel_connection'], dimensions: [],
    },
    tested: {
        status: 'blocked', score: 42, stale: false, staleReasons: [],
        latestEval: null, latestSimulation: null,
    },
    production: {
        status: 'insufficient_evidence', observedScore: null, sampleSize: 3,
        minimumSample: 20, periodDays: 30, attributedSince: null,
        metrics: [], topIssues: [],
    },
    recommendations: [
        {
            code: 'fix_channel_connection',
            pillar: 'preparation',
            dimension: 'actions_outcomes',
            severity: 'critical',
            href: '/admin/channels',
            evidenceCount: 1,
            conversationIds: ['55555555-5555-4555-8555-555555555555'],
            params: { secret: 'must-not-be-persisted' },
        },
        {
            code: 'run_eval',
            pillar: 'tested',
            dimension: 'robustness_operations',
            severity: 'high',
            href: 'https://evil.example/steal',
        },
    ],
};

const signalRow = {
    id: SIGNAL_ID,
    agent_id: AGENT_ID,
    agent_name: 'Luna',
    agent_config_version: 4,
    code: 'fix_channel_connection',
    severity: 'critical',
    pillar: 'preparation',
    dimension: 'actions_outcomes',
    state: 'open',
    href: '/admin/channels',
    evidence_count: 1,
    fingerprint: 'internal-only',
    occurrence_count: 2,
    first_seen_at: '2026-08-13T10:00:00.000Z',
    last_seen_at: '2026-08-13T12:00:00.000Z',
    acknowledged_by: ACTOR_ID,
};

type HarnessOptions = {
    tablesCached?: boolean;
    cachedSummary?: any;
    attentionRows?: any[];
    topRows?: any[];
    deliveryRows?: any[];
    signalRows?: any[];
    mutationRows?: any[];
    assistantRows?: any[];
    eventDebounceAcquired?: boolean;
    overview?: AgentQualityOverview;
    manualRefreshCooldown?: boolean;
    manualRefreshLockToken?: string | null;
    dependencyLockToken?: string | null;
    currentAgentVersion?: number;
    currentAgentActive?: boolean;
    agentRows?: Array<{ id: string }>;
    tenantRows?: Array<{ id: string }>;
    schemaFailureTenantId?: string;
};

function createHarness(options: HarnessOptions = {}) {
    const sqlCalls: Array<{ sql: string; params: any[] }> = [];
    const txCalls: Array<{ sql: string; params: any[] }> = [];
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        sqlCalls.push({ sql, params });
        if (sql.includes('SELECT id') && sql.includes('FROM agent_personas') && !sql.includes('JOIN')) {
            return options.agentRows ?? [{ id: AGENT_ID }];
        }
        if (sql.includes('snapshot.status AS snapshot_status')) return options.attentionRows ?? [];
        if (sql.includes("s.severity IN ('critical', 'high')") && sql.includes('LIMIT 1')) {
            return options.topRows ?? [];
        }
        if (sql.includes("s.severity = 'critical'") && sql.includes('s.code = ANY($1::text[])')) {
            return options.deliveryRows ?? [];
        }
        if (sql.startsWith('UPDATE agent_quality_signals') && sql.includes("state = 'acknowledged'")) {
            return options.mutationRows ?? [signalRow];
        }
        if (sql.startsWith('UPDATE agent_quality_signals') && sql.includes("state = 'snoozed'")) {
            return options.mutationRows ?? [signalRow];
        }
        if (sql.includes('s.agent_id = $2::uuid')) return options.assistantRows ?? [signalRow];
        if (sql.includes('WHERE s.id = $1::uuid')) return options.signalRows ?? [signalRow];
        if (sql.includes('WHERE s.state = $1')) return options.signalRows ?? [signalRow];
        return [];
    });
    const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(
        async (sql: string, params: any[] = []) => {
            txCalls.push({ sql, params });
            if (sql.includes('FROM agent_personas') && sql.includes('FOR SHARE')) {
                const currentOverview = options.overview ?? overview;
                return [{
                    version: options.currentAgentVersion ?? currentOverview.agent.version,
                    is_active: options.currentAgentActive ?? currentOverview.agent.isActive,
                }];
            }
            return [];
        },
    ));
    const prisma: any = {
        getTenantSchemaName: jest.fn(async (tenantId: string) => {
            if (tenantId === options.schemaFailureTenantId) throw new Error('schema unavailable');
            return SCHEMA;
        }),
        executeInTenantSchema,
        transactionInTenantSchema,
        tenant: {
            findMany: jest.fn().mockResolvedValue(options.tenantRows ?? [{ id: TENANT_ID }]),
        },
    };
    const redis: any = {
        tenantKey: jest.fn((tenantId: string, suffix: string) => `tenant:${tenantId}:${suffix}`),
        get: jest.fn(async (key: string) => key.includes('tables')
            ? (options.tablesCached === false ? null : '1')
            : key.includes('manual-refresh:cooldown') && options.manualRefreshCooldown ? '1' : null),
        getDel: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
        getJson: jest.fn().mockResolvedValue(options.cachedSummary ?? null),
        setJson: jest.fn().mockResolvedValue(undefined),
        acquireLock: jest.fn().mockResolvedValue(options.eventDebounceAcquired ?? true),
        acquireLockToken: jest.fn(async (key: string) => key.includes('manual-refresh:lock')
            ? (options.manualRefreshLockToken === undefined ? 'manual-lock-token' : options.manualRefreshLockToken)
            : key.includes('dependency-reconcile:lock')
                ? (options.dependencyLockToken === undefined ? 'dependency-lock-token' : options.dependencyLockToken)
            : 'lock-token'),
        releaseLockToken: jest.fn().mockResolvedValue(undefined),
    };
    const cronLock: any = {
        runExclusive: jest.fn(async (_name: string, _ttl: number, fn: () => Promise<void>) => fn()),
    };
    const quality: any = { getOverview: jest.fn().mockResolvedValue(options.overview ?? overview) };
    const service = new AgentQualitySignalService(prisma, redis, cronLock, quality);
    return { service, prisma, redis, cronLock, quality, sqlCalls, txCalls };
}

describe('AgentQualitySignalService', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-08-13T12:00:00.000Z')));
    afterEach(() => jest.useRealTimers());

    it('creates both durable tables under a tenant advisory lock and caches only after DDL', async () => {
        const { service, prisma, txCalls, redis } = createHarness({ tablesCached: false });

        await service.ensureTables(SCHEMA);

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledWith(
            SCHEMA,
            expect.any(Function),
            { schemaLock: true },
        );
        expect(txCalls[0].sql).toContain('pg_advisory_xact_lock');
        expect(txCalls.some((call) => call.sql.includes('CREATE TABLE IF NOT EXISTS agent_quality_snapshots'))).toBe(true);
        expect(txCalls.some((call) => call.sql.includes('CREATE TABLE IF NOT EXISTS agent_quality_signals'))).toBe(true);
        expect(redis.set).toHaveBeenCalledWith(expect.stringContaining(SCHEMA), '1', 86400);
    });

    it('bootstraps the same privacy-bounded tables for every new tenant schema', () => {
        const sql = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');

        expect(sql).toContain('"agent_quality_snapshots"');
        expect(sql).toContain('"agent_quality_signals"');
        expect(sql).toContain('UNIQUE (agent_id, agent_config_version, fingerprint)');
        expect(sql).toContain('fingerprint VARCHAR(64) NOT NULL UNIQUE');
        const signalSection = sql.split('"agent_quality_signals" (')[1].split('-- ---- Simulation')[0];
        expect(signalSection).not.toMatch(/transcript|prompt|conversation_id|judge_text|query_text/i);
    });

    it('ignores legacy certification snapshots and summary cache until recalculated under evidence policy v2', async () => {
        const { service, redis, sqlCalls, txCalls } = createHarness({tablesCached:false});
        const legacy={evaluatedAgents:99,status:'healthy'};
        redis.getJson.mockImplementation(async(key:string)=>key.endsWith(':v1') ? legacy : null);
        const result=await service.getAttentionSummary(TENANT_ID);
        expect(result).not.toBe(legacy);
        expect(redis.getJson).toHaveBeenCalledWith(expect.stringContaining('attention-summary:v2'));
        expect(sqlCalls.find(call=>call.sql.includes('snapshot.status AS snapshot_status'))?.sql).toContain('aqs.evidence_policy_version = 2');
        expect(txCalls.some(call=>call.sql.includes('ADD COLUMN IF NOT EXISTS evidence_policy_version'))).toBe(true);
        expect(txCalls.some(call=>call.sql.includes("s.code='improve_verified_resolution'")&&call.sql.includes('NOT EXISTS'))).toBe(true);
    });

    it('persists coded snapshots/signals, dedupes by stable fingerprint and drops sensitive evidence', async () => {
        const { service, txCalls } = createHarness();

        await service.reconcileAgent(TENANT_ID, AGENT_ID, 'quality.scored');
        const firstFingerprint = txCalls.find((call) => call.sql.includes('ON CONFLICT (fingerprint) DO UPDATE'))?.params[8];
        await service.reconcileAgent(TENANT_ID, AGENT_ID, 'quality.scored');
        const signalUpserts = txCalls.filter((call) => call.sql.includes('ON CONFLICT (fingerprint) DO UPDATE'));

        expect(firstFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(signalUpserts[2].params[8]).toBe(firstFingerprint);
        expect(txCalls.some((call) => call.sql.includes("state = 'superseded'"))).toBe(true);
        expect(txCalls.some((call) => call.sql.includes("state = 'resolved'"))).toBe(true);
        const allParams = JSON.stringify(txCalls.map((call) => call.params));
        expect(allParams).not.toContain('must-not-be-persisted');
        expect(allParams).not.toContain('55555555-5555-4555-8555-555555555555');
        const maliciousSignal = signalUpserts.find((call) => call.params[2] === 'run_eval');
        expect(maliciousSignal?.params[6]).toBe('/admin/agent/quality');
        expect(signalUpserts[0].sql).toContain("agent_quality_signals.state = 'acknowledged'");
        expect(signalUpserts[0].sql).toContain('EXCLUDED.severity');
        expect(txCalls.some((call) => call.sql.includes('DELETE FROM agent_quality_snapshots'))).toBe(true);
    });

    it('coalesces a pending event into a trailing pass after releasing the agent lock', async () => {
        const { service, redis, quality } = createHarness();
        redis.getDel.mockResolvedValueOnce('1').mockResolvedValueOnce(null);

        await service.reconcileAgent(TENANT_ID, AGENT_ID, 'agent_version_updated');

        expect(quality.getOverview).toHaveBeenCalledTimes(2);
        expect(redis.releaseLockToken).toHaveBeenCalledTimes(2);
        expect(redis.getDel).toHaveBeenCalledWith(expect.stringContaining('reconcile-pending'));
    });

    it('does not persist a stale overview when the current agent version changed', async () => {
        const { service, txCalls, redis } = createHarness({ currentAgentVersion: 5 });

        await service.reconcileAgent(TENANT_ID, AGENT_ID, 'agent_version_updated');

        expect(txCalls.some((call) => call.sql.includes('INSERT INTO agent_quality_snapshots'))).toBe(false);
        expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('reconcile-pending'), '1', 300);
    });

    it('retires actionable signals instead of warning globally for a disabled agent', async () => {
        const inactiveOverview: AgentQualityOverview = {
            ...overview,
            agent: { ...overview.agent, isActive: false },
        };
        const { service, sqlCalls, txCalls, redis } = createHarness({ overview: inactiveOverview });

        await service.reconcileAgent(TENANT_ID, AGENT_ID, 'agent_config_updated');

        expect(sqlCalls.some((call) => call.sql.includes("SET state = 'superseded'"))).toBe(true);
        expect(txCalls.some((call) => call.sql.includes('INSERT INTO agent_quality_snapshots'))).toBe(false);
        expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('attention-summary'));
    });

    it('builds a bounded aggregate with only open critical/high attention', async () => {
        const { service, redis } = createHarness({
            attentionRows: [
                { id: AGENT_ID, name: 'Luna', version: 4, snapshot_status: 'at_risk', has_snapshot: true, critical_count: 1, high_count: 2, top_signal_code: 'fix_channel_connection' },
                { id: ACTOR_ID, name: 'Sol', version: 2, snapshot_status: 'not_evaluated', has_snapshot: true, critical_count: 0, high_count: 0 },
            ],
            topRows: [{
                id: SIGNAL_ID, agent_id: AGENT_ID, agent_name: 'Luna', code: 'fix_channel_connection',
                severity: 'critical', href: '/admin/channels', evidence_count: 1,
            }],
        });

        const result = await service.getAttentionSummary(TENANT_ID);

        expect(result).toMatchObject({
            worstStatus: 'at_risk', agentsTotal: 2, evaluatedAgents: 2, agentsNeedingAttention: 1,
            openCritical: 1, openHigh: 2, attentionCount: 3,
            topAction: { signalId: SIGNAL_ID, agentId: AGENT_ID, code: 'fix_channel_connection' },
        });
        expect(JSON.stringify(result)).not.toContain('conversation');
        expect(JSON.stringify(result)).not.toContain('fingerprint');
        expect(redis.setJson).toHaveBeenCalledWith(expect.any(String), result, 60);
    });

    it('serves a cached summary without tenant-schema work', async () => {
        const cached = { generatedAt: 'cached', worstStatus: null, agentsTotal: 0, evaluatedAgents: 0, agentsNeedingAttention: 0, openCritical: 0, openHigh: 0, attentionCount: 0, agents: [] };
        const { service, prisma } = createHarness({ cachedSummary: cached });

        await expect(service.getAttentionSummary(TENANT_ID)).resolves.toBe(cached);
        expect(prisma.getTenantSchemaName).not.toHaveBeenCalled();
    });

    it('coalesces concurrent manual refreshes onto the persisted summary', async () => {
        const cached = { generatedAt: 'cached', worstStatus: null, agentsTotal: 0, evaluatedAgents: 0, agentsNeedingAttention: 0, openCritical: 0, openHigh: 0, attentionCount: 0, agents: [] };
        const { service, quality, redis } = createHarness({
            cachedSummary: cached,
            manualRefreshLockToken: null,
        });

        await expect(service.reconcileTenantManual(TENANT_ID)).resolves.toBe(cached);
        expect(redis.acquireLockToken).toHaveBeenCalledWith(
            expect.stringContaining('manual-refresh:lock'), 300,
        );
        expect(quality.getOverview).not.toHaveBeenCalled();
    });

    it('honors the tenant manual-refresh cooldown without recalculating agents', async () => {
        const cached = { generatedAt: 'cached', worstStatus: null, agentsTotal: 0, evaluatedAgents: 0, agentsNeedingAttention: 0, openCritical: 0, openHigh: 0, attentionCount: 0, agents: [] };
        const { service, quality, redis } = createHarness({
            cachedSummary: cached,
            manualRefreshCooldown: true,
        });

        await expect(service.reconcileTenantManual(TENANT_ID)).resolves.toBe(cached);
        expect(redis.acquireLockToken).not.toHaveBeenCalled();
        expect(quality.getOverview).not.toHaveBeenCalled();
    });

    it('sets a 60-second cooldown after one bounded manual refresh', async () => {
        const { service, redis } = createHarness({ attentionRows: [] });

        await service.reconcileTenantManual(TENANT_ID);

        expect(redis.set).toHaveBeenCalledWith(
            expect.stringContaining('manual-refresh:cooldown'), '1', 60,
        );
        expect(redis.releaseLockToken).toHaveBeenCalledWith(
            expect.stringContaining('manual-refresh:lock'), 'manual-lock-token',
        );
    });

    it('returns a safe signal contract without internal actors or fingerprints', async () => {
        const { service } = createHarness({ signalRows: [signalRow] });

        const [signal] = await service.getSignals(TENANT_ID, 'open', 999);

        expect(signal).toEqual({
            id: SIGNAL_ID,
            agent: { id: AGENT_ID, name: 'Luna', version: 4 },
            code: 'fix_channel_connection', severity: 'critical', pillar: 'preparation',
            dimension: 'actions_outcomes', state: 'open', href: '/admin/channels',
            evidenceCount: 1, firstSeenAt: '2026-08-13T10:00:00.000Z',
            lastSeenAt: '2026-08-13T12:00:00.000Z', occurrenceCount: 2,
        });
        expect(signal).not.toHaveProperty('fingerprint');
        expect(signal).not.toHaveProperty('acknowledgedBy');
    });

    it('scopes assistant lookup by tenant, signal, agent and current config version', async () => {
        const { service, sqlCalls } = createHarness({ assistantRows: [signalRow] });

        const result = await service.getSignalForAssistant(TENANT_ID, SIGNAL_ID, AGENT_ID);

        expect(result.id).toBe(SIGNAL_ID);
        const lookup = sqlCalls.find((call) => call.sql.includes('s.agent_id = $2::uuid'))!;
        expect(lookup.params).toEqual([SIGNAL_ID, AGENT_ID]);
        expect(lookup.sql).toContain('ap.is_active = true');
        expect(lookup.sql).toContain('s.agent_config_version = COALESCE(ap.version, 1)');
        expect(lookup.sql).toContain("s.state IN ('open', 'acknowledged', 'snoozed')");
        expect(JSON.stringify(result)).not.toContain('internal-only');
    });

    it('does not reveal a missing or mismatched assistant signal', async () => {
        const { service } = createHarness({ assistantRows: [] });
        await expect(service.getSignalForAssistant(TENANT_ID, SIGNAL_ID, AGENT_ID))
            .rejects.toBeInstanceOf(NotFoundException);
    });

    it('acknowledges and snoozes active signals with bounded, tenant-scoped mutations', async () => {
        const acknowledged = { ...signalRow, state: 'acknowledged', acknowledged_at: '2026-08-13T12:00:00.000Z' };
        const ackHarness = createHarness({ signalRows: [acknowledged], mutationRows: [acknowledged] });
        const ack = await ackHarness.service.acknowledgeSignal(TENANT_ID, SIGNAL_ID, ACTOR_ID);
        expect(ack.state).toBe('acknowledged');
        expect(ackHarness.sqlCalls.find((call) => call.sql.includes("state = 'acknowledged'"))?.params)
            .toEqual([SIGNAL_ID, ACTOR_ID]);
        expect(ackHarness.sqlCalls.find((call) => call.sql.includes("state = 'acknowledged'"))?.sql)
            .toContain('COALESCE(ap.version, 1) = agent_quality_signals.agent_config_version');

        const snoozed = { ...signalRow, state: 'snoozed', snoozed_until: '2026-08-14T12:00:00.000Z' };
        const snoozeHarness = createHarness({ signalRows: [snoozed], mutationRows: [snoozed] });
        const snooze = await snoozeHarness.service.snoozeSignal(
            TENANT_ID, SIGNAL_ID, ACTOR_ID, { durationHours: 24 },
        );
        expect(snooze.state).toBe('snoozed');
        expect(snooze.snoozedUntil).toBe('2026-08-14T12:00:00.000Z');
        expect(snoozeHarness.redis.del).toHaveBeenCalledWith(expect.stringContaining('attention-summary'));
    });

    it('rejects invalid states, mutation UUIDs and unbounded snoozes', async () => {
        const { service } = createHarness();
        await expect(service.getSignals(TENANT_ID, 'invalid' as any)).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.acknowledgeSignal(TENANT_ID, 'not-a-uuid', ACTOR_ID)).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.snoozeSignal(TENANT_ID, SIGNAL_ID, ACTOR_ID, { durationHours: 721 }))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('debounces high-volume QA events but immediately reconciles config/eval events', async () => {
        const blocked = createHarness({ eventDebounceAcquired: false });
        await blocked.service.onQualityScored({ tenantId: TENANT_ID, agentId: AGENT_ID });
        expect(blocked.quality.getOverview).not.toHaveBeenCalled();

        const immediate = createHarness();
        await immediate.service.onAgentConfigUpdated({ tenantId: TENANT_ID, agentId: AGENT_ID });
        await immediate.service.onAgentVersionUpdated({ tenantId: TENANT_ID, agentId: AGENT_ID });
        await immediate.service.onEvalCompleted({ tenantId: TENANT_ID, agentId: AGENT_ID });
        await immediate.service.onSimulationCompleted({ tenantId: TENANT_ID, agentId: AGENT_ID });
        expect(immediate.quality.getOverview).toHaveBeenCalledTimes(4);
    });

    it('coalesces tenant dependency changes into at most two bounded passes', async () => {
        const { service, redis, quality, sqlCalls } = createHarness();
        redis.getDel.mockImplementation(async (key: string) =>
            key.includes('dependency-reconcile:pending') ? '1' : null);

        await service.onDependenciesUpdated({ tenantId: TENANT_ID, source: 'channel_connection' });

        expect(quality.getOverview).toHaveBeenCalledTimes(2);
        const agentLoads = sqlCalls.filter((call) => call.sql.includes('FROM agent_personas') && call.sql.includes('SELECT id'));
        expect(agentLoads).toHaveLength(2);
        expect(agentLoads.every((call) => call.params[0] === 1_000)).toBe(true);
        expect(redis.releaseLockToken).toHaveBeenCalledWith(
            expect.stringContaining('dependency-reconcile:lock'),
            'dependency-lock-token',
        );
    });

    it('leaves a tenant dependency marker when another process owns the reconcile lock', async () => {
        const { service, redis, quality } = createHarness({ dependencyLockToken: null });

        await service.onDependenciesUpdated({ tenantId: TENANT_ID, source: 'knowledge' });

        expect(redis.set).toHaveBeenCalledWith(
            expect.stringContaining('dependency-reconcile:pending'), '1', 1_800,
        );
        expect(quality.getOverview).not.toHaveBeenCalled();
    });

    it('ignores malformed or unknown tenant dependency events', async () => {
        const { service, redis } = createHarness();

        await service.onDependenciesUpdated({ tenantId: 'not-a-uuid', source: 'knowledge' });
        await service.onDependenciesUpdated({ tenantId: TENANT_ID, source: 'unknown' as any });

        expect(redis.acquireLockToken).not.toHaveBeenCalled();
    });

    it('runs the bounded cron through the shared cross-process lock and advances its cursor', async () => {
        const { service, cronLock, prisma, redis, sqlCalls } = createHarness();

        await service.reconcileCron();

        expect(cronLock.runExclusive).toHaveBeenCalledWith(
            'quality.reconcileAgentAttention', 600, expect.any(Function), { prefer: 'worker' },
        );
        expect(prisma.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
        expect(sqlCalls.find((call) => call.sql.includes('SELECT id') && call.sql.includes('FROM agent_personas'))?.sql)
            .toContain('WHERE is_active = true');
        expect(redis.del).toHaveBeenCalledWith('agent-quality:reconcile:tenant-cursor:v1');
    });

    it('advances the per-tenant agent cursor after a full cron page', async () => {
        const agentRows = Array.from({ length: 25 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        }));
        const { service, redis } = createHarness({ agentRows });

        await (service as any).reconcileTenantCronPage(TENANT_ID);

        expect(redis.set).toHaveBeenCalledWith(
            expect.stringContaining('reconcile:agent-cursor:v1'),
            agentRows[24].id,
            86_400 * 30,
        );
    });

    it('continues the cron and advances its tenant cursor when one tenant schema fails', async () => {
        const brokenTenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const healthyTenantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const tenants = Array.from({ length: 25 }, (_, index) => ({
            id: index === 0
                ? brokenTenantId
                : index === 24
                    ? healthyTenantId
                    : `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        }));
        const { service, redis, quality } = createHarness({
            tenantRows: tenants,
            schemaFailureTenantId: brokenTenantId,
        });

        await service.reconcileCronBatch();

        expect(quality.getOverview).toHaveBeenCalled();
        expect(redis.set).toHaveBeenCalledWith(
            'agent-quality:reconcile:tenant-cursor:v1', healthyTenantId, 86_400 * 7,
        );
    });

    /**
     * Ola 6: the banner could not tell "failed" from "could not check" — both
     * reach it as `critical` — nor say which credential or which WhatsApp
     * problem it was about. The signal now carries that, from closed
     * vocabularies, and every field is optional so a row written before them
     * reads as "not known".
     */
    describe('what a signal says beyond its code', () => {
        const detailed: AgentQualityOverview = {
            ...overview,
            recommendations: [
                {
                    code: 'fix_channel_connection', pillar: 'preparation', dimension: 'actions_outcomes', severity: 'critical',
                    href: '/admin/channels', checkStatus: 'unknown', params: { credentialIssue: 'expired' },
                },
                {
                    code: 'fix_whatsapp_delivery', pillar: 'preparation', dimension: 'actions_outcomes', severity: 'critical',
                    href: '/admin/channels/whatsapp', checkStatus: 'fail', params: { reason: 'timezone_missing', reasons: 'timezone_missing' },
                },
                {
                    // A generic `reason` on another code is not a delivery issue,
                    // and a status outside the vocabulary is not stored.
                    code: 'fix_channel_unanswered', pillar: 'preparation', dimension: 'actions_outcomes', severity: 'critical',
                    href: '/admin/agent', checkStatus: 'broken' as any, params: { reason: 'timezone_missing', credentialIssue: 'expired' },
                },
                {
                    code: 'fix_whatsapp_delivery_extra', pillar: 'preparation', dimension: 'actions_outcomes', severity: 'high',
                    href: '/admin/channels', checkStatus: 'warning', params: { reason: 'DROP TABLE' },
                },
                { code: 'run_eval', pillar: 'tested', dimension: 'robustness_operations', severity: 'high', href: '/admin/agent/simulation' },
            ],
        };

        it('persists the check status and the issue, and refreshes them on every reconcile', async () => {
            const { service, txCalls } = createHarness({ overview: detailed });
            await service.reconcileAgent(TENANT_ID, AGENT_ID, 'manual');
            const upserts = txCalls.filter((call) => call.sql.includes('ON CONFLICT (fingerprint) DO UPDATE'));
            const detail = (code: string) => upserts.find((call) => call.params[2] === code)!.params.slice(9, 12);

            expect(detail('fix_channel_connection')).toEqual(['unknown', 'expired', null]);
            expect(detail('fix_whatsapp_delivery')).toEqual(['fail', null, 'timezone_missing']);
            expect(detail('fix_channel_unanswered')).toEqual([null, null, null]);
            expect(detail('fix_whatsapp_delivery_extra')).toEqual(['warning', null, null]);
            expect(detail('run_eval')).toEqual([null, null, null]);
            for (const column of ['check_status', 'credential_issue', 'delivery_issue']) {
                expect(upserts[0].sql).toContain(`${column} = EXCLUDED.${column}`);
            }
        });

        it('puts them on the top action, so the banner needs no second request', async () => {
            const { service } = createHarness({
                attentionRows: [{ id: AGENT_ID, name: 'Luna', version: 4, snapshot_status: 'configuration_incomplete', has_snapshot: true, critical_count: 1, high_count: 0 }],
                topRows: [{
                    id: SIGNAL_ID, agent_id: AGENT_ID, agent_name: 'Luna', code: 'fix_whatsapp_delivery', severity: 'critical',
                    href: '/admin/channels/whatsapp', evidence_count: 0,
                    check_status: 'fail', credential_issue: null, delivery_issue: 'funding_restricted',
                }],
            });
            const summary = await service.getAttentionSummary(TENANT_ID);
            expect(summary.topAction).toEqual({
                signalId: SIGNAL_ID, agentId: AGENT_ID, agentName: 'Luna', code: 'fix_whatsapp_delivery', severity: 'critical',
                href: '/admin/channels/whatsapp', evidenceCount: 0, checkStatus: 'fail', deliveryIssue: 'funding_restricted',
            });
        });

        it('says nothing it does not know: an old row has no detail, and a foreign value is dropped', async () => {
            const legacy = await createHarness({
                topRows: [{ id: SIGNAL_ID, agent_id: AGENT_ID, agent_name: 'Luna', code: 'fix_channel_connection', severity: 'critical', href: '/admin/channels', evidence_count: 1 }],
            }).service.getAttentionSummary(TENANT_ID);
            expect(legacy.topAction).not.toHaveProperty('checkStatus');
            expect(legacy.topAction).not.toHaveProperty('credentialIssue');
            expect(legacy.topAction).not.toHaveProperty('deliveryIssue');

            const foreign = await createHarness({
                topRows: [{ id: SIGNAL_ID, agent_id: AGENT_ID, agent_name: 'Luna', code: 'fix_channel_connection', severity: 'critical', href: '/admin/channels', evidence_count: 1,
                    check_status: 'maybe', credential_issue: '<script>', delivery_issue: 'x' }],
            }).service.getAttentionSummary(TENANT_ID);
            expect(foreign.topAction).toEqual(expect.not.objectContaining({ checkStatus: expect.anything() }));
            expect(foreign.topAction).not.toHaveProperty('credentialIssue');

            const unknownCheck = await createHarness({
                topRows: [{ id: SIGNAL_ID, agent_id: AGENT_ID, agent_name: 'Luna', code: 'fix_channel_connection', severity: 'critical', href: '/admin/channels', evidence_count: 1,
                    check_status: 'unknown', credential_issue: null, delivery_issue: null }],
            }).service.getAttentionSummary(TENANT_ID);
            expect(unknownCheck.topAction).toMatchObject({ severity: 'critical', checkStatus: 'unknown' });
        });

        it('finds the delivery failure even when another critical is the top action', async () => {
            // Day 0: the banner hides a missing business description, and a
            // WhatsApp that refuses every reply must not hide behind it.
            const { service, sqlCalls } = createHarness({
                topRows: [{ id: SIGNAL_ID, agent_id: AGENT_ID, agent_name: 'Luna', code: 'fix_business_identity', severity: 'critical',
                    href: '/admin/settings/business-info', evidence_count: 0, check_status: 'fail' }],
                deliveryRows: [{ id: ACTOR_ID, agent_id: AGENT_ID, agent_name: 'Luna', code: 'fix_whatsapp_delivery', severity: 'critical',
                    href: '/admin/channels/whatsapp', evidence_count: 0, check_status: 'fail', delivery_issue: 'timezone_missing' }],
            });
            const summary = await service.getAttentionSummary(TENANT_ID);
            expect(summary.topAction).toMatchObject({ code: 'fix_business_identity' });
            expect(summary.deliveryAction).toEqual({
                signalId: ACTOR_ID, agentId: AGENT_ID, agentName: 'Luna', code: 'fix_whatsapp_delivery', severity: 'critical',
                href: '/admin/channels/whatsapp', evidenceCount: 0, checkStatus: 'fail', deliveryIssue: 'timezone_missing',
            });
            const query = sqlCalls.find((call) => call.sql.includes('s.code = ANY($1::text[])'))!;
            expect(query.params).toEqual([[...AGENT_QUALITY_DELIVERY_FAILURE_CODES]]);
            expect(query.sql).toContain("s.state = 'open'");
            expect(query.sql).toContain('s.agent_config_version = COALESCE(ap.version, 1)');
            // A real failure outranks a check that could not be run.
            expect(query.sql).toMatch(/ORDER BY CASE WHEN s\.check_status = 'fail' THEN 0 ELSE 1 END/);
        });

        it('says nothing about delivery when no delivery failure is open', async () => {
            const summary = await createHarness({ topRows: [] }).service.getAttentionSummary(TENANT_ID);
            expect(summary).not.toHaveProperty('deliveryAction');
        });

        it('carries the same detail on a listed signal', async () => {
            const { service } = createHarness({ signalRows: [{ ...signalRow, check_status: 'fail', credential_issue: 'revoked' }] });
            const [signal] = await service.getSignals(TENANT_ID, 'open');
            expect(signal).toMatchObject({ checkStatus: 'fail', credentialIssue: 'revoked' });
            expect(signal).not.toHaveProperty('deliveryIssue');
        });

        it('adds the columns additively, and a schema marked ready before them runs the DDL again', async () => {
            const { service, txCalls, redis } = createHarness({ tablesCached: false });
            await service.ensureTables(SCHEMA);
            for (const column of ['check_status VARCHAR(20)', 'credential_issue VARCHAR(40)', 'delivery_issue VARCHAR(40)']) {
                expect(txCalls.some((call) => call.sql.includes(`ALTER TABLE agent_quality_signals ADD COLUMN IF NOT EXISTS ${column}`))).toBe(true);
            }
            expect(redis.set).toHaveBeenCalledWith(`agent_quality_attention_tables:v3:${SCHEMA}`, '1', 86400);

            const sql = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
            for (const column of ['check_status VARCHAR(20)', 'credential_issue VARCHAR(40)', 'delivery_issue VARCHAR(40)']) {
                expect(sql).toContain(`ALTER TABLE "{{SCHEMA_NAME}}"."agent_quality_signals" ADD COLUMN IF NOT EXISTS ${column};`);
            }
        });
    });
});
