import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AGENT_CONFIGURATION_PATHS, buildDomainContractDraft, isAgentAccountBusinessHours, isAgentMissionV1, type AgentConfigurationChange, type AgentConfigurationProposal, type AppliedAgentConfiguration } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PersonaService } from '../persona/persona.service';
import { AgentAssessmentService } from './agent-assessment.service';
import { TurnCapabilityComposerService } from '../conversations/turn-capability-composer.service';
import { staticToolsForAgentConfig, TOOL_SUBPERMISSION_RULES } from '../conversations/agent-tool-registry';
import { PAYMENT_CREATE_TOOLS, PAYMENT_STATUS_TOOLS } from '../conversations/tools/payment-tools';
import { TenantsService } from '../tenants/tenants.service';
import { AgentDraftService } from '../persona/agent-draft.service';
import { AgentConfigurationRevisionStore } from '../persona/agent-configuration-revision';
import { ensureDraftProposalSchema } from './agent-configuration-proposal-schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as any)[key])).join(',') + '}';
    return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function readPath(value: any, path: string): unknown { return path.split('.').reduce((node, key) => node?.[key], value) ?? null; }
function applyChanges(config: any, changes: AgentConfigurationChange[]): any {
    if ((config.editorMode ?? config._mode) === 'prompt' && changes.some(change => change.path.startsWith('persona.') || change.path === 'behavior.rules')) {
        throw new BadRequestException({ error: 'configuration_prompt_mode' });
    }
    const result = JSON.parse(JSON.stringify(config));
    for (const change of changes) {
        if (change.path.startsWith('account.')) continue;
        const segments = change.path.split('.');
        let node = result;
        for (const key of segments.slice(0, -1)) node = node[key] ??= {};
        node[segments[segments.length - 1]] = change.value;
    }
    return result;
}
function boundedStrings(value: unknown, required: boolean): value is string[] {
    return Array.isArray(value) && value.length <= 20 && (!required || value.length > 0)
        && value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 1500);
}

/** Proposals never execute an effect. Applying locks the exact proposal and agent together. */
@Injectable()
export class AgentConfigurationService {
    constructor(private readonly prisma: PrismaService, private readonly persona: PersonaService,
        private readonly assessment: AgentAssessmentService, private readonly events: EventEmitter2,
        private readonly capabilities: TurnCapabilityComposerService = null as any,
        private readonly tenants: TenantsService = null as any,
        private readonly drafts: AgentDraftService = null as any) {}

