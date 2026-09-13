import { ComplianceService } from './compliance.service';

describe('ComplianceService opt-out suppression', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const leadId = '22222222-2222-4222-8222-222222222222';

    function harness() {
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: 'record-1', lead_id: leadId, phone: '+573001112233' }])
            .mockResolvedValueOnce([]);
        const prisma = {
            $queryRaw: jest.fn(async () => [{ schema_name: 'tenant_test' }]),
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(query)),
            executeInTenantSchema: jest.fn(async () => [{ one: 1 }]),
        };
        const redis = { get: jest.fn(async () => null), set: jest.fn(async () => undefined), del: jest.fn(async () => undefined) };
        const wsRelay = { publish: jest.fn() };
        const service = new ComplianceService(prisma as any, redis as any, wsRelay as any);
        return { service, prisma, query, redis, wsRelay };
    }

    it('blocks a detected request immediately and notifies the tenant room', async () => {
        const h = harness();
        const result = await h.service.processOptOut(tenantId, {
            leadId, phone: '+573001112233', channel: 'whatsapp',
            triggerMessage: 'no me escriban más', detectedFrom: 'keyword',
        });

        expect(result).toMatchObject({ id: 'record-1' });
        expect(h.query.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
        expect(h.query.mock.calls[1][0]).toContain('SET opted_out = true');
        expect(h.redis.set).toHaveBeenCalledWith(`optout:${tenantId}:+573001112233`, '1', 30 * 86400);
        expect(h.redis.set).toHaveBeenCalledWith(`optout:${tenantId}:${leadId}`, '1', 30 * 86400);
        expect(h.wsRelay.publish).toHaveBeenCalledWith('inbox', expect.objectContaining({
            room: tenantId, event: 'optout.detected',
        }));
    });

    it('treats pending as suppressed and rejected as the only release state', async () => {
        const h = harness();
        await expect(h.service.isBlocked(tenantId, '+573001112233')).resolves.toBe(true);
        expect((h.prisma.executeInTenantSchema as jest.Mock).mock.calls[0][1])
            .toContain("status IN ('pending', 'confirmed')");
    });

    it('clears both cached identities when a reviewer rejects a false positive', async () => {
        const h = harness();
        h.query
            .mockReset()
            .mockResolvedValueOnce([{ lead_id: leadId, phone: '+573001112233' }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        await h.service.rejectOptOut(tenantId, '33333333-3333-4333-8333-333333333333', leadId, 'false positive');

        expect(h.query.mock.calls[2][0]).toContain('SET opted_out = false');
        expect(h.redis.del).toHaveBeenCalledWith(`optout:${tenantId}:+573001112233`);
        expect(h.redis.del).toHaveBeenCalledWith(`optout:${tenantId}:${leadId}`);
    });
});
