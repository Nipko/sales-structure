import type { SpendScopeKind } from './spend-scopes';

/**
 * Product decision for Meta's 1 October 2026 service-message pricing change.
 *
 * This object is runtime authority, not prose copied from the audit.  The
 * closure report imports it, and counter creation reads the same ceiling
 * values.  A future commercial change therefore has to change what the product
 * does before the report can claim that the decision changed.
 */
export const WHATSAPP_OCTOBER_COMMERCIAL_POLICY = Object.freeze({
    decisionId: 'whatsapp-october-2026-scenario-a',
    decidedAt: '2026-09-12',
    owner: 'product_owner',
    pricing: Object.freeze({
        planPricesChange: false,
        planCapacityChange: false,
        rationale: 'meta_bills_tenant_directly',
    }),
    defaults: Object.freeze({
        enforcement: 'observe' as const,
        /** One number: Meta's 1,000 free service deliveries plus 1,000 observed. */
        numberDeliveriesPerCalendarMonth: 2_000,
        /** One recipient: high enough for intensive support, finite against bot loops. */
        contactDeliveriesPerCalendarMonth: 60,
        warnPermille: 800,
        softPermille: 950,
    }),
    communication: Object.freeze({
        startsOn: '2026-09-15',
        paymentMethodDeadline: '2026-09-30',
        effectiveOn: '2026-10-01',
        surfaces: Object.freeze(['dashboard', 'landing', 'assist'] as const),
        lowRateMarkets: Object.freeze(['CO', 'BR', 'MX'] as const),
        highRateMarkets: Object.freeze(['AR', 'CL', 'PE'] as const),
        lowRateMessage: 'Meta cobra estos mensajes directamente; revisa el consumo y agrega su medio de pago antes del 30 de septiembre.',
        highRateMessage: 'Meta cobra según el país del destinatario; revisa la proyección de tu propio tráfico y agrega su medio de pago antes del 30 de septiembre.',
    }),
});

export interface DefaultSpendCeiling {
    readonly capDeliveries: number;
    readonly warnPermille: number;
    readonly softPermille: number;
}

/**
 * Default guardrails are observable until a tenant explicitly enables
 * enforcement.  `account` is keyed by channelAccountId, so it is the per-number
 * ceiling.  Existing rows win through INSERT ... ON CONFLICT DO NOTHING: an
 * operator's explicit ceiling or opt-out is never overwritten mid-period.
 */
export function defaultSpendCeilingFor(kind: SpendScopeKind): DefaultSpendCeiling | null {
    const policy = WHATSAPP_OCTOBER_COMMERCIAL_POLICY.defaults;
    const capDeliveries = kind === 'account'
        ? policy.numberDeliveriesPerCalendarMonth
        : kind === 'contact' ? policy.contactDeliveriesPerCalendarMonth : null;
    if (capDeliveries === null) return null;
    return Object.freeze({
        capDeliveries,
        warnPermille: policy.warnPermille,
        softPermille: policy.softPermille,
    });
}
