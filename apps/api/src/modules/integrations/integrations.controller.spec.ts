import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { IntegrationsController } from './integrations.controller';

describe('IntegrationsController tenant boundary', () => {
    const guards = (method: keyof IntegrationsController): unknown[] => (
        Reflect.getMetadata(GUARDS_METADATA, IntegrationsController.prototype[method]) || []
    );

    it('requires an explicit, validated tenant for outbox review', () => {
        expect(guards('outboxReview')).toContain(TenantGuard);
    });

    it('does not invent a tenant context for the platform-wide rail status', () => {
        expect(guards('rail')).not.toContain(TenantGuard);
    });

    it('keeps the global outbox review platform-wide and payload-free', async () => {
        expect(guards('outboxOverview')).not.toContain(TenantGuard);

        const review = jest.fn().mockResolvedValue({
            byStatus: { dead: 1 },
            attention: [{ provider: 'hostaway', status: 'dead', lastError: 'timeout' }],
        });
        const controller = new IntegrationsController(
            {} as any,
            {
                trackedTenants: jest.fn().mockResolvedValue([
                    { id: '11111111-1111-4111-8111-111111111111', schemaName: 'tenant_one', name: 'One' },
                ]),
                review,
            } as any,
            {} as any,
        );

        const result = await controller.outboxOverview();

        expect(review).toHaveBeenCalledWith('tenant_one');
        expect(result).toEqual({ tenants: [{
            tenantId: '11111111-1111-4111-8111-111111111111',
            tenantName: 'One',
            byStatus: { dead: 1 },
            attention: [{ provider: 'hostaway', status: 'dead', lastError: 'timeout' }],
        }] });
        expect(JSON.stringify(result)).not.toContain('payload');
    });
});
