const knownReasons = new Set([
    'human_request', 'complaint', 'discount_request', 'vip', 'max_failed_attempts',
    'agent_promised_handoff', 'customer_accepted_human_offer', 'unknown',
]);

/** Event codes stay stable in the data; analytics labels use the current locale. */
export function analyticsHandoffReasonLabel(reason: unknown, translate: (key: string) => string): string {
    const value = typeof reason === 'string' ? reason.trim() : '';
    const key = !value ? 'unknown' : knownReasons.has(value) ? value
        : value.startsWith('custom_trigger:') ? 'custom_trigger'
        : value.startsWith('intake:') ? 'intake' : 'other';
    return translate(`handoffReasonLabels.${key}`);
}
