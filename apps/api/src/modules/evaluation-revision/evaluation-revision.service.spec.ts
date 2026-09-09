import { EvaluationRevisionService } from './evaluation-revision.service';
import { assertRevisionIntegrity, revisionIgnoredColumns } from './evaluation-revision';
jest.mock('./evaluation-artifact', () => ({evaluationArtifactHash: () => 'loaded-runtime-template-tool-rubric-artifact'}));

export function revisionFixture() {
    const source: Record<string,string> = {agent_personas:'persona',companies:'business',knowledge_documents:'doc-v1',
        knowledge_embeddings:'chunk-v1',knowledge_document_versions:'version-v1',faqs:'faq',policies:'policy',
        services:'catalog',learning_releases:'immutable-content',eval_runs:'run'};
    const query = jest.fn(async (sql: string,...params: any[]): Promise<any[]> => {
        if (sql.startsWith('SELECT schema_name')) return [{schema_name:'tenant_revision'}];
        if (sql.includes('c.relname AS name')) return Object.keys(source).map(name=>({name,kind:'r'}));
        if (sql.includes(') definitions')) return [{hash:'schema-definition'}];
        if (sql.includes('to_regclass')) return [{relation:params[0]}];
        const table = sql.match(/FROM "(?:tenant_revision|public)"\."([a-z_]+)" t/)?.[1];
        if (table) return [{rows:'1',hash:source[table] || table}];
        throw new Error('unexpected query');
    });
    const prisma = {$transaction:jest.fn(async (callback:any,_options:any)=>callback({$queryRawUnsafe:query}))};
    const router = {evaluationRoutingSignature:jest.fn().mockResolvedValue('routing')};
    return {source,query,prisma,router,service:new EvaluationRevisionService(prisma as any,router as any)};
}

describe('complete guarded evaluation revision',()=>{
    it('freezes canonical mission and exact connection channel scope without inheriting an unknown subtype',async()=>{
        const f=revisionFixture();
        (f.prisma as any).tenant={findUnique:jest.fn().mockResolvedValue({industry:'education',settings:{verticalConfig:{industry:'education',subType:'capacitacion'}}})};
        const config={mission:{version:1,objective:'Answer questions',intentKeys:['ask_question'],successCriteria:['Grounded answer'],handoffConditions:['Missing evidence']}};
        const scope=await f.service.captureAgentReleaseScope('tenant',{config_json:config,channels:['whatsapp','telegram'],channel_bindings:['web_widget:connection-id']});
        expect(scope).toEqual({profileId:'education/capacitacion',intentKeys:['ask_question'],missionConfigured:true,channels:['web_widget'],languages:['es','en','pt','fr']});
        config.mission.intentKeys.push('book_appointment');expect(scope.intentKeys).toEqual(['ask_question']);
        (f.prisma as any).tenant.findUnique.mockResolvedValue({industry:'education',settings:{verticalConfig:{subType:'unknown'}}});
        expect(await f.service.captureAgentReleaseScope('tenant',{})).toMatchObject({profileId:null,intentKeys:[],missionConfigured:false});
    });
    it('captures every business table by default, full KB lineages and templates/routing/rubrics in one MVCC transaction',async()=>{
        const f=revisionFixture();f.source.future_catalog='new';
        const manifest=await f.service.capture('11111111-1111-4111-8111-111111111111');
        expect(manifest.dependencies.map(d=>d.key)).toEqual(expect.arrayContaining(['tenant.future_catalog','tenant.knowledge_embeddings',
            'tenant.knowledge_document_versions','database.structure','runtime.artifact_templates_tools_rubrics','runtime.model_routing']));
        expect(manifest.dependencies.find(d=>d.key==='tenant.knowledge_chunks')?.state).toBe('absent');
        expect(f.prisma.$transaction.mock.calls[0][1]).toMatchObject({isolationLevel:'RepeatableRead'});
        expect(manifest.strategy).toBe('guarded_live_dependencies');
        expect(manifest.limitations).toContain('provider_model_weights_not_versioned');
        assertRevisionIntegrity(manifest);
    });
    it.each(['knowledge_documents','knowledge_embeddings','knowledge_document_versions','faqs','policies','companies','services','agent_personas'])
    ('invalidates changes to %s even when the persona config hash would be unchanged',async table=>{
        const f=revisionFixture();const manifest=await f.service.capture('tenant');
        f.source[table]='changed';
        await expect(f.service.assertCurrent(manifest)).rejects.toThrow(`evaluation_dependencies_changed:tenant.${table}`);
    });
    it('excludes only declared outputs and volatile evaluation fields, never embeddings or business prices',async()=>{
        const f=revisionFixture();const manifest=await f.service.capture('tenant');
        f.source.eval_runs='new eval output';
        await expect(f.service.assertCurrent(manifest)).resolves.toBeUndefined();
        const release=f.query.mock.calls.find(call=>call[0].includes('"learning_releases"'))!;
        // `evaluation_namespaces` guarda los leases de los namespaces aislados
        // que la propia evaluación toma y devuelve, y `evaluation_deadline_at`
        // la cota de reloj que el intento se sella a sí mismo. Es contabilidad
        // de la corrida, igual que `evaluation`: si contara, cada evaluación
        // invalidaría su propia corrida al anotarse. Ninguna columna de negocio
        // entra acá, y eso lo fija la línea de abajo.
        expect(release[1]).toEqual(['evaluation','evaluation_status','evaluation_namespaces','evaluation_deadline_at','updated_at']);
        expect(revisionIgnoredColumns('services')).toEqual([]);
    });
    it('distinguishes an unavailable dependency from verified absence without leaking SQL or secrets',async()=>{
        const f=revisionFixture();f.query.mockRejectedValueOnce(new Error('password=secret price=12345 SQL VALUES private'));
        await expect(f.service.capture('tenant')).rejects.toThrow(/^evaluation_dependencies_unavailable$/);
        const other=revisionFixture();other.source.services='price 12345 token top-secret';
        const output=JSON.stringify(await other.service.capture('tenant'));
        expect(output).not.toContain('price 12345');expect(output).not.toContain('top-secret');
    });
    it('rejects partial snapshots, tampering, routing drift and unversioned external relations',async()=>{
        const f=revisionFixture();await expect(f.service.assertCurrent(undefined)).rejects.toThrow('manifest_required');
        const manifest=await f.service.capture('tenant');manifest.dependencies[0].hash='tampered';
        await expect(f.service.assertCurrent(manifest)).rejects.toThrow('integrity_mismatch');
        f.router.evaluationRoutingSignature.mockResolvedValueOnce('before').mockResolvedValueOnce('after');
        await expect(f.service.capture('tenant')).rejects.toThrow('evaluation_dependencies_changed:runtime.model_routing');
        const original=f.query.getMockImplementation()!;
        f.query.mockImplementation((sql,...params)=>sql.includes('c.relname AS name') ? Promise.resolve([{name:'remote_prices',kind:'f'}]) : original(sql,...params));
        await expect(f.service.capture('tenant')).rejects.toThrow('evaluation_dependency_unversioned:tenant.remote_prices');
    });
    it('scopes public tenant rows with a bound UUID rather than interpolating identity',async()=>{
        const f=revisionFixture();await f.service.capture('11111111-1111-4111-8111-111111111111');
        const call=f.query.mock.calls.find(call=>call[0].includes('"public"."channel_accounts"'))!;
        expect(call[0]).toContain('"tenant_id"::text = $2::uuid::text');
        expect(call[2]).toBe('11111111-1111-4111-8111-111111111111');
        expect(call[0]).not.toContain('11111111');
    });
});
