import { listVerticalCapabilityConfigurations } from '@parallext/shared';
import { READINESS, VerticalReadinessService } from './vertical-readiness.service';

describe('vertical readiness executable contract', () => {
    it('implements every declared readiness key except the provisioned pipeline', () => {
        const declared = new Set(listVerticalCapabilityConfigurations()
            .flatMap(configuration => configuration.readiness.requirements));
        const missing = [...declared]
            .filter(key => key !== 'pipeline')
            .filter(key => !READINESS[key]);
        expect(missing).toEqual([]);
    });

    it('backs professional cases with the same open opportunities shown by Cases', () => {
        expect(READINESS.professional_cases).toMatchObject({
            table: 'opportunities',
            where: 'won_at IS NULL AND lost_at IS NULL',
            repairRoute: '/admin/cases',
        });
    });

    it('sends agenda-less and dispatch profiles to the direct service catalogue', () => {
        for (const key of ['service_catalog', 'photo_sessions', 'boarding_capacity'] as const) {
            expect(READINESS[key]?.repairRoute).toBe('/admin/service-catalog');
        }
    });

    it('executes the professional-case predicate instead of silently skipping it', async () => {
        const prisma = {
            executeInTenantSchema: jest.fn().mockResolvedValue([{ total: 1 }]),
        };
        const redis = {
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
        };
        const service = new VerticalReadinessService(prisma as any, redis as any);

        const report = await service.evaluate(
            '11111111-1111-4111-8111-111111111111',
            'tenant_professional',
            ['professional_cases'],
        );

        expect(report).toMatchObject({
            degraded: false,
            unmet: [],
            checks: [expect.objectContaining({
                key: 'professional_cases',
                satisfied: true,
                count: 1,
                repairRoute: '/admin/cases',
            })],
        });
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_professional',
            expect.stringContaining('FROM opportunities WHERE won_at IS NULL AND lost_at IS NULL'),
        );
    });
});
