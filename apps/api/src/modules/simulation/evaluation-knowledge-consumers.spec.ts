import { EvalService } from './eval.service';
import { SimulationService } from './simulation.service';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';

const snapshot: any = { tenantId: 'tenant', agentId: 'agent', version: 1, configHash: 'config', config: {language:'fr'},
    manifest: {revision:'source-revision'}, knowledgeInputs: {usage:{token:'snapshot-owner'}} };
const scenario: any = { key:'example',title:'Example',source:'synthetic',language:'fr',goal:'support',openingMessage:'Bonjour',messages:['Bonjour'] };
const judge = { overall:8,resolved:true,flags:[] };

function authorityFixture() {
    let live = true, depth = 0;
    const actualProvider = jest.fn(async () => ({content:JSON.stringify(judge),usage:{inputTokens:1,outputTokens:1}}));
    const authority = jest.fn(async (invoke:any) => {
        if (!live) throw new LLMSourceAuthorityUnavailable();
        depth++;
        try { return await invoke(); } finally { depth--; }
    });
    const tests = {
        captureSnapshot:jest.fn(async()=>snapshot), assertSnapshotExecutable:jest.fn(async()=>{
            if(!live)throw new Error('evaluation_knowledge_usage_lost');
        }),
        snapshotSourceAuthority:jest.fn(()=>authority), releaseSnapshot:jest.fn(async()=>{expect(depth).toBe(0);}),
        test:jest.fn(async()=>({reply:'Bonjour',debug:{toolCalls:[]}})),
    };
    const quality = { judgeTranscript:jest.fn(async(_t:any,_s:any,_c:any,withAuthority:any)=>{
        const response=await withAuthority(actualProvider); return JSON.parse(response.content);
    }) };
    return { tests, quality, actualProvider, authority, revoke:()=>live=false, depth:()=>depth };
}

function evalFixture() {
    const f=authorityFixture();
    const prisma={getTenantSchemaName:jest.fn(async()=>'tenant_source')};
    const redis={acquireLockToken:jest.fn(async()=>'lease'),renewLockToken:jest.fn(async()=>true),releaseLockToken:jest.fn(async()=>undefined)};
    const service=new EvalService(prisma as any,f.tests as any,f.quality as any,redis as any,{emit:jest.fn()} as any);
    jest.spyOn(service as any,'ensureTable').mockResolvedValue(undefined);
    jest.spyOn(service,'listScenarios').mockResolvedValue([scenario]);
    jest.spyOn(service as any,'persistRun').mockResolvedValue(undefined);
    const session={assertLease:jest.fn(),reset:jest.fn(),recordInbound:jest.fn(async()=>'inbound'),
        sandboxConversationId:'conversation',sandboxNamespace:{schemaName:'tenant_eval_synthetic'},fixtures:{status:'ready'}};
    jest.spyOn(service as any,'withOwnedSandboxSession').mockImplementation(async(...args:any[])=>args[3](session));
    return {...f,service,session};
}

