import type { OutboundMessage } from '@parallext/shared';

/** The queue holds references only; URLs, recipients and captions stay in the tenant ledger. */
export interface ApprovedEffectReference { tenantId: string; ticketId: string; effectId: string; }
export const APPROVED_EFFECT_DELIVERY = Symbol('APPROVED_EFFECT_DELIVERY');
export interface ApprovedEffectTransport {
    /** Resolve credentials and eligibility before marking an external attempt uncertain. */
    prepare(outbound: OutboundMessage): Promise<() => Promise<string | null>>;
}
export interface ApprovedEffectDeliveryPort {
    deliver(reference: ApprovedEffectReference, transport: ApprovedEffectTransport): Promise<string | null>;
}
export class ApprovalEffectSuppressed extends Error {
    constructor(readonly code: string) { super(code); }
}
