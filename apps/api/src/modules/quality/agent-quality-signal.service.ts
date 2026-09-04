import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import type {
    AgentQualityAttentionSummary,
    AgentQualityDimension,
    AgentQualityOverview,
    AgentQualityPillar,
    AgentQualitySeverity,
    AgentQualitySignal,
    AgentQualitySignalState,
    AgentQualityStatus,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CronLockService } from '../redis/cron-lock.service';
import { AgentQualityService } from './agent-quality.service';
import {
    AGENT_QUALITY_DEPENDENCIES_UPDATED,
    AGENT_QUALITY_DEPENDENCY_SOURCES,
    type AgentQualityDependenciesUpdatedEvent,
} from './agent-quality-events';

const SUMMARY_CACHE_TTL_SECONDS = 60;
const EVENT_DEBOUNCE_SECONDS = 60;
const MANUAL_REFRESH_COOLDOWN_SECONDS = 60;
const MANUAL_REFRESH_LOCK_SECONDS = 300;
const CRON_TENANT_BATCH = 25;
const CRON_AGENT_BATCH = 25;
const INTERACTIVE_AGENT_BATCH = 50;
const SUMMARY_AGENT_BATCH = 1_000;
const SNAPSHOT_RETENTION_DAYS = 90;
const SNAPSHOT_MAX_PER_AGENT_VERSION = 200;
const DEPENDENCY_RECONCILE_LOCK_SECONDS = 900;
const DEPENDENCY_RECONCILE_PENDING_SECONDS = 1_800;
const DEPENDENCY_RECONCILE_MAX_PASSES = 2;
const MAX_SIGNAL_LIST = 100;
const MAX_SNOOZE_HOURS = 24 * 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNAL_STATES = new Set<AgentQualitySignalState>([
    'open', 'acknowledged', 'snoozed', 'resolved', 'superseded',
]);
const SIGNAL_SEVERITIES = new Set<AgentQualitySeverity>(['critical', 'high', 'medium', 'low']);
const SIGNAL_PILLARS = new Set<AgentQualityPillar>(['preparation', 'tested', 'production']);
const SIGNAL_DIMENSIONS = new Set<AgentQualityDimension>([
    'business_scope',
    'knowledge_grounding',
    'conversation_brand',
    'actions_outcomes',
    'safety_handoff',
    'robustness_operations',
]);

// Product-owned destinations only. A recommendation cannot turn a signal into
// an arbitrary redirect, even if its source is accidentally malformed later.
const QUALITY_ACTION_PREFIXES = [
    '/admin/agent',
    '/admin/settings',
    '/admin/knowledge',
    '/admin/channels',
    '/admin/appointments',
    '/admin/inventory',
    '/admin/orders',
    '/admin/catalog',
    '/admin/contacts',
    '/admin/users',
    '/admin/inbox',
    '/admin/properties',
    '/admin/tours',
    '/admin/treatment-plans',
    '/admin/listings',
    '/admin/pets',
    '/admin/menu',
    '/admin/memberships',
    '/admin/courses',
    '/admin/insurance',
    '/admin/service-requests',
] as const;

type SafeRecommendation = {
    code: string;
    severity: AgentQualitySeverity;
    pillar: AgentQualityPillar;
    dimension: AgentQualityDimension;
    href: string;
    evidenceCount: number;
};

@Injectable()
export class AgentQualitySignalService {
    private readonly logger = new Logger(AgentQualitySignalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly cronLock: CronLockService,
        private readonly quality: AgentQualityService,
    ) {}

    private tablesCacheKey(schemaName: string): string {
        return `agent_quality_attention_tables:v1:${schemaName}`;
    }

    private summaryCacheKey(tenantId: string): string {
        return this.redis.tenantKey(tenantId, 'agent-quality:attention-summary:v1');
    }

    private manualRefreshCooldownKey(tenantId: string): string {
        return this.redis.tenantKey(tenantId, 'agent-quality:manual-refresh:cooldown:v1');
    }

    private manualRefreshLockKey(tenantId: string): string {
        return this.redis.tenantKey(tenantId, 'agent-quality:manual-refresh:lock:v1');
    }

    private reconcilePendingKey(tenantId: string, agentId: string): string {
        return this.redis.tenantKey(tenantId, `agent-quality:reconcile-pending:${agentId}`);
    }

    private dependencyReconcileLockKey(tenantId: string): string {
        return this.redis.tenantKey(tenantId, 'agent-quality:dependency-reconcile:lock:v1');
    }

    private dependencyReconcilePendingKey(tenantId: string): string {
        return this.redis.tenantKey(tenantId, 'agent-quality:dependency-reconcile:pending:v1');
    }

