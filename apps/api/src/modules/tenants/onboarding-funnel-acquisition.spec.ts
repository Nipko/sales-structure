import { TenantsService } from './tenants.service';

describe('onboarding acquisition funnel', () => {
    it('counts pre-tenant self-serve signups and therefore exposes abandonment', async () => {
        const createdAt = new Date('2026-08-23T00:00:00.000Z');
        const prisma = {
            $queryRawUnsafe: jest.fn(async () => []),
            user: {
                findMany: jest.fn(async () => [
                    { id: 'abandoned', createdAt, signupSource: 'google', tenant: null },
                    {
                        id: 'onboarded', createdAt, signupSource: 'google',
                        tenant: {
                            id: 'tenant-onboarded',
                            onboardingCompletedAt: new Date('2026-08-23T01:00:00.000Z'),
                            firstChannelConnectedAt: null, firstMessageAt: null,
                            subscriptionStatus: 'trialing',
                            settings: {},
                        },
                    },
                    {
                        id: 'paid', createdAt, signupSource: 'partner',
                        tenant: {
                            id: 'tenant-paid',
                            onboardingCompletedAt: new Date('2026-08-23T00:30:00.000Z'),
                            firstChannelConnectedAt: new Date('2026-08-23T02:00:00.000Z'),
                            firstMessageAt: new Date('2026-08-23T03:00:00.000Z'),
                            subscriptionStatus: 'active',
                            settings: {},
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
        expect(result.journey.stages.find(stage => stage.key === 'first_channel')).toMatchObject({
            count: 1, shareOfSignups: 33.3,
        });
    });

    it('measures the three outcomes independently and reports observed time percentiles', async () => {
        const createdAt = new Date('2026-09-18T12:00:00.000Z');
        const prisma = {
            user: {
                findMany: jest.fn(async () => [{
                    id: 'user-1', createdAt, signupSource: 'organic',
                    tenant: {
                        id: 'tenant-1',
                        onboardingCompletedAt: new Date('2026-09-18T12:10:00.000Z'),
                        firstChannelConnectedAt: new Date('2026-09-18T12:05:00.000Z'),
                        firstMessageAt: new Date('2026-09-18T12:20:00.000Z'),
                        subscriptionStatus: 'trialing', settings: {},
                    },
                }]),
            },
            $queryRawUnsafe: jest.fn(async (_sql: string, _since: string) => [
                { tenant_id: 'tenant-1', event: 'test_chat_first_reply', occurred_at: new Date('2026-09-18T12:03:00.000Z'), detail: 'setup_wizard' },
                { tenant_id: 'tenant-1', event: 'first_operational_reply', occurred_at: new Date('2026-09-18T12:22:00.000Z'), detail: 'dispatch' },
                { tenant_id: 'tenant-1', event: 'first_useful_result', occurred_at: new Date('2026-09-18T13:00:00.000Z'), detail: 'appointment_booked' },
            ]),
        };
        const service = new TenantsService(
            prisma as any, {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, {} as any,
        );

        const result = await service.getOnboardingFunnel(new Date('2026-09-18T00:00:00.000Z'));

        expect(result.journey.stages.map(stage => [stage.key, stage.count])).toEqual([
            ['signup', 1], ['onboarded', 1], ['test_reply', 1], ['first_channel', 1],
            ['first_inbound', 1], ['first_operational_reply', 1], ['first_useful_result', 1], ['paying', 0],
        ]);
        expect(result.journey.elapsedTime).toEqual({
            testReply: { observed: 1, medianHours: 0.05, p90Hours: 0.05 },
            firstOperationalReply: { observed: 1, medianHours: 22 / 60, p90Hours: 22 / 60 },
            firstUsefulResult: { observed: 1, medianHours: 1, p90Hours: 1 },
        });
        expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('$1::timestamptz');
    });
});
