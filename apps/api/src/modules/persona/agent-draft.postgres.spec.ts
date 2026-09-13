import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PersonaService } from './persona.service';
import { AgentDraftService } from './agent-draft.service';
import { AgentDraftController } from './agent-draft.controller';
import { operationalConfigurationBody } from './agent-configuration-revision';
import type { SaveAgentDraftRequest } from '@parallext/shared';
import { AgentConfigurationService } from '../copilot/agent-configuration.service';
import { AGENT_ACCOUNT_DAYS } from '@parallext/shared';

const url = process.env.AGENT_REVISION_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('Administrative draft boundary with real Prisma transactions', () => {
    const schema = `tenant_draftapi_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID(), agentId = randomUUID(), actor = { id: randomUUID(), role: 'tenant_admin' };
    let client: PrismaClient, prisma: PrismaService, service: AgentDraftService, assist: AgentConfigurationService;
    const events = { emit: jest.fn() }, caches = jest.fn(), finalize = jest.fn();
    const throttle = { isFeatureEnabled: jest.fn(async () => true) };
    const query = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const operational = () => query('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]).then(rows => rows[0]);
    const request = async (overrides: Partial<SaveAgentDraftRequest> = {}): Promise<SaveAgentDraftRequest> => ({
        expectedOperationalVersion: 7, expectedDraftRevision: null, requestKey: randomUUID(),
        body: operationalConfigurationBody(await operational()), ...overrides,
    });
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url });
        await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe(`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS industry TEXT,
            ADD COLUMN IF NOT EXISTS settings JSONB,ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.getTenantSchemaName = jest.fn(async () => schema);
        prisma.ensureCanonicalTables = jest.fn(async () => undefined);
        await query(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],channel_bindings TEXT[],
            schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER,updated_at TIMESTAMPTZ DEFAULT NOW())`);
        const template = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const start = template.indexOf('-- BEGIN AGENT CONFIGURATION REVISIONS'), end = template.indexOf('-- END AGENT CONFIGURATION REVISIONS', start);
        if (start < 0 || end < 0) throw new Error('configuration_revision_ddl_missing');
        for (const statement of template.slice(start, end).replaceAll('{{SCHEMA_NAME}}', schema).split(';').filter(row => row.trim()))
            await client.$executeRawUnsafe(statement);
        const proposalStart = template.indexOf('CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."agent_config_proposals"');
        if (proposalStart < 0) throw new Error('proposal_ddl_missing');
        await client.$executeRawUnsafe(template.slice(proposalStart, template.indexOf(';', proposalStart) + 1).replaceAll('{{SCHEMA_NAME}}', schema));
        const persona = Object.create(PersonaService.prototype);
        persona.invalidatePersonaResolutionCaches = caches;
        service = new AgentDraftService(prisma, persona, throttle as any);
        Object.defineProperty(prisma, 'tenant', { value: { findUnique: async () => (await client.$queryRawUnsafe('SELECT industry,settings FROM public.tenants WHERE id=$1::uuid', tenantId) as any[])[0] } });
        assist = new AgentConfigurationService(prisma, persona, { getAssessment: async () => ({ agent: { id: agentId, version: (await operational()).version } }) } as any,
            events as any, { resolve: async () => ({ contract: { degraded: false, excluded: [], publishedTools: ['search_faqs'] } }) } as any,
            { finalizeConfigurationUpdate: finalize } as any, service);
    });
    beforeEach(async () => {
        throttle.isFeatureEnabled.mockReset().mockResolvedValue(true);
        (prisma.ensureCanonicalTables as jest.Mock).mockClear();
        events.emit.mockClear(); caches.mockClear(); finalize.mockClear();
        await query('TRUNCATE agent_configuration_commands,agent_configuration_drafts,agent_configuration_revisions,agent_configuration_draft_discards,agent_config_proposals,agent_personas');
        await client.$executeRawUnsafe("UPDATE public.tenants SET industry='otro',settings='{}'::jsonb WHERE id=$1::uuid", tenantId);
        await query(`INSERT INTO agent_personas(id,name,config_json,channels,channel_bindings,schedule_mode,is_active,is_default,version)
            VALUES($1::uuid,'Alex',$2::jsonb,ARRAY['web_widget'],ARRAY['web_widget:test'],'24_7',true,true,7)`,
            [agentId, JSON.stringify({ persona: { name: 'Alex', role: 'Support', fallbackMessage: 'A colleague can help.' },
                tools: { faqs: { enabled: true } }, behavior: { rules: ['Use confirmed facts'], handoffTriggers: ['Human requested'] } })]);
    });
    afterAll(async () => {
        if (client) { try {
            if (!/^tenant_draftapi_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); } }
    });
    it('reads operational and absent draft distinctly without a migration or generated revision', async () => {
        const state = await service.read(tenantId, agentId, actor);
        expect(state).toMatchObject({ agentId, operational: { version: 7, body: { name: 'Alex' } }, draft: null, evaluationRevisionId: null });
        expect(prisma.ensureCanonicalTables).not.toHaveBeenCalled();
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(0);
    });
    it('stores edited text, routing and default choice only in a draft and returns its exact test selection', async () => {
        const before = await operational(), input = await request();
        input.body.name = 'Draft Alex'; input.body.configJson.persona.name = 'Draft Alex';
        input.body.channels = ['telegram']; input.body.channelBindings = ['telegram:proposed']; input.body.isDefault = false;
        const result = await service.save(tenantId, agentId, input, actor);
        expect(result.workspace).toMatchObject({ operational: { version: 7, body: { name: 'Alex' } },
            draft: { id: result.savedRevision.id, body: input.body, currentBase: true }, evaluationRevisionId: result.savedRevision.id });
        expect(await operational()).toEqual(before);
    });
    it('keeps both UUID and operational CAS under concurrent saves', async () => {
        const first = await service.save(tenantId, agentId, await request(), actor);
        const a = await request({ expectedDraftRevision: first.savedRevision.id }), b = await request({ expectedDraftRevision: first.savedRevision.id });
        a.body.configJson.persona.greeting = 'A'; b.body.configJson.persona.greeting = 'B';
        const outcomes = await Promise.allSettled([service.save(tenantId, agentId, a, actor), service.save(tenantId, agentId, b, actor)]);
        expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.find(row => row.status === 'rejected')).toMatchObject({ reason: { response: { error: 'agent_draft_revision_changed' } } });
        expect((await operational()).version).toBe(7);
    });
    it('replays the original receipt after a newer draft and plan outage without moving the current pointer', async () => {
        const input = await request(); input.body.configJson.tools.payments = { enabled: true };
        const first = await service.save(tenantId, agentId, input, actor);
        const second = await service.save(tenantId, agentId, await request({ expectedDraftRevision: first.savedRevision.id }), actor);
        throttle.isFeatureEnabled.mockRejectedValue(new Error('plan unavailable'));
        const result = await service.save(tenantId, agentId, input, actor);
        expect(result).toMatchObject({ idempotentReplay: true, savedRevision: { id: first.savedRevision.id },
            workspace: { draft: { id: second.savedRevision.id }, evaluationRevisionId: second.savedRevision.id } });
        const changed = JSON.parse(JSON.stringify(input)); changed.body.configJson.persona.greeting = 'Different';
        await expect(service.save(tenantId, agentId, changed, actor)).rejects.toMatchObject({ response: { error: 'agent_configuration_request_conflict' } });
    });
    it('reports a stale operational baseline and refuses both evaluation selection and another draft save', async () => {
        const first = await service.save(tenantId, agentId, await request(), actor);
        await query('UPDATE agent_personas SET is_active=false,version=8 WHERE id=$1::uuid', [agentId]);
        expect(await service.read(tenantId, agentId, actor)).toMatchObject({ operational: { version: 8, body: { isActive: false } },
            draft: { id: first.savedRevision.id, currentBase: false }, evaluationRevisionId: null });
        await expect(service.save(tenantId, agentId, await request({ expectedDraftRevision: first.savedRevision.id }), actor))
            .rejects.toMatchObject({ response: { error: 'agent_operational_version_changed' } });
    });
    it.each(['role', 'cross_tenant', 'activation', 'unsupported_channel', 'unsupported_capability', 'invalid_config', 'missing_cas'])(
        'rejects %s without a revision or live write', async reason => {
            const input: any = await request(), before = await operational();
            let who = actor, tenant = tenantId;
            if (reason === 'role') who = { ...actor, role: 'tenant_supervisor' };
            if (reason === 'cross_tenant') tenant = randomUUID();
            if (reason === 'activation') input.body.isActive = false;
            if (reason === 'unsupported_channel') input.body.channels = ['email'];
            if (reason === 'unsupported_capability') input.body.configJson.tools.gyms = { enabled: true };
            if (reason === 'invalid_config') input.body.configJson.behavior.handoffTriggers = [];
            if (reason === 'missing_cas') delete input.expectedDraftRevision;
            await expect(service.save(tenant, agentId, input, who)).rejects.toThrow();
            expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(0);
            expect(await operational()).toEqual(before);
        });
    it.each(['payments', 'prompt'])('retains the %s entitlement gate on draft edits', async feature => {
        throttle.isFeatureEnabled.mockResolvedValue(false);
        const input = await request();
        if (feature === 'payments') input.body.configJson.tools.payments = { enabled: true };
        else Object.assign(input.body.configJson, { editorMode: 'prompt', customPrompt: 'Follow the confirmed business policies.' });
        await expect(service.save(tenantId, agentId, input, actor)).rejects.toMatchObject({ status: 403 });
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(0);
    });
    it('uses the authenticated actor at the controller boundary and never accepts it from the body', async () => {
        const controller = new AgentDraftController(service), input = await request();
        await expect(controller.save(tenantId, agentId, { ...input, actor } as any, { user: { sub: actor.id, role: actor.role } }))
            .rejects.toMatchObject({ response: { error: 'agent_configuration_revision_request_invalid' } });
        const result = await controller.save(tenantId, agentId, input, { user: { sub: actor.id, role: actor.role } });
        expect(result.data.savedRevision.id).toBeTruthy();
        expect((await query('SELECT created_by FROM agent_configuration_revisions'))[0].created_by).toBe(actor.id);
    });
    it('discards a stale pointer explicitly, retains history and starts a new draft on the current operational baseline', async () => {
        const saved = await service.save(tenantId, agentId, await request(), actor);
        await query('UPDATE agent_personas SET version=8,is_active=false WHERE id=$1::uuid', [agentId]);
        const current = await service.read(tenantId, agentId, actor);
        const input = { expectedOperationalVersion: 8, expectedOperationalHash: current.operational.hash, expectedDraftRevision: saved.savedRevision.id, requestKey: randomUUID() };
        expect(await service.discard(tenantId, agentId, input, actor)).toMatchObject({ draft: null, evaluationRevisionId: null });
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(1);
        const next = await service.save(tenantId, agentId, await request({ expectedOperationalVersion: 8 }), actor);
        expect(next.workspace.draft).toMatchObject({ currentBase: true, baseOperationalVersion: 8 });
        expect((await service.discard(tenantId, agentId, input, actor)).draft?.id).toBe(next.savedRevision.id);
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_draft_discards'))[0].n).toBe(1);
    });
    it('refuses a stale discard UUID or changed operational hash without deleting a newer pointer', async () => {
        const first = await service.save(tenantId, agentId, await request(), actor);
        const second = await service.save(tenantId, agentId, await request({ expectedDraftRevision: first.savedRevision.id }), actor);
        const input = { expectedOperationalVersion: 7, expectedOperationalHash: second.workspace.operational.hash,
            expectedDraftRevision: first.savedRevision.id, requestKey: randomUUID() };
        await expect(service.discard(tenantId, agentId, input, actor)).rejects.toMatchObject({ response: { error: 'agent_draft_revision_changed' } });
        await query("UPDATE agent_personas SET channels=ARRAY['telegram'] WHERE id=$1::uuid", [agentId]);
        await expect(service.discard(tenantId, agentId, { ...input, expectedDraftRevision: second.savedRevision.id }, actor)).rejects.toMatchObject({ response: { error: 'agent_operational_configuration_changed' } });
        expect((await service.read(tenantId, agentId, actor)).draft?.id).toBe(second.savedRevision.id);
    });
    it('retains the draft pointer when discard auditing fails, then permits the exact retry', async () => {
        const first = await service.save(tenantId, agentId, await request(), actor);
        const input = { expectedOperationalVersion: 7, expectedOperationalHash: first.workspace.operational.hash,
            expectedDraftRevision: first.savedRevision.id, requestKey: randomUUID() };
        await query('ALTER TABLE agent_configuration_draft_discards ADD CONSTRAINT synthetic_reject_discard CHECK(false)');
        try {
            await expect(service.discard(tenantId, agentId, input, actor)).rejects.toThrow();
            expect((await service.read(tenantId, agentId, actor)).draft?.id).toBe(first.savedRevision.id);
        } finally { await query('ALTER TABLE agent_configuration_draft_discards DROP CONSTRAINT synthetic_reject_discard'); }
        expect(await service.discard(tenantId, agentId, input, actor)).toMatchObject({ draft: null });
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_draft_discards'))[0].n).toBe(1);
    });
    it('commits an Assist review and draft receipt together, with no operational event or assignment update', async () => {
        const before = await operational();
        const proposal = await assist.propose(tenantId, agentId, [{ path: 'persona.greeting', value: 'Welcome to our business.' }], actor);
        const [first, replay] = await Promise.all([assist.apply(tenantId, proposal.id, proposal.digest, actor), assist.apply(tenantId, proposal.id, proposal.digest, actor)]);
        expect(first.draft?.savedRevision.id).toBe(replay.draft?.savedRevision.id);
        expect(first.draft?.savedRevision.body.configJson.persona.greeting).toBe('Welcome to our business.');
        expect(first.proposal).toMatchObject({ targetScope: 'agent_draft', expectedDraftRevision: null, appliedVersion: 7 });
        expect(await operational()).toEqual(before); expect(events.emit).not.toHaveBeenCalled(); expect(caches).not.toHaveBeenCalled();
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_commands'))[0].n).toBe(1);
        expect((await query('SELECT applied_draft_revision FROM agent_config_proposals'))[0].applied_draft_revision).toBe(first.draft?.savedRevision.id);
    });
    it('proposes against the saved draft and refuses application when an editor saves a newer revision', async () => {
        const input = await request(); input.body.configJson.persona.greeting = 'Draft greeting';
        const first = await service.save(tenantId, agentId, input, actor);
        const proposal = await assist.propose(tenantId, agentId, [{ path: 'persona.greeting', value: 'Reviewed greeting' }], actor);
        expect(proposal).toMatchObject({ expectedDraftRevision: first.savedRevision.id, changes: [{ before: 'Draft greeting' }] });
        await service.save(tenantId, agentId, await request({ expectedDraftRevision: first.savedRevision.id }), actor);
        await expect(assist.apply(tenantId, proposal.id, proposal.digest, actor)).rejects.toMatchObject({ response: { error: 'configuration_proposal_source_changed' } });
        expect((await operational()).config_json.persona.greeting).toBeUndefined();
    });
    it('rolls back both the draft and pointer if the final proposal audit update fails', async () => {
        const proposal = await assist.propose(tenantId, agentId, [{ path: 'persona.greeting', value: 'Never published' }], actor);
        await query("ALTER TABLE agent_config_proposals ADD CONSTRAINT synthetic_reject_applied CHECK(status <> 'applied')");
        try {
            await expect(assist.apply(tenantId, proposal.id, proposal.digest, actor)).rejects.toThrow();
            expect((await service.read(tenantId, agentId, actor)).draft).toBeNull();
            expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(0);
        } finally { await query('ALTER TABLE agent_config_proposals DROP CONSTRAINT synthetic_reject_applied'); }
    });
    it('applies account hours separately, preserving every live config and invalidating draft baselines through versions', async () => {
        const before = await operational();
        await service.save(tenantId, agentId, await request(), actor);
        const hours = { is247: false, timezone: 'America/Bogota', afterHoursMessage: 'Our team will reply during business hours.',
            schedule: Object.fromEntries(AGENT_ACCOUNT_DAYS.map(day => [day, { enabled: day === 'monday', open: '08:00', close: '17:00' }])) };
        await expect(assist.propose(tenantId, agentId, [{ path: 'account.businessHours', value: hours }, { path: 'persona.greeting', value: 'Mixed' }], actor))
            .rejects.toMatchObject({ response: { error: 'configuration_account_separate_review' } });
        const proposal = await assist.propose(tenantId, agentId, [{ path: 'account.businessHours', value: hours }], actor);
        const result = await assist.apply(tenantId, proposal.id, proposal.digest, actor);
        expect(result.proposal).toMatchObject({ targetScope: 'account', appliedVersion: 8 }); expect(result.draft).toBeUndefined();
        expect((await operational()).config_json).toEqual(before.config_json);
        expect((await service.read(tenantId, agentId, actor)).draft?.currentBase).toBe(false);
        await assist.apply(tenantId, proposal.id, proposal.digest, actor);
        expect((await operational()).version).toBe(8); expect(events.emit).toHaveBeenCalledTimes(1);
        expect(finalize).toHaveBeenCalledWith(tenantId, { businessHours: true });
    });
});
