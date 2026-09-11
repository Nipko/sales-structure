import {
    applyDispatchProviderStatus,
    resolveDispatchReceiptsUpTo,
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
/**
 * What Meta says this delivery cost, when it says anything.
 *
 * Carried through because from October 2026 the charge lands on DELIVERY, and
 * this block is the only place the provider states whether a particular
 * delivery was billable at all. `billable: false` is Meta saying the message
 * was inside the free monthly allowance or a free entry point — the one
 * authority that can settle a delivered message at zero. Everything else would
 * be a guess, so nothing else is allowed to decide it.
 *
 * Deliberately not stored on the message: it is a fact about money, and it
 * belongs to the reservation.
 */
export interface ProviderPricingSignal {
    readonly billable?: boolean | null;
    /** Meta's own category for the conversation this delivery belonged to. */
    readonly category?: string | null;
    /** `PMP`, `CBP` — which of Meta's pricing models applied. */
    readonly model?: string | null;
}

export interface ChannelDeliveryStatusEvent {
    readonly providerMessageId: string;
    readonly status: DispatchProviderStatus;
    /** For the rejection log only. Never stored: an event is not a directory. */
    readonly recipient?: string | null;
    /** Already namespaced by provider, e.g. `wa_131047`. */
    readonly errorCode?: string | null;
    readonly errorDetail?: string | null;
    readonly pricing?: ProviderPricingSignal | null;
}

/** Which connection the provider is talking about — the key, with the receipt. */
export interface ChannelDeliveryStatusContext {
    readonly channelType: string;
    readonly channelAccountId: string;
}

/**
 * A provider claim that names no message, only an instant and a thread.
 *
 * Messenger's read receipt is exactly this and nothing else. It is expanded
 * into real receipts before anything is written, so the decision about each
 * message stays where it already lives, in the per-receipt writer.
 */
export interface ChannelDeliveryWatermark {
    readonly status: DispatchProviderStatus;
    readonly watermarkMs: number;
    readonly recipient: string;
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

/**
 * The money's half of a delivery receipt.
 *
 * Kept as a port rather than an import so this module stays the shared rule for
 * three ingresses without dragging the billing graph into each of them. A
 * caller that has no spend authority passes nothing and the receipts still
 * reach the conversation record: an unmetered receipt is a gap in accounting,
 * never a reason to stop telling a customer's history the truth.
 */
export interface DeliveryReceiptLedger {
    applyDeliveryReceipt(schema: string, receipt: {
        providerMessageId: string;
        status: 'sent' | 'delivered' | 'read' | 'failed';
        errorCode?: string | null;
        pricing?: ProviderPricingSignal | null;
    }): Promise<unknown>;
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
/**
 * Meta's `pricing` block, read literally or not at all.
 *
 * `billable` is taken ONLY when it is a real boolean. A missing field is not
 * `false`: reading it that way would settle every delivery at zero the moment
 * Meta changed the payload shape, and a month of free messages is exactly the
 * kind of wrong number nobody questions.
 */
export function parseProviderPricing(pricing: unknown): ProviderPricingSignal | null {
    if (!pricing || typeof pricing !== 'object') return null;
    const raw = pricing as Record<string, unknown>;
    const billable = typeof raw.billable === 'boolean' ? raw.billable : null;
    const category = typeof raw.category === 'string' ? raw.category : null;
    const model = typeof raw.pricing_model === 'string' ? raw.pricing_model : null;
    if (billable === null && !category && !model) return null;
    return Object.freeze({ billable, category, model });
}

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
            pricing: parseProviderPricing(entry?.pricing),
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
        /**
         * Where a receipt goes to settle or release the money it belongs to.
         *
         * Optional because three ingresses share this writer and not all of
         * them carry the billing graph — but the WhatsApp ones do, and without
         * it every reservation stays counted for ever: the POST can only ever
         * say "Meta accepted it", and the charge lands on delivery.
         */
        spendLedger?: DeliveryReceiptLedger | null;
    },
    /**
     * Cutoffs that have to become receipts first. Kept on this one entry point
     * rather than given a writer of their own: a second path would be a second
     * ranking, and the last time this rule existed twice one copy let `failed`
     * overwrite `delivered`.
     */
    watermarks: readonly ChannelDeliveryWatermark[] = [],
): Promise<ChannelDeliveryStatusReport> {
    reportRejections(events, context, deps.logger);
    if (!events.length && !watermarks.length) return { results: [], unavailable: false };

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

    // Expand before deciding, so a cutoff and a named mid reach the writer as
    // the same kind of thing. A resolution that finds nothing is a fact — the
    // thread has no message the claim could change — not a failure.
    const resolved: ChannelDeliveryStatusEvent[] = [];
    for (const watermark of watermarks) {
        try {
            const receipts = await deps.store.transactionInTenantSchema(schemaName, query =>
                resolveDispatchReceiptsUpTo(query, schemaName as string, {
                    channelType: context.channelType,
                    channelAccountId: context.channelAccountId,
                    recipient: watermark.recipient,
                    status: watermark.status,
                    watermarkMs: watermark.watermarkMs,
                }));
            for (const providerMessageId of receipts) {
                resolved.push({ providerMessageId, status: watermark.status, errorCode: null });
            }
        } catch (error: any) {
            deps.logger.warn(
                `[${context.channelType}] no se pudo resolver el corte ${watermark.status} ` +
                `de ${watermark.watermarkMs}: ${error?.message}`);
            unavailable = true;
        }
    }

    for (const event of [...events, ...resolved]) {
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

        // ── AND THE MONEY, WHICH IS A SEPARATE RECORD ───────────────────────
        //
        // Run for EVERY event, including the ones the conversation record
        // rejected as not-newer or unknown: the two records answer different
        // questions and a receipt the timeline already knew about may still be
        // the first one the ledger has seen.
        //
        // Deliberately after the record and deliberately in its own try: a
        // reservation that cannot be resolved must not cost a customer their
        // delivery status, and Meta is owed a 200 either way.
        if (deps.spendLedger && context.channelType === 'whatsapp') {
            try {
                await deps.spendLedger.applyDeliveryReceipt(schemaName as string, {
                    providerMessageId: event.providerMessageId,
                    status: event.status as 'sent' | 'delivered' | 'read' | 'failed',
                    errorCode: event.errorCode ?? null,
                    pricing: event.pricing ?? null,
                });
            } catch (error: any) {
                deps.logger.warn(`[${context.channelType}] el recibo ${event.providerMessageId} `
                    + `no llegó al libro de gasto: ${error?.message}`);
                unavailable = true;
            }
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
