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
            { timezoneFor: jest.fn().mockResolvedValue('America/Bogota'), timezoneForSchema: jest.fn().mockResolvedValue('America/Bogota') } as any,
            // The durable lane. A locked tenant must not reach it either: a
            // committed row is a message that WILL go out, so writing one is a
            // send as much as the POST is.
            { send: jest.fn(), conversationFor: jest.fn() } as any,
        );

        await service.send24hReminders();

        expect(appointments.getReminderSettings).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(messaging.sendTemplate).not.toHaveBeenCalled();
        // The reminder email is a send too: a locked tenant must not reach it.
        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
    });

    it('continues with the next tenant when one reminder configuration is unavailable', async () => {
        const tenants = [
            { id: '11111111-1111-4111-8111-111111111111', schema_name: 'tenant_broken' },
            { id: '22222222-2222-4222-8222-222222222222', schema_name: 'tenant_healthy' },
        ];
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue(tenants),
            tenant: { findUnique: jest.fn().mockResolvedValue({
                isInternal: false, subscriptionStatus: 'active',
                subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
            }) },
            executeInTenantSchema: jest.fn(),
        };
        const appointments = { getReminderSettings: jest.fn()
            .mockRejectedValueOnce(new Error('settings unavailable'))
            .mockResolvedValueOnce({ reminder24h: false }) };
        const service = new AppointmentRemindersService(
            prisma as any, {} as any, {} as any, appointments as any, {} as any,
            { emit: jest.fn() } as any, {} as any,
            { timezoneFor: jest.fn(), timezoneForSchema: jest.fn() } as any,
            { send: jest.fn(), conversationFor: jest.fn() } as any,
        );

        await service.send24hReminders();

        expect(appointments.getReminderSettings).toHaveBeenCalledTimes(2);
        expect(appointments.getReminderSettings).toHaveBeenLastCalledWith(tenants[1].id);
    });

    it('does not substitute Spanish when the tenant language cannot be read', async () => {
        const prisma = { tenant: { findUnique: jest.fn().mockRejectedValue(new Error('database unavailable')) } };
        const service: any = new AppointmentRemindersService(
            prisma as any, {} as any, {} as any, {} as any, {} as any,
            { emit: jest.fn() } as any, {} as any,
            { timezoneFor: jest.fn(), timezoneForSchema: jest.fn() } as any,
            { send: jest.fn(), conversationFor: jest.fn() } as any,
        );

        await expect(service.getTenantLanguage('tenant-1')).rejects.toThrow('database unavailable');
    });
});
