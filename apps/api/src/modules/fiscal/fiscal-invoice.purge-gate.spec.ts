import { FiscalInvoiceService } from './fiscal-invoice.service';

describe('FiscalInvoiceService purge gate', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function makeHarness(fence: string | null, purgeStartedAt: string | null) {
        const tx = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{
                purge_started_at: purgeStartedAt,
            }]),
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (client: any) => unknown) => callback(tx)),
        };
        const redis = { get: jest.fn().mockResolvedValue(fence) };
        const service = new FiscalInvoiceService(
            prisma as any,
            {} as any,
            {} as any,
            {} as any,
            redis as any,
        );
        return { service, prisma, redis, tx };
    }

    it('does not open a DB creation transaction while the hot purge fence exists', async () => {
        const h = makeHarness('1', null);
        const work = jest.fn();

        await expect((h.service as any).withTenantPurgeGate(tenantId, work)).resolves.toBeNull();

        expect(h.prisma.$transaction).not.toHaveBeenCalled();
        expect(work).not.toHaveBeenCalled();
    });

    it('rejects creation under the durable purge checkpoint even if Redis was unavailable earlier', async () => {
        const h = makeHarness(null, '2026-08-08T00:00:00.000Z');
        const work = jest.fn();

        await expect((h.service as any).withTenantPurgeGate(tenantId, work)).resolves.toBeNull();

        expect(work).not.toHaveBeenCalled();
        expect(String(h.tx.$queryRawUnsafe.mock.calls[0][0])).toContain('FOR SHARE');
        expect(h.tx.$queryRawUnsafe).toHaveBeenCalledWith(expect.any(String), tenantId);
    });

    it('holds the shared tenant-row lock while the fiscal write commits', async () => {
        const h = makeHarness(null, null);
        const work = jest.fn().mockResolvedValue({ id: 'invoice-1' });

        await expect((h.service as any).withTenantPurgeGate(tenantId, work))
            .resolves.toEqual({ id: 'invoice-1' });

        expect(work).toHaveBeenCalledWith(h.tx);
        expect(String(h.tx.$queryRawUnsafe.mock.calls[0][0])).toContain('FOR SHARE');
    });
});
