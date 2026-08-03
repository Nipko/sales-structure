import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { MercadoPagoAdapter } from './mercadopago.adapter';
import { MercadoPagoConfigService } from './mercadopago-config.service';

/**
 * Unit tests for MercadoPagoAdapter.
 *
 * Focus: pure helpers plus the request/response contract at the MercadoPago
 * client boundary. The SDK client is mocked, so these tests never make a live
 * provider call.
 */
describe('MercadoPagoAdapter', () => {
    let adapter: MercadoPagoAdapter;
    let preApprovalPlanCreate: jest.Mock;

    beforeEach(async () => {
        preApprovalPlanCreate = jest.fn();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MercadoPagoAdapter,
                {
                    provide: MercadoPagoConfigService,
                    useValue: {
                        webhookSecret: 'test_webhook_secret_abc123',
                        isConfigured: () => true,
                        environment: () => 'sandbox',
                        preApprovalPlan: { create: preApprovalPlanCreate },
                    },
                },
            ],
        }).compile();

        adapter = module.get<MercadoPagoAdapter>(MercadoPagoAdapter);
    });

    describe('createPlan', () => {
        const monthlyInput = {
            slug: 'pro',
            name: 'Pro — Parallly CO',
            amountCents: 75_770_000,
            currency: 'COP',
            billingInterval: 'month' as const,
        };

        it('sends the exact MCO monthly preapproval_plan payload', async () => {
            const previousDashboardUrl = process.env.DASHBOARD_URL;
            process.env.DASHBOARD_URL = 'https://dashboard.example.test';
            preApprovalPlanCreate.mockResolvedValue({ id: 'plan-mco-monthly-123' });

            try {
                await expect(adapter.createPlan(monthlyInput)).resolves.toEqual({
                    providerPlanId: 'plan-mco-monthly-123',
                    slug: 'pro',
                    name: 'Pro — Parallly CO',
                    amountCents: 75_770_000,
                    currency: 'COP',
                    billingInterval: 'month',
                    trialDays: undefined,
                });
            } finally {
                if (previousDashboardUrl === undefined) delete process.env.DASHBOARD_URL;
                else process.env.DASHBOARD_URL = previousDashboardUrl;
            }

            expect(preApprovalPlanCreate).toHaveBeenCalledTimes(1);
            expect(preApprovalPlanCreate).toHaveBeenCalledWith({
                body: {
                    reason: 'Pro — Parallly CO',
                    auto_recurring: {
                        frequency: 1,
                        frequency_type: 'months',
                        transaction_amount: 757_700,
                        currency_id: 'COP',
                    },
                    back_url: 'https://dashboard.example.test/admin/settings/billing?status=return',
                },
            });
        });

        it('expresses an annual plan as one charge every 12 months', async () => {
            preApprovalPlanCreate.mockResolvedValue({ id: 'plan-mco-annual-123' });

            await adapter.createPlan({ ...monthlyInput, billingInterval: 'year' });

            expect(preApprovalPlanCreate).toHaveBeenCalledWith(expect.objectContaining({
                body: expect.objectContaining({
                    auto_recurring: expect.objectContaining({
                        frequency: 12,
                        frequency_type: 'months',
                    }),
                }),
            }));
        });

        it('preserves sanitized provider diagnostics when MercadoPago rejects the collector', async () => {
            preApprovalPlanCreate.mockRejectedValue({
                status: 403,
                error: 'forbidden',
                cause: [{
                    code: 'rejected_by_regulations_collector_non_compliant',
                    description: 'Collector blocked. Bearer APP_USR-super-secret-token',
                }],
                response: {
                    headers: {
                        authorization: 'Bearer APP_USR-super-secret-token',
                        'x-request-id': 'req-mco-403-abc',
                    },
                },
            });

            let response: any;
            try {
                await adapter.createPlan(monthlyInput);
            } catch (err: any) {
                response = err.getResponse();
            }

            expect(response).toEqual({
                error: 'mp_plan_create_rejected',
                message: 'Collector blocked. Bearer [REDACTED]',
                provider: {
                    httpStatus: 403,
                    code: 'rejected_by_regulations_collector_non_compliant',
                    requestId: 'req-mco-403-abc',
                },
            });
            expect(JSON.stringify(response)).not.toContain('APP_USR-super-secret-token');
            expect(JSON.stringify(response)).not.toContain('authorization');
        });
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
