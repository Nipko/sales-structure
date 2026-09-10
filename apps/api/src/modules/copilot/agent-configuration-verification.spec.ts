import { NotFoundException } from '@nestjs/common';
import { AGENT_ACCOUNT_DAYS, type AgentAccountBusinessHours, type AgentConfigurationChange } from '@parallext/shared';
import { operationalConfigurationBody, operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { AgentConfigurationService } from './agent-configuration.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const ACTOR = { id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin' };
const PROPOSAL = '44444444-4444-4444-8444-444444444444';
const REVISION = '55555555-5555-4555-8555-555555555555';
const MOVED = '66666666-6666-4666-8666-666666666666';
const REVISION_HASH = 'b'.repeat(64);
const TIMEOUT_MS = 15_000;
const greeting: AgentConfigurationChange[] = [{ path: 'persona.greeting', value: 'Hola, ¿en qué te puedo ayudar?' }];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hours = (): AgentAccountBusinessHours => ({ is247: false, timezone: 'America/Bogota', afterHoursMessage: 'Te respondemos mañana.',
    schedule: Object.fromEntries(AGENT_ACCOUNT_DAYS.map(day => [day, { enabled: day === 'monday', open: '08:00', close: '17:00' }])) as AgentAccountBusinessHours['schedule'] });

function harness(runner?: { test: jest.Mock }, options: { language?: string } = {}) {
    const agent: any = { id: AGENT, name: 'Luna', version: 4, is_active: true, is_default: true, channels: ['whatsapp'], channel_bindings: [],
        config_json: { persona: { name: 'Luna', greeting: 'Hola' }, ...(options.language ? { language: options.language } : {}) } };
    let draft: any = null;
    let pointer: string | null | undefined;
    let otherVersion = 2;
    const ledger: any[] = [];
    const tenant: any = { industry: 'restaurantes', settings: { verticalConfig: { subType: 'casual_dining' }, businessHours: hours() } };
    const query = async (sql: string, params: any[]) => {
        if (sql.startsWith('ALTER TABLE')) return [];
        if (sql.includes('FROM public.tenants')) return [clone(tenant)];
        if (sql.startsWith('UPDATE public.tenants')) { tenant.settings.businessHours = JSON.parse(params[1]); return [{ id: TENANT }]; }
        if (sql.startsWith('UPDATE agent_personas SET version=')) { otherVersion++; agent.version++; return [{ id: 'other', version: otherVersion }, { id: AGENT, version: agent.version }]; }
        if (sql.startsWith('SELECT') && sql.includes('agent_config_proposals')) return clone(ledger.filter(row => sql.includes('requested_by') ? row.requested_by === params[0] && row.request_key === params[1] : row.id === params[0]));
        if (sql.startsWith('INSERT INTO agent_config_proposals')) {
            const row = { id: PROPOSAL, agent_id: params[0], requested_by: params[1], request_key: params[2], expected_version: params[3],
                before_hash: params[4], digest: params[5], changes: JSON.parse(params[6]), status: 'proposed',
                expires_at: new Date(Date.now() + 1_800_000).toISOString(), agent_name: params[7], target_scope: params[8],
                expected_draft_revision: params[9], base_operational_hash: params[10] };
            ledger.push(row); return [clone(row)];
        }
        if (sql.startsWith('UPDATE agent_config_proposals')) {
            const row = ledger.find(item => item.id === params[0]);
            Object.assign(row, { status: 'applied', applied_by: params[1], applied_version: params[2], applied_draft_revision: params[3] });
            return [clone(row)];
        }
        throw new Error('Unhandled SQL: ' + sql);
    };
    const prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_scope'), ensureCanonicalTables: jest.fn(),
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[]) => query(sql, params)),
        transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(query)),
        tenant: { findUnique: jest.fn().mockImplementation(async () => clone(tenant)) } };
    const persona = { assertAgentConfigValid: jest.fn(), assertAppointmentsPrerequisites: jest.fn().mockResolvedValue(undefined),
        invalidatePersonaResolutionCaches: jest.fn().mockResolvedValue(undefined) };
    const assessment = { getAssessment: jest.fn().mockResolvedValue({ agent: { id: AGENT, version: 4 } }) };
    const events = { emit: jest.fn() };
    const capabilities = { resolve: jest.fn().mockResolvedValue({ contract: { publishedTools: [], degraded: false, excluded: [] } }) };
    const tenants = { finalizeConfigurationUpdate: jest.fn().mockResolvedValue(undefined) };
    const workspace = () => ({ agentId: AGENT, operational: { version: agent.version, hash: operationalConfigurationHash(agent), body: operationalConfigurationBody(clone(agent)) },
        draft, evaluationRevisionId: pointer === undefined ? draft?.id ?? null : pointer });
    const drafts = { read: jest.fn(async (_tenant: string, id: string) => { if (id !== AGENT) throw new NotFoundException(); return clone(workspace()); }),
        readWithQuery: jest.fn(async () => clone(workspace())),
        saveWithQuery: jest.fn(async (_query: any, _schema: string, _tenant: string, _agent: string, input: any) => {
            draft = { id: REVISION, body: clone(input.body), bodyHash: REVISION_HASH, baseOperationalVersion: agent.version,
                baseOperationalHash: operationalConfigurationHash(agent), createdAt: new Date().toISOString(), currentBase: true };
            return { savedRevision: clone(draft), idempotentReplay: false, workspace: clone(workspace()) };
        }),
        readSavedWithQuery: jest.fn(async () => ({ savedRevision: clone(draft), idempotentReplay: true, workspace: clone(workspace()) })) };
    const service = new AgentConfigurationService(prisma as any, persona as any, assessment as any, events as any,
        capabilities as any, tenants as any, drafts as any, runner as any);
    return { service, assessment, drafts, tenant, draft: () => draft, agent: () => agent,
        movePointer: () => { pointer = MOVED; } };
}

