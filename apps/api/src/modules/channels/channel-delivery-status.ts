import {
    applyDispatchProviderStatus,
    DISPATCH_PROVIDER_STATUSES,
    type DispatchProviderStatus,
} from './agent-dispatch-outbox';

/**
 * What a provider says happened to an outbound message, applied once.
 *
 * Two ingresses receive these events: the API's own WhatsApp webhook and the
 * deployed `whatsapp` service, which used to decide them with its own SQL. That
 * copy looked the receipt up in `messages.external_id` — which holds OUR
 * deduplication identity, never the wamid — and it ranked `failed` above
 * `delivered`, so a late rejection could tell a customer's record the message
 * never arrived after the provider had already said it did. Two implementations
 * of the same rule is one too many; both ingresses now share this one, and the
 * ranking lives with the outbox that owns the receipt.
 */
export interface ChannelDeliveryStatusEvent {
    readonly providerMessageId: string;
    readonly status: DispatchProviderStatus;
    /** For the rejection log only. Never stored: an event is not a directory. */
    readonly recipient?: string | null;
    /** Already namespaced by provider, e.g. `wa_131047`. */
    readonly errorCode?: string | null;
    readonly errorDetail?: string | null;
}

/** Which connection the provider is talking about — the key, with the receipt. */
export interface ChannelDeliveryStatusContext {
    readonly channelType: string;
    readonly channelAccountId: string;
}

export type ChannelDeliveryStatusReason =
    | 'applied'
    | 'unknown_receipt'
    | 'not_newer'
    | 'already_delivered'
    | 'redacted'
    | 'unknown_tenant'
    | 'unavailable';

export interface ChannelDeliveryStatusResult {
    readonly providerMessageId: string;
    readonly status: DispatchProviderStatus;
    readonly reason: ChannelDeliveryStatusReason;
    readonly applied: boolean;
}

export interface ChannelDeliveryStatusReport {
    readonly results: readonly ChannelDeliveryStatusResult[];
    /**
     * A write raised instead of deciding. Meta's webhook must still answer 200,
     * but a caller that owns a retryable job needs to know the difference
     * between "the record refused this event" and "nobody read the event".
     */
    readonly unavailable: boolean;
}

/** The slice of PrismaService this needs, so callers pass their own instance. */
export interface ChannelDeliveryStatusStore {
    executeInTenantSchema<T>(
        schemaName: string, query: string, params?: any[], options?: { timeout?: number },
    ): Promise<T>;
    transactionInTenantSchema<T>(
        schemaName: string,
        callback: (query: <R = any[]>(sql: string, params?: any[]) => Promise<R>) => Promise<T>,
        options?: { timeout?: number },
    ): Promise<T>;
}

export interface ChannelDeliveryStatusLogger {
    error(message: string): void;
    warn(message: string): void;
    debug(message: string): void;
}

/**
 * Which provider's code table a number belongs to.
 *
 * The bare number is useless in a log: 131047 means one thing to Meta and
 * nothing to Telegram. The prefix is what lets an operator look it up.
 */
const PROVIDER_ERROR_NAMESPACE: Readonly<Record<string, string>> = Object.freeze({
    whatsapp: 'wa',
    instagram: 'ig',
    messenger: 'fb',
    telegram: 'tg',
});

export function namespaceProviderErrorCode(channelType: string, code: unknown): string | null {
    if (code === null || code === undefined || code === '') return null;
    const namespace = PROVIDER_ERROR_NAMESPACE[channelType] || channelType;
    return `${namespace}_${String(code)}`.slice(0, 120);
}

export function isDeliveryStatus(value: unknown): value is DispatchProviderStatus {
    return typeof value === 'string'
        && DISPATCH_PROVIDER_STATUSES.includes(value as DispatchProviderStatus);
}

/**
 * Meta's `statuses[]` array, reduced to the events that can change a record.
 *
 * Anything without a provider id, or carrying a status this does not model
 * (`deleted`, a warning), is dropped here rather than handed to the writer.
 */
export function parseMetaDeliveryStatuses(
    statuses: unknown, channelType = 'whatsapp',
): ChannelDeliveryStatusEvent[] {
    if (!Array.isArray(statuses)) return [];
    const events: ChannelDeliveryStatusEvent[] = [];
    for (const entry of statuses as any[]) {
        const providerMessageId = String(entry?.id || '');
        const status = String(entry?.status || '').toLowerCase();
        if (!providerMessageId || !isDeliveryStatus(status)) continue;
        const error = entry?.errors?.[0] || null;
        events.push({
            providerMessageId,
            status,
            recipient: entry?.recipient_id ? String(entry.recipient_id) : null,
            errorCode: namespaceProviderErrorCode(channelType, error?.code),
            errorDetail: error
                ? `title="${error.title ?? ''}" details="${error.error_data?.details ?? error.message ?? ''}"`
                : null,
        });
    }
    return events;
}

