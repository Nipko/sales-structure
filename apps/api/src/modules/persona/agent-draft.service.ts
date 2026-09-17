import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { buildDomainContractDraft, resolveSubtypeExperienceProfile, TOOL_GROUP_PLAN_FEATURE, VERTICAL_TOOL_GROUPS } from '@parallext/shared';
import type { AgentConfigurationWorkspace, AgentDraftRevision, SaveAgentDraftRequest, SavedAgentDraft, DiscardAgentDraftRequest } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PersonaService } from './persona.service';
import { normalizeAgentConfigLists } from './agent-config-normalize';
import { AgentConfigurationRevisionStore, operationalConfigurationBody, operationalConfigurationHash, validateConfigurationBody,
    type AgentConfigurationBody, type ConfigurationRevisionActor, type RevisionQuery } from './agent-configuration-revision';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** What a direct commit changed, so the caller can settle it after COMMIT. */
export interface CommittedRevision {
    revisionId: string;
    version: number;
    hash: string;
    priorBindings: string[];
    activated: boolean;
}

export type SavedAgentDraftResult = SavedAgentDraft & { committed?: CommittedRevision };

/**
 * How this tenant applies agent changes. `immediate` is the default and the
 * owner's decision (D1/D15, sep-2026): "cambiar es tocar y guardar" — a save
 * reaches the serving agent at once, with the revision kept for history.
 * `reviewed` is the opt-in mode where a save is a draft that goes live through
 * evaluation, review and publication.
 */
export function directCommitMode(settings: unknown): boolean {
    return (settings as any)?.agentReviewMode !== 'reviewed';
}

/** Administration-only boundary. Runtime keeps reading agent_personas. */
@Injectable()
export class AgentDraftService {
    private readonly logger = new Logger(AgentDraftService.name);

    constructor(private readonly prisma: PrismaService, private readonly persona: PersonaService,
        private readonly throttle: TenantThrottleService,
        // Optional and last: the positional specs keep compiling, and a missing
        // emitter degrades to no notification, never to a failed save.
        private readonly events: EventEmitter2 = null as any) {}

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
        const tenants = await query<any[]>(`SELECT t.id, to_jsonb(t)->'settings' AS settings FROM public.tenants t
            WHERE t.id=$1::uuid AND t.schema_name=current_schema() FOR SHARE`, [tenantId]);
        if (!tenants[0]) throw new NotFoundException({ error: 'tenant_not_found' });
        const operational = (await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR SHARE', [agentId]))[0];
        if (!operational) throw new NotFoundException({ error: 'agent_not_found' });
        const hash = operationalConfigurationHash(operational);
        const row = await new AgentConfigurationRevisionStore(this.prisma).readWithQuery(query, agentId);
        const draft = row ? this.revision(row, hash) : null;
        return { agentId, operational: { version: Number(operational.version), hash, body: operationalConfigurationBody(operational) },
            draft, evaluationRevisionId: draft?.currentBase ? draft.id : null, directCommit: directCommitMode(tenants[0].settings) };
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
        // Empty list rows are dropped BEFORE the request is hashed, so the
        // idempotent replay of the same edit hashes the same.
        input.body.configJson = normalizeAgentConfigLists(input.body.configJson);
    }

    private async validateCandidate(tenantId: string, schema: string, operational: any, tenant: any, input: SaveAgentDraftRequest,
        directCommit: boolean): Promise<void> {
        const body = input.body;
        // Deactivation is an immediate safety action. With reviewed changes,
        // reactivation belongs to publication; with immediate changes the switch
        // simply switches on, because the revision it applies IS the serving one.
        if (body.isActive !== operational.is_active && !directCommit) throw new BadRequestException({ error: 'agent_activation_managed_separately' });
        await this.assertConfigurationEntitlement(tenantId, schema, operational, tenant, body);
        // What goes live may not be incomplete: drafts may be partial while
        // Assist guides the owner, the serving configuration may not.
        if (directCommit) this.persona.assertAgentConfigValid(body.configJson);
    }

    /**
     * Apply the saved revision to the serving agent, inside the same
     * transaction and under the same locks. The revision row stays as history
     * (with its base version and hashes), the draft pointer goes away because
     * there is nothing left to publish, and the version bump is what tells every
     * open editor and every cache that the agent changed.
     */
    private async commitWithQuery(query: RevisionQuery, agentId: string, operational: any, body: AgentConfigurationBody,
        revisionId: string): Promise<CommittedRevision> {
        const scheduleMode = body.scheduleMode === '24/7' ? '24_7' : body.scheduleMode;
        // A commit never demotes the default agent: that is a separate, explicit action.
        const isDefault = body.isDefault || operational.is_default === true;
        if (isDefault && operational.is_default !== true)
            await query('UPDATE agent_personas SET is_default=false, updated_at=NOW() WHERE is_default=true AND id<>$1::uuid', [agentId]);
        const rows = await query<any[]>(`UPDATE agent_personas SET name=$2, config_json=$3::jsonb, channels=$4::text[], channel_bindings=$5::text[],
            schedule_mode=$6, is_active=$7, is_default=$8, version=version+1, updated_at=NOW()
            WHERE id=$1::uuid AND version=$9 RETURNING *`,
            [agentId, body.name, JSON.stringify(body.configJson), body.channels, body.channelBindings, scheduleMode, body.isActive, isDefault, Number(operational.version)]);
        if (!rows[0]) throw new ConflictException({ error: 'agent_operational_version_changed' });
        await query('DELETE FROM agent_configuration_drafts WHERE agent_id=$1::uuid', [agentId]);
        return { revisionId, version: Number(rows[0].version), hash: operationalConfigurationHash(rows[0]),
            priorBindings: Array.isArray(operational.channel_bindings) ? operational.channel_bindings : [],
            activated: body.isActive === true && operational.is_active !== true };
    }

