import { LEARNING_DIMENSIONS } from './learning-contracts';
import {
    LEARNING_CALIBRATION_MIN_SAMPLES, judgePassedSnapshot, learningJudgeCalibration,
} from './learning-judge-calibration';

/**
 * What the calibration is allowed to claim.
 *
 * The judge is a gate, not a second opinion: `review` refuses an approval whose
 * scores fall below the threshold, so a person cannot approve what the judge
 * failed. One cell of the confusion matrix therefore cannot exist, and a report
 * that quietly computed precision and recall over the other three would be a
 * number with half its denominator missing.
 */
describe('what the judge and the reviewers actually agree about', () => {
    const passing = () => Object.fromEntries(LEARNING_DIMENSIONS.map(d => [d, 4]));
    const failing = () => ({ ...passing(), accuracy: 1 });

    const review = (decision: 'approved' | 'rejected', scores: Record<string, number>, exclusions: string[] = []) =>
        ({ decision, snapshot: { analysis: { scores, exclusions } } });

    const run = (rows: any[], limit?: number) =>
        learningJudgeCalibration((async () => rows) as any, 'agent-1', limit ? { limit } : {});

    it('applies the same threshold the review gate applies', () => {
        expect(judgePassedSnapshot({ scores: passing(), exclusions: [] })).toBe(true);
        expect(judgePassedSnapshot({ scores: failing(), exclusions: [] })).toBe(false);
        // Brevity is the one dimension allowed to sit at 2, and an exclusion
        // fails the example whatever the scores say.
        expect(judgePassedSnapshot({ scores: { ...passing(), brevity: 2 }, exclusions: [] })).toBe(true);
        expect(judgePassedSnapshot({ scores: { ...passing(), brevity: 1 }, exclusions: [] })).toBe(false);
        expect(judgePassedSnapshot({ scores: passing(), exclusions: ['unverified_claim'] })).toBe(false);
        expect(judgePassedSnapshot(null)).toBe(false);
    });

    it('counts only the decisions the judge had passed as informative', async () => {
        const result = await run([
            ...Array(3).fill(review('approved', passing())),
            ...Array(2).fill(review('rejected', passing())),
            ...Array(5).fill(review('rejected', failing())),
        ]);
        expect(result.samples).toBe(10);
        // The five the judge failed agree by construction: the person had no
        // other option, so they say nothing about the judge.
        expect(result.observableSamples).toBe(5);
        expect(result.cells).toEqual(expect.arrayContaining([
            { judgePassed: true, decision: 'approved', count: 3 },
            { judgePassed: true, decision: 'rejected', count: 2 },
            { judgePassed: false, decision: 'rejected', count: 5 },
            { judgePassed: false, decision: 'approved', count: 0 },
        ]));
    });

    it('refuses to state a rate the sample cannot carry', async () => {
        const few = await run([...Array(4).fill(review('approved', passing())),
            review('rejected', passing())]);
        // A rate over five decisions is noise dressed as a measurement.
        expect(few.observableSamples).toBe(5);
        expect(few.overrideRate).toBeNull();

        const enough = await run([
            ...Array(LEARNING_CALIBRATION_MIN_SAMPLES - 5).fill(review('approved', passing())),
            ...Array(5).fill(review('rejected', passing())),
        ]);
        expect(enough.observableSamples).toBe(LEARNING_CALIBRATION_MIN_SAMPLES);
        expect(enough.overrideRate).toBe(0.25);
    });

    it('always says which question it cannot answer', async () => {
        const result = await run([review('approved', passing())]);
        // The one a reader would otherwise assume was measured: how much good
        // material the threshold throws away. It cannot be, because the product
        // does not let a person approve past the gate.
        expect(result.unobservable).toContain('judge_rejections_cannot_be_challenged');
    });

    it('shows which dimension the person is reacting to and the judge is not', async () => {
        const result = await run([
            ...Array(3).fill(review('approved', { ...passing(), empathy: 4 })),
            ...Array(3).fill(review('rejected', { ...passing(), empathy: 3 })),
        ]);
        const empathy = result.separation.find(entry => entry.dimension === 'empathy')!;
        expect(empathy).toMatchObject({ approvedMean: 4, rejectedMean: 3 });
        // A dimension nobody separated on reads the same either way, which is
        // itself the answer.
        const clarity = result.separation.find(entry => entry.dimension === 'clarity')!;
        expect(clarity.approvedMean).toBe(clarity.rejectedMean);
    });

    it('reports a bypassed gate as a defect rather than as evidence about the judge', async () => {
        // A person cannot approve what the judge failed. If a row says they did,
        // something skipped the gate — that is a bug to go and find, not a data
        // point saying the judge is strict.
        const result = await run([review('approved', failing())]);
        expect(result.gateBypassed).toBe(1);
        expect(result.observableSamples).toBe(0);
        expect(result.overrideRate).toBeNull();
    });

    it('ignores a decision with no judgement beside it', async () => {
        const result = await run([{ decision: 'approved', snapshot: {} },
            { decision: 'rejected', snapshot: { analysis: {} } }, review('approved', passing())]);
        // A review recorded before the snapshot carried an analysis is not a
        // disagreement; it is an absence.
        expect(result.samples).toBe(1);
    });

    it('bounds what it reads', async () => {
        const query = jest.fn(async (_sql: string, _params?: any[]) => [] as any[]);
        await learningJudgeCalibration(query as any, 'agent-1', { limit: 99999 });
        expect(query.mock.calls[0][1]).toEqual(['agent-1', 5000]);
        await learningJudgeCalibration(query as any, 'agent-1', { limit: 0 });
        expect(query.mock.calls[1][1]).toEqual(['agent-1', 1000]);
    });
});
