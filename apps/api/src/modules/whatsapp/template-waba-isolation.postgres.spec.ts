import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { AppointmentRemindersService } from '../appointments/appointment-reminders.service';
import { WhatsappMessagingService } from './services/whatsapp-messaging.service';
import { WhatsappTemplateService } from './services/whatsapp-template.service';

/**
 * ═══ A TEMPLATE BELONGS TO ONE WABA, AND ONLY ONE ═══
 *
 * Meta approves, rejects and categorises a template FOR a WhatsApp Business
 * Account. Three places asked for one BY NAME with nothing else:
 *
 *   · the reminder looked for an APPROVED row and took the first, so a
 *     reminder could go out from a number whose WABA had never had that
 *     template approved. Meta refuses it at the door, and the failure reads as
 *     a transport problem rather than the wrong catalogue;
 *   · the category — which decides the PRICE — took the most recently synced
 *     row of that name, so a tenant with two WABAs could price a service reply
 *     at the marketing rate because the sibling synced last;
 *   · the status webhook walked EVERY tenant schema on the platform and
 *     stamped the new status on every row with that name. Template names are
 *     ordinary words, so a rejection on one business's WABA marked another
 *     business's approved template rejected — and an approval elsewhere marked
 *     a rejected one approved, so the business kept sending something Meta
 *     refuses.
 *
 * Real PostgreSQL, because the fix is a join and a join is only correct
 * against the real shape of the two tables.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('two WABAs of one tenant do not share a template catalogue', () => {
    const schema = `tenant_wabatpl_${randomUUID().replace(/-/g, '')}`;
    const NUMBER_A = '15550001111';
    const NUMBER_B = '15550002222';
    const WABA_A = 'waba-alpha';
    const WABA_B = 'waba-beta';
    let client: Client;
    let channelA = '';
    let channelB = '';
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;

    /** A prisma double that runs the real SQL against the real schema. */
    const prisma: any = {
        executeInTenantSchema: async (_schema: string, sql: string, params: any[] = []) =>
            q(sql.replace(/\bwhatsapp_templates\b/g, `"${schema}".whatsapp_templates`)
                .replace(/\bwhatsapp_channels\b/g, `"${schema}".whatsapp_channels`), params),
    };

    const reminders = () => Object.assign(
        Object.create(AppointmentRemindersService.prototype), { prisma }) as any;
    const messaging = () => Object.assign(
        Object.create(WhatsappMessagingService.prototype),
        { prisma, logger: { warn: () => {}, log: () => {}, error: () => {} } }) as any;

    const approvedFor = (name: string, sender?: string) =>
        reminders().getApprovedTemplate(schema, name, sender);
    const categoryFor = (name: string, sender?: string) =>
        messaging().templateCategory(schema, name, sender);

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await q(`CREATE SCHEMA "${schema}"`);
        await q(`CREATE TABLE "${schema}".whatsapp_channels(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone_number_id TEXT, meta_waba_id TEXT,
            channel_status TEXT DEFAULT 'connected',
            connected_at TIMESTAMPTZ DEFAULT NOW())`);
        await q(`CREATE TABLE "${schema}".whatsapp_templates(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            channel_id UUID NOT NULL REFERENCES "${schema}".whatsapp_channels(id) ON DELETE CASCADE,
            name TEXT NOT NULL, language TEXT DEFAULT 'es', category TEXT,
            approval_status TEXT DEFAULT 'PENDING', last_sync_at TIMESTAMPTZ)`);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_wabatpl_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_templates, "${schema}".whatsapp_channels CASCADE`);
        const [a] = await q(`INSERT INTO "${schema}".whatsapp_channels
            (phone_number_id, meta_waba_id) VALUES ($1,$2) RETURNING id`, [NUMBER_A, WABA_A]);
        const [b] = await q(`INSERT INTO "${schema}".whatsapp_channels
            (phone_number_id, meta_waba_id) VALUES ($1,$2) RETURNING id`, [NUMBER_B, WABA_B]);
        channelA = a.id; channelB = b.id;
    });

    const template = (channelId: string, over: Record<string, unknown> = {}) => q(
        `INSERT INTO "${schema}".whatsapp_templates
            (channel_id, name, category, approval_status, last_sync_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [channelId, over.name ?? 'appointment_reminder', over.category ?? 'utility',
            over.approval_status ?? 'APPROVED', over.last_sync_at ?? new Date()]);

    // ── APPROVAL ────────────────────────────────────────────────────────────

    it('finds the template approved on the sender’s own WABA', async () => {
        await template(channelA);
        expect(await approvedFor('appointment_reminder', NUMBER_A)).toMatchObject({
            name: 'appointment_reminder', approval_status: 'APPROVED',
        });
    });

    it('does not lend a sibling WABA’s approval to a number that lacks it', async () => {
        // THE DEFECT. B has no approved catalogue; A does. The reminder used to
        // go out from B on the strength of A's row, and Meta refused it.
        await template(channelA);
        expect(await approvedFor('appointment_reminder', NUMBER_B)).toBeNull();
    });

    it('does not lend it when the sibling’s own row was rejected', async () => {
        await template(channelA);
        await template(channelB, { approval_status: 'REJECTED' });
        expect(await approvedFor('appointment_reminder', NUMBER_B)).toBeNull();
    });

    it('answers an unnamed sender while the tenant has one WABA', async () => {
        // A booking made by hand arrived through no conversation, so there is
        // no connection to inherit. That is the same question the connection
        // resolver answers, and it has an answer while "the tenant's WABA" has
        // one referent.
        await q(`DELETE FROM "${schema}".whatsapp_channels WHERE id = $1::uuid`, [channelB]);
        await template(channelA);
        expect(await approvedFor('appointment_reminder')).toMatchObject({
            approval_status: 'APPROVED',
        });
    });

    it('refuses an unnamed sender once the tenant has two', async () => {
        // With two, returning a row from either is picking which brand's
        // template a customer receives.
        await template(channelA);
        expect(await approvedFor('appointment_reminder')).toBeNull();
    });

    // ── CATEGORY, WHICH DECIDES THE PRICE ───────────────────────────────────

    it('prices from the sender’s own catalogue', async () => {
        await template(channelA, { category: 'service' });
        await template(channelB, { category: 'marketing' });
        expect(await categoryFor('appointment_reminder', NUMBER_A)).toBe('service');
        expect(await categoryFor('appointment_reminder', NUMBER_B)).toBe('marketing');
    });

    it('does not take the sibling’s category because it synced last', async () => {
        // The exact shape of the old query: `ORDER BY last_sync_at DESC` across
        // every WABA. A service reply priced as marketing, or the reverse.
        await template(channelA, {
            category: 'service', last_sync_at: new Date('2026-10-01T00:00:00Z'),
        });
        await template(channelB, {
            category: 'marketing', last_sync_at: new Date('2026-10-09T00:00:00Z'),
        });
        expect(await categoryFor('appointment_reminder', NUMBER_A)).toBe('service');
    });

    it('answers nothing rather than guessing for an unnamed sender on two WABAs', async () => {
        // `null` is the honest answer, and the admission treats an unknown
        // category as expensive rather than cheap — which is the safe direction.
        await template(channelA, { category: 'service' });
        await template(channelB, { category: 'marketing' });
        expect(await categoryFor('appointment_reminder')).toBeNull();
    });

    // ── THE STATUS WEBHOOK, SCOPED BY THE WABA IT CAME FROM ─────────────────

    it('applies a status update only to the WABA Meta was talking about', async () => {
        await template(channelA, { approval_status: 'PENDING' });
        await template(channelB, { approval_status: 'APPROVED' });

        // The statement the worker now runs, verbatim.
        await q(`UPDATE "${schema}".whatsapp_templates t
                    SET approval_status = $1, last_sync_at = NOW()
                   FROM "${schema}".whatsapp_channels c
                  WHERE t.channel_id = c.id AND c.meta_waba_id = $3 AND t.name = $2`,
            ['REJECTED', 'appointment_reminder', WABA_A]);

        const rows = await q(
            `SELECT c.meta_waba_id, t.approval_status
               FROM "${schema}".whatsapp_templates t
               JOIN "${schema}".whatsapp_channels c ON c.id = t.channel_id
              ORDER BY c.meta_waba_id`);
        expect(rows).toEqual([
            { meta_waba_id: WABA_A, approval_status: 'REJECTED' },
            // Untouched. Under the old statement this said REJECTED too, and
            // that business's reminders stopped for a refusal Meta never made.
            { meta_waba_id: WABA_B, approval_status: 'APPROVED' },
        ]);
    });

    // ── AND THE REPRESENTATIVE THAT DOES THE SEEDING ────────────────────────

    it('represents a WABA with a number that can actually send', async () => {
        // `oneNumberPerWaba` took the oldest row, including a DISCONNECTED one.
        // Every operation then resolved credentials for it, was refused, and
        // logged "not usable" — so a WABA with one broken number and one
        // working one had no catalogue seeded and no statuses synced, because
        // the broken sibling stood in front of the working one.
        const both = `${WABA_A}`;
        await q(`UPDATE "${schema}".whatsapp_channels
                    SET meta_waba_id = $1, channel_status = 'disconnected',
                        connected_at = NOW() - interval '10 days'
                  WHERE id = $2::uuid`, [both, channelA]);
        await q(`UPDATE "${schema}".whatsapp_channels
                    SET meta_waba_id = $1, channel_status = 'connected',
                        connected_at = NOW() - interval '1 day'
                  WHERE id = $2::uuid`, [both, channelB]);

        const service: any = Object.create(WhatsappTemplateService.prototype);
        service.connectionService = {
            getChannelStatus: async () => ({
                channels: await q(`SELECT phone_number_id, meta_waba_id, channel_status
                                     FROM "${schema}".whatsapp_channels
                                    ORDER BY connected_at ASC`),
            }),
        };
        expect(await service.oneNumberPerWaba(schema))
            .toEqual([{ phoneNumberId: NUMBER_B, wabaId: both }]);
    });

    it('still represents a WABA whose only number is unusable', async () => {
        // Dropping it would turn "your number is disconnected" into "nothing
        // happened". The operation fails with a diagnosis naming that WABA,
        // which is what an operator needs.
        await q(`UPDATE "${schema}".whatsapp_channels SET channel_status = 'disconnected'`);
        const service: any = Object.create(WhatsappTemplateService.prototype);
        service.connectionService = {
            getChannelStatus: async () => ({
                channels: await q(`SELECT phone_number_id, meta_waba_id, channel_status
                                     FROM "${schema}".whatsapp_channels
                                    ORDER BY connected_at ASC`),
            }),
        };
        expect((await service.oneNumberPerWaba(schema)).map((entry: any) => entry.wabaId).sort())
            .toEqual([WABA_A, WABA_B]);
    });
});
