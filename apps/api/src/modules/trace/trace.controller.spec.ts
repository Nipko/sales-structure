import { ForbiddenException } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { TraceController } from './trace.controller';

describe('TraceController authorization boundary', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const agentId = '33333333-3333-4333-8333-333333333333';

    function harness(assignedTo: string | null = agentId) {
        const trace = {
            getTrace: jest.fn().mockResolvedValue([]),
            getTurnTraces: jest.fn().mockResolvedValue([]),
        };
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_trace'),
            executeInTenantSchema: jest.fn().mockResolvedValue([{ assigned_to: assignedTo }]),
        };
        return { controller: new TraceController(trace as any, prisma as any), trace, prisma };
    }

    it('declares the only roles allowed to inspect traces', () => {
        expect(Reflect.getMetadata(ROLES_KEY, TraceController)).toEqual([
            'super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent',
        ]);
    });

    it('allows an agent only for an unassigned or self-assigned conversation', async () => {
        const mine = harness(agentId);
        await expect(mine.controller.getTrace(
            tenantId, conversationId, { user: { role: 'tenant_agent', id: agentId } }, '9999',
        )).resolves.toEqual({ success: true, data: [] });
        expect(mine.trace.getTrace).toHaveBeenCalledWith(tenantId, conversationId, 200);

        const unassigned = harness(null);
        await expect(unassigned.controller.getTurnTraces(
            tenantId, conversationId, { user: { role: 'tenant_agent', sub: agentId } }, '-10',
        )).resolves.toEqual({ success: true, data: [] });
        expect(unassigned.trace.getTurnTraces).toHaveBeenCalledWith(tenantId, conversationId, 1);
    });

    it('rejects an agent assigned to a different conversation owner', async () => {
        const h = harness('44444444-4444-4444-8444-444444444444');
        await expect(h.controller.getTrace(
            tenantId, conversationId, { user: { role: 'tenant_agent', id: agentId } }, '50',
        )).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.trace.getTrace).not.toHaveBeenCalled();
    });

    it.each(['super_admin', 'tenant_admin', 'tenant_supervisor'])(
        'lets %s inspect within the TenantGuard boundary without assignment lookup',
        async (role) => {
            const h = harness('another-agent');
            await h.controller.getTrace(tenantId, conversationId, { user: { role } }, undefined);
            expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        },
    );
});
