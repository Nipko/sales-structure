import { ConflictException } from '@nestjs/common';
import type { TenantConfig } from '@parallext/shared';
import type { RevisionQuery } from './agent-configuration-revision';

export interface ServingPersona {config:TenantConfig|null;agentId:string|null;version:number|null}
/** Resolve routing, version and instructions from one database snapshot. A stale
 * Redis entry must never resurrect an inactive agent or pair old instructions
 * with a newly published version. An explicit legacy row remains compatible only
 * while the tenant has never acquired a durable agent. */
export async function readServingPersona(query:RevisionQuery,channelType:string,accountId?:string):Promise<ServingPersona>{
    const binding=accountId?`${channelType}:${accountId}`:null;
    const rows=await query<any[]>(`WITH ranked AS (
        SELECT id,config_json,version,CASE
            WHEN $1::text IS NOT NULL AND $1=ANY(channel_bindings) THEN 1
            WHEN $2=ANY(channels) THEN 2 ELSE 3 END AS priority
        FROM agent_personas WHERE is_active=true AND
            (($1::text IS NOT NULL AND $1=ANY(channel_bindings)) OR $2=ANY(channels) OR is_default=true)
    ) SELECT (SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT * FROM ranked
        WHERE priority=(SELECT MIN(priority) FROM ranked) ORDER BY id LIMIT 2) m) AS matches,
        EXISTS(SELECT 1 FROM agent_personas) AS has_agents,
        (SELECT config_json FROM persona_config WHERE is_active=true ORDER BY version DESC LIMIT 1) AS legacy_config`,[binding,channelType]);
    if(!rows[0])throw new Error('persona_resolution_unavailable');
    const matches=rows[0].matches||[];
    if(matches.length>1)throw new ConflictException({error:'agent_connection_assignment_conflict'});
    if(matches[0]){
        const selected=matches[0],version=Number(selected.version);
        if(!selected.id||!selected.config_json||!Number.isInteger(version)||version<1)throw new Error('persona_revision_unavailable');
        return {config:selected.config_json,agentId:String(selected.id),version};
    }
    return {config:rows[0].has_agents?null:rows[0].legacy_config||null,agentId:null,version:null};
}
