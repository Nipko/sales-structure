import { AgentTestService } from './agent-test.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { EVAL_SANDBOX_CONTACT_ID, AGENT_TEST_SANDBOX_CONTACT_ID } from './agent-test-tool-policy';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

describe('AgentTestService delegates to the operational core', () => {
    it('releases a newly captured corpus if request validation fails before retaining a session',async()=>{
        const f=agentTurnFixture();
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},{evalMode:true}))
            .rejects.toThrow('eval_sandbox_identity_required');
        expect(f.evaluationKnowledge.release).toHaveBeenCalledTimes(1);
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('does not release another runner\'s snapshot when a test request is invalid',async()=>{
        const f=agentTurnFixture(),snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},{evalMode:true,agentSnapshot:snapshot}))
            .rejects.toThrow('eval_sandbox_identity_required');
        expect(f.evaluationKnowledge.release).not.toHaveBeenCalled();
    });
    it('requires a sealed knowledge reference before entering the runtime',async()=>{
        const f=agentTurnFixture(),snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        delete snapshot.knowledgeInputs;
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},{agentSnapshot:snapshot}))
            .rejects.toThrow('evaluation_knowledge_replica_required');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('binds a public draft selection to its preview session and rejects switching revisions mid-conversation',async()=>{
        const f=agentTurnFixture(),live=await f.personaService.getAgent(),id='11111111-1111-4111-8111-111111111111';
        Object.assign(f.personaService,{readConfigurationRevision:jest.fn().mockResolvedValue({id,body_hash:'a'.repeat(64),base_operational_hash:operationalConfigurationHash({...live,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),
            body:{configJson:{...live.config_json,language:'fr'},channels:['web_widget'],channelBindings:[],scheduleMode:'24_7',isActive:true,isDefault:false}})});
        const revision=await (f.personaService as any).readConfigurationRevision();revision.body_hash=revisionHash(revision.body);
        const first=await f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'Bonjour',configurationRevisionId:id});
        expect(first.debug.agentRevision?.configurationRevisionId).toBe(id);
        const calls=f.llmRouter.execute.mock.calls.length;
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'Continue',runtimeSessionId:first.debug.runtimeSessionId,
            configurationRevisionId:'22222222-2222-4222-8222-222222222222'})).rejects.toThrow('session_configuration_revision_changed');
        expect(f.llmRouter.execute).toHaveBeenCalledTimes(calls);
        const next=await f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'Merci',runtimeSessionId:first.debug.runtimeSessionId});
        expect(next.debug.agentRevision?.configurationRevisionId).toBe(id);
    });
    it('evaluates the selected canonical draft without replacing the operational persona',async()=>{
        const f=agentTurnFixture(),live=await f.personaService.getAgent();
        const draftConfig=structuredClone(live.config_json);draftConfig.persona={...draftConfig.persona,name:'Candidate Alex'};
        const reader=jest.fn().mockResolvedValue({id:'11111111-1111-4111-8111-111111111111',body_hash:'a'.repeat(64),base_operational_hash:operationalConfigurationHash({...live,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),
            body:{name:'Candidate Alex',configJson:draftConfig,channels:['telegram'],channelBindings:['telegram:owned'],
                scheduleMode:'24_7',isActive:true,isDefault:false}});
        const revision=await reader();revision.body_hash=revisionHash(revision.body);
        Object.assign(f.personaService,{readConfigurationRevision:reader});
        const snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{configurationRevisionId:'11111111-1111-4111-8111-111111111111'});
        expect(reader).toHaveBeenCalledWith('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',AGENT_TEST_EXECUTION_CONTEXT);
        expect(snapshot.config.persona.name).toBe('Candidate Alex');
        expect(snapshot.configurationRevisionHash).toBe(revision.body_hash);
        expect(snapshot.configurationBody?.channelBindings).toEqual(['telegram:owned']);
        expect(snapshot.configurationBaseOperationalHash).toBe(operationalConfigurationHash({...live,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));
        expect(snapshot.configurationBaseOperationalBody?.configJson).toEqual(live.config_json);
        expect((await f.personaService.getAgent()).config_json).toEqual(live.config_json);
        for(const field of ['configurationRevisionId','configurationRevisionHash','configurationBody','configurationBaseOperationalHash','configurationBaseOperationalBody'] as const){
            const altered=structuredClone(snapshot);delete altered[field];
            await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hello'},{agentSnapshot:altered})).rejects.toThrow('configuration_revision_integrity_mismatch');
        }
        const changed=structuredClone(snapshot);changed.configurationRevisionHash='b'.repeat(64);
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hello'},{agentSnapshot:changed})).rejects.toThrow('configuration_body_integrity_mismatch');
        const routing=structuredClone(snapshot);routing.configurationBody!.channelBindings=['telegram:someone_else'];
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hello'},{agentSnapshot:routing})).rejects.toThrow('configuration_body_integrity_mismatch');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('rejects a changed or misleading before-state rather than showing the wrong configuration diff',async()=>{
        const f=agentTurnFixture(),live=await f.personaService.getAgent();
        const reader=jest.fn().mockResolvedValue({id:'11111111-1111-4111-8111-111111111111',body_hash:'a'.repeat(64),base_operational_hash:'b'.repeat(64),
            body:{name:'Candidate',configJson:live.config_json,channels:[],channelBindings:[],scheduleMode:'24_7',isActive:true,isDefault:false}});
        Object.assign(f.personaService,{readConfigurationRevision:reader});
        await expect(f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{configurationRevisionId:'11111111-1111-4111-8111-111111111111'})).rejects.toThrow('agent_operational_configuration_changed');
        reader.mockResolvedValue({...await reader(),base_operational_hash:operationalConfigurationHash({...live,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})});
        const revision=await reader();revision.body_hash=revisionHash(revision.body);
        const snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{configurationRevisionId:'11111111-1111-4111-8111-111111111111'});
        snapshot.configurationBaseOperationalBody!.channels=['telegram'];
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hello'},{agentSnapshot:snapshot})).rejects.toThrow('configuration_base_integrity_mismatch');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('rejects a changed or removed frozen release scope before using the runtime',async()=>{
        const f=agentTurnFixture();const snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        snapshot.releaseScope!.channels.push('telegram');
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hello'},{agentSnapshot:snapshot})).rejects.toThrow('frozen_dependencies_integrity_mismatch');
        const removed=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');delete removed.releaseScope;
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hello'},{agentSnapshot:removed})).rejects.toThrow('release_scope_integrity_mismatch');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('checks quota before loading config, resolving schema or calling the core', async () => {
        const f = agentTurnFixture(); f.throttle.hasAiMessageQuota.mockResolvedValue(false);
        await expect(f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' })).rejects.toThrow('ai_message_quota_exceeded');
        expect(f.personaService.getAgent).not.toHaveBeenCalled();
        expect(f.tenantsService.getSchemaName).not.toHaveBeenCalled();
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('uses a frozen revision and actual channel while accounting every provider invocation', async () => {
        const f = agentTurnFixture(); const snapshot = await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        f.personaService.getAgent.mockResolvedValue({ version: 99, config_json: { language: 'fr', tools: {} } });
        const spy = jest.spyOn(f.runtime as any, 'generateResponse');
        const result = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola', channelType: 'telegram' }, { agentSnapshot: snapshot });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][3]).toEqual(snapshot.config);
        expect(f.personaService.getAgent).toHaveBeenCalledTimes(1);
        expect(result.debug.turnContext).toMatchObject({ channelType: 'telegram', executionMode: 'agent_test' });
        expect(result.debug.tokens).toEqual({ input: 20, output: 5 });
        expect(result.debug.runtimeError).toBeUndefined();
        expect(f.throttle.incrementAiMessageCount).toHaveBeenCalledTimes(1);
        expect(f.throttle.getPlanFeatures).toHaveBeenCalledWith('tenant', AGENT_TEST_EXECUTION_CONTEXT);
        expect(f.tenantsService.getSchemaName).toHaveBeenCalledWith('tenant', AGENT_TEST_EXECUTION_CONTEXT);
    });
    it('retains an opaque session, recent history and tools across turns', async () => {
        const f = agentTurnFixture(); publishTools(f, ['search_products']);
        f.llmRouter.execute.mockResolvedValueOnce({ toolCalls: [{ id: 't1', function: { name: 'search_products', arguments: '{}' } }], content: '' });
        const first = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'busco camisa' });
        const second = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: '¿y azul?', runtimeSessionId: first.debug.runtimeSessionId,
            conversationHistory: [{ role: 'user', content: 'busco camisa' }, { role: 'assistant', content: first.reply }] });
        expect(second.debug.runtimeSessionId).toBe(first.debug.runtimeSessionId);
        const call = f.llmRouter.execute.mock.calls.at(-1)[0];
        expect(call.messages).toEqual(expect.arrayContaining([{ role: 'user', content: 'busco camisa' }]));
        expect((second.debug.turnContext as any).recentActions).toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'search_products' })]));
    });
    it('rejects cross-tenant/channel reuse and a changed config revision', async () => {
        const f = agentTurnFixture(); const first = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' });
        for (const [tenant, channelType] of [['other', 'web_widget'], ['tenant', 'telegram']]) {
            await expect(f.service.test(tenant, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola', channelType: channelType as any, runtimeSessionId: first.debug.runtimeSessionId })).rejects.toThrow('agent_test_session_scope_mismatch');
        }
        f.personaService.getAgent.mockResolvedValue({ config_json: { language: 'fr' } });
        const changed = await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        await expect(f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola', runtimeSessionId: first.debug.runtimeSessionId }, { agentSnapshot: changed })).rejects.toThrow('agent_test_session_revision_changed');
    });
    it('requires the server eval identity and never accepts an arbitrary customer identity', async () => {
        const f = agentTurnFixture();
        await expect(f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { evalMode: true })).rejects.toThrow('eval_sandbox_identity_required');
        const spy = jest.spyOn(f.runtime, 'executeAgentTurn');
        await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { sandboxContactId: '11111111-1111-4111-8111-111111111111' });
        expect((spy.mock.calls[0][1] as any).contactId).toBe(AGENT_TEST_SANDBOX_CONTACT_ID);
    });
    it('reports missing canonical sandbox instead of calling a domain writer', async () => {
        const f = agentTurnFixture(); publishTools(f, ['create_appointment', 'search_products']);
        f.llmRouter.execute.mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'write', function: { name: 'create_appointment', arguments: '{}' } }] });
        const result = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, {
            evalMode: true, sandboxContactId: EVAL_SANDBOX_CONTACT_ID, sandboxConversationId: '11111111-1111-4111-8111-111111111111',
        });
        expect(f.toolExecutor.execute).not.toHaveBeenCalled();
        expect(result.debug.toolCalls[0].result).toMatchObject({ error: 'canonical_sandbox_not_available', persisted: false });
        expect(result.debug.toolParity.executableCount).toBe(1);
    });
    it('keeps budget failure distinguishable from a successful fallback and invokes no provider', async () => {
        const f = agentTurnFixture();
        const result = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { beforeModelExecution: async () => { throw new Error('eval_daily_budget_exhausted'); } });
        expect(result.debug.runtimeError).toBe('eval_daily_budget_exhausted');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
        expect(f.throttle.incrementAiMessageCount).not.toHaveBeenCalled();
        expect(f.prisma.executeInTenantSchema.mock.calls.every((call: any[]) => /^\s*(SELECT|WITH)/i.test(call[1]))).toBe(true);
    });
    it('freezes the published learning revision or an explicit empty baseline', async () => {
        const learning = { getPublishedReleaseSnapshot: jest.fn().mockResolvedValue({ releaseId: 'release', releaseHash: 'hash' }) };
        const f = agentTurnFixture({ learning }); const snapshot = await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        expect(snapshot).toMatchObject({ learningReleaseId: 'release', learningReleaseHash: 'hash' });
        learning.getPublishedReleaseSnapshot.mockResolvedValue(null);
        expect(await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toMatchObject({ learningReleaseId: null, learningReleaseHash: null });
    });
    it('prevents concurrent turns from sharing mutable state and makes an expired session explicit', async () => {
        const f = agentTurnFixture();
        const first = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' });
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let admitted!: () => void;
        const entered = new Promise<void>(resolve => { admitted = resolve; });
        const second = f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'continúa', runtimeSessionId: first.debug.runtimeSessionId },
            { beforeModelExecution: async () => { admitted(); await blocked; } });
        await entered;
        await expect(f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'otra', runtimeSessionId: first.debug.runtimeSessionId })).rejects.toThrow('agent_test_session_busy');
        release(); await second;
        await expect(f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola', runtimeSessionId: '11111111-1111-4111-8111-111111111111' })).rejects.toThrow('agent_test_session_expired');
    });
    it('reuses an unchanged validated revision without rereading the persona cache', async () => {
        const f = agentTurnFixture(); const first = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' });
        const second = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'gracias', runtimeSessionId: first.debug.runtimeSessionId });
        expect(second.debug.agentRevision).toEqual(first.debug.agentRevision);
        expect(f.personaService.getAgent).toHaveBeenCalledTimes(1);
    });
    it('blocks reuse after KB/FAQ/catalog drift even when the saved persona is identical', async () => {
        const f=agentTurnFixture();const first=await f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'});
        f.revisions.assertCurrent.mockRejectedValue(new Error('evaluation_dependencies_changed:tenant.knowledge_embeddings'));
        f.llmRouter.execute.mockClear();
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'otra duda',runtimeSessionId:first.debug.runtimeSessionId})).rejects.toThrow('knowledge_embeddings');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('rejects a model result if dependencies changed during its invocation, accounting the spent call',async()=>{
        const f=agentTurnFixture();const snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        f.llmRouter.execute.mockImplementation(async()=>{
            f.revisions.assertCurrent.mockRejectedValue(new Error('evaluation_dependencies_changed:tenant.policies'));
            return {content:'This stale answer must not be released',model:'test'};
        });
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},{agentSnapshot:snapshot})).rejects.toThrow('tenant.policies');
        expect(f.throttle.incrementAiMessageCount).toHaveBeenCalledTimes(1);
    });
    it('does not feed a tool result from changed dependencies into another model invocation',async()=>{
        const f=agentTurnFixture();publishTools(f,['search_products']);
        const snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        f.llmRouter.execute.mockResolvedValueOnce({content:'',toolCalls:[{id:'read',function:{name:'search_products',arguments:'{}'}}]});
        f.toolExecutor.execute.mockImplementation(async()=>{
            f.revisions.assertCurrent.mockRejectedValue(new Error('evaluation_dependencies_changed:tenant.products'));
            return {items:[{price:999}]};
        });
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'camisa'},{agentSnapshot:snapshot})).rejects.toThrow('tenant.products');
        expect(f.llmRouter.execute).toHaveBeenCalledTimes(1);
    });
    it('rejects a legacy config-only snapshot and tampered frozen MCP/procedure data before using the core',async()=>{
        const f=agentTurnFixture();const snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const legacy={...snapshot};delete legacy.manifest;
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},{agentSnapshot:legacy})).rejects.toThrow('manifest_required');
        snapshot.procedures=[{id:'changed'} as any];
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},{agentSnapshot:snapshot})).rejects.toThrow('procedure_integrity');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('supplies frozen procedure definitions even when the isolated namespace has no procedure table',async()=>{
        const f=agentTurnFixture();
        const procedure={id:'procedure-1',name:'Welcome',status:'active',version:2,trigger:{keywords:['consulta']},steps:[]};
        f.revisions.captureProcedures.mockResolvedValue([procedure]);
        const snapshot=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const fork=jest.spyOn(f.procedureEngine,'forExecution');
        await f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},{agentSnapshot:snapshot});
        const definitions=(fork.mock.calls[0][0] as {definitions:import('./procedure-engine.service').ProcedureDefinitionStore}).definitions;
        await expect(definitions.listActive('tenant_isolated')).resolves.toEqual([procedure]);
        await expect(definitions.getById('tenant_isolated','procedure-1')).resolves.toEqual(procedure);
        f.revisions.captureProcedures.mockResolvedValue([{...procedure,name:'New live name'}]);
        await expect(definitions.getById('tenant_isolated','procedure-1')).resolves.toEqual(procedure);
    });
    it('preserves composite integrity across durable JSONB serialization without retaining provider secrets',async()=>{
        const f=agentTurnFixture();f.integrations.getAllHealth.mockResolvedValue({mindbody:{connected:true,lastError:'private-token',credentials:'secret'}});
        f.revisions.captureProcedures.mockResolvedValue([{id:'procedure',name:'Hello',status:'active',trigger:{keywords:[]},steps:[],version:1,vertical:undefined}]);
        const captured=await f.service.captureSnapshot('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const restored=JSON.parse(JSON.stringify(captured));
        await expect(f.service.assertSnapshotCurrent(restored)).resolves.toBeUndefined();
        expect(JSON.stringify(restored)).not.toContain('private-token');expect(JSON.stringify(restored)).not.toContain('credentials');
        expect(restored.manifest.revision).toBe(captured.manifest!.revision);
    });
    it('validates the server namespace and threads it through the actual session tool boundary', async () => {
        const f=agentTurnFixture();publishTools(f,['create_appointment','check_availability','create_payment_link']);
        const namespace={schemaName:'tenant_eval_11111111_111111111111111111111111',sourceSchema:'tenant_test',tenantId:'tenant',token:'opaque',tables:[],expiresAt:new Date(Date.now()+3600000).toISOString()};
        const namespaces={assertOwned:jest.fn().mockResolvedValue(undefined)};
        (f.service as any).namespaces=namespaces;f.tenantsService.getSchemaName.mockResolvedValue('tenant_test');
        const options={evalMode:true,sandboxContactId:EVAL_SANDBOX_CONTACT_ID,sandboxConversationId:'11111111-1111-4111-8111-111111111111',sandboxNamespace:namespace,sandboxInboundMessageId:'22222222-2222-4222-8222-222222222222'};
        f.llmRouter.execute.mockResolvedValueOnce({content:'',toolCalls:[{id:'write',function:{name:'create_appointment',arguments:'{}'}}]});
        await f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},options);
        expect(namespaces.assertOwned).toHaveBeenCalledWith(namespace);
        expect(f.toolExecutor.execute.mock.calls[0][0]).toBe(namespace.schemaName);
        expect(f.toolExecutor.execute.mock.calls[0][6]).toMatchObject({evalMode:true,sandboxNamespace:namespace,readOnly:false,executionState:expect.any(Object)});
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},{...options,sandboxNamespace:{...namespace,sourceSchema:'tenant_other'}})).rejects.toThrow('eval_namespace_scope_mismatch');
        namespaces.assertOwned.mockRejectedValue(new Error('eval_namespace_lease_lost'));
        await expect(f.service.test('tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'hola'},options)).rejects.toThrow('eval_namespace_lease_lost');
    });

});
