import { FiscalAdminController } from './fiscal-admin.controller';

/**
 * "Re-emitir" resetea la fila a 'pending' y RECIÉN AHÍ llama a `requeue`, así
 * que el guard de estado de `requeue` llega tarde: ve la fila ya limpia y la
 * deja pasar. En una factura anulada esa era, además, la única acción que el
 * panel ofrecía — un clic gastaba el consecutivo DIAN que se acababa de
 * decidir no gastar.
 */
describe('FiscalAdminController — re-emitir no puede resucitar una decisión', () => {
    function makeController(invoice: any) {
        const prisma = {
            fiscalInvoice: {
                findUnique: jest.fn().mockResolvedValue(invoice),
                update: jest.fn().mockResolvedValue({}),
            },
        };
        const fiscalService = { requeue: jest.fn().mockResolvedValue(true) };
        const factus = { deleteByReference: jest.fn().mockResolvedValue(undefined) };
        const controller = new FiscalAdminController(
            {} as any, prisma as any, fiscalService as any, factus as any, {} as any,
        );
        return { controller, prisma, fiscalService, factus };
    }

    const base = {
        id: 'fi-1', tenantId: 't-1', provider: 'factus',
        cufe: null, invoiceNumber: null, status: 'failed',
    };

    it('rechaza re-emitir una anulada, sin tocar Factus ni la fila', async () => {
        const h = makeController({ ...base, status: 'cancelled' });

        await expect(h.controller.reissueInvoice('fi-1')).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'deliberately_not_issued' }),
        });
        expect(h.factus.deleteByReference).not.toHaveBeenCalled();
        expect(h.prisma.fiscalInvoice.update).not.toHaveBeenCalled();
        expect(h.fiscalService.requeue).not.toHaveBeenCalled();
    });

    it('rechaza re-emitir una omitida por no ser una venta', async () => {
        const h = makeController({ ...base, status: 'skipped' });

        await expect(h.controller.reissueInvoice('fi-1')).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'deliberately_not_issued' }),
        });
        expect(h.fiscalService.requeue).not.toHaveBeenCalled();
    });

    it('sigue rechazando una ya validada por la DIAN', async () => {
        const h = makeController({ ...base, cufe: 'abc123', status: 'issued' });

        await expect(h.controller.reissueInvoice('fi-1')).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'already_validated' }),
        });
    });

    it('sigue re-emitiendo una que falló de verdad', async () => {
        const h = makeController({ ...base, status: 'failed' });

        await expect(h.controller.reissueInvoice('fi-1')).resolves.toEqual({ success: true });
        expect(h.factus.deleteByReference).toHaveBeenCalledWith('fi-1');
        expect(h.fiscalService.requeue).toHaveBeenCalledWith('fi-1');
    });
});
