import { AppointmentRemindersService } from './appointment-reminders.service';

describe('AppointmentRemindersService subscription boundary', () => {
    it('does not inspect appointments or send direct templates for a locked tenant', async () => {
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{
                id: '11111111-1111-4111-8111-111111111111',
                schema_name: 'tenant_test',
            }]),
            tenant: { findUnique: jest.fn().mockResolvedValue({
                isInternal: false,
                subscriptionStatus: 'pending_auth',
                subscription: {
                    status: 'pending_auth', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null,
                },
            }) },
            executeInTenantSchema: jest.fn(),
        };
        const messaging = { sendTemplate: jest.fn() };
        const appointments = { getReminderSettings: jest.fn() };
        const emailTemplates = { renderAndSend: jest.fn() };
        const service = new AppointmentRemindersService(
            prisma as any,
            messaging as any,
            {} as any,
            appointments as any,
            {} as any,
            { emit: jest.fn() } as any,
            emailTemplates as any,
        );

        await service.send24hReminders();

        expect(appointments.getReminderSettings).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(messaging.sendTemplate).not.toHaveBeenCalled();
        // The reminder email is a send too: a locked tenant must not reach it.
        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
    });
});
