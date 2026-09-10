import { EventEmitter2 } from '@nestjs/event-emitter';
import { ToolApprovalWorkflowService } from './tool-approval-workflow.service';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const tenantId = '11111111-1111-4111-8111-111111111111', agentId = '22222222-2222-4222-8222-222222222222';
const contactId = '33333333-3333-4333-8333-333333333333', conversationId = '44444444-4444-4444-8444-444444444444';
const previousAgentId = '55555555-5555-4555-8555-555555555555', schemaName = 'tenant_served_approval';
const original = { id: agentId, name: 'Agent', version: 7, is_active: true,
    config_json: { industry: 'retail', tools: { appointments: { enabled: true } } } };
const operationalScope = { kind: 'agent' as const, tenantId, schemaName, agentId, version: 7,
    operationalHash: operationalConfigurationHash(original) };

function harness(options: { claim?: any; resolution?: any; tenant?: any; conversation?: any; transactionTenant?: any } = {}) {
    const claim = { tenantId, schemaName, ticketId: contactId, leaseToken: conversationId, toolName: 'cancel_appointment',
        contactId, conversationId, channelType: 'web_widget', operationalScope,
        args: { appointmentId: contactId, operationalScope: { ...operationalScope, agentId: previousAgentId, version: 99 } },
        ...options.claim };
    const controls = { finishApprovalResume: jest.fn(async (_claim: any, result: any) => result) };
    const executor = { execute: jest.fn().mockResolvedValue({ success: true }) };
    const capabilities = { resolve: jest.fn().mockResolvedValue({ status: { status: 'ok' }, authority: authorityFor('cancel_appointment') }) };
    const persona = {
        getAgent: jest.fn(() => { throw new Error('historical_attribution_is_not_authority'); }),
        resolvePersonaForChannel: jest.fn().mockResolvedValue(options.resolution ?? {
            config: original.config_json, agentId, version: original.version, operationalHash: operationalScope.operationalHash,
        }),
    };
    const conversation = options.conversation ?? {
            channel_type: 'web_widget', channel_account_id: 'widget-connection', contact_id: contactId,
            agent_persona_id: previousAgentId, agent_config_version: 1, agent_attribution_conflicted: true,
        };
    const tenant = options.tenant !== undefined ? options.tenant : {
            schemaName, isActive: true, industry: 'retail', settings: { verticalConfig: { industry: 'retail' } },
        };
    const resolution = options.resolution ?? { config: original.config_json, agentId, version: original.version };
    const query = jest.fn(async (sql: string) => {
        if (sql.includes('FROM public.tenants t')) return options.transactionTenant === null ? [] : [options.transactionTenant ?? tenant];
        if (sql.includes('FROM conversations')) return [conversation];
        if (sql.includes('WITH ranked AS')) return [{ matches: resolution.agentId ? [{ ...original, id: resolution.agentId,
            config_json: resolution.config, version: resolution.version }] : [], has_agents: !resolution.config || !!resolution.agentId,
            legacy_config: resolution.agentId ? null : resolution.config }];
        return [];
    });
    const prisma = {
        executeInTenantSchema: jest.fn(),
        transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(query)),
        tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
    };
    const workflow = new ToolApprovalWorkflowService(prisma as any, controls as any, executor as any,
        new EventEmitter2(), {} as any, capabilities as any, persona as any);
    return { claim, controls, executor, capabilities, persona, prisma, query, run: () => (workflow as any).executeClaim(claim) };
}

