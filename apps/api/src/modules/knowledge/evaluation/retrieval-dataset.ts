/**
 * A labelled corpus for measuring what retrieval actually returns.
 *
 * Everything this repository knows about its own RAG today is observational:
 * `kb_retrieval_log` records that a chunk scored above a threshold, and
 * `knowledge-attribution.ts` records whether the reply looked like it used one.
 * Both refuse to claim correctness, and they are right to — a score is not a
 * relevant answer and a literal overlap is not entailment. But that leaves the
 * question nobody could answer: when a customer asks something, does the right
 * passage come back, and does the wrong one stay out?
 *
 * You cannot measure that without saying, in advance and in writing, which
 * passage is the right one. That is what this file is: a corpus, and a set of
 * questions with the answer marked.
 *
 * ── Why it is stratified rather than a list of easy questions ────────────────
 *
 * A retrieval suite made of paraphrases scores well and proves nothing, because
 * the failures that matter in production are not "the obvious question missed
 * the obvious paragraph". They are:
 *
 *   · **ambiguity** — a word that means two things in the same corpus, where
 *     picking either one confidently is worse than asking;
 *   · **negation** — "what is NOT covered", where the passage that answers it
 *     shares almost every word with the passage that contradicts it;
 *   · **conflict** — two documents that disagree, where returning one without
 *     the other turns a contradiction into a confident wrong answer;
 *   · **temporality** — a rule that expired and a rule that replaced it, where
 *     the expired one is still the better lexical match;
 *   · **retired** — a document that was withdrawn, which must never come back;
 *   · **no_answer** — a question the corpus genuinely does not answer, where
 *     the only correct behaviour is to retrieve nothing above threshold.
 *
 * Each of those is a separate column in the report, because they fail for
 * different reasons and averaging them hides which one broke.
 *
 * ── What a case declares ────────────────────────────────────────────────────
 *
 *   · `relevant` — the chunks that answer it. Recall@k and MRR are computed
 *     against exactly this set and nothing else;
 *   · `forbidden` — the chunks that must NOT come back: a retired document, a
 *     norm from another jurisdiction, an internal note in a customer-facing
 *     answer. A hit here is a LEAK, and a leak is not a low score — it is a
 *     different failure, counted separately and never averaged into recall;
 *   · `expected` — either the answer with the citations authorised for it, or
 *     an explicit abstention. An abstention case whose corpus later grows an
 *     answer is a dataset bug, so the case says why it abstains.
 *
 * ── Versioned, and hashed ───────────────────────────────────────────────────
 *
 * `datasetRevision()` hashes the corpus and the cases together. A metric is
 * only comparable to another metric taken over the same dataset; publishing a
 * number without saying which revision produced it is how a threshold quietly
 * stops meaning anything. Every report carries the revision.
 */

import { createHash } from 'crypto';

export const RETRIEVAL_DATASET_VERSION = 1;

export const RETRIEVAL_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;
export type RetrievalLanguage = (typeof RETRIEVAL_LANGUAGES)[number];

/** The vertical the case belongs to; matches the profile vocabulary elsewhere. */
export const RETRIEVAL_VERTICALS = ['turismo', 'salud', 'servicios'] as const;
export type RetrievalVertical = (typeof RETRIEVAL_VERTICALS)[number];

/** What kind of source the answer lives in. Regulated sources are gated. */
export const RETRIEVAL_SOURCE_KINDS = ['own_copy', 'regulated', 'faq', 'policy'] as const;
export type RetrievalSourceKind = (typeof RETRIEVAL_SOURCE_KINDS)[number];

/** The thing each case is built to break. One per case, never a mixture. */
export const RETRIEVAL_CHALLENGES = [
    'plain', 'ambiguity', 'negation', 'conflict', 'temporality', 'retired', 'no_answer',
] as const;
export type RetrievalChallenge = (typeof RETRIEVAL_CHALLENGES)[number];

