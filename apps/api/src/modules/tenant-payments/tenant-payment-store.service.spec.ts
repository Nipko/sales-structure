import { TenantPaymentStoreService } from './tenant-payment-store.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const ENTITY = '33333333-3333-4333-8333-333333333333';
const INTENT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_KEY = 'a'.repeat(64);

function intentRow(overrides: Record<string, unknown> = {}) {
    return {
        id: INTENT_ID,
        provider: 'wompi',
        idempotency_key: 'idem-1',
        canonical_reference: `order:${ENTITY}`,
        contact_id: CONTACT,
        amount_cents: '250000',
        currency: 'COP',
        description: 'Pago de pedido',
        resource_snapshot: {},
        provider_link_id: 'link-1',
        checkout_url: 'https://checkout.wompi.co/l/link-1',
        provider_transaction_id: null,
        status: 'pending',
        expires_at: '2026-08-17T12:00:00.000Z',
        paid_at: null,
        last_error: null,
        ...overrides,
    };
}

function harness(input: {
    intent?: Record<string, unknown>;
    domain?: Record<string, unknown>;
    duplicate?: boolean;
    transitionedIntent?: Record<string, unknown> | null;
} = {}) {
    const row = intentRow(input.intent);
    const domain = {
        amount: '2500.00',
        currency: 'COP',
        contact_id: CONTACT,
        payment_status: 'pending',
        status: 'open',
        ...input.domain,
    };
    const query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT * FROM tenant_payment_intents')) return [row];
        if (sql.includes(' AS amount,')) return [domain];
        if (sql.includes('INSERT INTO tenant_payment_attempts')) {
            return input.duplicate ? [] : [{ id: 'attempt-1' }];
        }
        if (sql.includes("SET status = CASE WHEN status = 'refunded'")) {
            return [{ ...row, status: 'requires_review' }];
        }
        if (sql.includes('SET provider_transaction_id = $2')) {
            return [{ ...row, provider_transaction_id: 'transaction-1' }];
        }
        if (sql.includes('UPDATE tenant_payment_intents') && sql.includes('SET status = $2')) {
            if (input.transitionedIntent === null) return [];
            return [input.transitionedIntent || {
                ...row,
                status: 'paid',
                provider_transaction_id: 'transaction-1',
                paid_at: '2026-08-16T12:00:00.000Z',
            }];
        }
        return [];
    });
    const prisma = {
        getTenantSchemaName: jest.fn(),
        executeInTenantSchema: jest.fn(),
        transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
    };
    const store = new TenantPaymentStoreService(prisma as any);
    jest.spyOn(store, 'ensureForTenant').mockResolvedValue('tenant_schema');
    return { store, prisma, query, row };
}

function transaction(status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR', overrides = {}) {
    return {
        id: 'transaction-1',
        status,
        amountCents: 250_000,
        currency: 'COP',
        paymentLinkId: 'link-1',
        environment: 'production',
        ...overrides,
    } as const;
}

describe('TenantPaymentStoreService credential history', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([
        [true, true],
        [false, false],
    ])('reports whether provider-bound history exists (%s)', async (present, expected) => {
        const prisma = {
            getTenantSchemaName: jest.fn(),
            executeInTenantSchema: jest.fn().mockResolvedValue([{ present }]),
        };
        const store = new TenantPaymentStoreService(prisma as any);
        jest.spyOn(store, 'ensureForTenant').mockResolvedValue('tenant_schema');

        await expect(store.hasCredentialBoundHistoryForProvider(TENANT, 'wompi'))
            .resolves.toBe(expected);
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_schema',
            expect.stringContaining('provider_link_id IS NOT NULL'),
            ['wompi'],
        );
    });
});

