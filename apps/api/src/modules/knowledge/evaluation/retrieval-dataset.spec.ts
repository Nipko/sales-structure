import {
    RETRIEVAL_CASES, RETRIEVAL_CHALLENGES, RETRIEVAL_CORPUS, RETRIEVAL_LANGUAGES,
    datasetRevision, retrievalChunkIndex, retrievalDistractors,
} from './retrieval-dataset';
import { percentile, scoreCase, summariseBy, summariseRetrieval, type CaseOutcome } from './retrieval-metrics';

/**
 * The labels have to be right before any number taken against them means
 * anything.
 *
 * A retrieval metric is a comparison against a set of hand-written answers, so
 * the first thing that can go wrong is the answers: a case pointing at a chunk
 * that no longer exists, an abstention case whose corpus quietly grew an answer,
 * a "forbidden" list that forgot the document it was written to guard against.
 * None of those fail loudly at run time — they fail as a suspiciously good
 * score. So they fail here instead.
 *
 * The second half is the arithmetic, and it is checked on hand-made outcomes
 * rather than on a real run, because a metric that is only ever exercised by
 * the thing it measures cannot catch the case where both are wrong the same way.
 */

const byId = new Map(RETRIEVAL_CASES.map(row => [row.id, row]));
const chunks = retrievalChunkIndex();

describe('the labelled retrieval dataset', () => {
    it('points every label at a chunk that exists', () => {
        for (const row of RETRIEVAL_CASES) {
            for (const id of [...row.relevant, ...row.forbidden]) {
                expect({ case: row.id, chunk: id, known: chunks.has(id) })
                    .toEqual({ case: row.id, chunk: id, known: true });
            }
            if (row.expected.kind === 'answer') {
                for (const id of row.expected.authorisedCitations) expect(chunks.has(id)).toBe(true);
            }
        }
    });

    it('never marks the same chunk both the answer and a trap', () => {
        // A chunk in both lists makes every metric unreadable: retrieving it is
        // simultaneously a hit and a leak.
        for (const row of RETRIEVAL_CASES) {
            expect(row.relevant.filter(id => row.forbidden.includes(id))).toEqual([]);
        }
    });

    it('authorises citations only from chunks it also calls relevant', () => {
        // Citing a passage the case does not consider an answer is how citation
        // precision can be perfect while the answer is wrong.
        for (const row of RETRIEVAL_CASES) {
            if (row.expected.kind !== 'answer') continue;
            for (const id of row.expected.authorisedCitations) expect(row.relevant).toContain(id);
        }
    });

    it('gives an abstention case nothing to retrieve, and says why', () => {
        for (const row of RETRIEVAL_CASES) {
            if (row.expected.kind !== 'abstain') continue;
            expect(row.relevant).toEqual([]);
            // The reason is checked, not admired: an abstention with no stated
            // cause is the one that silently stops being true when the corpus
            // grows the answer.
            expect(row.expected.because.length).toBeGreaterThan(30);
        }
    });

    it('guards every retired and internal chunk with a case that forbids it', () => {
        const forbidden = new Set(RETRIEVAL_CASES.flatMap(row => [...row.forbidden]));
        for (const document of RETRIEVAL_CORPUS) {
            const gated = document.status === 'retired' || document.audience === 'internal';
            if (!gated) continue;
            // A withdrawn document nobody tests for is a leak waiting to be
            // shipped, not a document that cannot leak.
            for (const chunk of document.chunks) {
                expect({ chunk: chunk.id, guarded: forbidden.has(chunk.id) })
                    .toEqual({ chunk: chunk.id, guarded: true });
            }
        }
    });

    it('covers all four languages and every challenge', () => {
        for (const language of RETRIEVAL_LANGUAGES) {
            expect(RETRIEVAL_CASES.some(row => row.language === language)).toBe(true);
        }
        for (const challenge of RETRIEVAL_CHALLENGES) {
            expect(RETRIEVAL_CASES.some(row => row.challenge === challenge)).toBe(true);
        }
    });

    it('says what every document is for', () => {
        for (const document of RETRIEVAL_CORPUS) expect(document.rationale.length).toBeGreaterThan(30);
        for (const row of RETRIEVAL_CASES) expect(row.rationale.length).toBeGreaterThan(30);
    });

    it('has one identity, and it moves when a label does', () => {
        const before = datasetRevision();
        expect(before).toMatch(/^[a-f0-9]{64}$/);
        expect(datasetRevision()).toBe(before);
        const edited = RETRIEVAL_CASES.map(row => row.id === 'es-plain-cancel'
            ? { ...row, relevant: ['es-cancel-current-1'] } : row);
        // A threshold justified against one set of labels must not silently
        // start applying to another.
        expect(datasetRevision(RETRIEVAL_CORPUS, edited)).not.toBe(before);
    });

    it('grows with distractors that answer none of the cases', () => {
        const filler = retrievalDistractors(40);
        expect(filler).toHaveLength(40);
        const labelled = new Set([...RETRIEVAL_CASES.flatMap(row => [...row.relevant, ...row.forbidden])]);
        for (const document of filler) for (const chunk of document.chunks) {
            expect(labelled.has(chunk.id)).toBe(false);
        }
        // Deterministic, or a corpus size is not a reproducible condition.
        expect(retrievalDistractors(40)).toEqual(filler);
        expect(retrievalDistractors(40, 2)).not.toEqual(filler);
        expect(new Set(filler.map(document => document.language)).size).toBe(RETRIEVAL_LANGUAGES.length);
    });
});

