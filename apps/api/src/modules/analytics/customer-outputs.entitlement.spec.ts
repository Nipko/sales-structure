import { AlertsService } from './alerts.service';
import { ScheduledReportsService } from './scheduled-reports.service';

describe('analytics customer outputs subscription boundary', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function prisma() {
        return {
            tenant: {
                findMany: jest.fn().mockResolvedValue([{
                    id: tenantId, name: 'Tenant', schemaName: 'tenant_test',
                }]),
                findUnique: jest.fn().mockResolvedValue({
                    isInternal: false,
                    subscriptionStatus: 'pending_auth',
                    subscription: {
                        status: 'pending_auth', trialEndsAt: null, cancelAtPeriodEnd: false,
                        currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null,
                    },
                }),
            },
            $queryRawUnsafe: jest.fn(),
        };
    }

    it('does not build or email a scheduled report for a locked tenant', async () => {
        const db = prisma();
        const email = { send: jest.fn() };
        const throttle = { isFeatureEnabled: jest.fn() };
        const service = new ScheduledReportsService(
            db as any, {} as any, email as any, {} as any, throttle as any, {} as any,
        );

        await service.sendWeeklyReports();

        expect(throttle.isFeatureEnabled).not.toHaveBeenCalled();
        expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
    });

    it('does not evaluate, persist or email alerts for a locked tenant', async () => {
        const db = prisma();
        const email = { send: jest.fn() };
        const service = new AlertsService(
            db as any, {} as any, email as any, {} as any, {} as any,
        );

        await service.evaluateAlerts();

        expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
    });
});
