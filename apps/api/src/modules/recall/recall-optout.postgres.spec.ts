import { randomUUID } from 'crypto';
import { RecallService } from './recall.service';
import { LANE_CHAT_DDL, N3_LANE_URL, leadOptedOut, openLane, optOut } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-C12 — a reactivation must not be sent to a person who asked to stop.
 * `ComplianceService.isBlocked` is the platform's answer to "has this phone
 * opted out?" (confirmed OR pending request, or `leads.opted_out`); the
 * nurturing and drip producers ask it and `RecallService` now does too, in two
 * layers: the selection (`processForTenant`) and the outbox admission
 * (`recallContactRevision`), for the person who opts out AFTER it was queued.
 *
 * Oracle: `agent_dispatch_outbox` (the durable effect) for each contact.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-C12: recall honours the opt-out register', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    const SENDER = '15550002222';

    beforeAll(async () => {
        lane = await openLane('n3recall', LANE_CHAT_DDL);
        service = Object.create(RecallService.prototype);
        Object.assign(service, {
            prisma: lane.prisma, proactive: lane.proactive,
            throttle: { isFeatureEnabled: async () => true },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            connections: { resolve: async (input: any) => ({ accessToken: 'token', accountId: input.channelAccountId || SENDER }) },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => { await lane.sql('TRUNCATE agent_dispatch_outbox, messages, conversations, contacts, opt_out_records, leads CASCADE'); });

    const lapsed = async (name: string, phone: string) => {
        const id = randomUUID();
        await lane.sql(`INSERT INTO contacts(id,name,phone,channel_type,last_appointment_at,last_contact_at)
            VALUES($1::uuid,$2,$3,'whatsapp',clock_timestamp() - interval '365 days',clock_timestamp() - interval '365 days')`, [id, name, phone]);
        await lane.sql(`INSERT INTO conversations(contact_id,channel_type,channel_account_id) VALUES($1::uuid,'whatsapp',$2)`, [id, SENDER]);
        return id;
    };

    it('AUT-C12: the contact who opted out gets nothing; the one who did not still gets the recall', async () => {
        const quiet = await lapsed('Ana Baja', '+573001110001');
        const active = await lapsed('Beto Activo', '+573001110002');
        await optOut(lane.sql, '+573001110001');

        const sent = await service.processForTenant(lane.tenantId, lane.schema,
            { daysThreshold: 180, cooldownDays: 90, channelType: 'whatsapp', message: '' });

        const rows = await lane.outboxRows();
        // Control: the sweep works and reaches the contact who never opted out.
        expect(rows.filter((r: any) => r.contact_id === active)).toHaveLength(1);
        // Promise: nothing is owed to — or sent to — the contact on the opt-out register.
        expect(rows.filter((r: any) => r.contact_id === quiet)).toHaveLength(0);
    });

    it('AUT-C12: an opt-out recorded ONLY against a lead (no phone on the record) suppresses the contact the lead belongs to', async () => {
        const quiet = await lapsed('Lia Solo Lead', '+573001110011');
        const leadId = randomUUID();
        await lane.sql('INSERT INTO leads(id,contact_id,phone) VALUES($1::uuid,$2::uuid,$3)', [leadId, quiet, '+573009990011']);
        await lane.sql("INSERT INTO opt_out_records(lead_id,phone,channel,status) VALUES($1::uuid,NULL,'whatsapp','confirmed')", [leadId]);
        const active = await lapsed('Beto Activo', '+573001110002');
        await service.processForTenant(lane.tenantId, lane.schema,
            { daysThreshold: 180, cooldownDays: 90, channelType: 'whatsapp', message: '' });
        const rows = await lane.outboxRows();
        expect(rows.filter((r: any) => r.contact_id === quiet)).toHaveLength(0);
        expect(rows.filter((r: any) => r.contact_id === active)).toHaveLength(1);
    });

    it('AUT-C12: a lead-level unsubscribe with no contact behind it does not blank the whole sweep (NULL-safe)', async () => {
        // `x IN (… NULL …)` is NULL, and `NOT NULL` in a WHERE drops the row: one
        // form unsubscribe from somebody who never wrote in would stop every recall.
        await leadOptedOut(lane.sql, { phone: '+573009990099' });
        const active = await lapsed('Beto Activo', '+573001110002');
        await service.processForTenant(lane.tenantId, lane.schema,
            { daysThreshold: 180, cooldownDays: 90, channelType: 'whatsapp', message: '' });
        expect((await lane.outboxRows()).filter((r: any) => r.contact_id === active)).toHaveLength(1);
    });

    it('AUT-C12: an opt-out recorded for channel=all suppresses the WhatsApp recall', async () => {
        const quiet = await lapsed('Mara Todos', '+573001110012');
        await lane.sql("INSERT INTO opt_out_records(phone,channel,status) VALUES('+573001110012','all','confirmed')");
        await service.processForTenant(lane.tenantId, lane.schema,
            { daysThreshold: 180, cooldownDays: 90, channelType: 'whatsapp', message: '' });
        expect((await lane.outboxRows()).filter((r: any) => r.contact_id === quiet)).toHaveLength(0);
    });

    it('AUT-C12: a PENDING opt-out request also suppresses the recall (isBlocked treats it as blocked)', async () => {
        const quiet = await lapsed('Carla Pendiente', '+573001110003');
        await optOut(lane.sql, '+573001110003', 'pending');
        await service.processForTenant(lane.tenantId, lane.schema,
            { daysThreshold: 180, cooldownDays: 90, channelType: 'whatsapp', message: '' });
        expect((await lane.outboxRows()).filter((r: any) => r.contact_id === quiet)).toHaveLength(0);
    });

    const run = () => service.processForTenant(lane.tenantId, lane.schema,
        { daysThreshold: 180, cooldownDays: 90, channelType: 'whatsapp', message: '' });

    it('AUT-C12: a lead-level unsubscribe (leads.opted_out) suppresses the contact it belongs to', async () => {
        const quiet = await lapsed('Dario Formulario', '+573001110004');
        await leadOptedOut(lane.sql, { phone: '+573009990000', contactId: quiet });
        const active = await lapsed('Beto Activo', '+573001110002');
        await run();
        const rows = await lane.outboxRows();
        expect(rows.filter((r: any) => r.contact_id === quiet)).toHaveLength(0);
        expect(rows.filter((r: any) => r.contact_id === active)).toHaveLength(1);
    });

    it('AUT-C12: the register is matched on the phone digits, not on its formatting', async () => {
        const quiet = await lapsed('Elena Formato', '+57 300 111 0005');
        await optOut(lane.sql, '573001110005');
        await run();
        expect((await lane.outboxRows()).filter((r: any) => r.contact_id === quiet)).toHaveLength(0);
    });

    it('AUT-C12: a rejected request (false positive) does NOT suppress', async () => {
        const kept = await lapsed('Fabio Falso', '+573001110006');
        await optOut(lane.sql, '+573001110006', 'rejected');
        await run();
        expect((await lane.outboxRows()).filter((r: any) => r.contact_id === kept)).toHaveLength(1);
    });

    it('AUT-C12: an opt-out recorded on another channel does not block the WhatsApp recall', async () => {
        const kept = await lapsed('Gina Instagram', '+573001110007');
        await lane.sql("INSERT INTO opt_out_records(phone,channel,status) VALUES('+573001110007','instagram','confirmed')");
        await run();
        expect((await lane.outboxRows()).filter((r: any) => r.contact_id === kept)).toHaveLength(1);
    });

    it('AUT-C12: a page full of opted-out contacts does not starve the ones behind it (filter before LIMIT)', async () => {
        for (let i = 0; i < 101; i++) {
            const phone = `+57300222${String(i).padStart(4, '0')}`;
            await lapsed(`Baja ${i}`, phone);
            await optOut(lane.sql, phone);
        }
        const active = await lapsed('Hugo Activo', '+573001110008');
        await run();
        expect((await lane.outboxRows()).filter((r: any) => r.contact_id === active)).toHaveLength(1);
    });

    it('AUT-C12 (second layer): a contact who opts out AFTER the recall was queued is suppressed at admission', async () => {
        const contactId = await lapsed('Irene Despues', '+573001110009');
        await run();
        const [row] = await lane.outboxRows();
        expect(row.contact_id).toBe(contactId);
        expect(row.state).toBe('queued');

        await optOut(lane.sql, '+573001110009');

        await expect(lane.store.admit(lane.tenantId, row.id)).rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        const [after] = await lane.outboxRows();
        expect(after.state).toBe('suppressed');
        expect(after.error_code).toBe('recipient_opted_out');
    });

    it('AUT-C12 (second layer): control — without an opt-out the same queued recall is admitted', async () => {
        await lapsed('Julia Sigue', '+573001110010');
        await run();
        const [row] = await lane.outboxRows();
        expect((await lane.store.admit(lane.tenantId, row.id)).row.state).toBe('admitted');
    });
});