describe('what a retrieval run scored', () => {
    const outcome = (over: Partial<CaseOutcome> & { caseId: string }): CaseOutcome => ({
        retrieved: [], latencyMs: 10, ...over,
    });
    const hits = (...ids: string[]) => ids.map((chunkId, index) => ({ chunkId, rank: index + 1, score: 0.9 - index * 0.1 }));

    it('counts recall against the truth set and nothing else', () => {
        const row = byId.get('es-ambiguity-suite')!;
        const half = scoreCase(row, outcome({ caseId: row.id, retrieved: hits('es-suite-ambiguous-0', 'es-pets-0') }), 5);
        expect(half.recallAtK).toBe(0.5);
        const both = scoreCase(row, outcome({ caseId: row.id, retrieved: hits('es-suite-ambiguous-0', 'es-suite-ambiguous-1') }), 5);
        expect(both.recallAtK).toBe(1);
    });

    it('respects the cut-off, so ranking is visible instead of averaged away', () => {
        const row = byId.get('es-plain-cancel')!;
        const late = outcome({ caseId: row.id, retrieved: hits('es-pets-0', 'es-suite-ambiguous-0', 'es-cancel-current-0') });
        expect(scoreCase(row, late, 1).recallAtK).toBe(0);
        expect(scoreCase(row, late, 5).recallAtK).toBe(1);
        // MRR is not cut off — it is the rank itself, and the whole point is that
        // third place scores worse than first.
        expect(scoreCase(row, late, 5).reciprocalRank).toBeCloseTo(1 / 3);
    });

    it('leaves recall undefined where there is no truth to recall', () => {
        const row = byId.get('es-no-answer-parking')!;
        const score = scoreCase(row, outcome({ caseId: row.id }), 5);
        // Zero would read as "it missed everything", which is a different claim
        // from "there was nothing to find".
        expect(score.recallAtK).toBeNull();
        expect(score.reciprocalRank).toBeNull();
        expect(score.abstentionCorrect).toBe('pass');
    });

    it('calls a forbidden hit a leak, not a lower score', () => {
        const row = byId.get('es-retired-promo')!;
        const score = scoreCase(row, outcome({ caseId: row.id, retrieved: hits('es-retired-promo-0') }), 5);
        expect(score.leaked).toEqual(['es-retired-promo-0']);
        expect(score.abstentionCorrect).toBe('fail');
        const summary = summariseRetrieval([score], 5);
        expect(summary.leaks).toBe(1);
        expect(summary.leakedCaseIds).toEqual(['es-retired-promo']);
        // And it is nowhere in the recall column, because it is not a recall
        // problem: recall here has no truth set at all.
        expect(summary.recallAtK).toBeNull();
    });

    it('refuses to call a run that fell over a miss', () => {
        const row = byId.get('es-plain-cancel')!;
        const score = scoreCase(row, outcome({ caseId: row.id, error: 'pgvector_unavailable' }), 5);
        expect(score.recallAtK).toBeNull();
        expect(score.answerCorrect).toBe('not_evaluated');
        const summary = summariseRetrieval([score], 5);
        expect(summary.errors).toBe(1);
        expect(summary.answerAccuracy).toBeNull();
    });

    it('scores a citation outside the authorised set as a wrong citation', () => {
        const row = byId.get('es-plain-cancel')!;
        const score = scoreCase(row, outcome({
            caseId: row.id, retrieved: hits('es-cancel-current-0'),
            answer: { citations: ['es-cancel-current-0', 'es-cancel-expired-0'], text: 'Cancelás sin costo hasta 48 horas antes.' },
        }), 5);
        expect(score.citationPrecision).toBe(0.5);
        // Right passage, right words, wrong source list: still not a correct answer.
        expect(score.lexicalSupport).toBe('pass');
        expect(score.answerCorrect).toBe('fail');
    });

    it('calls an answer ungrounded when its support is not in what came back', () => {
        const row = byId.get('es-plain-cancel')!;
        const invented = scoreCase(row, outcome({
            caseId: row.id, retrieved: hits('es-cancel-current-0'),
            answer: { citations: ['es-cancel-current-0'], text: 'Cancelás sin costo hasta 72 horas antes.' },
        }), 5);
        expect(invented.lexicalSupport).toBe('fail');
        // And it never upgrades that to a claim about meaning.
        expect(invented.semanticEntailment).toBe('not_evaluated');
        expect(summariseRetrieval([invented], 5).semanticEntailment).toBe('not_evaluated');
    });

    it('reports nothing about an answer nobody produced', () => {
        const row = byId.get('es-plain-cancel')!;
        const retrievalOnly = scoreCase(row, outcome({ caseId: row.id, retrieved: hits('es-cancel-current-0') }), 5);
        // A metric nobody measured must not read as a metric something failed.
        expect(retrievalOnly.lexicalSupport).toBe('not_evaluated');
        expect(retrievalOnly.citationPrecision).toBeNull();
        expect(retrievalOnly.answerCorrect).toBe('pass');
    });

    it('publishes a percentile the run actually saw', () => {
        const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        expect(percentile(values, 50)).toBe(50);
        expect(percentile(values, 95)).toBe(100);
        expect(percentile(values, 99)).toBe(100);
        // Nearest rank: every answer is one of the inputs, never a number
        // between two of them that nobody measured.
        for (const p of [1, 25, 50, 75, 90, 95, 99, 100]) expect(values).toContain(percentile(values, p));
        expect(percentile([], 95)).toBe(0);
        expect(() => percentile(values, 0)).toThrow('percentile_out_of_range');
    });

    it('splits the report where a good average would hide a bad cell', () => {
        const spanish = scoreCase(byId.get('es-plain-cancel')!,
            outcome({ caseId: 'es-plain-cancel', retrieved: hits('es-cancel-current-0') }), 5);
        const french = scoreCase(byId.get('fr-plain-delivery')!,
            outcome({ caseId: 'fr-plain-delivery', retrieved: hits('es-pets-0') }), 5);
        const both = summariseRetrieval([spanish, french], 5);
        expect(both.recallAtK).toBe(0.5);
        const split = summariseBy([spanish, french], 5, caseId => byId.get(caseId)!.language);
        // The average says "half"; the split says which half, which is the only
        // form of that number anybody can act on.
        expect(split.es.recallAtK).toBe(1);
        expect(split.fr.recallAtK).toBe(0);
    });
});
