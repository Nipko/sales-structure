/**
 * What a withdrawn release does to the evidence that rests on it.
 *
 * Five stores hold the agent's own words as EVIDENCE: evaluation runs,
 * simulation runs, release evaluations, frozen regression cases and the judge's
 * verdicts. Some were reachable by a contact erasure and some explicitly not,
 * and none of them by a retraction — so retiring a release left every
 * certification, gate and regression that depended on it standing, still
 * counting as proof of an agent configured with learning nobody may use any
 * more.
 *
 * Retraction here does not mean deletion, and that distinction is the whole
 * design. A retraction withdraws a RELEASE; it does not unwrite the evaluation
 * that happened. So the row survives with its transcript intact — that
 * evaluation really did run, and pretending otherwise would make the history
 * lie — and it is marked INVALID, which is what stops it certifying anything.
 * The reader filters on the mark; the record keeps the fact.
 *
 * Where the release comes from differs per store, and that is the reason this is
 * a registry rather than five copies of one query:
 *
 *   · an evaluation or simulation run already stores the snapshot it ran, and
 *     the snapshot names the one release it was frozen against. Nothing new is
 *     needed;
 *   · a release evaluation reaches its snapshot through the candidate it
 *     belongs to;
 *   · a frozen regression case and a judge's verdict had no key at all — the
 *     first freezes a real reply with a source contact and no release, the
 *     second judges a conversation by transcript hash — so they get one,
 *     recorded when the row is written.
 *
 * Those last two record a SET, not a single id, and that is not a detail. A run
 * is frozen against one release by construction; a production conversation is
 * not. A judged transcript is many messages of a real conversation that may have
 * crossed two releases, and a regression case freezes evidence from inside such
 * a window. Recording one id there would mean picking one and quietly disowning
 * the other, so the column is an array and the match is an overlap: a verdict is
 * invalid if ANY release that helped produce it was withdrawn, which is the only
 * reading that does not certify on retracted learning.
 *
 * And there are two callers, which want different things from the same match.
 * An operator withdrawing a release is making a decision about what may be USED,
 * so the evidence survives with its transcript and only stops counting. A person
 * erasing themselves is exercising a right, so their words go from everything
 * derived from them and the row survives as nothing but the fact that the run
 * happened. That is the `derivedText` option, and it mirrors `deliveredReplies`
 * in the retirement path deliberately: one distinction, made once, honoured in
 * both places.
 *
 * A row whose provenance was never recorded is NOT invalidated. It cannot be:
 * nothing says which release produced it, and invalidating on suspicion would
 * throw away evidence that may be perfectly sound. `evidenceWithoutProvenance`
 * counts them, so the gap is a number somebody can see rather than a silence.
 */

export type EvidenceQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export interface EvidenceStore {
    /** Matches the id in `agent-output-inventory.ts`, so the two can be compared. */
    readonly id: string;
    readonly table: string;
    /**
     * Every table the two predicates below touch. Checked with `to_regclass`
     * before either runs, because these execute inside the caller's transaction:
     * a query against a relation a tenant does not have aborts every statement
     * after it, and catching the error does not save the COMMIT.
     */
    readonly requires: readonly string[];
    /**
     * Predicate over alias `t`, with `$1::text[]` bound to the withdrawn
     * releases: true when this row rests on one of them.
     */
    readonly releaseMatch: string;
    /** Predicate over alias `t`: true when the row names no release at all. */
    readonly noProvenance: string;
    /** The column this codebase adds to carry provenance, for stores that had none. */
    readonly recordedColumn: { readonly name: string; readonly type: string } | null;
    /**
     * The columns holding text DERIVED from a real conversation — transcripts,
     * the judge's free-text reason, the reply a case froze — and what each one
     * looks like once it holds nothing.
     *
     * Only an erasure clears them, and that asymmetry is the point. Withdrawing
     * a release is an operator decision about what may be used, so the evidence
     * survives, marked. Erasing a person is not: their words go from everything
     * derived from them, and the row survives only as the fact that the run
     * happened. Columns the tenant does not have are skipped, so a store that
     * grew its shape over time cannot abort somebody's erasure.
     *
     * The empty value is stated rather than inferred, because the tables do not
     * agree on it: `proposal` is NOT NULL with no default, so `DEFAULT` there
     * would violate the constraint and roll back the erasure. `'{}'` is what a
     * reader of that column already expects to find nothing in.
     */
    readonly derivedText: readonly DerivedTextColumn[];
}

