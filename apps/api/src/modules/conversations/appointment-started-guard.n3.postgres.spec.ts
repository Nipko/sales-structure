import { randomUUID } from 'crypto';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · what the chat may do with an appointment whose start time is behind the TENANT's clock (PR #82 decision):
 *
 *   LIST     it is still listed (from the start of the tenant's local day), so the customer sees it;
 *   CANCEL   it is NOT cancelled from the chat: a no-show must not become a cancellation (`appointment_already_started`);
 *   MOVE     it is not moved either;
 *   AHEAD    what is still ahead today is cancelled as usual.
 *
 * `start_at` is a wall clock in the tenant's timezone (`persona_config.config_json.hours.timezone`): every comparison here is made
 * against THAT clock, never against the server's UTC `NOW()`. The timezone is read the way every other writer reads it.
 */
const TABLES = [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings',
    'staff_resource_assignments', 'services', 'service_staff', 'calendar_integrations', 'appointments',
    'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'real_estate_listings',
    'listing_zone_agents', 'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox',
    'commitment_proposals', 'operational_notice_outbox'];

const TZ = 'America/Bogota';
/** «YYYY-MM-DD HH:MM:SS» on the tenant's wall clock, `minutes` from now. */
const wallClock = (minutes: number): string => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(Date.now() + minutes * 60_000));
    const p = (type: string) => parts.find(part => part.type === type)!.value;
    return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}:${p('second')}`;
};
const localMidnight = (): string => `${wallClock(0).slice(0, 10)} 00:00:00`;

(N3_DATABASE_URL ? describe : describe.skip)('N3: an appointment that already started is listed but not cancelled or moved from the chat', () => {
    jest.setTimeout(180_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, serviceId: string;

    beforeAll(async () => {
        h = await openLive({ prefix: 'n3strt', workarounds: { commitmentDdl: true }, tables: TABLES });
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Asesor');
        serviceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,buffer_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Corte y estilo',true,30,0,3,0,'COP','none')`, [serviceId]);
        for (let dow = 0; dow <= 6; dow += 1) {
            await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active) VALUES($1::uuid,$2,'00:00','23:59',true)`, [staffId, dow]);
        }
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => { await h.q('TRUNCATE appointments,tool_execution_ledger,messages CASCADE'); });

    const seed = async (C: { contactId: string; conversationId: string }, start: string) => {
        const id = randomUUID();
        await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,
                status,customer_name,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Corte y estilo',$6::timestamp,$6::timestamp + interval '30 minutes','confirmed','Cliente',NOW(),NOW())`,
        [id, C.contactId, C.conversationId, staffId, serviceId, start]);
        return id;
    };
    const confirmed = async (C: { contactId: string; conversationId: string }, tool: string, args: any) => {
        await h.inbound(C.conversationId, 'quiero hacerlo');
        expect(await h.call(C.contactId, C.conversationId, tool, args, scope)).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(C.conversationId, 'sí, confirmo');
        return h.call(C.contactId, C.conversationId, tool, args, scope);
    };
    const statusOf = async (id: string) => (await h.q<any[]>('SELECT status FROM appointments WHERE id=$1::uuid', [id]))[0].status;

    it('lists what is left of today, including the part that already started, and drops yesterday', async () => {
        const C = await seedCustomer(h.q, 'Cliente');
        // 30 minutes ago, but never before the tenant's midnight (a run in the first half hour of the day)
        const startedStart = wallClock(-30) < localMidnight() ? localMidnight() : wallClock(-30);
        const started = await seed(C, startedStart);
        const ahead = await seed(C, wallClock(60 * 26));
        const yesterday = await seed(C, wallClock(-60 * 26));
        const listed = await h.call(C.contactId, C.conversationId, 'list_customer_appointments', {}, scope);
        const ids = (listed.appointments as any[]).map(a => a.id);
        expect(ids).toContain(started);
        expect(ids).toContain(ahead);
        expect(ids).not.toContain(yesterday);
    });

    it('does not cancel one that already started: nothing is written', async () => {
        const C = await seedCustomer(h.q, 'Cliente');
        const startedStart = wallClock(-30) < localMidnight() ? localMidnight() : wallClock(-30);
        const id = await seed(C, startedStart);
        const result = await confirmed(C, 'cancel_appointment', { appointmentId: id });
        expect(result).toMatchObject({ error: 'appointment_already_started', persisted: false });
        expect(await statusOf(id)).toBe('confirmed');
    });

    it('does not move one that already started', async () => {
        const C = await seedCustomer(h.q, 'Cliente');
        const startedStart = wallClock(-30) < localMidnight() ? localMidnight() : wallClock(-30);
        const id = await seed(C, startedStart);
        const tomorrow = wallClock(60 * 24).slice(0, 10);
        const result = await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: tomorrow, newTime: '10:00' });
        expect(result).toMatchObject({ error: 'appointment_already_started', persisted: false });
        expect(await statusOf(id)).toBe('confirmed');
    });

    it('cancels one that is still ahead (control), judged on the tenant clock', async () => {
        const C = await seedCustomer(h.q, 'Cliente');
        const id = await seed(C, wallClock(90));
        const result = await confirmed(C, 'cancel_appointment', { appointmentId: id });
        expect(result.success).toBe(true);
        expect(await statusOf(id)).toBe('cancelled');
    });
});
