import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { buildDomainContractDraft, resolveSubtypeExperienceProfile, TOOL_GROUP_PLAN_FEATURE, VERTICAL_TOOL_GROUPS } from '@parallext/shared';
import type { AgentConfigurationWorkspace, AgentDraftRevision, SaveAgentDraftRequest, SavedAgentDraft, DiscardAgentDraftRequest } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PersonaService } from './persona.service';
import { AgentConfigurationRevisionStore, operationalConfigurationBody, operationalConfigurationHash, validateConfigurationBody,
    type AgentConfigurationBody, type ConfigurationRevisionActor, type RevisionQuery } from './agent-configuration-revision';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Administration-only boundary. Runtime keeps reading agent_personas. */
@Injectable()
export class AgentDraftService {
    constructor(private readonly prisma: PrismaService, private readonly persona: PersonaService,
        private readonly throttle: TenantThrottleService) {}

    private authorize(tenantId: string, agentId: string, actor: ConfigurationRevisionActor, write: boolean): void {
        if (!(write ? ['tenant_admin', 'super_admin'] : ['tenant_admin', 'tenant_supervisor', 'super_admin']).includes(actor?.role))
            throw new ForbiddenException({ error: 'agent_configuration_admin_required' });
        if (!UUID.test(tenantId) || !UUID.test(agentId) || !UUID.test(actor.id))
            throw new BadRequestException({ error: 'agent_configuration_scope_invalid' });
    }

