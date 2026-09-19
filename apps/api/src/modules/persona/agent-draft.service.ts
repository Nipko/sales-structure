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
import { revisionHash } from '../evaluation-revision/evaluation-revision';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** What a direct commit changed, so the caller can settle it after COMMIT. */
export interface CommittedRevision {
    revisionId: string;
    version: number;
    hash: string;
    priorBindings: string[];
    activated: boolean;
    /** Other agents that lost a connection to this one in the same transaction. */
    reassignedFrom: string[];
    /** The connections that moved (`whatsapp`, or `whatsapp:<accountId>`). */
    reassignedConnections: string[];
}

/** A connection another active agent serves, named in `agent_connection_owned_by_other_agent`. */
export interface ConnectionOwner {
    connection: string;
    agentId: string;
    agentName: string | null;
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
            || Object.keys(input).some(key => !['expectedOperationalVersion', 'expectedDraftRevision', 'requestKey', 'body', 'reassignConnections'].includes(key))
            || !Number.isInteger(input.expectedOperationalVersion) || input.expectedOperationalVersion < 0
            || (input.expectedDraftRevision !== null && !UUID.test(input.expectedDraftRevision))
            || typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey))
            throw new BadRequestException({ error: 'agent_configuration_revision_request_invalid' });
        validateConfigurationBody(input.body);
        // A move can only be promised for a connection this agent is taking.
        const reassign = input.reassignConnections;
        if (reassign !== undefined && (!Array.isArray(reassign) || reassign.length > 120 || new Set(reassign).size !== reassign.length
            || reassign.some(connection => typeof connection !== 'string'
                || !(input.body.channels.includes(connection) || input.body.channelBindings.includes(connection)))))
            throw new BadRequestException({ error: 'agent_configuration_revision_request_invalid' });
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
     * One agent per connection, kept by the commit itself.
     *
     * The runtime refuses a turn when two active agents claim the same
     * connection at the same priority (`readServingPersona` throws
     * `agent_connection_assignment_conflict`), so a commit that leaves agent A
     * and agent B both serving WhatsApp does not "share" it: it silences it.
     * Publication already refuses every overlap (`AgentPublicationStore.routing`);
     * an immediate commit is the other way an assignment goes live, and it
     * owes the same invariant.
     *
     * `reassign` is what the owner was told would move to this agent (the
     * editor's "Se reasignará de …" line). Exactly those connections are taken
     * from every other agent that holds them, in this transaction, with a
     * version bump so their open editors know. Any other connection an active
     * agent serves refuses the commit with `agent_connection_owned_by_other_agent`
     * and the owners named: nothing promised that move — a stale draft being
     * applied, an Assist suggestion, an agent switched back on after another one
     * took its channel. An inactive agent's claim is dormant and stays (it
     * serves nothing, and switching it on runs this same check).
     *
     * Same priority only, like the runtime: a type-level channel and one
     * account's binding coexist (the binding wins its account).
     */
    private async claimConnectionsWithQuery(query: RevisionQuery, agentId: string, body: AgentConfigurationBody,
        reassign: readonly string[]): Promise<{ reassignedFrom: string[]; reassignedConnections: string[] }> {
        // An agent that is off serves nothing: its assignments stay as written.
        if (!body.isActive || (body.channels.length === 0 && body.channelBindings.length === 0))
            return { reassignedFrom: [], reassignedConnections: [] };
        const holders = await query<any[]>(`SELECT id, name, is_active, COALESCE(channels,'{}'::text[]) AS channels,
                COALESCE(channel_bindings,'{}'::text[]) AS channel_bindings
            FROM agent_personas
            WHERE id<>$1::uuid AND (COALESCE(channels,'{}'::text[]) && $2::text[] OR COALESCE(channel_bindings,'{}'::text[]) && $3::text[])
            ORDER BY id FOR UPDATE`, [agentId, body.channels, body.channelBindings]);
        const promised = new Set(reassign);
        const refused: ConnectionOwner[] = [];
        const moves: Array<{ id: string; channels: string[]; bindings: string[] }> = [];
        for (const holder of holders) {
            const channels = (holder.channels as string[]).filter(channel => body.channels.includes(channel));
            const bindings = (holder.channel_bindings as string[]).filter(binding => body.channelBindings.includes(binding));
            for (const connection of [...channels, ...bindings])
                if (!promised.has(connection) && holder.is_active === true)
                    refused.push({ connection, agentId: String(holder.id), agentName: typeof holder.name === 'string' ? holder.name : null });
            const move = { id: String(holder.id), channels: channels.filter(c => promised.has(c)), bindings: bindings.filter(b => promised.has(b)) };
            if (move.channels.length > 0 || move.bindings.length > 0) moves.push(move);
        }
        if (refused.length > 0) throw new ConflictException({
            error: 'agent_connection_owned_by_other_agent',
            message: 'Another active agent serves this connection. Move it explicitly or remove it from one of the agents.',
            connections: refused,
        });
        for (const move of moves)
            await query(`UPDATE agent_personas
                SET channels = ARRAY(SELECT kept.c FROM unnest(COALESCE(channels,'{}'::text[])) WITH ORDINALITY AS kept(c, n)
                        WHERE NOT (kept.c = ANY($2::text[])) ORDER BY kept.n),
                    channel_bindings = ARRAY(SELECT kept.b FROM unnest(COALESCE(channel_bindings,'{}'::text[])) WITH ORDINALITY AS kept(b, n)
                        WHERE NOT (kept.b = ANY($3::text[])) ORDER BY kept.n),
                    version = COALESCE(version,0)+1, updated_at = NOW()
              WHERE id=$1::uuid`, [move.id, move.channels, move.bindings]);
        return { reassignedFrom: moves.map(move => move.id),
            reassignedConnections: [...new Set(moves.flatMap(move => [...move.channels, ...move.bindings]))] };
    }

    /**
     * Apply a revision to the serving agent, inside the caller's transaction
     * and under its locks: the connections it takes (see
     * `claimConnectionsWithQuery`), then the agent row itself. The revision row
     * stays as history (with its base version and hashes), and the version bump
     * is what tells every open editor and every cache that the agent changed.
     * The draft pointer is the caller's: a save clears it, the switch leaves it.
     */
    private async commitWithQuery(query: RevisionQuery, agentId: string, operational: any, body: AgentConfigurationBody,
        revisionId: string, reassign: readonly string[]): Promise<CommittedRevision> {
        const scheduleMode = body.scheduleMode === '24/7' ? '24_7' : body.scheduleMode;
        // A commit never demotes the default agent: that is a separate, explicit action.
        const isDefault = body.isDefault || operational.is_default === true;
        if (isDefault && operational.is_default !== true)
            await query('UPDATE agent_personas SET is_default=false, updated_at=NOW() WHERE is_default=true AND id<>$1::uuid', [agentId]);
        const claimed = await this.claimConnectionsWithQuery(query, agentId, body, reassign);
        const rows = await query<any[]>(`UPDATE agent_personas SET name=$2, config_json=$3::jsonb, channels=$4::text[], channel_bindings=$5::text[],
            schedule_mode=$6, is_active=$7, is_default=$8, version=version+1, updated_at=NOW()
            WHERE id=$1::uuid AND version=$9 RETURNING *`,
            [agentId, body.name, JSON.stringify(body.configJson), body.channels, body.channelBindings, scheduleMode, body.isActive, isDefault, Number(operational.version)]);
        if (!rows[0]) throw new ConflictException({ error: 'agent_operational_version_changed' });
        return { revisionId, version: Number(rows[0].version), hash: operationalConfigurationHash(rows[0]),
            priorBindings: Array.isArray(operational.channel_bindings) ? operational.channel_bindings : [],
            activated: body.isActive === true && operational.is_active !== true, ...claimed };
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
                    activated: committed.activated, mode: 'immediate',
                    ...(committed.reassignedConnections.length > 0
                        ? { reassignedConnections: committed.reassignedConnections, reassignedFrom: committed.reassignedFrom } : {}) },
            } });
        } catch (error: any) {
            this.logger.error(`[DirectCommit] audit write failed for ${committed.revisionId}: ${error?.message}`);
        }
        if (!this.events) return;
        try {
            this.events.emit('agent.version.updated', { tenantId, agentId, changed: committed.activated ? 'agent_activated' : 'agent_configuration_committed' });
            this.events.emit('agent.config.updated', { tenantId, agentId, changed: 'agent_configuration_committed',
                revisionId: committed.revisionId, operationalVersion: committed.version, operationalHash: committed.hash });
            // The agents that gave a connection away changed version too.
            for (const other of committed.reassignedFrom)
                this.events.emit('agent.version.updated', { tenantId, agentId: other, changed: 'agent_connection_reassigned' });
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
        // The move consent authorises the commit; the revision is the content.
        const { reassignConnections, ...revisionRequest } = input;
        const row = await new AgentConfigurationRevisionStore(this.prisma).saveWithQuery(query, { tenantId, agentId, actor, ...revisionRequest });
        // A replay already committed (or never will): committing twice would bump the version for nothing.
        const committed = row.idempotentReplay === true || !directCommit ? undefined
            : await this.commitWithQuery(query, agentId, operational, input.body, row.id, reassignConnections ?? []);
        // Nothing is left to apply once the revision is live.
        if (committed) await query('DELETE FROM agent_configuration_drafts WHERE agent_id=$1::uuid', [agentId]);
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

    /**
     * The editor's switch turning an agent ON, in immediate mode.
     *
     * Switching on puts a configuration in front of customers, so it goes
     * through the same commit as a save: tenant and agent locks, the version
     * CAS, the entitlement and completeness checks of a live configuration, the
     * connection ownership guard, a revision kept as history, then — after
     * COMMIT — the cache drop, the audit row and the notifications
     * (`settleCommit`). Switching OFF stays `PersonaService.updateAgent`: an
     * immediate safety action in both modes that never takes anything from
     * another agent.
     *
     * Reviewed mode keeps its rule: the revision that starts serving must be
     * the reviewed one, so activation belongs to publication.
     *
     * The body is the live agent with `isActive: true` — what she sees switched
     * on, nothing else. A stored draft is left as it is: the switch neither
     * applies nor discards changes she has not chosen (the base hash covers the
     * activation, so a pending draft reads as stale afterwards, exactly as after
     * switching off).
     */
    async activate(tenantId: string, agentId: string, expectedVersion: number, actor: ConfigurationRevisionActor): Promise<any> {
        this.authorize(tenantId, agentId, actor, true);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
            throw new BadRequestException({ error: 'agent_version_required', message: 'Reload the agent before saving.' });
        const schema = await this.schema(tenantId);
        await new AgentConfigurationRevisionStore(this.prisma).ensure(schema);
        const result = await this.prisma.transactionInTenantSchema(schema, async query => {
            const tenants = await query<any[]>(`SELECT t.id,to_jsonb(t)->>'industry' AS industry,to_jsonb(t)->'settings' AS settings
                FROM public.tenants t WHERE t.id=$1::uuid AND t.schema_name=current_schema() FOR UPDATE`, [tenantId]);
            if (!tenants[0]) throw new NotFoundException({ error: 'tenant_not_found' });
            if (!directCommitMode(tenants[0].settings)) throw new BadRequestException({ error: 'agent_draft_contract_required' });
            const operational = (await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR UPDATE', [agentId]))[0];
            if (!operational) throw new NotFoundException({ error: 'agent_not_found' });
            if (Number(operational.version) !== expectedVersion)
                throw new ConflictException({ error: 'agent_version_conflict', message: 'Agent changed; reload before saving.' });
            if (operational.is_active === true) return { agent: operational, committed: undefined };
            const body: AgentConfigurationBody = { ...operationalConfigurationBody(operational), isActive: true };
            validateConfigurationBody(body);
            await this.assertConfigurationEntitlement(tenantId, schema, operational, tenants[0], body);
            this.persona.assertAgentConfigValid(body.configJson);
            const revision = (await query<any[]>(`INSERT INTO agent_configuration_revisions
                (agent_id,base_operational_version,base_operational_hash,body,body_hash,created_by)
                VALUES($1::uuid,$2,$3,$4::jsonb,$5,$6::uuid) RETURNING id`,
                [agentId, Number(operational.version), operationalConfigurationHash(operational), JSON.stringify(body), revisionHash(body), actor.id]))[0];
            if (!revision?.id) throw new Error('agent_configuration_revision_write_failed');
            const committed = await this.commitWithQuery(query, agentId, operational, body, revision.id, []);
            const agent = (await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]))[0];
            return { agent, committed };
        });
        if (result.committed) await this.settleCommit(tenantId, agentId, actor, result.committed);
        return result.agent;
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
