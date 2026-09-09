import { randomUUID } from 'crypto';
import { AgentReleaseService } from './agent-release.service';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
(connection?describe:describe.skip)('release recovery scheduling in disposable PostgreSQL',()=>{
    const schema=`tenant_release_recovery_${randomUUID().replace(/-/g,'')}`,tenantId=randomUUID(),agentId=randomUUID();
    let pool:any,service:AgentReleaseService,dispatch:jest.SpyInstance;
    const query=async(sql:string,params:any[]=[]) => (await pool.query(sql,params)).rows;
    beforeAll(async()=>{
        const url=new URL(connection!);
        if(!['127.0.0.1','localhost'].includes(url.hostname)||!isDisposableDatabaseUrl(url))throw new Error('disposable_eval_database_required');
        pool=new(require('pg').Pool)({connectionString:connection});
        await query(`CREATE SCHEMA "${schema}"`);
        // Scheduling projections only; the canonical release store has separate full-DDL PG coverage.
        await query(`CREATE TABLE "${schema}".agent_release_candidates(id uuid PRIMARY KEY,agent_id uuid,status text,created_at timestamptz)`);
        await query(`CREATE TABLE "${schema}".agent_release_evaluations(id uuid PRIMARY KEY,candidate_id uuid REFERENCES "${schema}".agent_release_candidates(id),status text,next_attempt_at timestamptz,lease_until timestamptz)`);
        const prisma:any={tenant:{findMany:async()=>[{id:tenantId}]},getTenantSchemaName:async()=>schema,
            transactionInTenantSchema:async(_schema:string,work:any)=>{
                const client=await pool.connect();await client.query('BEGIN');
                try{await client.query(`SET LOCAL search_path TO "${schema}",public`);const result=await work(async(sql:string,params:any[]=[]) =>(await client.query(sql,params)).rows);await client.query('COMMIT');return result;}
                catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
            }};
        service=new AgentReleaseService(prisma,{} as any,{} as any,{} as any,{} as any);
        dispatch=jest.spyOn(service as any,'dispatch').mockResolvedValue(undefined);
    });
    beforeEach(async()=>{dispatch.mockClear();await query(`DELETE FROM "${schema}".agent_release_evaluations`);await query(`DELETE FROM "${schema}".agent_release_candidates`);});
    afterAll(async()=>{if(!pool)return;await query(`DROP TABLE "${schema}".agent_release_evaluations`);await query(`DROP TABLE "${schema}".agent_release_candidates`);await query(`DROP SCHEMA "${schema}"`);await pool.end();});
    it.each(['running','budget_deferred'])('does not let fifty %s candidates hide a later due evaluation',async status=>{
        const ids=Array.from({length:51},()=>randomUUID());
        for(let i=0;i<ids.length;i++){
            await query(`INSERT INTO "${schema}".agent_release_candidates VALUES($1::uuid,$2::uuid,'evaluating',NOW()+$3*INTERVAL '1 second')`,[ids[i],agentId,i]);
            await query(`INSERT INTO "${schema}".agent_release_evaluations VALUES($1::uuid,$2::uuid,$3,NOW()+$4*INTERVAL '1 hour',NOW()+INTERVAL '1 hour')`,[randomUUID(),ids[i],i===50?'pending':status,i===50?-1:1]);
        }
        await service.recover();
        expect(dispatch.mock.calls).toEqual([[tenantId,agentId,ids[50]]]);
    });
    it('recovers an expired lease while leaving a future retry untouched',async()=>{
        const due=randomUUID(),future=randomUUID();
        for(const id of [due,future])await query(`INSERT INTO "${schema}".agent_release_candidates VALUES($1::uuid,$2::uuid,'evaluating',NOW())`,[id,agentId]);
        await query(`INSERT INTO "${schema}".agent_release_evaluations VALUES($1::uuid,$2::uuid,'running',NOW(),NOW()-INTERVAL '1 second'),($3::uuid,$4::uuid,'failed',NOW()+INTERVAL '1 hour',NULL)`,[randomUUID(),due,randomUUID(),future]);
        await service.recover();expect(dispatch.mock.calls).toEqual([[tenantId,agentId,due]]);
    });
});
