import { randomUUID } from 'crypto';
import { DispatchRecoveryService } from './dispatch-recovery.service';
import { ProactiveDispatchService } from './proactive-dispatch.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-43 — the durable outbox: nothing is lost when the publisher or the provider
 * fails, and no effect is created twice.
 *
 *   identity    one `originKey` is one row, however many times a producer asks;
 *               a different key is a different effect.
 *   publish     a row committed while the queue was down is republished by the recovery
 *               pass, with the SAME job id every time, and is never duplicated as a row.
 *   crons       two recovery passes at once (API + worker) republish the same ids.
 *
 * Producer: an appointment reminder authority (the real policy), sent through the real
 * `ProactiveDispatchService` and store. Only the queue publisher is a double.
 * Oracle: `agent_dispatch_outbox` rows and the ids the publisher received.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-43: durable dispatch outbox', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let publishDown = false;
    let published: string[] = [];
    let proactive: ProactiveDispatchService;
    let recovery: any;
    const SENDER = '15550001111';

    beforeAll(async () => {
        lane = await openLane('n3outbox', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID, conversation_id UUID, service_name TEXT,
                start_at TIMESTAMP, end_at TIMESTAMP, status TEXT, reminder_24h_sent BOOLEAN DEFAULT false,
                reminder_2h_sent BOOLEAN DEFAULT false, updated_at TIMESTAMPTZ DEFAULT NOW())`,
            'CREATE TABLE agent_personas(id UUID PRIMARY KEY, is_active BOOLEAN, version INT)',
        ]);
        (lane.prisma as any).tenant.findMany = async () => [{ id: lane.tenantId }];
        proactive = new ProactiveDispatchService(lane.prisma, lane.store, {
            enqueueDispatch: async (_t: string, id: string) => { if (publishDown) throw new Error('queue_down'); published.push(id); },
        } as any);
        recovery = new DispatchRecoveryService(lane.prisma, lane.store,
            { enqueueDispatch: async (_t: string, id: string) => { published.push(`recovered:${id}`); } } as any,
            { runExclusive: async (_n: string, _t: number, fn: any) => fn() } as any);
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        publishDown = false; published = [];
        await lane.sql('TRUNCATE agent_dispatch_outbox, messages, appointments, conversations, contacts CASCADE');
    });

    const reminder = async (key: string, apptId?: string) => {
        const contactId = randomUUID(), conversationId = randomUUID(), id = apptId ?? randomUUID();
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)', [contactId, 'Ana', '+573001112233', 'whatsapp']);
        await lane.sql("INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES($1::uuid,$2::uuid,'whatsapp',$3)", [conversationId, contactId, SENDER]);
        await lane.sql(`INSERT INTO appointments(id,contact_id,conversation_id,service_name,start_at,end_at,status)
            VALUES($1::uuid,$2::uuid,$3::uuid,'Consulta', NOW() + interval '24 hours', NOW() + interval '25 hours','confirmed')`, [id, contactId, conversationId]);
        const send = async (originKey: string) => proactive.send(lane.tenantId, {
            originKey, conversationId, contactId, channelType: 'whatsapp', channelAccountId: SENDER, recipient: '+573001112233',
            items: [{ kind: 'template', payload: { templateName: 'appointment_reminder', language: 'es', components: [] } }],
            operationalScope: await proactive.policyAuthority(lane.schema, {
                tenantId: lane.tenantId, producer: 'appointment_reminder', channelType: 'whatsapp', channelAccountId: SENDER, entityId: id }),
        });
        return { id, contactId, conversationId, send };
    };

    it('AUT-43: one originKey is one row however many times it is asked; another key is another effect', async () => {
        const r = await reminder('appointment_reminder:A:24h');
        const first = await r.send('appointment_reminder:A:24h');
        const again = await r.send('appointment_reminder:A:24h');
        const other = await r.send('appointment_reminder:A:2h');
        expect(first.kind).toBe('prepared');
        expect(again.kind).toBe('already_present');
        expect(other.kind).toBe('prepared');
        expect(await lane.outboxRows()).toHaveLength(2);
    });

    it('AUT-43: a row committed while the queue was down is republished by the recovery pass and is never duplicated', async () => {
        const r = await reminder('appointment_reminder:B:24h');
        publishDown = true;
        await r.send('appointment_reminder:B:24h');
        publishDown = false;
        const [row] = await lane.outboxRows();
        expect(row.state).toBe('prepared');
        expect(published).toHaveLength(0);
        await recovery.recoverPending();
        expect(published).toEqual([`recovered:${row.id}`]);
        expect((await lane.outboxRows())[0].state).toBe('queued');
        // Asking again for the same effect does not create a second row.
        await r.send('appointment_reminder:B:24h');
        expect(await lane.outboxRows()).toHaveLength(1);
    });

    it('AUT-43: repeated and concurrent recovery passes only ever republish the same row id', async () => {
        const r = await reminder('appointment_reminder:C:24h');
        publishDown = true;
        await r.send('appointment_reminder:C:24h');
        publishDown = false;
        await Promise.all([recovery.recoverPending(), recovery.recoverPending()]);
        await recovery.recoverPending();
        expect(new Set(published).size).toBe(1);
        expect(await lane.outboxRows()).toHaveLength(1);
    });
});
