import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { MercadoPagoAdapter } from './mercadopago.adapter';
import { MercadoPagoConfigService } from './mercadopago-config.service';

/**
 * Unit tests for MercadoPagoAdapter.
 *
 * Focus: the pure helpers (status translation, HMAC verification) that do not
 * require a live MP account. The HTTP-dependent methods (createSubscription,
 * cancelSubscription, etc.) are exercised in the e2e tests in Sprint 2.11.
 */
describe('MercadoPagoAdapter', () => {
    let adapter: MercadoPagoAdapter;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MercadoPagoAdapter,
                {
                    provide: MercadoPagoConfigService,
                    useValue: {
                        webhookSecret: 'test_webhook_secret_abc123',
                        isConfigured: () => true,
                        environment: () => 'sandbox',
                    },
                },
            ],
        }).compile();

        adapter = module.get<MercadoPagoAdapter>(MercadoPagoAdapter);
    });

    describe('verifyWebhookSignature', () => {
        const secret = 'test_webhook_secret_abc123';

        const buildSignedRequest = (dataId: string, requestId: string, ts: string) => {
            const message = `id:${dataId};request-id:${requestId};ts:${ts};`;
            const v1 = createHmac('sha256', secret).update(message).digest('hex');
            return {
                rawBody: JSON.stringify({ data: { id: dataId }, type: 'payment', action: 'payment.created' }),
                headers: {
                    'x-signature': `ts=${ts},v1=${v1}`,
                    'x-request-id': requestId,
                },
            };
        };

        it('accepts a valid signature', () => {
            const { rawBody, headers } = buildSignedRequest('1234567890', 'req-abc', '1704382800');
            expect(adapter.verifyWebhookSignature(rawBody, headers)).toBe(true);
        });

        it('rejects when x-signature is missing', () => {
            const { rawBody } = buildSignedRequest('1234567890', 'req-abc', '1704382800');
            expect(adapter.verifyWebhookSignature(rawBody, { 'x-request-id': 'req-abc' })).toBe(false);
        });

        it('rejects when the v1 hash does not match', () => {
            const { rawBody, headers } = buildSignedRequest('1234567890', 'req-abc', '1704382800');
            // Tamper with the signature
            headers['x-signature'] = headers['x-signature'].replace(/v1=[a-f0-9]+$/, 'v1=' + '00'.repeat(32));
            expect(adapter.verifyWebhookSignature(rawBody, headers)).toBe(false);
        });

        it('rejects when data.id in body does not match the signed message', () => {
            const { headers } = buildSignedRequest('1234567890', 'req-abc', '1704382800');
            // Different id in body → recomputed hash won't match
            const rawBody = JSON.stringify({ data: { id: '9999999999' }, type: 'payment' });
            expect(adapter.verifyWebhookSignature(rawBody, headers)).toBe(false);
        });

        it('rejects when body is not valid JSON', () => {
            const { headers } = buildSignedRequest('1234567890', 'req-abc', '1704382800');
            expect(adapter.verifyWebhookSignature('not-json', headers)).toBe(false);
        });

        it('rejects when x-signature has no v1 component', () => {
            const rawBody = JSON.stringify({ data: { id: '1234567890' } });
            expect(adapter.verifyWebhookSignature(rawBody, {
                'x-signature': 'ts=1704382800',
                'x-request-id': 'req-abc',
            })).toBe(false);
        });
    });

    describe('translateStatus (protected — accessed via any-cast)', () => {
        const t = (mpStatus: string | undefined, hasTrial = false) =>
            (adapter as any).translateStatus(mpStatus, hasTrial);

        it('authorized + active trial → trialing', () => expect(t('authorized', true)).toBe('trialing'));
        it('authorized no trial → active', () => expect(t('authorized', false)).toBe('active'));
        it('pending → pending_auth', () => expect(t('pending')).toBe('pending_auth'));
        it('paused → past_due', () => expect(t('paused')).toBe('past_due'));
        it('cancelled → cancelled', () => expect(t('cancelled')).toBe('cancelled'));
        it('finished → expired', () => expect(t('finished')).toBe('expired'));
        it('unknown string → pending_auth (safe default)', () => expect(t('some_unknown')).toBe('pending_auth'));
    });
});
