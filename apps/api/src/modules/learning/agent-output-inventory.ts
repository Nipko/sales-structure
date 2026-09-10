/**
 * Every place the agent's words come to rest, and what reaches each one.
 *
 * A retraction and an erasure are only as good as the list of places they have
 * to visit, and that list lived in prose: "outras salidas/trazas" was a phrase in
 * a progress document, not something anybody could count. So a store added next
 * month joined the unreached set in silence, exactly the way an external producer
 * used to before `external-effect-inventory.ts` existed. This is the same idea
 * for the other direction: not what leaves the process, but what stays behind.
 *
 * Two rules, borrowed from that file because they are what make an inventory
 * worth having:
 *
 *   - It records what is true TODAY. `no` with a reason is the most useful cell
 *     here; an inventory that flatters the code converts an unknown gap into a
 *     false assurance.
 *   - It is checked. `agent-output-inventory.spec.ts` sweeps the source tree for
 *     the writers of agent text and requires every one of them to be claimed
 *     here, so a new resting place fails a test instead of shipping unlisted.
 *
 * The distinction that matters most in this table is between a RETRACTION and an
 * ERASURE, because they have different keys and different scopes:
 *
 *   · a retraction withdraws a RELEASE. It reaches what has not been delivered —
 *     the outbox item still waiting, the envelope a turn would be resumed from,
 *     the draft nobody has sent — and deliberately does not rewrite a
 *     conversation that already happened;
 *   · an erasure removes a PERSON. It reaches everything of theirs, delivered or
 *     not, and its key is the contact, not the release.
 *
 * A store can therefore be honestly `no` for one and `yes` for the other, and
 * several are. `by_design` means the answer is no and will stay no for a stated
 * reason — not that somebody has not got to it yet.
 */

export const OUTPUT_REACH = ['yes', 'no', 'by_design'] as const;
export type OutputReach = (typeof OUTPUT_REACH)[number];

export const OUTPUT_STATUS = [
    /** Reached by everything that should reach it. */
    'closed',
    /** A stated, accepted limit. The rationale says why it is acceptable. */
    'accepted',
    /** A real gap. `remedy` says what would close it. */
    'open',
] as const;
export type OutputStatus = (typeof OUTPUT_STATUS)[number];

export interface AgentOutputStore {
    /** Stable id, used by the spec and by anything that reports on this. */
    readonly id: string;
    /** The table, key or payload the words sit in. */
    readonly store: string;
    /**
     * Every file that writes them, relative to `src/`. Plural because a store is
     * a concept, not a file: an envelope is written by the ledger and by its
     * store, a widget reply by the retention module and by its own.
     */
    readonly sources: readonly string[];
    /**
     * Whether the row carries a learning footprint or release id. Without one a
     * retraction has nothing to match on, whatever else is true.
     */
    readonly carriesProvenance: boolean;
    readonly reachedByRetraction: OutputReach;
    readonly reachedByContactErasure: OutputReach;
    readonly status: OutputStatus;
    /** Why the answers above are what they are. Always required. */
    readonly rationale: string;
    /** What would close it. Required when `status` is `open`. */
    readonly remedy?: string;
}

const store = (row: AgentOutputStore): AgentOutputStore => Object.freeze(row);