export interface DerivedTextColumn {
    readonly column: string;
    /** A SQL literal. Constants of this file; nothing from a caller reaches it. */
    readonly blank: string;
}

const BLANK = /^(NULL|'(\[\]|\{\})'::jsonb)$/;
const derived = (...columns: DerivedTextColumn[]): readonly DerivedTextColumn[] => {
    for (const entry of columns) {
        if (!/^[a-z_]+$/.test(entry.column) || !BLANK.test(entry.blank)) throw new Error('invalid_derived_text_column');
    }
    return Object.freeze(columns.map(entry => Object.freeze(entry)));
};
const emptyArray = (column: string): DerivedTextColumn => ({ column, blank: "'[]'::jsonb" });
const emptyObject = (column: string): DerivedTextColumn => ({ column, blank: "'{}'::jsonb" });
const gone = (column: string): DerivedTextColumn => ({ column, blank: 'NULL' });

const snapshotStore = (id: string, table: string, expression: string, derivedText: readonly DerivedTextColumn[],
    requires: readonly string[] = []): EvidenceStore => Object.freeze({
    id,
    table,
    requires: Object.freeze([table, ...requires]),
    releaseMatch: `(${expression}) = ANY($1::text[])`,
    noProvenance: `(${expression}) IS NULL`,
    recordedColumn: null,
    derivedText: Object.freeze([...derivedText]),
});

const recordedStore = (id: string, table: string, derivedText: readonly DerivedTextColumn[]): EvidenceStore => Object.freeze({
    id,
    table,
    requires: Object.freeze([table]),
    releaseMatch: 't.source_release_ids && $1::text[]',
    noProvenance: 'COALESCE(cardinality(t.source_release_ids), 0) = 0',
    recordedColumn: Object.freeze({ name: 'source_release_ids', type: 'TEXT[]' }),
    derivedText: Object.freeze([...derivedText]),
});

export const EVIDENCE_STORES: readonly EvidenceStore[] = Object.freeze([
    snapshotStore('eval_runs', 'eval_runs', "t.agent_snapshot->>'learningReleaseId'",
        derived(emptyArray('results'), gone('release_evidence'))),
    snapshotStore('simulation_runs', 'simulation_runs', "t.persona_snapshot->>'learningReleaseId'",
        derived(emptyArray('results'), gone('summary'), gone('scenario_definitions'))),
    // Through the candidate, which is where the snapshot lives.
    snapshotStore('agent_release_evidence', 'agent_release_evaluations',
        "(SELECT c.agent_snapshot->>'learningReleaseId' FROM agent_release_candidates c WHERE c.id = t.candidate_id)",
        derived(emptyArray('results'), gone('evidence')), ['agent_release_candidates']),
    recordedStore('quality_regression_cases', 'quality_regression_cases',
        derived(emptyObject('proposal'), gone('approved_scenario'))),
    recordedStore('quality_scores', 'conversation_quality_scores',
        derived(emptyArray('flags'), gone('verification_reason'), gone('conversational_resolution_reason'))),
]);

/**
 * Additive only: two marks on every store and a provenance column on the two
 * that had none. `ADD COLUMN IF NOT EXISTS` on a nullable column is what
 * expand-contract permits in a single deploy, and nothing here writes a row.
 */
export const EVIDENCE_PROVENANCE_DDL: readonly string[] = Object.freeze(
    EVIDENCE_STORES.flatMap(store => [
        `ALTER TABLE ${store.table}
            ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS invalidated_reason TEXT`,
        ...(store.recordedColumn
            ? [`ALTER TABLE ${store.table} ADD COLUMN IF NOT EXISTS `
                + `${store.recordedColumn.name} ${store.recordedColumn.type}`]
            : []),
    ]));

