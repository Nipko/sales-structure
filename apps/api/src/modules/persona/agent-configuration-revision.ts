import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CONVERSATIONAL_CHANNELS } from '@parallext/shared';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import type { PrismaService } from '../prisma/prisma.service';
import type { DiscardAgentDraftRequest } from '@parallext/shared';

export type RevisionQuery = <T = any[]>(sql:string,params?:any[])=>Promise<T>;
export interface AgentConfigurationBody {
    name:string; configJson:Record<string,any>; channels:string[]; channelBindings:string[];
    scheduleMode:string; isActive:boolean; isDefault:boolean;
}
export interface ConfigurationRevisionActor {id:string;role:string}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TABLES=['agent_configuration_revisions','agent_configuration_drafts','agent_configuration_commands','agent_configuration_draft_discards'];
const fail=(error:string):never=>{throw new ConflictException({error});};
export function operationalConfigurationBody(agent:any):AgentConfigurationBody {
    return {name:agent.name,configJson:agent.config_json,channels:agent.channels||[],channelBindings:agent.channel_bindings||[],
        scheduleMode:agent.schedule_mode||'24_7',isActive:agent.is_active===true,isDefault:agent.is_default===true};
}
export function operationalConfigurationHash(agent:any):string {
    return revisionHash({agentId:agent.id,version:Number(agent.version),...operationalConfigurationBody(agent)});
}
export function validateConfigurationBody(value:unknown):asserts value is AgentConfigurationBody {
    const body=value as AgentConfigurationBody;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['name','configJson','channels','channelBindings','scheduleMode','isActive','isDefault'].includes(key))
        ||typeof body.name!=='string'||!body.name.trim()||body.name.length>100||typeof body.isActive!=='boolean'||typeof body.isDefault!=='boolean'
        ||typeof body.scheduleMode!=='string'||!['24_7','24/7','business_hours'].includes(body.scheduleMode)
        ||!body.configJson||typeof body.configJson!=='object'||Array.isArray(body.configJson)
        ||!Array.isArray(body.channels)||body.channels.length>20||new Set(body.channels).size!==body.channels.length
        ||body.channels.some(channel=>!(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel))
        ||!Array.isArray(body.channelBindings)||body.channelBindings.length>100||new Set(body.channelBindings).size!==body.channelBindings.length
        ||body.channelBindings.some(binding=>typeof binding!=='string'||binding.length>300||binding.indexOf(':')<1
            ||!(CONVERSATIONAL_CHANNELS as readonly string[]).includes(binding.slice(0,binding.indexOf(':')))||!binding.slice(binding.indexOf(':')+1).trim()))
        throw new BadRequestException({error:'agent_configuration_body_invalid'});
    const serialized=JSON.stringify(body);
    if(serialized.length>250_000||body.configJson.persona?.name!==body.name)
        throw new BadRequestException({error:'agent_configuration_body_invalid'});
}

/** Stores editable configurations separately from agent_personas.
 * It cannot publish, reassign a connection, change a runtime version, or approve a tool.
 * Callers validate business prerequisites before saveWithQuery in their own transaction. */