    /**
     * After the COMMIT, never inside it: the runtime cache must forget the
     * previous revision, the audit row records who changed what, and the
     * listeners that re-evaluate an agent after a behaviour change get told.
     * None of these may roll back a commit that already happened.
     */
    async settleCommit(tenantId: string, agentId: string, actor: ConfigurationRevisionActor, committed: CommittedRevision): Promise<void> {
        try {
            await this.persona.invalidatePersonaResolutionCaches(tenantId);
        } catch (error: any) {
            this.logger.error(`[DirectCommit] cache invalidation deferred for agent ${agentId}: ${error?.message}`);
        }
        try {
            await this.prisma.auditLog.create({ data: {
                tenantId, action: 'agent.configuration.committed', resource: `agent:${agentId}`, userId: actor.id,
                details: { revisionId: committed.revisionId, operationalVersion: committed.version, operationalHash: committed.hash,
                    activated: committed.activated, mode: 'immediate' },
            } });
        } catch (error: any) {
            this.logger.error(`[DirectCommit] audit write failed for ${committed.revisionId}: ${error?.message}`);
        }
        if (!this.events) return;
        try {
            this.events.emit('agent.version.updated', { tenantId, agentId, changed: committed.activated ? 'agent_activated' : 'agent_configuration_committed' });
            this.events.emit('agent.config.updated', { tenantId, agentId, changed: 'agent_configuration_committed',
                revisionId: committed.revisionId, operationalVersion: committed.version, operationalHash: committed.hash });
        } catch (error: any) {
            this.logger.error(`[DirectCommit] notification failed for ${committed.revisionId}: ${error?.message}`);
        }
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
        actor: ConfigurationRevisionActor): Promise<SavedAgentDraftResult> {
        this.authorize(tenantId, agentId, actor, true);
        this.assertRequest(input);
        // Lock before dynamic checks: a replay needs no new entitlement and never moves the pointer.
        const tenants = await query<any[]>(`SELECT t.id,to_jsonb(t)->>'industry' AS industry,to_jsonb(t)->'settings' AS settings
            FROM public.tenants t WHERE t.id=$1::uuid AND t.schema_name=current_schema() FOR UPDATE`, [tenantId]);
        if (!tenants[0]) throw new NotFoundException({ error: 'tenant_not_found' });
        const operational = (await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR UPDATE', [agentId]))[0];
        if (!operational) throw new NotFoundException({ error: 'agent_not_found' });
        const replay = await query<any[]>('SELECT revision_id FROM agent_configuration_commands WHERE requested_by=$1::uuid AND request_key=$2', [actor.id, input.requestKey]);
        const directCommit = directCommitMode(tenants[0].settings);
        if (!replay[0]) {
            // CAS is checked again by the store; checking first avoids treating a stale editor as invalid business configuration.
            if (Number(operational.version) !== input.expectedOperationalVersion)
                throw new ConflictException({ error: 'agent_operational_version_changed' });
            await this.validateCandidate(tenantId, schema, operational, tenants[0], input, directCommit);
        }
        const row = await new AgentConfigurationRevisionStore(this.prisma).saveWithQuery(query, { tenantId, agentId, actor, ...input });
        // A replay already committed (or never will): committing twice would bump the version for nothing.
        const committed = row.idempotentReplay === true || !directCommit ? undefined
            : await this.commitWithQuery(query, agentId, operational, input.body, row.id);
        const workspace = await this.readWithQuery(query, tenantId, agentId);
        // The revision's `currentBase` is judged against the hash it was saved
        // on; after a commit the operational hash moved past it by design.
        return { savedRevision: this.revision(row, committed ? row.base_operational_hash : workspace.operational.hash),
            idempotentReplay: row.idempotentReplay === true, workspace, ...(committed ? { committed } : {}) };
    }

    async save(tenantId: string, agentId: string, input: SaveAgentDraftRequest, actor: ConfigurationRevisionActor): Promise<SavedAgentDraft> {
        this.authorize(tenantId, agentId, actor, true);
        this.assertRequest(input);
        const schema = await this.schema(tenantId);
        await new AgentConfigurationRevisionStore(this.prisma).ensure(schema);
        const saved = await this.prisma.transactionInTenantSchema(schema, query => this.saveWithQuery(query, schema, tenantId, agentId, input, actor));
        if (saved.committed) await this.settleCommit(tenantId, agentId, actor, saved.committed);
        const { committed: _committed, ...result } = saved;
        return result;
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
