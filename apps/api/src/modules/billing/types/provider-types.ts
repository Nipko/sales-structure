import { BillingEventType } from './billing-event.enum';
import { SubscriptionStatus } from './subscription-status.enum';

/**
 * Payment provider names the system can NAME. Which one runs for a given charge
 * is decided by PaymentRoutingService (kill switch → country default → tenant
 * override → the provider frozen on the subscription) and resolved by
 * PaymentProviderFactory.
 *
 * 'mercadopago' sigue en el union como VALOR LEGADO DE SOLO LECTURA: hay filas
 * históricas que lo nombran (billing_subscriptions viejas, billing_payments,
 * billing_events, tenants.payment_provider) y borrar el literal haría tirar a
 * cualquier lectura de ese historial. Como PSP de plataforma está RETIRADO por
 * decisión del dueño (ago 2026, collector_non_compliant nunca resuelto): no es
 * ruteable, no se puede habilitar y no tiene adapter. La cuenta de MercadoPago
 * del TENANT para cobrar a sus propios clientes vive en modules/tenant-payments
 * y no pasa por acá.
 *
 * Providers without native subscriptions (wompi) additionally implement
 * IChargingProvider and are driven by our own recurring engine.
 */
export type PaymentProviderName = 'mercadopago' | 'stripe' | 'wompi' | 'mock';

/**
 * Providers que el RUTEO puede elegir para cobros nuevos. La lista gobierna el
 * barrido de failover, la validación de settings y el listado del panel: lo que
 * no está acá no puede recibir un cobro nuevo jamás, aunque el union lo nombre.
 */
export const PAYMENT_PROVIDER_NAMES: readonly PaymentProviderName[] = [
    'stripe',
    'wompi',
    'mock',
] as const;

