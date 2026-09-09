import { LEARNING_DIMENSIONS, type LearningDimension } from './learning-contracts';
import type { LearningSourceQuery } from './learning-inbox-source';

/**
 * How often the judge and the person agree — and the half of that question the
 * product cannot answer.
 *
 * The judge is not a predictor sitting beside a reviewer: it is a GATE. `review`
 * refuses an approval whose scores fall below the threshold (`>= 3`, `>= 2` for
 * brevity) or that carries any exclusion, so a person literally cannot approve
 * an example the judge failed. That makes one cell of the confusion matrix
 * unobservable by construction:
 *
 *   | judge passed | person approved  | agreement, observable
 *   | judge passed | person rejected  | the ONLY disagreement this data can show
 *   | judge failed | person rejected  | agreement, but uninformative — they had no other option
 *   | judge failed | person approved  | IMPOSSIBLE; if it appears the gate was bypassed
 *
 * So a "precision and recall" here would be a number with half its denominator
 * missing, and reporting one would be the exact failure this file exists to
 * avoid. What can be measured is how often a person rejects what the judge was
 * willing to pass, and which dimensions separate those two groups — that says
 * something about the threshold. What cannot be measured is how much good
 * material the threshold throws away, and saying so is part of the result.
 *
 * The scores read are the ones SNAPSHOT at the moment of the decision, not the
 * example's current analysis: a re-analysis after a revision would otherwise be
 * compared against a judgement nobody made.
 */

/** Below this, a rate is noise dressed as a measurement. */
export const LEARNING_CALIBRATION_MIN_SAMPLES = 20;

export interface LearningCalibrationCell {
    readonly judgePassed: boolean;
    readonly decision: 'approved' | 'rejected';
    readonly count: number;
}

export interface LearningJudgeCalibration {
    /** Decisions with a usable judge snapshot beside them. */
    readonly samples: number;
    /** Decisions where the judge had passed the example, the only informative ones. */
    readonly observableSamples: number;
    readonly cells: readonly LearningCalibrationCell[];
    /**
     * Of the examples the judge passed, the share a person rejected anyway.
     * `null` below the sample floor: a rate over four decisions is not a rate.
     */
    readonly overrideRate: number | null;
    /**
     * Per dimension, the mean score the judge gave to what people approved and
     * to what they rejected ANYWAY. A dimension that separates them is one the
     * threshold is reading and the person is not, or the reverse.
     */
    readonly separation: readonly {
        readonly dimension: LearningDimension;
        readonly approvedMean: number | null;
        readonly rejectedMean: number | null;
    }[];
    /**
     * What this report structurally cannot answer, said in the report rather
     * than left for a reader to assume it did.
     */
    readonly unobservable: readonly string[];
    /**
     * Rows where a person approved something the judge had failed. Always zero;
     * a non-zero count is a bypassed gate, not a data point about the judge.
     */
    readonly gateBypassed: number;
}

const mean = (values: number[]): number | null =>
    values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null;

/** The same rule `review` enforces, applied to a snapshot rather than to live state. */
export function judgePassedSnapshot(analysis: any): boolean {
    if (!analysis || !analysis.scores) return false;
    if (Array.isArray(analysis.exclusions) && analysis.exclusions.length) return false;
    return LEARNING_DIMENSIONS.every(dimension => {
        const score = analysis.scores[dimension];
        return Number.isFinite(score) && score >= (dimension === 'brevity' ? 2 : 3);
    });
}

export async function learningJudgeCalibration(query: LearningSourceQuery, agentId: string,
    options: { limit?: number } = {}): Promise<LearningJudgeCalibration> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 1000) || 1000, 1), 5000);
    // Only surviving reviews. A withdrawal or an erasure deletes these rows, so
    // a calibration computed here can never resurrect a decision about material
    // that was retracted — the same rule every other read of this table follows.
    const rows = await query<any[]>(
        `SELECT r.decision, r.snapshot
           FROM learning_reviews r
           JOIN learning_examples e ON e.id = r.example_id
          WHERE e.agent_id = $1::uuid AND r.decision IN ('approved','rejected')
          ORDER BY r.created_at DESC
          LIMIT $2::int`, [agentId, limit]);

    const counts = new Map<string, number>();
    const scores: Record<string, { approved: number[]; rejected: number[] }> = Object.fromEntries(
        LEARNING_DIMENSIONS.map(dimension => [dimension, { approved: [], rejected: [] }]));
    let samples = 0, observable = 0, bypassed = 0;

    for (const row of rows) {
        const analysis = (row.snapshot as any)?.analysis;
        if (!analysis?.scores) continue;
        samples += 1;
        const passed = judgePassedSnapshot(analysis);
        const decision = row.decision as 'approved' | 'rejected';
        counts.set(`${passed}:${decision}`, (counts.get(`${passed}:${decision}`) ?? 0) + 1);
        if (!passed && decision === 'approved') bypassed += 1;
        if (!passed) continue;
        observable += 1;
        for (const dimension of LEARNING_DIMENSIONS) {
            const score = analysis.scores[dimension];
            if (Number.isFinite(score)) scores[dimension][decision].push(Number(score));
        }
    }

    const overrides = counts.get('true:rejected') ?? 0;
    return {
        samples,
        observableSamples: observable,
        cells: Object.freeze([true, false].flatMap(passed =>
            (['approved', 'rejected'] as const).map(decision => Object.freeze({
                judgePassed: passed, decision, count: counts.get(`${passed}:${decision}`) ?? 0,
            })))),
        // Never a number the sample cannot carry, and never rounded into looking
        // more precise than it is.
        overrideRate: observable >= LEARNING_CALIBRATION_MIN_SAMPLES
            ? Math.round((overrides / observable) * 1000) / 1000 : null,
        separation: Object.freeze(LEARNING_DIMENSIONS.map(dimension => Object.freeze({
            dimension,
            approvedMean: mean(scores[dimension].approved),
            rejectedMean: mean(scores[dimension].rejected),
        }))),
        unobservable: Object.freeze([
            // The one a reader would otherwise assume is in here.
            'judge_rejections_cannot_be_challenged',
        ]),
        gateBypassed: bypassed,
    };
}