/**
 * The provenance statements for one table, for a bootstrap that already owns it.
 *
 * Each of these five tables is created by the module that uses it, and each of
 * those modules already carries its own list of additive `ALTER`s. The marks
 * belong in those lists — that is what makes a tenant get them on first touch
 * rather than only at migration time — but the TEXT of them belongs here, so
 * that the columns the invalidation writes and the columns the bootstrap adds
 * cannot be written by two different hands.
 */
export function evidenceProvenanceDdl(table: string): readonly string[] {
    const store = EVIDENCE_STORES.find(candidate => candidate.table === table);
    if (!store) throw new Error(`unknown_evidence_store:${table}`);
    return Object.freeze([
        `ALTER TABLE ${store.table} ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ`,
        `ALTER TABLE ${store.table} ADD COLUMN IF NOT EXISTS invalidated_reason TEXT`,
        ...(store.recordedColumn
            ? [`ALTER TABLE ${store.table} ADD COLUMN IF NOT EXISTS `
                + `${store.recordedColumn.name} ${store.recordedColumn.type}`]
            : []),
    ]);
}

/** Does this tenant have every relation the store's predicates name? */
async function present(query: EvidenceQuery, store: EvidenceStore): Promise<boolean> {
    for (const table of store.requires) {
        const [row] = await query<any[]>('SELECT to_regclass($1)::text AS name', [table]);
        if (!row?.name) return false;
    }
    return true;
}

/** Applies the additive columns to whichever of the five this tenant has. */
export async function ensureEvidenceProvenance(query: EvidenceQuery): Promise<void> {
    for (const store of EVIDENCE_STORES) {
        if (!await present(query, store)) continue;
        await query(`ALTER TABLE ${store.table}
            ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS invalidated_reason TEXT`);
        if (store.recordedColumn) {
            await query(`ALTER TABLE ${store.table} ADD COLUMN IF NOT EXISTS `
                + `${store.recordedColumn.name} ${store.recordedColumn.type}`);
        }
    }
}

export interface EvidenceInvalidation {
    readonly store: string;
    readonly invalidated: number;
}