    private authorize(actor: { id: string; role: string }, agentId?: string): void {
        if (!['tenant_admin', 'super_admin'].includes(actor.role)) throw new ForbiddenException('Agent configuration requires an administrator');
        if (!UUID.test(actor.id) || (agentId && !UUID.test(agentId))) throw new BadRequestException('Invalid configuration scope');
    }
    private async schema(tenantId: string): Promise<string> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new NotFoundException('Tenant not found');
        await ensureDraftProposalSchema(this.prisma, schema);
        return schema;
    }
    private validate(changes: unknown, profile: { industry: string; subType: string | null }): AgentConfigurationChange[] {
        if (!Array.isArray(changes) || changes.length < 1 || changes.length > 10) throw new BadRequestException('Invalid configuration changes');
        if (changes.some(change => change?.path === 'account.businessHours') && changes.length !== 1)
            throw new BadRequestException({ error: 'configuration_account_separate_review' });
        const seen = new Set();
        for (const change of changes) {
            if (!change || typeof change !== 'object' || Object.keys(change).some(key => !['path', 'value'].includes(key))
                || !AGENT_CONFIGURATION_PATHS.includes(change.path) || seen.has(change.path)) throw new BadRequestException('Unsupported configuration field');
            seen.add(change.path);
            if (change.path.startsWith('tools.')) {
                if (typeof change.value !== 'boolean') throw new BadRequestException('Tool permissions must be booleans');
            } else if (change.path === 'account.businessHours') {
                if (!isAgentAccountBusinessHours(change.value)) throw new BadRequestException('Business hours require a valid timezone, seven day schedules and an after-hours response');
            } else if (change.path === 'mission') {
                const mission = change.value;
                if (!isAgentMissionV1(mission)) {
                    throw new BadRequestException('Mission requires an objective, valid intents, success criteria and handoff conditions');
                }
                const allowed = buildDomainContractDraft(profile.industry, profile.subType).intents.map(intent => intent.key);
                if (mission.intentKeys.some((key: string) => !allowed.includes(key))) throw new BadRequestException('Mission exceeds the business profile');
            } else if (change.path.startsWith('behavior.')) {
                if (!boundedStrings(change.value, change.path !== 'behavior.forbiddenTopics')) throw new BadRequestException('Invalid behavior rules');
            } else if (typeof change.value !== 'string' || !change.value.trim() || change.value.length > (change.path === 'persona.name' ? 100 : 2000)) {
                throw new BadRequestException('Invalid persona value');
            }
        }
        return changes;
    }

    private async validateCapabilities(tenantId: string, schemaName: string, agent: any, config: any,
        changes: AgentConfigurationChange[], profile: { industry: string; subType: string | null }): Promise<void> {
        const enabled = changes.filter(change => change.path.startsWith('tools.') && change.value === true);
        if (!enabled.length) return;
        if (!this.capabilities) throw new BadRequestException({ error: 'configuration_capability_unavailable' });
        if (enabled.some(change => change.path.startsWith('tools.appointments.'))) {
            try { await this.persona.assertAppointmentsPrerequisites(tenantId, schemaName); }
            catch { throw new BadRequestException({ error: 'configuration_capability_blocked', reasons: ['readiness_unmet'] }); }
        }
        const channels = [...new Set<string>([...(agent.channels ?? []), ...(agent.channel_bindings ?? []).map((binding: string) => binding.split(':')[0])])];
        for (const channelType of channels.length ? channels : [undefined]) {
            const result = await this.capabilities.resolve({ tenantId, schemaName, agentId: agent.id, config, ...profile, role: 'tenant_agent', channelType }).catch(() => null);
            const contract = result?.contract;
            if (!contract || contract.degraded) throw new BadRequestException({ error: 'configuration_capability_unavailable' });
            for (const change of enabled) {
                const [, family, flag] = change.path.split('.');
                if (config.tools?.[family]?.enabled !== true) throw new BadRequestException({ error: 'configuration_capability_blocked', reasons: ['agent_disabled'] });
                const names = family === 'payments'
                    ? (flag === 'canCreateLinks' ? PAYMENT_CREATE_TOOLS : [...PAYMENT_STATUS_TOOLS, ...(config.tools.payments.canCreateLinks === false ? [] : PAYMENT_CREATE_TOOLS)]).map(tool => tool.name)
                    : flag === 'enabled' ? staticToolsForAgentConfig({ [family]: config.tools[family] }).map(tool => tool.name)
                    : [...(TOOL_SUBPERMISSION_RULES.find(rule => rule.family === family && rule.flag === flag)?.tools ?? [])];
                if (!names.length || names.some(name => !contract.publishedTools.includes(name))) {
                    const reasons = contract.excluded.filter(item => item.subject === family || names.some(name => item.subject.split(', ').includes(name))).map(item => item.reason);
                    throw new BadRequestException({ error: 'configuration_capability_blocked', reasons: [...new Set(reasons)] });
                }
            }
        }
    }
    /** Only reviewed command paths enter Assist context; never return credentials or arbitrary tool configuration. */
    async getEditableContext(tenantId: string, agentId: string, actor: { id: string; role: string }) {
        const workspace = await this.drafts.read(tenantId, agentId, actor);
        const body = workspace.draft?.body ?? workspace.operational.body;
        return { scope: workspace.draft ? 'draft' : 'operational', operationalVersion: workspace.operational.version,
            draftRevision: workspace.draft?.id ?? null, currentBase: workspace.draft?.currentBase ?? true,
            values: Object.fromEntries(AGENT_CONFIGURATION_PATHS.filter(path => !path.startsWith('account.')).map(path => [path, readPath(body.configJson, path)])) };
    }
    async propose(tenantId: string, agentId: string, changes: unknown, actor: { id: string; role: string }, requestKey: string = randomUUID()): Promise<AgentConfigurationProposal> {
        this.authorize(actor, agentId);
        if (typeof agentId !== 'string' || !UUID.test(agentId)) throw new BadRequestException('Invalid agent scope');
        if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestKey)) throw new BadRequestException('Invalid idempotency key');
        const schema = await this.schema(tenantId);
        const existing = await this.prisma.executeInTenantSchema<any[]>(schema, 'SELECT * FROM agent_config_proposals WHERE requested_by = $1::uuid AND request_key = $2', [actor.id, requestKey]);
        if (existing[0]) {
            const requested = existing[0].changes.map(({ path, value }: AgentConfigurationChange) => ({ path, value }));
            if (existing[0].agent_id !== agentId || hash(requested) !== hash(changes)) throw new ConflictException('Idempotency key belongs to a different proposal');
            return this.publicProposal(existing[0]);
        }
        const [workspace, tenant] = await Promise.all([
            this.drafts.read(tenantId, agentId, actor),
            this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true, settings: true } }),
        ]);
        const settings = tenant?.settings as any;
        const profile = { industry: settings?.verticalConfig?.industry ?? tenant?.industry ?? 'otro', subType: settings?.verticalConfig?.subType ?? settings?.subType ?? null };
        const valid = this.validate(changes, profile);
        const targetScope = valid[0].path === 'account.businessHours' ? 'account' : 'agent_draft';
        if (targetScope === 'agent_draft' && workspace.draft && !workspace.draft.currentBase)
            throw new ConflictException({ error: 'agent_operational_configuration_changed' });
        const body = targetScope === 'agent_draft' ? workspace.draft?.body ?? workspace.operational.body : workspace.operational.body;
        const agent = { id: agentId, channels: body.channels, channel_bindings: body.channelBindings, config_json: body.configJson };
        const next = applyChanges(body.configJson, valid);
        this.persona.assertAgentConfigValid(next, { partial: true });
        await this.validateCapabilities(tenantId, schema, agent, next, valid, profile);
        const diff = valid.map(change => ({ ...change, before: change.path === 'account.businessHours' ? settings?.businessHours ?? null : readPath(body.configJson, change.path) }));
        if (diff.every(change => canonical(change.before) === canonical(change.value))) throw new BadRequestException('Configuration already has these values');
        const agentName = body.name;
        const expectedDraftRevision = targetScope === 'agent_draft' ? workspace.draft?.id ?? null : null;
        const beforeHash = hash(body);
        const digest = this.proposalDigest({ agent_id: agentId, agent_name: agentName, expected_version: workspace.operational.version,
            target_scope: targetScope, expected_draft_revision: expectedDraftRevision, base_operational_hash: workspace.operational.hash,
            before_hash: beforeHash, changes: diff });
        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `INSERT INTO agent_config_proposals (agent_id, requested_by, request_key, expected_version, before_hash, digest, changes, expires_at, agent_name,
                target_scope,expected_draft_revision,base_operational_hash)
             VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::jsonb,NOW()+interval '30 minutes',$8,$9,$10::uuid,$11)
             ON CONFLICT (requested_by, request_key) DO NOTHING RETURNING *`,
            [agentId, actor.id, requestKey, workspace.operational.version, beforeHash, digest, JSON.stringify(diff), agentName,
                targetScope, expectedDraftRevision, workspace.operational.hash]);
        if (result[0]) return this.publicProposal(result[0]);
        const prior = await this.prisma.executeInTenantSchema<any[]>(schema, 'SELECT * FROM agent_config_proposals WHERE requested_by = $1::uuid AND request_key = $2', [actor.id, requestKey]);
        if (!prior[0] || prior[0].digest !== digest) throw new ConflictException('Idempotency key belongs to a different proposal');
        return this.publicProposal(prior[0]);
    }
    async apply(tenantId: string, proposalId: string, digest: string, actor: { id: string; role: string }): Promise<AppliedAgentConfiguration> {
        this.authorize(actor);
        if (!UUID.test(proposalId) || !/^[a-f0-9]{64}$/.test(digest)) throw new BadRequestException('An exact reviewed proposal is required');
        const schema = await this.schema(tenantId);
        await new AgentConfigurationRevisionStore(this.prisma).ensure(schema);
        const result = await this.prisma.transactionInTenantSchema(schema, async query => {
            const proposals = await query<any[]>('SELECT * FROM agent_config_proposals WHERE id = $1::uuid FOR UPDATE', [proposalId]);
            const proposal = proposals[0];
            if (!proposal) throw new NotFoundException('Proposal not found');
            if (proposal.digest !== digest) throw new ConflictException('Proposal content changed');
            if (!['agent_draft', 'account'].includes(proposal.target_scope)) throw new ConflictException({ error: 'configuration_legacy_proposal_expired' });
            if (this.proposalDigest(proposal) !== digest) throw new ConflictException('Proposal integrity mismatch');
            if (proposal.status === 'applied') {
                const draft = proposal.target_scope === 'agent_draft'
                    ? await this.drafts.readSavedWithQuery(query, tenantId, proposal.agent_id, proposal.applied_draft_revision, true) : undefined;
                return { proposal, draft, replay: true };
            }
            if (proposal.status !== 'proposed' || new Date(proposal.expires_at).getTime() <= Date.now()) throw new ConflictException('Proposal expired; request a new review');
            const tenants = await query<any[]>('SELECT industry, settings FROM public.tenants WHERE id = $1::uuid FOR UPDATE', [tenantId]);
            const workspace = await this.drafts.readWithQuery(query, tenantId, proposal.agent_id);
            const isDraft = proposal.target_scope === 'agent_draft';
            const body = isDraft ? workspace.draft?.body ?? workspace.operational.body : workspace.operational.body;
            if (workspace.operational.version !== proposal.expected_version || workspace.operational.hash !== proposal.base_operational_hash
                || hash(body) !== proposal.before_hash || (isDraft && (workspace.draft?.id ?? null) !== proposal.expected_draft_revision)
                || (isDraft && workspace.draft && !workspace.draft.currentBase))
                throw new ConflictException({ error: 'configuration_proposal_source_changed' });
            const agent = { id: proposal.agent_id, config_json: body.configJson, channels: body.channels, channel_bindings: body.channelBindings };
            const settings = tenants[0]?.settings ?? {};
            const profile = { industry: settings.verticalConfig?.industry ?? tenants[0]?.industry ?? 'otro', subType: settings.verticalConfig?.subType ?? settings.subType ?? null };
            this.validate(proposal.changes.map(({ path, value }: AgentConfigurationChange) => ({ path, value })), profile);
            const next = applyChanges(agent.config_json, proposal.changes);
            this.persona.assertAgentConfigValid(next, { partial: true });
            await this.validateCapabilities(tenantId, schema, agent, next, proposal.changes, profile);
            const hours = proposal.changes.find((change: AgentConfigurationChange) => change.path === 'account.businessHours');
            let draft: AppliedAgentConfiguration['draft'];
            let appliedVersion: number = workspace.operational.version;
            if (hours && !isDraft) {
                if (hash(settings.businessHours ?? null) !== hash(hours.before)) throw new ConflictException('Business hours changed; review a new proposal');
                await query(`UPDATE public.tenants SET settings=jsonb_set(COALESCE(settings,'{}'::jsonb),'{businessHours}',$2::jsonb,true), updated_at=NOW() WHERE id=$1::uuid RETURNING id`, [tenantId, JSON.stringify(hours.value)]);
                // Tenant hours affect every agent and invalidate their older behavioral evidence.
                const updated = await query<any[]>('UPDATE agent_personas SET version=COALESCE(version,0)+1, updated_at=NOW() RETURNING id,version');
                appliedVersion = Number(updated.find(row => row.id === agent.id)?.version);
                if (!Number.isInteger(appliedVersion)) throw new ConflictException({ error: 'configuration_proposal_source_changed' });
            } else if (isDraft && !hours) {
                draft = await this.drafts.saveWithQuery(query, schema, tenantId, agent.id, {
                    expectedOperationalVersion: proposal.expected_version, expectedDraftRevision: proposal.expected_draft_revision,
                    requestKey: `assist_${proposal.id}`, body: { ...body, configJson: next, name: next.persona.name },
                }, actor);
            } else {
                throw new ConflictException({ error: 'configuration_proposal_scope_invalid' });
            }
            const applied = await query<any[]>(`UPDATE agent_config_proposals SET status='applied', applied_at=NOW(), applied_by=$2::uuid, applied_version=$3,applied_draft_revision=$4::uuid
                WHERE id=$1::uuid RETURNING *`, [proposal.id, actor.id, appliedVersion, draft?.savedRevision.id ?? null]);
            return { proposal: applied[0], draft, replay: false };
        });
        // Repeatable finalization repairs a cache failure after a committed update.
        let verified = true;
        try {
            if (result.proposal.target_scope === 'account') {
                await this.persona.invalidatePersonaResolutionCaches(tenantId);
                await this.tenants.finalizeConfigurationUpdate(tenantId, { businessHours: true });
                if (!result.replay) this.events.emit('agent.version.updated', { tenantId, agentId: result.proposal.agent_id, changed: 'assist_account_hours', proposalId });
            }
        } catch { verified = false; }
        const assessment = await this.assessment.getAssessment(tenantId, result.proposal.agent_id).catch(() => null);
        return { proposal: this.publicProposal(result.proposal), assessment, assessmentScope: 'operational', draft: result.draft,
            verification: verified && (result.draft || assessment) ? 'verified' : 'unavailable' };
    }
    private proposalDigest(row: any): string {
        return hash({ agentId: row.agent_id, agentName: row.agent_name, expectedVersion: row.expected_version, targetScope: row.target_scope,
            expectedDraftRevision: row.expected_draft_revision ?? null, baseOperationalHash: row.base_operational_hash,
            beforeHash: row.before_hash, changes: row.changes });
    }
    private publicProposal(row: any): AgentConfigurationProposal {
        return { id: row.id, agentId: row.agent_id, agentName: row.agent_name, expectedVersion: row.expected_version, digest: row.digest,
            targetScope: row.target_scope === 'account' ? 'account' : 'agent_draft', expectedDraftRevision: row.expected_draft_revision ?? null,
            status: !['agent_draft', 'account'].includes(row.target_scope) || (row.status === 'proposed' && new Date(row.expires_at).getTime() <= Date.now()) ? 'expired' : row.status,
            expiresAt: new Date(row.expires_at).toISOString(), changes: row.changes, ...(row.applied_version ? { appliedVersion: row.applied_version } : {}),
            ...(row.applied_draft_revision ? { appliedDraftRevision: row.applied_draft_revision } : {}) };
    }
}
