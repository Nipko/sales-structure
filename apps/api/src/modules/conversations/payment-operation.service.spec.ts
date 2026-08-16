import { PaymentOperationService, type PaymentOperationProvider } from './payment-operation.service';

const schemaName = 'tenant_payment_contract';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const executionLedgerId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';

function createHarness(
    provider?: PaymentOperationProvider,
    options: { denyProcessingCas?: boolean } = {},
) {
    const state: any = {
        row: null,
        response: null,
    };
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('CREATE INDEX')
            || normalized.startsWith('ALTER TABLE')
            || normalized.startsWith('DO $ddl$')) return [];
        if (normalized.startsWith('INSERT INTO payment_operation_ledger')) {
            if (state.row) return [];
            state.row = {
                id: operationId,
                execution_ledger_id: params[0],
                operation_kind: params[1],
                status: 'requested',
                provider: null,
                provider_operation_id: null,
                canonical_reference: null,
                request_hash: params[2],
                response_payload: null,
            };
            return [state.row];
        }
        if (normalized.startsWith('SELECT * FROM payment_operation_ledger')) {
            return state.row ? [state.row] : [];
        }
        if (normalized.includes("SET status = 'handoff_required'")) {
            state.row.status = 'handoff_required';
            state.response = JSON.parse(params[1]);
            state.row.response_payload = state.response;
            return [];
        }
        if (normalized.includes("SET status = 'processing'")) {
            if (options.denyProcessingCas) {
                state.row.status = 'processing';
                state.row.provider = 'other-worker';
                return [];
            }
            state.row.status = 'processing';
            state.row.provider = params[1];
            return [state.row];
        }
        if (normalized.includes('SET canonical_reference = $2')) {
            state.row.canonical_reference = params[1];
            return [{ id: state.row.id }];
        }
        if (normalized.includes("SET provider_operation_id = $2")) {
            state.row.provider_operation_id = params[1];
            state.row.response_payload = JSON.parse(params[2]);
            return [{ id: state.row.id }];
        }
        if (normalized.includes("SET status = 'reconciliation_required'")) {
            state.row.status = 'reconciliation_required';
            state.response = JSON.parse(params[2]);
            state.row.response_payload = state.response;
            state.row.provider_operation_id ||= params[3] || null;
            return [];
        }
        if (normalized.includes("SET status = 'succeeded'")) {
            state.row.status = 'succeeded';
            state.response = JSON.parse(params[2]);
            state.row.response_payload = state.response;
            return [{ id: state.row.id }];
        }
        throw new Error(`Unhandled SQL in fake: ${normalized}`);
    });
    const service = new PaymentOperationService({ executeInTenantSchema } as any, provider);
    return { service, state, executeInTenantSchema };
}

