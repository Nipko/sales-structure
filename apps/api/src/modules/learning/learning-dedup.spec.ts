import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { LearningController } from './learning.controller';
import { LEARNING_DUPLICATE_DISTANCE, LEARNING_DUPLICATE_NEIGHBOURHOOD, LEARNING_EMBEDDING_DIMENSIONS,
    isLearningEmbedding, learningDedupRecord, learningSplitDuplicates } from './learning-dedup';

const PATTERN = 'Con gusto reviso tu solicitud y te confirmo enseguida.';
const OTHER = 'Necesito el documento firmado para poder continuar con el tramite.';
const embedding = (fill = 0.1) => Array(LEARNING_EMBEDDING_DIMENSIONS).fill(fill);
const peer = (over: Record<string, unknown> = {}) =>
    ({ example_id: 'peer-1', status: 'analyzed', response_pattern: OTHER, distance: 0.05, ...over });
const run = (rows: any[], responsePattern = PATTERN) => learningSplitDuplicates(async () => rows as any,
    { exampleId: 'subject', agentId: 'agent', split: 'train', embedding: '[1,0]', responsePattern });

describe('what counts as the same lesson twice', () => {
    it('refuses to call anything but a full, finite vector comparable', () => {
        expect(isLearningEmbedding(embedding())).toBe(true);
        // A truncated or non-numeric answer from the provider is the case that
        // must not be allowed to end as `clear`.
        expect(isLearningEmbedding([0.1, 0.2])).toBe(false);
        expect(isLearningEmbedding(Array(LEARNING_EMBEDDING_DIMENSIONS).fill(NaN))).toBe(false);
        expect(isLearningEmbedding([...embedding().slice(1), '0.1'])).toBe(false);
        expect(isLearningEmbedding(undefined)).toBe(false);
    });

    it('matches on the episode below the threshold and ignores a mere neighbour', async () => {
        expect(await run([peer({ distance: LEARNING_DUPLICATE_DISTANCE - 0.01 })]))
            .toEqual([expect.objectContaining({ exampleId: 'peer-1', matchedBy: ['episode'] })]);
        expect(await run([peer({ distance: LEARNING_DUPLICATE_DISTANCE + 0.01 })])).toEqual([]);
        // Exactly at the threshold is not below it.
        expect(await run([peer({ distance: LEARNING_DUPLICATE_DISTANCE })])).toEqual([]);
    });

    it('also matches the sentence a release would actually carry, from a neighbouring episode', async () => {
        const [match] = await run([peer({ response_pattern: PATTERN, distance: LEARNING_DUPLICATE_NEIGHBOURHOOD - 0.05 })]);
        expect(match).toMatchObject({ matchedBy: ['pattern'], patternSimilarity: 1 });
        expect(match.distance).toBeGreaterThan(LEARNING_DUPLICATE_DISTANCE);
    });

    it('reports the peer status so a reviewer knows they are being asked to disagree with an approval', async () => {
        const [match] = await run([peer({ status: 'approved', distance: 0.02 })]);
        expect(match.heldStatus).toBe('approved');
    });

    it('bounds what a single conflict can record', async () => {
        const rows = Array.from({ length: 25 }, (_, index) => peer({ example_id: `peer-${index}`, distance: 0.01 }));
        expect(await run(rows)).toHaveLength(10);
    });
});

describe('what a dedup outcome says about itself', () => {
    const record = (over: Parameters<typeof learningDedupRecord>[0]) => learningDedupRecord(over);

    it('is clear only when the comparison actually ran and found nothing', () => {
        expect(record({ comparable: true, crossSplit: false, duplicates: [] })).toMatchObject({ status: 'clear' });
    });

    it('stays pending when nothing could be compared, whatever else is true', () => {
        // `pending` blocks the release. `clear` would be a claim about a
        // comparison that never happened.
        expect(record({ comparable: false, crossSplit: false, duplicates: [] }))
            .toMatchObject({ status: 'pending', reason: 'embedding_unavailable' });
    });

    it('records the precedence and the thresholds it applied, so the row explains itself', () => {
        const outcome = record({ comparable: true, crossSplit: false,
            duplicates: [{ exampleId: 'peer-1', heldStatus: 'approved', distance: 0.02, patternSimilarity: 1, matchedBy: ['episode'] }] });
        expect(outcome).toMatchObject({ status: 'conflict', precedence: 'existing_example_keeps_its_review',
            thresholds: { distance: LEARNING_DUPLICATE_DISTANCE } });
        expect((outcome as any).duplicates[0].exampleId).toBe('peer-1');
    });

    it('says a cross-split overlap happened without saying what it was', () => {
        const outcome = record({ comparable: true, crossSplit: true, duplicates: [] });
        // Its neighbours are holdout rows, and this record is read by the train side.
        expect(outcome).toMatchObject({ status: 'conflict', crossSplitOverlap: true, duplicates: [] });
    });
});

describe('reading a review history back', () => {
    const routes = (controller: any) => Object.getOwnPropertyNames(controller.prototype)
        .filter(name => name !== 'constructor')
        .map(name => [Reflect.getMetadata(METHOD_METADATA, controller.prototype[name]),
            Reflect.getMetadata(PATH_METADATA, controller.prototype[name])] as const)
        .filter(([method]) => method !== undefined);

    it('declares the history route where nothing can swallow it', () => {
        // Nest matches in declaration order, so a `:param` GET declared earlier
        // would answer this path with a lookup for something else.
        const declared = routes(LearningController);
        const index = declared.findIndex(([method, path]) =>
            method === RequestMethod.GET && path === 'examples/:exampleId/reviews');
        expect(index).toBeGreaterThanOrEqual(0);
        expect(declared.slice(0, index).some(([, path]) => typeof path === 'string' && path.startsWith(':'))).toBe(false);
        // Claimed exactly once: two handlers on one path is a coin toss.
        expect(declared.filter(([method, path]) =>
            method === RequestMethod.GET && path === 'examples/:exampleId/reviews')).toHaveLength(1);
    });

    it('passes a caller limit through and lets the service bound it', () => {
        const reviewHistory = jest.fn(async () => ({ history: [] }));
        const controller = new LearningController({ reviewHistory } as any, { auditLog: { create: jest.fn() } } as any);
        return Promise.all([
            controller.reviews('tenant-1', 'agent-1', 'example-1', '25'),
            controller.reviews('tenant-1', 'agent-1', 'example-1'),
            controller.reviews('tenant-1', 'agent-1', 'example-1', 'not-a-number'),
        ]).then(results => {
            expect(results[0]).toEqual({ success: true, data: { history: [] } });
            expect(reviewHistory.mock.calls.map((call: any[]) => call[3])).toEqual([25, NaN, NaN]);
        });
    });
});