export interface RetrievalChunk {
    /** Stable across revisions; this is what a case's `relevant` list names. */
    readonly id: string;
    readonly text: string;
}

export interface RetrievalDocument {
    readonly id: string;
    readonly title: string;
    readonly language: RetrievalLanguage;
    readonly vertical: RetrievalVertical;
    readonly kind: RetrievalSourceKind;
    /** `ready` is retrievable; `retired` must never come back. */
    readonly status: 'ready' | 'retired';
    readonly isRegulated?: boolean;
    readonly jurisdiction?: string | null;
    readonly authority?: string | null;
    readonly validFrom?: string | null;
    readonly validTo?: string | null;
    readonly audience?: 'customer' | 'internal';
    readonly chunks: readonly RetrievalChunk[];
    /** Why this document is in the corpus. Not decoration: it is what a reader checks the labels against. */
    readonly rationale: string;
}

export type RetrievalExpectation =
    | {
        readonly kind: 'answer';
        /** Chunks the answer may cite. A citation outside this set is a wrong citation. */
        readonly authorisedCitations: readonly string[];
        /** Substrings the supporting passage must contain, for lexical grounding. */
        readonly support: readonly string[];
    }
    | {
        readonly kind: 'abstain';
        /** Why the corpus cannot answer it. Checked by a dataset test, not by prose. */
        readonly because: string;
    };

export interface RetrievalCase {
    readonly id: string;
    readonly language: RetrievalLanguage;
    readonly vertical: RetrievalVertical;
    readonly kind: RetrievalSourceKind;
    readonly challenge: RetrievalChallenge;
    readonly query: string;
    /** Ground truth for recall@k and MRR. Empty only for `no_answer`. */
    readonly relevant: readonly string[];
    /** A hit on any of these is a leak, counted apart from a miss. */
    readonly forbidden: readonly string[];
    readonly expected: RetrievalExpectation;
    /** Scope the retrieval runs under, when the case is about a gate. */
    readonly scope?: {
        readonly jurisdiction?: string;
        readonly audience?: 'customer' | 'internal';
        readonly agentId?: string;
    };
    readonly rationale: string;
}

// ─── The corpus ─────────────────────────────────────────────────────────────
//
// Small on purpose. Every document here exists to make one labelled case
// answerable or one labelled case a trap, and a corpus nobody can read is a
// corpus nobody can check. Size is added by the distractor generator below,
// which is how the same labels get measured at several corpus sizes.

const doc = (row: RetrievalDocument): RetrievalDocument => Object.freeze({
    ...row, chunks: Object.freeze(row.chunks.map(chunk => Object.freeze(chunk))),
});