/** Ruteable hoy: válido para settings, override por tenant y altas nuevas. */
export function isPaymentProviderName(value: unknown): value is PaymentProviderName {
    return typeof value === 'string' && (PAYMENT_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Nombres válidos al LEER datos existentes (suscripciones, pagos, eventos).
 * Incluye los retirados: una fila vieja no es un dato corrupto.
 */
export const LEGACY_PAYMENT_PROVIDER_NAMES: readonly PaymentProviderName[] = [
    ...PAYMENT_PROVIDER_NAMES,
    'mercadopago',
] as const;

export function isLegacyPaymentProviderName(value: unknown): value is PaymentProviderName {
    return typeof value === 'string' && (LEGACY_PAYMENT_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Billing cycle chosen for a subscription. Stored on billing_subscriptions
 * (metadata.billingCycle) and used to resolve which preapproval_plan to bind:
 * monthly → priceLocalOverrides[country].mpPlanId, annual →
 * priceLocalOverrides[country].annual.mpPlanId. Maps to the provider's
 * billingInterval ('monthly'→'month', 'annual'→'year').
 */
export type BillingCycle = 'monthly' | 'annual';

// -----------------------------------------------------------------------------
// Customer
// -----------------------------------------------------------------------------

/**
 * Normalized customer record returned by a provider.
 *
 * Note on MercadoPago: MP has no native "customer" concept for subscriptions —
 * the payer is implicit in the `preapproval` record. The MercadoPago adapter
 * generates a synthetic ID (typically the tenant UUID) and returns it here so
 * the rest of the system can treat providers uniformly.
 */
export interface ProviderCustomer {
    providerCustomerId: string;
    email: string;
    name?: string;
    country?: string;
    createdAt: Date;
}

export interface CreateCustomerInput {
    tenantId: string;
    email: string;
    name?: string;
    country?: string;
    /** Arbitrary metadata to attach to the provider customer for reconciliation. */
    metadata?: Record<string, string>;
}

// -----------------------------------------------------------------------------
// Plan
// -----------------------------------------------------------------------------

export interface ProviderPlan {
    providerPlanId: string;
    slug: string;
    name: string;
    amountCents: number;
    currency: string;
    billingInterval: 'month' | 'year';
    trialDays?: number;
}

export interface CreatePlanInput {
    slug: string;
    name: string;
    amountCents: number;
    currency: string;
    billingInterval: 'month' | 'year';
    trialDays?: number;
    metadata?: Record<string, string>;
}

// -----------------------------------------------------------------------------
// Subscription
// -----------------------------------------------------------------------------

export interface ProviderSubscription {
    providerSubscriptionId: string;
    providerCustomerId: string;
    providerPlanId: string;
    status: SubscriptionStatus;
    trialEndsAt?: Date;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    /** True if the subscription is scheduled to stop at current_period_end and not renew. */
    cancelAtPeriodEnd: boolean;
    /** The provider's native raw status string, for debugging. Do not use for logic. */
    rawStatus?: string;
}

export interface CreateSubscriptionInput {
    tenantId: string;
    providerCustomerId: string;
    providerPlanId: string;
    /** If set, provider applies a free trial of this length before the first charge. */
    trialDays?: number;
    /** Short-lived card token from the provider's client-side SDK. Some flows (Starter, no-card trial) omit this. */
    cardTokenId?: string;
    /**
     * Billing interval this subscription runs on. Informational only — the real
     * cycle is frozen in the preapproval_plan that providerPlanId points to. Used
     * for logging/telemetry. Defaults to 'month'.
     */
    billingInterval?: 'month' | 'year';
    /** Arbitrary metadata passed through to the provider for later correlation. */
    metadata?: Record<string, string>;
    /**
     * External reference the provider stores alongside the subscription. Used
     * for reconciliation queries (`GET /preapproval/search?external_reference=...`).
     * Defaults to the tenantId if omitted.
     */
    externalReference?: string;
}

export interface CancelSubscriptionOptions {
    /**
     * true: cancel immediately, revoke access now.
     * false (default): mark cancel_at_period_end; access preserved until period end.
     */
    immediate?: boolean;
    reason?: string;
}

/** Options only the billing SERVICE understands; adapters never see these. */
export interface CancelSubscriptionServiceOptions extends CancelSubscriptionOptions {
    /**
     * Proceed even when a retired provider still holds the mandate, recording
     * it instead of refusing. Only the tenant purge sets this: there, refusing
     * protects nobody — we have no credentials to cancel remotely, ever, and
     * blocking the delete does not stop a remote charge. It only keeps our own
     * rows around. Every other caller must keep failing loudly, because telling
     * a tenant "you are cancelled" while the provider still charges is a lie.
     */
    allowStrandedMandate?: boolean;
}

// -----------------------------------------------------------------------------
// Payment (for webhooks and history)
// -----------------------------------------------------------------------------

export interface ProviderPayment {
    providerPaymentId: string;
    providerSubscriptionId?: string;
    amountCents: number;
    currency: string;
    status: 'succeeded' | 'failed' | 'refunded' | 'pending';
    paidAt?: Date;
    failureReason?: string;
    rawStatus?: string;
}

// -----------------------------------------------------------------------------
// Webhook
// -----------------------------------------------------------------------------

/**
 * A webhook event after the adapter has parsed and normalized it. This is what
 * BillingService.handleBillingEvent() consumes — it should never see raw
 * provider payloads.
 */
export interface NormalizedBillingEvent {
    /** Our normalized event taxonomy. */
    type: BillingEventType;
    /** Provider that sourced this event. */
    provider: PaymentProviderName;
    /**
     * Provider's unique event id. The database unique constraint is the durable
     * idempotency authority; Redis only holds a short processing lock.
     */
    providerEventId: string;
    /** When the event happened at the provider. */
    occurredAt: Date;

    /** Resolved from the provider's external_reference / metadata. */
    tenantId?: string;
    providerSubscriptionId?: string;
    providerCustomerId?: string;
    providerPaymentId?: string;
    /** Payer email from the payment — used as last-resort tenant resolution when providerSubscriptionId and tenantId are missing. */
    payerEmail?: string;

    /** The subscription state the provider is reporting (post-event). Undefined for non-subscription events. */
    subscription?: ProviderSubscription;
    /** The payment record, if the event is payment-related. */
    payment?: ProviderPayment;

    /**
     * The raw provider payload, stored verbatim in billing_events.payload for
     * audit and debugging. Never used for business logic — only the normalized
     * fields above are.
     */
    rawPayload: unknown;
}
