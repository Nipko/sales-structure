export type TenantPaymentProvider = 'mercadopago' | 'wompi';

export type TenantPaymentStatus =
    | 'pending'
    | 'paid'
    | 'failed'
    | 'refunded'
    | 'expired'
    | 'requires_review'
    | 'ambiguous';

export interface PaymentReferenceTarget {
    table: 'orders' | 'tour_bookings' | 'food_orders' | 'enrollments' | 'property_bookings';
    amountExpression: string;
    currencyExpression: string;
    join?: string;
    rejectedStatuses: readonly string[];
    description: (entityId: string) => string;
}

export const PAYMENT_REFERENCE_TARGETS: Record<string, PaymentReferenceTarget> = {
    order: {
        table: 'orders',
        amountExpression: 'target.total_amount',
        currencyExpression: 'target.currency',
        rejectedStatuses: ['cancelled', 'refunded', 'paid'],
        description: entityId => `Pago de pedido ${entityId.slice(0, 8)}`,
    },
    tour: {
        table: 'tour_bookings',
        amountExpression: 'target.total_price',
        currencyExpression: 'target.currency',
        rejectedStatuses: ['cancelled', 'refunded'],
        description: entityId => `Pago de reserva de tour ${entityId.slice(0, 8)}`,
    },
    // The vacation-rental sale. `total_price` already includes the cleaning fee
    // (properties.service computes nights x night_price + cleaning_fee), so the
    // stay is charged exactly once for the amount the guest was quoted.
    property: {
        table: 'property_bookings',
        amountExpression: 'target.total_price',
        currencyExpression: 'target.currency',
        rejectedStatuses: ['cancelled', 'refunded'],
        description: entityId => `Pago de reserva de alojamiento ${entityId.slice(0, 8)}`,
    },
    food: {
        table: 'food_orders',
        amountExpression: 'target.total',
        currencyExpression: 'target.currency',
        rejectedStatuses: ['cancelled', 'refunded'],
        description: entityId => `Pago de pedido de restaurante ${entityId.slice(0, 8)}`,
    },
    enrollment: {
        table: 'enrollments',
        amountExpression: 'course.price',
        currencyExpression: 'course.currency',
        join: 'JOIN courses course ON course.id = target.course_id',
        rejectedStatuses: ['dropped', 'refunded', 'cancelled'],
        description: entityId => `Pago de matrícula ${entityId.slice(0, 8)}`,
    },
};

const PAYMENT_REFERENCE_RE = /^([a-z]+):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function parsePaymentReference(reference: string): {
    kind: string;
    entityId: string;
    canonicalReference: string;
    target: PaymentReferenceTarget;
} | null {
    const match = PAYMENT_REFERENCE_RE.exec(String(reference || '').trim());
    if (!match) return null;
    const kind = match[1].toLowerCase();
    const entityId = match[2].toLowerCase();
    const target = PAYMENT_REFERENCE_TARGETS[kind];
    if (!target) return null;
    return { kind, entityId, canonicalReference: `${kind}:${entityId}`, target };
}

