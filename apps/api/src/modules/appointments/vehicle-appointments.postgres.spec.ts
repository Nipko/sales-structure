import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from './appointments.service';
import { VehicleInventoryService } from '../verticals/vehicle-inventory.service';
import { vehicleAppointmentBusyIntervals } from './vehicle-appointment-capacity';
import { updateVehicleAppointment } from './vehicle-appointment-update';
import { AppointmentPaymentListener } from './appointment-payment.listener';
import { ensureOperationalNoticeOutbox } from '../operational-notices/operational-notice-outbox';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { TemporalCapacityContractService } from '../verticals/temporal-capacity-contract.service';
import { AgentQualityService } from '../quality/agent-quality.service';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;
(url ? describe : describe.skip)('vehicle appointments in the canonical agenda (real PostgreSQL)', () => {
    const schema = `tenant_vehicle_command_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID(), contactId = randomUUID(), vehicleId = randomUUID();
    const serviceId = randomUUID(), secondServiceId = randomUUID(), staffId = randomUUID(), secondStaffId = randomUUID();
    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const tables = ['customer_memory_erasure', 'customer_profiles', 'contact_identities', 'contacts', 'conversations', 'messages',
        'persona_config', 'courses', 'campaigns', 'companies', 'leads', 'opportunities', 'pipelines', 'pipeline_stages', 'deals',
        'services', 'service_staff', 'calendar_integrations', 'appointments', 'availability_slots', 'blocked_dates', 'staff_members', 'operational_locations', 'staff_operational_bindings'];
    let client: PrismaClient, prisma: PrismaService, appointments: AppointmentsService, vehicles: VehicleInventoryService;
    const events = { emit: jest.fn() }, outbox = { enqueueWithQuery: jest.fn(async () => undefined) };
    const q = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const request = (extra: Record<string, any> = {}) => ({ vehicleId, contactId, serviceId, staffId, requestKey: randomUUID(),
        contactName: 'Synthetic', scheduledDate: date, scheduledTime: '10:00', ...extra });
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation')) throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url }); prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client); prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
        prisma.getTenantSchemaName = async id => { if (id !== tenantId) throw new Error('test_scope'); return schema; };
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        for (const id of [staffId, secondStaffId]) await client.$executeRawUnsafe(
            "INSERT INTO public.users(id,tenant_id,is_active,first_name,last_name) VALUES($1::uuid,$2::uuid,true,'Synthetic','Staff')", id, tenantId);
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8').replaceAll('{{SCHEMA_NAME}}', schema);
        for (const sql of (prisma as any).splitSqlStatements(ddl)) {
            const match = sql.match(/^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."([a-z_]+)"/i);
            const index = sql.match(/^CREATE (?:UNIQUE )?INDEX[\s\S]*? ON "[^"]+"\."([a-z_]+)"/i);
            if (match && tables.includes(match[1]) || index && tables.includes(index[1]) || sql.startsWith('DO $payment_policy_columns$')) await client.$executeRawUnsafe(sql);
        }
        appointments = new AppointmentsService(prisma, events as any, outbox as any, { timezoneForSchema: async () => 'America/Bogota' } as any);
        vehicles = new VehicleInventoryService(prisma, {} as any, appointments);
        await vehicles.ensureTables(schema);
        await ensureOperationalNoticeOutbox(prisma, schema);
    }, 30000);
    beforeEach(async () => {
        await q(`TRUNCATE ${[...tables, 'vehicles', 'vehicle_inquiries', 'test_drives', 'operational_notice_outbox'].map(name => `"${name}"`).join(',')} CASCADE`);
        await client.$executeRawUnsafe('UPDATE public.users SET is_active=true WHERE tenant_id=$1::uuid', tenantId);
        await q("INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'synthetic','web_widget','Synthetic')", [contactId]);
        await q("INSERT INTO persona_config(config_yaml,config_json,is_active) VALUES('{}','{\"hours\":{\"timezone\":\"America/Bogota\"}}',true)");
        for (const id of [serviceId, secondServiceId]) await q(`INSERT INTO services(id,name,duration_minutes,max_concurrent,price,currency,payment_policy,location_type)
            VALUES($1::uuid,$2,30,2,100,'COP','none','in_person')`, [id, `Test drive ${id}`]);
        await q("INSERT INTO vehicles(id,make,model,year,price_cents,status) VALUES($1::uuid,'Synthetic','Vehicle',2026,10000,'available')", [vehicleId]);
        for (const id of [staffId, secondStaffId]) await q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
            VALUES($1::uuid,EXTRACT(DOW FROM $2::date),'09:00','18:00',true)`, [id, date]);
        events.emit.mockClear(); outbox.enqueueWithQuery.mockClear();
    });
    afterAll(async () => {
        if (client) try {
            if (!/^tenant_vehicle_command_[a-f0-9]{32}$/.test(schema)) throw new Error('cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.users WHERE tenant_id=$1::uuid AND id IN ($2::uuid,$3::uuid)', tenantId, staffId, secondStaffId);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    });
    it('writes one pending appointment, lists it in inventory and replays without duplicate effects', async () => {
        const data = request(); const first = await vehicles.scheduleTestDrive(tenantId, data);
        const replay = await vehicles.scheduleTestDrive(tenantId, data);
        expect(first).toMatchObject({ status: 'pending', contactId, serviceId, assignedTo: staffId, metadata: { vehicleId, testDrive: true } });
        expect(replay).toMatchObject({ id: first.id, idempotentReplay: true, status: 'pending' });
        expect((await q('SELECT count(*)::int AS n FROM test_drives'))[0].n).toBe(0);
        expect(await vehicles.listTestDrives(tenantId)).toEqual([expect.objectContaining({ id: first.id, source: 'appointment', status: 'pending', vehicle_id: vehicleId })]);
        expect(events.emit).toHaveBeenCalledTimes(1); expect(outbox.enqueueWithQuery).toHaveBeenCalledTimes(1);
    });
    it('checks the compatible services and active staff windows used by setup', async () => {
        const quality: any = new AgentQualityService(prisma);
        jest.spyOn(quality.logger, 'debug').mockImplementation(() => undefined);
        let facts = await quality.loadReadinessFacts(schema);
        expect(facts).toMatchObject({ vehicles: 1, testDriveServices: 2, testDriveSlots: 2 });
        expect(facts.unavailableSources).not.toContain('appointments');
        await q("UPDATE services SET location_type='online'");
        facts = await quality.loadReadinessFacts(schema);
        expect(facts).toMatchObject({ services: 2, availabilitySlots: 2, testDriveServices: 0, testDriveSlots: 0 });
    });
    it('keeps payment terms on retry and does not sync an unpaid appointment', async () => {
        await q("UPDATE services SET payment_policy='any',deposit_percent=25 WHERE id=$1::uuid", [serviceId]);
        const data = request(); const first = await vehicles.scheduleTestDrive(tenantId, data);
        const replay = await vehicles.scheduleTestDrive(tenantId, data);
        expect(replay).toMatchObject({ id: first.id, status: 'pending_payment', awaitingPayment: true, paymentChoice: 'deposit_or_full', currency: 'COP' });
        expect(outbox.enqueueWithQuery).not.toHaveBeenCalled();
        await expect(appointments.update(schema, first.id, { status: 'confirmed' })).rejects.toMatchObject({ response: { error: 'test_drive_payment_settlement_required' } });
    });
    it('rejects a reused request key with a changed time', async () => {
        const data = request(); await vehicles.scheduleTestDrive(tenantId, data);
        await expect(vehicles.scheduleTestDrive(tenantId, { ...data, scheduledTime: '11:00' })).rejects.toMatchObject({ response: { error: 'test_drive_request_key_conflict' } });
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(1);
    });
    it('does not let recurring appointments bypass the vehicle capacity command', async () => {
        await expect(appointments.createRecurring(schema, {
            contactId, serviceId, serviceName: 'Test drive', assignedTo: staffId,
            startAt: `${date}T10:00:00`, endAt: `${date}T10:30:00`, metadata: { vehicleId },
            recurrence: { frequency: 'weekly', count: 2 },
        })).rejects.toMatchObject({ response: { error: 'test_drive_recurrence_not_supported' } });
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(0);
    });
    it('serializes overlapping reservations of the same vehicle across services and staff', async () => {
        const results = await Promise.allSettled([
            vehicles.scheduleTestDrive(tenantId, request()),
            vehicles.scheduleTestDrive(tenantId, request({ serviceId: secondServiceId, staffId: secondStaffId, scheduledTime: '10:15' })),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(1);
    });
    it('allows adjacent intervals and blocks a conflicting dashboard reschedule', async () => {
        const first = await vehicles.scheduleTestDrive(tenantId, request());
        await vehicles.scheduleTestDrive(tenantId, request({ scheduledTime: '10:30' }));
        await expect(appointments.update(schema, first.id, { startAt: `${date}T10:15:00`, endAt: `${date}T10:45:00` }))
            .rejects.toMatchObject({ response: { error: 'test_drive_vehicle_slot_unavailable' } });
        expect((await appointments.getById(schema, first.id)).startAt).toBe(`${date}T10:00:00`);
        const moved = await appointments.update(schema, first.id, { startAt: `${date}T11:00:00`, endAt: `${date}T11:30:00` });
        expect(moved).toMatchObject({ id: first.id, status: 'pending', metadata: { vehicleId } });
        await appointments.cancel(schema, first.id);
        const cancellations = events.emit.mock.calls.filter(call => call[0] === 'appointment.cancelled').length;
        const notifications = outbox.enqueueWithQuery.mock.calls.length;
        await appointments.cancel(schema, first.id);
        expect(events.emit.mock.calls.filter(call => call[0] === 'appointment.cancelled')).toHaveLength(cancellations);
        expect(outbox.enqueueWithQuery).toHaveBeenCalledTimes(notifications);
        await expect(vehicles.scheduleTestDrive(tenantId, request({ scheduledTime: '11:00' }))).resolves.toMatchObject({ status: 'pending' });
    });
    it.each(['missing', 'blocked'])('refuses %s staff availability', async kind => {
        if (kind === 'missing') await q('DELETE FROM availability_slots');
        else await q('INSERT INTO blocked_dates(blocked_date) VALUES($1::date)', [date]);
        await expect(vehicles.scheduleTestDrive(tenantId, request())).rejects.toMatchObject({ response: { error: kind === 'missing' ? 'test_drive_staff_availability_unverified' : 'test_drive_staff_unavailable' } });
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(0);
    });
    it('keeps unresolved legacy rows separate and refuses overlapping new reservations', async () => {
        await q(`INSERT INTO test_drives(vehicle_id,contact_name,scheduled_date,scheduled_time,duration_min)
            VALUES($1::uuid,'Legacy',$2::date,'10:00',30)`, [vehicleId, date]);
        await expect(vehicles.scheduleTestDrive(tenantId, request({ scheduledTime: '10:15' }))).rejects.toMatchObject({ response: { error: 'test_drive_legacy_review_required' } });
        expect(await vehicles.listTestDrives(tenantId)).toEqual([expect.objectContaining({ source: 'legacy', appointment_id: null })]);
    });
    it('filters full vehicle intervals and releases an expired payment hold', async () => {
        await q("UPDATE services SET payment_policy='full' WHERE id=$1::uuid", [serviceId]);
        await vehicles.scheduleTestDrive(tenantId, request());
        const busy = () => prisma.transactionInTenantSchema(schema, query => vehicleAppointmentBusyIntervals(query, vehicleId, date));
        expect(await busy()).toEqual([{ start: `${date}T10:00:00`, end: `${date}T10:30:00` }]);
        await q("UPDATE appointments SET hold_expires_at=NOW()-interval '1 minute'");
        expect(await busy()).toEqual([]);
        await expect(vehicles.scheduleTestDrive(tenantId, request())).resolves.toMatchObject({ status: 'pending_payment' });
    });
    it('does not overwrite a cancellation using a stale dashboard snapshot', async () => {
        const item = await vehicles.scheduleTestDrive(tenantId, request());
        const [snapshot] = await q(`SELECT *, to_char(start_at,'YYYY-MM-DD"T"HH24:MI:SS') AS start_local,
            to_char(end_at,'YYYY-MM-DD"T"HH24:MI:SS') AS end_local,updated_at::text AS update_revision FROM appointments WHERE id=$1::uuid`, [item.id]);
        await appointments.cancel(schema, item.id);
        await expect(prisma.transactionInTenantSchema(schema, query => updateVehicleAppointment(query, schema, snapshot, {
            startAt: `${date}T11:00:00`, endAt: `${date}T11:30:00`, assignedTo: staffId, status: 'pending', notes: null, location: null,
        }))).rejects.toMatchObject({ response: { error: 'test_drive_changed_concurrently' } });
        expect((await appointments.getById(schema, item.id)).status).toBe('cancelled');
    });
    it('agent readers, rescheduling and cancellation use the same vehicle appointment', async () => {
        const item = await vehicles.scheduleTestDrive(tenantId, request());
        const dependencies = Array(32).fill({}); dependencies[0] = prisma;
        dependencies[1] = { acquireLockToken: async () => randomUUID(), releaseLockToken: async () => true };
        dependencies[2] = events; dependencies[31] = appointments;
        const executor: any = new (AIToolExecutorService as any)(...dependencies);
        executor.temporalContracts = new TemporalCapacityContractService(); executor.getTenantTimezone = async () => 'America/Bogota';
        executor.findAppointmentConflict = async () => false;
        executor.checkAvailability = async () => ({ slots: [] });
        expect(await executor.getAppointmentDetails(schema, contactId, item.id)).toMatchObject({ id: item.id, vehicleId, status: 'pending' });
        expect((await executor.listCustomerAppointments(schema, contactId)).appointments).toEqual([expect.objectContaining({ id: item.id, vehicleId })]);
        const moved = await executor.rescheduleAppointment(schema, contactId, item.id, date, '11:00');
        expect(moved).toMatchObject({ success: true, appointment: { id: item.id, status: 'pending', vehicleId, time: '11:00' } });
        expect(await executor.rescheduleAppointment(schema, contactId, item.id, date, '11:00')).toMatchObject({ success: true, alreadyRescheduled: true });
        expect(await executor.getAppointmentDetails(schema, randomUUID(), item.id)).toHaveProperty('error');
        expect(await executor.cancelAppointment(schema, contactId, item.id)).toMatchObject({ success: true });
        expect((await appointments.getById(schema, item.id)).status).toBe('cancelled');
    });
    it('confirms paid test drives once and retains a durable notice', async () => {
        await q("UPDATE services SET payment_policy='full' WHERE id=$1::uuid", [serviceId]);
        const item = await vehicles.scheduleTestDrive(tenantId, request());
        await q("UPDATE appointments SET payment_status='paid' WHERE id=$1::uuid", [item.id]);
        const listener = new AppointmentPaymentListener(prisma, events as any, { recoverTenant: async () => undefined } as any);
        await listener.onPaid({ tenantId, kind: 'appointment', entityId: item.id });
        await listener.onPaid({ tenantId, kind: 'appointment', entityId: item.id });
        expect((await appointments.getById(schema, item.id)).status).toBe('confirmed');
        expect(await q('SELECT kind,state FROM operational_notice_outbox')).toEqual([{ kind: 'appointment.payment_confirmed', state: 'pending' }]);
    });
    it.each(['vehicle_taken', 'vehicle_changed', 'staff_inactive'])('routes a paid test drive to review when %s', async reason => {
        await q("UPDATE services SET payment_policy='full' WHERE id=$1::uuid", [serviceId]);
        const item = await vehicles.scheduleTestDrive(tenantId, request());
        if (reason === 'vehicle_taken') {
            await q("UPDATE appointments SET hold_expires_at=NOW()-interval '1 minute' WHERE id=$1::uuid", [item.id]);
            await vehicles.scheduleTestDrive(tenantId, request({ serviceId: secondServiceId, staffId: secondStaffId }));
        } else if (reason === 'vehicle_changed') await q("UPDATE vehicles SET model='Changed' WHERE id=$1::uuid", [vehicleId]);
        else await client.$executeRawUnsafe('UPDATE public.users SET is_active=false WHERE id=$1::uuid', staffId);
        await q("UPDATE appointments SET payment_status='paid' WHERE id=$1::uuid", [item.id]);
        const listener = new AppointmentPaymentListener(prisma, events as any, { recoverTenant: async () => undefined } as any);
        await listener.onPaid({ tenantId, kind: 'appointment', entityId: item.id });
        expect((await appointments.getById(schema, item.id)).status).toBe('pending_payment');
        expect(await q('SELECT kind FROM operational_notice_outbox')).toEqual([{ kind: 'appointment.payment_review' }]);
    });
});
