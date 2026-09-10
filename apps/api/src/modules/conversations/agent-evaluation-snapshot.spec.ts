import { evaluationSnapshot, resolveEvaluationSnapshot } from './agent-evaluation-snapshot';

describe('evaluation configuration revision', () => {
    it('detaches each turn from both live edits and mutations in the prior turn', () => {
        const live = { version: 8, config_json: { language: 'fr', behavior: { goal: 'support' } } };
        const snapshot = evaluationSnapshot('tenant', 'agent', live);
        live.config_json.behavior.goal = 'sales';
        const first = resolveEvaluationSnapshot(snapshot, 'tenant', 'agent') as any;
        first.behavior.goal = 'changed during turn';
        expect((resolveEvaluationSnapshot(snapshot, 'tenant', 'agent') as any).behavior.goal).toBe('support');
        expect(snapshot.version).toBe(8);
    });

    it('survives JSONB object key ordering while detecting a changed value', () => {
        const snapshot = evaluationSnapshot('tenant', 'agent', { config_json: { z: 1, a: { y: 2, b: 3 } } });
        snapshot.config = { a: { b: 3, y: 2 }, z: 1 } as any;
        expect(() => resolveEvaluationSnapshot(snapshot, 'tenant', 'agent')).not.toThrow();
        (snapshot.config as any).a.y = 4;
        expect(() => resolveEvaluationSnapshot(snapshot, 'tenant', 'agent')).toThrow('integrity_mismatch');
    });

    it.each([['other', 'agent'], ['tenant', 'other']])('rejects another tenant or agent scope', (tenant, agent) => {
        const snapshot = evaluationSnapshot('tenant', 'agent', { config_json: {} });
        expect(() => resolveEvaluationSnapshot(snapshot, tenant, agent)).toThrow('scope_mismatch');
    });
});
