import {
    PaymentOperationService,
    PaymentProviderCallError,
    type PaymentOperationProvider,
} from './payment-operation.service';

const schemaName = 'tenant_payment_contract';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const executionLedgerId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';

function createHarness(
    provider?: PaymentOperationProvider,
    options: { denyProcessingCas?: boolean; planEnabled?: boolean } = {},
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
        if (normalized.includes("SET status = 'failed'")) {
            state.row.status = 'failed';
            state.response = JSON.parse(params[1]);
            state.row.response_payload = state.response;
            return normalized.includes('RETURNING id') ? [{ id: state.row.id }] : [];
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
    const throttle = {
        isFeatureEnabled: jest.fn().mockResolvedValue(options.planEnabled !== false),
    };
    const service = new PaymentOperationService(
        { executeInTenantSchema } as any,
        provider,
        throttle as any,
    );
    return { service, state, executeInTenantSchema, throttle };
}

async function prepareAndCreate(
    service: PaymentOperationService,
    payableReference = 'order:123',
) {
    const preparation = await service.preparePaymentLink(tenantId, contactId, { payableReference });
    if (!preparation.ok) return preparation.result;
    return service.createPaymentLink(
        schemaName,
        tenantId,
        contactId,
        executionLedgerId,
        preparation.payable,
    );
}

describe('PaymentOperationService provider-neutral contract', () => {
    it('keeps status capability after downgrade while creation remains disabled', async () => {
        const provider = {
            id: 'tenant_customer_payments',
            getRuntimeCapability: jest.fn().mockResolvedValue({
                configured: true,
                ready: true,
                statusAvailable: true,
                activeProvider: 'wompi',
            }),
            getPaymentStatus: jest.fn(),
            supports: jest.fn().mockReturnValue(true),
        } as any;
        const { service } = createHarness(provider, { planEnabled: false });

        await expect(service.getRuntimeCapability(tenantId)).resolves.toEqual({
            planEnabled: false,
            configured: true,
            ready: true,
            statusAvailable: true,
            activeProvider: 'wompi',
        });
        expect(provider.getRuntimeCapability).toHaveBeenCalledWith(tenantId);
    });

    it('fails status capability closed when the local ledger readiness check fails', async () => {
        const provider = {
            id: 'tenant_customer_payments',
            getRuntimeCapability: jest.fn().mockRejectedValue(new Error('ledger unavailable')),
            getPaymentStatus: jest.fn(),
        } as any;
        const { service } = createHarness(provider);

        await expect(service.getRuntimeCapability(tenantId)).resolves.toEqual({
            planEnabled: true,
            configured: false,
            ready: false,
            statusAvailable: false,
        });
    });

    it.each([
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
                canonicalAmountCents: 2500,
                canonicalCurrency: 'COP',
                canonicalDescription: 'Pedido #123',
                paymentStatus: 'pending',
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

        const result = await prepareAndCreate(service);

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

    it('fails payment preparation before confirmation when no provider is bound', async () => {
        const { service, executeInTenantSchema } = createHarness();

        await expect(service.preparePaymentLink(tenantId, contactId, {
            payableReference: 'order:123',
        })).resolves.toMatchObject({
            ok: false,
            result: { error: 'payment_provider_unavailable' },
        });
        expect(executeInTenantSchema).not.toHaveBeenCalled();
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

    it('uses only the canonical money snapshot and reports link-created as pending, never paid', async () => {
        const provider: PaymentOperationProvider = {
            id: 'links-only',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'order:canonical-123',
                canonicalAmountCents: 5000,
                canonicalCurrency: 'COP',
                canonicalDescription: 'Pedido canónico',
                paymentStatus: 'pending',
            }),
            createPaymentLink: jest.fn().mockResolvedValue({
                providerOperationId: 'link-123',
                url: 'https://checkout.example/link-123',
                provider: 'wompi',
                paymentStatus: 'pending',
            }),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn().mockResolvedValue({ status: 'confirmed' }),
            findByIdempotencyKey: jest.fn(),
        };
        const { service } = createHarness(provider);

        const preparation = await service.preparePaymentLink(tenantId, contactId, {
            payableReference: 'order:123',
            amountCents: 1,
            currency: 'USD',
            description: 'LLM supplied values must be ignored',
            provider: 'attacker-selected-provider',
        });
        expect(preparation.ok).toBe(true);
        if (!preparation.ok) throw new Error('expected payment preparation');
        expect(preparation.payable).toMatchObject({
            amountCents: 5000,
            currency: 'COP',
            description: 'Pedido canónico',
            confirmationSummary: expect.stringContaining('Pedido canónico'),
        });
        expect(preparation.payable.confirmationSummary).not.toContain('LLM supplied');
        expect(service.confirmationRequiredResult(preparation.payable, {
            error: 'confirmation_required',
            confirmationId: 'confirmation-1',
        })).toMatchObject({
            error: 'confirmation_required',
            paymentIntentId: preparation.payable.paymentIntentId,
            payment: {
                amountCents: 5000,
                currency: 'COP',
                description: 'Pedido canónico',
            },
            confirmationSummary: preparation.payable.confirmationSummary,
        });
        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            preparation.payable,
        );

        expect(provider.createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
            amountCents: 5000,
            currency: 'COP',
            description: 'Pedido canónico',
            canonicalReference: 'order:canonical-123',
        }));
        expect(result).toMatchObject({
            linkCreated: true,
            paymentStatus: 'pending',
            paid: false,
            provider: 'wompi',
            amountCents: 5000,
            currency: 'COP',
        });
        expect(result).not.toHaveProperty('success');
        expect(result).not.toMatchObject({ paymentStatus: 'paid' });
    });

    it('requires a new confirmation if the canonical snapshot changes before the provider write', async () => {
        const resolveOwnership = jest.fn()
            .mockResolvedValueOnce({
                owned: true,
                canonicalReference: 'order:canonical-123',
                canonicalAmountCents: 5000,
                canonicalCurrency: 'COP',
                canonicalDescription: 'Pedido canónico',
                paymentStatus: 'pending',
            })
            .mockResolvedValueOnce({
                owned: true,
                canonicalReference: 'order:canonical-123',
                canonicalAmountCents: 6000,
                canonicalCurrency: 'COP',
                canonicalDescription: 'Pedido actualizado',
                paymentStatus: 'pending',
            });
        const provider: PaymentOperationProvider = {
            id: 'tenant-payment-router',
            resolveOwnership,
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn(),
        };
        const { service, state } = createHarness(provider);
        const preparation = await service.preparePaymentLink(tenantId, contactId, {
            payableReference: 'order:123',
        });
        expect(preparation.ok).toBe(true);
        if (!preparation.ok) throw new Error('expected payment preparation');

        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            preparation.payable,
        );

        expect(result).toMatchObject({
            error: 'payment_snapshot_changed',
            requiresNewConfirmation: true,
        });
        expect(provider.createPaymentLink).not.toHaveBeenCalled();
        expect(state.row.status).toBe('failed');
    });

    it('fails closed on the runtime plan immediately before creating a link', async () => {
        const provider: PaymentOperationProvider = {
            id: 'tenant-payment-router',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'order:canonical-123',
                canonicalAmountCents: 5000,
                canonicalCurrency: 'COP',
                canonicalDescription: 'Pedido canónico',
                paymentStatus: 'pending',
            }),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn(),
        };
        const { service, state, throttle } = createHarness(provider);
        const preparation = await service.preparePaymentLink(tenantId, contactId, {
            payableReference: 'order:123',
        });
        expect(preparation.ok).toBe(true);
        if (!preparation.ok) throw new Error('expected payment preparation');
        throttle.isFeatureEnabled.mockResolvedValue(false);

        const result = await service.createPaymentLink(
            schemaName,
            tenantId,
            contactId,
            executionLedgerId,
            preparation.payable,
        );

        expect(throttle.isFeatureEnabled).toHaveBeenCalledWith(tenantId, 'customerPayments');
        expect(provider.createPaymentLink).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            error: 'customer_payments_not_in_plan',
            shouldHandoff: false,
        });
        expect(state.row.status).toBe('failed');
    });

    it('keeps authoritative status reads available after a downgrade', async () => {
        const provider: PaymentOperationProvider = {
            id: 'tenant-payment-router',
            resolveOwnership: jest.fn(),
            createPaymentLink: jest.fn(),
            getPaymentStatus: jest.fn().mockResolvedValue({
                canonicalReference: 'order:canonical-123',
                amountCents: 5000,
                currency: 'COP',
                description: 'Pedido canónico',
                paymentStatus: 'paid',
                provider: 'wompi',
                paidAt: '2026-08-16T12:00:00.000Z',
            }),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn(),
        };
        const { service, throttle } = createHarness(provider, { planEnabled: false });

        const result = await service.getPaymentStatus(tenantId, contactId, {
            payableReference: 'order:123',
        });

        expect(throttle.isFeatureEnabled).not.toHaveBeenCalled();
        expect(provider.getPaymentStatus).toHaveBeenCalledWith({
            tenantId,
            contactId,
            payableReference: 'order:123',
        });
        expect(result).toMatchObject({
            found: true,
            paymentStatus: 'paid',
            paid: true,
            provider: 'wompi',
        });
    });

    it.each(['ambiguous', 'requires_review'] as const)(
        'preserves %s as a review state instead of reporting payment_not_found',
        async (paymentStatus) => {
            const provider = {
                id: 'tenant-payment-router',
                getPaymentStatus: jest.fn().mockResolvedValue({
                    canonicalReference: 'order:canonical-123',
                    amountCents: 5000,
                    currency: 'COP',
                    description: 'Pedido canónico',
                    paymentStatus,
                    provider: 'wompi',
                }),
            } as any;
            const { service } = createHarness(provider);

            await expect(service.getPaymentStatus(tenantId, contactId, {
                payableReference: 'order:123',
            })).resolves.toMatchObject({
                found: true,
                paymentStatus,
                paid: false,
                requiresReview: true,
                shouldHandoff: true,
                message: expect.stringContaining('requiere revisión manual'),
            });
        },
    );

    it('rejects a missing payable reference before creating a ledger intent', async () => {
        const { service, executeInTenantSchema } = createHarness();

        const result = await service.preparePaymentLink(tenantId, contactId, {
            payableReference: '',
            amountCents: 12.5,
            currency: 'dollars',
        });

        expect(result).toMatchObject({ ok: false, result: { error: 'invalid_payment_request' } });
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

    it('rejects canonical snapshot drift when an execution ledger id is reused', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockImplementation(({ reference }: any) => Promise.resolve({
                owned: true,
                canonicalReference: reference,
                canonicalAmountCents: reference === 'order:changed' ? 5000 : 2500,
                canonicalCurrency: 'COP',
                canonicalDescription: reference === 'order:changed' ? 'Pedido cambiado' : 'Pedido original',
                paymentStatus: 'pending',
            })),
            createPaymentLink: jest.fn().mockResolvedValue({
                providerOperationId: 'link-1',
                url: 'https://checkout.example/link-1',
                paymentStatus: 'pending',
            }),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn().mockResolvedValue({ status: 'confirmed' }),
            findByIdempotencyKey: jest.fn(),
        };
        const { service } = createHarness(provider);
        await prepareAndCreate(service, 'order:123');

        await expect(prepareAndCreate(service, 'order:changed'))
            .rejects.toThrow('payment_operation_idempotency_conflict');
    });

    it('does not call the provider unless it acquires the requested-to-processing CAS', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'order:canonical-123',
                canonicalAmountCents: 2500,
                canonicalCurrency: 'COP',
                canonicalDescription: 'Pedido #123',
                paymentStatus: 'pending',
            }),
            createPaymentLink: jest.fn(),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        };
        const { service } = createHarness(provider, { denyProcessingCas: true });

        const result = await prepareAndCreate(service);

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
                canonicalAmountCents: 2500,
                canonicalCurrency: 'COP',
                canonicalDescription: 'Pedido #123',
                paymentStatus: 'pending',
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

        const result = await prepareAndCreate(service);

        expect(result).toMatchObject({ error: 'payment_reconciliation_required' });
        expect(provider.findByIdempotencyKey).toHaveBeenCalledWith({
            tenantId,
            kind: 'payment_link',
            idempotencyKey: operationId,
        });
        expect(state.row.provider_operation_id).toBe('provider-op-recovered');
    });

    it('records a proven provider 4xx as retry-safe and requires a fresh confirmation', async () => {
        const provider: PaymentOperationProvider = {
            id: 'stub-provider',
            resolveOwnership: jest.fn().mockResolvedValue({
                owned: true,
                canonicalReference: 'order:canonical-123',
                canonicalAmountCents: 2500,
                canonicalCurrency: 'COP',
                canonicalDescription: 'Pedido #123',
                paymentStatus: 'pending',
            }),
            createPaymentLink: jest.fn().mockRejectedValue(new PaymentProviderCallError(
                'known_no_effect',
                'wompi_link_creation_rejected',
            )),
            refundPayment: jest.fn(),
            applyDiscount: jest.fn(),
            reconcile: jest.fn(),
            findByIdempotencyKey: jest.fn(),
        };
        const { service, state } = createHarness(provider);

        const result = await prepareAndCreate(service);

        expect(result).toMatchObject({
            error: 'payment_provider_rejected',
            providerErrorCode: 'wompi_link_creation_rejected',
            requiresNewConfirmation: true,
            shouldHandoff: false,
        });
        expect(state.row.status).toBe('failed');
        expect(provider.findByIdempotencyKey).not.toHaveBeenCalled();
    });

    it.each(['timeout', '5xx'] as const)(
        'keeps a %s provider outcome fail-closed for reconciliation',
        async failureKind => {
            const provider: PaymentOperationProvider = {
                id: 'stub-provider',
                resolveOwnership: jest.fn().mockResolvedValue({
                    owned: true,
                    canonicalReference: 'order:canonical-123',
                    canonicalAmountCents: 2500,
                    canonicalCurrency: 'COP',
                    canonicalDescription: 'Pedido #123',
                    paymentStatus: 'pending',
                }),
                createPaymentLink: jest.fn().mockRejectedValue(new PaymentProviderCallError(
                    'unknown',
                    failureKind === 'timeout'
                        ? 'wompi_link_creation_outcome_unknown'
                        : 'payment_provider_5xx',
                )),
                refundPayment: jest.fn(),
                applyDiscount: jest.fn(),
                reconcile: jest.fn(),
                findByIdempotencyKey: jest.fn().mockResolvedValue(null),
            };
            const { service, state } = createHarness(provider);

            const result = await prepareAndCreate(service);

            expect(result).toMatchObject({
                error: 'payment_reconciliation_required',
                shouldHandoff: true,
            });
            expect(state.row.status).toBe('reconciliation_required');
            expect(provider.findByIdempotencyKey).toHaveBeenCalled();
        },
    );

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

        const result = await service.preparePaymentLink(tenantId, contactId, {
            payableReference: 'alias',
        });

        expect(result).toMatchObject({ ok: false, result: { error: 'payment_ownership_unverified' } });
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
