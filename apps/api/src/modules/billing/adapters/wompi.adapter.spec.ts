import { createHash } from 'crypto';
import { WompiAdapter } from './wompi.adapter';
import { BillingEventType } from '../types/billing-event.enum';

/**
 * The two cryptographic contracts with Wompi are the ones worth locking down:
 * both fail SILENTLY in production (an invalid signature is just a rejected
 * charge; a bad checksum is just an ignored webhook) and neither says which
 * field is wrong.
 */
describe('WompiAdapter', () => {
    const EVENTS_SECRET = 'test_events_abc123';
    const INTEGRITY_SECRET = 'test_integrity_xyz789';

    function makeAdapter(overrides: Partial<Record<string, any>> = {}) {
        const config = {
            baseUrl: 'https://sandbox.wompi.co/v1',
            publicKey: 'pub_test_key',
            privateKey: 'prv_test_key',
            integritySecret: INTEGRITY_SECRET,
            eventsSecret: EVENTS_SECRET,
            environment: () => 'sandbox',
            isConfigured: () => true,
            canVerifyWebhooks: () => true,
            ...overrides,
        };
        return new WompiAdapter(config as any);
    }

    describe('integrity signature', () => {
        it('concatenates reference + amount + currency + secret, in that order', () => {
            const adapter = makeAdapter();
            const expected = createHash('sha256')
                .update(`sub_abc_20260812_1${'2769000'}COP${INTEGRITY_SECRET}`)
                .digest('hex');

            expect(adapter.buildIntegritySignature('sub_abc_20260812_1', 2_769_000, 'COP')).toBe(expected);
        });

        it('inserts the expiration BEFORE the secret when present', () => {
            const adapter = makeAdapter();
            const expiration = '2026-08-20T12:00:00.000Z';
            const expected = createHash('sha256')
                .update(`ref1500000COP${expiration}${INTEGRITY_SECRET}`)
                .digest('hex');

            expect(adapter.buildIntegritySignature('ref1', 500_000, 'COP', expiration)).toBe(expected);
        });

        it('produces a different signature when the amount changes', () => {
            const adapter = makeAdapter();
            const a = adapter.buildIntegritySignature('ref', 100_000, 'COP');
            const b = adapter.buildIntegritySignature('ref', 100_001, 'COP');
            expect(a).not.toBe(b);
        });
    });

    describe('webhook checksum', () => {
        /** Builds a payload whose checksum is correct by construction. */
        function signedEvent(opts: {
            status?: string;
            environment?: string;
            properties?: string[];
            timestamp?: number;
            secret?: string;
        } = {}) {
            const status = opts.status ?? 'APPROVED';
            const timestamp = opts.timestamp ?? 1_530_291_411;
            const transaction = {
                id: '1234-1610641025-49201',
                status,
                amount_in_cents: 4_490_000,
                reference: 'sub_abc_20260812_1',
                customer_email: 'owner@tenant.co',
                currency: 'COP',
                finalized_at: '2026-08-12T10:00:00.000Z',
            };
            const properties = opts.properties
                ?? ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
            // Same resolution the adapter performs: dotted paths walked against
            // the event's `data` object.
            const data: any = { transaction };
            const values = properties.map((path) => {
                const value = path.split('.').reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), data);
                return value === undefined || value === null ? '' : String(value);
            });
            const checksum = createHash('sha256')
                .update(values.join('') + String(timestamp) + (opts.secret ?? EVENTS_SECRET))
                .digest('hex');

            return {
                payload: {
                    event: 'transaction.updated',
                    data: { transaction },
                    environment: opts.environment ?? 'test',
                    signature: { properties, checksum },
                    timestamp,
                    sent_at: '2026-08-12T10:00:01.000Z',
                },
                checksum,
            };
        }

        it('accepts an event whose checksum matches', () => {
            const adapter = makeAdapter();
            const { payload } = signedEvent();
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(true);
        });

        it('rejects a tampered amount', () => {
            const adapter = makeAdapter();
            const { payload } = signedEvent();
            payload.data.transaction.amount_in_cents = 1;
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(false);
        });

        it('rejects a checksum computed with another secret', () => {
            const adapter = makeAdapter();
            const { payload } = signedEvent({ secret: 'prod_events_other' });
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(false);
        });

        it('follows signature.properties dynamically instead of assuming three fields', () => {
            // Wompi can extend the signed field list at any time; hardcoding
            // today's three would break verification the day it changes.
            const adapter = makeAdapter();
            const { payload } = signedEvent({
                properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents', 'transaction.currency'],
            });
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(true);
        });

        it('refuses a shrunk property list that re-uses an observed checksum', () => {
            // Attack: take one real event and move its concatenation into a
            // single field. `["transaction.id"]` with id = "<id><status><amount>"
            // hashes to the SAME digest as the original three fields joined with
            // no separator, which would leave status, email and amount forgeable.
            const adapter = makeAdapter();
            const { payload: legit } = signedEvent();
            const smuggled = `${legit.data.transaction.id}${legit.data.transaction.status}${legit.data.transaction.amount_in_cents}`;

            const forged = {
                ...legit,
                data: {
                    transaction: {
                        ...legit.data.transaction,
                        id: smuggled,
                        status: 'APPROVED',
                        amount_in_cents: 1,
                        customer_email: 'attacker@evil.example',
                    },
                },
                signature: { properties: ['transaction.id'], checksum: legit.signature.checksum },
            };

            // The digest genuinely collides — proving the attack is real and that
            // the required-properties guard is what stops it.
            const collides = createHash('sha256')
                .update(smuggled + String(legit.timestamp) + EVENTS_SECRET)
                .digest('hex');
            expect(collides).toBe(legit.signature.checksum);

            expect(adapter.verifyWebhookSignature(JSON.stringify(forged), {})).toBe(false);
        });

        it('rejects an event that omits environment instead of treating it as fine', () => {
            const adapter = makeAdapter();
            const { payload } = signedEvent();
            delete (payload as any).environment;
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(false);
        });

        it('rejects every event while the environment cannot be determined', () => {
            // Realistic rollout gap: the events secret is loaded before the
            // charging keys. The environment guard must not silently disappear.
            const adapter = makeAdapter({ environment: () => 'unconfigured' });
            const { payload } = signedEvent();
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(false);
        });

        it('rejects a production event while configured for sandbox', () => {
            // A sandbox APPROVED must never activate a real subscription.
            const adapter = makeAdapter();
            const { payload } = signedEvent({ environment: 'prod' });
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(false);
        });

        it('rejects everything when the events secret is missing', () => {
            const adapter = makeAdapter({ eventsSecret: undefined });
            const { payload } = signedEvent();
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(false);
        });

        it('rejects malformed bodies without throwing', () => {
            const adapter = makeAdapter();
            expect(adapter.verifyWebhookSignature('not-json', {})).toBe(false);
            expect(adapter.verifyWebhookSignature('{}', {})).toBe(false);
        });
    });

    describe('parseWebhookEvent', () => {
        function event(status: string) {
            return JSON.stringify({
                event: 'transaction.updated',
                data: {
                    transaction: {
                        id: 'txn-1',
                        status,
                        amount_in_cents: 2_769_000,
                        currency: 'COP',
                        reference: 'sub_abc_20260812_1',
                        customer_email: 'owner@tenant.co',
                    },
                },
                environment: 'test',
                signature: { properties: [], checksum: '' },
                timestamp: 1,
                sent_at: '2026-08-12T10:00:00.000Z',
            });
        }

        it.each([
            ['APPROVED', BillingEventType.PAYMENT_SUCCEEDED, 'succeeded'],
            ['DECLINED', BillingEventType.PAYMENT_FAILED, 'failed'],
            ['ERROR', BillingEventType.PAYMENT_FAILED, 'failed'],
            ['VOIDED', BillingEventType.PAYMENT_REFUNDED, 'refunded'],
        ])('maps %s to %s', async (status, expectedType, expectedPaymentStatus) => {
            const adapter = makeAdapter();
            const normalized = await adapter.parseWebhookEvent(event(status), {});

            expect(normalized.type).toBe(expectedType);
            expect(normalized.payment?.status).toBe(expectedPaymentStatus);
            expect(normalized.providerPaymentId).toBe('txn-1');
            expect(normalized.provider).toBe('wompi');
        });

        it('builds a deterministic event id that still allows PENDING → APPROVED', async () => {
            // Wompi sends no event id: the synthetic one must dedupe redeliveries
            // of the same state while letting a state CHANGE through.
            const adapter = makeAdapter();
            const pending = await adapter.parseWebhookEvent(event('PENDING'), {});
            const approved = await adapter.parseWebhookEvent(event('APPROVED'), {});
            const approvedAgain = await adapter.parseWebhookEvent(event('APPROVED'), {});

            expect(pending.providerEventId).not.toBe(approved.providerEventId);
            expect(approved.providerEventId).toBe(approvedAgain.providerEventId);
        });

        it('maps a wallet authorization to a payment-method event', async () => {
            const adapter = makeAdapter();
            const raw = JSON.stringify({
                event: 'nequi_token.updated',
                data: { nequi_token: { id: 'tok-1', status: 'APPROVED', customer_email: 'o@t.co' } },
                environment: 'test',
                timestamp: 1,
                sent_at: '2026-08-12T10:00:00.000Z',
            });

            const normalized = await adapter.parseWebhookEvent(raw, {});
            expect(normalized.type).toBe(BillingEventType.PAYMENT_METHOD_AUTHORIZED);
        });
    });

    describe('capability guards', () => {
        it('declares itself as having no native subscriptions', () => {
            const adapter = makeAdapter();
            expect(adapter.capabilities.nativeSubscriptions).toBe(false);
            expect(adapter.capabilities.asyncSettlement).toBe(true);
            expect(adapter.capabilities.refunds).toBe('void_only');
            expect(adapter.capabilities.currencies).toEqual(['COP']);
        });

        it('throws loudly on subscription methods instead of silently succeeding', async () => {
            const adapter = makeAdapter();
            await expect(adapter.createSubscription({} as any)).rejects.toThrow();
            await expect(adapter.createPlan({} as any)).rejects.toThrow();
            await expect(adapter.getSubscription()).rejects.toThrow();
            await expect(adapter.cancelSubscription('x')).rejects.toThrow();
        });

        it('sends installments on a card charge', async () => {
            // Verified against the sandbox: Wompi answers 422 "No se especificó
            // el número de cuotas" when a CARD source is charged without
            // payment_method, even though the docs describe it as optional once
            // payment_source_id is present. This would have failed the very
            // first real renewal.
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
                ok: true,
                status: 201,
                statusText: 'Created',
                text: async () => JSON.stringify({ data: { id: 'txn-1', status: 'PENDING', reference: 'r', amount_in_cents: 200_000, currency: 'COP' } }),
            } as any);

            try {
                await adapter.charge({
                    reference: 'r', amountCents: 200_000, currency: 'COP',
                    customerEmail: 'a@b.co', providerSourceId: '42', recurrent: true,
                });
                const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
                expect(body.payment_method).toEqual({ installments: 1 });
                expect(body.payment_source_id).toBe(42);
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('omits installments for a wallet source', async () => {
            // Nequi and bank-transfer sources take no instalment count; sending
            // one is a card-only field.
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
                ok: true,
                status: 201,
                statusText: 'Created',
                text: async () => JSON.stringify({ data: { id: 'txn-2', status: 'PENDING', reference: 'r', amount_in_cents: 200_000, currency: 'COP' } }),
            } as any);

            try {
                await adapter.charge({
                    reference: 'r', amountCents: 200_000, currency: 'COP',
                    customerEmail: 'a@b.co', providerSourceId: '43', recurrent: true,
                    sourceKind: 'nequi',
                });
                const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
                expect(body.payment_method).toBeUndefined();
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('refuses a non-COP charge', async () => {
            const adapter = makeAdapter();
            await expect(adapter.charge({
                reference: 'r', amountCents: 1_000_000, currency: 'USD',
                customerEmail: 'a@b.co', providerSourceId: '1', recurrent: true,
            })).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'unsupported_currency' }),
            });
        });

        it('refuses an amount below the provider minimum', async () => {
            const adapter = makeAdapter();
            await expect(adapter.charge({
                reference: 'r', amountCents: 1_000, currency: 'COP',
                customerEmail: 'a@b.co', providerSourceId: '1', recurrent: true,
            })).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'amount_below_minimum' }),
            });
        });
    });
});
