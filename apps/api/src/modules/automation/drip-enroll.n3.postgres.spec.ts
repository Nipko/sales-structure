import { randomUUID } from 'crypto';
import { DripSequenceService } from './drip-sequence.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · REGRESSION (was a confirmed defect, fixed) AUT-17 — a contact cannot be enrolled in a drip sequence.
 *
 * `DripSequenceService.enrollOne` inserts with
 *     ON CONFLICT ON CONSTRAINT uidx_drip_enrollments_active DO NOTHING
 * but `uidx_drip_enrollments_active` is created (by `ensureDripTables` and by
 * tenant-schema.sql) as a partial UNIQUE INDEX, not as a constraint. PostgreSQL only
 * accepts `ON CONFLICT ON CONSTRAINT <name>` for real constraints (42704), so every
 * enrolment — `enrollContact` and, through its catch, every row of `enrollSegment` — fails.
 *
 * The test uses the product's OWN table definition (its `ensureDripTables`) and its own INSERT.
 * Oracle: the drip_enrollments rows and the job admitted to the queue.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-17: drip enrolment', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let drip: any;
    const jobs: any[] = [];

    beforeAll(async () => {
        lane = await openLane('n3dripdef', LANE_CHAT_DDL);
        drip = Object.create(DripSequenceService.prototype);
        Object.assign(drip, {
            prisma: lane.prisma, proactive: lane.proactive,
            nurturingQueue: { add: async (name: string, data: any, opts: any) => { jobs.push({ name, data, opts }); } },
            redis: { get: async () => null, set: async () => undefined },
            compliance: { isBlocked: async () => false },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });
    afterAll(async () => { if (lane) await lane.close(); });

    it('AUT-17: enrollContact creates one active enrolment and schedules its first step; a second call is refused as a duplicate', async () => {
        const contactId = randomUUID(), conversationId = randomUUID(), sequenceId = randomUUID();
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)', [contactId, 'Ana', '+573001112233', 'whatsapp']);
        await lane.sql("INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES($1::uuid,$2::uuid,'whatsapp','15550004444')", [conversationId, contactId]);
        await drip.ensureDripTables(lane.schema);
        await lane.sql(`INSERT INTO drip_sequences(id,tenant_id,name,trigger_event,steps,is_active)
            VALUES($1::uuid,$2::uuid,'Goteo','manual',$3::jsonb,true)`,
        [sequenceId, lane.tenantId, JSON.stringify([{ delay_seconds: 0, message_type: 'custom', content: 'Hola' }])]);
        let failure = '';
        const first = await drip.enrollContact(lane.tenantId, sequenceId, contactId, conversationId)
            .catch((e: any) => { failure = String(e?.message ?? e).replace(/\s+/g, ' ').slice(-200); return null; });
        const rows = await lane.sql('SELECT status FROM drip_enrollments WHERE contact_id=$1::uuid', [contactId]);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-17] enrollContact -> ${first ? 'ok' : 'FAILED'} rows=${rows.length} jobs=${jobs.length} error="${failure}"`);
        expect(failure).toBe('');
        expect(rows).toEqual([{ status: 'active' }]);
        expect(jobs).toHaveLength(1);
        await expect(drip.enrollContact(lane.tenantId, sequenceId, contactId, conversationId)).rejects.toThrow(/already enrolled/);
        expect(await lane.sql('SELECT 1 FROM drip_enrollments WHERE contact_id=$1::uuid', [contactId])).toHaveLength(1);
    });
});