export const RETRIEVAL_CORPUS: readonly RetrievalDocument[] = Object.freeze([
    // ── es · turismo ────────────────────────────────────────────────────────
    doc({
        id: 'es-cancel-current', title: 'Política de cancelación (vigente)',
        language: 'es', vertical: 'turismo', kind: 'policy', status: 'ready',
        validFrom: '2026-01-01', validTo: null,
        chunks: [
            { id: 'es-cancel-current-0', text: 'Cancelás sin costo hasta 48 horas antes del check-in. Dentro de las 48 horas se cobra la primera noche.' },
            { id: 'es-cancel-current-1', text: 'La devolución se acredita en el mismo medio de pago dentro de los 10 días hábiles.' },
        ],
        rationale: 'The plain case, and the current half of the temporality pair.',
    }),
    doc({
        id: 'es-cancel-expired', title: 'Política de cancelación (hasta 2025)',
        language: 'es', vertical: 'turismo', kind: 'policy', status: 'ready',
        validFrom: '2024-01-01', validTo: '2025-12-31',
        chunks: [
            { id: 'es-cancel-expired-0', text: 'Cancelás sin costo hasta 24 horas antes del check-in. Dentro de las 24 horas se cobra la primera noche.' },
        ],
        rationale: 'The expired half. It is the better lexical match for "24 horas" and must lose to the current one.',
    }),
    doc({
        id: 'es-pets', title: 'Mascotas',
        language: 'es', vertical: 'turismo', kind: 'faq', status: 'ready',
        chunks: [
            { id: 'es-pets-0', text: 'No se aceptan mascotas en las habitaciones. Sí se aceptan en las áreas comunes al aire libre, con correa.' },
        ],
        rationale: 'Negation: the answer to "can I bring my dog to the room" is the sentence that says no.',
    }),
    doc({
        id: 'es-suite-ambiguous', title: 'Suite',
        language: 'es', vertical: 'turismo', kind: 'own_copy', status: 'ready',
        chunks: [
            { id: 'es-suite-ambiguous-0', text: 'La Suite Jardín es una habitación de 40 m² con vista al parque.' },
            { id: 'es-suite-ambiguous-1', text: 'La Suite Ejecutiva es una sala de reuniones para 12 personas con proyector.' },
        ],
        rationale: 'Ambiguity: "la suite" names two different things and both chunks are relevant.',
    }),
    doc({
        id: 'es-retired-promo', title: 'Promoción 2x1 (retirada)',
        language: 'es', vertical: 'turismo', kind: 'own_copy', status: 'retired',
        chunks: [
            { id: 'es-retired-promo-0', text: 'Promoción 2x1 en todas las habitaciones: pagás una noche y te llevás dos.' },
        ],
        rationale: 'Retired. It answers a question beautifully and must never come back — a leak here is a promise the business withdrew.',
    }),
    doc({
        id: 'es-internal-margin', title: 'Márgenes por habitación (interno)',
        language: 'es', vertical: 'turismo', kind: 'own_copy', status: 'ready',
        audience: 'internal',
        chunks: [
            { id: 'es-internal-margin-0', text: 'Margen bruto por habitación: Jardín 62%, Ejecutiva 48%. No comunicar al huésped.' },
        ],
        rationale: 'Internal audience. A customer-facing retrieval that returns this has leaked the tenant\'s own numbers.',
    }),

    // ── en · salud ──────────────────────────────────────────────────────────
    doc({
        id: 'en-fasting', title: 'Blood test preparation',
        language: 'en', vertical: 'salud', kind: 'faq', status: 'ready',
        chunks: [
            { id: 'en-fasting-0', text: 'Fast for eight hours before a lipid panel. Water is allowed; coffee, even black, is not.' },
        ],
        rationale: 'Plain, plus a negation trap inside the same sentence ("water yes, coffee no").',
    }),
    doc({
        id: 'en-refund-a', title: 'Missed appointment fee',
        language: 'en', vertical: 'salud', kind: 'policy', status: 'ready',
        chunks: [
            { id: 'en-refund-a-0', text: 'A missed appointment is charged at 50% of the consultation fee.' },
        ],
        rationale: 'Conflict pair, side A: the fee exists. Its twin says the opposite, and both are current.',
    }),
    doc({
        id: 'en-refund-b', title: 'Patient handbook — cancellations',
        language: 'en', vertical: 'salud', kind: 'own_copy', status: 'ready',
        chunks: [
            { id: 'en-refund-b-0', text: 'A missed appointment is never charged. The slot is simply released.' },
        ],
        rationale: 'Conflict pair, side B: the fee does not exist. Returning one side without the other turns a '
            + 'contradiction into a confident wrong answer.',
    }),
    doc({
        id: 'en-hipaa', title: 'Records retention (US)',
        language: 'en', vertical: 'salud', kind: 'regulated', status: 'ready',
        isRegulated: true, jurisdiction: 'US', authority: 'HHS', validFrom: '2024-01-01',
        chunks: [
            { id: 'en-hipaa-0', text: 'Patient records are retained for six years from the date of creation.' },
        ],
        rationale: 'Regulated and jurisdiction-gated: correct for a US tenant, a leak for any other.',
    }),

    // ── pt · servicios ──────────────────────────────────────────────────────
    doc({
        id: 'pt-warranty', title: 'Garantia do reparo',
        language: 'pt', vertical: 'servicios', kind: 'policy', status: 'ready',
        chunks: [
            { id: 'pt-warranty-0', text: 'O reparo tem garantia de 90 dias para o mesmo defeito. Peças trocadas pelo cliente não têm garantia.' },
        ],
        rationale: 'Plain, with a negation clause in the second sentence.',
    }),
    doc({
        id: 'pt-hours', title: 'Horário de atendimento',
        language: 'pt', vertical: 'servicios', kind: 'faq', status: 'ready',
        chunks: [
            { id: 'pt-hours-0', text: 'Atendemos de segunda a sexta, das 9h às 18h. Não abrimos aos sábados.' },
        ],
        rationale: 'Plain in Portuguese, so the language column has more than one row that can pass.',
    }),

    // ── fr · servicios ──────────────────────────────────────────────────────
    doc({
        id: 'fr-delivery', title: 'Délais de livraison',
        language: 'fr', vertical: 'servicios', kind: 'faq', status: 'ready',
        chunks: [
            { id: 'fr-delivery-0', text: 'La livraison prend trois à cinq jours ouvrés. Nous ne livrons pas le dimanche.' },
        ],
        rationale: 'Plain in French, with the negation in the second sentence.',
    }),
    doc({
        id: 'fr-gdpr', title: 'Conservation des données (UE)',
        language: 'fr', vertical: 'servicios', kind: 'regulated', status: 'ready',
        isRegulated: true, jurisdiction: 'FR', authority: 'CNIL', validFrom: '2024-05-25',
        chunks: [
            { id: 'fr-gdpr-0', text: 'Les données du client sont conservées trois ans après le dernier contact, puis supprimées.' },
        ],
        rationale: 'Regulated, French jurisdiction. The mirror of the US one, so the gate is tested in both directions.',
    }),
]);

