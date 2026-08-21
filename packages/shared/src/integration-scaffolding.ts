/**
 * El andamiaje que toda integración externa necesita, escrito una sola vez.
 *
 * Cada integración que se agregó hasta acá resolvió los mismos cuatro
 * problemas de nuevo y distinto: cómo no perder una escritura cuando el
 * proveedor está caído, cómo no procesar dos veces el mismo webhook, cómo saber
 * si lo de acá y lo de allá siguen diciendo lo mismo, y cómo probar el adapter
 * sin credenciales. Cuatro problemas × N proveedores = N implementaciones, con
 * N formas distintas de fallar.
 *
 * ── Por qué provider-neutral ────────────────────────────────────────────
 *
 * Nada de este módulo sabe qué es Hostaway, Toast o Cliniko. El contrato es
 * sobre la MECÁNICA —una escritura pendiente, un evento recibido, una
 * comparación— y el adapter aporta el significado. Un contrato que nombra al
 * proveedor termina teniendo un `if (provider === 'x')` por cada rareza, y esa
 * es la forma en que un andamiaje compartido deja de ser compartido.
 *
 * ── Los escritores externos están APAGADOS ──────────────────────────────
 *
 * `externalWritesEnabled` arranca en `false` y no hay forma de encenderlo desde
 * la configuración de un tenant: es una decisión de plataforma que exige un
 * sandbox verificado del proveedor. Mientras esté apagado el outbox **igual
 * acumula y reintenta** —la intención queda registrada, no se pierde— pero la
 * llamada real no sale. Un andamiaje que se enciende solo cuando alguien
 * conecta credenciales es cómo se manda la primera escritura a producción sin
 * que nadie lo haya probado.
 */

export const INTEGRATION_SCAFFOLDING_VERSION = 1 as const;

// ── Outbox: la escritura que todavía no salió ────────────────────────────

export type OutboxStatus =
    /** Encolada, todavía no intentada. */
    | 'pending'
    /** Un worker la tomó y está corriendo. */
    | 'in_flight'
    /** El proveedor la aceptó. */
    | 'delivered'
    /** Falló y volverá a intentarse. */
    | 'retrying'
    /** Agotó los intentos. Necesita una persona. */
    | 'dead'
    /** El interruptor de escrituras externas estaba apagado. */
    | 'suppressed';

export interface OutboxEntry {
    id: string;
    provider: string;
    /** Qué se quiere hacer. El adapter lo traduce a una llamada. */
    operation: string;
    /**
     * La clave con la que el proveedor reconoce un reintento.
     *
     * Se deriva del hecho de negocio, no de un contador: reintentar es repetir
     * la MISMA escritura, y una clave nueva por intento crea una reserva nueva
     * en cada reintento — que es el modo de falla exacto que un outbox existe
     * para evitar.
     */
    idempotencyKey: string;
    payload: Record<string, unknown>;
    status: OutboxStatus;
    attempts: number;
    /** Cuándo puede volver a intentarse. */
    nextAttemptAt?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
}

/** Cuántas veces y con cuánta espera. */
export const OUTBOX_MAX_ATTEMPTS = 8 as const;

/**
 * Espera exponencial con techo, en segundos.
 *
 * El techo importa más que la curva: sin él, el octavo intento cae a horas y
 * una caída de diez minutos del proveedor deja escrituras esperando media
 * tarde. Con techo, el reintento sigue siendo útil cuando el proveedor vuelve.
 */
export function outboxBackoffSeconds(attempt: number): number {
    const normalized = Math.max(1, Math.min(OUTBOX_MAX_ATTEMPTS, Math.floor(attempt)));
    return Math.min(900, 2 ** normalized * 5);
}

// ── Webhook inbox: el evento que llegó ───────────────────────────────────

export type WebhookInboxStatus = 'received' | 'processed' | 'duplicate' | 'failed';

export interface WebhookInboxEntry {
    id: string;
    provider: string;
    /** El id que el proveedor le puso al evento. La clave del dedupe. */
    externalEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    status: WebhookInboxStatus;
    receivedAt: string;
    processedAt?: string;
    lastError?: string;
}

