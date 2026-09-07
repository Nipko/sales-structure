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
        private readonly tenants: TenantsService = null as any) {}

    private authorize(actor: { id: string; role: string }, agentId?: string): void {
        if (!['tenant_admin', 'super_admin'].includes(actor.role)) throw new ForbiddenException('Agent configuration requires an administrator');
        if (!UUID.test(actor.id) || (agentId && !UUID.test(agentId))) throw new BadRequestException('Invalid configuration scope');
    }
    private async schema(tenantId: string): Promise<string> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new NotFoundException('Tenant not found');
        await this.prisma.ensureCanonicalTables(schema, ['agent_config_proposals']);
        return schema;
    }
    private validate(changes: unknown, profile: { industry: string; subType: string | null }): AgentConfigurationChange[] {
        if (!Array.isArray(changes) || changes.length < 1 || changes.length > 10) throw new BadRequestException('Invalid configuration changes');
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
        const [rows, tenant] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema, 'SELECT id, name, version, config_json, channels, channel_bindings FROM agent_personas WHERE id = $1::uuid', [agentId]),
            this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true, settings: true } }),
        ]);
        const agent = rows[0];
        if (!agent) throw new NotFoundException('Agent not found');
        const settings = tenant?.settings as any;
        const profile = { industry: settings?.verticalConfig?.industry ?? tenant?.industry ?? 'otro', subType: settings?.verticalConfig?.subType ?? settings?.subType ?? null };
        const valid = this.validate(changes, profile);
        const next = applyChanges(agent.config_json, valid);
        this.persona.assertAgentConfigValid(next, { partial: true });
        await this.validateCapabilities(tenantId, schema, agent, next, valid, profile);
        const diff = valid.map(change => ({ ...change, before: change.path === 'account.businessHours' ? settings?.businessHours ?? null : readPath(agent.config_json, change.path) }));
        if (diff.every(change => canonical(change.before) === canonical(change.value))) throw new BadRequestException('Configuration already has these values');
        const agentName = String(agent.name ?? agent.config_json?.persona?.name ?? '').slice(0, 200);
        const digest = hash({ agentId, agentName, expectedVersion: agent.version, changes: diff });
        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `INSERT INTO agent_config_proposals (agent_id, requested_by, request_key, expected_version, before_hash, digest, changes, expires_at, agent_name)
             VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::jsonb,NOW()+interval '30 minutes',$8)
             ON CONFLICT (requested_by, request_key) DO NOTHING RETURNING *`,
            [agentId, actor.id, requestKey, agent.version, hash(agent.config_json), digest, JSON.stringify(diff), agentName]);
        if (result[0]) return this.publicProposal(result[0]);
        const prior = await this.prisma.executeInTenantSchema<any[]>(schema, 'SELECT * FROM agent_config_proposals WHERE requested_by = $1::uuid AND request_key = $2', [actor.id, requestKey]);
        if (!prior[0] || prior[0].digest !== digest) throw new ConflictException('Idempotency key belongs to a different proposal');
        return this.publicProposal(prior[0]);
    }
    async apply(tenantId: string, proposalId: string, digest: string, actor: { id: string; role: string }): Promise<AppliedAgentConfiguration> {
        this.authorize(actor);
        if (!UUID.test(proposalId) || !/^[a-f0-9]{64}$/.test(digest)) throw new BadRequestException('An exact reviewed proposal is required');
        const schema = await this.schema(tenantId);
        const result = await this.prisma.transactionInTenantSchema(schema, async query => {
            const proposals = await query<any[]>('SELECT * FROM agent_config_proposals WHERE id = $1::uuid FOR UPDATE', [proposalId]);
            const proposal = proposals[0];
            if (!proposal) throw new NotFoundException('Proposal not found');
            if (proposal.digest !== digest) throw new ConflictException('Proposal content changed');
            if (hash({ agentId: proposal.agent_id, agentName: proposal.agent_name, expectedVersion: proposal.expected_version, changes: proposal.changes }) !== digest) throw new ConflictException('Proposal integrity mismatch');
            if (proposal.status === 'applied') return proposal;
            if (proposal.status !== 'proposed' || new Date(proposal.expires_at).getTime() <= Date.now()) throw new ConflictException('Proposal expired; request a new review');
            const tenants = await query<any[]>('SELECT industry, settings FROM public.tenants WHERE id = $1::uuid FOR UPDATE', [tenantId]);
            const agents = await query<any[]>('SELECT id, version, config_json, channels, channel_bindings FROM agent_personas WHERE id = $1::uuid FOR UPDATE', [proposal.agent_id]);
            const agent = agents[0];
            if (!agent || agent.version !== proposal.expected_version || hash(agent.config_json) !== proposal.before_hash) throw new ConflictException('Agent changed; review a new proposal');
            const settings = tenants[0]?.settings ?? {};
            const profile = { industry: settings.verticalConfig?.industry ?? tenants[0]?.industry ?? 'otro', subType: settings.verticalConfig?.subType ?? settings.subType ?? null };
            this.validate(proposal.changes.map(({ path, value }: AgentConfigurationChange) => ({ path, value })), profile);
            const next = applyChanges(agent.config_json, proposal.changes);
            this.persona.assertAgentConfigValid(next, { partial: true });
            await this.validateCapabilities(tenantId, schema, agent, next, proposal.changes, profile);
            const hours = proposal.changes.find((change: AgentConfigurationChange) => change.path === 'account.businessHours');
            if (hours) {
                if (hash(settings.businessHours ?? null) !== hash(hours.before)) throw new ConflictException('Business hours changed; review a new proposal');
                await query(`UPDATE public.tenants SET settings=jsonb_set(COALESCE(settings,'{}'::jsonb),'{businessHours}',$2::jsonb,true), updated_at=NOW() WHERE id=$1::uuid RETURNING id`, [tenantId, JSON.stringify(hours.value)]);
                // Tenant hours affect every agent and invalidate their older behavioral evidence.
                await query('UPDATE agent_personas SET version=COALESCE(version,0)+1, updated_at=NOW() WHERE id<>$1::uuid RETURNING id', [agent.id]);
            }
            const updated = await query<any[]>(`UPDATE agent_personas SET config_json=$2::jsonb, name=$3, version=COALESCE(version,0)+1, updated_at=NOW()
                WHERE id=$1::uuid AND version=$4 RETURNING version`, [agent.id, JSON.stringify(next), next.persona.name, proposal.expected_version]);
            if (!updated[0]) throw new ConflictException('Agent changed; review a new proposal');
            const applied = await query<any[]>(`UPDATE agent_config_proposals SET status='applied', applied_at=NOW(), applied_by=$2::uuid, applied_version=$3
                WHERE id=$1::uuid RETURNING *`, [proposal.id, actor.id, updated[0].version]);
            return applied[0];
        });
        // Repeatable finalization repairs a cache failure after a committed update.
        let verified = true;
        try {
            await this.persona.invalidatePersonaResolutionCaches(tenantId);
            if (result.changes.some((change: AgentConfigurationChange) => change.path === 'account.businessHours')) {
                await this.tenants.finalizeConfigurationUpdate(tenantId, { businessHours: true });
            }
            this.events.emit('agent.version.updated', { tenantId, agentId: result.agent_id, changed: 'assist_configuration', proposalId });
        } catch { verified = false; }
        const assessment = await this.assessment.getAssessment(tenantId, result.agent_id).catch(() => null);
        return { proposal: this.publicProposal(result), assessment, verification: verified && assessment ? 'verified' : 'unavailable' };
    }
    private publicProposal(row: any): AgentConfigurationProposal {
        return { id: row.id, agentId: row.agent_id, agentName: row.agent_name, expectedVersion: row.expected_version, digest: row.digest,
            status: row.status === 'proposed' && new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : row.status,
            expiresAt: new Date(row.expires_at).toISOString(), changes: row.changes, ...(row.applied_version ? { appliedVersion: row.applied_version } : {}) };
    }
}
