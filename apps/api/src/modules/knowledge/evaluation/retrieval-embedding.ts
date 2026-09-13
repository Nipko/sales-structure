/**
 * A stand-in embedding, so the pipeline can be measured without buying a model.
 *
 * ── What this is, said plainly ──────────────────────────────────────────────
 *
 * This is NOT `text-embedding-3-small`. It is a signed feature-hashing vector
 * over normalised unigrams and bigrams: cosine between two of these behaves
 * like weighted lexical overlap, not like meaning. A question phrased entirely
 * in words the passage does not use will score near zero here and may well
 * score high with the real model.
 *
 * It exists because the two things it makes possible are worth more than the
 * fidelity it gives up:
 *
 *   · **reproducibility.** The same text always produces the same vector, on
 *     any machine, forever. A retrieval number taken against a hosted model is
 *     not a number you can compare to last month's — the model moves, and the
 *     comparison quietly stops meaning anything;
 *   · **cost.** The full suite runs locally, offline, for nothing, which is the
 *     difference between a metric that runs on every change and one that runs
 *     when somebody remembers to pay for it.
 *
 * ── What it can and cannot measure ──────────────────────────────────────────
 *
 * With this vector the run still exercises, for real: the hybrid SQL, the RRF
 * fusion, the similarity threshold, the jurisdiction/audience/agent gates, the
 * language filter, the retired-document exclusion, abstention, leakage, and
 * every latency number under concurrency. Those are properties of the PIPELINE
 * and they do not depend on which model produced the vector.
 *
 * What it cannot measure is semantic recall — whether the real model finds a
 * passage that shares no words with the question. That is a property of the
 * MODEL, it needs the real one, and the report says `embeddingModel:
 * 'deterministic_lexical'` on every line so nobody reads a pipeline number as a
 * model number.
 */

export const DETERMINISTIC_EMBEDDING_ID = 'deterministic_lexical';
export const EMBEDDING_DIMENSIONS = 1536;

/** Lowercase, unaccented, punctuation-free tokens. Empty for empty input. */
export function embeddingTokens(text: string): string[] {
    return (text ?? '')
        .normalize('NFD')
        // Combining marks: "garantía" and "garantia" have to be the same token,
        // or every accented language scores worse than English for a reason
        // that has nothing to do with retrieval.
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/** FNV-1a, 32 bits. Small, stable, and not a cryptographic claim. */
function fnv1a(value: string, seed = 0x811c9dc5): number {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/**
 * The vector.
 *
 * Bigrams as well as unigrams, because word order is most of what separates
 * "no se aceptan mascotas" from "se aceptan mascotas" and a bag of unigrams
 * cannot tell them apart at all — which would make every negation case in the
 * dataset unmeasurable.
 *
 * The sign comes from a second hash bit, so two features colliding on the same
 * dimension cancel as often as they reinforce instead of always inflating it.
 *
 * Term weight is `1 + ln(tf)`, not raw count: a passage that says "cancelación"
 * six times is more about cancellation than one that says it once, but not six
 * times more. There is deliberately no IDF — it would make a vector depend on
 * the corpus it was indexed with, and the corpus grows by design when the same
 * cases are measured at several sizes.
 */
export function deterministicEmbedding(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
    if (!Number.isInteger(dimensions) || dimensions < 8) throw new Error('embedding_dimensions_invalid');
    const tokens = embeddingTokens(text);
    const features = new Map<string, number>();
    const add = (feature: string) => features.set(feature, (features.get(feature) ?? 0) + 1);
    for (let index = 0; index < tokens.length; index += 1) {
        add(tokens[index]);
        if (index + 1 < tokens.length) add(`${tokens[index]}_${tokens[index + 1]}`);
    }
    const vector = new Array<number>(dimensions).fill(0);
    for (const [feature, count] of features) {
        const slot = fnv1a(feature) % dimensions;
        const sign = (fnv1a(feature, 0x9e3779b1) & 1) === 0 ? 1 : -1;
        vector[slot] += sign * (1 + Math.log(count));
    }
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    if (!norm) {
        // An all-zero vector has no direction, and pgvector's cosine distance is
        // undefined for one. A fixed unit vector keeps the query answerable and
        // simply matches nothing in particular, which is the honest behaviour
        // for a question made entirely of punctuation.
        vector[0] = 1;
        return vector;
    }
    return vector.map(value => value / norm);
}

/** The literal pgvector accepts, without a round trip through the driver. */
export const embeddingLiteral = (vector: readonly number[]): string =>
    `[${vector.map(value => (Object.is(value, -0) ? 0 : value)).join(',')}]`;
