import { BadRequestException } from '@nestjs/common';
import { ProceduresService } from './procedures.service';

function harness() {
    const prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_test'), executeInTenantSchema: jest.fn().mockResolvedValue([
        { id: 'procedure', name: 'Photo', trigger: {}, steps: [], status: 'draft', version: 1 },
    ]) };
    const redis = { get: jest.fn().mockResolvedValue(true), del: jest.fn().mockResolvedValue(undefined) };
    const router = { execute: jest.fn() };
    const service = new ProceduresService(prisma as any, redis as any, router as any);
    return { service, prisma, redis, router };
}

describe('Unsupported procedure field types must not become unverified strings', () => {
    it.each(['image', 'attachment', 'file'])('rejects explicit %s collection before schema access or writes', async fieldType => {
        const h = harness();
        await expect(h.service.create('tenant', { name: 'Photo', steps: [
            { id: 'photo', type: 'ask', config: { field: 'photo', fieldType, required: true } },
        ] as any })).rejects.toBeInstanceOf(BadRequestException);
        expect(h.prisma.getTenantSchemaName).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(h.redis.del).not.toHaveBeenCalled();
    });

    it('rejects unsupported tool slot types on update before touching the existing procedure', async () => {
        const h = harness();
        await expect(h.service.update('tenant', 'procedure', { steps: [
            { id: 'send', type: 'tool', config: { tool: 'get_order_status', slots: { proof: { type: 'image', required: true } } } },
        ] as any })).rejects.toBeInstanceOf(BadRequestException);
        expect(h.prisma.getTenantSchemaName).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('does not save a compiler response that invents image field support', async () => {
        const h = harness();
        h.router.execute.mockResolvedValue({ content: JSON.stringify({ name: 'Photo', steps: [
            { id: 'photo', type: 'ask', config: { field: 'photo', fieldType: 'image' } },
        ] }) });
        await expect(h.service.compile('tenant', 'Collect a required image')).rejects.toBeInstanceOf(BadRequestException);
        expect(h.router.execute).toHaveBeenCalledTimes(1);
        expect(h.prisma.getTenantSchemaName).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('preserves supported email validation and omitted legacy field types', async () => {
        const h = harness();
        h.prisma.executeInTenantSchema.mockImplementation(async (_s, _sql, params) => [{
            id: 'procedure', name: params[0], trigger: JSON.parse(params[2]), steps: JSON.parse(params[3]), status: 'draft', version: 1,
        }]);
        const result = await h.service.create('tenant', { name: 'Details', steps: [
            { id: 'email', type: 'ask', config: { field: 'email', fieldType: 'email', required: true } },
            { id: 'reason', type: 'ask', config: { field: 'reason' } },
        ] });
        expect(result.steps[0].config).toMatchObject({ fieldType: 'email', required: true });
        expect(result.steps[1].config.fieldType).toBeUndefined();
    });
});