export class AgentConfigurationRevisionStore {
    constructor(private readonly prisma:PrismaService){}
    async ensure(schema:string):Promise<void> {
        if(!/^tenant_[a-z0-9_]+$/.test(schema))throw new BadRequestException({error:'agent_configuration_scope_invalid'});
        await this.prisma.ensureCanonicalTables(schema,TABLES);
    }
    private authorize(agentId:string,actor:ConfigurationRevisionActor):void {
        if(!['tenant_admin','super_admin'].includes(actor.role))throw new ForbiddenException({error:'agent_configuration_admin_required'});
        if(!UUID.test(agentId)||!UUID.test(actor.id))throw new BadRequestException({error:'agent_configuration_scope_invalid'});
    }
    /** Read-only callers must not create tables. A missing draft is distinct from a failed read. */
    async readWithQuery(query:RevisionQuery,agentId:string):Promise<any|null> {
        if(!UUID.test(agentId))throw new BadRequestException({error:'agent_configuration_scope_invalid'});
        const tables=await query<any[]>(`SELECT to_regclass(format('%I.agent_configuration_drafts',current_schema()))::text AS drafts,
            to_regclass(format('%I.agent_configuration_revisions',current_schema()))::text AS revisions`);
        if(!tables[0]?.drafts&&!tables[0]?.revisions)return null;
        if(!tables[0]?.drafts||!tables[0]?.revisions)return fail('agent_configuration_store_incomplete');
        const rows=await query<any[]>(`SELECT r.* FROM agent_configuration_drafts d
            JOIN agent_configuration_revisions r ON r.id=d.revision_id AND r.agent_id=d.agent_id WHERE d.agent_id=$1::uuid`,[agentId]);
        if(!rows[0])return null;
        this.assertRevision(rows[0]);return rows[0];
    }
    async readCurrentRevisionWithQuery(query:RevisionQuery,agentId:string,revisionId:string):Promise<any> {
        if(!UUID.test(revisionId))throw new BadRequestException({error:'agent_configuration_scope_invalid'});
        const revision=await this.readWithQuery(query,agentId);
        if(!revision||revision.id!==revisionId)fail('agent_draft_revision_changed');
        const operational=(await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid',[agentId]))[0];
        if(!operational||operationalConfigurationHash(operational)!==revision.base_operational_hash)
            fail('agent_operational_configuration_changed');
        return revision;
    }
    assertRevision(row:any):void {
        if(!row||!UUID.test(row.id)||!UUID.test(row.agent_id)||!Number.isInteger(Number(row.base_operational_version))
            ||!/^([a-f0-9]{64})$/.test(row.base_operational_hash)||revisionHash(row.body)!==row.body_hash)
            fail('agent_configuration_revision_invalid');
        validateConfigurationBody(row.body);
    }
    async saveWithQuery(query:RevisionQuery,input:{tenantId:string;agentId:string;actor:ConfigurationRevisionActor;requestKey:string;
        expectedOperationalVersion:number;expectedDraftRevision:string|null;body:AgentConfigurationBody}):Promise<any> {
        this.authorize(input.agentId,input.actor);validateConfigurationBody(input.body);
        if(!UUID.test(input.tenantId)||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey)
            ||!Number.isInteger(input.expectedOperationalVersion)||input.expectedOperationalVersion<0
            ||(input.expectedDraftRevision!==null&&!UUID.test(input.expectedDraftRevision)))
            throw new BadRequestException({error:'agent_configuration_revision_request_invalid'});
        const requestHash=revisionHash({agentId:input.agentId,expectedOperationalVersion:input.expectedOperationalVersion,
            expectedDraftRevision:input.expectedDraftRevision,body:input.body});
        // The tenant lock matches Persona/Assist ordering and serializes assignments.
        const tenants=await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=current_schema() FOR UPDATE',[input.tenantId]);
        if(!tenants[0])throw new NotFoundException({error:'tenant_not_found'});
        const rows=await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR UPDATE',[input.agentId]);
        const operational=rows[0];if(!operational)throw new NotFoundException({error:'agent_not_found'});
        const replay=await query<any[]>(`SELECT c.request_hash,r.* FROM agent_configuration_commands c
            JOIN agent_configuration_revisions r ON r.id=c.revision_id
            WHERE c.requested_by=$1::uuid AND c.request_key=$2`,[input.actor.id,input.requestKey]);
        if(replay[0]) {
            if(replay[0].request_hash!==requestHash||replay[0].agent_id!==input.agentId)fail('agent_configuration_request_conflict');
            this.assertRevision(replay[0]);return {...replay[0],idempotentReplay:true};
        }
        if(Number(operational.version)!==input.expectedOperationalVersion)fail('agent_operational_version_changed');
        const drafts=await query<any[]>(`SELECT d.revision_id,r.base_operational_hash FROM agent_configuration_drafts d
            JOIN agent_configuration_revisions r ON r.id=d.revision_id AND r.agent_id=d.agent_id
            WHERE d.agent_id=$1::uuid FOR UPDATE OF d`,[input.agentId]);
        if((drafts[0]?.revision_id||null)!==input.expectedDraftRevision)fail('agent_draft_revision_changed');
        const baseHash=operationalConfigurationHash(operational);
        if(drafts[0]&&drafts[0].base_operational_hash!==baseHash)fail('agent_operational_configuration_changed');
        const revisions=await query<any[]>(`INSERT INTO agent_configuration_revisions
            (agent_id,base_operational_version,base_operational_hash,body,body_hash,created_by)
            VALUES($1::uuid,$2,$3,$4::jsonb,$5,$6::uuid) RETURNING *`,
            [input.agentId,Number(operational.version),baseHash,JSON.stringify(input.body),revisionHash(input.body),input.actor.id]);
        const revision=revisions[0];if(!revision)throw new Error('agent_configuration_revision_write_failed');
        await query(`INSERT INTO agent_configuration_drafts(agent_id,revision_id) VALUES($1::uuid,$2::uuid)
            ON CONFLICT(agent_id) DO UPDATE SET revision_id=EXCLUDED.revision_id,updated_at=NOW()`,[input.agentId,revision.id]);
        await query(`INSERT INTO agent_configuration_commands(requested_by,request_key,request_hash,revision_id)
            VALUES($1::uuid,$2,$3,$4::uuid)`,[input.actor.id,input.requestKey,requestHash,revision.id]);
        return {...revision,idempotentReplay:false};
    }
    /** Explicitly remove the editable pointer. Immutable revisions and receipts remain available for audit. */
    async discardWithQuery(query: RevisionQuery, input: DiscardAgentDraftRequest & { tenantId: string; agentId: string; actor: ConfigurationRevisionActor }): Promise<void> {
        this.authorize(input.agentId, input.actor);
        if (!UUID.test(input.tenantId) || !UUID.test(input.expectedDraftRevision) || !/^[a-f0-9]{64}$/.test(input.expectedOperationalHash)
            || !Number.isInteger(input.expectedOperationalVersion) || input.expectedOperationalVersion < 0
            || typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey)) throw new BadRequestException({ error: 'agent_configuration_revision_request_invalid' });
        const requestHash = revisionHash({ agentId: input.agentId, expectedDraftRevision: input.expectedDraftRevision,
            expectedOperationalVersion: input.expectedOperationalVersion, expectedOperationalHash: input.expectedOperationalHash });
        const tenants = await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=current_schema() FOR UPDATE', [input.tenantId]);
        if (!tenants[0]) throw new NotFoundException({ error: 'tenant_not_found' });
        const operational = (await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR UPDATE', [input.agentId]))[0];
        if (!operational) throw new NotFoundException({ error: 'agent_not_found' });
        const replay = (await query<any[]>('SELECT request_hash FROM agent_configuration_draft_discards WHERE requested_by=$1::uuid AND request_key=$2', [input.actor.id, input.requestKey]))[0];
        if (replay) { if (replay.request_hash !== requestHash) fail('agent_configuration_request_conflict'); return; }
        if (Number(operational.version) !== input.expectedOperationalVersion || operationalConfigurationHash(operational) !== input.expectedOperationalHash)
            fail('agent_operational_configuration_changed');
        const draft = await this.readWithQuery(query, input.agentId);
        if (!draft || draft.id !== input.expectedDraftRevision) fail('agent_draft_revision_changed');
        const removed = await query<any[]>('DELETE FROM agent_configuration_drafts WHERE agent_id=$1::uuid AND revision_id=$2::uuid RETURNING revision_id', [input.agentId, input.expectedDraftRevision]);
        if (!removed[0]) fail('agent_draft_revision_changed');
        await query(`INSERT INTO agent_configuration_draft_discards(agent_id,revision_id,requested_by,request_key,request_hash,operational_version,operational_hash)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7)`, [input.agentId, input.expectedDraftRevision, input.actor.id, input.requestKey,
            requestHash, input.expectedOperationalVersion, input.expectedOperationalHash]);
    }
}
