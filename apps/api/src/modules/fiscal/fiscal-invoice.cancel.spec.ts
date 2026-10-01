import { FiscalInvoiceService } from './fiscal-invoice.service';

/**
 * Una factura en 'pending' todavía no gastó consecutivo, pero cualquiera puede
 * gastarlo tocando "Reintentar". Apareció en producción: cobros de prueba de
 * MercadoPago dejaron facturas pendientes y no había forma de bajarlas.
 *
 * El límite es la DIAN: antes del CUFE/número esto es un cambio de estado;
 * después, el documento existe y anularlo es una nota crédito.
 */
describe('FiscalInvoiceService — anular antes de consumir consecutivo', () => {
    function makeHarness(invoice: any) {
        const prisma = {
            fiscalInvoice: {
                findUnique: jest.fn().mockResolvedValue(invoice),
                update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...invoice, ...data })),
            },
            $transaction: jest.fn().mockImplementation(async (cb: (c: any) => unknown) => cb({
                $queryRawUnsafe: jest.fn().mockResolvedValue([{ purge_started_at: null }]),
                fiscalInvoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            })),
        };
        const queue = { add: jest.fn().mockResolvedValue(undefined) };
        const redis = {
            get: jest.fn().mockResolvedValue(null),
            acquireLockToken: jest.fn().mockResolvedValue('cancel-token'),
            releaseLockToken: jest.fn().mockResolvedValue(true),
        };
        const service = new FiscalInvoiceService(
            prisma as any, {} as any, {} as any, queue as any, redis as any,
        );
        return { service, prisma, queue, redis };
    }

    const pending = {
        id: 'fi-1', tenantId: 't-1', status: 'pending', type: 'invoice',
        cufe: null, invoiceNumber: null, metadata: { skipReason: undefined },
    };

    it('anula una pendiente y deja el motivo', async () => {
        const h = makeHarness(pending);

        await expect(h.service.cancelPending('fi-1', 'cobro de prueba de MercadoPago'))
            .resolves.toEqual({ ok: true });

        const [[call]] = h.prisma.fiscalInvoice.update.mock.calls;
        expect(call.data.status).toBe('cancelled');
        expect(call.data.metadata.cancelReason).toBe('cobro de prueba de MercadoPago');
    });

    it('se niega si ya tiene número: eso ya es un documento ante la DIAN', async () => {
        const h = makeHarness({ ...pending, invoiceNumber: 'SETP990010633', status: 'issued' });

        await expect(h.service.cancelPending('fi-1', 'motivo'))
            .resolves.toEqual({ ok: false, error: 'already_issued' });
        expect(h.prisma.fiscalInvoice.update).not.toHaveBeenCalled();
    });

    it('se niega si tiene CUFE aunque el estado local diga otra cosa', async () => {
        // El estado local puede ir atrás del proveedor; el CUFE no miente.
        const h = makeHarness({ ...pending, cufe: 'abc123', status: 'pending' });

        await expect(h.service.cancelPending('fi-1', 'motivo'))
            .resolves.toEqual({ ok: false, error: 'already_issued' });
    });

    it.each([{ attempts: 1 }, { providerRef: 'accepted-remote-reference' }])('preserves reconciliation after an ambiguous provider attempt: %j', async fields => {
        const h = makeHarness({ ...pending, ...fields });
        await expect(h.service.cancelPending('fi-1', 'not a sale')).resolves.toEqual({ ok: false, error: 'issuance_outcome_unknown' });
        expect(h.prisma.fiscalInvoice.update).not.toHaveBeenCalled();
    });

    it('reintentar NO puede resucitar una anulada', async () => {
        const h = makeHarness({ ...pending, status: 'cancelled' });

        await expect(h.service.requeue('fi-1')).resolves.toBe(false);
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('reintentar tampoco resucita una omitida por no ser venta', async () => {
        const h = makeHarness({ ...pending, status: 'skipped' });

        await expect(h.service.requeue('fi-1')).resolves.toBe(false);
        expect(h.queue.add).not.toHaveBeenCalled();
    });

    it('reintentar sigue funcionando para una que falló de verdad', async () => {
        const h = makeHarness({ ...pending, status: 'failed' });

        await expect(h.service.requeue('fi-1')).resolves.toBe(true);
        expect(h.queue.add).toHaveBeenCalled();
    });

    it.each(['busy', 'unavailable'])('does not cancel while issuance is %s', async (state) => {
        const h = makeHarness(pending);
        if (state === 'busy') h.redis.acquireLockToken.mockResolvedValue(null);
        else h.redis.acquireLockToken.mockRejectedValue(new Error('Redis unavailable'));
        await expect(h.service.cancelPending('fi-1', 'internal use')).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'fiscal_issuance_in_progress' }),
        });
        expect(h.prisma.fiscalInvoice.findUnique).not.toHaveBeenCalled();
        expect(h.prisma.fiscalInvoice.update).not.toHaveBeenCalled();
    });

    it('rechecks the invoice after acquiring the same lock used by the worker', async () => {
        const h = makeHarness(pending);
        h.redis.acquireLockToken.mockImplementation(async () => {
            h.prisma.fiscalInvoice.findUnique.mockResolvedValue({ ...pending, invoiceNumber: 'FV1', cufe: 'validated' });
            return 'cancel-token';
        });
        await expect(h.service.cancelPending('fi-1', 'internal use')).resolves.toEqual({ ok: false, error: 'already_issued' });
        expect(h.redis.acquireLockToken).toHaveBeenCalledWith('lock:fiscal:issue:fi-1', 1800);
        expect(h.redis.releaseLockToken).toHaveBeenCalledWith('lock:fiscal:issue:fi-1', 'cancel-token');
        expect(h.prisma.fiscalInvoice.update).not.toHaveBeenCalled();
    });

    it('does not resurrect a cancellation that wins a concurrent retry', async () => {
        const h = makeHarness({ ...pending, status: 'failed' });
        h.prisma.$transaction.mockImplementation(async (cb: any) => cb({
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ purge_started_at: null }]),
            fiscalInvoice: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        }));
        await expect(h.service.requeue('fi-1')).resolves.toBe(false);
        expect(h.queue.add).not.toHaveBeenCalled();
    });
});
