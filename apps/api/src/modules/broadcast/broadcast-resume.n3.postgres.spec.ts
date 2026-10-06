import { randomUUID } from 'crypto';
import { BroadcastService } from './broadcast.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · REGRESSION (was a confirmed defect, fixed) AUT-23 — a paused campaign cannot be resumed.
 *
 * Pausing is `campaigns.status = 'paused'` (catalog `updateCampaign`). The campaign's
 * recipients are then `queued`, and the worker leaves them exactly as they are when it
 * finds the campaign paused (`broadcast-queue.processor.ts` dispatchWhatsApp: "The row is
 * left exactly as it is — a paused campaign is one somebody means to resume").
 * Resuming is `launchCampaign` (the service accepts status `paused`), but it selects ONLY
 * recipients with `status = 'pending'`: the queued ones are never queued again, and when
 * the campaign had none pending the launch is refused with "No pending recipients found".
 * The campaign sits `paused`/`active` for ever with queued recipients nobody will send to.
 *
 * Oracle: the jobs the queue receives on resume and the recipient rows afterwards.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-23: broadcast pause and resume', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    const jobs: any[] = [];
    const actorId = randomUUID();

    beforeAll(async () => {
        lane = await openLane('n3bresume', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE campaigns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(500) NOT NULL, channel VARCHAR(50) DEFAULT 'whatsapp',
                wa_template_name VARCHAR(255), status VARCHAR(50) DEFAULT 'draft', starts_at TIMESTAMP, ends_at TIMESTAMP, scheduled_at TIMESTAMPTZ,
                metadata JSONB DEFAULT '{}', is_ab_test BOOLEAN DEFAULT false, ab_test_config JSONB,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE campaign_recipients(id UUID PRIMARY KEY, campaign_id UUID, contact_id UUID, phone TEXT, email TEXT,
                channel TEXT DEFAULT 'whatsapp', status TEXT, variant_id UUID, error_message TEXT, provider_message_id TEXT, sent_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
        ]);
        (lane.prisma as any).user = { findFirst: async () => ({ id: actorId }) };
        (lane.prisma as any).channelAccount = { findFirst: async () => ({ accountId: '15550002222', wabaTimezone: 'America/Bogota' }) };
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

    it('AUT-23: pausing a launched campaign and resuming it sends to the recipients that were left queued', async () => {
        for (const n of ['1', '2', '3']) await lane.sql("INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,'whatsapp')", [randomUUID(), `C${n}`, `+57300111000${n}`]);
        const created = await service.createCampaign(lane.tenantId,
            { name: 'Promo', channels: ['whatsapp'], templateName: 'promo', targetAudience: 'all', channelAccountId: '15550002222' }, actorId);
        await service.launchCampaign(lane.tenantId, created.id, actorId);
        expect(jobs).toHaveLength(3);
        jobs.length = 0;
        // The operator pauses it; the workers find it paused and leave every recipient `queued`.
        await lane.sql("UPDATE campaigns SET status = 'paused' WHERE id=$1::uuid", [created.id]);
        const before = await lane.sql('SELECT status, COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1::uuid GROUP BY status', [created.id]);
        expect(before).toEqual([{ status: 'queued', n: 3 }]);
        // Resume.
        let failure = '';
        await service.launchCampaign(lane.tenantId, created.id, actorId).catch((e: any) => { failure = String(e?.message ?? e); });
        const state = (await lane.sql('SELECT status FROM campaigns WHERE id=$1::uuid', [created.id]))[0].status;
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-23] resume: error="${failure}" jobsQueued=${jobs.length} campaign=${state}`);
        expect(failure).toBe('');
        expect(jobs).toHaveLength(3);
    });

    it('AUT-23: resuming re-queues only what was left queued — not the sent, and not somebody who opted out meanwhile', async () => {
        const phones = ['+573009990001', '+573009990002', '+573009990003'];
        for (const [i, phone] of phones.entries()) await lane.sql("INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,'whatsapp')", [randomUUID(), `R${i}`, phone]);
        const created = await service.createCampaign(lane.tenantId,
            { name: 'Resume', channels: ['whatsapp'], templateName: 'promo', recipientPhones: phones, channelAccountId: '15550002222' }, actorId);
        await service.launchCampaign(lane.tenantId, created.id, actorId);
        jobs.length = 0;
        await lane.sql("UPDATE campaigns SET status = 'paused' WHERE id=$1::uuid", [created.id]);
        await lane.sql("UPDATE campaign_recipients SET status='sent' WHERE campaign_id=$1::uuid AND phone=$2", [created.id, phones[0]]);
        await lane.sql("INSERT INTO opt_out_records(phone,channel,status,detected_from) VALUES($1,'whatsapp','confirmed','keyword')", [phones[1]]);
        await service.launchCampaign(lane.tenantId, created.id, actorId);
        expect(jobs.map((j: any) => j.data.phone)).toEqual([phones[2]]);
        const rows = await lane.sql('SELECT phone, status FROM campaign_recipients WHERE campaign_id=$1::uuid ORDER BY phone', [created.id]);
        expect(rows).toEqual([
            { phone: phones[0], status: 'sent' }, { phone: phones[1], status: 'skipped' }, { phone: phones[2], status: 'queued' },
        ]);
    });

    it('AUT-23: an email or SMS recipient left queued is NOT re-queued on resume (its original job is still alive and has no durable key)', async () => {
        const phone = '+573009990011';
        await lane.sql("INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,'E1',$2,'whatsapp')", [randomUUID(), phone]);
        const created = await service.createCampaign(lane.tenantId,
            { name: 'Mixed', channels: ['whatsapp'], templateName: 'promo', recipientPhones: [phone], channelAccountId: '15550002222' }, actorId);
        await service.launchCampaign(lane.tenantId, created.id, actorId);
        jobs.length = 0;
        for (const channel of ['email', 'sms'])
            await lane.sql("INSERT INTO campaign_recipients(id,campaign_id,contact_id,phone,email,channel,status) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,'queued')",
                [randomUUID(), created.id, randomUUID(), channel === 'sms' ? '+573009990012' : '', channel === 'email' ? 'x@example.com' : '', channel]);
        await lane.sql("UPDATE campaigns SET status = 'paused' WHERE id=$1::uuid", [created.id]);
        await service.launchCampaign(lane.tenantId, created.id, actorId);
        expect(jobs.map((j: any) => j.data.channel)).toEqual(['whatsapp']);
        const rows = await lane.sql("SELECT channel, status FROM campaign_recipients WHERE campaign_id=$1::uuid AND channel IN ('email','sms')", [created.id]);
        expect(rows.every((r: any) => r.status === 'queued')).toBe(true);
    });
});
