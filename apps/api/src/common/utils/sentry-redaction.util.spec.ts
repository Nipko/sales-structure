import { redactWebhookCallbackToken, scrubSentryEvent } from './sentry-redaction.util';

const TENANT = '3e8ad32e-a16b-42e6-9634-b8e8cc29292d';

/**
 * This path segment is OUR callback token, not a provider key: it is minted by
 * `randomBytes(32).toString('base64url')` in TenantPaymentsService. So the
 * fixture uses that alphabet, and says out loud that it is a fixture — a
 * key-shaped invention like `wk_live_...` trips secret scanners and makes every
 * human reading the diff stop to check whether a real credential leaked.
 */
const CALLBACK_TOKEN = 'test-fixture-callback-token-not-a-real-secret';

describe('sentry redaction', () => {
    it('strips the Wompi callback token but keeps the tenant id', () => {
        const url = `https://api.parallly-chat.cloud/api/v1/tenant-payments/webhook/wompi/${TENANT}/${CALLBACK_TOKEN}`;
        const redacted = redactWebhookCallbackToken(url);

        expect(redacted).not.toContain(CALLBACK_TOKEN);
        expect(redacted).toContain(TENANT);
        expect(redacted).toBe(
            `https://api.parallly-chat.cloud/api/v1/tenant-payments/webhook/wompi/${TENANT}/[redacted]`,
        );
    });

    it('strips the token when a query string or fragment follows it', () => {
        for (const suffix of ['?retry=3', '#frag']) {
            const redacted = redactWebhookCallbackToken(
                `/api/v1/tenant-payments/webhook/wompi/${TENANT}/${CALLBACK_TOKEN}${suffix}`,
            );
            expect(redacted).not.toContain(CALLBACK_TOKEN);
            expect(redacted).toContain(suffix);
        }
    });

    it('scrubs the url, the transaction name and breadcrumbs of one event', () => {
        const path = `/api/v1/tenant-payments/webhook/wompi/${TENANT}/${CALLBACK_TOKEN}`;
        const event = scrubSentryEvent({
            transaction: `POST ${path}`,
            request: { url: `https://api.parallly-chat.cloud${path}`, method: 'POST' },
            breadcrumbs: [
                { message: `handling ${path}` },
                { data: { url: `https://api.parallly-chat.cloud${path}` } },
            ],
        } as any);

        expect(JSON.stringify(event)).not.toContain(CALLBACK_TOKEN);
        expect(event.request.method).toBe('POST');
    });

    it('leaves unrelated routes untouched', () => {
        // The MercadoPago tenant webhook carries only the tenant id, which is
        // not a secret — redacting it would cost triage detail for nothing.
        const mp = `/api/v1/tenant-payments/webhook/${TENANT}`;
        expect(redactWebhookCallbackToken(mp)).toBe(mp);
        expect(redactWebhookCallbackToken('/api/v1/billing/webhook/wompi')).toBe('/api/v1/billing/webhook/wompi');
    });

    it('survives an event with no request, transaction or breadcrumbs', () => {
        expect(() => scrubSentryEvent({} as any)).not.toThrow();
        expect(scrubSentryEvent(null as any)).toBeNull();
    });
});