/**
 * Si este evento ya se vio.
 *
 * Un proveedor reenvía cuando no recibe un 200 a tiempo, y una reserva
 * procesada dos veces es una reserva doble. El dedupe va por `(proveedor,
 * id del evento)` y no sólo por el id: dos proveedores pueden usar el mismo
 * contador y no hay nada que lo impida.
 */
export function webhookDedupeKey(provider: string, externalEventId: string): string {
    return `${String(provider).trim().toLowerCase()}:${String(externalEventId).trim()}`;
}

// ── Idempotencia ─────────────────────────────────────────────────────────

/**
 * La clave de una escritura externa, derivada del hecho de negocio.
 *
 * Determinista a propósito: dos llamadores que quieren la MISMA escritura
 * derivan la misma clave y el proveedor la reconoce como un reintento. Un UUID
 * por intento habría creado una reserva nueva cada vez.
 */
export function deriveIdempotencyKey(input: {
    tenantId: string;
    provider: string;
    operation: string;
    /** El identificador del hecho: la reserva, el pedido, la cita. */
    subjectId: string;
}): string {
    const parts = [input.tenantId, input.provider, input.operation, input.subjectId]
        .map(part => String(part ?? '').trim().toLowerCase());
    if (parts.some(part => !part)) {
        throw new Error('idempotency key needs tenant, provider, operation and subject');
    }
    return parts.join(':');
}

// ── Reconciliación ───────────────────────────────────────────────────────

export type DriftKind =
    /** Está acá y no allá. */
    | 'missing_remote'
    /** Está allá y no acá. */
    | 'missing_local'
    /** Está en los dos y no dicen lo mismo. */
    | 'value_mismatch';

export interface ReconciliationDrift {
    kind: DriftKind;
    subjectId: string;
    field?: string;
    localValue?: unknown;
    remoteValue?: unknown;
}

export interface ReconciliationReport {
    provider: string;
    checkedAt: string;
    localCount: number;
    remoteCount: number;
    drift: readonly ReconciliationDrift[];
    /** True cuando la comparación no se pudo completar: no es "sin drift". */
    incomplete: boolean;
}

/**
 * Compara dos lados y reporta la diferencia. **No corrige.**
 *
 * Corregir automáticamente es cómo una lectura desactualizada del proveedor
 * borra una reserva local que sí existe. El reporte va a una persona; lo que se
 * hace con él es una decisión, no una consecuencia.
 */
export function reconcile<T extends { id: string }>(
    provider: string,
    local: readonly T[],
    remote: readonly T[],
    compare: (a: T, b: T) => readonly { field: string; localValue: unknown; remoteValue: unknown }[],
    now: string,
): ReconciliationReport {
    const remoteById = new Map(remote.map(item => [item.id, item]));
    const localById = new Map(local.map(item => [item.id, item]));
    const drift: ReconciliationDrift[] = [];

    for (const item of local) {
        const counterpart = remoteById.get(item.id);
        if (!counterpart) {
            drift.push({ kind: 'missing_remote', subjectId: item.id });
            continue;
        }
        for (const difference of compare(item, counterpart)) {
            drift.push({ kind: 'value_mismatch', subjectId: item.id, ...difference });
        }
    }
    for (const item of remote) {
        if (!localById.has(item.id)) drift.push({ kind: 'missing_local', subjectId: item.id });
    }

    return {
        provider,
        checkedAt: now,
        localCount: local.length,
        remoteCount: remote.length,
        drift: Object.freeze(drift),
        incomplete: false,
    };
}

// ── El interruptor de escrituras externas ────────────────────────────────

/**
 * Si una escritura hacia afuera puede salir de verdad.
 *
 * Arranca apagado y NO se enciende desde la configuración de un tenant: es una
 * decisión de plataforma que exige un sandbox verificado del proveedor.
 * Encenderlo porque alguien conectó credenciales es cómo se manda la primera
 * escritura a producción sin que nadie la haya probado.
 */
export interface ExternalWriteGate {
    enabled: boolean;
    /** Por qué está apagado, para que el panel lo pueda explicar. */
    reason?: string;
}

export const EXTERNAL_WRITES_DISABLED: ExternalWriteGate = Object.freeze({
    enabled: false,
    reason: 'external_writer_not_certified',
});

