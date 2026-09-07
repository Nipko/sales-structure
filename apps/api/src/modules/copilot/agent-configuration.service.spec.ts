import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentConfigurationService } from './agent-configuration.service';
import { AGENT_ACCOUNT_DAYS, type AgentAccountBusinessHours, type AgentConfigurationChange } from '@parallext/shared';
import { operationalConfigurationBody, operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { randomUUID } from 'crypto';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const ACTOR = { id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin' };
const PROPOSAL = '44444444-4444-4444-8444-444444444444';
const changes: AgentConfigurationChange[] = [{ path: 'persona.greeting', value: 'Hola, ¿en qué te puedo ayudar?' }];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hours = (): AgentAccountBusinessHours => ({ is247: false, timezone: 'America/Bogota', afterHoursMessage: 'Te responderemos en el horario de atención.',
    schedule: Object.fromEntries(AGENT_ACCOUNT_DAYS.map(day => [day, { enabled: day === 'monday', open: '08:00', close: '17:00' }])) as AgentAccountBusinessHours['schedule'] });

function harness() {
    let agent: any = { id: AGENT, name: 'Luna', version: 4, is_active: true, is_default: true, channels: [], channel_bindings: [], config_json: { persona: { name: 'Luna', greeting: 'Hola' }, tools: { restaurants: { enabled: true, token: 'PRIVATE' } } } };
    let draft: any = null;
    let ledger: any[] = [];
    let failLedger = false;
    const tenant: any = { industry: 'restaurantes', settings: { verticalConfig: { subType: 'casual_dining' }, businessHours: hours(), unrelated: { secret: 'preserve' } } };
    let otherVersion = 2;
    const sqlCalls: Array<{ sql: string; params: any[] }> = [];
    const query = async (sql: string, params: any[]) => {
        sqlCalls.push({ sql, params });
        if (sql.startsWith('ALTER TABLE')) return [];
        if (sql.includes('FROM public.tenants')) return [clone(tenant)];
        if (sql.startsWith('UPDATE public.tenants')) { tenant.settings.businessHours = JSON.parse(params[1]); return [{ id: TENANT }]; }
        if (sql.startsWith('UPDATE agent_personas SET version=')) { otherVersion++; agent.version++; return [{ id: 'other', version: otherVersion }, { id: AGENT, version: agent.version }]; }
        if (sql.startsWith('SELECT') && sql.includes('agent_config_proposals')) return clone(ledger.filter(row => sql.includes('requested_by') ? row.requested_by === params[0] && row.request_key === params[1] : row.id === params[0]));
        if (sql.startsWith('SELECT') && sql.includes('agent_personas')) return params[0] === AGENT ? [clone(agent)] : [];
        if (sql.startsWith('INSERT INTO agent_config_proposals')) {
            if (ledger.some(row => row.requested_by === params[1] && row.request_key === params[2])) return [];
            const row = { id: PROPOSAL, agent_id: params[0], requested_by: params[1], request_key: params[2], expected_version: params[3], before_hash: params[4], digest: params[5], changes: JSON.parse(params[6]), status: 'proposed', expires_at: new Date(Date.now() + 1_800_000).toISOString() };
            Object.assign(row, { agent_name: params[7], target_scope: params[8], expected_draft_revision: params[9], base_operational_hash: params[10] }); ledger.push(row); return [clone(row)];
        }
        if (sql.startsWith('UPDATE agent_personas')) {
            if (agent.version !== params[3]) return [];
            agent = { ...agent, config_json: JSON.parse(params[1]), name: params[2], version: agent.version + 1 }; return [{ version: agent.version }];
        }
        if (sql.startsWith('UPDATE agent_config_proposals')) {
            if (failLedger) throw new Error('ledger unavailable');
            const row = ledger.find(item => item.id === params[0]);
            Object.assign(row, { status: 'applied', applied_by: params[1], applied_version: params[2], applied_draft_revision: params[3] }); return [clone(row)];
        }
        throw new Error('Unhandled SQL: ' + sql);
    };
    const prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_scope'), ensureCanonicalTables: jest.fn(),
        executeInTenantSchema: jest.fn(async (_schema, sql, params) => query(sql, params)),
        transactionInTenantSchema: jest.fn(async (_schema, work) => {
            const before = { agent: clone(agent), draft: clone(draft), ledger: clone(ledger), tenant: clone(tenant), otherVersion };
            try { return await work(query); } catch (error) { agent = before.agent; draft = before.draft; ledger = before.ledger; Object.assign(tenant, before.tenant); otherVersion = before.otherVersion; throw error; }
        }), tenant: { findUnique: jest.fn().mockImplementation(async () => clone(tenant)) } };
    const persona = { assertAgentConfigValid: jest.fn(), assertAppointmentsPrerequisites: jest.fn().mockResolvedValue(undefined), invalidatePersonaResolutionCaches: jest.fn().mockResolvedValue(undefined) };
    const assessment = { getAssessment: jest.fn().mockResolvedValue({ agent: { id: AGENT, version: 5 } }) };
    const events = { emit: jest.fn() };
    const capabilities = { resolve: jest.fn().mockResolvedValue({ contract: { publishedTools: ['search_faqs'], degraded: false, excluded: [] } }) };
    const tenants = { finalizeConfigurationUpdate: jest.fn().mockResolvedValue(undefined) };
    const workspace = () => ({ agentId: AGENT, operational: { version: agent.version, hash: operationalConfigurationHash(agent), body: operationalConfigurationBody(clone(agent)) }, draft,
        evaluationRevisionId: draft?.id ?? null });
    const drafts = { read: jest.fn(async (_tenant, id) => { if (id !== AGENT) throw new NotFoundException(); return clone(workspace()); }),
        readWithQuery: jest.fn(async () => clone(workspace())),
        saveWithQuery: jest.fn(async (_query, _schema, _tenant, _agent, input) => {
            draft = { id: randomUUID(), body: clone(input.body), currentBase: true, baseOperationalHash: operationalConfigurationHash(agent) };
            return { savedRevision: clone(draft), idempotentReplay: false, workspace: clone(workspace()) };
        }), readSavedWithQuery: jest.fn(async () => ({ savedRevision: clone(draft), idempotentReplay: true, workspace: clone(workspace()) })) };
    return { service: new AgentConfigurationService(prisma as any, persona as any, assessment as any, events as any, capabilities as any, tenants as any, drafts as any), prisma, persona, assessment, events, sqlCalls, capabilities, tenants, drafts, draft: () => draft, otherVersion: () => otherVersion,
        agent: () => agent, ledger: () => ledger, tenant, failLedger: () => { failLedger = true; } };
}

describe('reviewed agent configuration', () => {
    it('limits editable context to reviewed paths and reads the latest saved draft without exposing tool secrets', async () => {
        const h = harness();
        const operational = await h.service.getEditableContext(TENANT, AGENT, ACTOR);
        expect(operational).toMatchObject({ scope: 'operational', values: { 'persona.greeting': 'Hola', 'tools.restaurants.enabled': true } });
        expect(JSON.stringify(operational)).not.toContain('PRIVATE');
        const p = await h.service.propose(TENANT, AGENT, changes, ACTOR);
        await h.service.apply(TENANT, p.id, p.digest, ACTOR);
        expect(await h.service.getEditableContext(TENANT, AGENT, ACTOR)).toMatchObject({ scope: 'draft', draftRevision: h.draft().id,
            currentBase: true, values: { 'persona.greeting': changes[0].value } });
        h.draft().currentBase = false;
        expect(await h.service.getEditableContext(TENANT, AGENT, ACTOR)).toMatchObject({ scope: 'draft', currentBase: false });
    });
    it('expires a legacy proposal rather than replaying its former operational write through the draft flow', async () => {
        const h = harness();
        const p = await h.service.propose(TENANT, AGENT, changes, ACTOR);
        h.ledger()[0].target_scope = 'legacy'; h.ledger()[0].status = 'applied';
        await expect(h.service.apply(TENANT, p.id, p.digest, ACTOR)).rejects.toMatchObject({ response: { error: 'configuration_legacy_proposal_expired' } });
        expect(h.drafts.saveWithQuery).not.toHaveBeenCalled();
        expect(h.agent().version).toBe(4);
    });
    it('rejects guided voice edits that would have no effect in custom-prompt mode', async () => {
        const h = harness(); h.agent().config_json.editorMode = 'prompt'; h.agent().config_json.customPrompt = 'Instrucciones activas';
        await expect(h.service.propose(TENANT, AGENT, changes, ACTOR)).rejects.toMatchObject({ response: { error: 'configuration_prompt_mode' } });
        expect(h.ledger()).toHaveLength(0);
        await expect(h.service.propose(TENANT, AGENT, [{ path: 'behavior.handoffTriggers', value: ['Cliente pide persona'] }], ACTOR)).resolves.toMatchObject({ status: 'proposed' });
    });
    it('checks enabled tools on every assigned channel both when proposing and when applying', async () => {
        const h = harness(); h.agent().channels = ['whatsapp', 'telegram'];
        const p = await h.service.propose(TENANT, AGENT, [{ path: 'tools.faqs.enabled', value: true }], ACTOR);
        expect(h.capabilities.resolve).toHaveBeenCalledTimes(2);
        expect(h.capabilities.resolve).toHaveBeenCalledWith(expect.objectContaining({ role: 'tenant_agent', channelType: 'telegram', config: expect.objectContaining({ tools: expect.objectContaining({ faqs: { enabled: true } }) }) }));
        await h.service.apply(TENANT, p.id, p.digest, ACTOR);
        expect(h.capabilities.resolve).toHaveBeenCalledTimes(4);
        expect(h.draft().body.configJson.tools.faqs.enabled).toBe(true);
        expect(h.agent().config_json.tools.faqs).toBeUndefined();
    });
    it.each(['not_in_subtype', 'plan_missing_feature', 'readiness_unmet', 'external_system_of_record', 'provider_unavailable'])('refuses capability activation excluded by %s', async reason => {
        const h = harness();
        h.capabilities.resolve.mockResolvedValue({ contract: { degraded: false, publishedTools: [], excluded: [{ subject: 'faqs', reason }] } } as any);
        await expect(h.service.propose(TENANT, AGENT, [{ path: 'tools.faqs.enabled', value: true }], ACTOR)).rejects.toMatchObject({ response: { error: 'configuration_capability_blocked', reasons: [reason] } });
        expect(h.ledger()).toHaveLength(0);
    });
    it('rejects an activation if runtime readiness is lost after review, but can still disable a tool during an outage', async () => {
        const h = harness();
        const p = await h.service.propose(TENANT, AGENT, [{ path: 'tools.faqs.enabled', value: true }], ACTOR);
        h.capabilities.resolve.mockRejectedValue(new Error('provider unavailable'));
        await expect(h.service.apply(TENANT, p.id, p.digest, ACTOR)).rejects.toMatchObject({ response: { error: 'configuration_capability_unavailable' } });
        expect(h.agent().version).toBe(4);
        await expect(h.service.propose(TENANT, AGENT, [{ path: 'tools.restaurants.enabled', value: false }], ACTOR)).resolves.toMatchObject({ status: 'proposed' });
    });
    it('reuses canonical appointment prerequisites, including availability slots', async () => {
        const h = harness(); h.persona.assertAppointmentsPrerequisites.mockRejectedValue(new Error('No slots'));
        await expect(h.service.propose(TENANT, AGENT, [{ path: 'tools.appointments.enabled', value: true }], ACTOR)).rejects.toMatchObject({ response: { error: 'configuration_capability_blocked', reasons: ['readiness_unmet'] } });
        expect(h.persona.assertAppointmentsPrerequisites).toHaveBeenCalledWith(TENANT, 'tenant_scope');
        expect(h.ledger()).toHaveLength(0);
    });
    it('reviews and applies canonical tenant hours without replacing unrelated settings, then invalidates every agent revision', async () => {
        const h = harness(); const next = hours(); next.schedule.monday.close = '18:00';
        const p = await h.service.propose(TENANT, AGENT, [{ path: 'account.businessHours', value: next }], ACTOR);
        expect(p.changes[0].before).toEqual(hours());
        expect(h.tenant.settings.businessHours.schedule.monday.close).toBe('17:00');
        await h.service.apply(TENANT, p.id, p.digest, ACTOR);
        expect(h.tenant.settings.businessHours).toEqual(next);
        expect(h.tenant.settings.unrelated).toEqual({ secret: 'preserve' });
        expect(h.otherVersion()).toBe(3);
        expect(h.agent().config_json.account).toBeUndefined();
        expect(h.tenants.finalizeConfigurationUpdate).toHaveBeenCalledWith(TENANT, { businessHours: true });
        await h.service.apply(TENANT, p.id, p.digest, ACTOR);
        expect(h.otherVersion()).toBe(3);
    });
    it('rejects a stale account-hours proposal and rolls back tenant hours if the application ledger fails', async () => {
        const h = harness(); const next = hours(); next.is247 = true;
        const p = await h.service.propose(TENANT, AGENT, [{ path: 'account.businessHours', value: next }], ACTOR);
        h.tenant.settings.businessHours.timezone = 'Europe/Paris';
        await expect(h.service.apply(TENANT, p.id, p.digest, ACTOR)).rejects.toBeInstanceOf(ConflictException);
        h.tenant.settings.businessHours = hours(); h.failLedger();
        await expect(h.service.apply(TENANT, p.id, p.digest, ACTOR)).rejects.toThrow('ledger unavailable');
        expect(h.tenant.settings.businessHours).toEqual(hours());
        expect(h.otherVersion()).toBe(2);
    });
    it.each(['timezone', 'time', 'reverse', 'missing_day'])('rejects malformed account hours: %s', async reason => {
        const h = harness(); const next: any = hours();
        if (reason === 'timezone') next.timezone = 'Mars/Unknown';
        if (reason === 'time') next.schedule.monday.open = '25:00';
        if (reason === 'reverse') next.schedule.monday.close = '07:00';
        if (reason === 'missing_day') delete next.schedule.sunday;
        await expect(h.service.propose(TENANT, AGENT, [{ path: 'account.businessHours', value: next }], ACTOR)).rejects.toBeInstanceOf(BadRequestException);
        expect(h.ledger()).toHaveLength(0);
    });
    it('persists a reviewable diff without changing the agent, exposing secrets or invalidating runtime caches', async () => {
        const h = harness();
        const result = await h.service.propose(TENANT, AGENT, changes, ACTOR, 'request-0001');
        expect(result).toMatchObject({ expectedVersion: 4, status: 'proposed', changes: [{ ...changes[0], before: 'Hola' }] });
        expect(h.agent().version).toBe(4);
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
        expect(h.persona.invalidatePersonaResolutionCaches).not.toHaveBeenCalled();
        expect(h.persona.assertAgentConfigValid).toHaveBeenCalledWith(expect.objectContaining({ persona: { name: 'Luna', greeting: changes[0].value }, tools: h.agent().config_json.tools }), { partial: true });
    });
    it('uses proposal and agent locks, exact digest, current version and an atomic audit record', async () => {
        const h = harness();
        const p = await h.service.propose(TENANT, AGENT, changes, ACTOR);
        const result = await h.service.apply(TENANT, p.id, p.digest, ACTOR);
        expect(result).toMatchObject({ proposal: { status: 'applied', appliedVersion: 4, targetScope: 'agent_draft', appliedDraftRevision: h.draft().id }, verification: 'verified', assessmentScope: 'operational' });
        expect(h.draft().body.configJson.persona.greeting).toBe(changes[0].value);
        expect(h.agent().config_json.persona.greeting).toBe('Hola');
        expect(h.ledger()[0].applied_by).toBe(ACTOR.id);
        expect(h.drafts.saveWithQuery).toHaveBeenCalledWith(expect.any(Function), 'tenant_scope', TENANT, AGENT,
            expect.objectContaining({ expectedOperationalVersion: 4, expectedDraftRevision: null }), ACTOR);
        expect(h.sqlCalls.find(call => call.sql.startsWith('UPDATE agent_personas'))).toBeUndefined();
        expect(h.assessment.getAssessment).toHaveBeenCalledWith(TENANT, AGENT);
        expect(h.events.emit).not.toHaveBeenCalled();
    });
    it('replays both request and application idempotently, including after application', async () => {
        const h = harness();
        const p = await h.service.propose(TENANT, AGENT, changes, ACTOR, 'request-0001');
        await h.service.apply(TENANT, p.id, p.digest, ACTOR);
        await h.service.apply(TENANT, p.id, p.digest, ACTOR);
        const replay = await h.service.propose(TENANT, AGENT, changes, ACTOR, 'request-0001');
        expect(replay).toMatchObject({ id: p.id, digest: p.digest, status: 'applied' });
        expect(h.agent().version).toBe(4);
        expect(h.ledger()).toHaveLength(1);
        expect(h.sqlCalls.filter(call => call.sql.startsWith('UPDATE agent_personas'))).toHaveLength(0);
        expect(h.drafts.saveWithQuery).toHaveBeenCalledTimes(1);
        await expect(h.service.propose(TENANT, AGENT, [{ ...changes[0], value: 'Different' }], ACTOR, 'request-0001')).rejects.toBeInstanceOf(ConflictException);
    });
    it.each(['tenant_supervisor', 'tenant_agent'])('rejects %s at the mutation service, even if called without the controller', async role => {
        const h = harness();
        await expect(h.service.propose(TENANT, AGENT, changes, { ...ACTOR, role })).rejects.toBeInstanceOf(ForbiddenException);
        await expect(h.service.apply(TENANT, PROPOSAL, 'a'.repeat(64), { ...ACTOR, role })).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.prisma.getTenantSchemaName).not.toHaveBeenCalled();
    });
    it.each([
        [{ path: 'tools.mcp.enabled', value: true }],
        [{ path: '__proto__.enabled', value: 'yes' }],
        [{ path: 'persona.name', value: '' }],
        [{ ...changes[0], confirmed: true }],
        [changes[0], changes[0]],
        [{ path: 'mission', value: { version: 1, objective: 'Everything', intentKeys: ['pay'], successCriteria: [], handoffConditions: [] } }],
        [{ path: 'mission', value: { version: 1, objective: 'Everything', intentKeys: ['unsupported_operation'], successCriteria: ['Paid'], handoffConditions: ['Failed'] } }],
    ].map(invalid => ({ invalid })))('rejects unsupported or malformed commands $invalid before creating a proposal', async ({ invalid }) => {
        const h = harness();
        await expect(h.service.propose(TENANT, AGENT, invalid, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
        expect(h.ledger()).toHaveLength(0);
    });
    it('requires a real tenant agent and rejects empty scope', async () => {
        const h = harness();
        await expect(h.service.propose(TENANT, undefined as any, changes, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
        await expect(h.service.propose(TENANT, PROPOSAL, changes, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
    it.each(['version', 'config', 'expiry', 'digest', 'tamper'])('rejects stale or changed %s without an effect', async reason => {
        const h = harness();
        const p = await h.service.propose(TENANT, AGENT, changes, ACTOR);
        if (reason === 'version') h.agent().version += 1;
        if (reason === 'config') h.agent().config_json.persona.name = 'Someone else';
        if (reason === 'expiry') h.ledger()[0].expires_at = new Date(Date.now() - 1).toISOString();
        if (reason === 'tamper') h.ledger()[0].changes[0].value = 'Tampered';
        await expect(h.service.apply(TENANT, p.id, reason === 'digest' ? '0'.repeat(64) : p.digest, ACTOR)).rejects.toBeInstanceOf(ConflictException);
        expect(h.agent().config_json.persona.greeting).toBe('Hola');
        expect(h.ledger()[0].status).toBe('proposed');
    });
    it('rolls back the agent change if recording the application fails', async () => {
        const h = harness();
        const p = await h.service.propose(TENANT, AGENT, changes, ACTOR);
        h.failLedger();
        await expect(h.service.apply(TENANT, p.id, p.digest, ACTOR)).rejects.toThrow('ledger unavailable');
        expect(h.agent().version).toBe(4);
        expect(h.agent().config_json.persona.greeting).toBe('Hola');
        expect(h.ledger()[0].status).toBe('proposed');
        expect(h.persona.invalidatePersonaResolutionCaches).not.toHaveBeenCalled();
    });
    it('reports operational assessment unavailability separately from a re-read saved draft', async () => {
        const h = harness();
        const p = await h.service.propose(TENANT, AGENT, changes, ACTOR);
        h.persona.invalidatePersonaResolutionCaches.mockRejectedValueOnce(new Error('redis unavailable'));
        h.assessment.getAssessment.mockRejectedValueOnce(new Error('read unavailable'));
        await expect(h.service.apply(TENANT, p.id, p.digest, ACTOR)).resolves.toMatchObject({ proposal: { status: 'applied' }, assessment: null, assessmentScope: 'operational', verification: 'verified' });
        await expect(h.service.apply(TENANT, p.id, p.digest, ACTOR)).resolves.toMatchObject({ proposal: { status: 'applied' }, verification: 'verified' });
        expect(h.agent().version).toBe(4);
    });
    it('rechecks the business profile before applying an old mission proposal', async () => {
        const h = harness();
        const p = await h.service.propose(TENANT, AGENT, [{ path: 'mission', value: { version: 1, objective: 'Atender pedidos', intentKeys: ['place_food_order'], successCriteria: ['Pedido confirmado'], handoffConditions: ['Alergia no resuelta'] } }], ACTOR);
        h.tenant.industry = 'otro'; h.tenant.settings.verticalConfig.subType = null as any;
        await expect(h.service.apply(TENANT, p.id, p.digest, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
        expect(h.agent().version).toBe(4);
    });
});
