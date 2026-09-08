import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { sealEvaluationSnapshot } from './agent-evaluation-snapshot';
import { sealStructuredKnowledgeCapture, structuredKnowledgeRelation } from '../evaluation-revision/evaluation-structured-knowledge';

describe('Structured knowledge snapshot integration', () => {
    it.each(['structuredKnowledgeInputs', 'faqs', 'policies'])('rejects a missing %s before the model', async field => {
        const f = agentTurnFixture(), snapshot = await f.service.captureSnapshot('tenant', 'agent');
        if (field === 'structuredKnowledgeInputs') delete snapshot.structuredKnowledgeInputs;
        else delete (snapshot.structuredKnowledgeInputs as any)[field];
        sealEvaluationSnapshot(snapshot);
        await expect(f.service.test('tenant', 'agent', { message: 'consulta' }, { agentSnapshot: snapshot }))
            .rejects.toThrow('evaluation_structured_knowledge_required');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('rejects changed facts even if their inner integrity hash is resealed', async () => {
        const f = agentTurnFixture(), snapshot = await f.service.captureSnapshot('tenant', 'agent');
        snapshot.structuredKnowledgeInputs!.faqs.rows.push({ id: 'changed', question: 'Altered fact' });
        await expect(f.service.test('tenant', 'agent', { message: 'consulta' }, { agentSnapshot: snapshot })).rejects.toThrow('knowledge_integrity_mismatch');
        const { integrityHash, ...body } = snapshot.structuredKnowledgeInputs!;
        snapshot.structuredKnowledgeInputs = sealStructuredKnowledgeCapture(body);
        await expect(f.service.test('tenant', 'agent', { message: 'consulta' }, { agentSnapshot: snapshot })).rejects.toThrow('frozen_dependencies_integrity_mismatch');
    });
    it('binds the collection to the source schema and preserves errors at capture', async () => {
        const f = agentTurnFixture(), snapshot = await f.service.captureSnapshot('tenant', 'agent');
        f.tenantsService.getSchemaName.mockResolvedValue('tenant_changed');
        await expect(f.service.test('tenant', 'agent', { message: 'consulta' }, { agentSnapshot: snapshot })).rejects.toThrow('knowledge_schema_mismatch');
        f.revisions.captureStructuredKnowledge.mockRejectedValue(new Error('source_query_failed'));
        await expect(f.service.captureSnapshot('tenant', 'agent')).rejects.toThrow('source_query_failed');
    });
    it.each(['search_faqs', 'get_policy'])('binds %s to the server snapshot rather than model arguments', async name => {
        const f = agentTurnFixture(), snapshot = await f.service.captureSnapshot('tenant', 'agent');
        publishTools(f, [name]);
        f.llmRouter.execute.mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'one', function: { name,
            arguments: JSON.stringify({ query: 'horario', type: 'return', structuredKnowledgeInputs: { sourceSchema: 'tenant_other' } }) } }] });
        await f.service.test('tenant', 'agent', { message: 'consulta' }, { agentSnapshot: snapshot });
        expect(f.toolExecutor.execute.mock.calls[0][6].structuredKnowledgeInputs).toEqual(snapshot.structuredKnowledgeInputs);
        expect(f.toolExecutor.execute.mock.calls[0][6].structuredKnowledgeInputs).not.toBe(snapshot.structuredKnowledgeInputs);
    });
    it('cannot use a captured collection in the live write-enabled mode', async () => {
        const f = agentTurnFixture(), snapshot = await f.service.captureSnapshot('tenant', 'agent');
        expect(() => structuredKnowledgeRelation(snapshot.structuredKnowledgeInputs!, 'tenant', 'faqs', 3))
            .toThrow('readonly_required');
    });
});
