import { randomUUID } from 'crypto';
import { N3_LANE_URL, openLane } from './__fixtures__/n3-lane-harness';
import { OPT_OUT_REGISTER_DDL } from './__fixtures__/opt-out-register-ddl';
import { MacrosService } from '../modules/agent-console/macros.service';
import { NotesService } from '../modules/crm/services/notes/notes.service';
import { ActivityService } from '../modules/crm/services/activity/activity.service';
import { CustomAttributesService } from '../modules/crm/services/custom-attributes/custom-attributes.service';
import { CatalogService } from '../modules/catalog/catalog.service';
import { PipelineService } from '../modules/pipeline/pipeline.service';
import { ToursService } from '../modules/tours/tours.service';
import { ComplianceService } from '../modules/analytics/compliance.service';

/**
 * N3 - the writers fixed by the "bare $n into a typed column" sweep (see
 * prisma-bare-text-param.n3.postgres.spec.ts for the type-level contract). Each one passed a
 * string to a uuid / timestamp / jsonb column without a cast and PostgreSQL answered 42804
 * on every call. Real services, real PostgreSQL, one oracle per writer: the row it wrote.
 */
(N3_LANE_URL ? describe : describe.skip)('N3: casts on string -> uuid / timestamp / jsonb writers', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let redis: any;
    const published: any[] = [];

    beforeAll(async () => {
        lane = await openLane('n3cast', [
            ...OPT_OUT_REGISTER_DDL,
            'ALTER TABLE leads ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()',
            `CREATE TABLE macros(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255), description TEXT,
                actions_json JSONB DEFAULT '[]', updated_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE notes(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID, opportunity_id UUID, conversation_id UUID,
                content TEXT NOT NULL, created_by VARCHAR(255), created_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE analytics_events(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_type VARCHAR(100) NOT NULL,
                contact_id UUID, data JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE custom_attribute_definitions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entity_type VARCHAR(50),
                attribute_key VARCHAR(100), attribute_label VARCHAR(255), attribute_type VARCHAR(50), options JSONB DEFAULT '[]',
                required BOOLEAN DEFAULT false, position INTEGER DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`,
            `CREATE TABLE custom_attribute_values(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), definition_id UUID, entity_id UUID,
                entity_type VARCHAR(50), value_text TEXT, value_number NUMERIC, value_boolean BOOLEAN, value_date TIMESTAMP,
                value_json JSONB, updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(definition_id, entity_id))`,
            `CREATE TABLE campaigns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(100), name VARCHAR(255),
                course_id UUID, source_type VARCHAR(50), channel VARCHAR(50), wa_template_name VARCHAR(255), status VARCHAR(50),
                schedule_json JSONB DEFAULT '{}', default_owner_rule VARCHAR(100), fallback_email BOOLEAN DEFAULT false)`,
            `CREATE TABLE commercial_offers(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id VARCHAR(255), course_id UUID,
                campaign_id UUID, offer_type VARCHAR(50), title VARCHAR(255), conditions_json JSONB DEFAULT '{}',
                valid_from TIMESTAMP, valid_to TIMESTAMP, active BOOLEAN DEFAULT true)`,
            `CREATE TABLE tour_inventory(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), package_id UUID NOT NULL, departure_date DATE NOT NULL,
                departure_time TIME, available_seats INTEGER DEFAULT 0, total_seats INTEGER DEFAULT 0, price_override NUMERIC(15,2),
                is_active BOOLEAN DEFAULT true, notes TEXT, updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(package_id, departure_date, departure_time))`,
            `CREATE TABLE deals(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title VARCHAR(255), expected_close_date DATE, updated_at TIMESTAMP DEFAULT NOW())`,
        ]);
        redis = { get: async () => lane.schema, set: async () => undefined, del: async () => undefined };
    });
    afterAll(async () => { if (lane) await lane.close(); });

    it('macros: createMacro / updateMacro write actions_json', async () => {
        const macros = new MacrosService(lane.prisma, redis);
        const created = await macros.createMacro(lane.tenantId, { name: 'Saludo', actionsJson: [{ type: 'add_note', value: 'hola' }] });
        expect(created.actions_json).toEqual([{ type: 'add_note', value: 'hola' }]);
        const updated = await macros.updateMacro(lane.tenantId, created.id, { actionsJson: [{ type: 'add_note', value: 'chao' }] });
        expect(updated.actions_json).toEqual([{ type: 'add_note', value: 'chao' }]);
    });

    it('notes: createNote binds lead / opportunity / conversation as uuid', async () => {
        const [lead, opportunity, conversation] = [randomUUID(), randomUUID(), randomUUID()];
        const note = await new NotesService(lane.prisma, redis).createNote(lane.tenantId,
            { leadId: lead, opportunityId: opportunity, conversationId: conversation, content: 'llamar el martes', createdBy: 'agente-1' });
        expect(note).toMatchObject({ lead_id: lead, opportunity_id: opportunity, conversation_id: conversation, content: 'llamar el martes' });
    });

    it('activity: logEvent writes contact_id (uuid) and data (jsonb)', async () => {
        const contact = randomUUID(), lead = randomUUID();
        await new ActivityService(lane.prisma, redis).logEvent(lane.tenantId, lead, contact, 'lead.touched', { via: 'test' });
        expect(await lane.sql('SELECT event_type, contact_id, data FROM analytics_events')).toEqual([
            { event_type: 'lead.touched', contact_id: contact, data: { via: 'test', lead_id: lead } }]);
    });

    it('custom attributes: definition options (jsonb) and a date value (timestamp)', async () => {
        const service = new CustomAttributesService(lane.prisma, redis);
        const definition = await service.createDefinition(lane.tenantId, {
            entityType: 'lead', attributeKey: 'tier', attributeLabel: 'Tier', attributeType: 'select', options: ['a', 'b'] });
        expect(definition.options).toEqual(['a', 'b']);
        const updated = await service.updateDefinition(lane.tenantId, definition.id, { options: ['a', 'b', 'c'] });
        expect(updated.options).toEqual(['a', 'b', 'c']);
        const entity = randomUUID();
        await service.setValuesForEntity(lane.tenantId, 'lead', entity, [{ definitionId: definition.id, value: '2026-10-08' }]);
        const rows = await lane.sql('SELECT value_date::date::text AS d FROM custom_attribute_values');
        expect(rows).toEqual([{ d: '2026-10-08' }]);
    });

    it('catalog: createCampaign (course uuid, schedule jsonb) and createOffer (jsonb, timestamps)', async () => {
        const catalog = new CatalogService(lane.prisma);
        const course = randomUUID();
        const campaign = await catalog.createCampaign(lane.schema, { name: 'Octubre', course_id: course, schedule_json: { days: 3 } });
        expect(campaign).toMatchObject({ course_id: course, schedule_json: { days: 3 } });
        const offer = await catalog.createOffer(lane.schema, {
            tenant_id: lane.tenantId, course_id: course, campaign_id: campaign.id, offer_type: 'discount', title: '10%',
            conditions_json: { pct: 10 }, valid_from: '2026-10-01T00:00:00.000Z', valid_to: '2026-10-31T00:00:00.000Z' });
        expect(offer).toMatchObject({ campaign_id: campaign.id, conditions_json: { pct: 10 } });
    });

    it('compliance: processOptOut with a lead id writes opt_out_records.lead_id (uuid)', async () => {
        const lead = randomUUID();
        await lane.sql(`INSERT INTO leads(id, phone) VALUES($1::uuid, '+573001112233')`, [lead]);
        const service = new ComplianceService(lane.prisma, { ...redis, get: async () => lane.schema },
            { publish: (_room: string, event: any) => { published.push(event); } } as any);
        const row = await service.processOptOut(lane.tenantId, {
            leadId: lead, phone: '+573001112233', channel: 'whatsapp', triggerMessage: 'no mas', detectedFrom: 'keyword' });
        expect(row).toMatchObject({ lead_id: lead });
        expect((await lane.sql('SELECT opted_out FROM leads'))[0].opted_out).toBe(true);
    });

    it('tours: createInventory writes departure_time as time', async () => {
        const tours: any = Object.create(ToursService.prototype);
        Object.assign(tours, { prisma: lane.prisma });
        const row = await tours.createInventory(lane.schema, randomUUID(), { departureDate: '2026-11-01', departureTime: '09:30', totalSeats: 8 });
        expect(row).toMatchObject({ departure_time: new Date('1970-01-01T09:30:00.000Z'), total_seats: 8 });
    });

    it('pipeline: updateDeal writes expected_close_date as date', async () => {
        const id = randomUUID();
        await lane.sql("INSERT INTO deals(id,title) VALUES($1::uuid,'D')", [id]);
        const pipeline: any = Object.create(PipelineService.prototype);
        Object.assign(pipeline, { prisma: lane.prisma, getTenantSchema: async () => lane.schema });
        await pipeline.updateDeal(lane.tenantId, id, { expectedCloseDate: '2026-12-31' });
        expect(await lane.sql('SELECT expected_close_date::text AS d FROM deals')).toEqual([{ d: '2026-12-31' }]);
    });
});
