import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const tenantId = '11111111-1111-4111-8111-111111111111', contactId = '22222222-2222-4222-8222-222222222222';
const vehicleId = '33333333-3333-4333-8333-333333333333', serviceId = '44444444-4444-4444-8444-444444444444';
const staffId = '55555555-5555-4555-8555-555555555555', schemaName = 'tenant_vehicle_tool';
const operationalScope = { kind: 'agent' as const, tenantId, schemaName, agentId: '66666666-6666-4666-8666-666666666666', version: 1, operationalHash: 'a'.repeat(64) };
const args = { vehicleId, serviceId, staffId, scheduledDate: '2027-10-14', scheduledTime: '10:00', contactName: 'Synthetic' };
function harness() {
    const service = { id: serviceId, name: 'Test drive', duration_type: 'fixed', duration_minutes: 30, price: 100, currency: 'COP', payment_policy: 'full', location_type: 'in_person' };
    const vehicle = { id: vehicleId, make: 'Synthetic', model: 'Vehicle', year: 2026, status: 'available' };
    const prisma = { $queryRawUnsafe: jest.fn(async (sql: string) => sql.includes('.services') ? [service] : sql.includes('.vehicles') ? [vehicle] : []), executeInTenantSchema: jest.fn(async () => []) };
    const control = { preflight: jest.fn(async () => ({ allowed: true, idempotencyKey: 'durable-test-drive-command' })), complete: jest.fn().mockResolvedValue(undefined), fail: jest.fn().mockResolvedValue(undefined) };
    const dependencies = Array(32).fill({}); dependencies[0] = prisma; dependencies[21] = control;
    const executor: any = new (AIToolExecutorService as any)(...dependencies);
    const command = jest.spyOn(executor, 'createAppointment').mockResolvedValue({ success: true, appointment: { id: 'appointment', status: 'pending_payment', vehicleId } });
    for (const level of ['log', 'warn', 'error']) jest.spyOn(executor.logger, level).mockImplementation(() => undefined);
    const run = (input: any = args, scope: any = operationalScope) => executor.execute(schemaName, tenantId, contactId, 'schedule_test_drive', input, undefined,
        { authority: authorityFor('schedule_test_drive'), operationalScope: scope });
    return { executor, command, control, service, vehicle, run, prisma };
}
describe('test-drive tool admission and canonical command binding', () => {
    it('binds server vehicle/service terms and the durable ledger key to the agenda command', async () => {
        const h = harness();
        const result = await h.run({ ...args, vehicleTerms: { label: 'Forged' }, appointmentTerms: { price: 0 } });
        expect(result).toMatchObject({ appointment: { status: 'pending_payment', vehicleId } });
        expect(h.control.preflight).toHaveBeenCalledWith(expect.objectContaining({ operationalScope, args: expect.objectContaining({
            scheduledDate: args.scheduledDate, scheduledTime: args.scheduledTime, contactName: args.contactName,
            vehicleTerms: expect.objectContaining({ vehicleId, label: 'Synthetic Vehicle 2026' }),
            appointmentTerms: expect.objectContaining({ price: 100, requiresPayment: true }),
        }) }));
        expect(h.command).toHaveBeenCalledWith(schemaName, tenantId, contactId, expect.objectContaining({ date: args.scheduledDate, time: args.scheduledTime, customerName: args.contactName }),
            undefined, undefined, undefined, operationalScope, 'durable-test-drive-command');
    });
    it('reuses stored tool arguments without losing the original date or customer name', async () => {
        const h = harness(); await h.run();
        const stored = (h.control.preflight.mock.calls as any)[0][0].args;
        await h.run(stored);
        expect((h.command.mock.calls as any)[1][3]).toMatchObject({ date: args.scheduledDate, time: args.scheduledTime, customerName: args.contactName });
    });
    it('shows current material terms when confirmation is still required and performs no write', async () => {
        const h = harness(); h.control.preflight.mockResolvedValue({ allowed: false, result: { error: 'confirmation_required' } } as any);
        expect(await h.run()).toMatchObject({ error: 'confirmation_required', vehicle: { vehicleId, label: 'Synthetic Vehicle 2026' }, service: { requiresPaymentToConfirm: true } });
        expect(h.command).not.toHaveBeenCalled();
    });
    it.each(['missing_staff', 'online_service', 'sold_vehicle'])('rejects %s before asking for consent', async kind => {
        const h = harness();
        if (kind === 'online_service') h.service.location_type = 'online';
        if (kind === 'sold_vehicle') h.vehicle.status = 'sold';
        const result = await h.run(kind === 'missing_staff' ? { ...args, staffId: undefined } : args);
        expect(result.error).toBeDefined(); expect(h.control.preflight).not.toHaveBeenCalled(); expect(h.command).not.toHaveBeenCalled();
    });
    it('requires the server-origin served agent revision', async () => {
        const h = harness(); const result = await h.run({ ...args, operationalScope }, null);
        expect(result.error).toBeDefined(); expect(h.command).not.toHaveBeenCalled(); expect(h.control.preflight).not.toHaveBeenCalled();
    });
    it('cannot bypass vehicle permissions through the general appointment tool', async () => {
        const h = harness();
        const result = await h.executor.execute(schemaName, tenantId, contactId, 'create_appointment', { vehicleId, serviceId }, undefined,
            { authority: authorityFor('create_appointment'), operationalScope });
        expect(result).toMatchObject({ error: 'test_drive_tool_required', persisted: false });
        expect(h.command).not.toHaveBeenCalled(); expect(h.control.preflight).not.toHaveBeenCalled();
    });
});
