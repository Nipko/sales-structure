import { FiscalInvoiceService } from './fiscal-invoice.service';

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
                    billingCountry: 'CO',
                    settings: {},
                    isInternal: opts.isInternal ?? false,
                }),
            },
            billingPayment: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'pay-1',
                    amountCents: opts.amountCents ?? 120_000,
                    currency: 'COP',
                    metadata: opts.railEnvironment ? { railEnvironment: opts.railEnvironment } : {},
                }),
            },
            fiscalInvoice: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        const config = { getConfig: jest.fn().mockResolvedValue({ mode: 'CO_LOCAL' }) };
        const factory = { resolve: jest.fn().mockReturnValue({ name: 'factus' }) };
        const queue = { add: jest.fn().mockResolvedValue(undefined) };
        const redis = { get: jest.fn().mockResolvedValue(null) };

        const service = new FiscalInvoiceService(
            prisma as any, config as any, factory as any, queue as any, redis as any,
        );
        // Factus configurado y en producción: sin esto, el corte podría venir de
        // la guarda de rollout y las pruebas pasarían por el motivo equivocado.
        jest.spyOn(service as any, 'isProviderReady').mockReturnValue(true);
        return { service, prisma, queue, created };
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

    it('un riel desconocido factura igual: negarse ante la duda dejaría ventas sin documento', async () => {
        // Pagos anteriores al sello, o de un proveedor que no lo declara.
        const h = makeHarness({});

        await h.service.onPaymentSucceeded(event as any);

        expect(h.created[0].status).toBe('pending');
        expect(h.queue.add).toHaveBeenCalled();
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
});
