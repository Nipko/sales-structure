import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { CrmCryptoService } from './crm-crypto.service';
import { CrmAdapterFactory } from './crm-adapter.factory';
import { CronLockService } from '../redis/cron-lock.service';
import {
    ensureCrmNoteReceipts, pendingCrmNoteRetractions, recordCrmNoteReceipt,
    settleCrmNoteRetraction, type CrmRetractionOutcome,
} from './crm-note-receipts';
import type {
    CanonicalContact,
    CanonicalDeal,
    CanonicalActivity,
    CrmAdapterContext,
    CrmEntity,
} from './types/crm.types';

export const CRM_SYNC_QUEUE = 'crm-sync';

export interface CrmSyncJob {
    tenantId: string;
    connectionId: string;
    provider: string;
    entity: CrmEntity;
    operation: 'upsertContact' | 'upsertDeal' | 'pushActivity' | 'retractActivity';
    payload: any;
    /**
     * What produced this note, so the id the provider gives back can be written
     * down against something stable.
     *
     * Without it the note id was returned and dropped — the copy outside the
     * platform had no address, and an erasure could clear everything inside and
     * still leave the customer's summary in somebody's CRM. `sourceId` has to be
     * stable across attempts, which is why it is the handoff receipt id and not
     * the activity's own freshly generated UUID.
     */
    receipt?: {
        sourceKind: string;
        sourceId: string;
        conversationId?: string | null;
        contactId?: string | null;
    };
}

/** The CRM note is one paragraph and its transcript is the next. */
const NOTE_SEPARATOR = String.fromCharCode(10);

@Injectable()
export class ExternalCrmService {
    private readonly logger = new Logger(ExternalCrmService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly crypto: CrmCryptoService,
        private readonly factory: CrmAdapterFactory,
        private readonly throttle: TenantThrottleService,
        @InjectQueue(CRM_SYNC_QUEUE) private readonly queue: Queue<CrmSyncJob>,
        /** Optional so a unit test can build this service without Redis. */
        @Optional() private readonly cronLock?: CronLockService,
    ) {}

    /**
     * Turns the retractions an erasure asked for into calls, and keeps asking.
     *
     * The erasure only marks its rows, on its own transaction. This is what
     * makes that mark mean something, and it is deliberately the SAME mechanism
     * as the recovery: the row is the queue, so a BullMQ job lost to a restart
     * is simply re-enqueued on the next tick, and a `retract_pending` receipt
     * cannot go quiet just because a worker died holding it.
     *
     * Locked, because the API and the worker both load this module and an
     * unlocked `@Cron` body runs twice — which here would mean two DELETEs of
     * the same note in a tenant's CRM.
     */
    @Cron('*/5 * * * *')
    async drainCrmRetractionsCron(): Promise<void> {
        const run = () => this.drainCrmRetractions();
        await (this.cronLock
            ? this.cronLock.runExclusive('external-crm.drainRetractions', 150, run, { prefer: 'api' })
            : run());
    }

    async drainCrmRetractions(): Promise<number> {
        const connections = await this.prisma.crmConnection.findMany({
            where: { status: 'active' }, select: { tenantId: true }, distinct: ['tenantId'],
        });
        let drained = 0;
        for (const row of connections) {
            // One tenant whose schema is mid-migration must not stop the rest:
            // every other person's erasure is waiting behind this loop.
            try { drained += await this.retractPendingCrmNotes(row.tenantId); }
            catch (error: any) {
                this.logger.warn(`CRM retraction drain deferred for ${row.tenantId}: ${error?.message}`);
            }
        }
        return drained;
    }

    // ─── Connection management ──────────────────────────────────────────────

