import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { createRuntimeLearningFootprint } from '../learning/learning-runtime-footprint';
import { readWidgetAgentHistoryFootprints } from './widget-agent-history-footprints';

const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const tenantId=id(1),conversationId=id(2),agentA=id(3),agentB=id(4),schema='tenant_history_refs';
const scope=(agentId=agentA)=>({kind:'agent',tenantId,schemaName:schema,agentId,version:1,operationalHash:'a'.repeat(64)});
const group=(agentId:string,n:number)=>createRuntimeLearningFootprint(tenantId,agentId,[{id:id(n),releaseId:id(n+10),releaseHash:'b'.repeat(64),
    situation:'support',responsePattern:'Private style',rationale:'Private rationale',factsRequired:[],authority:'style_only'}]);
const stored=(messageId:string,agentId=agentA,n=10)=>({message_id:messageId,conversation_id:conversationId,status:'stored',
    operational_scope:scope(agentId),learning_footprint:[group(agentId,n)]});

describe('widget history learning provenance',()=>{
    it('preserves all historical agents but marks a missing receipt as untracked, never empty learning',async()=>{
        const rows=[stored(id(40)),stored(id(41),agentB,11)];
        const query=jest.fn(async()=>rows);
        const result=await readWidgetAgentHistoryFootprints(query as any,schema,tenantId,conversationId,[id(40),id(41),id(42)]);
        expect(result.trustedMessageIds).toEqual([id(40),id(41)]);
        expect(result.footprints.map(footprint=>footprint.agentId)).toEqual([agentA,agentB]);
        expect(JSON.stringify(result)).not.toMatch(/Private|responsePattern|rationale/);
        expect(query).toHaveBeenCalledTimes(1);
    });
    it('rejects a redacted receipt even after erasure removed its conversation and contact links',async()=>{
        const query=jest.fn(async()=>[{message_id:id(40),conversation_id:null,status:'redacted',operational_scope:{},learning_footprint:null}]);
        await expect(readWidgetAgentHistoryFootprints(query as any,schema,tenantId,conversationId,[id(40)]))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(query.mock.calls[0]).toEqual([expect.stringContaining('WHERE message_id=ANY($1::uuid[])'),[[id(40)]]]);
    });
    it.each(['conversation','tenant','unavailable_provenance','unknown_status'])('rejects a stored receipt with invalid %s',async fault=>{
        const row:any=stored(id(40));
        if(fault==='conversation')row.conversation_id=id(90);
        if(fault==='tenant')row.operational_scope.tenantId=id(90);
        if(fault==='unavailable_provenance')row.learning_footprint=null;
        if(fault==='unknown_status')row.status='pending';
        await expect(readWidgetAgentHistoryFootprints((async()=>[row]) as any,schema,tenantId,conversationId,[id(40)]))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });
    it('does not read any source when the caller selected no outbound messages',async()=>{
        const query=jest.fn();
        expect(await readWidgetAgentHistoryFootprints(query as any,schema,tenantId,conversationId,[])).toEqual({footprints:[],trustedMessageIds:[]});
        expect(query).not.toHaveBeenCalled();
    });
    it('rejects malformed message identifiers before querying',async()=>{
        const query=jest.fn();
        await expect(readWidgetAgentHistoryFootprints(query as any,schema,tenantId,conversationId,['malformed']))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(query).not.toHaveBeenCalled();
    });
    it('rejects conflicting projections across historical replies rather than silently choosing one',async()=>{
        const first=stored(id(40)),second:any=structuredClone(first);second.message_id=id(41);
        second.learning_footprint[0].entries[0].projectionHash='c'.repeat(64);
        await expect(readWidgetAgentHistoryFootprints((async()=>[first,second]) as any,schema,tenantId,conversationId,[id(40),id(41)]))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });
});