describe('TenantPaymentStoreService Wompi settlement', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each(['DECLINED', 'ERROR'] as const)(
        'records a %s attempt but keeps the reusable hosted link unresolved',
        async status => {
            const { store, query } = harness();

            const result = await store.settleWompiTransaction({
                tenantId: TENANT,
                transaction: transaction(status),
                eventKey: EVENT_KEY,
                source: 'webhook',
            });

            expect(result).toMatchObject({
                status: 'pending',
                transitioned: false,
                duplicate: false,
            });
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO tenant_payment_attempts'),
                expect.arrayContaining([status, 'failed']),
            );
            expect(query.mock.calls.some(([sql]) => String(sql).includes('SET status = $2'))).toBe(false);
        },
    );

    it('persists PENDING transaction evidence without marking the purchase paid', async () => {
        const { store, query } = harness();

        const result = await store.settleWompiTransaction({
            tenantId: TENANT,
            transaction: transaction('PENDING'),
            eventKey: EVENT_KEY,
            source: 'webhook',
        });

        expect(result).toMatchObject({ status: 'pending', transitioned: false });
        expect(query.mock.calls.some(([sql]) => String(sql).includes('SET provider_transaction_id = $2'))).toBe(true);
        expect(query.mock.calls.some(([sql]) => String(sql).includes('SET payment_status = $2'))).toBe(false);
    });

    it('atomically settles an exact APPROVED transaction and purchase once', async () => {
        const { store, query } = harness();

        const result = await store.settleWompiTransaction({
            tenantId: TENANT,
            transaction: transaction('APPROVED'),
            eventKey: EVENT_KEY,
            source: 'webhook',
        });

        expect(result).toMatchObject({ status: 'paid', transitioned: true, duplicate: false });
        expect(query.mock.calls.some(([sql]) => String(sql).includes('SET payment_status = $2'))).toBe(true);
        expect(query.mock.calls.some(([sql]) => String(sql).includes('SET status = $2'))).toBe(true);
    });

    it('marks canonical amount mismatch for review and never fulfills the purchase', async () => {
        const { store, query } = harness();

        const result = await store.settleWompiTransaction({
            tenantId: TENANT,
            transaction: transaction('APPROVED', { amountCents: 1 }),
            eventKey: EVENT_KEY,
            source: 'webhook',
        });

        expect(result).toMatchObject({
            status: 'requires_review',
            transitioned: true,
            validationError: 'amount_or_currency_mismatch',
        });
        expect(query.mock.calls.some(([sql]) => String(sql).includes('SET payment_status = $2'))).toBe(false);
    });

    it('turns a second distinct APPROVED transaction into review without double fulfillment', async () => {
        const { store, query } = harness({
            intent: {
                status: 'paid',
                provider_transaction_id: 'transaction-original',
                paid_at: '2026-08-16T12:00:00.000Z',
            },
            domain: { payment_status: 'paid' },
        });

        const result = await store.settleWompiTransaction({
            tenantId: TENANT,
            transaction: transaction('APPROVED', { id: 'transaction-second' }),
            eventKey: EVENT_KEY,
            source: 'webhook',
        });

        expect(result.status).toBe('requires_review');
        expect(result.validationError).toMatch(/payable_already_settled_elsewhere|multiple_approved_transactions/);
        expect(query.mock.calls.some(([sql]) => String(sql).includes('SET payment_status = $2'))).toBe(false);
    });

    it('treats a repeated event key as durable duplicate and performs no transition', async () => {
        const { store, query } = harness({ duplicate: true });

        const result = await store.settleWompiTransaction({
            tenantId: TENANT,
            transaction: transaction('APPROVED'),
            eventKey: EVENT_KEY,
            source: 'webhook',
        });

        expect(result).toMatchObject({ status: 'pending', transitioned: false, duplicate: true });
        expect(query.mock.calls.some(([sql]) => String(sql).includes('SET payment_status = $2'))).toBe(false);
    });

    it('does not roll a prior VOIDED/refunded settlement back on a late APPROVED delivery', async () => {
        const { store } = harness({
            intent: {
                status: 'refunded',
                provider_transaction_id: 'transaction-1',
                paid_at: '2026-08-16T12:00:00.000Z',
            },
            domain: { payment_status: 'refunded' },
            transitionedIntent: null,
        });

        const result = await store.settleWompiTransaction({
            tenantId: TENANT,
            transaction: transaction('APPROVED'),
            eventKey: EVENT_KEY,
            source: 'webhook',
        });

        expect(result).toMatchObject({ status: 'refunded', transitioned: false });
    });
});

describe('TenantPaymentStoreService creation recovery', () => {
    afterEach(() => jest.restoreAllMocks());

    it('reopens the same idempotency key only after a proven pre-side-effect failure', async () => {
        const failed = intentRow({
            status: 'failed',
            provider_link_id: null,
            checkout_url: null,
            provider_transaction_id: null,
            last_error: 'tenant_payment_provider_busy_before_submission',
        });
        const reopened = {
            ...failed,
            status: 'pending',
            expires_at: '2026-08-18T12:00:00.000Z',
            last_error: null,
        };
        const query = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([failed])
            .mockResolvedValueOnce([reopened]);
        const prisma = {
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const store = new TenantPaymentStoreService(prisma as any);
        jest.spyOn(store, 'ensureForTenant').mockResolvedValue('tenant_schema');

        const result = await store.createOrGetIntent({
            tenantId: TENANT,
            provider: 'wompi',
            idempotencyKey: 'idem-1',
            canonicalReference: `order:${ENTITY}`,
            contactId: CONTACT,
            amountCents: 250_000,
            currency: 'COP',
            description: 'Pago de pedido',
            resourceSnapshot: { revision: 4 },
            expiresAt: new Date('2026-08-18T12:00:00.000Z'),
        });

        expect(result).toMatchObject({ created: true, intent: { status: 'pending' } });
        expect(query).toHaveBeenNthCalledWith(
            3,
            expect.stringContaining("AND status = 'failed'"),
            [
                INTENT_ID,
                JSON.stringify({ revision: 4 }),
                '2026-08-18T12:00:00.000Z',
            ],
        );
    });

    it('never reopens a failed-looking row that already has a provider link id', async () => {
        const failedWithSideEffect = intentRow({
            status: 'failed',
            provider_link_id: 'provider-link-present',
        });
        const query = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([failedWithSideEffect]);
        const prisma = {
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const store = new TenantPaymentStoreService(prisma as any);
        jest.spyOn(store, 'ensureForTenant').mockResolvedValue('tenant_schema');

        const result = await store.createOrGetIntent({
            tenantId: TENANT,
            provider: 'wompi',
            idempotencyKey: 'idem-1',
            canonicalReference: `order:${ENTITY}`,
            contactId: CONTACT,
            amountCents: 250_000,
            currency: 'COP',
            description: 'Pago de pedido',
            resourceSnapshot: {},
        });

        expect(result).toMatchObject({ created: false, intent: { status: 'failed' } });
        expect(query).toHaveBeenCalledTimes(2);
    });
});