    async listConnections(tenantId: string) {
        return this.prisma.crmConnection.findMany({
            where: { tenantId },
            select: {
                id: true, provider: true, status: true,
                externalAccountId: true, externalAccountName: true,
                syncMode: true, lastSyncAt: true,
                lastErrorAt: true, lastErrorMessage: true,
                scopes: true, createdAt: true, updatedAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async startOAuth(tenantId: string, provider: string, redirectUri: string) {
        await this.assertCanAddConnection(tenantId, provider);
        const adapter = this.factory.get(provider);
        // State carries tenantId so the callback knows where to write the connection.
        // HMAC the state with the JWT secret to prevent forgery.
        const nonce = crypto.randomBytes(16).toString('hex');
        const state = this.signState({ tenantId, provider, nonce });
        return { authorizeUrl: adapter.buildAuthorizeUrl(state, redirectUri) };
    }

    async completeOAuth(state: string, code: string, redirectUri: string) {
        const decoded = this.verifyState(state);
        const adapter = this.factory.get(decoded.provider);
        const tokens = await adapter.exchangeCode(code, redirectUri);

        const existing = await this.prisma.crmConnection.findUnique({
            where: { tenantId_provider: { tenantId: decoded.tenantId, provider: decoded.provider } },
        });

        const data = {
            tenantId: decoded.tenantId,
            provider: decoded.provider,
            status: 'active',
            externalAccountId: tokens.externalAccountId,
            externalAccountName: tokens.externalAccountName,
            accessToken: this.crypto.encrypt(tokens.accessToken),
            refreshToken: tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null,
            tokenExpiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            lastErrorAt: null,
            lastErrorMessage: null,
        };

        const conn = existing
            ? await this.prisma.crmConnection.update({ where: { id: existing.id }, data })
            : await this.prisma.crmConnection.create({ data });

        await this.ensureTenantCrmTables(decoded.tenantId);
        return { id: conn.id, provider: conn.provider, externalAccountName: conn.externalAccountName };
    }

    async disconnect(tenantId: string, connectionId: string) {
        const conn = await this.prisma.crmConnection.findFirst({ where: { id: connectionId, tenantId } });
        if (!conn) throw new NotFoundException('Connection not found');
        await this.prisma.crmConnection.update({
            where: { id: connectionId },
            data: { status: 'revoked' },
        });
        return { ok: true };
    }

    async testConnection(tenantId: string, connectionId: string) {
        const ctx = await this.buildContext(tenantId, connectionId);
        const adapter = this.factory.get(ctx.metadata.provider);
        return adapter.testConnection(ctx);
    }

    // ─── Event listeners — fire-and-forget enqueue ──────────────────────────

    @OnEvent('lead.created')
    async onLeadCreated(payload: { tenantId: string; lead: any; contact: any }) {
        await this.enqueueForAllConnections(payload.tenantId, [
            { entity: 'contact', operation: 'upsertContact', payload: this.mapContact(payload.contact) },
            { entity: 'deal', operation: 'upsertDeal', payload: this.mapDeal(payload.lead, payload.contact) },
        ]);
    }

    @OnEvent('lead.stage_changed')
    async onLeadStageChanged(payload: { tenantId: string; lead: any; contact: any }) {
        await this.enqueueForAllConnections(payload.tenantId, [
            { entity: 'deal', operation: 'upsertDeal', payload: this.mapDeal(payload.lead, payload.contact) },
        ]);
    }

    // One destination, one event. A transfer used to announce itself once to
    // all six consumers, so a single failure among them re-announced it to
    // the five that had already succeeded.
    @OnEvent('handoff.escalated.crm')
    async onHandoffEscalated(payload: {
        tenantId: string; conversationId?: string; contactId?: string | null;
        channelType?: string | null; contactName?: string; reason?: string;
        summary?: string; lastMessage?: string; handoffReceiptId?: string | null;
    }) {
        // This handler read `payload.conversation`, `payload.contact` and
        // `payload.lastMessages`, none of which the event has ever carried: the
        // note reached the CRM attached to no contact, on no channel, with an
        // empty transcript. What the event does carry is the summary the
        // transfer already generated.
        // A note that names no contact lands nowhere a person will find it, and
        // every one written until now named none: the handler read fields the
        // event does not have.
        if (!payload?.tenantId || !payload.contactId) {
            this.logger.warn(`Handoff note not pushed: the escalation carried no contact`);
            return;
        }
        const summary = payload.summary || payload.lastMessage || '';
        const reasonNote = payload.reason ? ` (${payload.reason})` : '';
        const body = summary
            ? `Handoff a agente humano${reasonNote}.` + NOTE_SEPARATOR + summary
            : `Handoff a agente humano${reasonNote}.`;
        // A note pushed without a stable source id can be written but never
        // found again, so it is said out loud rather than discovered later by
        // somebody wondering why an erasure left a paragraph in their CRM.
        if (!payload.handoffReceiptId) {
            this.logger.warn('Handoff note pushed with no receipt id: the external copy will not be addressable');
        }
        await this.enqueueForAllConnections(payload.tenantId, [
            {
                entity: 'activity',
                operation: 'pushActivity',
                payload: this.mapActivity({
                    contactId: payload.contactId,
                    type: 'note',
                    body,
                    occurredAt: new Date(),
                    channel: payload.channelType ?? undefined,
                }),
                ...(payload.handoffReceiptId ? { receipt: {
                    sourceKind: 'handoff_summary',
                    sourceId: String(payload.handoffReceiptId),
                    conversationId: payload.conversationId ?? null,
                    contactId: payload.contactId,
                } } : {}),
            },
        ], payload.handoffReceiptId ? `handoff-${payload.handoffReceiptId}` : undefined);
    }

    private async enqueueForAllConnections(
        tenantId: string,
        jobs: Array<Omit<CrmSyncJob, 'tenantId' | 'connectionId' | 'provider'>>,
        /** Stable across attempts, so a retried announcement enqueues once.
         *  No ':' in it — BullMQ rejects that in a job id and the dedupe dies
         *  silently, which is how a duplicate delivery got shipped before. */
        dedupeKey?: string,
    ) {
        const conns = await this.prisma.crmConnection.findMany({
            where: { tenantId, status: 'active' },
            select: { id: true, provider: true },
        });
        if (conns.length === 0) return;

        for (const conn of conns) {
            for (const job of jobs) {
                await this.queue.add(
                    `${conn.provider}:${job.entity}:${job.operation}`,
                    { tenantId, connectionId: conn.id, provider: conn.provider, ...job },
                    {
                        attempts: 3, backoff: { type: 'exponential', delay: 5_000 },
                        removeOnComplete: 100, removeOnFail: 200,
                        ...(dedupeKey
                            ? { jobId: `${dedupeKey}-${conn.id}-${job.entity}-${job.operation}` }
                            : {}),
                    },
                );
            }
        }
    }

    // ─── Adapter execution (called by processor) ────────────────────────────

    async runJob(job: CrmSyncJob) {
        const ctx = await this.buildContext(job.tenantId, job.connectionId);
        const adapter = this.factory.get(job.provider);
        const start = Date.now();
        let externalId: string | null = null;
        let operation: string = job.operation;
        let status: 'success' | 'skipped' | 'failed' = 'success';
        let errorMessage: string | null = null;

        try {
            // BullMQ queue limiter (20/sec) is the rate guard. Per-tenant fairness
            // is good-enough since each tenant's worst-case enqueue is bounded by
            // the events that fire for their conversations.

            if (job.operation === 'upsertContact') {
                const r = await adapter.upsertContact(ctx, job.payload as CanonicalContact);
                externalId = r.externalId;
                operation = r.operation;
                await this.persistLink(job.tenantId, job.provider, 'contact', job.payload.id, r.externalId, r.externalUrl);
            } else if (job.operation === 'upsertDeal') {
                const deal = job.payload as CanonicalDeal;
                // Need contact externalId to associate — look it up first.
                const contactExternalId = await this.findExternalId(job.tenantId, job.provider, 'contact', deal.contactId);
                if (!contactExternalId) {
                    throw new Error(`Contact ${deal.contactId} not yet synced — will retry`);
                }
                const r = await adapter.upsertDeal(ctx, { ...deal, contactId: contactExternalId });
                externalId = r.externalId;
                operation = r.operation;
                await this.persistLink(job.tenantId, job.provider, 'deal', deal.id, r.externalId, r.externalUrl);
            } else if (job.operation === 'pushActivity') {
                const act = job.payload as CanonicalActivity;
                const contactExternalId = await this.findExternalId(job.tenantId, job.provider, 'contact', act.contactId);
                if (!contactExternalId) throw new Error(`Contact ${act.contactId} not synced — skipping activity`);
                const r = await adapter.pushActivity(ctx, { ...act, contactId: contactExternalId });
                externalId = r.externalId;
                // Where it went. The note id used to end here as a log line; it
                // is an address now, and an erasure can reach it.
                if (job.receipt && r.externalId) {
                    const schema = await this.tenantSchema(job.tenantId);
                    await recordCrmNoteReceipt(
                        (sql: string, params?: any[]) => this.prisma.executeInTenantSchema(schema, sql, params ?? []) as any,
                        {
                            connectionId: job.connectionId, provider: job.provider,
                            sourceKind: job.receipt.sourceKind, sourceId: job.receipt.sourceId,
                            externalId: r.externalId, externalUrl: r.externalUrl ?? null,
                            conversationId: job.receipt.conversationId ?? null,
                            contactId: job.receipt.contactId ?? act.contactId ?? null,
                        });
                }
            } else if (job.operation === 'retractActivity') {
                // The real call goes through exactly the gate every other CRM
                // effect goes through: `buildContext` above refuses a connection
                // that is not active and refreshes the token before it is used.
                const receiptId = String(job.payload?.receiptId ?? '');
                externalId = String(job.payload?.externalId ?? '') || null;
                const result = adapter.retractActivity && externalId
                    ? await adapter.retractActivity(ctx, externalId)
                    // A provider that cannot delete a note is an `unknown` with
                    // the reason on it — visible — never a silent success.
                    : { outcome: 'unknown' as CrmRetractionOutcome, detail: 'provider_cannot_retract' };
                const schema = await this.tenantSchema(job.tenantId);
                await settleCrmNoteRetraction(
                    (sql: string, params?: any[]) => this.prisma.executeInTenantSchema(schema, sql, params ?? []) as any,
                    receiptId, result.outcome, result.detail ?? null);
                if (result.outcome !== 'accepted') status = 'skipped';
                operation = `retract_${result.outcome}`;
            }
        } catch (e: any) {
            status = 'failed';
            errorMessage = e.message;
            await this.markConnectionError(job.connectionId, e.message);
            throw e;
        } finally {
            await this.logSync(job.tenantId, {
                provider: job.provider,
                entity: job.entity,
                internalId: job.payload?.id,
                externalId,
                operation,
                status,
                errorMessage,
                durationMs: Date.now() - start,
            });
            if (status === 'success') {
                await this.prisma.crmConnection.update({
                    where: { id: job.connectionId },
                    data: { lastSyncAt: new Date() },
                });
            }
        }
    }

    /**
     * Turns the retractions an erasure asked for into work.
     *
     * The erasure itself only MARKS, inside its own transaction: it must not be
     * held open across a third party's HTTP timeout, and must not be rolled back
     * by one either. This is the other half, and it is deliberately re-runnable —
     * a settled receipt is no longer pending, so a second pass over the same
     * tenant finds nothing and deletes nothing twice.
     *
     * `rejected` and `unknown` are not swept back up. They are answers somebody
     * has to look at, and retrying a refusal forever would be a loop against the
     * tenant's own CRM rather than progress.
     */
    async retractPendingCrmNotes(tenantId: string, limit = 100): Promise<number> {
        const schema = await this.tenantSchema(tenantId);
        const query = (sql: string, params?: any[]) =>
            this.prisma.executeInTenantSchema(schema, sql, params ?? []) as any;
        const pending = await pendingCrmNoteRetractions(query, limit);
        for (const receipt of pending) {
            await this.queue.add(
                `${receipt.provider}:activity:retractActivity`,
                {
                    tenantId, connectionId: receipt.connectionId, provider: receipt.provider,
                    entity: 'activity', operation: 'retractActivity',
                    payload: { receiptId: receipt.id, externalId: receipt.externalId },
                },
                {
                    // One attempt. A retry here would re-ask a question that has
                    // already been answered into a state; the reconcile pass is
                    // what re-asks, and only for the states that deserve it.
                    attempts: 1, removeOnComplete: 100, removeOnFail: 200,
                    jobId: `crm-retract-${receipt.id}`,
                },
            );
        }
        return pending.length;
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    async buildContext(tenantId: string, connectionId: string): Promise<CrmAdapterContext> {
        const conn = await this.prisma.crmConnection.findFirst({ where: { id: connectionId, tenantId } });
        if (!conn) throw new NotFoundException('Connection not found');
        if (conn.status !== 'active') throw new ForbiddenException(`Connection ${conn.status}`);

        let accessToken = this.crypto.decrypt(conn.accessToken);

        // Refresh if expired (or expires in <2 min). Adapter is responsible for
        // the actual token call; we just persist the new tokens.
        const now = Date.now();
        if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - now < 120_000 && conn.refreshToken) {
            try {
                const adapter = this.factory.get(conn.provider);
                const refreshed = await adapter.refreshAccessToken(this.crypto.decrypt(conn.refreshToken));
                accessToken = refreshed.accessToken;
                await this.prisma.crmConnection.update({
                    where: { id: conn.id },
                    data: {
                        accessToken: this.crypto.encrypt(refreshed.accessToken),
                        refreshToken: refreshed.refreshToken ? this.crypto.encrypt(refreshed.refreshToken) : conn.refreshToken,
                        tokenExpiresAt: refreshed.expiresAt ?? null,
                    },
                });
            } catch (e: any) {
                this.logger.error(`Token refresh failed for ${conn.id}: ${e.message}`);
                await this.markConnectionError(conn.id, `Token refresh failed: ${e.message}`);
                throw e;
            }
        }

        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true } });
        return {
            tenantId,
            schemaName: tenant?.schemaName ?? '',
            connectionId: conn.id,
            accessToken,
            refreshToken: conn.refreshToken ? this.crypto.decrypt(conn.refreshToken) : undefined,
            metadata: {
                provider: conn.provider,
                externalAccountId: conn.externalAccountId,
                externalAccountName: conn.externalAccountName,
                ...((conn.metadata as any) ?? {}),
            },
        };
    }

    private async assertCanAddConnection(tenantId: string, provider: string) {
        // Read the plan's externalCrm limit from billing_plans (the seed/matrix
        // single source of truth): emprendedor/starter=0, pro=1, enterprise/custom=-1.
        // getPlanLimit maps -1 to Infinity and a missing key to 0 (fail-closed).
        const limit = await this.throttle.getPlanLimit(tenantId, 'externalCrm');
        if (limit <= 0) {
            const plan = await this.throttle.getTenantPlan(tenantId);
            throw new ForbiddenException(`Plan "${plan}" does not include external CRM integrations`);
        }
        const existing = await this.prisma.crmConnection.findMany({
            where: { tenantId, status: 'active' },
            select: { id: true, provider: true },
        });
        // Reconnecting the same provider is always allowed (replace the row).
        if (existing.some((c: any) => c.provider === provider)) return;
        if (existing.length >= limit) {
            throw new ForbiddenException(`Plan allows at most ${Number.isFinite(limit) ? limit : '∞'} active CRM connection(s)`);
        }
    }

    private async findExternalId(
        tenantId: string,
        provider: string,
        entity: CrmEntity,
        internalId: string,
    ): Promise<string | null> {
        const schema = await this.tenantSchema(tenantId);
        const rows = (await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT external_id FROM crm_external_links
             WHERE provider = $1 AND entity = $2 AND internal_id = $3::uuid LIMIT 1`,
            [provider, entity, internalId],
        )) as any[];
        return rows[0]?.external_id ?? null;
    }

    private async persistLink(
        tenantId: string,
        provider: string,
        entity: CrmEntity,
        internalId: string,
        externalId: string,
        externalUrl?: string,
    ) {
        const schema = await this.tenantSchema(tenantId);
        await this.prisma.executeInTenantSchema(
            schema,
            `INSERT INTO crm_external_links (provider, entity, internal_id, external_id, external_url, last_synced_at)
             VALUES ($1, $2, $3::uuid, $4, $5, NOW())
             ON CONFLICT (provider, entity, internal_id)
             DO UPDATE SET external_id = EXCLUDED.external_id,
                           external_url = COALESCE(EXCLUDED.external_url, crm_external_links.external_url),
                           last_synced_at = NOW(),
                           updated_at = NOW()`,
            [provider, entity, internalId, externalId, externalUrl ?? null],
        );
    }

    private async logSync(
        tenantId: string,
        entry: {
            provider: string;
            entity: CrmEntity;
            internalId?: string;
            externalId: string | null;
            operation: string;
            status: 'success' | 'skipped' | 'failed';
            errorMessage: string | null;
            durationMs: number;
        },
    ) {
        try {
            const schema = await this.tenantSchema(tenantId);
            await this.prisma.executeInTenantSchema(
                schema,
                `INSERT INTO crm_sync_log (provider, entity, internal_id, external_id, operation, status, error_message, duration_ms)
                 VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8)`,
                [
                    entry.provider,
                    entry.entity,
                    entry.internalId ?? null,
                    entry.externalId,
                    entry.operation,
                    entry.status,
                    entry.errorMessage,
                    entry.durationMs,
                ],
            );
        } catch (e: any) {
            this.logger.warn(`logSync failed: ${e.message}`);
        }
    }

    private async markConnectionError(connectionId: string, message: string) {
        await this.prisma.crmConnection.update({
            where: { id: connectionId },
            data: { lastErrorAt: new Date(), lastErrorMessage: message.slice(0, 500) },
        });
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true } });
        if (!t) throw new NotFoundException('Tenant not found');
        return t.schemaName;
    }

    /**
     * Lazily creates the per-tenant CRM tables if they don't exist yet.
     * tenant-schema.sql ships them for new tenants — this covers existing ones.
     */
    private async ensureTenantCrmTables(tenantId: string) {
        const schema = await this.tenantSchema(tenantId);
        const ddls = [
            `CREATE TABLE IF NOT EXISTS "${schema}"."crm_field_mappings" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider VARCHAR(50) NOT NULL,
                entity VARCHAR(20) NOT NULL,
                parallly_field VARCHAR(100) NOT NULL,
                external_field VARCHAR(200) NOT NULL,
                direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
                transform VARCHAR(50),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_field_map_unique_${schema}" ON "${schema}"."crm_field_mappings" (provider, entity, parallly_field)`,
            `CREATE TABLE IF NOT EXISTS "${schema}"."crm_external_links" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider VARCHAR(50) NOT NULL,
                entity VARCHAR(20) NOT NULL,
                internal_id UUID NOT NULL,
                external_id VARCHAR(200) NOT NULL,
                external_url TEXT,
                last_synced_at TIMESTAMP,
                checksum VARCHAR(64),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_links_internal_${schema}" ON "${schema}"."crm_external_links" (provider, entity, internal_id)`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_links_external_${schema}" ON "${schema}"."crm_external_links" (provider, entity, external_id)`,
            `CREATE TABLE IF NOT EXISTS "${schema}"."crm_sync_log" (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider VARCHAR(50) NOT NULL,
                entity VARCHAR(20) NOT NULL,
                internal_id UUID,
                external_id VARCHAR(200),
                operation VARCHAR(20) NOT NULL,
                direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
                status VARCHAR(20) NOT NULL,
                error_message TEXT,
                duration_ms INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )`,
            `CREATE INDEX IF NOT EXISTS "idx_crm_sync_log_recent_${schema}" ON "${schema}"."crm_sync_log" (provider, created_at DESC)`,
        ];
        for (const ddl of ddls) {
            await this.prisma.$executeRawUnsafe(ddl);
        }
        // Where a pushed note went, so an erasure can take it back. Its own DDL
        // constant rather than another literal here, because the erasure path
        // and the parity test read the same one.
        await ensureCrmNoteReceipts((sql: string, params?: any[]) =>
            this.prisma.executeInTenantSchema(schema, sql, params ?? []) as any);
    }

