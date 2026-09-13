import { withAgentSourceFence } from '../../common/utils/agent-source-fence';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { learningSnapshotHash, type RuntimeLearningExample } from '../learning/learning-contracts';
import { createRuntimeLearningFootprint } from '../learning/learning-runtime-footprint';
import type { ServedAgentAuthority } from '../persona/served-agent-authority';
import { createAgentReplyProvenanceCollector, createAgentReplySourceAuthority } from './agent-reply-provenance';

const id = (n: number) => `${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const tenantId=id(1),agentA=id(2),agentB=id(3),schema='tenant_reply_provenance';
const scope:ServedAgentAuthority={kind:'agent',tenantId,schemaName:schema,agentId:agentB,version:2,operationalHash:'b'.repeat(64)};
const example=(n=4):RuntimeLearningExample=>({id:id(n),releaseId:id(n+10),releaseHash:'a'.repeat(64),
    situation:'support',responsePattern:'Private style text.',rationale:'Private reasoning.',factsRequired:['verified status'],authority:'style_only'});

describe('private reply provenance collector',()=>{
    it('keeps historical agents separate and unions every iteration without retaining example text',()=>{
        const collector=createAgentReplyProvenanceCollector(scope),historical=example(),current=example(5);
        collector.addInherited([createRuntimeLearningFootprint(tenantId,agentA,[historical])]);
        collector.addExamples([current]);
        collector.addExamples([example(6)]);
        collector.addExamples([]); // A later no-learning rewrite cannot erase prior use.
        const groups=collector.getFootprints();
        expect(groups.map(group=>[group.agentId,group.entries.length])).toEqual([[agentA,1],[agentB,2]]);
        expect(JSON.stringify(groups)).not.toMatch(/Private|verified status|responsePattern|rationale/);
    });
    it('represents an explicit empty current agent and defaults legacy to no groups',()=>{
        expect(createAgentReplyProvenanceCollector(scope).getFootprints()).toEqual([
            createRuntimeLearningFootprint(tenantId,agentB,[]),
        ]);
        const legacy=createAgentReplyProvenanceCollector({kind:'legacy',tenantId,schemaName:schema,legacyConfigHash:'c'.repeat(64)});
        expect(legacy.getFootprints()).toEqual([]);
        expect(()=>legacy.addExamples([example()])).toThrow(LLMSourceAuthorityUnavailable);
    });
    it('deduplicates identical inherited references without changing the current empty group',()=>{
        const collector=createAgentReplyProvenanceCollector(scope),group=createRuntimeLearningFootprint(tenantId,agentA,[example()]);
        collector.addInherited([group,structuredClone(group)]);collector.addInherited([group]);
        expect(collector.getFootprints().map(entry=>entry.entries.length)).toEqual([1,0]);
    });
    it.each(['releaseHash','projectionHash'] as const)('rejects conflicting %s atomically',field=>{
        const collector=createAgentReplyProvenanceCollector(scope),group=createRuntimeLearningFootprint(tenantId,agentA,[example()]);
        collector.addInherited([group]);const before=collector.getFootprints();
        const changed=structuredClone(group) as any;changed.entries[0][field]='d'.repeat(64);
        expect(()=>collector.addInherited([createRuntimeLearningFootprint(tenantId,agentB,[example(8)]),changed]))
            .toThrow(LLMSourceAuthorityUnavailable);
        expect(collector.getFootprints()).toEqual(before);
    });
    it('rejects an inherited release reassigned to a different agent',()=>{
        const collector=createAgentReplyProvenanceCollector(scope),group=createRuntimeLearningFootprint(tenantId,agentA,[example()]);
        collector.addInherited([group]);
        expect(()=>collector.addInherited([{...group,agentId:agentB}])).toThrow(LLMSourceAuthorityUnavailable);
    });
    it.each(['foreign_tenant','invalid_agent','invalid_hash','unknown_version','raw_data'])('rejects %s provenance',fault=>{
        const collector=createAgentReplyProvenanceCollector(scope),group:any=structuredClone(createRuntimeLearningFootprint(tenantId,agentA,[example()]));
        if(fault==='foreign_tenant')group.tenantId=id(90);
        if(fault==='invalid_agent')group.agentId='bad';
        if(fault==='invalid_hash')group.entries[0].projectionHash='bad';
        if(fault==='unknown_version')group.version=2;
        if(fault==='raw_data')group.entries[0].text='Do not serialize this';
        expect(()=>collector.addInherited([group])).toThrow(LLMSourceAuthorityUnavailable);
        expect(collector.getFootprints()).toEqual([createRuntimeLearningFootprint(tenantId,agentB,[])]);
    });
    it('returns independent deeply frozen copies and detaches all input references',()=>{
        const inputScope={...scope},input=example(),collector=createAgentReplyProvenanceCollector(inputScope);
        collector.addExamples([input]);const first=collector.getFootprints();
        input.responsePattern='Changed';inputScope.version=99;
        const second=collector.getFootprints();
        expect(second).toEqual(first);expect(second).not.toBe(first);expect(second[0].entries[0]).not.toBe(first[0].entries[0]);
        expect(collector.scope).toMatchObject({kind:'agent',version:2});
        expect([second,second[0],second[0].entries,second[0].entries[0],collector.scope].every(Object.isFrozen)).toBe(true);
    });
});

function authorityFixture(){
    const collector=createAgentReplyProvenanceCollector(scope),projected=example();
    const snapshot={examples:[{id:projected.id,source_id:id(30),kind:'brand_style',intent:projected.situation,
        response_pattern:projected.responsePattern,rationale:projected.rationale,facts_required:projected.factsRequired}],heldout:[]};
    const release={id:projected.releaseId,agent_id:agentA,status:'published',snapshot,snapshot_hash:learningSnapshotHash(snapshot),example_ids:[projected.id]};
    projected.releaseHash=release.snapshot_hash;
    collector.addInherited([createRuntimeLearningFootprint(tenantId,agentA,[projected])]);
    const query=jest.fn(async(sql:string,params:any[]=[]):Promise<any[]>=>{
        if(sql.includes('pg_advisory_xact_lock_shared'))return[];
        if(sql.includes('FROM public.tenants'))return params[0]===tenantId&&params[1]===schema?[{id:tenantId}]:[];
        if(sql.includes('FROM learning_releases'))return params[0]===release.id&&params[1]===agentA?[release]:[];
        if(sql.includes('FROM learning_sources'))return[{id:id(30),agent_id:agentA,source_kind:'file',status:'active'}];
        if(sql.includes('FROM learning_examples'))return[{id:projected.id,agent_id:agentA}];
        throw new Error(`Unexpected source query: ${sql}`);
    });
    const prisma={transactionInTenantSchema:jest.fn(async(_schema:string,work:any)=>work(query))};
    const authority=createAgentReplySourceAuthority(prisma as any,schema,collector);
    return{collector,release,query,prisma,authority};
}

describe('reply source authority at each provider attempt',()=>{
    it('validates inherited groups before and after the provider using the existing private source transaction',async()=>{
        const f=authorityFixture(),provider=jest.fn(async()=>({content:'answer'}));
        await expect(withAgentSourceFence(f.prisma as any,schema,()=>f.authority(provider))).resolves.toEqual({content:'answer'});
        expect(provider).toHaveBeenCalledTimes(1);expect(f.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        const statements=f.query.mock.calls.map(([sql])=>sql);
        expect(statements.filter(sql=>sql.includes('pg_advisory_xact_lock_shared'))).toHaveLength(1);
        expect(statements.filter(sql=>sql.includes('FROM learning_releases'))).toHaveLength(2);
        expect(statements.some(sql=>/FOR SHARE|FOR UPDATE|LOCK TABLE|INSERT|UPDATE /i.test(sql))).toBe(false);
    });
    it('prevents the model when an inherited source was retired before this attempt',async()=>{
        const f=authorityFixture(),provider=jest.fn();f.release.status='retired';
        await expect(f.authority(provider)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(provider).not.toHaveBeenCalled();
    });
    it('discards output after withdrawal and retains provider usage without retaining its text',async()=>{
        const f=authorityFixture(),usage={promptTokens:12,completionTokens:8,totalTokens:20};
        const provider=jest.fn(async()=>{f.release.status='retired';return{content:'Private generated output',usage};});
        const error=await f.authority(provider,response=>response.usage).catch(error=>error);
        expect(error).toBeInstanceOf(LLMSourceAuthorityUnavailable);expect(error.usage).toEqual(usage);
        expect(JSON.stringify(error)).not.toContain('Private generated output');expect(provider).toHaveBeenCalledTimes(1);
        expect(f.collector.getFootprints().find(group=>group.agentId===agentA)?.entries).toHaveLength(1);
    });
    it('preserves the original provider error while still checking sources after a failed attempt',async()=>{
        const f=authorityFixture(),failure=new Error('provider_failed');
        await expect(f.authority(async()=>{throw failure;})).rejects.toBe(failure);
        expect(f.query.mock.calls.filter(([sql])=>sql.includes('FROM learning_releases'))).toHaveLength(2);
    });
    it('rejects a different source schema before creating a provider wrapper',()=>{
        const f=authorityFixture();
        expect(()=>createAgentReplySourceAuthority(f.prisma as any,'tenant_foreign',f.collector)).toThrow(LLMSourceAuthorityUnavailable);
        expect(f.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
    it.each([true,false])('binds legacy replies to the exact tenant even without learning groups (valid=%s)',async valid=>{
        const query=jest.fn(async(sql:string)=>sql.includes('FROM public.tenants')&&valid?[{id:tenantId}]:[]);
        const prisma={transactionInTenantSchema:jest.fn(async(_schema:string,work:any)=>work(query))};
        const collector=createAgentReplyProvenanceCollector({kind:'legacy',tenantId,schemaName:schema,legacyConfigHash:'c'.repeat(64)});
        const authority=createAgentReplySourceAuthority(prisma as any,schema,collector),provider=jest.fn(async()=>({content:'answer'}));
        if(valid){
            await expect(authority(provider)).resolves.toEqual({content:'answer'});
            expect(query.mock.calls.filter(([sql])=>sql.includes('FROM public.tenants'))).toHaveLength(2);
        }else{
            await expect(authority(provider)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
            expect(provider).not.toHaveBeenCalled();
        }
        expect(query.mock.calls.some(([sql])=>/FOR SHARE|FOR UPDATE/.test(sql))).toBe(false);
    });
});
