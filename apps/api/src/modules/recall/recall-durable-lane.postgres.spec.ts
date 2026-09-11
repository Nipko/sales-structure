import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecallService } from './recall.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL, DispatchOutboxError } from '../channels/agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ THE REACTIVATION, THROUGH THE REAL STORE ═══
 *
 * The recall cron enqueued into `outbound_queue` — Redis, no row — and then
 * wrote `contacts.next_recall_at` as a SEPARATE statement, unconditionally. Two
 * failures fell straight out of that:
 *
 *   · a restart between the enqueue and the cooldown write sent the message and
 *     then asked the same person again the next morning, and the morning after
 *     that. "Hace tiempo que no nos vemos", daily, billed each time;
 *   · a restart the other way round moved the cooldown for a message that never
 *     left, and the customer heard nothing for ninety days.
 *
 * And the ORDER is not free here: `next_recall_at` is inside the recall's own
 * revision, so preparing the effect first and moving the cooldown afterwards
 * would make every prepared recall on the platform stale at admission. The suite
 * pins the order as well as the effect.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the recall on the durable lane', () => {
    const tenantId = randomUUID();
    const schema = `tenant_recalllane_${randomUUID().replace(/-/g, '')}`;
    const KNOWN_NUMBER = '15550002222';
    const OTHER_NUMBER = '15559990000';

    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let proactive: ProactiveDispatchService;
    let service: any;
    let published: string[] = [];
    let publishFails = false;
    let resolveAsked: Array<string | null> = [];
    let connectionAmbiguous = false;
    jest.setTimeout(180_000);

    const config = { daysThreshold: 180, cooldownDays: 90, channelType: 'whatsapp', message: '' };

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /** Somebody whose last appointment was a year ago, never recalled. */
    const lapsed = async (over: {
        withThread?: boolean;
        threadAccount?: string;
        threadStatus?: string;
        nextRecallDays?: number | null;
    } = {}) => {
        const contactId = randomUUID();
        await sql(`INSERT INTO contacts(id,name,phone,channel_type,last_appointment_at,
                next_recall_at,last_contact_at)
            VALUES($1::uuid,'Ana Pérez','+573001112233','whatsapp',
                clock_timestamp() - interval '365 days',
                CASE WHEN $2::int IS NULL THEN NULL
                     ELSE clock_timestamp() + ($2::int * INTERVAL '1 day') END,
                clock_timestamp() - interval '365 days')`,
            [contactId, over.nextRecallDays ?? null]);
        if (over.withThread !== false) {
            await sql(`INSERT INTO conversations(contact_id,channel_type,channel_account_id,status)
                VALUES($1::uuid,'whatsapp',$2,$3)`,
                [contactId, over.threadAccount ?? KNOWN_NUMBER, over.threadStatus ?? 'active']);
        }
        return contactId;
    };

    const cooldown = async (contactId: string): Promise<string | null> => {
        const [row] = await sql('SELECT next_recall_at::text AS value FROM contacts WHERE id=$1::uuid',
            [contactId]);
        return row?.value ?? null;
    };

    const outboxRows = async () => sql(
        `SELECT id, item_kind, state, origin_kind, channel_account_id, conversation_id,
                contact_id, payload, error_code, attempts, operational_scope
           FROM agent_dispatch_outbox ORDER BY created_at`);

    const build = () => {
        const built: any = Object.create(RecallService.prototype);
        Object.assign(built, {
            prisma,
            proactive,
            throttle: { isFeatureEnabled: async () => true },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            connections: {
                resolve: async (input: any) => {
                    resolveAsked.push(input.channelAccountId ?? null);
                    if (connectionAmbiguous && !input.channelAccountId) return null;
                    return {
                        accessToken: 'token',
                        accountId: input.channelAccountId || KNOWN_NUMBER,
                    };
                },
            },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return built;
    };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRaw = client.$queryRaw.bind(client);
        prisma.getTenantSchemaName = async () => schema;
        (prisma as any).tenant = {
            findUnique: async () => ({ id: tenantId, schemaName: schema, language: 'es-CO' }),
            findFirst: async () => ({ id: tenantId, schemaName: schema }),
        };

        // `TIMESTAMP`, not `TIMESTAMPTZ`: that is what production's contacts
        // columns are, and the whole cooldown comparison happens against them.
        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT, phone TEXT, channel_type TEXT, email TEXT,
            last_appointment_at TIMESTAMP, next_recall_at TIMESTAMP,
            last_contact_at TIMESTAMP DEFAULT NOW())`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}',
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        proactive = new ProactiveDispatchService(prisma, store, {
            enqueueDispatch: async (_t: string, id: string) => {
                if (publishFails) throw new Error('redis_unreachable');
                published.push(id);
            },
        } as any);
        service = build();
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_recalllane_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe(
                'DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        published = [];
        publishFails = false;
        resolveAsked = [];
        connectionAmbiguous = false;
        await sql('TRUNCATE agent_dispatch_outbox, messages, conversations, contacts CASCADE');
    });

    const run = () => service.processForTenant(tenantId, schema, config);

    // ── THE ROW THE REAL STORE ACCEPTS ──────────────────────────────────────

    it('commits one proactive row the real store accepts', async () => {
        const contactId = await lapsed();
        expect(await run()).toBe(1);
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect({ kind: rows[0].item_kind, origin: rows[0].origin_kind, state: rows[0].state })
            .toEqual({ kind: 'text', origin: 'proactive', state: 'queued' });
        expect(rows[0].contact_id).toBe(contactId);
        expect(rows[0].channel_account_id).toBe(KNOWN_NUMBER);
        expect(String(rows[0].payload.text)).toContain('Ana');
    });

    it('writes the history row in the same transaction, as pending', async () => {
        await lapsed();
        await run();
        const [message] = await sql(
            "SELECT status, direction, content_type FROM messages WHERE direction = 'outbound'");
        expect(message).toMatchObject({ status: 'pending', content_type: 'text' });
    });

    it('carries an authority about the CONTACT the admission can revalidate', async () => {
        const contactId = await lapsed();
        await run();
        const [row] = await outboxRows();
        expect(row.operational_scope).toMatchObject({
            kind: 'proactive_policy', producer: 'recall_reminder',
            entityId: contactId, channelAccountId: KNOWN_NUMBER, tenantId,
        });
        expect(String(row.operational_scope.entityRevision)).toMatch(/^[a-f0-9]{64}$/);
    });

    // ── THE ORDER: THE COOLDOWN MOVES FIRST, ON PURPOSE ─────────────────────

    it('still admits the effect after the cooldown moved', async () => {
        // THE ORDERING TEST, and the reason the general "business state last"
        // rule is inverted here. `next_recall_at` is inside the recall's
        // revision. Prepare first and move the cooldown after, and the revision
        // taken at prepare describes a contact that no longer exists — the
        // admission calls it stale and suppresses it, EVERY time, and nobody on
        // the platform ever receives a recall.
        const contactId = await lapsed();
        await run();
        const moved = await cooldown(contactId);
        expect(moved).not.toBeNull();
        const [row] = await outboxRows();
        expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
    });

    it('moves the cooldown roughly a cooldown into the future', async () => {
        const contactId = await lapsed();
        await run();
        const [row] = await sql(
            `SELECT (next_recall_at > clock_timestamp() + interval '89 days'
                 AND next_recall_at < clock_timestamp() + interval '91 days') AS ok
               FROM contacts WHERE id = $1::uuid`, [contactId]);
        expect(row.ok).toBe(true);
    });

    it('does not recall somebody whose cooldown has not expired', async () => {
        const contactId = await lapsed({ nextRecallDays: 30 });
        expect(await run()).toBe(0);
        expect(await outboxRows()).toEqual([]);
        // And it did not touch their cooldown on the way past.
        expect(await cooldown(contactId)).not.toBeNull();
    });

    // ── REPLAY AND RACE ─────────────────────────────────────────────────────

    it('commits one row when the same cycle is attempted twice', async () => {
        // The retry after a release: the cycle boundary is the same, so the
        // origin is the same, and the second attempt finds the row the first one
        // committed rather than sending a second "we miss you".
        const contactId = await lapsed();
        await run();
        // Put the boundary back by hand, exactly as `releaseCooldown` would.
        await sql('UPDATE contacts SET next_recall_at = NULL WHERE id = $1::uuid', [contactId]);
        await run();
        expect(await outboxRows()).toHaveLength(1);
        expect(await sql("SELECT id FROM messages WHERE direction='outbound'")).toHaveLength(1);
        // And the cooldown is moved again: the effect is owed exactly once and
        // it is owed, so nothing further is due from this cycle.
        expect(await cooldown(contactId)).not.toBeNull();
    });

    it('commits one row when two sweeps run at once', async () => {
        // Two crons, or a cron and the dashboard's "send recall now". Without
        // the claim both read the contact as due and the customer is asked
        // twice in one morning.
        await lapsed();
        const [first, second] = await Promise.all([run(), run()]);
        expect(await outboxRows()).toHaveLength(1);
        expect(await sql("SELECT id FROM messages WHERE direction='outbound'")).toHaveLength(1);
        expect(first + second).toBe(1);
    });

    it('gives the NEXT cycle a row of its own', async () => {
        // The control for the replay test: "one row" must not mean "one row per
        // contact for ever". A cycle that has genuinely come round again is a
        // different effect and gets a different origin.
        const contactId = await lapsed();
        await run();
        // Ninety days later: the cooldown has expired on its own.
        await sql(`UPDATE contacts SET next_recall_at = clock_timestamp() - interval '1 minute'
                    WHERE id = $1::uuid`, [contactId]);
        await run();
        expect(await outboxRows()).toHaveLength(2);
    });

    // ── THE COOLDOWN IS GIVEN BACK WHEN NOTHING DURABLE HAPPENED ────────────

    it('releases the cooldown when the lane could not commit', async () => {
        // THE DEFECT, inverted. The old code wrote the cooldown whatever
        // happened, so a failed send bought ninety days of silence. Here the
        // boundary goes back exactly where it was and tomorrow's pass retries.
        const contactId = await lapsed();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
        expect(await run()).toBe(0);
        broken.mockRestore();
        expect(await outboxRows()).toEqual([]);
        expect(await cooldown(contactId)).toBeNull();
        // And the retry genuinely happens.
        expect(await run()).toBe(1);
    });

    it('releases the cooldown when the outbox refuses the batch', async () => {
        const contactId = await lapsed();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new DispatchOutboxError('dispatch_binding_changed'));
        expect(await run()).toBe(0);
        broken.mockRestore();
        expect(await cooldown(contactId)).toBeNull();
    });

    it('releases the cooldown when no thread can be opened', async () => {
        const contactId = await lapsed({ withThread: false });
        await sql('ALTER TABLE conversations ADD CONSTRAINT no_new_threads CHECK (false) NOT VALID');
        try {
            expect(await run()).toBe(0);
        } finally {
            await sql('ALTER TABLE conversations DROP CONSTRAINT no_new_threads');
        }
        expect(await outboxRows()).toEqual([]);
        expect(await cooldown(contactId)).toBeNull();
    });

    it('restores a cooldown that was NOT null to its exact previous value', async () => {
        // Microseconds. `next_recall_at` is a naive TIMESTAMP with microsecond
        // precision and a JavaScript Date carries milliseconds, so a value that
        // went through a Date would come back three digits short — the guarded
        // release would never match its own row and the cooldown would stay
        // moved for ever.
        const contactId = await lapsed({ nextRecallDays: 30 });
        await sql(`UPDATE contacts SET next_recall_at = TIMESTAMP '2026-01-02 03:04:05.123456'
                    WHERE id = $1::uuid`, [contactId]);
        const before = await cooldown(contactId);
        expect(before).toContain('.123456');
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new Error('transient'));
        await run();
        broken.mockRestore();
        expect(await cooldown(contactId)).toBe(before);
    });

    it('keeps the cooldown when the policy says nothing is owed', async () => {
        // A contact with no number is a suppression, not a failure. Giving the
        // cycle back would retry every single morning against somebody who can
        // never be reached.
        const contactId = await lapsed();
        // Emptied AFTER the sweep read them, which is exactly the window the
        // policy authority exists to close.
        const original = (RecallService.prototype as any).claimCooldown;
        const spy = jest.spyOn(RecallService.prototype as any, 'claimCooldown')
            .mockImplementation(async function (this: any, ...args: any[]) {
                const claim = await original.apply(this, args);
                await sql("UPDATE contacts SET phone = '' WHERE id = $1::uuid", [contactId]);
                return claim;
            });
        expect(await run()).toBe(0);
        spy.mockRestore();
        expect(await outboxRows()).toEqual([]);
        expect(await cooldown(contactId)).not.toBeNull();
    });

    it('claims nothing when nobody has said which number pays', async () => {
        // The resolver refuses before the claim is taken, so the contact stays
        // due and the tenant gets a task rather than silence.
        connectionAmbiguous = true;
        const contactId = await lapsed({ withThread: false });
        expect(await run()).toBe(0);
        expect(resolveAsked).toEqual([null]);
        expect(await outboxRows()).toEqual([]);
        expect(await cooldown(contactId)).toBeNull();
    });

    it('bills the number this person last spoke to', async () => {
        await lapsed({ threadAccount: OTHER_NUMBER });
        await run();
        expect(resolveAsked).toEqual([OTHER_NUMBER]);
        expect((await outboxRows())[0].channel_account_id).toBe(OTHER_NUMBER);
    });

    it('will not take the number off a thread somebody closed', async () => {
        await lapsed({ threadAccount: OTHER_NUMBER, threadStatus: 'archived' });
        await run();
        expect(resolveAsked).toEqual([null]);
        expect((await outboxRows())[0].channel_account_id).toBe(KNOWN_NUMBER);
    });

    // ── THE ROW SURVIVES A QUEUE THAT DOES NOT ──────────────────────────────

    it('keeps the committed row and the cooldown when publishing fails', async () => {
        publishFails = true;
        const contactId = await lapsed();
        expect(await run()).toBe(1);
        expect(published).toEqual([]);
        expect(await outboxRows()).toHaveLength(1);
        // The row is the record: the recovery pass will publish it, so the
        // cooldown correctly stays moved.
        expect(await cooldown(contactId)).not.toBeNull();
    });

    // ── THE CONTACT THAT MOVED BETWEEN PREPARING AND ADMITTING ──────────────

    it('suppresses a recall whose cooldown was cleared after preparing', async () => {
        // `processAutoComplete` sets `next_recall_at = NULL` when somebody
        // finally shows up. A recall prepared before that and delivered after it
        // asks a customer who was in the chair yesterday why they never come.
        const contactId = await lapsed();
        await run();
        const [row] = await outboxRows();
        await sql('UPDATE contacts SET next_recall_at = NULL WHERE id = $1::uuid', [contactId]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        const [after] = await outboxRows();
        expect(after.state).toBe('suppressed');
        expect(String(after.error_code)).toContain('proactive_stale');
    });

    it('suppresses a recall whose number was removed after preparing', async () => {
        const contactId = await lapsed();
        await run();
        const [row] = await outboxRows();
        await sql("UPDATE contacts SET phone = '' WHERE id = $1::uuid", [contactId]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_gone');
    });

    it('refuses to leave from a number the authority did not name', async () => {
        await lapsed();
        await run();
        const [row] = await outboxRows();
        await sql('UPDATE agent_dispatch_outbox SET channel_account_id = $1', [OTHER_NUMBER]);
        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_binding_changed' });
    });

    // ── WHAT THE PROVIDER ANSWERED ──────────────────────────────────────────

    it('records a provider failure without claiming the customer was told', async () => {
        await lapsed();
        await run();
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'failed', errorCode: 'meta_500' });
        const [after] = await outboxRows();
        expect({ state: after.state, code: after.error_code, attempts: after.attempts })
            .toEqual({ state: 'failed', code: 'meta_500', attempts: 1 });
        const [message] = await sql("SELECT status FROM messages WHERE direction='outbound'");
        expect(message.status).toBe('pending');
    });

    it('parks an uncertain outcome for a person instead of resending', async () => {
        await lapsed();
        await run();
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'reconciliation_required', errorCode: 'timeout_after_post' });
        expect((await outboxRows())[0].state).toBe('reconciliation_required');
        await expect(store.admit(tenantId, row.id)).rejects.toBeTruthy();
        const [message] = await sql("SELECT status FROM messages WHERE direction='outbound'");
        expect(message.status).toBe('pending');
    });

    it('never re-admits an accepted effect', async () => {
        await lapsed();
        await run();
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'sent', receipt: 'wamid.RECALL' });
        await expect(store.admit(tenantId, row.id)).rejects.toBeTruthy();
        const [message] = await sql("SELECT status FROM messages WHERE direction='outbound'");
        expect(message.status).toBe('sent');
    });
});