// ─── The cases ──────────────────────────────────────────────────────────────

const testCase = (row: RetrievalCase): RetrievalCase => Object.freeze({
    ...row,
    relevant: Object.freeze([...row.relevant]),
    forbidden: Object.freeze([...row.forbidden]),
    expected: Object.freeze(row.expected.kind === 'answer'
        ? { ...row.expected, authorisedCitations: Object.freeze([...row.expected.authorisedCitations]),
            support: Object.freeze([...row.expected.support]) }
        : { ...row.expected }) as RetrievalExpectation,
    scope: row.scope ? Object.freeze({ ...row.scope }) : undefined,
});

export const RETRIEVAL_CASES: readonly RetrievalCase[] = Object.freeze([
    testCase({
        id: 'es-plain-cancel', language: 'es', vertical: 'turismo', kind: 'policy', challenge: 'plain',
        query: '¿Hasta cuándo puedo cancelar sin que me cobren?',
        relevant: ['es-cancel-current-0'],
        forbidden: ['es-retired-promo-0', 'es-internal-margin-0'],
        expected: { kind: 'answer', authorisedCitations: ['es-cancel-current-0'], support: ['48 horas'] },
        rationale: 'The floor. If this fails nothing below is worth reading.',
    }),
    testCase({
        id: 'es-temporality-cancel', language: 'es', vertical: 'turismo', kind: 'policy', challenge: 'temporality',
        query: '¿Cuál es la política de cancelación vigente hoy?',
        // Both sentences of the current policy answer it: the window and what
        // happens to the money. Authorising a citation the case does not also
        // call relevant is how citation precision stays perfect on a wrong answer.
        relevant: ['es-cancel-current-0', 'es-cancel-current-1'],
        forbidden: ['es-cancel-expired-0'],
        expected: { kind: 'answer', authorisedCitations: ['es-cancel-current-0', 'es-cancel-current-1'], support: ['48 horas'] },
        rationale: 'The expired policy is the better lexical match for the word "cancelación" and has to lose.',
    }),
    testCase({
        id: 'es-negation-pets', language: 'es', vertical: 'turismo', kind: 'faq', challenge: 'negation',
        query: '¿Puedo llevar mi perro a la habitación?',
        relevant: ['es-pets-0'],
        forbidden: ['es-internal-margin-0'],
        expected: { kind: 'answer', authorisedCitations: ['es-pets-0'], support: ['No se aceptan mascotas'] },
        rationale: 'The answer is the sentence that says no. A retriever that only matches "mascotas" finds it; one that matches sentiment does not.',
    }),
    testCase({
        id: 'es-ambiguity-suite', language: 'es', vertical: 'turismo', kind: 'own_copy', challenge: 'ambiguity',
        query: '¿Qué tamaño tiene la suite?',
        relevant: ['es-suite-ambiguous-0', 'es-suite-ambiguous-1'],
        forbidden: ['es-retired-promo-0'],
        expected: { kind: 'answer', authorisedCitations: ['es-suite-ambiguous-0', 'es-suite-ambiguous-1'], support: ['Suite'] },
        rationale: 'Both readings are relevant. Retrieving one and calling it the answer is the failure being measured.',
    }),
    testCase({
        id: 'es-retired-promo', language: 'es', vertical: 'turismo', kind: 'own_copy', challenge: 'retired',
        query: '¿Sigue el 2x1 en habitaciones?',
        relevant: [],
        forbidden: ['es-retired-promo-0'],
        expected: { kind: 'abstain', because: 'the only document that answers it was withdrawn, and a withdrawn promise must not be re-offered' },
        rationale: 'The strongest lexical match in the corpus is the one that must not come back.',
    }),
    testCase({
        id: 'es-internal-leak', language: 'es', vertical: 'turismo', kind: 'own_copy', challenge: 'retired',
        query: '¿Cuál es el margen de la habitación Jardín?',
        relevant: [],
        forbidden: ['es-internal-margin-0'],
        expected: { kind: 'abstain', because: 'the answer exists but is internal, and this retrieval is customer-facing' },
        rationale: 'An audience gate failure is a leak of the tenant\'s own numbers to their customer.',
        scope: { audience: 'customer' },
    }),
    testCase({
        id: 'es-no-answer-parking', language: 'es', vertical: 'turismo', kind: 'faq', challenge: 'no_answer',
        query: '¿Tienen estacionamiento para motos?',
        relevant: [],
        forbidden: [],
        expected: { kind: 'abstain', because: 'no document in the corpus mentions parking at all' },
        rationale: 'Silence is the correct answer, and a retriever with a low threshold will not give it.',
    }),
    testCase({
        id: 'en-plain-fasting', language: 'en', vertical: 'salud', kind: 'faq', challenge: 'plain',
        query: 'How long do I need to fast before a cholesterol test?',
        relevant: ['en-fasting-0'],
        forbidden: [],
        expected: { kind: 'answer', authorisedCitations: ['en-fasting-0'], support: ['eight hours'] },
        rationale: 'Vocabulary mismatch on purpose: the corpus says "lipid panel", the customer says "cholesterol test".',
    }),
    testCase({
        id: 'en-negation-coffee', language: 'en', vertical: 'salud', kind: 'faq', challenge: 'negation',
        query: 'Can I have black coffee before the blood test?',
        relevant: ['en-fasting-0'],
        forbidden: [],
        expected: { kind: 'answer', authorisedCitations: ['en-fasting-0'], support: ['coffee, even black, is not'] },
        rationale: 'The passage that answers it also contains the word that would justify the opposite answer.',
    }),
    testCase({
        id: 'en-conflict-missed', language: 'en', vertical: 'salud', kind: 'policy', challenge: 'conflict',
        query: 'What happens if I miss my appointment?',
        relevant: ['en-refund-a-0', 'en-refund-b-0'],
        forbidden: [],
        expected: { kind: 'answer', authorisedCitations: ['en-refund-a-0', 'en-refund-b-0'], support: ['missed appointment'] },
        rationale: 'Two documents disagree. Both are relevant; returning one alone is what turns a contradiction into a confident wrong answer.',
    }),
    testCase({
        id: 'en-regulated-us', language: 'en', vertical: 'salud', kind: 'regulated', challenge: 'plain',
        query: 'How long are patient records kept?',
        relevant: ['en-hipaa-0'],
        forbidden: ['fr-gdpr-0'],
        expected: { kind: 'answer', authorisedCitations: ['en-hipaa-0'], support: ['six years'] },
        rationale: 'Correct for a US tenant. The French rule answers the same question and must not appear.',
        scope: { jurisdiction: 'US' },
    }),
    testCase({
        id: 'en-regulated-wrong-jurisdiction', language: 'en', vertical: 'salud', kind: 'regulated', challenge: 'retired',
        query: 'How long are patient records kept?',
        relevant: [],
        forbidden: ['en-hipaa-0', 'fr-gdpr-0'],
        expected: { kind: 'abstain', because: 'the tenant operates somewhere neither regulated document applies, and citing a foreign norm as current is its own wrong answer' },
        rationale: 'The same question, a tenant in a third country. Both norms are traps.',
        scope: { jurisdiction: 'CO' },
    }),
    testCase({
        id: 'pt-plain-warranty', language: 'pt', vertical: 'servicios', kind: 'policy', challenge: 'plain',
        query: 'Quanto tempo dura a garantia do conserto?',
        relevant: ['pt-warranty-0'],
        forbidden: [],
        expected: { kind: 'answer', authorisedCitations: ['pt-warranty-0'], support: ['90 dias'] },
        rationale: 'Portuguese, plain, with "conserto" against the corpus\'s "reparo".',
    }),
    testCase({
        id: 'pt-negation-saturday', language: 'pt', vertical: 'servicios', kind: 'faq', challenge: 'negation',
        query: 'Vocês abrem no sábado?',
        relevant: ['pt-hours-0'],
        forbidden: [],
        expected: { kind: 'answer', authorisedCitations: ['pt-hours-0'], support: ['Não abrimos aos sábados'] },
        rationale: 'The answer is a negation and the question is not.',
    }),
    testCase({
        id: 'fr-plain-delivery', language: 'fr', vertical: 'servicios', kind: 'faq', challenge: 'plain',
        query: 'Combien de temps prend la livraison ?',
        relevant: ['fr-delivery-0'],
        forbidden: [],
        expected: { kind: 'answer', authorisedCitations: ['fr-delivery-0'], support: ['trois à cinq jours'] },
        rationale: 'French, plain, and the only French case whose answer is not gated by a jurisdiction: the '
            + 'language column needs a row that can pass on retrieval alone.',
    }),
    testCase({
        id: 'fr-regulated-eu', language: 'fr', vertical: 'servicios', kind: 'regulated', challenge: 'plain',
        query: 'Combien de temps gardez-vous mes données ?',
        relevant: ['fr-gdpr-0'],
        forbidden: ['en-hipaa-0'],
        expected: { kind: 'answer', authorisedCitations: ['fr-gdpr-0'], support: ['trois ans'] },
        rationale: 'The mirror of the US case, so the jurisdiction gate is measured in both directions rather than once.',
        scope: { jurisdiction: 'FR' },
    }),
    testCase({
        id: 'fr-no-answer-warranty', language: 'fr', vertical: 'servicios', kind: 'faq', challenge: 'no_answer',
        query: 'Quelle est la garantie sur les pièces détachées ?',
        relevant: [],
        forbidden: [],
        expected: { kind: 'abstain', because: 'the warranty document exists only in Portuguese and this retrieval is scoped to French' },
        rationale: 'A question the corpus answers in another language. Retrieval that ignores language answers it wrongly and confidently.',
    }),
]);