describe('Eval snapshot source authority and ownership',()=>{
    it.each([false,true])('releases its own snapshot after callbacks unwind when the provider fails=%s',async fail=>{
        const f=evalFixture();
        if(fail)f.actualProvider.mockRejectedValue(new Error('provider failed'));
        const run=f.service.runGateV2('tenant','agent');
        if(fail)await expect(run).rejects.toThrow('provider failed');else await expect(run).resolves.toMatchObject({status:'completed'});
        expect(f.tests.snapshotSourceAuthority).toHaveBeenCalledWith(snapshot);
        expect(f.authority).toHaveBeenCalledTimes(1);expect(f.actualProvider).toHaveBeenCalledTimes(1);
        expect(f.tests.releaseSnapshot).toHaveBeenCalledTimes(1);expect(f.tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
        expect(f.depth()).toBe(0);
    });
    it.each([false,true])('never releases an external producer snapshot when the provider fails=%s',async fail=>{
        const f=evalFixture();if(fail)f.actualProvider.mockRejectedValue(new Error('provider failed'));
        const run=f.service.runGateV2('tenant','agent',{agentSnapshot:snapshot,scenarios:[scenario]});
        if(fail)await expect(run).rejects.toThrow();else await run;
        expect(f.tests.captureSnapshot).not.toHaveBeenCalled();expect(f.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('rejects expired execution before reusing a previously scored checkpoint',async()=>{
        const f=evalFixture();const previous=await f.service.runGateV2('tenant','agent',{agentSnapshot:snapshot});
        f.tests.test.mockClear();f.actualProvider.mockClear();f.revoke();
        await expect(f.service.runGateV2('tenant','agent',{agentSnapshot:snapshot,previousResults:previous.scenarios})).rejects.toThrow('usage_lost');
        expect(f.tests.test).not.toHaveBeenCalled();expect(f.actualProvider).not.toHaveBeenCalled();
        expect(f.tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('checks live source authority at the judge boundary even after an earlier executable check passed',async()=>{
        const f=evalFixture();
        f.quality.judgeTranscript.mockImplementation(async(_t,_s,_c,withAuthority)=>{
            f.revoke();return withAuthority(f.actualProvider);
        });
        await expect(f.service.runGateV2('tenant','agent')).rejects.toThrow('llm_source_authority_unavailable');
        expect(f.actualProvider).not.toHaveBeenCalled();expect(f.tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
    });
});

function simulationFixture() {
    const f=authorityFixture();
    let depth=0,commitError=false,writeError=false;
    const query=jest.fn(async(sql:string)=>{
        if(sql.includes('INSERT INTO simulation_runs')){
            if(writeError)throw new Error('write_failed');return [{id:'run'}];
        }
        return [];
    });
    const prisma={getTenantSchemaName:jest.fn(async()=>'tenant_source'),
        transactionInTenantSchema:jest.fn(async(_s:any,work:any)=>{
            depth++;try {const result=await work(query);if(commitError)throw new Error('commit_ACK_lost');return result;}finally{depth--;}
        }),
        executeInTenantSchema:jest.fn(async(_s:any,_sql:string):Promise<any[]>=>[])};
    const queue={add:jest.fn(async()=>({id:'job'}))};
    const llm={execute:jest.fn(async(request:any)=>request.withSourceAuthority(f.actualProvider))};
    const service=new SimulationService(prisma as any,{} as any,llm as any,{getAgent:async()=>({id:'agent'})} as any,
        f.quality as any,f.tests as any,queue as any,{emit:jest.fn()} as any);
    jest.spyOn(service,'ensureTables').mockResolvedValue(undefined);
    jest.spyOn(service as any,'resolveAgentId').mockResolvedValue('agent');
    f.tests.releaseSnapshot.mockImplementation(async()=>{expect(depth).toBe(0);expect(f.depth()).toBe(0);});
    return {...f,service,prisma,queue,llm,failCommit:()=>commitError=true,failWrite:()=>writeError=true};
}

// Source retirement SQL itself is exercised by simulation-replay.postgres.spec.
jest.mock('./simulation-replay-authority',()=>({
    ...jest.requireActual('./simulation-replay-authority'),assertSimulationReplayRun:async()=>undefined,
}));

describe('Simulation snapshot producers and provider boundaries',()=>{
    const input:any={agentId:'agent',channelType:'web_widget',scenarioSource:'synthetic'};
    it('releases a prevalidation failure before persistence is attempted',async()=>{
        const f=simulationFixture();f.revoke();
        await expect(f.service.startRun('tenant',input)).rejects.toThrow('evaluation_knowledge_usage_lost');
        expect(f.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(f.tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
        expect(f.queue.add).not.toHaveBeenCalled();
    });
    it.each(['write_rejected','commit_ACK_empty_read','commit_ACK_visible_read','commit_ACK_unavailable_read'])(
        'retains bounded ownership after persistence was attempted: %s',async failure=>{
        const f=simulationFixture();
        if(failure==='write_rejected')f.failWrite();else f.failCommit();
        if(failure==='commit_ACK_visible_read')f.prisma.executeInTenantSchema.mockResolvedValue([{id:'run'}]);
        if(failure==='commit_ACK_unavailable_read')f.prisma.executeInTenantSchema.mockRejectedValue(new Error('recovery_unavailable'));
        await expect(f.service.startRun('tenant',input)).rejects.toThrow(failure==='write_rejected'?'write_failed':'commit_ACK_lost');
        expect(f.tests.releaseSnapshot).not.toHaveBeenCalled();
        expect(f.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(f.queue.add).not.toHaveBeenCalled();
    });
    it('preserves a durable run after an enqueue error without overwriting running/completed status',async()=>{
        const f=simulationFixture();f.queue.add.mockRejectedValue(new Error('enqueue_ACK_lost'));
        await expect(f.service.startRun('tenant',input)).rejects.toThrow('enqueue_ACK_lost');
        expect(f.tests.releaseSnapshot).not.toHaveBeenCalled();
        expect(f.prisma.executeInTenantSchema.mock.calls.some((call:any[])=>String(call[1]).includes("status='pending'"))).toBe(true);
    });
    it('requires snapshot source authority for both synthetic generation and next-customer requests',async()=>{
        const f=simulationFixture();
        f.actualProvider.mockResolvedValueOnce({content:JSON.stringify([scenario]),usage:{inputTokens:1,outputTokens:1}})
            .mockResolvedValueOnce({content:'[FIN]',usage:{inputTokens:1,outputTokens:1}});
        await (f.service as any).generateSyntheticScenarios('tenant','retail',1,f.authority);
        expect(await (f.service as any).nextCustomerMessage('tenant',scenario,[],f.authority)).toBe('[FIN]');
        expect(f.actualProvider).toHaveBeenCalledTimes(2);
        f.revoke();
        await expect((f.service as any).nextCustomerMessage('tenant',scenario,[],f.authority)).rejects.toThrow('source_authority_unavailable');
        expect(f.actualProvider).toHaveBeenCalledTimes(2);
        await expect((f.service as any).nextCustomerMessage('tenant',scenario,[])).rejects.toThrow('source_authority_required');
    });
    it('passes the same snapshot authority to the synthetic conversation judge',async()=>{
        const f=simulationFixture();f.actualProvider.mockResolvedValueOnce({content:'[FIN]',usage:{inputTokens:1,outputTokens:1}})
            .mockResolvedValueOnce({content:JSON.stringify(judge),usage:{inputTokens:1,outputTokens:1}});
        const result=await (f.service as any).runScenario('tenant','agent','web_widget',scenario,snapshot);
        expect(result.judge.overall).toBe(8);expect(f.authority).toHaveBeenCalledTimes(2);
        expect(f.tests.snapshotSourceAuthority.mock.calls.every((call:any[])=>call[0]===snapshot)).toBe(true);
        expect(f.tests.releaseSnapshot).not.toHaveBeenCalled(); // the durable run owns it
    });
});