async function applyGreeting(h: ReturnType<typeof harness>) {
    const proposal = await h.service.propose(TENANT, AGENT, greeting, ACTOR);
    return h.service.apply(TENANT, proposal.id, proposal.digest, ACTOR);
}

describe('evidence for the applied agent configuration', () => {
    it('exercises the revision that was just written, with tools disabled, and scopes the evidence to it', async () => {
        const runner = { test: jest.fn().mockResolvedValue({ reply: '¡Hola! ¿En qué puedo ayudarte?' }) };
        const h = harness(runner);
        const result = await applyGreeting(h);
        expect(runner.test).toHaveBeenCalledWith(TENANT, AGENT,
            { message: 'Hola', configurationRevisionId: REVISION, channelType: 'whatsapp' }, { disableTools: true });
        expect(result.draftVerification).toEqual({ scope: 'applied_draft', state: 'verified', reason: null,
            revisionId: REVISION, revisionHash: REVISION_HASH, checkedAt: expect.any(String) });
        // The two words stay separate: one describes the configuration that is
        // still serving customers, the other the one that was just edited.
        expect(result.assessmentScope).toBe('operational');
        expect(result.draftVerification.scope).toBe('applied_draft');
    });

    it('probes in the language the applied configuration is written for', async () => {
        const runner = { test: jest.fn().mockResolvedValue({ reply: 'Olá!' }) };
        await applyGreeting(harness(runner, { language: 'pt' }));
        expect(runner.test.mock.calls[0][2]).toMatchObject({ message: 'Olá' });
    });

    // The path this environment actually takes: there is no LLM provider here,
    // so the honest answer must be a state of its own and never `verified`.
    it('reports that nothing could be exercised instead of claiming the change was verified, and still applies', async () => {
        const runner = { test: jest.fn().mockRejectedValue(new Error('no_llm_provider_configured')) };
        const h = harness(runner);
        const result = await applyGreeting(h);
        expect(result.draftVerification).toMatchObject({ state: 'unavailable', reason: 'run_failed', revisionId: REVISION });
        expect(result.proposal.status).toBe('applied');
        expect(h.draft().body.configJson.persona.greeting).toBe(greeting[0].value);
        // The apply itself finished; only the evidence is missing. Collapsing the
        // two into one word is what let a failed check read as a clean result.
        expect(result.verification).toBe('verified');
    });

    it('never presents the operational assessment as evidence when no runner is wired', async () => {
        const h = harness();
        const result = await applyGreeting(h);
        expect(result.assessment).not.toBeNull();
        expect(result.assessmentScope).toBe('operational');
        expect(result.draftVerification).toMatchObject({ state: 'unavailable', reason: 'runner_unavailable', revisionId: REVISION });
    });

    it.each([
        ['quota', new Error('ai_message_quota_exceeded'), 'quota_exhausted'],
        ['a moved revision', Object.assign(new Error('Conflict'), { response: { error: 'agent_draft_revision_changed' } }), 'revision_changed'],
        ['a changed operational base', new Error('agent_operational_configuration_changed'), 'revision_changed'],
        ['an unavailable dependency', new Error('evaluation_revision_service_unavailable'), 'run_failed'],
        ['a runner that throws synchronously', undefined, 'run_failed'],
    ])('gives %s its own reason without downgrading the apply', async (_case, error, reason) => {
        const runner = { test: error ? jest.fn().mockRejectedValue(error) : jest.fn(() => { throw new Error('boom'); }) };
        const result = await applyGreeting(harness(runner));
        expect(result.draftVerification).toMatchObject({ state: 'unavailable', reason });
        expect(result.proposal.status).toBe('applied');
    });

    it('refuses to run against a revision the draft has already moved past', async () => {
        const runner = { test: jest.fn() };
        const h = harness(runner);
        h.movePointer();
        const result = await applyGreeting(h);
        expect(runner.test).not.toHaveBeenCalled();
        expect(result.draftVerification).toMatchObject({ state: 'unavailable', reason: 'revision_changed', revisionId: REVISION });
    });

    it('says a completed run produced no answer rather than calling it verified', async () => {
        const runner = { test: jest.fn().mockResolvedValue({ reply: '   ' }) };
        const result = await applyGreeting(harness(runner));
        expect(result.draftVerification).toMatchObject({ state: 'failed', reason: 'empty_reply', revisionId: REVISION });
    });

    it('has nothing draft-scoped to exercise when the change was applied to account settings', async () => {
        const runner = { test: jest.fn() };
        const h = harness(runner);
        const next = hours(); next.schedule.monday.close = '18:00';
        const proposal = await h.service.propose(TENANT, AGENT, [{ path: 'account.businessHours', value: next }], ACTOR);
        const result = await h.service.apply(TENANT, proposal.id, proposal.digest, ACTOR);
        expect(runner.test).not.toHaveBeenCalled();
        expect(result.draftVerification).toEqual({ scope: 'applied_draft', state: 'not_applicable', reason: 'account_scope',
            revisionId: null, revisionHash: null, checkedAt: expect.any(String) });
        expect(h.tenant.settings.businessHours).toEqual(next);
    });

    it('abandons a provider that stops answering instead of holding the applied change open', async () => {
        let started!: () => void;
        const running = new Promise<void>(resolve => { started = resolve; });
        const runner = { test: jest.fn(() => { started(); return new Promise(() => undefined); }) };
        const h = harness(runner);
        const proposal = await h.service.propose(TENANT, AGENT, greeting, ACTOR);
        jest.useFakeTimers();
        try {
            const pending = h.service.apply(TENANT, proposal.id, proposal.digest, ACTOR);
            await running;
            await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
            const result = await pending;
            expect(result.draftVerification).toMatchObject({ state: 'unavailable', reason: 'timed_out', revisionId: REVISION });
            expect(result.proposal.status).toBe('applied');
        } finally { jest.useRealTimers(); }
    });
});
