import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastQueueProcessor, BROADCAST_SETTLE_JOB } from './broadcast-queue.processor';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL, DispatchOutboxError } from '../channels/agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ A CAMPAIGN MESSAGE, THROUGH THE REAL STORE ═══
 *
 * Every recipient went straight to `sendTemplate` from a BullMQ worker: no
 * row, no lease, no receipt of its own. A restart between the decision and the
 * POST lost the message or — the job carries no `jobId` — sent it twice. And
 * nothing re-read the campaign, so pressing PAUSE stopped nothing that was
 * already queued: the operator's one explicit attempt to stop the spending was
 * the thing the design could not honour.
 *
 * ── WHY THE RECIPIENT IS NOT MARKED SENT BY THE SENDER ──────────────────────
 *
 * `campaign_recipients.status` is inside the authority that guards this very
 * row: the policy reads anything other than pending/queued as "no message is
 * owed". Marking it `sent` straight after preparing would make the effect GONE
 * at admission — the campaign would report a message the customer never
 * received, which is the exact defect the lane exists to remove, reintroduced
 * by the bookkeeping. The first test here reproduces that, and the rest pin the
 * settling pass that replaces it.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('a campaign message on the durable lane', () => {
    const tenantId = randomUUID();
    const schema = `tenant_bcastlane_${randomUUID().replace(/-/g, '')}`;
    const NUMBER = '15550005555';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let proactive: ProactiveDispatchService;
    let processor: any;
    let published: string[] = [];
    let scheduled: any[] = [];
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /** One running campaign with one queued recipient. */
    const campaign = async (over: { campaignStatus?: string; recipientStatus?: string } = {}) => {
        const contactId = randomUUID();
        const campaignId = randomUUID();
        const recipientId = randomUUID();
        await sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)',
            [contactId, 'Ana', '+573001112233', 'whatsapp']);
        await sql(`INSERT INTO campaigns(id, name, status, wa_template_name)
            VALUES($1::uuid,'Lanzamiento',$2,'promo')`,
            [campaignId, over.campaignStatus ?? 'active']);
        await sql(`INSERT INTO campaign_recipients(id, campaign_id, contact_id, phone, status)
            VALUES($1::uuid,$2::uuid,$3::uuid,'+573001112233',$4)`,
            [recipientId, campaignId, contactId, over.recipientStatus ?? 'queued']);
        return { contactId, campaignId, recipientId };
    };

    const jobData = (c: { contactId: string; campaignId: string; recipientId: string },
        over: Record<string, unknown> = {}) => ({
        tenantId, schemaName: schema, campaignId: c.campaignId, recipientId: c.recipientId,
        contactId: c.contactId, channel: 'whatsapp', phone: '+573001112233',
        templateName: 'promo', templateLanguage: 'es', templateComponents: [],
        channelAccountId: NUMBER, ...over,
    });

    const send = (c: any, over: Record<string, unknown> = {}, attemptsMade = 0) =>
        processor.process({ id: 'j', name: 'send-whatsapp', attemptsMade, opts: { attempts: 3 },
            data: jobData(c, over) });

    const settle = (c: any, attemptsMade = 0) =>
        processor.process({ id: 's', name: BROADCAST_SETTLE_JOB, attemptsMade,
            opts: { attempts: 20 }, data: jobData(c) });

    const outboxRows = async () => sql(
        `SELECT id, item_kind, state, origin_kind, channel_account_id, payload,
                operational_scope, error_code, receipt
           FROM agent_dispatch_outbox ORDER BY created_at`);

    const recipient = async (id: string) => (await sql(
        `SELECT status, error_message, message_id FROM campaign_recipients WHERE id = $1::uuid`,
        [id]))[0];

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
        prisma.getTenantSchemaName = async () => schema;
        prisma.tenant = {
            findUnique: async () => ({
                id: tenantId, schemaName: schema, isInternal: true, subscriptionStatus: 'active',
            }),
            findFirst: async () => ({ id: tenantId, schemaName: schema }),
        };

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT,
            channel_type TEXT, email TEXT)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        await sql(`CREATE TABLE campaigns(id UUID PRIMARY KEY, name TEXT, status TEXT,
            wa_template_name TEXT, ends_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE campaign_recipients(id UUID PRIMARY KEY, campaign_id UUID,
            contact_id UUID, phone TEXT, email TEXT, status TEXT, error_message TEXT,
            message_id TEXT, sent_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        proactive = new ProactiveDispatchService(prisma, store,
            { enqueueDispatch: async (_t: string, id: string) => { published.push(id); } } as any);

        processor = Object.create(BroadcastQueueProcessor.prototype);
        Object.assign(processor, {
            prisma, proactive,
            queue: { add: async (name: string, data: any, opts: any) => {
                scheduled.push({ name, data, opts }); return { id: opts?.jobId };
            } },
            // The real writers: what a campaign reports is the thing under test.
            broadcastService: {
                updateRecipientStatus: async (s: string, id: string, status: string,
                    error?: string, messageId?: string) =>
                    prisma.executeInTenantSchema(s,
                        `UPDATE campaign_recipients
                            SET status = $2, error_message = $3, message_id = COALESCE($4, message_id),
                                updated_at = NOW()
                          WHERE id = $1::uuid`, [id, status, error ?? null, messageId ?? null]),
                checkCampaignCompletion: async () => undefined,
            },
            abTestService: { updateVariantStats: async () => undefined },
            messagingService: {}, cryptoService: {}, emailService: {}, tenantSms: {},
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_bcastlane_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        published = [];
        scheduled = [];
        await sql(`TRUNCATE agent_dispatch_outbox, messages, conversations, contacts,
            campaign_recipients, campaigns CASCADE`);
    });

    // ── THE DEFECT THIS SHAPE EXISTS TO AVOID ───────────────────────────────

    it('would lose the message if the sender marked the recipient sent', async () => {
        // The reproduction, driven by hand: prepare the effect, then do what the
        // old bookkeeping did. The recipient's status is inside its own
        // authority, so the admission that should have sent the message
        // suppresses it instead — a campaign reporting a message nobody got.
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        await sql("UPDATE campaign_recipients SET status = 'sent' WHERE id = $1::uuid",
            [c.recipientId]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_gone');
    });

    it('leaves the recipient queued so the effect can still be admitted', async () => {
        // The fix, and the control for the test above.
        const c = await campaign();
        await send(c);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'queued' });
        const [row] = await outboxRows();
        expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
    });

    // ── THE ROW THE REAL STORE ACCEPTS ──────────────────────────────────────

    it('commits a template row on the number the campaign named', async () => {
        const c = await campaign();
        await send(c);
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect({ kind: rows[0].item_kind, origin: rows[0].origin_kind, state: rows[0].state })
            .toEqual({ kind: 'template', origin: 'proactive', state: 'queued' });
        expect(rows[0].channel_account_id).toBe(NUMBER);
        expect(rows[0].payload).toMatchObject({ templateName: 'promo', language: 'es' });
    });

    it('carries an authority the admission can revalidate', async () => {
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        expect(row.operational_scope).toMatchObject({
            kind: 'proactive_policy', producer: 'broadcast_message',
            entityId: c.recipientId, channelAccountId: NUMBER,
        });
    });

    it('writes the history row in the same transaction, as pending', async () => {
        const c = await campaign();
        await send(c);
        const [message] = await sql(
            "SELECT status, content_type FROM messages WHERE direction = 'outbound'");
        expect(message).toMatchObject({ status: 'pending', content_type: 'template' });
    });

    // ── REPLAY AND RACING ───────────────────────────────────────────────────

    it('collapses a BullMQ retry onto one row', async () => {
        const c = await campaign();
        await send(c);
        await send(c, {}, 1);
        expect(await outboxRows()).toHaveLength(1);
        expect(await sql("SELECT id FROM messages WHERE direction='outbound'")).toHaveLength(1);
    });

    it('prepares one row when two workers race one recipient', async () => {
        const c = await campaign();
        await Promise.allSettled([send(c), send(c)]);
        expect(await outboxRows()).toHaveLength(1);
    });

    // ── THE CAMPAIGN SOMEBODY PAUSED ────────────────────────────────────────

    it('sends nothing for a paused campaign, and does not fail its recipients', async () => {
        // Pausing is the one thing an operator does to STOP the spending, and
        // it used to stop nothing already queued. Nor may it mark recipients
        // failed: a paused campaign is one somebody means to resume.
        const c = await campaign({ campaignStatus: 'paused' });
        expect(await send(c)).toBe('skipped:suppressed');
        expect(await outboxRows()).toEqual([]);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'queued' });
    });

    it('sends nothing for a recipient already closed', async () => {
        const c = await campaign({ recipientStatus: 'sent' });
        expect(await send(c)).toBe('skipped:suppressed');
        expect(await outboxRows()).toEqual([]);
    });

    it('closes the recipient when the LANE suppresses the effect', async () => {
        // ── THE RECIPIENT NOBODY CLOSED ─────────────────────────────────────
        //
        // Two different suppressions reach this processor and only one of them
        // was handled. The cases above are the pre-send gate: the recipient is
        // no longer owed a message, and leaving the row exactly as it is is
        // correct — a paused campaign is one somebody means to resume.
        //
        // This is the other one. The message WAS owed, the producer asked the
        // lane for it, and the lane suppressed it — a ceiling, a duplicate, an
        // effect already resolved. `producerMayAdvance` is true (there is
        // nothing to retry) but `effectIsDurable` is false (no row exists), and
        // the code fell into `return 'skipped:suppressed'` without marking the
        // recipient and without scheduling the settle pass that would have.
        //
        // So the recipient stayed `queued` for ever, `checkCampaignCompletion`
        // was never called for it, and a campaign of one thousand people sat at
        // 999 done until somebody went looking. The customer is not owed a
        // message; the campaign is owed a conclusion.
        const c = await campaign();
        // Only `send` is stubbed: the rest of the lane — resolving the
        // conversation, minting the operator authority — has to run for real,
        // or the test would be asserting about a path production does not take.
        const real = (processor as any).proactive.send;
        (processor as any).proactive.send =
            async () => ({ kind: 'suppressed', reason: 'spend_cap_exhausted' });
        let completed = 0;
        const realCompletion = (processor as any).broadcastService.checkCampaignCompletion;
        (processor as any).broadcastService.checkCampaignCompletion = async () => { completed += 1; };
        try {
            expect(await send(c)).toBe('skipped:suppressed');
            expect(await outboxRows()).toEqual([]);
            expect(await recipient(c.recipientId)).toMatchObject({
                status: 'failed', error_message: expect.stringContaining('spend_cap_exhausted'),
            });
            // The conclusion, which is the half that was missing: without this
            // the campaign never reports finished.
            expect(completed).toBe(1);
        } finally {
            (processor as any).proactive.send = real;
            (processor as any).broadcastService.checkCampaignCompletion = realCompletion;
        }
    });

    it('does not schedule a settle pass for an effect that has no row', async () => {
        // The settle pass reads the outbox row this recipient produced. A
        // suppressed effect produced none, so scheduling one would be twenty
        // attempts against something that will never exist — and its own
        // give-up path would then mark the recipient a second time.
        const c = await campaign();
        const real = (processor as any).proactive.send;
        (processor as any).proactive.send =
            async () => ({ kind: 'suppressed', reason: 'duplicate_recent_send' });
        try {
            scheduled.length = 0;
            await send(c);
            expect(scheduled).toEqual([]);
        } finally {
            (processor as any).proactive.send = real;
        }
    });

    it('suppresses one whose campaign was paused after preparing', async () => {
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        await sql("UPDATE campaigns SET status = 'paused' WHERE id = $1::uuid", [c.campaignId]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_gone');
    });

    // ── THE SENDER THAT HAS TO BE NAMED ─────────────────────────────────────

    it('refuses a campaign that never named the account that pays', async () => {
        const c = await campaign();
        expect(await send(c, { channelAccountId: undefined })).toBe('skipped:connection_unnamed');
        expect(await outboxRows()).toEqual([]);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'failed' });
    });

    it('refuses a recipient with no contact behind it', async () => {
        const c = await campaign();
        expect(await send(c, { contactId: null })).toBe('skipped:recipient_without_contact');
        expect(await outboxRows()).toEqual([]);
    });

    // ── WHAT HAPPENS WHEN THE COMMIT DOES NOT ───────────────────────────────

    it('does not close the recipient when the outbox refuses the batch', async () => {
        const c = await campaign();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new DispatchOutboxError('dispatch_binding_changed'));
        await expect(send(c)).rejects.toThrow(/broadcast_not_dispatched:refused/);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'queued' });
        expect(scheduled).toEqual([]);
        broken.mockRestore();
    });

    it('marks the recipient failed only on the last attempt', async () => {
        const c = await campaign();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValue(new DispatchOutboxError('dispatch_binding_changed'));
        await expect(send(c, {}, 2)).rejects.toThrow(/broadcast_not_dispatched/);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'failed' });
        broken.mockRestore();
    });

    it('leaves it retryable when the commit was merely uncertain', async () => {
        const c = await campaign();
        const flaky = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
        await expect(send(c)).rejects.toThrow(/broadcast_not_dispatched:deferred/);
        flaky.mockRestore();
        await send(c);
        expect(await outboxRows()).toHaveLength(1);
    });

    it('commits the row even when nothing could be published', async () => {
        const c = await campaign();
        const live = (proactive as any).queue;
        (proactive as any).queue = {
            enqueueDispatch: async () => { throw new Error('redis is down'); },
        };
        try { await send(c); } finally { (proactive as any).queue = live; }
        expect(published).toEqual([]);
        expect(await outboxRows()).toHaveLength(1);
        expect(scheduled).toHaveLength(1);
    });

    // ── THE SETTLING PASS ───────────────────────────────────────────────────

    it('schedules a settling pass for the recipient it committed', async () => {
        const c = await campaign();
        await send(c);
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0]).toMatchObject({
            name: BROADCAST_SETTLE_JOB,
            opts: { jobId: `bcast-settle-${c.campaignId}-${c.recipientId}` },
        });
    });

    it('keeps asking while the effect is still in flight', async () => {
        const c = await campaign();
        await send(c);
        await expect(settle(c)).rejects.toThrow(/broadcast_effect_in_flight:queued/);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'queued' });
    });

    it('marks the recipient sent with the provider receipt once it arrives', async () => {
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'sent', receipt: 'wamid.CAMPAIGN' });

        expect(await settle(c)).toContain('settled:sent');
        expect(await recipient(c.recipientId)).toMatchObject({
            status: 'sent', message_id: 'wamid.CAMPAIGN',
        });
    });

    it('closes the recipient on the last ask rather than leaving the campaign short', async () => {
        // ── A CAMPAIGN CANNOT HANG ON A ROW THAT KEEPS BACKING OFF ──────────
        //
        // The settling pass has a fixed budget of twenty asks, about ten
        // minutes. A dispatch row held in `failed` by a condition that clears —
        // a funding pause, a time zone nobody set — now backs off durably and
        // outlives that easily. The budget ran out, the last throw went to the
        // failed handler, and the recipient was never closed either way:
        // `checkCampaignCompletion` never ran for it and the campaign sat one
        // short of done for ever.
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        await sql(`UPDATE agent_dispatch_outbox
                      SET state = 'failed', error_code = 'spend_funding_not_ready',
                          available_at = NOW() + INTERVAL '6 hours'
                    WHERE id = $1::uuid`, [row.id]);

        // Not the last ask: it keeps asking, which is the right answer while
        // there is still a window left.
        await expect(settle(c, 5)).rejects.toThrow(/broadcast_effect_in_flight/);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'queued' });

        // The last one closes it, with what the outbox said, and NOT as sent:
        // nothing was delivered.
        expect(await settle(c, 19)).toContain('settled:unsettled');
        const closed = await recipient(c.recipientId);
        expect(closed.status).toBe('failed');
        expect(String(closed.error_message)).toContain('unsettled_after_window');
        expect(String(closed.error_message)).toContain('spend_funding_not_ready');
    });

    it('never closes a recipient whose POST may be in the air', async () => {
        // `admitted` means a worker holds the lease and was granted permission
        // to POST. Closing it `failed` on the last ask would record a delivery
        // that happened as one that did not: the variant counts a failure, the
        // campaign reports finished, and the customer has the message with Meta
        // billing for it. The lease sweep is what resolves an attempt nobody
        // came back from; this pass must not pre-empt it.
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        await sql(`UPDATE agent_dispatch_outbox
                      SET state = 'admitted', lease_token = gen_random_uuid(),
                          lease_expires_at = NOW() + INTERVAL '5 minutes'
                    WHERE id = $1::uuid`, [row.id]);

        await expect(settle(c, 19)).rejects.toThrow(/broadcast_effect_in_flight/);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'queued' });
    });

    it('marks it failed, with the reason, when the effect was suppressed', async () => {
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        await sql("UPDATE campaigns SET status = 'cancelled' WHERE id = $1::uuid", [c.campaignId]);
        await expect(store.admit(tenantId, row.id)).rejects.toThrow();

        expect(await settle(c)).toContain('settled:suppressed');
        const closed = await recipient(c.recipientId);
        expect(closed.status).toBe('failed');
        expect(String(closed.error_message)).toContain('proactive_gone');
    });

    it('retries rather than inventing an answer when the row is gone', async () => {
        const c = await campaign();
        await send(c);
        await sql('TRUNCATE agent_dispatch_outbox CASCADE');
        await expect(settle(c)).rejects.toThrow(/broadcast_effect_missing/);
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'queued' });
    });

    it('settles a delivered message even after the subscription lapses', async () => {
        // The settling pass closes a message that has ALREADY been sent and
        // charged. Running it through a gate meant to stop NEW spending would
        // mark a delivered message failed because the tenant's billing lapsed
        // in between — the campaign's report would then contradict the
        // customer's phone.
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'sent', receipt: 'wamid.CAMPAIGN' });

        const live = prisma.tenant;
        prisma.tenant = {
            ...live,
            findUnique: async () => ({
                id: tenantId, schemaName: schema, isInternal: false,
                subscriptionStatus: 'expired',
                subscription: { status: 'expired', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
            }),
        };
        try { expect(await settle(c)).toContain('settled:sent'); } finally { prisma.tenant = live; }
        expect(await recipient(c.recipientId)).toMatchObject({ status: 'sent' });
    });

    it('settles the same recipient twice without changing its mind', async () => {
        const c = await campaign();
        await send(c);
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'sent', receipt: 'wamid.CAMPAIGN' });
        await settle(c);
        await settle(c);
        expect(await recipient(c.recipientId)).toMatchObject({
            status: 'sent', message_id: 'wamid.CAMPAIGN',
        });
    });
});
