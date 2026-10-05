import { randomUUID } from 'crypto';
import { BroadcastService } from './broadcast.service';
import { LANE_CHAT_DDL, N3_LANE_URL, leadOptedOut, openLane, optOut } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-C36 + D3 — a broadcast campaign must not reach a phone on the opt-out
 * register, and creating a campaign must work on the canonical `campaigns`
 * table (`metadata` is JSONB, which the INSERT did not cast: 42804).
 *
 * Oracle: the jobs handed to the BullMQ queue at launch (what the workers will
 * send) and the `campaign_recipients` rows. The queue is a recorder; nothing is sent.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-C36 / D3: broadcast honours the opt-out register on the canonical campaigns table', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    const jobs: any[] = [];
    const actorId = randomUUID();

    beforeAll(async () => {
        lane = await openLane('n3bcast', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE campaigns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(500) NOT NULL, channel VARCHAR(50) DEFAULT 'whatsapp',
                wa_template_name VARCHAR(255), status VARCHAR(50) DEFAULT 'draft', starts_at TIMESTAMP, ends_at TIMESTAMP, scheduled_at TIMESTAMPTZ,
                metadata JSONB DEFAULT '{}', is_ab_test BOOLEAN DEFAULT false, ab_test_config JSONB,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE campaign_recipients(id UUID PRIMARY KEY, campaign_id UUID, contact_id UUID, phone TEXT, email TEXT,
                channel TEXT DEFAULT 'whatsapp', status TEXT, variant_id UUID, error_message TEXT, message_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
        ]);
        lane.prisma.user = { findFirst: async () => ({ id: actorId }) };
        lane.prisma.channelAccount = { findFirst: async () => ({ accountId: '15550002222', wabaTimezone: 'America/Bogota' }) };
        service = Object.create(BroadcastService.prototype);
        Object.assign(service, {
            prisma: lane.prisma,
            redis: { get: async (key: string) => (key.endsWith(':schema') ? lane.schema : 'ready'), set: async () => undefined },
            broadcastQueue: { addBulk: async (batch: any[]) => { jobs.push(...batch); } },
            spendGate: { budgetTask: async () => ({ capDeliveries: 1000, usedDeliveries: 0 }) },
            abTestService: {}, eventEmitter: { emit: () => undefined }, cronLock: {},
            selfServiceBroadcastChannels: new Set(['whatsapp']),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        service.ensureBroadcastTables = async () => undefined;
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        jobs.length = 0;
        await lane.sql('TRUNCATE campaign_recipients, campaigns, contacts, opt_out_records, leads CASCADE');
    });

    it('D3: createCampaign writes its row on a canonical campaigns table (metadata is JSONB)', async () => {
        const canonical = await openLane('n3bcastj', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE campaigns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(500) NOT NULL, channel VARCHAR(50) DEFAULT 'whatsapp',
                wa_template_name VARCHAR(255), status VARCHAR(50) DEFAULT 'draft', starts_at TIMESTAMP, scheduled_at TIMESTAMPTZ,
                metadata JSONB DEFAULT '{}', is_ab_test BOOLEAN DEFAULT false, ab_test_config JSONB,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE campaign_recipients(id UUID PRIMARY KEY, campaign_id UUID, contact_id UUID, phone TEXT, email TEXT,
                channel TEXT DEFAULT 'whatsapp', status TEXT, variant_id UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
        ]);
        try {
            const svc: any = Object.create(BroadcastService.prototype);
            Object.assign(svc, {
                prisma: canonical.prisma,
                redis: { get: async (key: string) => (key.endsWith(':schema') ? canonical.schema : 'ready'), set: async () => undefined },
                selfServiceBroadcastChannels: new Set(['whatsapp']), abTestService: {},
                logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            });
            svc.ensureBroadcastTables = async () => undefined;
            let outcome = 'created';
            await svc.createCampaign(canonical.tenantId, { name: 'Promo', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all' }, actorId)
                .catch((error: Error) => { outcome = String(error.message).replace(/\s+/g, ' ').slice(-140); });
            const rows = await canonical.sql('SELECT COUNT(*)::int AS n FROM campaigns');
            expect(outcome).toBe('created');
            expect(rows[0].n).toBe(1);
        } finally { await canonical.close(); }
    });

    it('AUT-C36: a launched campaign queues the subscribed contact and not the one who opted out', async () => {
        const quiet = randomUUID(), active = randomUUID();
        await seedContact(quiet, 'Ana Baja', '+573001110001');
        await seedContact(active, 'Beto Activo', '+573001110002');
        await optOut(lane.sql, '+573001110001');

        const created = await service.createCampaign(lane.tenantId,
            { name: 'Promo octubre', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all' }, actorId);
        await service.launchCampaign(lane.tenantId, created.id, actorId);

        const recipients = await lane.sql('SELECT contact_id,phone FROM campaign_recipients WHERE campaign_id=$1::uuid', [created.id]);
        const queuedPhones = jobs.map(job => job.data.phone);
        // Control: the campaign works and reaches the subscribed contact.
        expect(queuedPhones).toContain('+573001110002');
        // Promise: the opted-out phone is neither a recipient nor a queued send.
        expect(recipients.map((r: any) => r.phone)).not.toContain('+573001110001');
        expect(queuedPhones).not.toContain('+573001110001');
    });

    const seedContact = (id: string, name: string, phone: string) =>
        lane.sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)', [id, name, phone, 'whatsapp']);
    const launch = async (name = 'Promo') => {
        const created = await service.createCampaign(lane.tenantId,
            { name, channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all' }, actorId);
        await service.launchCampaign(lane.tenantId, created.id, actorId);
        return created;
    };

    it('AUT-C36: a lead-level unsubscribe (leads.opted_out) keeps the contact out of the audience', async () => {
        const quiet = randomUUID(), active = randomUUID();
        await seedContact(quiet, 'Carla Formulario', '+573001110003');
        await seedContact(active, 'Beto Activo', '+573001110002');
        await leadOptedOut(lane.sql, { phone: '+573009990000', contactId: quiet });
        await launch();
        expect(jobs.map(job => job.data.phone)).toEqual(['+573001110002']);
    });

    it('AUT-C36: an explicit recipientPhones list is filtered too', async () => {
        await seedContact(randomUUID(), 'Ana Baja', '+573001110001');
        await seedContact(randomUUID(), 'Beto Activo', '+573001110002');
        await optOut(lane.sql, '573001110001');
        const created = await service.createCampaign(lane.tenantId, {
            name: 'Lista', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all',
            recipientPhones: ['+573001110001', '+573001110002'],
        }, actorId);
        expect(created.recipientCount).toBe(1);
    });

    it('AUT-C36: a tag audience is filtered too', async () => {
        await lane.sql("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'");
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type,tags) VALUES($1::uuid,$2,$3,$4,$5::text[])',
            [randomUUID(), 'Ana Baja', '+573001110001', 'whatsapp', ['vip']]);
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type,tags) VALUES($1::uuid,$2,$3,$4,$5::text[])',
            [randomUUID(), 'Beto Activo', '+573001110002', 'whatsapp', ['vip']]);
        await optOut(lane.sql, '+573001110001');
        const created = await service.createCampaign(lane.tenantId, {
            name: 'VIP', channels: ['whatsapp'], templateName: 'promo', targetAudience: JSON.stringify({ tags: ['vip'] }),
        }, actorId);
        expect(created.recipientCount).toBe(1);
    });

    it('AUT-C36 (second layer): someone who opts out AFTER the campaign was created is skipped at launch', async () => {
        await seedContact(randomUUID(), 'Ana Baja', '+573001110001');
        await seedContact(randomUUID(), 'Beto Activo', '+573001110002');
        const created = await service.createCampaign(lane.tenantId,
            { name: 'Programada', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all' }, actorId);
        expect(created.recipientCount).toBe(2);

        await optOut(lane.sql, '+573001110001');
        await service.launchCampaign(lane.tenantId, created.id, actorId);

        expect(jobs.map(job => job.data.phone)).toEqual(['+573001110002']);
        const rows = await lane.sql('SELECT phone,status,error_message FROM campaign_recipients ORDER BY phone');
        expect(rows).toEqual([
            { phone: '+573001110001', status: 'skipped', error_message: 'recipient_opted_out' },
            { phone: '+573001110002', status: 'queued', error_message: null },
        ]);
    });

    it('AUT-C36 (second layer): a campaign whose every recipient opted out is FINISHED, not failed', async () => {
        await seedContact(randomUUID(), 'Ana Baja', '+573001110001');
        const created = await service.createCampaign(lane.tenantId,
            { name: 'Sola', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all' }, actorId);
        await optOut(lane.sql, '+573001110001');
        await expect(service.launchCampaign(lane.tenantId, created.id, actorId))
            .resolves.toEqual({ queued: 0, finished: 'all_recipients_opted_out' });
        expect(jobs).toEqual([]);
        const [campaign] = await lane.sql('SELECT status, ends_at, metadata FROM campaigns WHERE id=$1::uuid', [created.id]);
        expect(campaign.status).toBe('finished');
        expect(campaign.ends_at).not.toBeNull();
        expect(campaign.metadata.finishedWithoutSending.code).toBe('all_recipients_opted_out');
    });

    it('AUT-C36 (scheduler): a due scheduled campaign with nobody left is closed once and does not come back every minute', async () => {
        await seedContact(randomUUID(), 'Ana Baja', '+573001110001');
        const created = await service.createCampaign(lane.tenantId, {
            name: 'Programada vacia', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all',
            scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        }, actorId);
        expect((await lane.sql('SELECT status FROM campaigns WHERE id=$1::uuid', [created.id]))[0].status).toBe('scheduled');
        await optOut(lane.sql, '+573001110001');

        // Only this tenant: the isolated database holds other suites' tenants.
        lane.prisma.$queryRaw = async () => [{ id: lane.tenantId, schema_name: lane.schema }];
        const launchSpy = jest.spyOn(service, 'launchCampaign');
        await service.launchScheduledCampaigns();
        await service.launchScheduledCampaigns();
        await service.launchScheduledCampaigns();

        expect(launchSpy).toHaveBeenCalledTimes(1);
        launchSpy.mockRestore();
        const [campaign] = await lane.sql('SELECT status FROM campaigns WHERE id=$1::uuid', [created.id]);
        expect(campaign.status).toBe('finished');
        expect(jobs).toEqual([]);
    });

    it('AUT-C36 (A/B): an opted-out recipient is dropped BEFORE variants are assigned', async () => {
        await seedContact(randomUUID(), 'Ana Baja', '+573001110001');
        await seedContact(randomUUID(), 'Beto Activo', '+573001110002');
        const created = await service.createCampaign(lane.tenantId,
            { name: 'AB', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all' }, actorId);
        await lane.sql('UPDATE campaigns SET is_ab_test = true WHERE id=$1::uuid', [created.id]);
        await lane.sql('CREATE TABLE IF NOT EXISTS campaign_variants(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID, content JSONB)');
        await optOut(lane.sql, '+573001110001');
        let pendingWhenAssigning = -1;
        const realAb = service.abTestService;
        service.abTestService = {
            ensureAbTestTables: async () => undefined,
            assignRecipientsToVariants: async () => {
                if (pendingWhenAssigning >= 0) return; // the FIRST assignment is the one that matters
                pendingWhenAssigning = (await lane.sql("SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE status = 'pending'"))[0].n;
            },
        };
        try {
            await service.launchCampaign(lane.tenantId, created.id, actorId);
        } finally { service.abTestService = realAb; }
        expect(pendingWhenAssigning).toBe(1);
    });

    it('AUT-C36: an opt-out recorded for channel=all blocks the WhatsApp campaign too', async () => {
        await seedContact(randomUUID(), 'Ana Todos', '+573001110001');
        await seedContact(randomUUID(), 'Beto Activo', '+573001110002');
        await lane.sql("INSERT INTO opt_out_records(phone,channel,status) VALUES('+573001110001','all','confirmed')");
        await launch();
        expect(jobs.map(job => job.data.phone)).toEqual(['+573001110002']);
    });

    it('AUT-C36: an opt-out on another channel does not block the WhatsApp campaign', async () => {
        await seedContact(randomUUID(), 'Ana Instagram', '+573001110001');
        await lane.sql("INSERT INTO opt_out_records(phone,channel,status) VALUES('+573001110001','instagram','confirmed')");
        await launch();
        expect(jobs.map(job => job.data.phone)).toEqual(['+573001110001']);
    });
});
