import { FiscalInvoiceService } from './fiscal-invoice.service';
import { FiscalProviderFactory } from './fiscal-provider.factory';

/**
 * Un consecutivo DIAN es finito y se paga, y una factura de venta AFIRMA que
 * hubo una venta. Estas pruebas cubren los tres casos donde no la hubo.
 *
 * El que motivó todo: Wompi quedó en sandbox y Factus pasó a producción, así
 * que cobros de prueba —plata que no existió— estaban emitiendo facturas
 * reales. Los dos rieles se configuran por separado y nada los comparaba.
 */
describe('FiscalInvoiceService — pagos que NO son una venta', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function makeHarness(opts: {
        isInternal?: boolean;
        amountCents?: number;
        railEnvironment?: string;
        tenantInternalAtPayment?: boolean;
        fiscalMode?: 'CO_LOCAL' | 'US_REMOTE';
        providerName?: 'factus' | 'us_remote';
        useActualReadiness?: boolean;
        billingCountry?: string;
        billingCountryAtPayment?: string | null;
        paymentProvider?: string;
        usIssuer?: { legalName: string; taxId: string };
    } = {}) {
        const created: any[] = [];
        const tx = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ purge_started_at: null }]),
            fiscalInvoice: {
                create: jest.fn().mockImplementation(async ({ data }: any) => {
                    created.push(data);
                    return { id: 'fi-1', ...data };
                }),
            },
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (cb: (c: any) => unknown) => cb(tx)),
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    billingCountry: opts.billingCountry ?? 'CO',
                    settings: {},
                    isInternal: opts.isInternal ?? false,
                }),
            },
            billingPayment: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'pay-1',
                    amountCents: opts.amountCents ?? 120_000,
                    currency: 'COP',
                    provider: opts.paymentProvider ?? 'wompi',
                    metadata: {
                        ...(opts.billingCountryAtPayment === undefined ? {} : {
                            billingCountryAtPayment: opts.billingCountryAtPayment,
                        }),
                        ...(opts.railEnvironment ? { railEnvironment: opts.railEnvironment } : {}),
                        ...(opts.tenantInternalAtPayment === undefined
                            ? {}
                            : { tenantInternalAtPayment: opts.tenantInternalAtPayment }),
                    },
                }),
            },
            fiscalInvoice: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        const config = { getConfig: jest.fn().mockResolvedValue({ mode: opts.fiscalMode ?? 'CO_LOCAL', usIssuer: opts.usIssuer }) };
        const actualFactory = new FiscalProviderFactory({ name: 'factus' } as any, { name: 'us_remote' } as any);
        const factory = { resolve: jest.fn().mockImplementation((mode, country, rail) => opts.providerName
            ? { name: opts.providerName } : actualFactory.resolve(mode, country, rail)) };
        const queue = { add: jest.fn().mockResolvedValue(undefined) };
        const redis = { get: jest.fn().mockResolvedValue(null) };

        const service = new FiscalInvoiceService(
            prisma as any, config as any, factory as any, queue as any, redis as any,
        );
        // Factus configurado y en producción: sin esto, el corte podría venir de
        // la guarda de rollout y las pruebas pasarían por el motivo equivocado.
        if (!opts.useActualReadiness) {
            jest.spyOn(service as any, 'isProviderReady').mockImplementation(
                (_provider: string, _cfg: unknown, railEnvironment?: string) => railEnvironment === 'production',
            );
        }
        return { service, prisma, queue, created, factory };
    }

    const event = {
        tenantId,
        event: { provider: 'wompi', payment: { providerPaymentId: 'wompi-tx-1' } },
    };

    it('no factura un cobro hecho en sandbox, aunque Factus esté en producción', async () => {
        const h = makeHarness({ railEnvironment: 'sandbox' });

        await h.service.onPaymentSucceeded(event as any);

        expect(h.created).toHaveLength(1);
        expect(h.created[0].status).toBe('skipped');
        expect(h.created[0].metadata.skipReason).toBe('test_mode_payment');
        // Lo que de verdad importa: nadie pide un consecutivo a la DIAN.
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('no factura a un tenant propio', async () => {
        const h = makeHarness({ isInternal: true, railEnvironment: 'production' });

        await h.service.onPaymentSucceeded(event as any);

        expect(h.created[0].metadata.skipReason).toBe('tenant_internal_use');
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('no factura un cobro de cero: sin contraprestación no hay venta', async () => {
        const h = makeHarness({ amountCents: 0, railEnvironment: 'production' });

        await h.service.onPaymentSucceeded(event as any);

        expect(h.created[0].metadata.skipReason).toBe('no_consideration');
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('SÍ factura un cobro real de producción — la guarda no puede tapar una venta', async () => {
        const h = makeHarness({ railEnvironment: 'production' });

        await h.service.onPaymentSucceeded(event as any);

        expect(h.created[0].status).toBe('pending');
        expect(h.created[0].metadata).toBeUndefined();
        expect(h.queue.add).toHaveBeenCalled();
    });

    it('acepta el contrato top-level emitido por el motor Wompi', async () => {
        const h = makeHarness({ railEnvironment: 'production' });

        await h.service.onPaymentSucceeded({
            tenantId,
            subscriptionId: 'sub-1',
            paymentId: 'pay-1',
            providerPaymentId: 'wompi-tx-1',
            amountCents: 120_000,
            currency: 'COP',
        } as any);

        expect(h.prisma.billingPayment.findUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'pay-1' },
        }));
        expect(h.created[0]).toMatchObject({ paymentId: 'pay-1', status: 'pending' });
        expect(h.queue.add).toHaveBeenCalled();
    });

    it('usa la clasificación interna congelada al cobrar, no el flag actual del tenant', async () => {
        const h = makeHarness({
            isInternal: true,
            tenantInternalAtPayment: false,
            railEnvironment: 'production',
        });

        await h.service.onPaymentSucceeded(event as any);

        expect(h.created[0].status).toBe('pending');
        expect(h.queue.add).toHaveBeenCalled();
    });

    it('un riel desconocido queda bloqueado hasta clasificarlo; nunca adivina el ambiente', async () => {
        // Pagos anteriores al sello, o de un proveedor que no lo declara, se
        // revisan/backfillean antes de consumir un consecutivo fiscal.
        const h = makeHarness({});

        await h.service.onPaymentSucceeded(event as any);

        expect(h.created[0].status).toBe('blocked_config');
        expect(h.created[0].metadata.blockReason).toBe('fiscal_provider_not_ready');
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('también bloquea un riel desconocido cuando la LLC remota es el emisor', async () => {
        const h = makeHarness({
            railEnvironment: 'unknown',
            fiscalMode: 'US_REMOTE',
            providerName: 'us_remote',
            useActualReadiness: true,
        });

        await h.service.onPaymentSucceeded(event as any);

        expect(h.created[0].status).toBe('blocked_config');
        expect(h.created[0].metadata.blockReason).toBe('fiscal_provider_not_ready');
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('deja la decisión registrada como fila, no sólo en el log', async () => {
        const h = makeHarness({ railEnvironment: 'sandbox' });

        await h.service.onPaymentSucceeded(event as any);

        // Misma UNIQUE(payment_id) que una factura: un pago no puede terminar
        // con un salto Y una factura, ni volver a emitirse en un replay.
        expect(h.created[0]).toMatchObject({
            tenantId,
            paymentId: 'pay-1',
            amountCents: 120_000,
            currency: 'COP',
        });
    });

    it('keeps an international Stripe payment outside Factus after a tenant changes to Colombia', async () => {
        const h = makeHarness({
            paymentProvider: 'stripe', billingCountry: 'CO', billingCountryAtPayment: 'MX',
            railEnvironment: 'production', useActualReadiness: true,
        });
        await h.service.onPaymentSucceeded(event as any);
        expect(h.factory.resolve).toHaveBeenCalledWith('CO_LOCAL', 'MX', 'stripe');
        expect(h.created[0]).toMatchObject({
            status: 'blocked_config', provider: 'us_remote',
            failureReason: 'fiscal_provider_not_ready',
        });
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('routes a Stripe payment to the configured LLC in CO_LOCAL while Colombian payments keep Factus', async () => {
        const issuer = { legalName: 'Parallext LLC', taxId: 'test-issuer' };
        const stripe = makeHarness({
            paymentProvider: 'stripe', billingCountry: 'CO', billingCountryAtPayment: 'US',
            railEnvironment: 'production', useActualReadiness: true, usIssuer: issuer,
        });
        await stripe.service.onPaymentSucceeded(event as any);
        expect(stripe.created[0]).toMatchObject({ status: 'pending', provider: 'us_remote' });
        expect(stripe.queue.add).toHaveBeenCalledTimes(1);

        const wompi = makeHarness({
            billingCountry: 'CO', billingCountryAtPayment: 'CO', railEnvironment: 'production',
        });
        await wompi.service.onPaymentSucceeded(event as any);
        expect(wompi.created[0]).toMatchObject({ status: 'pending', provider: 'factus' });
    });

    it('does not assign the LLC to a legacy non-Colombian payment from another rail', async () => {
        const h = makeHarness({
            paymentProvider: 'mercadopago', billingCountry: 'MX', billingCountryAtPayment: 'MX',
            railEnvironment: 'production', usIssuer: { legalName: 'Parallext LLC', taxId: 'test-issuer' },
        });
        await h.service.onPaymentSucceeded(event as any);
        expect(h.created[0]).toMatchObject({ status: 'blocked_config', provider: 'unresolved' });
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 'CO', 'ZZZ'])('does not guess a fiscal country for Stripe snapshot %s', async (country) => {
        const h = makeHarness({
            paymentProvider: 'stripe', billingCountry: 'CO', billingCountryAtPayment: country,
            railEnvironment: 'production',
        });
        await h.service.onPaymentSucceeded(event as any);
        expect(h.created[0].status).toBe('blocked_config');
        expect(h.factory.resolve).not.toHaveBeenCalled();
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('preserves Colombian issuance from the historical payment country', async () => {
        const h = makeHarness({
            billingCountry: 'MX', billingCountryAtPayment: 'CO', railEnvironment: 'production',
        });
        await h.service.onPaymentSucceeded(event as any);
        expect(h.created[0]).toMatchObject({ status: 'pending', provider: 'factus' });
        expect(h.queue.add).toHaveBeenCalled();
    });

    it.each([false, true])('requires an identified remote issuer (configured: %s)', async (configured) => {
        const h = makeHarness({
            paymentProvider: 'stripe', billingCountryAtPayment: 'MX',
            railEnvironment: 'production', fiscalMode: 'US_REMOTE', useActualReadiness: true,
            ...(configured ? { usIssuer: { legalName: 'Example LLC', taxId: 'test-issuer' } } : {}),
        });
        await h.service.onPaymentSucceeded(event as any);
        expect(h.created[0].status).toBe(configured ? 'pending' : 'blocked_config');
        expect(h.created[0].provider).toBe('us_remote');
        expect(h.queue.add).toHaveBeenCalledTimes(configured ? 1 : 0);
    });
});

describe('FiscalInvoiceService — reconciliación de bloqueos', () => {
    it('no deja que 200 bloqueos permanentes oculten una factura posterior ya recuperable', async () => {
        const permanent = Array.from({ length: 200 }, (_, index) => ({
            id: `blocked-${index}`,
            tenant_id: `tenant-${index}`,
            payment_id: `payment-${index}`,
            provider_payment_id: `provider-${index}`,
            billingCountry: 'CO',
            railEnvironment: 'unknown',
        }));
        const recoverable = {
            id: 'blocked-recoverable',
            tenant_id: 'tenant-recoverable',
            payment_id: 'payment-recoverable',
            provider_payment_id: 'provider-recoverable',
            billingCountry: 'CO',
            railEnvironment: 'production',
        };
        const candidates = [...permanent, recoverable];

        const queryRaw = jest.fn().mockImplementation(async (sql: string, mode?: string, factusReady?: boolean) => {
            if (sql.includes("WHERE f.status = 'blocked_config'")) {
                // Simulate PostgreSQL applying the readiness predicate before
                // LIMIT. The recoverable row was created after all 200 durable
                // unknown-environment rows, but it must still enter this batch.
                return candidates
                    .filter((row) => row.railEnvironment === 'production' && (
                        mode === 'US_REMOTE' || (
                            mode === 'CO_LOCAL'
                            && factusReady
                            && row.billingCountry === 'CO'
                        )
                    ))
                    .slice(0, 200)
                    .map(({ billingCountry: _country, railEnvironment: _environment, ...row }) => row);
            }
            // Missing-payment and refunded-payment sweeps are unrelated here.
            return [];
        });
        const prisma = {
            $queryRawUnsafe: queryRaw,
            fiscalInvoice: {
                findUnique: jest.fn().mockResolvedValue({ id: recoverable.id, status: 'pending' }),
            },
        };
        const config = {
            getConfig: jest.fn().mockResolvedValue({
                mode: 'CO_LOCAL',
                factusEnvironment: 'production',
                factusNumberingRangeId: 'range-1',
            }),
        };
        const service = new FiscalInvoiceService(
            prisma as any,
            config as any,
            { resolve: jest.fn() } as any,
            { add: jest.fn() } as any,
            {} as any,
        );
        jest.spyOn(service as any, 'isProviderReady').mockReturnValue(true);
        const retry = jest.spyOn(service, 'onPaymentSucceeded').mockResolvedValue(undefined);

        const result = await service.reconcilePaymentInvoices();

        expect(retry).toHaveBeenCalledTimes(1);
        expect(retry).toHaveBeenCalledWith({
            tenantId: recoverable.tenant_id,
            paymentId: recoverable.payment_id,
            providerPaymentId: recoverable.provider_payment_id,
        });
        expect(result.retried).toBe(1);

        const blockedQuery = queryRaw.mock.calls.find(([sql]) => String(sql).includes("WHERE f.status = 'blocked_config'"));
        expect(blockedQuery?.[0]).toContain("p.metadata->>'railEnvironment' = 'production'");
        expect(blockedQuery?.[0]).toContain("WHEN p.metadata ? 'billingCountryAtPayment'");
        expect(blockedQuery?.[0]).toContain("p.provider <> 'stripe'");
        expect(blockedQuery?.slice(1)).toEqual(['CO_LOCAL', true, true]);
    });
});