/**
 * Say out loud that the provider refused a message, before touching the database.
 *
 * This is the half of the feature that actually caught the WebP incident: months
 * of images were rejected one by one while our side kept saying "Sent". The log
 * has to come out even when the tenant cannot be resolved or the schema is
 * unreachable, so diagnosis never depends on the write succeeding.
 */
function reportRejections(
    events: readonly ChannelDeliveryStatusEvent[],
    context: ChannelDeliveryStatusContext,
    logger: ChannelDeliveryStatusLogger,
): void {
    for (const event of events) {
        if (event.status !== 'failed') continue;
        logger.error(
            `[${context.channelType}] el proveedor RECHAZÓ el mensaje ${event.providerMessageId} ` +
            `a ${event.recipient || 'desconocido'} (cuenta ${context.channelAccountId}): ` +
            `code=${event.errorCode ?? '?'} ${event.errorDetail ?? ''}`,
        );
    }
}

const outcome = (
    event: ChannelDeliveryStatusEvent, reason: ChannelDeliveryStatusReason,
): ChannelDeliveryStatusResult => Object.freeze({
    providerMessageId: event.providerMessageId,
    status: event.status,
    reason,
    applied: reason === 'applied',
});

/**
 * Apply provider status events to one tenant's conversation record.
 *
 * Never throws: the WhatsApp ingress owes Meta a 200 within seconds, and a
 * status that cannot be recorded is not a reason to make Meta redeliver the
 * whole payload. Callers that own a retryable job read `unavailable` instead.
 */
export async function recordChannelDeliveryStatuses(
    events: readonly ChannelDeliveryStatusEvent[],
    context: ChannelDeliveryStatusContext,
    deps: {
        store: ChannelDeliveryStatusStore;
        logger: ChannelDeliveryStatusLogger;
        /** Null means the connection belongs to no tenant we know — terminal. */
        resolveSchema: () => Promise<string | null>;
    },
): Promise<ChannelDeliveryStatusReport> {
    reportRejections(events, context, deps.logger);
    if (!events.length) return { results: [], unavailable: false };

    let schemaName: string | null;
    try {
        schemaName = await deps.resolveSchema();
    } catch (error: any) {
        deps.logger.warn(`[${context.channelType}] no se pudo resolver el tenant del estado: ${error?.message}`);
        return { results: events.map(event => outcome(event, 'unavailable')), unavailable: true };
    }
    if (!schemaName) return { results: events.map(event => outcome(event, 'unknown_tenant')), unavailable: false };

    const results: ChannelDeliveryStatusResult[] = [];
    let unavailable = false;
    for (const event of events) {
        // One transaction per event: they arrive out of order and repeated, and
        // each decides on its own whether it is newer than what is recorded.
        try {
            const applied = await deps.store.transactionInTenantSchema(schemaName, query =>
                applyDispatchProviderStatus(query, schemaName as string, {
                    providerMessageId: event.providerMessageId,
                    status: event.status,
                    errorCode: event.errorCode ?? null,
                }));
            results.push(outcome(event, applied.reason as ChannelDeliveryStatusReason));
        } catch (error: any) {
            deps.logger.debug(`[${context.channelType}] estado ${event.status} no aplicado: ${error?.message}`);
            results.push(outcome(event, 'unavailable'));
            unavailable = true;
        }
    }

    // Producers that predate the outbox identify their outbound by the provider
    // id itself, stored in `external_id`. Only receipts the outbox did not
    // recognise can belong to them, so only those are looked up here. The
    // delivered/read exclusion is the same rule the outbox enforces: once the
    // customer has the message, "failed" is the false statement.
    const legacyRejected = results
        .filter(result => result.status === 'failed' && result.reason === 'unknown_receipt')
        .map(result => result.providerMessageId);
    if (legacyRejected.length) {
        try {
            await deps.store.executeInTenantSchema(
                schemaName,
                `UPDATE messages SET status = 'failed'
                  WHERE external_id = ANY($1::text[]) AND direction = 'outbound'
                    AND status NOT IN ('failed', 'delivered', 'read', 'redacted')`,
                [legacyRejected],
            );
        } catch (error: any) {
            deps.logger.warn(`[${context.channelType}] no se pudo marcar el rechazo heredado: ${error?.message}`);
            unavailable = true;
        }
    }

    return { results, unavailable };
}
