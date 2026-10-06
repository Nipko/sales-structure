import { randomUUID } from 'crypto';
import { BroadcastService } from './broadcast.service';
import { AbTestService } from './ab-test.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-23 — a broadcast campaign from scheduling to its statistics, on real PostgreSQL
 * with the real service and the real A/B service; the queue, the spend gate and the
 * account lookups are doubles.
 *
 *   schedule   a scheduled campaign is untouched until `scheduled_at`, then launched once.
 *   cron x2    the launch cron runs on the API and on the worker: the campaign is queued once.
 *   authority  a launch whose actor is no longer a verified, active user pauses the campaign
 *              and queues nothing.
 *   audience   WhatsApp reaches contacts with a phone only; one recipient row per contact.
 *   A/B        recipients are split by the declared percentages, each job carries its own
 *              variant's template, the winner is chosen only on a significant sample.
 *   stats      per-status counts, completion (`finished`, one `campaign.completed` event).
 *
 * Oracle: campaigns / campaign_recipients / campaign_variants rows and the jobs recorded
 * by the queue double.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-23: broadcast campaigns', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    let abTests: any;
    let jobs: any[] = [];
    let budgets: any[] = [];
    let verified = true;
    let emitted: Array<{ name: string; payload: any }> = [];
    const actorId = randomUUID();

    const build = () => {
        const svc: any = Object.create(BroadcastService.prototype);
        Object.assign(svc, {
            prisma: lane.prisma,
            redis: { get: async (key: string) => (key.endsWith(':schema') ? lane.schema : 'ready'), set: async () => undefined },
            broadcastQueue: { addBulk: async (batch: any[]) => { jobs.push(...batch); } },
            spendGate: { budgetTask: async (_s: string, input: any) => { budgets.push(input); return { capDeliveries: input.deliveries, usedDeliveries: 0 }; } },
            abTestService: abTests,
            eventEmitter: { emit: (name: string, payload: any) => emitted.push({ name, payload }) },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            selfServiceBroadcastChannels: new Set(['whatsapp']),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        svc.ensureBroadcastTables = async () => undefined;
        return svc;
    };

    beforeAll(async () => {
        lane = await openLane('n3bcastc', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE campaigns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(500) NOT NULL, channel VARCHAR(50) DEFAULT 'whatsapp',
                wa_template_name VARCHAR(255), status VARCHAR(50) DEFAULT 'draft', starts_at TIMESTAMP, ends_at TIMESTAMP, scheduled_at TIMESTAMPTZ,
                metadata JSONB DEFAULT '{}', is_ab_test BOOLEAN DEFAULT false, ab_test_config JSONB,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE campaign_recipients(id UUID PRIMARY KEY, campaign_id UUID, contact_id UUID, phone TEXT, email TEXT,
                channel TEXT DEFAULT 'whatsapp', status TEXT, variant_id UUID, error_message TEXT, provider_message_id TEXT, sent_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE campaign_variants(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID NOT NULL, name TEXT NOT NULL,
                content JSONB NOT NULL, percentage INTEGER NOT NULL DEFAULT 50, is_winner BOOLEAN DEFAULT false,
                stats JSONB DEFAULT '{"sent":0,"delivered":0,"read":0,"responded":0,"failed":0}', created_at TIMESTAMPTZ DEFAULT NOW())`,
        ]);
        (lane.prisma as any).user = { findFirst: async () => (verified ? { id: actorId } : null) };
        (lane.prisma as any).channelAccount = { findFirst: async () => ({ accountId: '15550002222', wabaTimezone: 'America/Bogota' }) };
        (lane.prisma as any).$queryRaw = async () => [{ id: lane.tenantId, schema_name: lane.schema }];
        abTests = Object.create(AbTestService.prototype);
        Object.assign(abTests, {
            prisma: lane.prisma, redis: { get: async () => 'true', set: async () => undefined },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        service = build();
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        jobs = []; budgets = []; emitted = []; verified = true;
        await lane.sql('TRUNCATE campaign_variants, campaign_recipients, campaigns, contacts, opt_out_records, leads CASCADE');
    });

    const contact = (name: string, phone: string | null, email: string | null = null) =>
        lane.sql('INSERT INTO contacts(id,name,phone,email,channel_type) VALUES($1::uuid,$2,$3,$4,$5)', [randomUUID(), name, phone, email, 'whatsapp']);
    const campaign = async (over: Record<string, any> = {}) => service.createCampaign(lane.tenantId, {
        name: 'Promo', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all', channelAccountId: '15550002222', ...over }, actorId);
    const row = async (id: string) => (await lane.sql('SELECT status, starts_at, ends_at, scheduled_at, metadata FROM campaigns WHERE id=$1::uuid', [id]))[0];
    const recipientStatuses = async (id: string) => (await lane.sql('SELECT status, COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1::uuid GROUP BY status', [id]))
        .reduce((acc: any, r: any) => ({ ...acc, [r.status]: r.n }), {});
    const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

    // ── schedule ────────────────────────────────────────────────────────────────

    it('AUT-23: a scheduled campaign is untouched before its time, then launched once and not again', async () => {
        await contact('Ana', '+573001110001');
        await contact('Beto', '+573001110002');
        const c = await campaign({ scheduledAt: hoursFromNow(2) });
        expect((await row(c.id)).status).toBe('scheduled');
        await service.launchScheduledCampaigns();
        expect(jobs).toHaveLength(0);
        expect((await row(c.id)).status).toBe('scheduled');
        expect(await recipientStatuses(c.id)).toEqual({ pending: 2 });
        // Time passes: the schedule is now in the past.
        await lane.sql("UPDATE campaigns SET scheduled_at = NOW() - interval '1 minute' WHERE id=$1::uuid", [c.id]);
        await service.launchScheduledCampaigns();
        const launched = await row(c.id);
        expect(launched.status).toBe('active');
        expect(launched.starts_at).not.toBeNull();
        expect(await recipientStatuses(c.id)).toEqual({ queued: 2 });
        expect(jobs).toHaveLength(2);
        expect(jobs.every(j => j.data.campaignId === c.id && j.data.templateName === 'promo' && j.data.channelAccountId === '15550002222')).toBe(true);
        await service.launchScheduledCampaigns();
        expect(jobs).toHaveLength(2);
        expect(budgets).toHaveLength(1);
        expect(budgets[0]).toMatchObject({ taskId: c.id, deliveries: 2 });
    });

    it('AUT-23: the launch cron on the API and on the worker queues the campaign once', async () => {
        await contact('Ana', '+573001110001');
        const c = await campaign({ scheduledAt: hoursFromNow(1) });
        await lane.sql("UPDATE campaigns SET scheduled_at = NOW() - interval '1 minute' WHERE id=$1::uuid", [c.id]);
        const held = new Set<string>();
        const sharedLock = { runExclusive: async (name: string, _t: number, fn: any) => { if (held.has(name)) return; held.add(name); await fn(); } };
        const api = build(), worker = build();
        api.cronLock = sharedLock; worker.cronLock = sharedLock;
        await Promise.all([api.launchScheduledCampaignsCron(), worker.launchScheduledCampaignsCron()]);
        expect(jobs).toHaveLength(1);
    });

    it('AUT-23: a due campaign whose launcher is no longer a verified user is paused with the reason and queues nothing', async () => {
        await contact('Ana', '+573001110001');
        const c = await campaign({ scheduledAt: hoursFromNow(1) });
        await lane.sql("UPDATE campaigns SET scheduled_at = NOW() - interval '1 minute' WHERE id=$1::uuid", [c.id]);
        verified = false;
        await service.launchScheduledCampaigns();
        const paused = await row(c.id);
        expect(paused.status).toBe('paused');
        expect(paused.metadata.launchBlock).toMatchObject({ code: 'email_not_verified' });
        expect(jobs).toHaveLength(0);
        expect(await recipientStatuses(c.id)).toEqual({ pending: 1 });
    });

    // ── audience ────────────────────────────────────────────────────────────────

    it('AUT-23: WhatsApp reaches contacts with a phone only, one recipient row per contact', async () => {
        await contact('Con telefono', '+573001110001');
        await contact('Solo correo', null, 'solo@example.invalid');
        await contact('Telefono vacio', '   ');
        await contact('Otro', '+573001110002');
        const c = await campaign();
        expect(c.recipientCount).toBe(2);
        const rows = await lane.sql('SELECT phone, status FROM campaign_recipients WHERE campaign_id=$1::uuid ORDER BY phone', [c.id]);
        expect(rows).toEqual([{ phone: '+573001110001', status: 'pending' }, { phone: '+573001110002', status: 'pending' }]);
    });

    it('AUT-23: launching a campaign that is already active or finished is refused', async () => {
        await contact('Ana', '+573001110001');
        const c = await campaign();
        await service.launchCampaign(lane.tenantId, c.id, actorId);
        await expect(service.launchCampaign(lane.tenantId, c.id, actorId)).rejects.toThrow(/cannot be launched from status "active"/);
        expect(jobs).toHaveLength(1);
    });

    // ── A/B ─────────────────────────────────────────────────────────────────────

    it('AUT-23: A/B 70/30: recipients are split by percentage and each job carries its own variant\'s template', async () => {
        for (let i = 0; i < 10; i++) await contact(`Cliente ${i}`, `+57300111${String(1000 + i)}`);
        const c = await campaign({ variants: [
            { name: 'A', percentage: 70, content: { whatsapp: { templateName: 'promo_a' } } },
            { name: 'B', percentage: 30, content: { whatsapp: { templateName: 'promo_b' } } },
        ] });
        await service.launchCampaign(lane.tenantId, c.id, actorId);
        const variants = await lane.sql('SELECT id, name FROM campaign_variants ORDER BY name');
        const split = await lane.sql('SELECT variant_id, COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1::uuid GROUP BY variant_id', [c.id]);
        const byName = Object.fromEntries(variants.map((v: any) => [v.name, split.find((s: any) => s.variant_id === v.id)?.n ?? 0]));
        expect(byName).toEqual({ A: 7, B: 3 });
        expect(jobs).toHaveLength(10);
        for (const job of jobs) {
            const variant = variants.find((v: any) => v.id === job.data.variantId);
            expect(variant).toBeDefined();
            expect(job.data.templateName).toBe(variant.name === 'A' ? 'promo_a' : 'promo_b');
        }
    });

    it('AUT-23: A/B variant percentages that do not add up to 100 are refused', async () => {
        await contact('Ana', '+573001110001');
        await expect(campaign({ variants: [
            { name: 'A', percentage: 60, content: {} }, { name: 'B', percentage: 30, content: {} }] })).rejects.toThrow(/sum to 100/);
    });

    const variantsWithStats = async (a: any, b: any) => {
        const c = await lane.sql("INSERT INTO campaigns(name,status,is_ab_test) VALUES('AB','active',true) RETURNING id");
        const id = c[0].id;
        await lane.sql('INSERT INTO campaign_variants(campaign_id,name,content,percentage,stats) VALUES($1::uuid,$2,$3::jsonb,50,$4::jsonb),($1::uuid,$5,$3::jsonb,50,$6::jsonb)',
            [id, 'A', '{}', JSON.stringify(a), 'B', JSON.stringify(b)]);
        return id as string;
    };
    const winners = async (id: string) => (await lane.sql('SELECT name FROM campaign_variants WHERE campaign_id=$1::uuid AND is_winner ORDER BY name', [id])).map((r: any) => r.name);

    it('AUT-23: the winner is chosen only on a significant sample, and it is the variant with the better response rate', async () => {
        const small = await variantsWithStats({ sent: 20, responded: 15 }, { sent: 20, responded: 1 });
        expect(await abTests.autoSelectWinner(lane.schema, small)).toBe(false);
        expect(await winners(small)).toEqual([]);
        const tie = await variantsWithStats({ sent: 100, responded: 20 }, { sent: 100, responded: 21 });
        expect(await abTests.autoSelectWinner(lane.schema, tie)).toBe(false);
        const clear = await variantsWithStats({ sent: 100, responded: 10 }, { sent: 100, responded: 40 });
        expect(await abTests.autoSelectWinner(lane.schema, clear)).toBe(true);
        expect(await winners(clear)).toEqual(['B']);
        expect(await abTests.autoSelectWinner(lane.schema, clear)).toBe(false);     // once
        expect(await winners(clear)).toEqual(['B']);
    });

    // ── stats and completion ────────────────────────────────────────────────────

    it('AUT-23: stats count every recipient by status and by channel; sent includes delivered and read', async () => {
        const [c] = await lane.sql("INSERT INTO campaigns(name,status,starts_at) VALUES('S','active',NOW()) RETURNING id");
        for (const status of ['queued', 'sent', 'sent', 'delivered', 'read', 'failed']) {
            await lane.sql("INSERT INTO campaign_recipients(id,campaign_id,phone,channel,status) VALUES($1::uuid,$2::uuid,'+573001110001','whatsapp',$3)", [randomUUID(), c.id, status]);
        }
        const stats = await service.getCampaignStats(lane.tenantId, c.id);
        expect(stats).toMatchObject({ totalRecipients: 6, queued: 1, sent: 2, delivered: 1, read: 1, failed: 1 });
        expect(stats.byChannel.whatsapp).toEqual({ sent: 4, delivered: 2, failed: 1 });
    });

    it('AUT-23: the campaign finishes only when no recipient is pending or queued, and announces it once', async () => {
        const [c] = await lane.sql("INSERT INTO campaigns(name,status,starts_at) VALUES('F','active',NOW()) RETURNING id");
        const r1 = randomUUID(), r2 = randomUUID();
        for (const id of [r1, r2]) await lane.sql("INSERT INTO campaign_recipients(id,campaign_id,phone,channel,status) VALUES($1::uuid,$2::uuid,'+573001110001','whatsapp','queued')", [id, c.id]);
        (lane.prisma as any).tenant.findFirst = async () => ({ id: lane.tenantId });
        await service.updateRecipientStatus(lane.schema, r1, 'sent', undefined, 'wamid.1');
        await service.checkCampaignCompletion(lane.schema, c.id);
        expect((await row(c.id)).status).toBe('active');
        expect(emitted).toHaveLength(0);
        await service.updateRecipientStatus(lane.schema, r2, 'failed', 'meta_rejected');
        await service.checkCampaignCompletion(lane.schema, c.id);
        const done = await row(c.id);
        expect(done.status).toBe('finished');
        expect(done.ends_at).not.toBeNull();
        expect(emitted).toEqual([{ name: 'campaign.completed', payload: expect.objectContaining({ campaignId: c.id, sentCount: 1, failedCount: 1 }) }]);
        const sentRow = (await lane.sql('SELECT provider_message_id, sent_at FROM campaign_recipients WHERE id=$1::uuid', [r1]))[0];
        expect(sentRow.provider_message_id).toBe('wamid.1');
        expect(sentRow.sent_at).not.toBeNull();
    });
});