// ─── Scaling the corpus without moving the labels ───────────────────────────

/**
 * Filler documents, so the same labelled cases can be measured at several
 * corpus sizes.
 *
 * A metric taken over fourteen documents says almost nothing about a tenant
 * with four thousand: recall stays high simply because there is nothing to
 * confuse it with. These are generated, deterministic, and share the corpus's
 * vocabulary on purpose — filler that talks about something else entirely is
 * not a distractor, it is padding, and padding does not move a number.
 *
 * They are never `relevant` and never `forbidden`: they exist to make the
 * retriever choose, not to be chosen.
 */
export function retrievalDistractors(count: number, seed = 1): readonly RetrievalDocument[] {
    if (!Number.isInteger(count) || count < 0) throw new Error('retrieval_distractor_count_invalid');
    const languages = RETRIEVAL_LANGUAGES;
    const themes: Record<RetrievalLanguage, readonly string[]> = {
        es: ['La recepción entrega las llaves a partir de las 15 horas.',
            'El desayuno se sirve de 7 a 10 en el salón principal.',
            'La suite del segundo piso tiene una caja fuerte.'],
        en: ['The waiting room has free wireless internet for patients.',
            'Appointment reminders are sent the day before by message.',
            'Records requested at the front desk are printed the same day.'],
        pt: ['O orçamento do reparo é enviado por mensagem antes de começar.',
            'As peças originais têm um prazo de entrega maior.',
            'O atendimento no feriado depende da escala da equipe.'],
        fr: ['Le suivi de la livraison est envoyé par courriel.',
            'Les pièces sont expédiées depuis notre entrepôt régional.',
            'Le service client répond aux messages en une journée ouvrée.'],
    };
    const out: RetrievalDocument[] = [];
    for (let index = 0; index < count; index += 1) {
        const language = languages[(index + seed) % languages.length];
        const theme = themes[language];
        const text = theme[(index * 7 + seed) % theme.length];
        out.push(doc({
            id: `filler-${seed}-${index}`, title: `Filler ${seed}-${index}`,
            language, vertical: RETRIEVAL_VERTICALS[index % RETRIEVAL_VERTICALS.length],
            kind: 'own_copy', status: 'ready',
            chunks: [{ id: `filler-${seed}-${index}-0`, text: `${text} (${index})` }],
            rationale: 'Generated distractor: shares the corpus vocabulary and answers none of the cases.',
        }));
    }
    return Object.freeze(out);
}

