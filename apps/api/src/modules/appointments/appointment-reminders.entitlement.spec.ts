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

    it('retries an auto-completion event until every asynchronous listener admits it', async () => {
        const appointment = {
            id: '11111111-1111-4111-8111-111111111111',
            contact_id: '22222222-2222-4222-8222-222222222222',
            service_name: 'Consulta',
        };
        let acknowledged = false;
        const prisma = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                if (sql.includes("SET status = 'completed'")) return [];
                if (sql.includes('SET completion_event_at = NOW()')) {
                    acknowledged = true;
                    return [];
                }
                if (sql.includes('completion_event_at IS NULL')) return acknowledged ? [] : [appointment];
                if (sql.includes('FROM contacts c')) return [{
                    contact_id: appointment.contact_id,
                    phone: '+573001112233',
                    name: 'Ana',
                    lead_id: '33333333-3333-4333-8333-333333333333',
                }];
                return [];
            }),
        };
        const events = {
            emitAsync: jest.fn()
                .mockRejectedValueOnce(new Error('automation queue unavailable'))
                .mockResolvedValueOnce([undefined]),
        };
        const service: any = new AppointmentRemindersService(
            prisma as any, {} as any, {} as any, {} as any, {} as any,
            events as any, {} as any,
            { timezoneFor: jest.fn().mockResolvedValue('America/Bogota') } as any,
            {} as any,
        );

        await expect(service.processAutoComplete('tenant-1', 'tenant_schema'))
            .rejects.toThrow('automation queue unavailable');
        expect(acknowledged).toBe(false);

        await service.processAutoComplete('tenant-1', 'tenant_schema');

        expect(events.emitAsync).toHaveBeenCalledTimes(2);
        expect(events.emitAsync).toHaveBeenLastCalledWith(
            'appointment.completed',
            expect.objectContaining({
                appointmentId: appointment.id,
                phone: '+573001112233',
            }),
        );
        expect(acknowledged).toBe(true);
    });
});
