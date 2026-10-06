import { randomUUID } from 'crypto';
import { OperationalNoticeService } from './operational-notice.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-01 (same family): `appointments.start_at/end_at` are naive wall clocks of the tenant
 * zone. `hydrate` used to read `end_at` with `new Date()` (as UTC), so at UTC-5 an appointment
 * that ends in two hours looked finished three hours ago and the staff notice was suppressed
 * as "domain state changed". The comparison is now made against the tenant's wall clock.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-01: operator notices compare appointment wall clocks in the tenant zone', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    const regionalProfile = { timezoneFor: async () => 'America/Bogota' };

    beforeAll(async () => {
        lane = await openLane('n3noticewc', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID, conversation_id UUID, service_name TEXT,
                start_at TIMESTAMP, end_at TIMESTAMP, status TEXT, metadata JSONB DEFAULT '{}', payment_status TEXT)`,
        ]);
    });
    afterAll(async () => { if (lane) await lane.close(); });

    const outcome = async (endOffset: string) => {
        const contactId = randomUUID(), id = randomUUID();
        await lane.sql("INSERT INTO contacts(id,name,phone) VALUES($1::uuid,'Ana','+573001112233')", [contactId]);
        await lane.sql(`INSERT INTO appointments(id,contact_id,service_name,start_at,end_at,status)
            VALUES($1::uuid,$2::uuid,'Consulta',(NOW() AT TIME ZONE 'America/Bogota') - interval '3 hours',
                   (NOW() AT TIME ZONE 'America/Bogota') + interval '${endOffset}','confirmed')`, [id, contactId]);
        const notice = { id: randomUUID(), kind: 'appointment.operator_slack', entity_id: id, contact_id: contactId, conversation_id: null };
        const query = (sql: string, params: any[] = []) => lane.sql(sql, params) as Promise<any[]>;
        const hydrate = (OperationalNoticeService.prototype as any).hydrate;
        return hydrate.call({ prisma: lane.prisma, widget: {}, regionalProfile }, query, lane.schema, lane.tenantId, notice)
            .then(() => null, (error: any) => error);
    };

    it('an appointment that ends in two hours (tenant wall clock) is NOT treated as finished', async () => {
        const error = await outcome('2 hours');
        expect(error?.code).not.toBe('notice_domain_state_changed');
    });

    it('an appointment that ended an hour ago is suppressed', async () => {
        const error = await outcome('-1 hour');
        expect(error?.code).toBe('notice_domain_state_changed');
    });
});