describe('approved effects preserve the proposal origin across conversation routing changes', () => {
    it.each([false, true])('accepts current B despite historical A attribution (draft=%s)', async draft => {
        const h = harness({ claim: draft ? { draftReview: { agentId, agentVersion: 7 } } : {} });
        expect(await h.run()).toEqual({ success: true });
        expect(h.persona.getAgent).not.toHaveBeenCalled();
        expect(h.persona.resolvePersonaForChannel).not.toHaveBeenCalled();
        expect(h.query).toHaveBeenCalledWith(expect.stringContaining('WITH ranked AS'), ['web_widget:widget-connection', 'web_widget']);
        expect(h.executor.execute).toHaveBeenCalledWith(schemaName, tenantId, contactId, 'cancel_appointment', h.claim.args,
            conversationId, expect.objectContaining({ operationalScope }));
    });
    it.each(['missing', 'foreign_tenant', 'foreign_schema', 'malformed_hash'])('rejects %s private origin before routing, ignoring model provenance', async mode => {
        const scope = mode === 'missing' ? undefined : { ...operationalScope,
            ...(mode === 'foreign_tenant' ? { tenantId: previousAgentId } : {}),
            ...(mode === 'foreign_schema' ? { schemaName: 'tenant_other' } : {}),
            ...(mode === 'malformed_hash' ? { operationalHash: 'bad' } : {}) };
        const h = harness({ claim: { operationalScope: scope } });
        expect(await h.run()).toMatchObject({ error: 'agent_operational_revision_changed', persisted: false });
        // A legitimate schema owner can close a malformed/old origin without retrying forever.
        expect(h.controls.finishApprovalResume).toHaveBeenCalledTimes(1);
        expect(h.persona.resolvePersonaForChannel).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it.each(['version', 'hash', 'different_agent', 'inactive'])('does not move an old proposal to a current %s resolution', async mode => {
        const current = { ...original, ...(mode === 'version' ? { version: 8 } : {}),
            ...(mode === 'hash' ? { config_json: { ...original.config_json, rules: ['Changed'] } } : {}),
            ...(mode === 'different_agent' ? { id: previousAgentId } : {}) };
        const h = harness({ resolution: mode === 'inactive' ? { config: null, agentId: null, version: null } : {
            config: current.config_json, agentId: current.id, version: current.version, operationalHash: operationalConfigurationHash(current),
        } });
        expect(await h.run()).toMatchObject({ error: mode === 'inactive' ? 'approval_agent_unavailable' : 'agent_operational_revision_changed' });
        expect(h.capabilities.resolve).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it.each([{ agentId: previousAgentId, agentVersion: 7 }, { agentId, agentVersion: 6 }])('rejects draft review disagreement: %p', async draftReview => {
        const h = harness({ claim: { draftReview } });
        expect(await h.run()).toMatchObject({ error: 'draft_revision_changed' });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('does not upgrade an old media ticket with draftReview alone into fresh authority', async () => {
        const h = harness({ claim: { toolName: 'send_product_image', operationalScope: undefined,
            draftReview: { agentId, agentVersion: 7 } } });
        expect(await h.run()).toMatchObject({ error: 'agent_operational_revision_changed' });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it.each([{ schemaName: 'tenant_other', isActive: true }, null])('does not finalize through an absent or remapped tenant: %p', async tenant => {
        const h = harness({ tenant });
        expect(await h.run()).toEqual({ state: 'in_progress', result: {
            error: 'approval_tenant_unavailable', persisted: false, controlBlocked: true,
        } });
        expect(h.controls.finishApprovalResume).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(h.persona.resolvePersonaForChannel).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('can finalize a failure for an inactive tenant with the same verified schema', async () => {
        const h = harness({ tenant: { schemaName, isActive: false } });
        expect(await h.run()).toMatchObject({ error: 'approval_tenant_unavailable' });
        expect(h.controls.finishApprovalResume).toHaveBeenCalledTimes(1);
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it.each(['tenantId', 'ticketId', 'leaseToken', 'contactId', 'conversationId', 'schemaName'])('does not query or finalize malformed claim %s', async key => {
        const h = harness({ claim: { [key]: 'invalid;scope' } });
        expect(await h.run()).toMatchObject({ state: 'in_progress', result: {
            error: 'approval_context_invalid', persisted: false,
        } });
        expect(h.prisma.tenant.findUnique).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(h.controls.finishApprovalResume).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('keeps the lease untouched when the global tenant lookup fails before ownership is known', async () => {
        const h = harness();
        h.prisma.tenant.findUnique.mockRejectedValueOnce(new Error('registry_unavailable'));
        expect(await h.run()).toMatchObject({ state: 'in_progress', result: {
            error: 'approval_resume_failed', persisted: false,
        } });
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(h.controls.finishApprovalResume).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('does not read local context or finalize when the short transaction detects a remap after the global precheck', async () => {
        const h = harness({ transactionTenant: null });
        expect(await h.run()).toMatchObject({ state: 'in_progress', result: { error: 'approval_tenant_unavailable' } });
        expect(h.query.mock.calls.map(call => call[0]).some(sql => sql.includes('FROM conversations') || sql.includes('WITH ranked AS'))).toBe(false);
        expect(h.controls.finishApprovalResume).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it.each([{ contact_id: previousAgentId }, { channel_type: 'whatsapp' }, { channel_account_id: null }])('rejects changed conversation binding: %p', async changed => {
        const h = harness({ conversation: { contact_id: contactId, channel_type: 'web_widget', channel_account_id: 'widget', ...changed } });
        expect(await h.run()).toMatchObject({ error: 'approval_context_changed' });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it.each([false, true])('only accepts explicit legacy provenance while resolver remains legacy (durable=%s)', async durable => {
        const legacyConfigHash = revisionHash(original.config_json);
        const h = harness({ claim: { operationalScope: { kind: 'legacy', tenantId, schemaName, legacyConfigHash } },
            ...(!durable ? { resolution: { config: original.config_json, agentId: null, version: null, legacyConfigHash } } : {}) });
        expect(await h.run()).toMatchObject(durable ? { error: 'agent_operational_revision_changed' } : { success: true });
        expect(h.executor.execute).toHaveBeenCalledTimes(durable ? 0 : 1);
    });
});
