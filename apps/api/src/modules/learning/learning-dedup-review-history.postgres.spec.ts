import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LearningService } from './learning.service';
import { LEARNING_DIMENSIONS, learningHash, learningSplit, type LearningMessage } from './learning-contracts';
import { LEARNING_EMBEDDING_DIMENSIONS } from './learning-dedup';

/**
 * Two claims that only PostgreSQL can settle.
 *
 * The redundancy check is a pgvector comparison and a split predicate, and the
 * review history is a read whose whole value is that it obeys the same
 * retraction rules as every other read. Neither survives being asserted against
 * a mocked query function: a mock would happily agree that `s.split=$4` keeps
 * holdout rows out, and would never notice that the retraction deletes the rows
 * this endpoint returns.
 */
const databaseUrl=process.env.LEARNING_EVIDENCE_TEST_DATABASE_URL;
(databaseUrl?describe:describe.skip)('Learning redundancy and review history in PostgreSQL',()=>{
    const tenantId=randomUUID(),agentId=randomUUID();
    const schema=`tenant_learning_dedup_${randomUUID().replace(/-/g,'')}`;
    let client:PrismaClient,prisma:PrismaService,learning:LearningService;
    const sql=(text:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,text,params);

    const vector=(...components:number[])=>{
        const value=Array(LEARNING_EMBEDDING_DIMENSIONS).fill(0);
        components.forEach((component,index)=>{value[index]=component;});
        return value;
    };
    const literal=(value:number[])=>`[${value.join(',')}]`;
    // Cosine distance from BASE: NEAR ~0.019 (inside the duplicate threshold),
    // MID ~0.25 (a neighbour, not a duplicate), FAR 1.0 (not even a candidate).
    const BASE=vector(1),NEAR=vector(1,0.2),MID=vector(1,0.8819),FAR=vector(0,1);
    const PATTERN='Con gusto reviso tu solicitud y te confirmo enseguida.';
    const OTHER_PATTERN='Necesito el documento firmado para poder continuar con el tramite.';

    let nextPattern=PATTERN;
    const knowledge={generateEmbedding:jest.fn(async()=>FAR)};
    const llm={execute:jest.fn(async()=>({content:JSON.stringify({kind:'brand_style',
        scores:Object.fromEntries(LEARNING_DIMENSIONS.map(key=>[key,4])),exclusions:[],
        responsePattern:nextPattern,rationale:'Responde con una pregunta util.',factsRequired:[]})}))};

    const splitKey=(seed:string,want:'train'|'holdout')=>{
        for(let index=0;;index++){
            const key=`${seed}-${index}`;
            if(learningSplit(learningHash(`${tenantId}:${key}`))===want)return key;
        }
    };
    const messages=(customer:string,assistant:string):LearningMessage[]=>
        [{role:'customer',text:customer},{role:'assistant',text:assistant}];
    const TRAIN_EPISODES=[
        messages('Necesito ayuda con mi solicitud de servicio, por favor.','Con gusto, cuentame que necesitas resolver.'),
        messages('Requiero apoyo con mi solicitud de servicio, gracias.','Claro, cuentame que necesitas resolver.'),
        messages('Busco orientacion sobre mi solicitud de servicio pendiente.','Perfecto, cuentame que necesitas resolver.'),
    ];
    // Deliberately share no wording with the train episodes: the import already
    // refuses a lexical near copy across the wall, and this suite is about what
    // the *vector* comparison does after that guard has been satisfied.
    const HOLDOUT_EPISODE=messages('Quiero informacion sobre el horario de atencion del local.',
        'Nuestro equipo atiende de lunes a viernes en jornada continua.');

    const imported=async(seed:string,episode:LearningMessage[],want:'train'|'holdout'='train')=>{
        const key=splitKey(seed,want);
        const result=await learning.importSource(tenantId,agentId,{sourceKey:`file-${key}`,contactKey:key,
            channel:'web_widget',language:'es',messages:episode},'reviewer');
        const [example]=await sql('SELECT id FROM learning_examples WHERE source_id=$1::uuid',[result.sourceId]);
        return {sourceId:result.sourceId as string,split:result.split,exampleId:example.id as string};
    };
    /** A peer that analysis already finished with, seeded directly so each test controls its vector exactly. */
    const seedPeer=async(exampleId:string,embedding:number[],pattern:string,status='analyzed')=>{
        await sql(`UPDATE learning_examples SET status=$3,dedup_status='clear',kind='brand_style',response_pattern=$4,
            embedding=$2::vector,updated_at=NOW() WHERE id=$1::uuid`,[exampleId,literal(embedding),status,pattern]);
    };
    const row=async(exampleId:string)=>(await sql(
        'SELECT status,dedup_status,response_pattern,analysis,embedding IS NULL AS embedding_absent FROM learning_examples WHERE id=$1::uuid',
        [exampleId]))[0];
    const errorCode=async(action:Promise<unknown>)=>{
        try{await action;return null;}
        catch(error:any){return error?.response?.error??error?.getResponse?.()?.error??error?.message;}
    };
    const approve=(exampleId:string,revision=1)=>learning.review(tenantId,agentId,exampleId,
        {decision:'approved',revision,note:'Revisado con cuidado',privacyChecked:true,correctnessChecked:true},'reviewer');

    beforeAll(async()=>{
        const url=new URL(databaseUrl!);
        if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:databaseUrl});
        await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,schema);
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);
        prisma.getTenantSchemaName=jest.fn(async()=>schema);
        await sql('CREATE TABLE agent_personas(id UUID PRIMARY KEY,config_json JSONB)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        // The import fences on the identity table before it decides a split, so
        // it has to exist even for file sources that carry no contact.
        await sql('CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)');
        learning=new LearningService(prisma,knowledge as any,llm as any);
        await learning.ensureTables(schema);
    });
    beforeEach(async()=>{
        await sql('TRUNCATE learning_sources,learning_releases,agent_personas,customer_memory_erasure,contact_identities CASCADE');
        await sql("INSERT INTO agent_personas VALUES($1::uuid,'{}'::jsonb)",[agentId]);
        nextPattern=PATTERN;
        knowledge.generateEmbedding.mockClear();llm.execute.mockClear();
    });
    afterAll(async()=>{
        if(!client)return;
        try{
            if(!/^tenant_learning_dedup_[a-f\d]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            // Other suites share the registry table. Remove only our row.
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        }finally{await client.$disconnect();}
    });

    it('flags the arrival, names what it collided with, and leaves the approved example as its reviewer left it',async()=>{
        const first=await imported('near-a',TRAIN_EPISODES[0]);
        const second=await imported('near-b',TRAIN_EPISODES[1]);
        knowledge.generateEmbedding.mockResolvedValueOnce(BASE);
        expect(await learning.analyze(tenantId,agentId,first.exampleId)).toMatchObject({status:'analyzed'});
        expect(await approve(first.exampleId)).toEqual({status:'approved'});
        knowledge.generateEmbedding.mockResolvedValueOnce(NEAR);
        const analyzed=await learning.analyze(tenantId,agentId,second.exampleId);
        expect(analyzed.status).toBe('flagged');
        expect(analyzed.analysis.exclusions).toContain('same_split_semantic_duplicate');
        const arrival=await row(second.exampleId);
        expect(arrival.dedup_status).toBe('conflict');
        expect(arrival.analysis.dedup).toMatchObject({status:'conflict',crossSplitOverlap:false,
            precedence:'existing_example_keeps_its_review'});
        expect(arrival.analysis.dedup.duplicates).toEqual([expect.objectContaining(
            {exampleId:first.exampleId,heldStatus:'approved',matchedBy:expect.arrayContaining(['episode'])})]);
        expect(arrival.analysis.dedup.duplicates[0].distance).toBeLessThan(0.15);
        // The record is identifiers and numbers. A copy of the other example's
        // words here would outlive every path that erases that example.
        expect(JSON.stringify(arrival.analysis.dedup)).not.toContain('solicitud');
        // The whole point: nothing reviewed moved.
        expect(await row(first.exampleId)).toMatchObject({status:'approved',dedup_status:'clear'});
        expect(await errorCode(approve(second.exampleId))).toBe('learning_quality_gate_not_met');
    });

    it('clears the conflict once the reviewer disagrees and rejects the example it collided with',async()=>{
        const first=await imported('reject-a',TRAIN_EPISODES[0]);
        const second=await imported('reject-b',TRAIN_EPISODES[1]);
        await seedPeer(first.exampleId,BASE,PATTERN);
        knowledge.generateEmbedding.mockResolvedValueOnce(NEAR);
        await learning.analyze(tenantId,agentId,second.exampleId);
        expect((await row(second.exampleId)).dedup_status).toBe('conflict');
        await learning.review(tenantId,agentId,first.exampleId,
            {decision:'rejected',revision:1,note:'Duplicada, prefiero la nueva',privacyChecked:true,correctnessChecked:true},'reviewer');
        knowledge.generateEmbedding.mockResolvedValueOnce(NEAR);
        // A rejected peer can never reach a release, so colliding with it means
        // nothing — which is exactly what makes the disagreement effective.
        expect(await learning.analyze(tenantId,agentId,second.exampleId)).toMatchObject({status:'analyzed'});
        expect(await row(second.exampleId)).toMatchObject({dedup_status:'clear'});
    });

    it('never compares a train example into a holdout one, and reports that overlap without naming it',async()=>{
        const train=await imported('cross-train',TRAIN_EPISODES[0]);
        const heldout=await imported('cross-holdout',HOLDOUT_EPISODE,'holdout');
        expect(heldout.split).toBe('holdout');
        await seedPeer(heldout.exampleId,BASE,PATTERN);
        knowledge.generateEmbedding.mockResolvedValueOnce(BASE);
        const analyzed=await learning.analyze(tenantId,agentId,train.exampleId);
        expect(analyzed.analysis.exclusions).toContain('holdout_semantic_overlap');
        expect(analyzed.analysis.exclusions).not.toContain('same_split_semantic_duplicate');
        const arrival=await row(train.exampleId);
        expect(arrival.dedup_status).toBe('conflict');
        expect(arrival.analysis.dedup).toMatchObject({status:'conflict',crossSplitOverlap:true,duplicates:[]});
        // A train-side reviewer reads this record. A holdout identifier in it is
        // the wall opening from the wrong side.
        expect(JSON.stringify(arrival.analysis.dedup)).not.toContain(heldout.exampleId);
    });

    it('catches the same released sentence from a neighbouring episode, and leaves a distinct one alone',async()=>{
        const peer=await imported('pattern-peer',TRAIN_EPISODES[0]);
        const same=await imported('pattern-same',TRAIN_EPISODES[1]);
        const distinct=await imported('pattern-distinct',TRAIN_EPISODES[2]);
        await seedPeer(peer.exampleId,BASE,PATTERN);
        knowledge.generateEmbedding.mockResolvedValueOnce(MID);
        await learning.analyze(tenantId,agentId,same.exampleId);
        const carried=await row(same.exampleId);
        expect(carried.dedup_status).toBe('conflict');
        expect(carried.analysis.dedup.duplicates[0]).toMatchObject({exampleId:peer.exampleId,matchedBy:['pattern']});
        expect(carried.analysis.dedup.duplicates[0].distance).toBeGreaterThan(0.15);
        // Same neighbourhood, different sentence: a neighbour is not a duplicate.
        await sql("UPDATE learning_examples SET status='rejected' WHERE id=$1::uuid",[same.exampleId]);
        nextPattern=OTHER_PATTERN;
        knowledge.generateEmbedding.mockResolvedValueOnce(MID);
        expect(await learning.analyze(tenantId,agentId,distinct.exampleId)).toMatchObject({status:'analyzed'});
        expect(await row(distinct.exampleId)).toMatchObject({dedup_status:'clear'});
    });

    it('stays pending when the embedding cannot be compared instead of calling the comparison done',async()=>{
        const subject=await imported('failclosed',TRAIN_EPISODES[0]);
        knowledge.generateEmbedding.mockResolvedValueOnce([0.1,0.2] as any);
        const analyzed=await learning.analyze(tenantId,agentId,subject.exampleId);
        expect(analyzed.analysis.exclusions).toContain('dedup_comparison_unavailable');
        const stored=await row(subject.exampleId);
        // `pending` blocks approval and every release; `clear` would have meant
        // "compared, nothing found" about a comparison that never ran.
        expect(stored).toMatchObject({dedup_status:'pending',embedding_absent:true});
        expect(stored.analysis.dedup).toMatchObject({status:'pending',reason:'embedding_unavailable'});
        expect(await errorCode(approve(subject.exampleId))).toBe('learning_quality_gate_not_met');
    });

    it('refuses a release carrying two near duplicates that each saw a split without the other',async()=>{
        const first=await imported('race-a',TRAIN_EPISODES[0]);
        const second=await imported('race-b',TRAIN_EPISODES[1]);
        // Exactly what two concurrent analyses leave behind: both approved, both
        // `clear`, neither ever having seen the other.
        await seedPeer(first.exampleId,BASE,PATTERN,'approved');
        await seedPeer(second.exampleId,NEAR,OTHER_PATTERN,'approved');
        expect(await errorCode(learning.createRelease(tenantId,agentId,[first.exampleId,second.exampleId],'reviewer')))
            .toBe('learning_release_duplicate_examples');
        await seedPeer(second.exampleId,FAR,OTHER_PATTERN,'approved');
        // Past the redundancy check, stopped by the holdout requirement: proof it
        // was the distance and not the selection that was refused above.
        expect(await errorCode(learning.createRelease(tenantId,agentId,[first.exampleId,second.exampleId],'reviewer')))
            .toBe('learning_release_requires_holdout');
    });

    it('returns every decision newest first with the wording it was made about',async()=>{
        const subject=await imported('history',TRAIN_EPISODES[0]);
        knowledge.generateEmbedding.mockResolvedValueOnce(BASE);
        await learning.analyze(tenantId,agentId,subject.exampleId);
        await learning.revise(tenantId,agentId,subject.exampleId,1,'Con gusto reviso tu caso y te respondo hoy mismo.','reviewer');
        nextPattern='Con gusto reviso tu caso y te respondo hoy mismo.';
        knowledge.generateEmbedding.mockResolvedValueOnce(BASE);
        await learning.analyze(tenantId,agentId,subject.exampleId);
        await approve(subject.exampleId,2);
        const result=await learning.reviewHistory(tenantId,agentId,subject.exampleId);
        expect(result).toMatchObject({exampleId:subject.exampleId,revision:2,status:'approved',dedupStatus:'clear',limit:50});
        expect(result.history.map((entry:any)=>[entry.decision,entry.revision]))
            .toEqual([['approved',2],['revised',1]]);
        expect(result.history[0].snapshot).toMatchObject({privacyChecked:true,correctnessChecked:true});
        expect(result.history[0].note).toBe('Revisado con cuidado');
        expect(result.history[0].reviewer_id).toBe('reviewer');
        // The snapshot is the point: what the wording was when the decision was made.
        expect(result.history[1].snapshot.responsePattern).toBe(PATTERN);
    });

    it('bounds the page and refuses what the retraction rules have already taken away',async()=>{
        const subject=await imported('bounded',TRAIN_EPISODES[0]);
        knowledge.generateEmbedding.mockResolvedValueOnce(BASE);
        await learning.analyze(tenantId,agentId,subject.exampleId);
        await approve(subject.exampleId);
        expect((await learning.reviewHistory(tenantId,agentId,subject.exampleId,5000)).limit).toBe(200);
        expect((await learning.reviewHistory(tenantId,agentId,subject.exampleId,NaN)).limit).toBe(50);
        expect((await learning.reviewHistory(tenantId,agentId,subject.exampleId,-4)).limit).toBe(1);
        await learning.withdrawSource(tenantId,agentId,subject.sourceId);
        // The retraction deletes the rows, so an empty history could never mean
        // "erased" — and it does not get the chance to: the read is refused.
        expect(Number((await sql('SELECT COUNT(*)::int AS total FROM learning_reviews'))[0].total)).toBe(0);
        expect(await errorCode(learning.reviewHistory(tenantId,agentId,subject.exampleId))).toBe('learning_example_unavailable');
    });

    it('does not open the holdout wall for a read just because nothing is behind it',async()=>{
        const heldout=await imported('history-holdout',HOLDOUT_EPISODE,'holdout');
        expect(await errorCode(learning.reviewHistory(tenantId,agentId,heldout.exampleId))).toBe('holdout_is_reserved');
    });
});
