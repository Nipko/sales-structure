import { SEED_LLM_CATALOG, parseLlmCatalogSnapshot, catalogContent } from '../router/llm-catalog';
import {
    describeHeadChange, headChangeList, MEASUREMENT_MAX_AGE_DAYS, promotionCheck, summarizeRehearsalRuns,
    type HeadChange, type MeasurementBench, type MeasurementLite,
} from './promotion-rule';

const NOW = new Date('2026-11-20T12:00:00Z');
const m = (modelId: string, bench: MeasurementBench, passRate: number, daysAgo = 1, n = 270): MeasurementLite => ({
    modelId, bench, n, pass: Math.round(passRate * n), passRate, measuredAt: new Date(NOW.getTime() - daysAgo * 86_400_000), catalogVersion: 1,
});
const lookup = (rows: MeasurementLite[]) => (model: string, bench: MeasurementBench) => rows.find(r => r.modelId === model && r.bench === bench);
const chain = (key: HeadChange['key'], from: string, to: string): HeadChange => ({ kind: 'chain', key, from, to });

describe('promotion-rule (ADR-0030 §4, fase 4)', () => {
    it('headChangeList ve cadenas y roles cuya cabeza cambia', () => {
        const content = catalogContent(SEED_LLM_CATALOG);
        content.chains.conversation = ['gpt-6-sol', ...content.chains.conversation.filter(id => id !== 'gpt-6-sol')];
        content.roles.judge_quality = ['grok-4.3'];
        const next = parseLlmCatalogSnapshot(content, '2').snapshot!;
        expect(headChangeList(SEED_LLM_CATALOG, next).map(describeHeadChange)).toEqual([
            'chain:conversation:gpt-6-luna->gpt-6-sol', 'role:judge_quality:gpt-6-luna->grok-4.3',
        ]);
    });

    it('conversación: candidato dentro de la tolerancia del ensayo y sin perder confirmaciones', () => {
        const rows = [
            m('gpt-6-luna', 'rehearsal_7t', 0.940), m('gpt-6-luna', 'signed_confirmation', 1, 30, 28),
            m('cand', 'rehearsal_7t', 0.931), m('cand', 'signed_confirmation', 1, 2, 28),
        ];
        expect(promotionCheck([chain('conversation', 'gpt-6-luna', 'cand')], lookup(rows), NOW).problems).toEqual([]);
    });

    it('conversación: bajo la tolerancia o con menos confirmaciones bloquea', () => {
        const rows = [
            m('gpt-6-luna', 'rehearsal_7t', 0.940), m('gpt-6-luna', 'signed_confirmation', 1, 1, 28),
            m('cand', 'rehearsal_7t', 0.925), m('cand', 'signed_confirmation', 26 / 28, 1, 28),
        ];
        expect(promotionCheck([chain('tool_calling', 'gpt-6-luna', 'cand')], lookup(rows), NOW).problems).toEqual([
            'measurement_below_head:rehearsal_7t:cand:0.9250<0.9400-0.01',
            'measurement_below_head:signed_confirmation:cand:0.9286<1.0000',
        ]);
    });

    it('una medición del candidato de más de 14 días no vale; la de la cabeza sí sirve de referencia', () => {
        const rows = [m('gpt-6-luna', 'rehearsal_7t', 0.94, 60), m('cand', 'rehearsal_7t', 0.99, MEASUREMENT_MAX_AGE_DAYS + 1)];
        const result = promotionCheck([chain('conversation', 'gpt-6-luna', 'cand')], lookup(rows), NOW);
        expect(result.problems).toEqual(['measurement_stale:rehearsal_7t:cand:15d', 'measurement_missing:signed_confirmation:cand']);
    });

    it('sin medición de la cabeza basta la del candidato, con aviso', () => {
        const rows = [m('cand', 'classify_verifier', 0.9)];
        const result = promotionCheck([chain('classify', 'gemini-3.5-flash-lite', 'cand')], lookup(rows), NOW);
        expect(result).toMatchObject({ problems: [], warnings: ['no_head_baseline:classify_verifier:gemini-3.5-flash-lite'] });
        expect(result.evidence).toEqual([{ change: 'chain:classify:gemini-3.5-flash-lite->cand', bench: 'classify_verifier',
            candidate: expect.objectContaining({ model: 'cand', passRate: 0.9 }), head: null }]);
    });

    it('classify no tolera regresiones', () => {
        const rows = [m('head', 'classify_verifier', 0.95), m('cand', 'classify_verifier', 0.949)];
        expect(promotionCheck([chain('classify', 'head', 'cand')], lookup(rows), NOW).problems).toEqual([
            'measurement_below_head:classify_verifier:cand:0.9490<0.9500',
        ]);
    });

    it('un juez nuevo exige «publicar sin medición»; un rol auxiliar sólo avisa', () => {
        const result = promotionCheck([
            { kind: 'role', key: 'judge_rehearsal', from: 'deepseek-flash', to: 'gpt-5.6-luna' },
            { kind: 'role', key: 'aux_cheap', from: 'deepseek-flash', to: 'gpt-6-luna' },
        ], () => undefined, NOW);
        expect(result.problems).toEqual(['judge_change_requires_unmeasured:role:judge_rehearsal:deepseek-flash->gpt-5.6-luna']);
        expect(result.warnings).toEqual(['role_head_change_without_bench:role:aux_cheap:deepseek-flash->gpt-6-luna']);
    });

    it('summarizeRehearsalRuns usa el criterio de compare2.py: sin errores en n', () => {
        const runs = [{ runs: [
            { costUsd: 0.08, completedCount: 4, results: [{ outcome: 'answered' }, { outcome: 'missing_data' }, { outcome: 'wrong' }, { outcome: 'error' }] },
            { costUsd: null, results: null },
        ] }, { error: 'tenant_not_found' } as any];
        expect(summarizeRehearsalRuns(runs)).toEqual({ n: 3, pass: 2, errors: 1, passRate: 0.6667, costPerCaseUsd: 0.02 });
        expect(summarizeRehearsalRuns([])).toEqual({ n: 0, pass: 0, errors: 0, passRate: 0, costPerCaseUsd: null });
    });
});
