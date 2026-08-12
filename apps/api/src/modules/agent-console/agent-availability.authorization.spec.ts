import { NotFoundException } from '@nestjs/common';
import { AgentAvailabilityService } from './agent-availability.service';

describe('AgentAvailabilityService tenant-scoped status updates', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const userId = '33333333-3333-4333-8333-333333333333';

    function makeService(count: number) {
        const prisma = { user: { updateMany: jest.fn().mockResolvedValue({ count }) } };
        const service = new AgentAvailabilityService(
            prisma as any, {} as any, {} as any, {} as any,
        );
        return { service, prisma };
    }

    it('updates only the active Inbox member in the authenticated tenant', async () => {
        const h = makeService(1);

        await h.service.updateStatus(tenantId, userId, 'busy');

        expect(h.prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: userId,
                tenantId,
                isActive: true,
                role: { in: ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] },
            },
            data: expect.objectContaining({ availabilityStatus: 'busy' }),
        }));
    });

    it('fails closed when the target is not a member of that tenant', async () => {
        const h = makeService(0);

        await expect(h.service.updateStatus(tenantId, userId, 'online'))
            .rejects.toBeInstanceOf(NotFoundException);
    });
});