// ─── Identity ───────────────────────────────────────────────────────────────

const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as object).sort()
            .map(key => `${JSON.stringify(key)}:${canonical((value as any)[key])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
};

/**
 * What identifies this dataset.
 *
 * A metric is comparable only to another metric taken over the same labels.
 * Every report carries this, so a threshold that was justified against one
 * dataset cannot silently start being applied to a different one.
 */
export function datasetRevision(
    corpus: readonly RetrievalDocument[] = RETRIEVAL_CORPUS,
    cases: readonly RetrievalCase[] = RETRIEVAL_CASES,
): string {
    return createHash('sha256')
        .update(canonical({ version: RETRIEVAL_DATASET_VERSION, corpus, cases }))
        .digest('hex');
}

/** Every chunk in the corpus, by id. */
export function retrievalChunkIndex(
    corpus: readonly RetrievalDocument[] = RETRIEVAL_CORPUS,
): ReadonlyMap<string, { document: RetrievalDocument; chunk: RetrievalChunk }> {
    const index = new Map<string, { document: RetrievalDocument; chunk: RetrievalChunk }>();
    for (const document of corpus) for (const chunk of document.chunks) index.set(chunk.id, { document, chunk });
    return index;
}

export interface StratumKey {
    readonly language: RetrievalLanguage;
    readonly vertical: RetrievalVertical;
    readonly kind: RetrievalSourceKind;
    readonly challenge: RetrievalChallenge;
}

/** The stratum a case belongs to, as the report groups them. */
export const caseStratum = (row: RetrievalCase): StratumKey => Object.freeze({
    language: row.language, vertical: row.vertical, kind: row.kind, challenge: row.challenge,
});