describe('PaymentOperationService provider-neutral contract', () => {
    it.each([
        ['payment_link', async (service: PaymentOperationService) => service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 2500, currency: 'USD', description: 'Deposit', externalReference: 'order:123' },
        )],
        ['refund', async (service: PaymentOperationService) => service.refundPayment(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { paymentReference: 'payment:123', amountCents: 1000, currency: 'USD', reason: 'Customer request' },
        )],
        ['discount', async (service: PaymentOperationService) => service.applyDiscount(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { percent: 10, reason: 'Retention' },
        )],
    ] as const)('records %s and hands off when no provider is bound', async (_kind, invoke) => {
        const { service, state } = createHarness();

        const result = await invoke(service);

        expect(result).toMatchObject({
            error: 'payment_provider_unavailable',
            shouldHandoff: true,
            operationId,
        });
        expect(result).not.toHaveProperty('success');
        expect(result).not.toHaveProperty('paymentLink');
        expect(state.row.status).toBe('handoff_required');
    });

    it('never reports a provider payment link as success before reconciliation confirms it', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'order:canonical-123',
            }),
            createPaymentLink: jest.fn().mockResolvedValue({
                providerOperationId: 'provider-op-1',
                url: 'https://payments.example/link/1',
            }),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn().mockResolvedValue({ status: 'pending' }),
            findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        };
        const { service, state } = createHarness(provider);

        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 2500, currency: 'USD', description: 'Deposit', externalReference: 'order:123' },
        );

        expect(result).toMatchObject({
            error: 'payment_reconciliation_required',
            shouldHandoff: true,
            operationId,
        });
        expect(result).not.toHaveProperty('success');
        expect(result).not.toHaveProperty('paymentLink');
        expect(state.row.status).toBe('reconciliation_required');
        expect(provider.reconcile).toHaveBeenCalledWith({
            tenantId,
            kind: 'payment_link',
            providerOperationId: 'provider-op-1',
        });
    });

    it('blocks a cross-contact payment reference before any provider effect', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({ owned: false }),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        };
        const { service, state } = createHarness(provider);

        const result = await service.refundPayment(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { paymentReference: 'payment:belongs-to-other-contact', currency: 'USD', reason: 'Requested' },
        );

        expect(result).toMatchObject({
            error: 'payment_ownership_unverified',
            shouldHandoff: true,
            operationId,
        });
        expect(provider.refundPayment).not.toHaveBeenCalled();
        expect(provider.reconcile).not.toHaveBeenCalled();
        expect(state.row.status).toBe('handoff_required');
    });

    it('keeps unsupported operations unavailable even when a payment-link-only provider is bound', async () => {
        const provider: PaymentOperationProvider = {
            id: 'links-only',
            supports: kind => kind === 'payment_link',
            resolveOwnership: jest.fn(),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn(),
        };
        const { service, state } = createHarness(provider);

        const result = await service.refundPayment(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { paymentReference: 'payment:123', currency: 'USD', reason: 'Requested' },
        );

        expect(result).toMatchObject({ error: 'payment_provider_unavailable', shouldHandoff: true });
        expect(provider.resolveOwnership).not.toHaveBeenCalled();
        expect(provider.refundPayment).not.toHaveBeenCalled();
        expect(state.row.status).toBe('handoff_required');
    });

    it('rejects a caller amount that differs from the owned business object', async () => {
        const provider: PaymentOperationProvider = {
            id: 'links-only',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'order:canonical-123',
                canonicalAmountCents: 5000,
                canonicalCurrency: 'COP',
            }),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn(),
        };
        const { service } = createHarness(provider);

        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 4000, currency: 'COP', description: 'Pedido', externalReference: 'order:123' },
        );

        expect(result).toMatchObject({ error: 'payment_ownership_unverified', shouldHandoff: true });
        expect(provider.createPaymentLink).not.toHaveBeenCalled();
    });

    it('rejects ambiguous money inputs before creating a ledger intent', async () => {
        const { service, executeInTenantSchema } = createHarness();

        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 12.5, currency: 'dollars', description: '', externalReference: '' },
        );

        expect(result).toMatchObject({ error: 'invalid_payment_request' });
        expect(executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('rejects overlong caller references without truncating them into another operation', async () => {
        const { service, executeInTenantSchema } = createHarness();

        const result = await service.refundPayment(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { paymentReference: `payment:${'x'.repeat(181)}`, currency: 'USD', reason: 'Requested' },
        );

        expect(result).toMatchObject({ error: 'invalid_refund_request' });
        expect(executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('rejects request drift when a direct retry reuses an execution ledger id', async () => {
        const { service } = createHarness();
        await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 2500, currency: 'USD', description: 'Deposit', externalReference: 'order:123' },
        );

        await expect(service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 5000, currency: 'USD', description: 'Changed', externalReference: 'order:123' },
        )).rejects.toThrow('payment_operation_idempotency_conflict');
    });

    it('does not call the provider unless it acquires the requested-to-processing CAS', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'order:canonical-123',
            }),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        };
        const { service } = createHarness(provider, { denyProcessingCas: true });

        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 2500, currency: 'USD', description: 'Deposit', externalReference: 'order:123' },
        );

        expect(result).toMatchObject({
            error: 'payment_operation_in_progress',
            operationId,
        });
        expect(provider.createPaymentLink).not.toHaveBeenCalled();
        expect(provider.reconcile).not.toHaveBeenCalled();
    });

    it('recovers and persists the provider receipt after an ambiguous network failure', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'order:canonical-123',
            }),
            createPaymentLink: jest.fn().mockRejectedValue(new Error('socket closed after submit')),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn().mockResolvedValue({
                providerOperationId: 'provider-op-recovered',
            }),
        };
        const { service, state } = createHarness(provider);

        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 2500, currency: 'USD', description: 'Deposit', externalReference: 'order:123' },
        );

        expect(result).toMatchObject({ error: 'payment_reconciliation_required' });
        expect(provider.findByIdempotencyKey).toHaveBeenCalledWith({
            tenantId,
            kind: 'payment_link',
            idempotencyKey: operationId,
        });
        expect(state.row.provider_operation_id).toBe('provider-op-recovered');
    });

    it('binds an owned alias to the provider canonical reference before any side effect', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'payment:canonical-789',
            }),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn().mockResolvedValue({ providerOperationId: 'refund-1' }),
            applyDiscount: jest.fn(),
            reconcile: jest.fn().mockResolvedValue({ status: 'confirmed' }),
            findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        };
        const { service, state } = createHarness(provider);

        await service.refundPayment(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            {
                paymentReference: 'customer-visible-alias',
                amountCents: 1000,
                currency: 'USD',
                reason: 'Customer request',
            },
        );

        expect(provider.refundPayment).toHaveBeenCalledWith(expect.objectContaining({
            paymentReference: 'payment:canonical-789',
        }));
        expect(state.row.canonical_reference).toBe('payment:canonical-789');
    });

    it('fails closed when ownership has no canonical reference', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({ owned: true }),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        };
        const { service } = createHarness(provider);

        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { amountCents: 2500, currency: 'USD', description: 'Deposit', externalReference: 'alias' },
        );

        expect(result).toMatchObject({ error: 'payment_ownership_unverified' });
        expect(provider.createPaymentLink).not.toHaveBeenCalled();
    });

    it('rejects an overlong canonical reference instead of mutating the authorized identifier', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: `payment:${'x'.repeat(181)}`,
            }),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        };
        const { service } = createHarness(provider);

        const result = await service.refundPayment(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            { paymentReference: 'alias', currency: 'USD', reason: 'Customer request' },
        );

        expect(result).toMatchObject({ error: 'payment_ownership_unverified' });
        expect(provider.refundPayment).not.toHaveBeenCalled();
    });
});