export const AGENT_OUTPUT_STORES: readonly AgentOutputStore[] = Object.freeze([
    // ── Undelivered: the retraction's proper territory ───────────────────────
    store({
        id: 'dispatch_outbox_payload',
        store: 'agent_dispatch_outbox.payload (and its deferred `available_at` sibling)',
        sources: ['modules/channels/agent-dispatch-outbox.ts', 'modules/channels/agent-dispatch-outbox.store.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'yes',
        reachedByContactErasure: 'yes',
        status: 'closed',
        rationale: 'Carries `learning_footprint` and an `agent_dispatch_outbox_sources` index, so both keys find it. '
            + 'Redaction nulls the payload and the row survives as the fact that stops a resend; admission additionally '
            + 're-asserts the footprint against live releases, so a retired release blocks a delayed send before redaction.',
    }),
    store({
        id: 'turn_ledger_envelope',
        store: 'agent_turn_ledger.envelope',
        sources: ['modules/conversations/agent-turn-ledger.ts', 'modules/conversations/agent-turn-ledger.store.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'yes',
        reachedByContactErasure: 'yes',
        status: 'closed',
        rationale: 'The envelope a turn would be resumed from. Matched by release id and by contact id.',
    }),
    store({
        id: 'pending_draft_messaging',
        store: 'conversations.metadata.pendingDraft (messaging turn)',
        sources: ['modules/conversations/conversations.service.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'yes',
        reachedByContactErasure: 'yes',
        status: 'closed',
        rationale: 'Records `learningReleaseIds` at persist time, so `redactPendingDrafts` matches it; the erasure '
            + 'strips `pendingDraft` from the same metadata statement that strips the procedure and booking state.',
    }),
    store({
        id: 'pending_draft_widget',
        store: 'conversations.metadata.pendingDraft (Web Chat turn)',
        sources: ['modules/conversations/conversations.service.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'yes',
        reachedByContactErasure: 'yes',
        status: 'closed',
        rationale: 'Was the one call site that persisted a draft without its release ids, so a retraction could never '
            + 'match it — on the channel where the draft is the only place the reply exists. It passes them now.',
    }),
    store({
        id: 'widget_agent_replies',
        store: 'widget_agent_replies (+ the `messages` row it points at)',
        sources: ['modules/widget/widget-agent-reply-retention.ts', 'modules/widget/widget-agent-reply.store.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'yes',
        status: 'accepted',
        rationale: 'A DELIVERED reply. An operator rollback withdraws a release; it does not rewrite a conversation the '
            + 'customer already had, and this redaction blanks the `messages` row itself. The person whose words they are '
            + 'reaches it through `withdrawSource` and through contact erasure, which is the correct key for it.',
    }),

    // ── Delivered history: the erasure's territory, not the retraction's ─────
    store({
        id: 'messages_history',
        store: 'messages.content_text on every channel',
        sources: ['modules/conversations/conversations.service.ts', 'modules/widget/widget-message-store.service.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'yes',
        status: 'accepted',
        rationale: 'The customer\'s own transcript. A release rollback must not rewrite it, for the same reason the '
            + 'widget reply is left alone. Contact erasure blanks it with the rest of the conversation.',
    }),

    // ── Caches ───────────────────────────────────────────────────────────────
    store({
        id: 'turn_reply_cache',
        store: 'Redis `turn:reply:{tenant}:{pmid}` (24 h)',
        sources: ['modules/conversations/conversations.service.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'by_design',
        status: 'accepted',
        rationale: 'Reachable only by provider message id, so neither key can find it. It is therefore never WRITTEN for '
            + 'a reply that derives from learned examples — the gap is closed at the door instead of at the sweep — and '
            + 'it is written after the ledger, so it can only ever be the fallback for a turn whose ledger row is absent.',
    }),
    store({
        id: 'widget_reply_cache',
        store: 'Redis `widget:reply:{tenant}:{inboundMessageId}` (24 h)',
        sources: ['modules/conversations/conversations.service.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'by_design',
        status: 'accepted',
        rationale: 'Holds no words: `{conversationId, contactId, draft}` only. The read path refuses a legacy entry that '
            + 'did hold text rather than replaying it.',
    }),

    // ── Evaluation and quality evidence ──────────────────────────────────────
    store({
        id: 'eval_runs',
        store: 'eval_runs.results (per-scenario transcripts) and agent_snapshot',
        sources: ['modules/simulation/eval.service.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'no',
        reachedByContactErasure: 'no',
        status: 'open',
        rationale: 'Carries a `learningReleaseId` in its snapshot and holds whole agent transcripts. Nothing invalidates '
            + 'it when the release it names is retired; the only deleter is the regression-case path.',
        remedy: 'Invalidate the run when its release is retired — the snapshot already names it — and reach it from the '
            + 'contact-erasure fan-out the way simulation replays already are.',
    }),
    store({
        id: 'simulation_runs',
        store: 'simulation_runs.results (agent transcripts) and evaluation_snapshot',
        sources: ['modules/simulation/simulation.service.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'no',
        reachedByContactErasure: 'yes',
        status: 'open',
        rationale: 'Reached by contact erasure through the replay retention path, but not by a retraction, although its '
            + 'snapshot names the release.',
        remedy: 'Same as `eval_runs`: invalidate by release id when the release is retired.',
    }),
    store({
        id: 'agent_release_evidence',
        store: 'agent_release_candidates.agent_snapshot and agent_release_evaluations.results',
        sources: ['modules/simulation/agent-release-store.ts', 'modules/simulation/agent-release-contract.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'no',
        reachedByContactErasure: 'no',
        status: 'open',
        rationale: 'Release evidence holding transcripts and a snapshot that names a learning release. Invalidated only '
            + 'when a regression case changes.',
        remedy: 'Invalidate on retirement of the release the snapshot names, and join the contact-erasure fan-out.',
    }),
    store({
        id: 'quality_regression_cases',
        store: 'quality_regression_cases.proposal.observedReplies',
        sources: ['modules/quality/regressions/quality-regression-contracts.ts',
            'modules/quality/regressions/quality-regression.service.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'no',
        reachedByContactErasure: 'yes',
        status: 'open',
        rationale: 'Freezes real agent replies as permanent test evidence with a source contact but no release id, so a '
            + 'retraction structurally cannot find it. Contact erasure does reach it.',
        remedy: 'Record the release id beside the source contact id when the case is frozen, so a retraction has a key.',
    }),

    // ── Traces and operator text ─────────────────────────────────────────────
    store({
        id: 'turn_traces',
        store: 'turn_traces.steps / conversation_traces',
        sources: ['modules/trace/trace.service.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'by_design',
        status: 'accepted',
        rationale: 'Steps carry lengths, labels and tool names — not the reply body — and the table is time-limited by '
            + 'its own delete. There is no reply text to reach.',
    }),
    store({
        id: 'handoff_summary',
        store: 'conversations.handoff_summary and internal_notes.content',
        sources: ['modules/handoff/handoff.service.ts', 'modules/agent-console/agent-console.service.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'yes',
        status: 'open',
        rationale: 'LLM-generated text derived from the customer\'s transcript. The erasure now clears the summary and '
            + 'deletes the notes in the same statement that resets the conversation metadata. A retraction leaves them: '
            + 'a summary is about the CONVERSATION, not about a release, and withdrawing a release does not unwrite what '
            + 'a person was told when the conversation was handed to them. What remains open is the copy pushed to a '
            + 'third-party CRM, which the platform cannot reach because it never recorded where it went.',
        remedy: 'Record the external CRM note id when the summary is pushed, so the copy outside the platform can be '
            + 'retracted with the one inside it.',
    }),
    store({
        id: 'customer_memory_facts',
        store: 'customer_memory_facts / customer_memories',
        sources: ['modules/conversations/customer-memory.service.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'yes',
        status: 'accepted',
        rationale: 'Facts extracted from a transcript that includes agent lines. A release rollback does not unlearn a '
            + 'fact about the customer; an erasure removes them, and does.',
    }),

    store({
        id: 'certification_cases',
        store: 'agent_certification_cases.transcript',
        sources: ['modules/simulation/certification-ledger.ts', 'modules/simulation/certification-runner.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'by_design',
        status: 'accepted',
        rationale: 'A certification case is the agent answering an evaluation pack inside an isolated fixture: the '
            + 'customer is synthetic and there is no contact to erase or release to withdraw. What makes that true '
            + 'rather than hopeful is the contract of the executor itself — a case names a profile and a scenario key, never '
            + 'a contact — and the fixtures it runs against are per-profile and disposable. A run whose subject were a '
            + 'real conversation would be a different table and would belong in the fan-outs above.',
    }),
    store({
        id: 'learning_corpus',
        store: 'learning_sources.transcript, learning_examples.episode / response_pattern, learning_reviews.snapshot',
        sources: ['modules/learning/learning.service.ts', 'modules/learning/learning-inbox-source.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'yes',
        status: 'accepted',
        rationale: 'The corpus IS the provenance, so a release rollback deliberately leaves it: withdrawing a release '
            + 'does not unlearn the conversation it was learned from, and the release row is what gets retired. '
            + '`withdrawSource` and contact erasure delete the sources, the examples and their reviews outright.',
    }),
    store({
        id: 'quality_scores',
        store: 'conversation_quality_scores (judge verdict and its free-text resolution reason)',
        sources: ['modules/quality/quality.service.ts', 'modules/quality/quality-production-evidence.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'no',
        reachedByContactErasure: 'yes',
        status: 'open',
        rationale: 'Holds a judgement about a conversation and a free-text reason, keyed by transcript hash and source '
            + 'message ids — no release id, so a retraction structurally cannot find it. Contact erasure does reach it.',
        remedy: 'Record the release ids of the turn being judged, so a withdrawn release can take its verdicts with it.',
    }),
    store({
        id: 'benchmark_attempts',
        store: 'benchmark_attempts.transcript, and the frozen corpus it is scored against',
        sources: ['modules/simulation/agent-benchmark.ts', 'modules/simulation/benchmark-harness.ts',
            'modules/simulation/benchmark.service.ts'],
        carriesProvenance: false,
        reachedByRetraction: 'by_design',
        reachedByContactErasure: 'by_design',
        status: 'accepted',
        rationale: 'This row used to say the store did not exist yet and asked, when it was built, for a release id '
            + 'and a contact id so neither key would have to be retrofitted. The store exists now and needs neither, '
            + 'which is a better answer than the one that was asked for: the corpus is generated from the catalogue '
            + 'and frozen by hash, so every customer message in it was written by the evaluation packs rather than by '
            + 'a person, and the transcript is a subject answering those. There is no customer in it to reach. The '
            + 'blind review stores a label and a score rather than the words, so a reviewer holds no second copy.',
    }),

    // ── Deferred sends ───────────────────────────────────────────────────────
    store({
        id: 'outbound_queue_job',
        store: 'outbound_payloads.payload (the legacy reply path, now a reference)',
        sources: ['modules/channels/outbound-queue.service.ts', 'modules/channels/outbound-payload-store.ts',
            'modules/channels/outbound-queue.processor.ts'],
        carriesProvenance: true,
        reachedByRetraction: 'yes',
        reachedByContactErasure: 'yes',
        status: 'closed',
        rationale: 'This was the widest hole in the sweep: staggered bubbles, payment links and media went into delayed '
            + 'Redis jobs holding the words and the recipient, with no footprint, no contact and a day of retention on '
            + 'failure, so neither key could reach them. The remedy this row used to ask for was to turn the durable '
            + 'dispatch switch on, which is not something anybody can do for a live tenant. The job is a REFERENCE now: '
            + 'Redis carries two ids, the words live in a tenant row that records the contact and the release ids, and '
            + 'the processor reads them at the last moment before sending — which is what makes "retracted while it was '
            + 'queued" mean something. Redaction nulls the payload and the row survives as the fact that stops a '
            + 'resend, and delivery clears it for the same reason. A tenant whose schema cannot be resolved still sends '
            + 'inline, exactly as before, so the change degrades rather than fails.',
    }),
]);

export const AGENT_OUTPUT_STORE_IDS: readonly string[] =
    Object.freeze(AGENT_OUTPUT_STORES.map(row => row.id).sort());

/** The ones a reader should act on, as a list rather than as a feeling. */
export function openAgentOutputStores(): readonly AgentOutputStore[] {
    return Object.freeze(AGENT_OUTPUT_STORES.filter(row => row.status === 'open'));
}