    async ensureTables(schemaName: string): Promise<void> {
        if (await this.redis.get(this.tablesCacheKey(schemaName)).catch(() => null)) return;

        const statements = [
            `CREATE TABLE IF NOT EXISTS agent_quality_snapshots (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                agent_id UUID NOT NULL,
                agent_config_version INTEGER NOT NULL,
                status VARCHAR(40) NOT NULL,
                next_milestone VARCHAR(50) NOT NULL,
                preparation_status VARCHAR(40) NOT NULL,
                preparation_score NUMERIC,
                tested_status VARCHAR(40) NOT NULL,
                tested_score NUMERIC,
                production_status VARCHAR(40) NOT NULL,
                production_score NUMERIC,
                recommendation_count INTEGER NOT NULL DEFAULT 0,
                critical_count INTEGER NOT NULL DEFAULT 0,
                high_count INTEGER NOT NULL DEFAULT 0,
                fingerprint VARCHAR(64) NOT NULL,
                trigger VARCHAR(50) NOT NULL DEFAULT 'manual',
                calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (agent_id, agent_config_version, fingerprint)
            )`,
            `CREATE INDEX IF NOT EXISTS idx_agent_quality_snapshots_latest
                ON agent_quality_snapshots(agent_id, agent_config_version, calculated_at DESC)`,
            `CREATE TABLE IF NOT EXISTS agent_quality_signals (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                agent_id UUID NOT NULL,
                agent_config_version INTEGER NOT NULL,
                code VARCHAR(120) NOT NULL,
                severity VARCHAR(20) NOT NULL,
                pillar VARCHAR(30) NOT NULL,
                dimension VARCHAR(50) NOT NULL,
                state VARCHAR(20) NOT NULL DEFAULT 'open',
                href VARCHAR(300) NOT NULL,
                evidence_count INTEGER NOT NULL DEFAULT 0,
                fingerprint VARCHAR(64) NOT NULL UNIQUE,
                occurrence_count INTEGER NOT NULL DEFAULT 1,
                first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                acknowledged_at TIMESTAMPTZ,
                acknowledged_by UUID,
                snoozed_until TIMESTAMPTZ,
                snoozed_by UUID,
                resolved_at TIMESTAMPTZ,
                superseded_at TIMESTAMPTZ
            )`,
            `CREATE INDEX IF NOT EXISTS idx_agent_quality_signals_attention
                ON agent_quality_signals(state, severity, last_seen_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_agent_quality_signals_agent_version
                ON agent_quality_signals(agent_id, agent_config_version, state)`,
        ];

        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_acquired`,
                [`agent-quality-attention-tables:${schemaName}`],
            );
            for (const statement of statements) await query(statement, []);
        });
        // Mark readiness only after every table and index exists.
        await this.redis.set(this.tablesCacheKey(schemaName), '1', 86_400).catch(() => undefined);
    }

    async reconcileAgent(
        tenantId: string,
        agentId: string,
        trigger = 'manual',
        trailingDepth = 0,
    ): Promise<void> {
        if (!UUID_PATTERN.test(agentId)) return;
        const lockKey = this.redis.tenantKey(tenantId, `agent-quality:reconcile:${agentId}`);
        let lockToken: string | null | undefined;
        try {
            lockToken = await this.redis.acquireLockToken(lockKey, 120);
            if (!lockToken) {
                await this.redis.set(this.reconcilePendingKey(tenantId, agentId), '1', 300).catch(() => undefined);
                return;
            }
        } catch (error: any) {
            // Diagnostics fail open when Redis is temporarily unavailable; the
            // tenant-schema advisory lock still serializes persistence below.
            this.logger.warn(`[Agent quality] Redis reconcile lock unavailable: ${error?.message || error}`);
            lockToken = undefined;
        }

        try {
            const schemaName = await this.prisma.getTenantSchemaName(tenantId);
            if (schemaName) {
                await this.ensureTables(schemaName);
                const overview = await this.quality.getOverview(tenantId, agentId);
                // An intentionally disabled agent must not produce a permanent
                // platform-wide warning. Keep its history, but retire actionable
                // signals until the agent is active and reconciled again.
                if (!overview.agent.isActive) {
                    await this.supersedeAgentSignals(schemaName, agentId);
                } else {
                    const persisted = await this.persistOverview(schemaName, overview, this.safeTrigger(trigger));
                    if (!persisted) {
                        await this.redis.set(this.reconcilePendingKey(tenantId, agentId), '1', 300).catch(() => undefined);
                    }
                }
                await this.redis.del(this.summaryCacheKey(tenantId)).catch(() => undefined);
            }
        } finally {
            if (lockToken) await this.redis.releaseLockToken(lockKey, lockToken).catch(() => undefined);
        }
        const pendingKey = this.reconcilePendingKey(tenantId, agentId);
        if (await this.redis.getDel(pendingKey).catch(() => null)) {
            // Coalesce bursts without an unbounded recursive loop. If a third
            // mutation lands while both passes run, preserve the marker for the
            // next domain event or scheduled reconciliation.
            if (trailingDepth < 2) {
                await this.reconcileAgent(tenantId, agentId, `${trigger}_trailing`, trailingDepth + 1);
            } else {
                await this.redis.set(pendingKey, '1', 300).catch(() => undefined);
            }
        }
    }

    async reconcileTenant(tenantId: string, trigger = 'manual', limit = INTERACTIVE_AGENT_BATCH): Promise<number> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return 0;
        await this.ensureTables(schemaName);
        await this.supersedeInactiveAgentSignals(schemaName);
        const boundedLimit = Math.max(1, Math.min(SUMMARY_AGENT_BATCH, Math.floor(limit)));
        const agents = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
            schemaName,
            `SELECT id
               FROM agent_personas
              WHERE is_active = true
           ORDER BY updated_at DESC, id ASC
              LIMIT $1`,
            [boundedLimit],
        );

        // Three concurrent overviews keep the cron bounded without serializing a
        // large tenant for minutes or stampeding its database.
        for (let index = 0; index < agents.length; index += 3) {
            await Promise.all(agents.slice(index, index + 3).map(async ({ id }) => {
                try {
                    await this.reconcileAgent(tenantId, String(id), trigger);
                } catch (error: any) {
                    this.logger.warn(`[Agent quality] Reconcile failed for ${tenantId}/${id}: ${error?.message || error}`);
                }
            }));
        }
        // Also invalidate when the tenant has no active agents: cleanup may
        // have superseded the final visible signal without calling reconcileAgent.
        await this.redis.del(this.summaryCacheKey(tenantId)).catch(() => undefined);
        return agents.length;
    }

    private async reconcileTenantCronPage(tenantId: string): Promise<number> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return 0;
        await this.ensureTables(schemaName);
        await this.supersedeInactiveAgentSignals(schemaName);
        const cursorKey = this.redis.tenantKey(tenantId, 'agent-quality:reconcile:agent-cursor:v1');
        const cursor = await this.redis.get(cursorKey).catch(() => null);
        const agents = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
            schemaName,
            `SELECT id
               FROM agent_personas
              WHERE is_active = true
                AND ($1::uuid IS NULL OR id > $1::uuid)
           ORDER BY id ASC
              LIMIT $2`,
            [cursor || null, CRON_AGENT_BATCH],
        );

        for (let index = 0; index < agents.length; index += 3) {
            await Promise.all(agents.slice(index, index + 3).map(async ({ id }) => {
                try {
                    await this.reconcileAgent(tenantId, String(id), 'scheduled_reconcile');
                } catch (error: any) {
                    this.logger.warn(`[Agent quality] Scheduled agent reconcile failed: ${error?.message || error}`);
                }
            }));
        }
        if (agents.length === CRON_AGENT_BATCH) {
            await this.redis.set(cursorKey, String(agents[agents.length - 1].id), 86_400 * 30).catch(() => undefined);
        } else {
            await this.redis.del(cursorKey).catch(() => undefined);
        }
        await this.redis.del(this.summaryCacheKey(tenantId)).catch(() => undefined);
        return agents.length;
    }

    /**
     * Explicit UI refresh with tenant-wide stampede protection. At most one
     * refresh runs per tenant and another cannot start for 60 seconds after it
     * completes. Contenders receive the latest persisted/cacheable summary.
     */
    async reconcileTenantManual(tenantId: string): Promise<AgentQualityAttentionSummary> {
        const cooldownKey = this.manualRefreshCooldownKey(tenantId);
        const lockKey = this.manualRefreshLockKey(tenantId);
        if (await this.redis.get(cooldownKey).catch(() => null)) {
            return this.getAttentionSummary(tenantId);
        }

        let lockToken: string | null;
        try {
            lockToken = await this.redis.acquireLockToken(lockKey, MANUAL_REFRESH_LOCK_SECONDS);
        } catch (error: any) {
            // Without the tenant-wide limiter, a manual refresh must degrade to
            // the cheap persisted summary instead of fanning out DB work.
            this.logger.warn(`[Agent quality] Manual refresh limiter unavailable: ${error?.message || error}`);
            return this.getAttentionSummary(tenantId);
        }
        if (!lockToken) return this.getAttentionSummary(tenantId);

        try {
            // Close the race between the initial cooldown read and lock grant.
            if (!await this.redis.get(cooldownKey).catch(() => null)) {
                await this.reconcileTenant(tenantId, 'manual_refresh', INTERACTIVE_AGENT_BATCH);
                await this.redis.set(cooldownKey, '1', MANUAL_REFRESH_COOLDOWN_SECONDS);
            }
            return this.getAttentionSummary(tenantId);
        } finally {
            await this.redis.releaseLockToken(lockKey, lockToken).catch(() => undefined);
        }
    }

    async getAttentionSummary(tenantId: string): Promise<AgentQualityAttentionSummary> {
        const cached = await this.redis.getJson<AgentQualityAttentionSummary>(this.summaryCacheKey(tenantId))
            .catch(() => null);
        if (cached && typeof cached.evaluatedAgents === 'number') return cached;

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureTables(schemaName);
        await this.supersedeInactiveAgentSignals(schemaName);
        await this.reopenExpiredSnoozes(schemaName);

        // GET intentionally does not fan out or recalculate agent overviews.
        // First-run calculation happens through the bounded manual endpoint,
        // domain events or the cron.
        const rows = await this.loadAttentionRows(schemaName);

        const evaluatedAgents = rows.filter((row) => Boolean(row.has_snapshot)).length;
        const agents = rows.map((row) => ({
            id: String(row.id),
            name: String(row.name || ''),
            version: Number(row.version) || 1,
            status: (row.snapshot_status || 'not_evaluated') as AgentQualityStatus,
            criticalCount: Number(row.critical_count) || 0,
            highCount: Number(row.high_count) || 0,
            ...(row.top_signal_code ? { topSignalCode: String(row.top_signal_code) } : {}),
        }));
        const openCritical = agents.reduce((sum, agent) => sum + agent.criticalCount, 0);
        const openHigh = agents.reduce((sum, agent) => sum + agent.highCount, 0);
        const topRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT s.id, s.agent_id, ap.name AS agent_name, s.code, s.severity,
                    s.href, s.evidence_count
               FROM agent_quality_signals s
               JOIN agent_personas ap ON ap.id = s.agent_id
              WHERE s.state = 'open'
                AND ap.is_active = true
                AND s.agent_config_version = COALESCE(ap.version, 1)
                AND s.severity IN ('critical', 'high')
           ORDER BY CASE s.severity WHEN 'critical' THEN 0 ELSE 1 END,
                    s.last_seen_at DESC, s.id ASC
              LIMIT 1`,
            [],
        );
        const top = topRows[0];
        const summary: AgentQualityAttentionSummary = {
            generatedAt: new Date().toISOString(),
            worstStatus: this.worstStatus(agents.map((agent) => agent.status)),
            agentsTotal: agents.length,
            evaluatedAgents,
            agentsNeedingAttention: agents.filter((agent) => agent.criticalCount + agent.highCount > 0).length,
            openCritical,
            openHigh,
            attentionCount: openCritical + openHigh,
            ...(top ? {
                topAction: {
                    signalId: String(top.id),
                    agentId: String(top.agent_id),
                    agentName: String(top.agent_name || ''),
                    code: String(top.code),
                    severity: top.severity as AgentQualitySeverity,
                    href: this.safeHref(top.href),
                    evidenceCount: Number(top.evidence_count) || 0,
                },
            } : {}),
            agents,
        };
        await this.redis.setJson(this.summaryCacheKey(tenantId), summary, SUMMARY_CACHE_TTL_SECONDS)
            .catch(() => undefined);
        return summary;
    }

    async getSignals(
        tenantId: string,
        state: AgentQualitySignalState = 'open',
        limit = 50,
    ): Promise<AgentQualitySignal[]> {
        if (!SIGNAL_STATES.has(state)) throw new BadRequestException('Invalid signal state');
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureTables(schemaName);
        await this.supersedeInactiveAgentSignals(schemaName);
        await this.reopenExpiredSnoozes(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT s.*, ap.name AS agent_name
               FROM agent_quality_signals s
               JOIN agent_personas ap ON ap.id = s.agent_id
              WHERE s.state = $1
                AND ap.is_active = true
                AND s.agent_config_version = COALESCE(ap.version, 1)
           ORDER BY CASE s.severity
                        WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2 ELSE 3
                    END,
                    s.last_seen_at DESC, s.id ASC
              LIMIT $2`,
            [state, Math.max(1, Math.min(MAX_SIGNAL_LIST, Math.floor(limit) || 50))],
        );
        return rows.map((row) => this.toSignal(row));
    }

    /**
     * Purpose-limited lookup of ONE still-active signal, used by Parallly Assist
     * and by `GET /quality/:tenantId/signals/:signalId`. Both signal and agent
     * are required predicates inside the tenant schema, so a guessed signal UUID
     * cannot reveal another agent or tenant. The returned wire type is already
     * stripped of internal fingerprints, actors and any conversation evidence.
     */
    async getActiveSignal(
        tenantId: string,
        signalId: string,
        agentId: string,
    ): Promise<AgentQualitySignal> {
        if (!UUID_PATTERN.test(signalId) || !UUID_PATTERN.test(agentId)) {
            throw new BadRequestException('Invalid quality signal request');
        }
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureTables(schemaName);
        await this.reopenExpiredSnoozes(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT s.*, ap.name AS agent_name
               FROM agent_quality_signals s
               JOIN agent_personas ap ON ap.id = s.agent_id
              WHERE s.id = $1::uuid
                AND s.agent_id = $2::uuid
                AND ap.is_active = true
                AND s.agent_config_version = COALESCE(ap.version, 1)
                AND s.state IN ('open', 'acknowledged', 'snoozed')
              LIMIT 1`,
            [signalId, agentId],
        );
        if (!rows[0]) throw new NotFoundException('Active quality signal not found');
        return this.toSignal(rows[0]);
    }

    /** @deprecated Name kept for existing callers; use {@link getActiveSignal}. */
    async getSignalForAssistant(
        tenantId: string,
        signalId: string,
        agentId: string,
    ): Promise<AgentQualitySignal> {
        return this.getActiveSignal(tenantId, signalId, agentId);
    }

    async acknowledgeSignal(tenantId: string, signalId: string, actorId: string): Promise<AgentQualitySignal> {
        this.assertMutationIds(signalId, actorId);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE agent_quality_signals
                SET state = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2::uuid,
                    snoozed_until = NULL, snoozed_by = NULL
              WHERE id = $1::uuid
                AND state IN ('open', 'acknowledged', 'snoozed')
                AND EXISTS (
                    SELECT 1 FROM agent_personas ap
                     WHERE ap.id = agent_quality_signals.agent_id
                       AND ap.is_active = true
                       AND COALESCE(ap.version, 1) = agent_quality_signals.agent_config_version
                )
          RETURNING *`,
            [signalId, actorId],
        );
        if (!rows[0]) throw new NotFoundException('Active quality signal not found');
        await this.redis.del(this.summaryCacheKey(tenantId)).catch(() => undefined);
        return this.loadSignalWithAgent(schemaName, signalId);
    }

    async snoozeSignal(
        tenantId: string,
        signalId: string,
        actorId: string,
        input: { until?: string; durationHours?: number },
    ): Promise<AgentQualitySignal> {
        this.assertMutationIds(signalId, actorId);
        const until = this.resolveSnoozeUntil(input);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE agent_quality_signals
                SET state = 'snoozed', snoozed_until = $2::timestamptz, snoozed_by = $3::uuid,
                    acknowledged_at = NULL, acknowledged_by = NULL
              WHERE id = $1::uuid
                AND state IN ('open', 'acknowledged', 'snoozed')
                AND EXISTS (
                    SELECT 1 FROM agent_personas ap
                     WHERE ap.id = agent_quality_signals.agent_id
                       AND ap.is_active = true
                       AND COALESCE(ap.version, 1) = agent_quality_signals.agent_config_version
                )
          RETURNING *`,
            [signalId, until.toISOString(), actorId],
        );
        if (!rows[0]) throw new NotFoundException('Active quality signal not found');
        await this.redis.del(this.summaryCacheKey(tenantId)).catch(() => undefined);
        return this.loadSignalWithAgent(schemaName, signalId);
    }

    @OnEvent('agent.config.updated')
    async onAgentConfigUpdated(event: { tenantId?: string; agentId?: string }): Promise<void> {
        await this.reconcileFromEvent(event, 'agent_config_updated', false);
    }

    @OnEvent('agent.version.updated')
    async onAgentVersionUpdated(event: { tenantId?: string; agentId?: string }): Promise<void> {
        await this.reconcileFromEvent(event, 'agent_version_updated', false);
    }

    @OnEvent('quality.scored')
    async onQualityScored(event: { tenantId?: string; agentId?: string }): Promise<void> {
        await this.reconcileFromEvent(event, 'quality_scored', true);
    }

    @OnEvent('agent.eval.completed')
    async onEvalCompleted(event: { tenantId?: string; agentId?: string }): Promise<void> {
        await this.reconcileFromEvent(event, 'eval_completed', false);
    }

    @OnEvent('agent.simulation.completed')
    async onSimulationCompleted(event: { tenantId?: string; agentId?: string }): Promise<void> {
        await this.reconcileFromEvent(event, 'simulation_completed', false);
    }

    /**
     * Tenant-scoped dependencies (business data, channels, knowledge, humans,
     * services and catalogs) can change every agent overview without changing
     * an agent config version. Coalesce those mutations behind one distributed
     * tenant lock, reconcile at most the plan ceiling, and allow one trailing
     * pass for a mutation that lands while the first pass is still reading.
     */
    @OnEvent(AGENT_QUALITY_DEPENDENCIES_UPDATED)
    async onDependenciesUpdated(event: AgentQualityDependenciesUpdatedEvent): Promise<void> {
        if (!event?.tenantId || !UUID_PATTERN.test(event.tenantId)
            || !AGENT_QUALITY_DEPENDENCY_SOURCES.includes(event.source)) return;

        const pendingKey = this.dependencyReconcilePendingKey(event.tenantId);
        const lockKey = this.dependencyReconcileLockKey(event.tenantId);
        await this.redis.set(pendingKey, '1', DEPENDENCY_RECONCILE_PENDING_SECONDS).catch(() => undefined);

        let lockToken: string | null;
        try {
            lockToken = await this.redis.acquireLockToken(lockKey, DEPENDENCY_RECONCILE_LOCK_SECONDS);
        } catch (error: any) {
            this.logger.warn(`[Agent quality] Dependency reconcile limiter unavailable: ${error?.message || error}`);
            return;
        }
        if (!lockToken) return;

        try {
            for (let pass = 0; pass < DEPENDENCY_RECONCILE_MAX_PASSES; pass++) {
                const pending = await this.redis.getDel(pendingKey).catch(() => null);
                if (!pending) break;
                await this.reconcileTenant(
                    event.tenantId,
                    `dependency_${event.source}`,
                    SUMMARY_AGENT_BATCH,
                );
            }
        } catch (error: any) {
            // Keep a durable marker for the next domain event or six-hour
            // safety-net cron. Diagnostics must never fail the source mutation.
            await this.redis.set(pendingKey, '1', DEPENDENCY_RECONCILE_PENDING_SECONDS).catch(() => undefined);
            this.logger.warn(`[Agent quality] Dependency reconcile failed: ${error?.message || error}`);
        } finally {
            await this.redis.releaseLockToken(lockKey, lockToken).catch(() => undefined);
        }
    }

    // Covers missed in-process events and changes made by modules that do not yet
    // publish a quality event. Pagination cursor bounds every six-hour pass.
    @Cron('17 */6 * * *')
    async reconcileCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'quality.reconcileAgentAttention',
            600,
            () => this.reconcileCronBatch(),
            { prefer: 'worker' },
        );
    }

    async reconcileCronBatch(): Promise<void> {
        const cursorKey = 'agent-quality:reconcile:tenant-cursor:v1';
        const cursor = await this.redis.get(cursorKey);
        const tenants = await this.prisma.tenant.findMany({
            where: {
                isActive: true,
                ...(cursor ? { id: { gt: cursor } } : {}),
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: CRON_TENANT_BATCH,
        });
        for (const tenant of tenants) {
            try {
                await this.reconcileTenantCronPage(tenant.id);
            } catch (error: any) {
                // One damaged/unavailable tenant must never pin the shared
                // cursor and starve every tenant ordered after it.
                this.logger.warn(`[Agent quality] Scheduled tenant reconcile failed: ${error?.message || error}`);
            }
        }
        if (tenants.length === CRON_TENANT_BATCH) {
            await this.redis.set(cursorKey, tenants[tenants.length - 1].id, 86_400 * 7);
        } else {
            await this.redis.del(cursorKey);
        }
    }

    private async persistOverview(
        schemaName: string,
        overview: AgentQualityOverview,
        trigger: string,
    ): Promise<boolean> {
        const recommendations = overview.recommendations
            .map((recommendation) => this.safeRecommendation(recommendation))
            .filter((recommendation): recommendation is SafeRecommendation => recommendation !== null);
        const snapshotFingerprint = this.hash(JSON.stringify({
            agentId: overview.agent.id,
            version: overview.agent.version,
            status: overview.status,
            nextMilestone: overview.nextMilestone,
            preparation: [overview.preparation.status, overview.preparation.score],
            tested: [overview.tested.status, overview.tested.score],
            production: [overview.production.status, overview.production.observedScore],
            recommendations: recommendations
                .map(({ code, severity, evidenceCount }) => ({ code, severity, evidenceCount }))
                .sort((left, right) => left.code.localeCompare(right.code)),
        }));
        const criticalCount = recommendations.filter((item) => item.severity === 'critical').length;
        const highCount = recommendations.filter((item) => item.severity === 'high').length;
        const activeCodes = recommendations.map((item) => item.code);

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_acquired`,
                [`agent-quality:${overview.agent.id}`],
            );
            const currentRows = await query<Array<{ version: number; is_active: boolean }>>(
                `SELECT COALESCE(version, 1)::int AS version, is_active
                   FROM agent_personas
                  WHERE id = $1::uuid
                  FOR SHARE`,
                [overview.agent.id],
            );
            if (!currentRows[0]?.is_active || Number(currentRows[0].version) !== overview.agent.version) {
                return false;
            }
            await query(
                `INSERT INTO agent_quality_snapshots
                    (agent_id, agent_config_version, status, next_milestone,
                     preparation_status, preparation_score, tested_status, tested_score,
                     production_status, production_score, recommendation_count,
                     critical_count, high_count, fingerprint, trigger)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                         $11, $12, $13, $14, $15)
                 ON CONFLICT (agent_id, agent_config_version, fingerprint) DO NOTHING`,
                [
                    overview.agent.id,
                    overview.agent.version,
                    overview.status,
                    overview.nextMilestone,
                    overview.preparation.status,
                    overview.preparation.score,
                    overview.tested.status,
                    overview.tested.score,
                    overview.production.status,
                    overview.production.observedScore,
                    recommendations.length,
                    criticalCount,
                    highCount,
                    snapshotFingerprint,
                    trigger,
                ],
            );
            await query(
                `UPDATE agent_quality_signals
                    SET state = 'superseded', superseded_at = NOW(), last_seen_at = NOW()
                  WHERE agent_id = $1::uuid
                    AND agent_config_version <> $2
                    AND state IN ('open', 'acknowledged', 'snoozed')`,
                [overview.agent.id, overview.agent.version],
            );

            for (const recommendation of recommendations) {
                const fingerprint = this.hash(`${overview.agent.id}:${overview.agent.version}:${recommendation.code}`);
                await query(
                    `INSERT INTO agent_quality_signals
                        (agent_id, agent_config_version, code, severity, pillar, dimension,
                         state, href, evidence_count, fingerprint)
                     VALUES ($1::uuid, $2, $3, $4, $5, $6, 'open', $7, $8, $9)
                     ON CONFLICT (fingerprint) DO UPDATE SET
                        severity = EXCLUDED.severity,
                        pillar = EXCLUDED.pillar,
                        dimension = EXCLUDED.dimension,
                        href = EXCLUDED.href,
                        evidence_count = EXCLUDED.evidence_count,
                        occurrence_count = CASE
                            WHEN agent_quality_signals.evidence_count IS DISTINCT FROM EXCLUDED.evidence_count
                              OR agent_quality_signals.severity IS DISTINCT FROM EXCLUDED.severity
                              OR agent_quality_signals.state IN ('resolved', 'superseded')
                            THEN agent_quality_signals.occurrence_count + 1
                            ELSE agent_quality_signals.occurrence_count
                        END,
                        first_seen_at = CASE
                            WHEN agent_quality_signals.state IN ('resolved', 'superseded') THEN NOW()
                            ELSE agent_quality_signals.first_seen_at
                        END,
                        last_seen_at = NOW(),
                        state = CASE
                            WHEN agent_quality_signals.state = 'acknowledged'
                              AND ${this.severityRankSql('EXCLUDED.severity')} >= ${this.severityRankSql('agent_quality_signals.severity')}
                            THEN 'acknowledged'
                            WHEN agent_quality_signals.state = 'snoozed'
                              AND agent_quality_signals.snoozed_until > NOW()
                              AND ${this.severityRankSql('EXCLUDED.severity')} >= ${this.severityRankSql('agent_quality_signals.severity')}
                            THEN 'snoozed'
                            ELSE 'open'
                        END,
                        acknowledged_at = CASE
                            WHEN agent_quality_signals.state = 'acknowledged'
                              AND ${this.severityRankSql('EXCLUDED.severity')} >= ${this.severityRankSql('agent_quality_signals.severity')}
                            THEN agent_quality_signals.acknowledged_at ELSE NULL END,
                        acknowledged_by = CASE
                            WHEN agent_quality_signals.state = 'acknowledged'
                              AND ${this.severityRankSql('EXCLUDED.severity')} >= ${this.severityRankSql('agent_quality_signals.severity')}
                            THEN agent_quality_signals.acknowledged_by ELSE NULL END,
                        snoozed_until = CASE
                            WHEN agent_quality_signals.state = 'snoozed'
                              AND agent_quality_signals.snoozed_until > NOW()
                              AND ${this.severityRankSql('EXCLUDED.severity')} >= ${this.severityRankSql('agent_quality_signals.severity')}
                            THEN agent_quality_signals.snoozed_until ELSE NULL END,
                        snoozed_by = CASE
                            WHEN agent_quality_signals.state = 'snoozed'
                              AND agent_quality_signals.snoozed_until > NOW()
                              AND ${this.severityRankSql('EXCLUDED.severity')} >= ${this.severityRankSql('agent_quality_signals.severity')}
                            THEN agent_quality_signals.snoozed_by ELSE NULL END,
                        resolved_at = NULL,
                        superseded_at = NULL`,
                    [
                        overview.agent.id,
                        overview.agent.version,
                        recommendation.code,
                        recommendation.severity,
                        recommendation.pillar,
                        recommendation.dimension,
                        recommendation.href,
                        recommendation.evidenceCount,
                        fingerprint,
                    ],
                );
            }

            await query(
                `UPDATE agent_quality_signals
                    SET state = 'resolved', resolved_at = NOW(), last_seen_at = NOW(),
                        acknowledged_at = NULL, acknowledged_by = NULL,
                        snoozed_until = NULL, snoozed_by = NULL
                  WHERE agent_id = $1::uuid
                    AND agent_config_version = $2
                    AND state IN ('open', 'acknowledged', 'snoozed')
                    AND NOT (code = ANY($3::text[]))`,
                [overview.agent.id, overview.agent.version, activeCodes],
            );
            await query(
                `DELETE FROM agent_quality_snapshots
                  WHERE agent_id = $1::uuid
                    AND (
                        calculated_at < NOW() - ($2::int * INTERVAL '1 day')
                        OR id IN (
                            SELECT id FROM agent_quality_snapshots
                             WHERE agent_id = $1::uuid
                               AND agent_config_version = $3
                          ORDER BY calculated_at DESC, id DESC
                            OFFSET $4
                        )
                    )`,
                [overview.agent.id, SNAPSHOT_RETENTION_DAYS, overview.agent.version, SNAPSHOT_MAX_PER_AGENT_VERSION],
            );
            return true;
        });
    }

    private async reconcileFromEvent(
        event: { tenantId?: string; agentId?: string },
        trigger: string,
        debounced: boolean,
    ): Promise<void> {
        if (!event?.tenantId || !event?.agentId || !UUID_PATTERN.test(event.agentId)) return;
        try {
            if (debounced) {
                const debounceKey = this.redis.tenantKey(
                    event.tenantId,
                    `agent-quality:event-debounce:${event.agentId}`,
                );
                const acquired = await this.redis.acquireLock(debounceKey, EVENT_DEBOUNCE_SECONDS);
                if (!acquired) return;
            }
            await this.reconcileAgent(event.tenantId, event.agentId, trigger);
        } catch (error: any) {
            // Quality attention is downstream diagnostics; it must never make an
            // agent save, eval or conversation resolution fail.
            this.logger.warn(`[Agent quality] ${trigger} reconcile failed: ${error?.message || error}`);
        }
    }

    private async loadAttentionRows(schemaName: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ap.id, ap.name, COALESCE(ap.version, 1) AS version,
                    snapshot.status AS snapshot_status,
                    COALESCE(snapshot.has_snapshot, false) AS has_snapshot,
                    COALESCE(signal_counts.critical_count, 0)::int AS critical_count,
                    COALESCE(signal_counts.high_count, 0)::int AS high_count,
                    top_signal.code AS top_signal_code
               FROM agent_personas ap
          LEFT JOIN LATERAL (
                    SELECT aqs.status, true AS has_snapshot
                      FROM agent_quality_snapshots aqs
                     WHERE aqs.agent_id = ap.id
                       AND aqs.agent_config_version = COALESCE(ap.version, 1)
                  ORDER BY aqs.calculated_at DESC, aqs.id DESC
                     LIMIT 1
               ) snapshot ON true
          LEFT JOIN LATERAL (
                    SELECT COUNT(*) FILTER (WHERE aqs.severity = 'critical')::int AS critical_count,
                           COUNT(*) FILTER (WHERE aqs.severity = 'high')::int AS high_count
                      FROM agent_quality_signals aqs
                     WHERE aqs.agent_id = ap.id
                       AND aqs.agent_config_version = COALESCE(ap.version, 1)
                       AND aqs.state = 'open'
               ) signal_counts ON true
          LEFT JOIN LATERAL (
                    SELECT aqs.code
                      FROM agent_quality_signals aqs
                     WHERE aqs.agent_id = ap.id
                       AND aqs.agent_config_version = COALESCE(ap.version, 1)
                       AND aqs.state = 'open'
                       AND aqs.severity IN ('critical', 'high')
                  ORDER BY CASE aqs.severity WHEN 'critical' THEN 0 ELSE 1 END,
                           aqs.last_seen_at DESC, aqs.id ASC
                     LIMIT 1
               ) top_signal ON true
              WHERE ap.is_active = true
           ORDER BY CASE WHEN COALESCE(signal_counts.critical_count, 0) > 0 THEN 0
                         WHEN COALESCE(signal_counts.high_count, 0) > 0 THEN 1 ELSE 2 END,
                    ap.is_default DESC, ap.name ASC, ap.id ASC
              LIMIT $1`,
            [SUMMARY_AGENT_BATCH],
        );
    }

    private async reopenExpiredSnoozes(schemaName: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE agent_quality_signals
                SET state = 'open', snoozed_until = NULL, snoozed_by = NULL
              WHERE state = 'snoozed' AND snoozed_until <= NOW()`,
            [],
        );
    }

    private async supersedeAgentSignals(schemaName: string, agentId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE agent_quality_signals
                SET state = 'superseded', superseded_at = NOW(),
                    acknowledged_at = NULL, acknowledged_by = NULL,
                    snoozed_until = NULL, snoozed_by = NULL
              WHERE agent_id = $1::uuid
                AND state IN ('open', 'acknowledged', 'snoozed')`,
            [agentId],
        );
    }

    private async supersedeInactiveAgentSignals(schemaName: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE agent_quality_signals s
                SET state = 'superseded', superseded_at = NOW(),
                    acknowledged_at = NULL, acknowledged_by = NULL,
                    snoozed_until = NULL, snoozed_by = NULL
               FROM agent_personas ap
              WHERE ap.id = s.agent_id
                AND ap.is_active = false
                AND s.state IN ('open', 'acknowledged', 'snoozed')`,
            [],
        );
    }

    private async loadSignalWithAgent(schemaName: string, signalId: string): Promise<AgentQualitySignal> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT s.*, ap.name AS agent_name
               FROM agent_quality_signals s
               JOIN agent_personas ap ON ap.id = s.agent_id
              WHERE s.id = $1::uuid
              LIMIT 1`,
            [signalId],
        );
        if (!rows[0]) throw new NotFoundException('Quality signal not found');
        return this.toSignal(rows[0]);
    }

    private toSignal(row: any): AgentQualitySignal {
        return {
            id: String(row.id),
            agent: {
                id: String(row.agent_id),
                name: String(row.agent_name || ''),
                version: Number(row.agent_config_version) || 1,
            },
            code: String(row.code),
            severity: row.severity as AgentQualitySeverity,
            pillar: row.pillar as AgentQualityPillar,
            dimension: row.dimension as AgentQualityDimension,
            state: row.state as AgentQualitySignalState,
            href: this.safeHref(row.href),
            evidenceCount: Number(row.evidence_count) || 0,
            firstSeenAt: this.iso(row.first_seen_at),
            lastSeenAt: this.iso(row.last_seen_at),
            occurrenceCount: Number(row.occurrence_count) || 1,
            ...(row.acknowledged_at ? { acknowledgedAt: this.iso(row.acknowledged_at) } : {}),
            ...(row.snoozed_until ? { snoozedUntil: this.iso(row.snoozed_until) } : {}),
        };
    }

    private safeRecommendation(recommendation: AgentQualityOverview['recommendations'][number]): SafeRecommendation | null {
        const code = String(recommendation.code || '').trim();
        if (!/^[a-z0-9_]{1,120}$/.test(code)) return null;
        if (!SIGNAL_SEVERITIES.has(recommendation.severity)
            || !SIGNAL_PILLARS.has(recommendation.pillar)
            || !SIGNAL_DIMENSIONS.has(recommendation.dimension)) return null;
        return {
            code,
            severity: recommendation.severity,
            pillar: recommendation.pillar,
            dimension: recommendation.dimension,
            href: this.safeHref(recommendation.href),
            evidenceCount: Math.max(0, Math.min(1_000_000, Math.floor(Number(recommendation.evidenceCount) || 0))),
        };
    }

    private safeHref(value: unknown): string {
        const href = typeof value === 'string' ? value.trim() : '';
        if (!href.startsWith('/admin/') || href.includes('..') || href.includes('\\') || href.includes('://')) {
            return '/admin/agent/quality';
        }
        const path = href.split(/[?#]/, 1)[0];
        return QUALITY_ACTION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
            ? href.slice(0, 300)
            : '/admin/agent/quality';
    }

    private resolveSnoozeUntil(input: { until?: string; durationHours?: number }): Date {
        const now = Date.now();
        let until: Date;
        if (input?.until) {
            until = new Date(input.until);
        } else {
            const duration = input?.durationHours == null ? 24 : Number(input.durationHours);
            if (!Number.isFinite(duration) || duration < 1 || duration > MAX_SNOOZE_HOURS) {
                throw new BadRequestException('durationHours must be between 1 and 720');
            }
            until = new Date(now + duration * 60 * 60 * 1000);
        }
        if (Number.isNaN(until.getTime()) || until.getTime() <= now
            || until.getTime() > now + MAX_SNOOZE_HOURS * 60 * 60 * 1000) {
            throw new BadRequestException('Invalid snooze expiration');
        }
        return until;
    }

    private assertMutationIds(signalId: string, actorId: string): void {
        if (!UUID_PATTERN.test(signalId) || !UUID_PATTERN.test(actorId)) {
            throw new BadRequestException('Invalid quality signal request');
        }
    }

    private worstStatus(statuses: AgentQualityStatus[]): AgentQualityStatus | null {
        if (!statuses.length) return null;
        const rank: Record<AgentQualityStatus, number> = {
            at_risk: 0,
            configuration_incomplete: 1,
            review_required: 2,
            not_evaluated: 3,
            ready_for_pilot: 4,
            operating_with_evidence: 5,
        };
        return [...statuses].sort((left, right) => rank[left] - rank[right])[0];
    }

    private severityRankSql(reference: string): string {
        return `(CASE ${reference} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)`;
    }

    private safeTrigger(value: string): string {
        return String(value || 'manual').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 50) || 'manual';
    }

    private hash(value: string): string {
        return createHash('sha256').update(value).digest('hex');
    }

    private iso(value: Date | string): string {
        return new Date(value).toISOString();
    }
}
