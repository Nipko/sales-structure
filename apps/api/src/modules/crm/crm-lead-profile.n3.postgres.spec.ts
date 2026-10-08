import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NotFoundException } from '@nestjs/common';
import { Client } from 'pg';
import { N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';
import { CrmController } from './crm.controller';
import { LeadsRepository } from './repositories/leads.repository';
import { ActivityService } from './services/activity/activity.service';

/**
 * N3 - the customer profile page ("Ver cliente") reads two endpoints:
 *   GET /crm/leads/:tenantId/:leadId      (Lead 360)
 *   GET /crm/timeline/:tenantId/:leadId   (activity timeline)
 * Both answered 500 for a lead born from a Telegram contact, and the page rendered blank.
 *
 * Real controller methods, real repository / service, real PostgreSQL, and the production
 * tenant template (`prisma/tenant-schema.sql`) rather than a hand-made subset of tables:
 * a fixture that invents its own columns is how this kind of defect stays invisible.
 */
(N3_LANE_URL ? describe : describe.skip)('N3: CRM lead profile (Lead 360 + timeline)', () => {
    jest.setTimeout(180_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let controller: CrmController;
    const redis = { get: async () => lane.schema, set: async () => undefined, del: async () => undefined };

    // Telegram contact: no phone on the contact, a chat id as external id.
    const contactId = randomUUID();
    const leadId = randomUUID();
    const bareLeadId = randomUUID();
    const bareContactId = randomUUID();

    beforeAll(async () => {
        lane = await openLane('crmprof', []);
        const ddlClient = new Client({ connectionString: N3_LANE_URL });
        await ddlClient.connect();
        try {
            await ddlClient.query(`SET search_path TO "${lane.schema}", public`);
            const template = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8')
                .replaceAll('{{SCHEMA_NAME}}', lane.schema)
                // The disposable server has no pgvector; the embedding columns are not under test.
                .replace(/vector\(1536\)/g, 'text')
                .split('\n').filter(line => !/ivfflat/.test(line)).join('\n');
            await ddlClient.query(template);
        } finally { await ddlClient.end(); }

        const repo = new LeadsRepository(lane.prisma, redis as any, {} as any, {} as any);
        const activity = new ActivityService(lane.prisma, redis as any);
        controller = Object.create(CrmController.prototype);
        Object.assign(controller, { leadsRepo: repo, activityService: activity });

        await lane.sql(`INSERT INTO contacts(id, external_id, channel_type, name, phone, phone_normalized)
                        VALUES ($1::uuid, '7700112233', 'telegram', 'Valentina Ríos', NULL, NULL)`, [contactId]);
        await lane.sql(`INSERT INTO leads(id, contact_id, first_name, last_name, phone, stage, score, metadata)
                        VALUES ($1::uuid, $2::uuid, 'Valentina', 'Ríos', 'telegram:7700112233', 'nuevo', 3,
                                '{"source":"conversational_agent"}'::jsonb)`, [leadId, contactId]);
        const conversationId = randomUUID();
        await lane.sql(`INSERT INTO conversations(id, contact_id, channel_type, channel_account_id, status)
                        VALUES ($1::uuid, $2::uuid, 'telegram', 'bot-1', 'active')`, [conversationId, contactId]);
        await lane.sql(`INSERT INTO messages(conversation_id, direction, content_type, content_text, created_at)
                        VALUES ($1::uuid, 'inbound', 'text', 'Hola, quiero un corte', NOW() - interval '3 hours'),
                               ($1::uuid, 'outbound', 'text', 'Con gusto, ¿qué día?', NOW() - interval '179 minutes'),
                               ($1::uuid, 'inbound', 'image', NULL, NOW() - interval '170 minutes')`, [conversationId]);
        const serviceId = randomUUID();
        await lane.sql(`INSERT INTO services(id, name, duration_minutes, price) VALUES ($1::uuid, 'Corte', 45, 60000)`, [serviceId]);
        await lane.sql(`INSERT INTO appointments(contact_id, conversation_id, service_id, service_name, start_at, end_at, status,
                                                 customer_name, cancellation_reason)
                        VALUES ($1::uuid, $2::uuid, $3::uuid, 'Corte', NOW() + interval '1 day', NOW() + interval '1 day 45 minutes', 'confirmed', 'Valentina Ríos', NULL),
                               ($1::uuid, $2::uuid, $3::uuid, 'Corte', NOW() - interval '2 days', NOW() - interval '2 days' + interval '45 minutes', 'cancelled', 'Valentina Ríos', 'cliente cancela')`,
        [contactId, conversationId, serviceId]);

        const [pipelineRow] = await lane.sql(`INSERT INTO pipelines(tenant_id, name, is_default) VALUES ($1::uuid, 'Ventas', true) RETURNING id`, [lane.tenantId]);
        const [stageRow] = await lane.sql(`INSERT INTO pipeline_stages(tenant_id, name, slug, position, pipeline_id) VALUES ($1::uuid, 'Nuevo', 'nuevo', 0, $2::uuid) RETURNING id`, [lane.tenantId, pipelineRow.id]);
        const [dealRow] = await lane.sql(`INSERT INTO deals(contact_id, title, value, pipeline_id, stage_id)
                                          VALUES ($1::uuid, 'Corte + color', 120000, $2::uuid, $3::uuid) RETURNING id`,
        [contactId, pipelineRow.id, stageRow.id]);
        await lane.sql(`INSERT INTO opportunities(lead_id, conversation_id, stage, estimated_value, deal_id, metadata)
                        VALUES ($1::uuid, $2::uuid, 'nuevo', 120000, $3::uuid, '{"title":"Corte + color"}'::jsonb)`,
        [leadId, conversationId, dealRow.id]);
        await lane.sql(`INSERT INTO notes(lead_id, content, created_by) VALUES ($1::uuid, 'Prefiere la tarde', 'agent-1')`, [leadId]);
        await lane.sql(`INSERT INTO tasks(lead_id, title, status, due_at, created_by) VALUES ($1::uuid, 'Confirmar cita', 'pending', NOW(), 'agent-1')`, [leadId]);
        await lane.sql(`INSERT INTO stage_history(lead_id, from_stage, to_stage, triggered_by) VALUES ($1::uuid, NULL, 'nuevo', 'ai')`, [leadId]);
        await lane.sql(`INSERT INTO analytics_events(event_type, contact_id, data) VALUES ('lead.created', $1::uuid, '{}'::jsonb)`, [contactId]);

        // A lead as thin as the importers leave it: no contact, nothing around it.
        await lane.sql(`INSERT INTO leads(id, phone) VALUES ($1::uuid, '+573001112233')`, [bareLeadId]);
        await lane.sql(`INSERT INTO contacts(id, external_id, channel_type) VALUES ($1::uuid, 'x-1', 'telegram')`, [bareContactId]);
    });
    afterAll(async () => { if (lane) await lane.close(); });

    it('Lead 360 answers for a Telegram lead with conversations, appointments and a deal', async () => {
        const res = await controller.getLead360(lane.tenantId, leadId);
        expect(res.success).toBe(true);
        expect(res.data.lead).toMatchObject({ id: leadId, contact_id: contactId, first_name: 'Valentina', contact_name: 'Valentina Ríos' });
        expect(res.data.opportunities).toHaveLength(1);
        expect(res.data.tags).toEqual([]);
        // The payload must survive JSON serialisation (a Decimal / BigInt / cycle is a 500 at the wire).
        expect(() => JSON.stringify(res)).not.toThrow();
    });

    it('timeline answers for the same lead, newest first, with every source merged', async () => {
        const res = await controller.getTimeline(lane.tenantId, leadId);
        expect(res.success).toBe(true);
        const kinds = new Set(res.data.map((e: any) => e.event_type));
        expect(kinds).toEqual(new Set(['note', 'task', 'stage_change', 'event', 'message']));
        const times = res.data.map((e: any) => new Date(e.created_at).getTime());
        expect([...times].sort((a, b) => b - a)).toEqual(times);
        expect(() => JSON.stringify(res)).not.toThrow();
    });

    it('a partially-populated lead (no contact, nothing around it) is an empty profile, not a 500', async () => {
        const lead = await controller.getLead360(lane.tenantId, bareLeadId);
        expect(lead.data.lead).toMatchObject({ id: bareLeadId, contact_id: null });
        expect(lead.data.opportunities).toEqual([]);
        const timeline = await controller.getTimeline(lane.tenantId, bareLeadId);
        expect(timeline).toEqual({ success: true, data: [] });
    });

    it('"Ver cliente" from the inbox passes the CONTACT id: it opens the contact\'s lead (the 500 root cause)', async () => {
        const res = await controller.getLead360(lane.tenantId, contactId);
        expect(res.data.lead).toMatchObject({ id: leadId, contact_id: contactId, first_name: 'Valentina' });
        expect(res.data.resolved).toEqual({ kind: 'contact_lead', leadId, contactId });
        expect(res.data.opportunities).toHaveLength(1);
        const timeline = await controller.getTimeline(lane.tenantId, contactId);
        expect(new Set(timeline.data.map((e: any) => e.event_type))).toEqual(new Set(['note', 'task', 'stage_change', 'event', 'message']));
    });

    it('a contact that never became a lead gets a read-only profile and its own timeline', async () => {
        const res = await controller.getLead360(lane.tenantId, bareContactId);
        expect(res.data.lead).toMatchObject({ id: null, contact_id: bareContactId });
        expect(res.data.resolved).toEqual({ kind: 'contact_only', leadId: null, contactId: bareContactId });
        expect(res.data.opportunities).toEqual([]);
        expect((await controller.getTimeline(lane.tenantId, bareContactId)).data).toEqual([]);
        const [event] = await lane.sql(`INSERT INTO analytics_events(event_type, contact_id) VALUES ('contact.seen', $1::uuid) RETURNING id`, [bareContactId]);
        const timeline = await controller.getTimeline(lane.tenantId, bareContactId);
        expect(timeline.data.map((e: any) => e.id)).toEqual([event.id]);
    });

    it('an unknown or malformed id is a 404, not a 500', async () => {
        for (const ref of [randomUUID(), 'undefined', '', 'not-a-uuid']) {
            await expect(controller.getLead360(lane.tenantId, ref)).rejects.toBeInstanceOf(NotFoundException);
            await expect(controller.getTimeline(lane.tenantId, ref)).rejects.toBeInstanceOf(NotFoundException);
        }
    });

    it('a section the tenant cannot serve is left out; the profile still opens', async () => {
        await lane.sql('ALTER TABLE tags RENAME TO tags_offline');
        await lane.sql('ALTER TABLE analytics_events RENAME TO analytics_events_offline');
        try {
            const res = await controller.getLead360(lane.tenantId, leadId);
            expect(res.data.lead.id).toBe(leadId);
            expect(res.data.tags).toEqual([]);
            const timeline = await controller.getTimeline(lane.tenantId, leadId);
            expect(new Set(timeline.data.map((e: any) => e.event_type))).toEqual(new Set(['note', 'task', 'stage_change', 'message']));
        } finally {
            await lane.sql('ALTER TABLE tags_offline RENAME TO tags');
            await lane.sql('ALTER TABLE analytics_events_offline RENAME TO analytics_events');
        }
    });
});
