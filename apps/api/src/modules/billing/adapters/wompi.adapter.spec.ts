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
    const ACCEPTANCE = {
        endUserPolicy: { token: 'acceptance-jwt', permalink: 'https://wompi.co/end-user', type: 'END_USER_POLICY' },
        personalDataAuth: { token: 'personal-jwt', permalink: 'https://wompi.co/personal', type: 'PERSONAL_DATA_AUTH' },
    };

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

        function signedTokenEvent(
            event: 'nequi_token.updated' | 'bancolombia_transfer_token.updated',
            status = 'APPROVED',
        ) {
            const key = event === 'nequi_token.updated'
                ? 'nequi_token'
                : 'bancolombia_transfer_token';
            const timestamp = 1_530_291_411;
            const token = { id: `${key}-1`, status };
            const properties = [`${key}.id`, `${key}.status`];
            const checksum = createHash('sha256')
                .update(`${token.id}${token.status}${timestamp}${EVENTS_SECRET}`)
                .digest('hex');
            return {
                event,
                data: { [key]: token },
                environment: 'test',
                signature: { properties, checksum },
                timestamp,
            };
        }

        it('accepts an event whose checksum matches', () => {
            const adapter = makeAdapter();
            const { payload } = signedEvent();
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(true);
        });

        it.each([
            'nequi_token.updated',
            'bancolombia_transfer_token.updated',
        ] as const)('accepts the documented %s token signature shape', (eventName) => {
            const adapter = makeAdapter();
            const payload = signedTokenEvent(eventName);
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(true);
        });

        it('rejects a Nequi event signed with transaction fields instead of token fields', () => {
            const adapter = makeAdapter();
            const payload: any = signedTokenEvent('nequi_token.updated');
            payload.signature.properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
            expect(adapter.verifyWebhookSignature(JSON.stringify(payload), {})).toBe(false);
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

        function response(data: any, ok = true, status = 200) {
            return {
                ok,
                status,
                statusText: ok ? 'OK' : 'Not Found',
                text: async () => JSON.stringify(data),
            } as any;
        }

        function canonicalTransaction(status: string, overrides: Record<string, unknown> = {}) {
            return response({
                data: {
                    id: 'txn-1',
                    status,
                    amount_in_cents: 2_769_000,
                    currency: 'COP',
                    reference: 'sub_abc_20260812_1',
                    customer_email: 'owner@tenant.co',
                    ...overrides,
                },
            });
        }

        it.each([
            ['APPROVED', BillingEventType.PAYMENT_SUCCEEDED, 'succeeded'],
            ['DECLINED', BillingEventType.PAYMENT_FAILED, 'failed'],
            ['ERROR', BillingEventType.PAYMENT_FAILED, 'failed'],
            ['VOIDED', BillingEventType.PAYMENT_REFUNDED, 'refunded'],
        ])('maps %s to %s', async (status, expectedType, expectedPaymentStatus) => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any)
                .mockResolvedValue(canonicalTransaction(status));
            try {
                const normalized = await adapter.parseWebhookEvent(event(status), {});

                expect(normalized.type).toBe(expectedType);
                expect(normalized.payment?.status).toBe(expectedPaymentStatus);
                expect(normalized.providerPaymentId).toBe('txn-1');
                expect(normalized.provider).toBe('wompi');
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('ignores a non-final PENDING update instead of mutating billing state', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any)
                .mockResolvedValue(canonicalTransaction('PENDING'));
            try {
                await expect(adapter.parseWebhookEvent(event('PENDING'), {})).rejects.toMatchObject({
                    response: expect.objectContaining({ error: 'wompi_transaction_not_final' }),
                });
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('uses the canonical transaction, never unsigned reference/email fields from the webhook', async () => {
            const adapter = makeAdapter();
            const forged = JSON.parse(event('APPROVED'));
            forged.data.transaction.reference = 'attacker-controlled';
            forged.data.transaction.customer_email = 'attacker@example.com';
            const fetchSpy = jest.spyOn(global, 'fetch' as any)
                .mockResolvedValue(canonicalTransaction('APPROVED'));
            try {
                const normalized = await adapter.parseWebhookEvent(JSON.stringify(forged), {});
                expect(normalized.payerEmail).toBe('owner@tenant.co');
                expect((normalized.rawPayload as any).data.transaction.reference)
                    .toBe('sub_abc_20260812_1');
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it.each([
            ['nequi_token.updated', 'nequi_token', 'APPROVED', BillingEventType.PAYMENT_METHOD_AUTHORIZED, '/tokens/nequi/tok-1'],
            ['bancolombia_transfer_token.updated', 'bancolombia_transfer_token', 'DECLINED', BillingEventType.PAYMENT_METHOD_DECLINED, '/tokens/bancolombia_transfer/tok-1'],
        ])('maps the documented %s event after canonical lookup', async (
            eventName,
            tokenKey,
            status,
            expectedType,
            expectedPath,
        ) => {
            const adapter = makeAdapter();
            const raw = JSON.stringify({
                event: eventName,
                data: { [tokenKey]: { id: 'tok-1', status } },
                environment: 'test',
                timestamp: 1,
                sent_at: '2026-08-12T10:00:00.000Z',
            });
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue(response({
                data: { id: 'tok-1', status, customer_email: 'owner@tenant.co' },
            }));

            try {
                const normalized = await adapter.parseWebhookEvent(raw, {});
                expect(normalized.type).toBe(expectedType);
                expect(fetchSpy.mock.calls[0][0]).toContain(expectedPath);
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('keeps a canonical lookup failure retryable', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue(response({
                error: { type: 'NOT_FOUND' },
            }, false, 404));
            try {
                await expect(adapter.parseWebhookEvent(event('APPROVED'), {})).rejects.toMatchObject({
                    status: 503,
                });
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    describe('payment sources', () => {
        const ok = (data: any, status = 200) => ({
            ok: true,
            status,
            statusText: 'OK',
            text: async () => JSON.stringify({ data }),
        } as any);

        it('keeps a Nequi token pending and does not create a source prematurely', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue(ok({
                id: 'nequi-token-1',
                status: 'PENDING',
            }));
            try {
                const source = await adapter.startPaymentSource({
                    tenantId: 'tenant-1',
                    kind: 'nequi',
                    token: 'nequi-token-1',
                    customerEmail: 'owner@tenant.co',
                    acceptance: ACCEPTANCE,
                });
                expect(source).toMatchObject({
                    providerSourceId: 'pending:nequi:nequi-token-1',
                    authTokenId: 'nequi-token-1',
                    status: 'pending_auth',
                });
                expect(fetchSpy).toHaveBeenCalledTimes(1);
                expect(fetchSpy.mock.calls[0][0]).toContain('/tokens/nequi/nequi-token-1');
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('creates a Bancolombia source only after approval and sends payment_description', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any)
                .mockResolvedValueOnce(ok({ id: 'bank-token-1', status: 'APPROVED' }))
                .mockResolvedValueOnce(ok({
                    id: 91,
                    type: 'BANCOLOMBIA_TRANSFER',
                    status: 'AVAILABLE',
                    public_data: { bank_account_last_four: '4321' },
                }, 201));
            try {
                const source = await adapter.startPaymentSource({
                    tenantId: 'tenant-1',
                    kind: 'bancolombia_transfer',
                    token: 'bank-token-1',
                    customerEmail: 'owner@tenant.co',
                    acceptance: ACCEPTANCE,
                    paymentDescription: 'Suscripción Parallly',
                });
                expect(source).toMatchObject({
                    providerSourceId: '91',
                    status: 'available',
                    last4: '4321',
                });
                const sourceRequest = fetchSpy.mock.calls[1][1] as any;
                expect(sourceRequest.method).toBe('POST');
                expect(JSON.parse(sourceRequest.body)).toMatchObject({
                    type: 'BANCOLOMBIA_TRANSFER',
                    token: 'bank-token-1',
                    customer_email: 'owner@tenant.co',
                    acceptance_token: 'acceptance-jwt',
                    accept_personal_auth: 'personal-jwt',
                    payment_description: 'Suscripción Parallly',
                });
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('converts an approved Bancolombia token into a source during status polling', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any)
                .mockResolvedValueOnce(ok({ id: 'bank-token-2', status: 'APPROVED' }))
                .mockResolvedValueOnce(ok({
                    id: 92,
                    type: 'BANCOLOMBIA_TRANSFER',
                    status: 'AVAILABLE',
                    public_data: {},
                }, 201));
            try {
                const source = await adapter.pollPaymentSourceAuth(
                    'pending:bancolombia_transfer:bank-token-2',
                    'bank-token-2',
                    {
                        kind: 'bancolombia_transfer',
                        customerEmail: 'owner@tenant.co',
                        paymentDescription: 'Suscripción Parallly',
                        acceptance: ACCEPTANCE,
                    },
                );
                expect(source).toMatchObject({ providerSourceId: '92', status: 'available' });
                expect(fetchSpy).toHaveBeenCalledTimes(2);
                expect(fetchSpy.mock.calls[0][0]).toContain('/tokens/bancolombia_transfer/bank-token-2');
                expect(fetchSpy.mock.calls[1][0]).toContain('/payment_sources');
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('uses the documented PUT /payment_sources/:id/void endpoint', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue(ok({}));
            try {
                await adapter.voidPaymentSource('source/unsafe');
                expect(fetchSpy.mock.calls[0][0]).toContain('/payment_sources/source%2Funsafe/void');
                expect((fetchSpy.mock.calls[0][1] as any).method).toBe('PUT');
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('fails closed when either acceptance contract is absent', async () => {
            const adapter = makeAdapter();
            await expect(adapter.startPaymentSource({
                tenantId: 'tenant-1',
                kind: 'card',
                token: 'card-token',
                customerEmail: 'owner@tenant.co',
                acceptance: { endUserPolicy: ACCEPTANCE.endUserPolicy } as any,
            })).rejects.toMatchObject({
                response: expect.objectContaining({ error: 'acceptance_required' }),
            });
        });

        it('rejects merchant metadata without accept_personal_auth contract', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue(ok({
                presigned_acceptance: {
                    acceptance_token: 'policy-token',
                    permalink: 'https://wompi.co/policy',
                },
            }));
            try {
                await expect(adapter.getAcceptanceContracts()).rejects.toMatchObject({
                    response: expect.objectContaining({
                        error: 'wompi_personal_data_acceptance_unavailable',
                    }),
                });
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    describe('void confirmation', () => {
        const response = (status: string) => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify({ data: {
                id: 'txn-void',
                status,
                reference: 'ref-void',
                amount_in_cents: 100_000,
                currency: 'COP',
            } }),
        } as any);
        const accepted = {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify({ data: {} }),
        } as any;

        it('does not report a refund after a 2xx while canonical state remains APPROVED', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any)
                .mockResolvedValueOnce(response('APPROVED'))
                .mockResolvedValueOnce(accepted)
                .mockResolvedValueOnce(response('APPROVED'))
                .mockResolvedValueOnce(response('PENDING'))
                .mockResolvedValueOnce(response('APPROVED'));
            try {
                await expect(adapter.refundPayment('txn-void')).rejects.toMatchObject({
                    status: 503,
                    response: expect.objectContaining({
                        error: 'wompi_void_pending_confirmation',
                        preserveRefundPending: true,
                    }),
                });
                expect(fetchSpy).toHaveBeenCalledTimes(5);
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('returns only after the canonical transaction reaches VOIDED', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any)
                .mockResolvedValueOnce(response('APPROVED'))
                .mockResolvedValueOnce(accepted)
                .mockResolvedValueOnce(response('VOIDED'));
            try {
                await expect(adapter.refundPayment('txn-void')).resolves.toBeUndefined();
                expect(fetchSpy).toHaveBeenCalledTimes(3);
            } finally {
                fetchSpy.mockRestore();
            }
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
                    acceptance: ACCEPTANCE,
                });
                const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
                expect(body.payment_method).toEqual({ installments: 1 });
                expect(body.payment_source_id).toBe(42);
                expect(body.acceptance_token).toBe('acceptance-jwt');
                expect(body.accept_personal_auth).toBe('personal-jwt');
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
                    acceptance: ACCEPTANCE,
                });
                const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
                expect(body.payment_method).toBeUndefined();
                expect(body.recurrent).toBeUndefined();
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('prefers PENDING over an older DECLINED transaction for the same reference', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => JSON.stringify({
                    data: [
                        {
                            id: 'txn-declined', status: 'DECLINED', reference: 'ref-1',
                            amount_in_cents: 200_000, currency: 'COP',
                            created_at: '2026-08-15T10:00:00.000Z',
                        },
                        {
                            id: 'txn-pending', status: 'PENDING', reference: 'ref-1',
                            amount_in_cents: 200_000, currency: 'COP',
                            created_at: '2026-08-15T10:01:00.000Z',
                        },
                    ],
                }),
            } as any);
            try {
                await expect(adapter.getChargeByReference('ref-1')).resolves.toMatchObject({
                    providerChargeId: 'txn-pending',
                    status: 'pending',
                    amountCents: 200_000,
                    currency: 'COP',
                });
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('always prefers APPROVED over a newer PENDING transaction', async () => {
            const adapter = makeAdapter();
            const transaction = (id: string, status: string, createdAt: string) => ({
                id, status, reference: 'ref-2', amount_in_cents: 200_000,
                currency: 'COP', created_at: createdAt,
            });
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => JSON.stringify({ data: [
                    transaction('txn-approved', 'APPROVED', '2026-08-15T10:00:00.000Z'),
                    transaction('txn-pending', 'PENDING', '2026-08-15T10:01:00.000Z'),
                ] }),
            } as any);
            try {
                await expect(adapter.getChargeByReference('ref-2')).resolves.toMatchObject({
                    providerChargeId: 'txn-approved', status: 'approved',
                });
            } finally {
                fetchSpy.mockRestore();
            }
        });

        it('surfaces rate limiting as an indeterminate 503, not a tenant payment failure', async () => {
            const adapter = makeAdapter();
            const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                text: async () => JSON.stringify({ error: { type: 'RATE_LIMITED' } }),
            } as any);
            try {
                await expect(adapter.getCharge('txn-1')).rejects.toMatchObject({
                    status: 503,
                    response: expect.objectContaining({ providerStatus: 429 }),
                });
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