    // ─── Mappers ────────────────────────────────────────────────────────────

    private mapContact(contact: any): CanonicalContact {
        return {
            id: contact.id,
            firstName: contact.first_name ?? contact.firstName,
            lastName: contact.last_name ?? contact.lastName,
            fullName: contact.full_name ?? contact.fullName,
            email: contact.email,
            phoneE164: contact.phone_e164 ?? contact.phone,
            company: contact.company,
            jobTitle: contact.job_title ?? contact.jobTitle,
            source: contact.source ?? 'parallly',
        };
    }

    private mapDeal(lead: any, contact: any): CanonicalDeal {
        return {
            id: lead.id,
            contactId: contact?.id ?? lead.contact_id ?? lead.contactId,
            title: lead.title ?? lead.name ?? `Lead — ${contact?.full_name ?? contact?.firstName ?? 'sin nombre'}`,
            stage: lead.stage,
            valueCents: typeof lead.value_cents === 'number' ? lead.value_cents : undefined,
            currency: lead.currency,
            ownerEmail: lead.owner_email ?? lead.ownerEmail,
        };
    }

    private mapActivity(act: Partial<CanonicalActivity> & { contactId: string }): CanonicalActivity {
        return {
            id: (act as any).id ?? crypto.randomUUID(),
            contactId: act.contactId,
            dealId: act.dealId,
            type: act.type ?? 'note',
            channel: act.channel,
            direction: act.direction,
            body: act.body ?? '',
            occurredAt: act.occurredAt ?? new Date(),
        };
    }

    // ─── Signed state for OAuth ─────────────────────────────────────────────

    private signState(payload: object): string {
        const secret = this.config.get<string>('JWT_SECRET', '');
        const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
        return `${data}.${sig}`;
    }

    private verifyState(state: string): { tenantId: string; provider: string; nonce: string } {
        const [data, sig] = state.split('.');
        if (!data || !sig) throw new BadRequestException('Invalid state');
        const secret = this.config.get<string>('JWT_SECRET', '');
        const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
        if (sig !== expected) throw new BadRequestException('State signature mismatch');
        const decoded = JSON.parse(Buffer.from(data, 'base64url').toString());
        if (!decoded.tenantId || !decoded.provider) throw new BadRequestException('Invalid state payload');
        return decoded;
    }
}
