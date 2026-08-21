import { Injectable, Logger } from '@nestjs/common';
import {
    EXTERNAL_WRITES_DISABLED,
    OUTBOX_MAX_ATTEMPTS,
    deriveIdempotencyKey,
    externalWriteGateFor,
    outboxBackoffSeconds,
    reconcile,
    webhookDedupeKey,
    type ExternalWriteGate,
    type OutboxEntry,
    type ReconciliationReport,
    type WebhookInboxEntry,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';

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
        },
    ): Promise<{ id: string; idempotencyKey: string; suppressed: boolean }> {
        const idempotencyKey = deriveIdempotencyKey(input);
        const gate = this.gateFor(input.provider);
        // Se encola igual con el interruptor apagado: la intención queda
        // registrada y el día que el proveedor se certifique, sale. Descartarla
        // sería perder la operación silenciosamente.
        const status = gate.enabled ? 'pending' : 'suppressed';

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO integration_outbox
                 (provider, operation, idempotency_key, payload, status, next_attempt_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
             ON CONFLICT (provider, idempotency_key) DO UPDATE
                 SET updated_at = NOW()
             RETURNING id, status`,
            [
                input.provider,
                input.operation,
                idempotencyKey,
                JSON.stringify(input.payload ?? {}),
                status,
            ],
        );
        return {
            id: String(rows[0]?.id),
            idempotencyKey,
            suppressed: !gate.enabled,
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
    async claim(schemaName: string, provider: string, limit = 20): Promise<OutboxEntry[]> {
        if (!this.gateFor(provider).enabled) return [];
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE integration_outbox
                SET status = 'in_flight',
                    lease_expires_at = NOW() + INTERVAL '5 minutes',
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
        return (rows || []).map(row => this.mapOutbox(row));
    }

    /** El proveedor la aceptó. */
    async markDelivered(schemaName: string, id: string, externalId?: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE integration_outbox
                SET status = 'delivered', external_id = $2, lease_expires_at = NULL,
                    last_error = NULL, updated_at = NOW()
              WHERE id = $1::uuid`,
            [id, externalId || null],
        );
    }

    /**
     * Falló. Reintenta con espera, o muere y espera a una persona.
     *
     * Morir es una decisión, no un accidente: una escritura que reintenta para
     * siempre es una que nadie mira nunca.
     */
    async markFailed(schemaName: string, id: string, error: string): Promise<'retrying' | 'dead'> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT attempts FROM integration_outbox WHERE id = $1::uuid`,
            [id],
        );
        const attempts = Number(rows?.[0]?.attempts ?? 0) + 1;
        const dead = attempts >= OUTBOX_MAX_ATTEMPTS;
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE integration_outbox
                SET status = $2, attempts = $3, last_error = $4,
                    lease_expires_at = NULL,
                    next_attempt_at = CASE WHEN $2 = 'retrying'
                        THEN NOW() + ($5 || ' seconds')::interval ELSE NULL END,
                    updated_at = NOW()
              WHERE id = $1::uuid`,
            [
                id,
                dead ? 'dead' : 'retrying',
                attempts,
                String(error).slice(0, 1000),
                String(outboxBackoffSeconds(attempts)),
            ],
        );
        if (dead) this.logger.warn(`[Outbox] ${id} agotó ${attempts} intentos: ${error}`);
        return dead ? 'dead' : 'retrying';
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
            provider: string;
            externalEventId: string;
            eventType: string;
            payload?: Record<string, unknown>;
        },
    ): Promise<{ id: string; duplicate: boolean }> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
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
        if (rows?.length) return { id: String(rows[0].id), duplicate: false };

        const existing = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id FROM integration_webhook_inbox
              WHERE provider = $1 AND external_event_id = $2`,
            [input.provider, input.externalEventId],
        );
        this.logger.debug(
            `[WebhookInbox] duplicado ${webhookDedupeKey(input.provider, input.externalEventId)}`,
        );
        return { id: String(existing?.[0]?.id || ''), duplicate: true };
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
        }));
    }

    async markWebhookProcessed(schemaName: string, id: string, error?: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE integration_webhook_inbox
                SET status = $2, processed_at = NOW(), last_error = $3
              WHERE id = $1::uuid`,
            [id, error ? 'failed' : 'processed', error ? String(error).slice(0, 1000) : null],
        );
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
}