/** Which of these columns this tenant's table actually has, in order. */
async function derivedTextColumns(query: EvidenceQuery, store: EvidenceStore): Promise<readonly DerivedTextColumn[]> {
    if (!store.derivedText.length) return [];
    const rows = await query<any[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1 AND column_name = ANY($2::text[])`,
        [store.table, store.derivedText.map(entry => entry.column)]);
    const has = new Set(rows.map(row => String(row.column_name)));
    return store.derivedText.filter(entry => has.has(entry.column));
}

/**
 * Marks every piece of evidence that rests on one of these releases as invalid.
 *
 * `derivedText` is the whole difference between the two callers, and it mirrors
 * `deliveredReplies` in the retirement path for the same reason:
 *
 *   · `retain` — an operator withdrawing a release. The evaluation really did
 *     run, so the transcript stays and only the mark is written. Unwriting it
 *     would make the history lie;
 *   · `redact` — a person erasing themselves. Their words go from everything
 *     derived from them, and the row survives as the fact that the run happened
 *     rather than as a copy of what they said.
 *
 * A retirement is idempotent by its predicate: a row already marked is not
 * matched again, so retiring a release twice does not rewrite when the evidence
 * stopped counting. An erasure has to reach a row a retirement marked earlier —
 * the mark is not what an erasure is for — so it matches every derived row and
 * keeps the first timestamp with a COALESCE instead. Clearing a column that is
 * already clear is the same operation twice, which is what makes that safe.
 */
export async function invalidateEvidenceByRelease(
    query: EvidenceQuery, releaseIds: readonly string[],
    options?: { derivedText?: 'retain' | 'redact' },
): Promise<readonly EvidenceInvalidation[]> {
    const ids = [...new Set(releaseIds.map(value => String(value)).filter(Boolean))];
    if (!ids.length) return Object.freeze([]);
    const redact = options?.derivedText === 'redact';
    const out: EvidenceInvalidation[] = [];
    for (const store of EVIDENCE_STORES) {
        if (!await present(query, store)) continue;
        const columns = redact ? await derivedTextColumns(query, store) : [];
        const rows = await query<any[]>(
            `UPDATE ${store.table} t
                SET invalidated_at = COALESCE(t.invalidated_at, NOW()),
                    invalidated_reason = COALESCE(t.invalidated_reason, $2)
                    ${columns.map(entry => `, ${entry.column} = ${entry.blank}`).join('')}
              WHERE ${redact ? '' : 't.invalidated_at IS NULL AND '}${store.releaseMatch}
          RETURNING t.id`, [ids, redact ? 'release_erased' : 'release_retired']);
        out.push(Object.freeze({ store: store.id, invalidated: rows?.length ?? 0 }));
    }
    return Object.freeze(out);
}

/**
 * How much evidence carries no provenance at all.
 *
 * Rows written before this existed name no release, so nothing can invalidate
 * them and nothing pretends to. The number is the honest size of that: it goes
 * down as evidence is produced by the current code, and a reader can decide
 * whether an old certification is worth trusting rather than being told it is.
 */
export async function evidenceWithoutProvenance(
    query: EvidenceQuery,
): Promise<Readonly<Record<string, number>>> {
    const out: Record<string, number> = {};
    for (const store of EVIDENCE_STORES) {
        if (!await present(query, store)) continue;
        const [row] = await query<any[]>(
            `SELECT count(*)::int AS n FROM ${store.table} t WHERE ${store.noProvenance}`);
        out[store.id] = Number(row?.n ?? 0);
    }
    return Object.freeze(out);
}

/**
 * The releases that produced the agent's side of these messages.
 *
 * This is what the two recording stores write down, and the turn ledger is the
 * only place a PRODUCTION turn states it: the envelope carries the learning
 * footprints of the turn that answered one inbound message. Reading it at write
 * time is the point — a retraction later nulls that envelope, so a verdict that
 * did not copy the ids while they existed could never be matched again.
 *
 * An empty answer is a real answer: a tenant with no ledger, a conversation
 * older than it, or a turn that used no learning at all. Recording `{}` says
 * "no release produced this", which is why the no-provenance count and the
 * invalidation predicate agree on treating it as unmatched rather than
 * suspicious.
 */
export async function releasesForMessages(
    query: EvidenceQuery, messageIds: readonly string[],
): Promise<string[]> {
    // Only well-formed uuids reach the cast. This runs inside the transaction
    // that is about to write a verdict, and `$1::uuid[]` on a malformed id does
    // not return nothing — it aborts every statement after it, including the
    // INSERT this was called to enrich.
    const ids = [...new Set(messageIds.map(value => String(value))
        .filter(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)))];
    if (!ids.length) return [];
    const [ledger] = await query<any[]>("SELECT to_regclass('agent_turn_ledger')::text AS name");
    if (!ledger?.name) return [];
    const rows = await query<any[]>(
        `SELECT DISTINCT entry->>'releaseId' AS release_id
           FROM agent_turn_ledger l
           CROSS JOIN LATERAL jsonb_array_elements(CASE
               WHEN jsonb_typeof(l.envelope->'learningFootprints') = 'array'
               THEN l.envelope->'learningFootprints' ELSE '[]'::jsonb END) footprint
           CROSS JOIN LATERAL jsonb_array_elements(CASE
               WHEN jsonb_typeof(footprint->'entries') = 'array'
               THEN footprint->'entries' ELSE '[]'::jsonb END) entry
          WHERE l.inbound_message_id = ANY($1::uuid[]) AND entry->>'releaseId' IS NOT NULL`, [ids]);
    return [...new Set(rows.map(row => String(row.release_id)))].sort();
}

/** The clause a reader adds so invalidated evidence stops counting as proof. */
export const VALID_EVIDENCE_CLAUSE = 'invalidated_at IS NULL';
