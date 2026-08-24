import { TenantsService } from './tenants.service';

describe('onboarding acquisition funnel', () => {
    it('counts pre-tenant self-serve signups and therefore exposes abandonment', async () => {
        const createdAt = new Date('2026-08-23T00:00:00.000Z');
        const prisma = {
            user: {
                findMany: jest.fn(async () => [
                    { id: 'abandoned', createdAt, signupSource: 'google', tenant: null },
                    {
                        id: 'onboarded', createdAt, signupSource: 'google',
                        tenant: {
                            onboardingCompletedAt: new Date('2026-08-23T01:00:00.000Z'),
                            firstChannelConnectedAt: null, firstMessageAt: null,
                            subscriptionStatus: 'trialing',
                        },
                    },
                    {
                        id: 'paid', createdAt, signupSource: 'partner',
                        tenant: {
                            onboardingCompletedAt: new Date('2026-08-23T00:30:00.000Z'),
                            firstChannelConnectedAt: new Date('2026-08-23T02:00:00.000Z'),
                            firstMessageAt: new Date('2026-08-23T03:00:00.000Z'),
                            subscriptionStatus: 'active',
                        },
                    },
                ]),
            },
        };
        const service = new TenantsService(
            prisma as any, {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, {} as any,
        );

        const result = await service.getOnboardingFunnel(new Date('2026-08-01T00:00:00.000Z'));

        expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ isSelfServeSignup: true }),
        }));
        expect(result.stages.map(stage => stage.count)).toEqual([3, 2, 1, 1, 1]);
        expect(result.stages[1].conversionFromPrev).toBe(66.7);
        expect(result.bySource.find(row => row.source === 'google')).toMatchObject({
            signups: 2, onboarded: 1,
        });
        expect(result.medianTimeToFirstChannelHours).toBe(2);
        expect(result.medianTimeToFirstMessageHours).toBe(3);
    });
});
