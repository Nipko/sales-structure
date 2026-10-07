import { randomUUID } from 'crypto';
import { RecallService } from './recall.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-09 — the recall (reactivation) sweep as a promise: the right people, one
 * message per cycle, and a cooldown that is exactly the configured number of days.
 *
 *   selection   lapsed beyond `daysThreshold`, with a phone, with a known last visit;
 *               a recent visitor, a phoneless contact and a never-visited contact get nothing.
 *   cycle       `next_recall_at` moves to now + cooldownDays; a second sweep the same day
 *               sends nothing and does not move the boundary again.
 *   backlog     the batch is capped at 100 per sweep, yet nobody is starved or told twice.
 *   cron body   `processRecalls` honours `recallConfig.enabled` and the plan feature.
 *   words       `{name}` / `{months}` are filled in from the contact.
 *
 * Time is seeded relative to `clock_timestamp()` (a naive TIMESTAMP, server zone pinned to UTC by the harness).
 * Oracle: `contacts.next_recall_at` and the dispatch outbox, never the return value.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-09: recall sweep', () => {
    jest.setTimeout(180_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    let tenants: any[] = [];
    let featureEnabled = true;
    const SENDER = '15550002222';
    const CONFIG = { daysThreshold: 180, cooldownDays: 90, channelType: 'whatsapp', message: '' };

    beforeAll(async () => {
        lane = await openLane('n3recallsw', LANE_CHAT_DDL);
        (lane.prisma as any).$queryRaw = async () => tenants;
        service = Object.create(RecallService.prototype);
        Object.assign(service, {
            prisma: lane.prisma, proactive: lane.proactive,
            throttle: { isFeatureEnabled: async () => featureEnabled },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            connections: { resolve: async (input: any) => ({ accessToken: 'token', accountId: input.channelAccountId || SENDER }) },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        featureEnabled = true;
        tenants = [{ id: lane.tenantId, schema_name: lane.schema, settings: { recallConfig: { ...CONFIG, enabled: true } } }];
        await lane.sql('TRUNCATE agent_dispatch_outbox, messages, conversations, contacts, opt_out_records, leads CASCADE');
    });

    const contact = async (over: { name?: string; phone?: string | null; lastVisitDays?: number | null; nextRecall?: string | null } = {}) => {
        const id = randomUUID();
        const lastVisit = over.lastVisitDays === undefined ? 200 : over.lastVisitDays;
        await lane.sql(`INSERT INTO contacts(id,name,phone,channel_type,last_appointment_at,next_recall_at)
            VALUES($1::uuid,$2,$3,'whatsapp',
                CASE WHEN $4::int IS NULL THEN NULL ELSE clock_timestamp() - ($4::int * interval '1 day') END,
                CASE WHEN $5::text IS NULL THEN NULL ELSE clock_timestamp() + $5::text::interval END)`,
        [id, over.name ?? 'Ana Perez', over.phone === undefined ? `+5730011${String(Math.floor(Math.random() * 90000) + 10000)}` : over.phone, lastVisit, over.nextRecall ?? null]);
        await lane.sql("INSERT INTO conversations(contact_id,channel_type,channel_account_id) VALUES($1::uuid,'whatsapp',$2)", [id, SENDER]);
        return id;
    };
    const sweep = (config: any = CONFIG) => service.processForTenant(lane.tenantId, lane.schema, config);
    const rowsFor = async (id: string) => (await lane.outboxRows()).filter((r: any) => r.contact_id === id);
    const cooldownDays = async (id: string) => (await lane.sql(
        'SELECT EXTRACT(EPOCH FROM (next_recall_at - clock_timestamp()))/86400 AS d FROM contacts WHERE id=$1::uuid', [id]))[0].d;

    // ── selection ───────────────────────────────────────────────────────────────

    it('AUT-09: only the contact lapsed beyond the threshold, with a phone and a known visit, is recalled', async () => {
        const lapsed = await contact();
        const recent = await contact({ lastVisitDays: 100 });
        const justUnder = await contact({ lastVisitDays: 179 });
        const noPhone = await contact({ phone: null });
        const neverVisited = await contact({ lastVisitDays: null });
        await sweep();
        expect(await rowsFor(lapsed)).toHaveLength(1);
        for (const c of [recent, justUnder, noPhone, neverVisited]) {
            expect(await rowsFor(c)).toHaveLength(0);
            expect((await lane.sql('SELECT next_recall_at FROM contacts WHERE id=$1::uuid', [c]))[0].next_recall_at).toBeNull();
        }
    });

    it('AUT-09: the threshold is the configured one (60 days) and the recall is a text on the contact\'s own WhatsApp number', async () => {
        const c = await contact({ lastVisitDays: 90 });
        await sweep({ ...CONFIG, daysThreshold: 60 });
        const [row] = await rowsFor(c);
        expect(row).toMatchObject({ item_kind: 'text', channel_account_id: SENDER });
    });

    // ── the cycle ───────────────────────────────────────────────────────────────

    it('AUT-09: next_recall_at becomes now + cooldownDays (configured 30), not the default 90', async () => {
        const c = await contact();
        await sweep({ ...CONFIG, cooldownDays: 30 });
        const d = Number(await cooldownDays(c));
        expect(d).toBeGreaterThan(29.99);
        expect(d).toBeLessThan(30.01);
    });

    it('AUT-09: a second sweep the same day sends nothing and leaves the boundary where the first put it', async () => {
        const c = await contact();
        await sweep();
        const [{ first }] = await lane.sql('SELECT next_recall_at::text AS first FROM contacts WHERE id=$1::uuid', [c]);
        await sweep();
        await Promise.all([sweep(), sweep()]);
        expect(await rowsFor(c)).toHaveLength(1);
        expect((await lane.sql('SELECT next_recall_at::text AS v FROM contacts WHERE id=$1::uuid', [c]))[0].v).toBe(first);
    });

    it('AUT-09: a contact whose cooldown has expired is recalled again, with an effect of its own', async () => {
        const c = await contact({ nextRecall: '-1 hour' });
        await sweep();
        expect(await rowsFor(c)).toHaveLength(1);
        const d = Number(await cooldownDays(c));
        expect(d).toBeGreaterThan(89.9);
        // The next cycle (boundary moved to the past again) is a different effect.
        await lane.sql("UPDATE contacts SET next_recall_at = clock_timestamp() - interval '1 minute' WHERE id=$1::uuid", [c]);
        await sweep();
        expect(await rowsFor(c)).toHaveLength(2);
    });

    it('AUT-09: a contact still inside its cooldown is not recalled', async () => {
        const c = await contact({ nextRecall: '10 days' });
        await sweep();
        expect(await rowsFor(c)).toHaveLength(0);
    });

    // ── the backlog ─────────────────────────────────────────────────────────────

    it('AUT-09: 105 lapsed contacts: the first sweep serves 100, the second the other 5, nobody twice', async () => {
        const ids: string[] = [];
        for (let i = 0; i < 105; i++) ids.push(await contact({ name: `Cliente ${i}`, phone: `+57300${String(2000000 + i)}` }));
        await sweep();
        expect(await lane.outboxRows()).toHaveLength(100);
        await sweep();
        const rows = await lane.outboxRows();
        expect(rows).toHaveLength(105);
        expect(new Set(rows.map((r: any) => r.contact_id)).size).toBe(105);
    });

    // ── the cron body ───────────────────────────────────────────────────────────

    it('AUT-09: processRecalls skips a tenant with recallConfig.enabled=false and one without the plan feature', async () => {
        const c = await contact();
        tenants = [{ id: lane.tenantId, schema_name: lane.schema, settings: { recallConfig: { ...CONFIG, enabled: false } } }];
        await service.processRecalls();
        expect(await rowsFor(c)).toHaveLength(0);
        tenants = [{ id: lane.tenantId, schema_name: lane.schema, settings: { recallConfig: { ...CONFIG, enabled: true } } }];
        featureEnabled = false;
        await service.processRecalls();
        expect(await rowsFor(c)).toHaveLength(0);
        featureEnabled = true;
        await service.processRecalls();
        expect(await rowsFor(c)).toHaveLength(1);
    });

    // ── the words ───────────────────────────────────────────────────────────────

    it('AUT-09: the message fills {name} with the first name and {months} with the months since the visit', async () => {
        const c = await contact({ name: 'Maria Lopez', lastVisitDays: 210 });
        await sweep({ ...CONFIG, message: 'Hola {name}, hace {months} meses que no te vemos' });
        const [row] = await rowsFor(c);
        expect(row.payload.text).toBe('Hola Maria, hace 7 meses que no te vemos');
    });
});
