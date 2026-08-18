/**
 * The tenant-owned Wompi webhook authenticates the caller with an opaque
 * callback token carried as the LAST path segment of the URL. That token is
 * stored encrypted and deliberately kept out of the application logs — so it
 * must not reach Sentry either. Both sampled performance transactions and any
 * exception raised inside the handler carry the full request URL, which would
 * quietly undo that isolation for every sampled webhook delivery.
 *
 * The tenant id segment is intentionally preserved: it is not a secret, it
 * appears in every other route, and keeping it is what makes a Sentry issue
 * actionable.
 */
const WOMPI_WEBHOOK_TOKEN = /(\/tenant-payments\/webhook\/wompi\/[^/?#\s]+\/)[^/?#\s]+/gi;

export function redactWebhookCallbackToken(value: string): string {
    if (typeof value !== 'string' || !value) return value;
    return value.replace(WOMPI_WEBHOOK_TOKEN, '$1[redacted]');
}

/**
 * Scrubs a Sentry event in place. Shared by beforeSend and beforeSendTransaction
 * because an error inside the webhook and a sampled transaction of the same
 * request both carry the URL.
 */
export function scrubSentryEvent<T>(event: T): T {
    // Sentry hands the concrete Event/TransactionEvent type here; the return
    // type is preserved for the caller while the scrub itself is structural.
    const target = event as any;
    if (!target) return event;
    if (target.request && typeof target.request.url === 'string') {
        target.request.url = redactWebhookCallbackToken(target.request.url);
    }
    if (typeof target.transaction === 'string') {
        target.transaction = redactWebhookCallbackToken(target.transaction);
    }
    if (Array.isArray(target.breadcrumbs)) {
        for (const crumb of target.breadcrumbs) {
            if (crumb && typeof crumb.message === 'string') {
                crumb.message = redactWebhookCallbackToken(crumb.message);
            }
            if (crumb?.data && typeof crumb.data.url === 'string') {
                crumb.data.url = redactWebhookCallbackToken(crumb.data.url);
            }
        }
    }
    return event;
}
