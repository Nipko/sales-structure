import { Injectable, Logger } from '@nestjs/common';
import {
    EXTERNAL_WRITES_DISABLED,
    OUTBOX_ENTRY_TTL_SECONDS,
    OUTBOX_EXPIRABLE_STATUSES,
    OUTBOX_MAX_ATTEMPTS,
    deriveIdempotencyKey,
    externalWriteGateFor,
    outboxBackoffSeconds,
    reconcile,
    webhookDedupeKey,
    type ExternalWriteGate,
    type ClaimedOutboxEntry,
    type ClaimedWebhookInboxEntry,
    type OutboxEntry,
    type ReconciliationReport,
    type WebhookInboxEntry,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Las tablas del andamiaje, para repararlas en un schema viejo.
 *
 * Se agregaron a `tenant-schema.sql` después de que existieran tenants, así que
 * los schemas creados antes no las tienen. Encolar contra una tabla ausente
 * tiraba `42P01` y el llamador perdía la intención en silencio.
 */
const OUTBOX_TABLES = Object.freeze([
    'integration_outbox',
    'integration_webhook_inbox',
]);

export type IntegrationWorkKind = 'outbox' | 'webhook';

export interface TrackedIntegrationTenant {
    id: string;
    schemaName: string;
    name: string;
}

/**
 * La escritura que todavía no salió, el evento que ya llegó, y la diferencia
 * entre los dos lados.
 *
 * Cada integración resolvía estos problemas de nuevo y distinto. Este servicio
 * no sabe qué es Hostaway ni Toast: recibe una operación con nombre y un
 * payload, y el adapter aporta el significado. Un andamiaje que nombra al
 * proveedor termina con un `if` por cada rareza y deja de ser compartido.
 *
 * **Los escritores externos están apagados.** El outbox igual acumula y
 * reintenta —la intención queda registrada, no se pierde— pero la llamada real
 * no sale hasta que la plataforma certifique ese proveedor contra un sandbox.
 */
@Injectable()
export class IntegrationOutboxService {
    private readonly logger = new Logger(IntegrationOutboxService.name);

    constructor(private readonly prisma: PrismaService) {}

    /** El interruptor, leído de la allowlist de plataforma. */
    gateFor(provider: string): ExternalWriteGate {
        return externalWriteGateFor(provider, process.env.INTEGRATION_WRITE_PROVIDERS);
    }

    /**
     * Encola una escritura hacia afuera.
     *
     * Idempotente por `(proveedor, clave)`: llamar dos veces con el mismo hecho
     * de negocio deja UNA fila. Sin eso, un reintento del llamador crearía una
     * segunda escritura pendiente y el proveedor recibiría la operación dos
     * veces — que es exactamente lo que el outbox existe para evitar.
     */
    async enqueue(
        schemaName: string,
        input: {
            tenantId: string;
            provider: string;
            operation: string;
            subjectId: string;
            payload?: Record<string, unknown>;
            /** La conexión concreta del proveedor. Ausente = la única. */
            connectionId?: string;
        },
    ): Promise<{ id: string; idempotencyKey: string; suppressed: boolean }> {
        // Las tablas del andamiaje no existen en los schemas creados antes de
        // que se agregaran. Encolar contra una tabla ausente tiraba `42P01`, y
        // el llamador —que suele estar en un `.catch()`— perdía la intención en
        // silencio: exactamente lo que un outbox existe para impedir.
        await this.prisma.ensureCanonicalTables(schemaName, OUTBOX_TABLES).catch(() => undefined);

        const idempotencyKey = deriveIdempotencyKey(input);
        const gate = this.gateFor(input.provider);
        // Se encola igual con el interruptor apagado: la intención queda
        // registrada y el día que el proveedor se certifique, sale. Descartarla
        // sería perder la operación silenciosamente.
        const status = gate.enabled ? 'pending' : 'suppressed';

        const rows = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const inserted = await query<any[]>(
                `INSERT INTO integration_outbox
                     (provider, connection_id, operation, idempotency_key, payload, status, next_attempt_at)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
                 ON CONFLICT (provider, idempotency_key) DO UPDATE
                     SET updated_at = NOW()
                 RETURNING id, status`,
                [
                    input.provider,
                    input.connectionId ?? null,
                    input.operation,
                    idempotencyKey,
                    JSON.stringify(input.payload ?? {}),
                    status,
                ],
            );
            await this.trackTenant(query, input.tenantId, schemaName, 'outbox');
            return inserted;
        });
        return {
            id: String(rows[0]?.id),
            idempotencyKey,
            suppressed: !gate.enabled,
        };
    }

    /**
     * Lo que estaba esperando a que se certificara el proveedor, ahora puede.
     *
     * Sin esto, la promesa del comentario de `enqueue` —"el día que el proveedor
     * se certifique, sale"— era **falsa**: `claim` sólo mira `pending` y
     * `retrying`, así que una entrada `suppressed` se quedaba ahí para siempre
     * aunque el interruptor se encendiera. Intención registrada y nunca
     * ejecutada es peor que perderla: parece que va a salir.
     *
     * Vence primero y libera después, en ese orden: liberar una entrada de hace
     * tres meses la mandaría al proveedor como si fuera de hoy.
     */
    async releaseSuppressed(
        schemaName: string,
        provider: string,
        adapterReady: boolean,
    ): Promise<number> {
        // Certification and an executable adapter are both required. Merely
        // putting a provider in the environment cannot turn durable intent
        // into `pending` work that will immediately die as no_adapter.
        if (!this.gateFor(provider).enabled || !adapterReady) return 0;
        await this.expireStale(schemaName, provider);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_outbox
                SET status = 'pending', next_attempt_at = NOW(), updated_at = NOW()
              WHERE provider = $1 AND status = 'suppressed'
              RETURNING id`,
            [provider],
        );
        const count = rows?.length ?? 0;
        if (count) {
            this.logger.log(`[Outbox] ${count} escritura(s) de ${provider} liberadas al certificarse`);
        }
        return count;
    }

    /**
     * Las que ya no tiene sentido entregar.
     *
     * Una reserva encolada hace tres meses entregada hoy no repara nada: crea
     * una reserva que nadie pidió, para una fecha que pasó, en el calendario de
     * alguien que no la espera. Y una cola sin vencimiento tampoco se puede
     * revisar — crece con intención que nadie va a ejecutar y esconde lo que sí
     * importa.
     */
    async expireStale(schemaName: string, provider?: string): Promise<number> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_outbox
                SET status = 'expired',
                    last_error = 'outbox_entry_ttl_exceeded',
                    next_attempt_at = NULL,
                    lease_expires_at = NULL,
                    updated_at = NOW()
              WHERE status = ANY($1::text[])
                AND created_at < NOW() - ($2 || ' seconds')::interval
                AND ($3::text IS NULL OR provider = $3)
              RETURNING id`,
            [
                [...OUTBOX_EXPIRABLE_STATUSES],
                String(OUTBOX_ENTRY_TTL_SECONDS),
                provider ?? null,
            ],
        );
        const count = rows?.length ?? 0;
        if (count) this.logger.warn(`[Outbox] ${count} escritura(s) vencidas sin entregar`);
        return count;
    }

    /**
     * Lo que hay que mirar, sin devolver ni un payload.
     *
     * El andamiaje registraba todo y no había forma de verlo: una escritura
     * muerta o suprimida es justamente lo que necesita ojos humanos, y vivía en
     * una tabla por tenant que nadie consultaba. El payload no viaja: puede
     * traer datos del cliente final y esto lo mira un super_admin.
     */
    async review(schemaName: string): Promise<{
        byStatus: Record<string, number>;
        attention: Array<{
            id: string; provider: string; operation: string;
            status: string; attempts: number; lastError?: string; createdAt: string;
        }>;
    }> {
        const counts = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT status, COUNT(*)::int AS total FROM integration_outbox GROUP BY status`,
            [],
        ).catch(() => [] as any[]);
        const attention = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, provider, operation, status, attempts, last_error, created_at
               FROM integration_outbox
              WHERE status IN ('dead', 'suppressed', 'expired')
              ORDER BY updated_at DESC
              LIMIT 50`,
            [],
        ).catch(() => [] as any[]);
        return {
            byStatus: Object.fromEntries((counts || []).map(r => [r.status, Number(r.total)])),
            attention: (attention || []).map(r => ({
                id: String(r.id),
                provider: r.provider,
                operation: r.operation,
                status: r.status,
                attempts: Number(r.attempts ?? 0),
                lastError: r.last_error || undefined,
                createdAt: new Date(r.created_at).toISOString(),
            })),
        };
    }

    /**
     * Toma las que puede correr, con arrendamiento.
     *
     * El `lease_expires_at` es lo que hace que un worker muerto no deje una
     * escritura en `in_flight` para siempre: otro la vuelve a tomar cuando el
     * arrendamiento vence. Sin eso, un reinicio en el momento equivocado
     * congela una reserva pendiente hasta que alguien la mira a mano.
     */
    async claim(schemaName: string, provider: string, limit = 20): Promise<ClaimedOutboxEntry[]> {
        if (!this.gateFor(provider).enabled) return [];
        await this.prisma.ensureCanonicalTables(schemaName, OUTBOX_TABLES).catch(() => undefined);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_outbox
                SET status = 'in_flight',
                    lease_expires_at = NOW() + INTERVAL '5 minutes',
                    claim_token = gen_random_uuid(),
                    claim_generation = claim_generation + 1,
                    updated_at = NOW()
              WHERE id IN (
                  SELECT id FROM integration_outbox
                   WHERE provider = $1
                     AND (
                         (status IN ('pending', 'retrying') AND COALESCE(next_attempt_at, NOW()) <= NOW())
                         OR (status = 'in_flight' AND lease_expires_at < NOW())
                     )
                   ORDER BY created_at
                   FOR UPDATE SKIP LOCKED
                   LIMIT ${Math.max(1, Math.min(100, limit))}
              )
              RETURNING *`,
            [provider],
        );
        return (rows || []).map(row => this.mapClaimedOutbox(row));
    }

    /**
     * Tenant schemas that can contain integration work.
     *
     * This public registry is written atomically with the tenant-schema row.
     * Workers therefore do one indexed global read and never probe every
     * active tenant each minute. The payload remains exclusively in its tenant
     * schema; the registry contains only routing metadata.
     */
    async trackedTenants(kind: IntegrationWorkKind): Promise<TrackedIntegrationTenant[]> {
        const seenColumn = kind === 'outbox' ? 'outbox_seen_at' : 'webhook_seen_at';
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT t.id, t.schema_name AS "schemaName", t.name
               FROM public.integration_work_tenants work
               JOIN public.tenants t ON t.id = work.tenant_id
              WHERE t.is_active = true
                AND work.${seenColumn} IS NOT NULL
              ORDER BY work.${seenColumn} ASC`,
        ) as any[];
        return (rows || []).map(row => ({
            id: String(row.id),
            schemaName: String(row.schemaName),
            name: String(row.name),
        }));
    }

    /** El proveedor la aceptó. */
    async markDelivered(
        schemaName: string,
        entry: ClaimedOutboxEntry,
        externalId?: string,
    ): Promise<boolean> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_outbox
                SET status = 'delivered', external_id = $2, lease_expires_at = NULL,
                    claim_token = NULL, last_error = NULL, updated_at = NOW()
              WHERE id = $1::uuid
                AND status = 'in_flight'
                AND claim_token = $3::uuid
                AND claim_generation = $4
                AND lease_expires_at > NOW()
              RETURNING id`,
            [entry.id, externalId || null, entry.claim.token, entry.claim.generation],
        );
        return (rows?.length ?? 0) === 1;
    }

    /**
     * Falló. Reintenta con espera, o muere y espera a una persona.
     *
     * Morir es una decisión, no un accidente: una escritura que reintenta para
     * siempre es una que nadie mira nunca.
     */
    async markFailed(
        schemaName: string,
        entry: ClaimedOutboxEntry,
        error: string,
    ): Promise<'retrying' | 'dead' | 'stale_claim'> {
        const attempts = Number(entry.attempts ?? 0) + 1;
        const dead = attempts >= OUTBOX_MAX_ATTEMPTS;
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_outbox
                SET status = $2, attempts = $3, last_error = $4,
                    lease_expires_at = NULL,
                    claim_token = NULL,
                    next_attempt_at = CASE WHEN $2 = 'retrying'
                        THEN NOW() + ($5 || ' seconds')::interval ELSE NULL END,
                    updated_at = NOW()
              WHERE id = $1::uuid
                AND status = 'in_flight'
                AND claim_token = $6::uuid
                AND claim_generation = $7
                AND lease_expires_at > NOW()
              RETURNING status`,
            [
                entry.id,
                dead ? 'dead' : 'retrying',
                attempts,
                String(error).slice(0, 1000),
                String(outboxBackoffSeconds(attempts)),
                entry.claim.token,
                entry.claim.generation,
            ],
        );
        if (!rows?.length) return 'stale_claim';
        if (dead) this.logger.warn(`[Outbox] ${entry.id} agotó ${attempts} intentos: ${error}`);
        return dead ? 'dead' : 'retrying';
    }

    /** Terminal failure, fenced by the exact lease that made the decision. */
    async markDead(
        schemaName: string,
        entry: ClaimedOutboxEntry,
        reason: string,
    ): Promise<boolean> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_outbox
                SET status = 'dead', attempts = GREATEST(attempts, $2),
                    last_error = $3, lease_expires_at = NULL,
                    claim_token = NULL, next_attempt_at = NULL, updated_at = NOW()
              WHERE id = $1::uuid
                AND status = 'in_flight'
                AND claim_token = $4::uuid
                AND claim_generation = $5
                AND lease_expires_at > NOW()
              RETURNING id`,
            [
                entry.id,
                OUTBOX_MAX_ATTEMPTS,
                String(reason).slice(0, 1000),
                entry.claim.token,
                entry.claim.generation,
            ],
        );
        return (rows?.length ?? 0) === 1;
    }

    // ── Webhook inbox ────────────────────────────────────────────────────

    /**
     * Registra un evento recibido. Devuelve `duplicate` si ya se había visto.
     *
     * El llamador contesta 200 en los dos casos: un proveedor que no recibe 200
     * reenvía, y reenviar sobre un duplicado no procesado es peor que el
     * duplicado.
     */
    async receiveWebhook(
        schemaName: string,
        input: {
            tenantId: string;
            provider: string;
            externalEventId: string;
            eventType: string;
            payload?: Record<string, unknown>;
        },
    ): Promise<{ id: string; duplicate: boolean }> {
        await this.prisma.ensureCanonicalTables(schemaName, OUTBOX_TABLES).catch(() => undefined);
        const outcome = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `INSERT INTO integration_webhook_inbox
                     (provider, external_event_id, event_type, payload)
                 VALUES ($1, $2, $3, $4::jsonb)
                 ON CONFLICT (provider, external_event_id) DO NOTHING
                 RETURNING id`,
                [
                    input.provider,
                    input.externalEventId,
                    input.eventType,
                    JSON.stringify(input.payload ?? {}),
                ],
            );
            await this.trackTenant(query, input.tenantId, schemaName, 'webhook');
            if (rows?.length) {
                return { id: String(rows[0].id), duplicate: false };
            }
            const existing = await query<any[]>(
                `SELECT id FROM integration_webhook_inbox
                  WHERE provider = $1 AND external_event_id = $2`,
                [input.provider, input.externalEventId],
            );
            return { id: String(existing?.[0]?.id || ''), duplicate: true };
        });
        if (!outcome.duplicate) return outcome;
        this.logger.debug(
            `[WebhookInbox] duplicado ${webhookDedupeKey(input.provider, input.externalEventId)}`,
        );
        return outcome;
    }

    /** Los eventos que todavía nadie procesó. */
    async pendingWebhooks(
        schemaName: string,
        provider: string,
        limit = 50,
    ): Promise<WebhookInboxEntry[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM integration_webhook_inbox
              WHERE provider = $1 AND status = 'received'
              ORDER BY received_at
              LIMIT ${Math.max(1, Math.min(200, limit))}`,
            [provider],
        );
        return (rows || []).map(row => ({
            id: String(row.id),
            provider: String(row.provider),
            externalEventId: String(row.external_event_id),
            eventType: String(row.event_type),
            payload: row.payload || {},
            status: row.status,
            receivedAt: new Date(row.received_at).toISOString(),
            processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : undefined,
            lastError: row.last_error || undefined,
            attempts: Number(row.attempts || 0),
        }));
    }

    /** Lease webhook events so two API/worker processes never apply one twice. */
    async claimWebhooks(
        schemaName: string,
        provider: string,
        limit = 50,
    ): Promise<ClaimedWebhookInboxEntry[]> {
        await this.prisma.ensureCanonicalTables(schemaName, OUTBOX_TABLES).catch(() => undefined);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_webhook_inbox
                SET status = 'processing',
                    lease_expires_at = NOW() + INTERVAL '5 minutes',
                    claim_token = gen_random_uuid(),
                    claim_generation = claim_generation + 1
              WHERE id IN (
                  SELECT id FROM integration_webhook_inbox
                   WHERE provider = $1
                     AND (
                         (status = 'received' AND COALESCE(next_attempt_at, NOW()) <= NOW())
                         OR (status = 'processing' AND lease_expires_at < NOW())
                     )
                   ORDER BY received_at
                   FOR UPDATE SKIP LOCKED
                   LIMIT ${Math.max(1, Math.min(200, limit))}
              )
              RETURNING *`,
            [provider],
        );
        return (rows || []).map(row => this.mapClaimedWebhook(row));
    }

    async markWebhookProcessed(
        schemaName: string,
        entry: ClaimedWebhookInboxEntry,
        error?: string,
    ): Promise<boolean> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_webhook_inbox
                SET status = $2, processed_at = NOW(), last_error = $3,
                    lease_expires_at = NULL, claim_token = NULL
              WHERE id = $1::uuid
                AND status = 'processing'
                AND claim_token = $4::uuid
                AND claim_generation = $5
                AND lease_expires_at > NOW()
              RETURNING id`,
            [
                entry.id,
                error ? 'failed' : 'processed',
                error ? String(error).slice(0, 1000) : null,
                entry.claim.token,
                entry.claim.generation,
            ],
        );
        return (rows?.length ?? 0) === 1;
    }

    async markWebhookFailed(
        schemaName: string,
        entry: ClaimedWebhookInboxEntry,
        error: string,
        retryable = true,
    ): Promise<'received' | 'failed' | 'stale_claim'> {
        const attempts = Number(entry.attempts || 0) + 1;
        const terminal = !retryable || attempts >= OUTBOX_MAX_ATTEMPTS;
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_webhook_inbox
                SET status = $2, attempts = $3, last_error = $4,
                    lease_expires_at = NULL, claim_token = NULL,
                    processed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END,
                    next_attempt_at = CASE WHEN $2 = 'received'
                        THEN NOW() + ($5 || ' seconds')::interval ELSE NULL END
              WHERE id = $1::uuid
                AND status = 'processing'
                AND claim_token = $6::uuid
                AND claim_generation = $7
                AND lease_expires_at > NOW()
              RETURNING status`,
            [
                entry.id,
                terminal ? 'failed' : 'received',
                attempts,
                String(error).slice(0, 1000),
                String(outboxBackoffSeconds(attempts)),
                entry.claim.token,
                entry.claim.generation,
            ],
        );
        if (!rows?.length) return 'stale_claim';
        return terminal ? 'failed' : 'received';
    }

    // ── Reconciliación ───────────────────────────────────────────────────

    /**
     * Guarda un reporte de diferencias. **No corrige.**
     *
     * Corregir automáticamente es cómo una lectura desactualizada del proveedor
     * borra una reserva local que sí existe. Lo que se hace con el reporte es
     * una decisión de una persona, no una consecuencia.
     */
    async recordReconciliation(
        schemaName: string,
        report: ReconciliationReport,
    ): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO integration_reconciliations
                 (provider, checked_at, local_count, remote_count, drift, incomplete)
             VALUES ($1, $2::timestamptz, $3, $4, $5::jsonb, $6)`,
            [
                report.provider,
                report.checkedAt,
                report.localCount,
                report.remoteCount,
                JSON.stringify(report.drift),
                report.incomplete,
            ],
        );
        if (report.drift.length) {
            this.logger.warn(
                `[Reconcile] ${report.provider}: ${report.drift.length} diferencia(s)`,
            );
        }
    }

    /** Compara y guarda, en un paso. La comparación vive en shared. */
    async reconcileAndRecord<T extends { id: string }>(
        schemaName: string,
        provider: string,
        local: readonly T[],
        remote: readonly T[],
        compare: (a: T, b: T) => readonly { field: string; localValue: unknown; remoteValue: unknown }[],
    ): Promise<ReconciliationReport> {
        const report = reconcile(provider, local, remote, compare, new Date().toISOString());
        await this.recordReconciliation(schemaName, report);
        return report;
    }

    /** Por qué las escrituras de este proveedor no salen. */
    disabledReason(provider: string): string | undefined {
        const gate = this.gateFor(provider);
        return gate.enabled ? undefined : (gate.reason || EXTERNAL_WRITES_DISABLED.reason);
    }

    private mapOutbox(row: any): OutboxEntry {
        return {
            id: String(row.id),
            provider: String(row.provider),
            connectionId: row.connection_id || undefined,
            operation: String(row.operation),
            idempotencyKey: String(row.idempotency_key),
            payload: row.payload || {},
            status: row.status,
            attempts: Number(row.attempts || 0),
            nextAttemptAt: row.next_attempt_at
                ? new Date(row.next_attempt_at).toISOString() : undefined,
            lastError: row.last_error || undefined,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
        };
    }

    private mapClaimedOutbox(row: any): ClaimedOutboxEntry {
        const token = row.claim_token ? String(row.claim_token) : '';
        const generation = Number(row.claim_generation);
        const expiresAt = row.lease_expires_at
            ? new Date(row.lease_expires_at).toISOString()
            : '';
        if (!token || !Number.isSafeInteger(generation) || generation < 1 || !expiresAt) {
            throw new Error('integration_outbox claim missing fencing token');
        }
        return {
            ...this.mapOutbox(row),
            claim: { token, generation, expiresAt },
        };
    }

    private mapWebhook(row: any): WebhookInboxEntry {
        return {
            id: String(row.id),
            provider: String(row.provider),
            externalEventId: String(row.external_event_id),
            eventType: String(row.event_type),
            payload: row.payload || {},
            status: row.status,
            attempts: Number(row.attempts || 0),
            receivedAt: new Date(row.received_at).toISOString(),
            processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : undefined,
            lastError: row.last_error || undefined,
        };
    }

    private mapClaimedWebhook(row: any): ClaimedWebhookInboxEntry {
        const token = row.claim_token ? String(row.claim_token) : '';
        const generation = Number(row.claim_generation);
        const expiresAt = row.lease_expires_at
            ? new Date(row.lease_expires_at).toISOString()
            : '';
        if (!token || !Number.isSafeInteger(generation) || generation < 1 || !expiresAt) {
            throw new Error('integration webhook claim missing fencing token');
        }
        return {
            ...this.mapWebhook(row),
            claim: { token, generation, expiresAt },
        };
    }

    private async trackTenant(
        query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
        tenantId: string,
        schemaName: string,
        kind: IntegrationWorkKind,
    ): Promise<void> {
        const seenColumn = kind === 'outbox' ? 'outbox_seen_at' : 'webhook_seen_at';
        const rows = await query<any[]>(
            `INSERT INTO public.integration_work_tenants
                 (tenant_id, schema_name, ${seenColumn}, created_at, updated_at)
             SELECT id, schema_name, NOW(), NOW(), NOW()
               FROM public.tenants
              WHERE id = $1::uuid
                AND schema_name = $2
             ON CONFLICT (tenant_id) DO UPDATE SET
                 schema_name = EXCLUDED.schema_name,
                 ${seenColumn} = NOW(),
                 updated_at = NOW()
             RETURNING tenant_id`,
            [tenantId, schemaName],
        );
        // Never let a mismatched (tenantId, schemaName) pair poison the public
        // routing registry. Throwing here rolls back the tenant-schema insert
        // because both statements share one database transaction.
        if (!rows?.length) {
            throw new Error('integration work tenant/schema mismatch');
        }
    }
}
