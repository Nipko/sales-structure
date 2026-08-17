import { ToolDefinition } from '@parallext/shared';

/**
 * Hosted checkout creation is an A2 write. The model supplies only an opaque,
 * server-issued payable reference; ownership, concept and money are resolved
 * authoritatively by the backend after the customer's separate confirmation.
 */
export const CREATE_PAYMENT_LINK_TOOL: ToolDefinition = {
    name: 'create_payment_link',
    description: 'Create a single-use hosted payment link for a purchase owned by the current customer. Pass only the payableReference returned by a business tool. The backend resolves the exact concept, amount and currency. Requires explicit confirmation in a separate customer turn. A created link is still pending: never say it was paid until get_payment_status returns paid, and never invent or reuse a URL.',
    parameters: {
        type: 'object',
        properties: {
            payableReference: {
                type: 'string',
                description: 'Opaque payable reference returned by a trusted business tool, for example order:<uuid>.',
            },
        },
        required: ['payableReference'],
    },
};

/** Contact-owned read; provider redirects, screenshots and customer claims are never proof. */
export const GET_PAYMENT_STATUS_TOOL: ToolDefinition = {
    name: 'get_payment_status',
    description: 'Read the authoritative payment status for a purchase owned by the current customer. Use after the customer says they paid. Only a backend-verified status of paid means payment succeeded; pending, an active link, a redirect or a screenshot do not. ambiguous or requires_review must be escalated without claiming success and without asking the customer to pay again.',
    parameters: {
        type: 'object',
        properties: {
            payableReference: {
                type: 'string',
                description: 'Opaque payable reference returned by a trusted business or payment-link tool.',
            },
        },
        required: ['payableReference'],
    },
};

/** A4 remains defined for the audited executor contract, but is not advertised in payment v1. */
export const REFUND_PAYMENT_TOOL: ToolDefinition = {
    name: 'refund_payment',
    description: 'Request a full or partial refund for a payment owned by the current customer. Requires verified identity, explicit confirmation, a human approval ticket, an idempotency ledger and provider reconciliation. Never claim that a refund succeeded from this request alone.',
    parameters: {
        type: 'object',
        properties: {
            paymentReference: { type: 'string', description: 'Stable internal payment or business-object reference.' },
            amountCents: { type: 'number', description: 'Optional positive partial-refund amount in minor currency units; omit for full refund.' },
            currency: { type: 'string', description: 'ISO-4217 currency code.' },
            reason: { type: 'string', description: 'Short reason supplied for human review.' },
        },
        required: ['paymentReference', 'currency', 'reason'],
    },
};

export const PAYMENT_STATUS_TOOLS: ToolDefinition[] = [GET_PAYMENT_STATUS_TOOL];
export const PAYMENT_CREATE_TOOLS: ToolDefinition[] = [CREATE_PAYMENT_LINK_TOOL];
