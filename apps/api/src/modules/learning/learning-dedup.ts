import { learningTextSimilarity } from './learning-contracts';
import type { LearningSourceQuery } from './learning-inbox-source';

/** `learning_examples.embedding` is `vector(1536)`. Anything else is not comparable. */
export const LEARNING_EMBEDDING_DIMENSIONS = 1536;

/**
 * How close is "the same lesson twice".
 *
 * Cosine distance over the episode embedding that analysis already produced —
 * no second model call, and nothing here reads a word of either episode.
 *
 * The number is a judgement, so here is the reasoning behind this one. The
 * holdout guard next to it refuses at `< 0.12`, and it is asking a different
 * question: "is this the same conversation on both sides of the wall?" — a
 * miss there silently invalidates every evaluation the release will ever run,
 * so it is set where only a near-verbatim pair trips it and the answer is
 * trusted absolutely.
 *
 * This one asks "does this teach what something here already teaches?", and it
 * has the opposite cost shape. A false positive costs one review: the reviewer
 * opens two examples side by side, and if they disagree they reject the older
 * one and re-analyze. A false negative costs a slot in a budget of three, and
 * the slot goes to a second phrasing of a lesson the agent already had. So it
 * sits slightly more sensitive than the holdout guard — but still inside
 * "paraphrase", not "same topic": every booking conversation resembles every
 * other booking conversation, and a threshold up at topic level would leave one
 * releasable example per intent.
 *
 * `NEIGHBOURHOOD` is not a second threshold, it is the candidate window. Rows
 * outside it are not about the same thing, and the whole comparison stays
 * bounded regardless of how many examples an agent accumulates.
 */
export const LEARNING_DUPLICATE_DISTANCE = 0.15;
export const LEARNING_DUPLICATE_NEIGHBOURHOOD = 0.35;
/** The same trigram threshold the import and holdout pattern guards use for "this is the same sentence". */
export const LEARNING_DUPLICATE_PATTERN_SIMILARITY = 0.8;
const CANDIDATES = 50;
const RECORDED = 10;

export interface LearningDuplicate {
    exampleId: string;
    /** The peer's own status, so a reviewer can see they are being asked to disagree with an approval. */
    heldStatus: string;
    distance: number;
    patternSimilarity: number;
    matchedBy: Array<'episode' | 'pattern'>;
}

export function isLearningEmbedding(value: unknown): value is number[] {
    return Array.isArray(value) && value.length === LEARNING_EMBEDDING_DIMENSIONS
        && value.every(component => typeof component === 'number' && Number.isFinite(component));
}

/**
 * Near duplicates of one example among its own split.
 *
 * `s.split=$4` is the whole holdout guarantee here, and it is why this is a
 * separate query from the cross-split one rather than a widened version of it.
 * Like is only ever compared with like, so a train-side analysis never reads a
 * holdout row and can never carry a holdout identifier back into the record a
 * train-side reviewer reads. The two questions also deserve opposite answers:
 * a match across the wall invalidates the evaluation, a match within the split
 * is redundancy for a human to resolve.
 *
 * Retired and rejected peers are excluded deliberately. They can never reach a
 * release, so colliding with one means nothing — and it is what makes the
 * reviewer's disagreement effective: reject the example you like less,
 * re-analyze the other, and the conflict is gone.
 */
export async function learningSplitDuplicates(query: LearningSourceQuery, input: {
    exampleId: string; agentId: string; split: string; embedding: string; responsePattern?: string | null;
}): Promise<LearningDuplicate[]> {
    const rows = await query<any[]>(`SELECT e.id::text AS example_id,e.status,e.response_pattern,
        (e.embedding <=> $3::vector) AS distance
        FROM learning_examples e JOIN learning_sources s ON s.id=e.source_id
        WHERE e.agent_id=$1::uuid AND e.id<>$2::uuid AND e.embedding IS NOT NULL
          AND e.status NOT IN ('rejected','retired')
          AND s.split=$4 AND s.status='active'
          AND (e.embedding <=> $3::vector) < $5::float8
        ORDER BY (e.embedding <=> $3::vector) ASC,e.id ASC LIMIT ${CANDIDATES}`,
        [input.agentId, input.exampleId, input.embedding, input.split, LEARNING_DUPLICATE_NEIGHBOURHOOD]);
    return rows.map(row => {
        const distance = Number(row.distance);
        // The response pattern is what the release actually carries, so two
        // distinct episodes that were reduced to the same sentence are the same
        // redundancy even when their embeddings are further apart. Free here:
        // it reads only rows the vector already called neighbours.
        const patternSimilarity = input.responsePattern && row.response_pattern
            ? learningTextSimilarity(input.responsePattern, row.response_pattern) : 0;
        const matchedBy: Array<'episode' | 'pattern'> = [];
        if (Number.isFinite(distance) && distance < LEARNING_DUPLICATE_DISTANCE) matchedBy.push('episode');
        if (patternSimilarity >= LEARNING_DUPLICATE_PATTERN_SIMILARITY) matchedBy.push('pattern');
        return { exampleId: row.example_id as string, heldStatus: row.status as string,
            distance: Number(distance.toFixed(4)), patternSimilarity: Number(patternSimilarity.toFixed(4)), matchedBy };
    }).filter(match => match.matchedBy.length).slice(0, RECORDED);
}

/**
 * What a conflict says about itself.
 *
 * Identifiers and numbers, never text. A reviewer following this record opens
 * the named example through the same guarded read as any other, so quoting it
 * here would buy nothing — and it would cost the one thing the retraction rules
 * depend on: an erasure blanks the example it retires, and a copy of its words
 * living inside a *second* example's analysis is not reachable by any of the
 * paths that erase.
 *
 * The cross-split outcome is a flag with no detail for the same reason in
 * reverse: its neighbours are holdout rows, and naming them would hand the
 * train side the contents of the wall.
 */
export function learningDedupRecord(input: {
    comparable: boolean; crossSplit: boolean; duplicates: LearningDuplicate[];
}): { status: 'pending' | 'clear' | 'conflict' } & Record<string, unknown> {
    const status = !input.comparable ? 'pending' as const
        : input.crossSplit || input.duplicates.length ? 'conflict' as const : 'clear' as const;
    return {
        status,
        ...(input.comparable ? {} : { reason: 'embedding_unavailable' }),
        thresholds: { distance: LEARNING_DUPLICATE_DISTANCE, patternSimilarity: LEARNING_DUPLICATE_PATTERN_SIMILARITY },
        // Precedence, stored so the record explains itself without the code:
        // whatever is already here keeps its status, and the arrival carries the
        // conflict. An approved peer may already be serving inside a published
        // release, and retiring it to make room for an unreviewed newcomer would
        // change what the live agent says without anyone deciding that.
        precedence: 'existing_example_keeps_its_review',
        crossSplitOverlap: input.crossSplit,
        duplicates: input.duplicates,
        comparedAt: new Date().toISOString(),
    };
}
