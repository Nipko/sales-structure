import { redactWebhookCallbackToken, scrubSentryEvent } from './sentry-redaction.util';

const TENANT = '3e8ad32e-a16b-42e6-9634-b8e8cc29292d';
const SECRET = 'wk_live_9f2ab7c41d8e4f60b3aa5c7e12d9f4a8';

describe('sentry redaction', () => {
    it('strips the Wompi callback token but keeps the tenant id', () => {
        const url = `https://api.parallly-chat.cloud/api/v1/tenant-payments/webhook/wompi/${TENANT}/${SECRET}`;
        const redacted = redactWebhookCallbackToken(url);

        expect(redacted).not.toContain(SECRET);
        expect(redacted).toContain(TENANT);
        expect(redacted).toBe(
            `https://api.parallly-chat.cloud/api/v1/tenant-payments/webhook/wompi/${TENANT}/[redacted]`,
        );
    });

    it('strips the token when a query string or fragment follows it', () => {
        for (const suffix of ['?retry=3', '#frag']) {
            const redacted = redactWebhookCallbackToken(
                `/api/v1/tenant-payments/webhook/wompi/${TENANT}/${SECRET}${suffix}`,
            );
            expect(redacted).not.toContain(SECRET);
            expect(redacted).toContain(suffix);
        }
    });

    it('scrubs the url, the transaction name and breadcrumbs of one event', () => {
        const path = `/api/v1/tenant-payments/webhook/wompi/${TENANT}/${SECRET}`;
        const event = scrubSentryEvent({
            transaction: `POST ${path}`,
            request: { url: `https://api.parallly-chat.cloud${path}`, method: 'POST' },
            breadcrumbs: [
                { message: `handling ${path}` },
                { data: { url: `https://api.parallly-chat.cloud${path}` } },
            ],
        } as any);

        expect(JSON.stringify(event)).not.toContain(SECRET);
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