    private async schema(tenantId: string): Promise<string> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new NotFoundException({ error: 'tenant_not_found' });
        if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new BadRequestException({ error: 'agent_configuration_scope_invalid' });
        return schema;
    }

    private revision(row: any, operationalHash: string): AgentDraftRevision {
        return { id: row.id, baseOperationalVersion: Number(row.base_operational_version), baseOperationalHash: row.base_operational_hash,
            bodyHash: row.body_hash, body: row.body, createdAt: new Date(row.created_at).toISOString(), currentBase: row.base_operational_hash === operationalHash };
    }

    /** A shared tenant lock precedes the agent lock, matching every configuration writer. */
    async readWithQuery(query: RevisionQuery, tenantId: string, agentId: string): Promise<AgentConfigurationWorkspace> {
        const tenants = await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=current_schema() FOR SHARE', [tenantId]);
        if (!tenants[0]) throw new NotFoundException({ error: 'tenant_not_found' });
        const operational = (await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR SHARE', [agentId]))[0];
        if (!operational) throw new NotFoundException({ error: 'agent_not_found' });
        const hash = operationalConfigurationHash(operational);
        const row = await new AgentConfigurationRevisionStore(this.prisma).readWithQuery(query, agentId);
        const draft = row ? this.revision(row, hash) : null;
        return { agentId, operational: { version: Number(operational.version), hash, body: operationalConfigurationBody(operational) },
            draft, evaluationRevisionId: draft?.currentBase ? draft.id : null };
    }

    async read(tenantId: string, agentId: string, actor: ConfigurationRevisionActor): Promise<AgentConfigurationWorkspace> {
        this.authorize(tenantId, agentId, actor, false);
        const schema = await this.schema(tenantId);
        return this.prisma.transactionInTenantSchema(schema, query => this.readWithQuery(query, tenantId, agentId));
    }

    async readSavedWithQuery(query: RevisionQuery, tenantId: string, agentId: string, revisionId: string, idempotentReplay: boolean): Promise<SavedAgentDraft> {
        const row = (await query<any[]>('SELECT * FROM agent_configuration_revisions WHERE id=$1::uuid AND agent_id=$2::uuid', [revisionId, agentId]))[0];
        new AgentConfigurationRevisionStore(this.prisma).assertRevision(row);
        const workspace = await this.readWithQuery(query, tenantId, agentId);
        return { savedRevision: this.revision(row, workspace.operational.hash), idempotentReplay, workspace };
    }

    private assertRequest(input: SaveAgentDraftRequest): void {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some(key => !['expectedOperationalVersion', 'expectedDraftRevision', 'requestKey', 'body'].includes(key))
            || !Number.isInteger(input.expectedOperationalVersion) || input.expectedOperationalVersion < 0
            || (input.expectedDraftRevision !== null && !UUID.test(input.expectedDraftRevision))
            || typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey))
            throw new BadRequestException({ error: 'agent_configuration_revision_request_invalid' });
        validateConfigurationBody(input.body);
    }

    private async validateCandidate(tenantId: string, schema: string, operational: any, tenant: any, input: SaveAgentDraftRequest): Promise<void> {
        const body = input.body;
        // Deactivation is an immediate safety action. Reactivation belongs to publication.
        if (body.isActive !== operational.is_active) throw new BadRequestException({ error: 'agent_activation_managed_separately' });
        await this.assertConfigurationEntitlement(tenantId, schema, operational, tenant, body);
    }

    /**
     * What this tenant is allowed to run RIGHT NOW: the subtype ceiling, the
     * plan features behind each tool family, the custom prompt, the mission
     * within the profile and the appointment prerequisites.
     *
     * Publication re-runs this immediately before the side effect, on the same
     * transaction. A human approval authorises the candidate, not an entitlement
     * from whenever the draft was written: a plan downgrade, a STOP profile or a
     * disconnected calendar between saving and publishing must stop it.
     */
    async assertConfigurationEntitlement(
        tenantId: string, schema: string, operational: any, tenant: any, body: AgentConfigurationBody,
    ): Promise<void> {
        this.persona.assertAgentConfigValid(body.configJson, { partial: true });
        const settings = tenant.settings || {};
        const industry = settings.verticalConfig?.industry ?? tenant.industry ?? 'otro';
        const subType = settings.verticalConfig?.subType ?? settings.subType ?? null;
        const profile = resolveSubtypeExperienceProfile(industry, subType);
        const manifest = new Set<string>(profile.capability.toolGroups);
        const scoped = new Set<string>(VERTICAL_TOOL_GROUPS);
        for (const [family, config] of Object.entries(body.configJson.tools ?? {}) as Array<[string, any]>) {
            if (config?.enabled !== true) continue;
            // Reuse the runtime subtype ceiling and plan mapping, including horizontal families.
            if (scoped.has(family) && !manifest.has(family))
                throw new BadRequestException({ error: 'configuration_capability_blocked', reasons: ['not_in_subtype'], family });
            const feature = TOOL_GROUP_PLAN_FEATURE[family];
            if (feature && !await this.throttle.isFeatureEnabled(tenantId, feature))
                throw new ForbiddenException({ error: 'configuration_capability_blocked', reasons: ['plan_missing_feature'], family });
        }
        if ((body.configJson.editorMode ?? body.configJson._mode) === 'prompt'
            && !await this.throttle.isFeatureEnabled(tenantId, 'customPrompt'))
            throw new ForbiddenException({ error: 'configuration_custom_prompt_unavailable' });
        if (body.configJson.mission) {
            const allowed = new Set(buildDomainContractDraft(industry, subType).intents.map(intent => intent.key));
            if (body.configJson.mission.intentKeys.some((key: string) => !allowed.has(key)))
                throw new BadRequestException({ error: 'configuration_mission_outside_profile' });
        }
        if (body.configJson.tools?.appointments?.enabled === true && operational.config_json?.tools?.appointments?.enabled !== true)
            await this.persona.assertAppointmentsPrerequisites(tenantId, schema);
    }

    /** Used by Assist so its proposal receipt and this revision share one transaction. */
    async saveWithQuery(query: RevisionQuery, schema: string, tenantId: string, agentId: string, input: SaveAgentDraftRequest,
        actor: ConfigurationRevisionActor): Promise<SavedAgentDraft> {
        this.authorize(tenantId, agentId, actor, true);
        this.assertRequest(input);
        // Lock before dynamic checks: a replay needs no new entitlement and never moves the pointer.
        const tenants = await query<any[]>(`SELECT t.id,to_jsonb(t)->>'industry' AS industry,to_jsonb(t)->'settings' AS settings
            FROM public.tenants t WHERE t.id=$1::uuid AND t.schema_name=current_schema() FOR UPDATE`, [tenantId]);
        if (!tenants[0]) throw new NotFoundException({ error: 'tenant_not_found' });
        const operational = (await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR UPDATE', [agentId]))[0];
        if (!operational) throw new NotFoundException({ error: 'agent_not_found' });
        const replay = await query<any[]>('SELECT revision_id FROM agent_configuration_commands WHERE requested_by=$1::uuid AND request_key=$2', [actor.id, input.requestKey]);
        if (!replay[0]) {
            // CAS is checked again by the store; checking first avoids treating a stale editor as invalid business configuration.
            if (Number(operational.version) !== input.expectedOperationalVersion)
                throw new ConflictException({ error: 'agent_operational_version_changed' });
            await this.validateCandidate(tenantId, schema, operational, tenants[0], input);
        }
        const row = await new AgentConfigurationRevisionStore(this.prisma).saveWithQuery(query, { tenantId, agentId, actor, ...input });
        const workspace = await this.readWithQuery(query, tenantId, agentId);
        return { savedRevision: this.revision(row, workspace.operational.hash), idempotentReplay: row.idempotentReplay === true, workspace };
    }

    async save(tenantId: string, agentId: string, input: SaveAgentDraftRequest, actor: ConfigurationRevisionActor): Promise<SavedAgentDraft> {
        this.authorize(tenantId, agentId, actor, true);
        this.assertRequest(input);
        const schema = await this.schema(tenantId);
        await new AgentConfigurationRevisionStore(this.prisma).ensure(schema);
        return this.prisma.transactionInTenantSchema(schema, query => this.saveWithQuery(query, schema, tenantId, agentId, input, actor));
    }

    async discard(tenantId: string, agentId: string, input: DiscardAgentDraftRequest, actor: ConfigurationRevisionActor): Promise<AgentConfigurationWorkspace> {
        this.authorize(tenantId, agentId, actor, true);
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some(key => !['expectedOperationalVersion', 'expectedOperationalHash', 'expectedDraftRevision', 'requestKey'].includes(key)))
            throw new BadRequestException({ error: 'agent_configuration_revision_request_invalid' });
        const schema = await this.schema(tenantId), store = new AgentConfigurationRevisionStore(this.prisma);
        await store.ensure(schema);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await store.discardWithQuery(query, { ...input, tenantId, agentId, actor });
            return this.readWithQuery(query, tenantId, agentId);
        });
    }
}
