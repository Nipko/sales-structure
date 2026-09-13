import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvalAutorunStateService } from './eval-autorun-state.service';
import { EvalGateProcessor } from './eval-gate.processor';
import { withAgentSourceFence } from '../../common/utils/agent-source-fence';

const url=process.env.PARALLLY_ISOLATION_TEST_URL;
(url?describe:describe.skip)('autorun snapshot ownership and terminal retention on real Prisma/PostgreSQL',()=>{
    const schema=`tenant_autorun_${randomUUID().replace(/-/g,'')}`,tenantId=randomUUID(),agentId=randomUUID();
    let client:PrismaClient,prisma:PrismaService,state:EvalAutorunStateService,tests:any,snapshot:any;
    let activeTransactions=0,loseAck:'request'|'completed'|'invalidated'|undefined,rollbackCompletion=false;
    const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,sql,params);
    const newSnapshot=()=>({tenantId,agentId,configHash:'frozen',version:1,knowledgeInputs:{usage:{token:randomUUID()},lease:{sourceSchema:schema}}});
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:url});prisma=Object.create(PrismaService.prototype);
        (prisma as any).$transaction=async(work:any,options:any)=>{
            activeTransactions++;let lost=false;
            try{
                const result=await client.$transaction(async(tx:any)=>work({
                    $executeRawUnsafe:tx.$executeRawUnsafe.bind(tx),
                    $queryRawUnsafe:async(sql:string,...params:any[])=>{
                        const rows=await tx.$queryRawUnsafe(sql,...params);
                        const completion=sql.includes('UPDATE eval_autorun_requests SET status = $3')&&params[2]==='completed';
                        const invalidation=sql.includes("UPDATE eval_autorun_requests SET status='invalidated'");
                        if((loseAck==='request'&&sql.includes('INSERT INTO eval_autorun_requests'))
                            ||(loseAck==='completed'&&completion)||(loseAck==='invalidated'&&invalidation)){
                            lost=true;loseAck=undefined;
                        }
                        if(completion&&rollbackCompletion){rollbackCompletion=false;throw new Error('synthetic_transaction_rollback');}
                        return rows;
                    },
                }),options);
                // The transaction committed; only its acknowledgement is lost.
                if(lost)throw new Error('synthetic_commit_ack_lost');
                return result;
            }finally{activeTransactions--;}
        };
        prisma.getTenantSchemaName=async id=>{if(id!==tenantId)throw new Error('fixture_tenant_mismatch');return schema;};
        Object.defineProperty(prisma,'tenant',{value:{findMany:async()=>[{id:tenantId}]}});
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await q('CREATE TABLE agent_personas(id UUID PRIMARY KEY,config_json JSONB,version INT)');
        tests={captureSnapshot:jest.fn(async()=>structuredClone(snapshot)),assertSnapshotExecutable:jest.fn(),releaseSnapshot:jest.fn()};
        state=new EvalAutorunStateService(prisma,tests);await state.prepare(tenantId);
    },30000);
    beforeEach(async()=>{
        loseAck=undefined;rollbackCompletion=false;snapshot=newSnapshot();
        jest.clearAllMocks();tests.captureSnapshot.mockImplementation(async()=>structuredClone(snapshot));
        tests.assertSnapshotExecutable.mockResolvedValue(undefined);
        tests.releaseSnapshot.mockImplementation(async()=>{
            expect(activeTransactions).toBe(0);
            const [{acquired}]=await q('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]);
            expect(acquired).toBe(true);
        });
        await q('TRUNCATE eval_autorun_requests,eval_autorun_budget,agent_personas');
        await q("INSERT INTO agent_personas VALUES($1::uuid,'{}',1)",[agentId]);
    });
    afterAll(async()=>{
        if(!client)return;
        try{
            if(!/^tenant_autorun_[a-f\d]{32}$/.test(schema))throw new Error('unsafe_cleanup');
            await client.$executeRawUnsafe(`DROP TABLE "${schema}".eval_autorun_requests,"${schema}".eval_autorun_budget,"${schema}".agent_personas RESTRICT`);
            await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" RESTRICT`);
        }finally{await client.$disconnect();}
    });
    it('releases only the completed revision after its row and privacy transaction commit',async()=>{
        const revision=await state.request(tenantId,agentId);
        await state.update(tenantId,agentId,revision,'completed');
        expect((await state.get(tenantId,agentId,revision)).status).toBe('completed');
        expect(tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
        expect(await state.recoverable()).toEqual([]);
    });
    it('invalidates an expired source, removes derived checkpoints and stops recovery',async()=>{
        const revision=await state.request(tenantId,agentId);
        await state.update(tenantId,agentId,revision,'running',undefined,[{key:'synthetic'}],[{key:'synthetic',score:3}]);
        await state.update(tenantId,agentId,revision,'invalidated','evaluation_source_unavailable');
        expect(await state.get(tenantId,agentId,revision)).toMatchObject({status:'invalidated',agent_snapshot:{},scenarios:null,results:[],regression_case_ids:[]});
        expect(tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);expect(await state.recoverable()).toEqual([]);
    });
    it('also releases the exact snapshot when reviewed regression provenance invalidates a checkpoint',async()=>{
        const revision=await state.request(tenantId,agentId);
        await state.update(tenantId,agentId,revision,'running',undefined,[{key:'quality_regression:invalid',regressionCaseId:randomUUID()}]);
        expect(await state.get(tenantId,agentId,revision)).toMatchObject({status:'invalidated',error:'regression_source_unavailable',agent_snapshot:{}});
        expect(tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
    });
    it.each(['failed','budget_deferred'])('retains %s snapshots and checkpoints for their next attempt',async status=>{
        const revision=await state.request(tenantId,agentId),scenarios=[{key:'saved'}],results=[{key:'saved',score:5}];
        await state.update(tenantId,agentId,revision,status,'synthetic_retry',scenarios,results);
        expect(await state.get(tenantId,agentId,revision)).toMatchObject({status,agent_snapshot:snapshot,scenarios,results});
        expect(tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('does not overwrite completed evidence with a late failure or checkpoint',async()=>{
        const revision=await state.request(tenantId,agentId);
        await state.update(tenantId,agentId,revision,'completed',undefined,[{key:'final'}],[{key:'final',score:9}]);
        await Promise.all([state.update(tenantId,agentId,revision,'failed','late'),
            state.update(tenantId,agentId,revision,'running',undefined,[{key:'stale'}],[{key:'stale',score:0}])]);
        expect(await state.get(tenantId,agentId,revision)).toMatchObject({status:'completed',error:null,scenarios:[{key:'final'}],results:[{key:'final',score:9}]});
        expect(tests.releaseSnapshot.mock.calls.every(([copy]:any[])=>copy.knowledgeInputs.usage.token===snapshot.knowledgeInputs.usage.token)).toBe(true);
    });
    it('never releases the new revision through an old superseded worker',async()=>{
        const old=await state.request(tenantId,agentId);snapshot=newSnapshot();const current=await state.request(tenantId,agentId);
        await state.update(tenantId,agentId,old,'completed');
        expect(tests.releaseSnapshot).not.toHaveBeenCalled();
        await state.update(tenantId,agentId,current,'completed');
        expect(tests.releaseSnapshot).toHaveBeenCalledTimes(1);expect(tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
    });
    it('retains the snapshot when completion rolls back',async()=>{
        const revision=await state.request(tenantId,agentId);rollbackCompletion=true;
        await expect(state.update(tenantId,agentId,revision,'completed')).rejects.toThrow('synthetic_transaction_rollback');
        expect((await state.get(tenantId,agentId,revision)).status).toBe('pending');expect(tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('recovers a lost completion COMMIT ACK through the real processor without writing failed',async()=>{
        const revision=await state.request(tenantId,agentId);loseAck='completed';
        const processor=new EvalGateProcessor({listScenarios:async()=>[],runGateV2:async()=>({passed:true})} as any,
            {tenant:{findUnique:async()=>({isInternal:true})}} as any,state);
        expect(await processor.process({data:{tenantId,agentId,revision}} as any)).toMatchObject({ok:true,reason:'completion_ack_recovered'});
        expect((await state.get(tenantId,agentId,revision)).status).toBe('completed');expect(tests.releaseSnapshot).toHaveBeenCalledTimes(1);
    });
    it('retains the fixed TTL when a durable request loses its UPSERT acknowledgement',async()=>{
        loseAck='request';await expect(state.request(tenantId,agentId)).rejects.toThrow('synthetic_commit_ack_lost');
        const [row]=await q('SELECT * FROM eval_autorun_requests');
        expect(row).toMatchObject({status:'pending',agent_snapshot:snapshot});expect(tests.releaseSnapshot).not.toHaveBeenCalled();
    });
    it('retains TTL on an uncertain invalidation while the committed terminal row prevents endless recovery',async()=>{
        const revision=await state.request(tenantId,agentId);loseAck='invalidated';
        await expect(state.update(tenantId,agentId,revision,'invalidated','evaluation_source_unavailable')).rejects.toThrow('synthetic_commit_ack_lost');
        expect((await state.get(tenantId,agentId,revision)).status).toBe('invalidated');
        expect(tests.releaseSnapshot).not.toHaveBeenCalled();expect(await state.recoverable()).toEqual([]);
    });
    it('defers exclusive cleanup inside an outer source fence and safely retries it after that owner exits',async()=>{
        const revision=await state.request(tenantId,agentId);
        await withAgentSourceFence(prisma,schema,async()=>{
            await state.update(tenantId,agentId,revision,'completed');expect(tests.releaseSnapshot).not.toHaveBeenCalled();
        });
        await state.update(tenantId,agentId,revision,'completed');expect(tests.releaseSnapshot).toHaveBeenCalledWith(snapshot);
    });
    it('keeps a committed terminal state even when cleanup must wait for durable expiry',async()=>{
        const revision=await state.request(tenantId,agentId);tests.releaseSnapshot.mockRejectedValueOnce(new Error('cleanup_unavailable'));
        await state.update(tenantId,agentId,revision,'completed');
        expect((await state.get(tenantId,agentId,revision)).status).toBe('completed');expect(await state.recoverable()).toEqual([]);
    });
});