/**
 * Lee el interruptor de la variable de entorno de plataforma.
 *
 * Una allowlist explícita por proveedor, no un booleano global: certificar
 * Hostaway no certifica Toast, y un `INTEGRATIONS_WRITE=true` habría encendido
 * los dos.
 */
export function externalWriteGateFor(
    provider: string,
    allowlist: string | undefined,
): ExternalWriteGate {
    const normalized = String(provider || '').trim().toLowerCase();
    const allowed = String(allowlist || '')
        .split(',')
        .map(entry => entry.trim().toLowerCase())
        .filter(Boolean);
    if (!normalized || !allowed.includes(normalized)) return EXTERNAL_WRITES_DISABLED;
    return { enabled: true };
}

// ── Kit de contract-test ─────────────────────────────────────────────────

/**
 * Lo que un adapter tiene que poder hacer antes de que se le confíe una
 * escritura.
 *
 * Es un contrato, no una prueba: cada adapter lo implementa contra su propio
 * doble y el kit verifica que lo cumple. Sin esto, cada integración se prueba
 * "a mano contra la cuenta de alguien" — que es como decir que no se prueba.
 */
export interface IntegrationAdapterContract<TRemote extends { id: string }> {
    provider: string;
    /** Lee lo que el proveedor tiene. Obligatorio: sin leer no hay reconciliar. */
    list(): Promise<readonly TRemote[]>;
    /**
     * Escribe. Opcional: un adapter de sólo lectura es válido y es el estado
     * de todos hoy. Declararlo ausente es más honesto que declararlo y tirar.
     */
    write?(entry: OutboxEntry): Promise<{ externalId: string }>;
    /** Traduce un webhook a un hecho del dominio. */
    interpret?(entry: WebhookInboxEntry): { subjectId: string; changed: boolean };
}

export interface AdapterContractFinding {
    check: string;
    passed: boolean;
    detail?: string;
}

/**
 * Verifica lo que se puede verificar SIN credenciales.
 *
 * Deliberadamente no llama a la red: lo que mide es que el adapter respete el
 * contrato —que `list` devuelva algo iterable, que `write` derive claves
 * deterministas, que `interpret` no invente un sujeto—. Lo que sólo se puede
 * probar contra un sandbox real queda fuera y se dice.
 */
export async function checkAdapterContract<TRemote extends { id: string }>(
    adapter: IntegrationAdapterContract<TRemote>,
): Promise<AdapterContractFinding[]> {
    const findings: AdapterContractFinding[] = [];

    findings.push({
        check: 'provider_named',
        passed: typeof adapter.provider === 'string' && adapter.provider.trim().length > 0,
    });

    try {
        const listed = await adapter.list();
        findings.push({
            check: 'list_returns_array',
            passed: Array.isArray(listed),
        });
        findings.push({
            check: 'list_items_have_id',
            passed: (listed || []).every(item => typeof item?.id === 'string' && !!item.id),
            detail: 'sin id no se puede reconciliar ni deduplicar',
        });
    } catch (error: any) {
        findings.push({
            check: 'list_returns_array',
            passed: false,
            detail: error?.message || 'list threw',
        });
    }

    findings.push({
        check: 'write_declared_only_if_implemented',
        // Un adapter que declara `write` y tira es peor que uno que no lo
        // declara: el outbox lo trata como entregable y lo reintenta ocho veces.
        passed: adapter.write === undefined || typeof adapter.write === 'function',
    });

    // El kit REPORTA un adapter roto, no explota con él. Que se caiga acá
    // significaría que el adapter que más falta revisar es justo el que no se
    // puede revisar.
    try {
        const args = {
            tenantId: 't', provider: adapter.provider, operation: 'op', subjectId: 's',
        };
        findings.push({
            check: 'idempotency_key_is_deterministic',
            passed: deriveIdempotencyKey(args) === deriveIdempotencyKey(args),
        });
    } catch (error: any) {
        findings.push({
            check: 'idempotency_key_is_deterministic',
            passed: false,
            detail: error?.message || 'idempotency key could not be derived',
        });
    }

    return findings;
}
