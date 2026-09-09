import { AGENT_EXECUTABLE_OPERATIONS, AGENT_ROUTED_OPERATIONS, type AgentOperationKey } from './agent-operation-contract';
import { findGuidedTourForQualityCode, type GuidedTourId } from './guided-tour-contract';

/**
 * How a person actually resolves each thing the assessment can say is wrong.
 *
 * The assessment names problems in two shapes: `criticalBlockers`, which are
 * check codes, and `recommendations`, which are `fix_<check>` plus a handful of
 * pillar codes of their own. Until now the answer to "and what do I do about
 * it?" was whatever `href` the check happened to carry, plus a tour if one
 * mentioned the code. Nothing said that every code had an answer, so a new
 * `add({ code: … })` could ship with no resolution at all and no test would
 * notice — the person would simply be told something was wrong and left there.
 *
 * This registry is the missing half, and `agent-issue-resolution.spec.ts` is
 * what makes it stay true: it runs the real check and recommendation builders,
 * collects the codes they emit, and fails naming any code with no entry here.
 *
 * Three things it deliberately does NOT do.
 *
 *  · **It does not repeat the tours.** `tourId` must equal what
 *    `findGuidedTourForQualityCode` returns, and must be absent when that
 *    returns nothing. Two lists of the same fact drift; one list checked
 *    against the other cannot.
 *  · **It does not repeat the screens.** The route a person lands on is the
 *    check's own `href`, which is already specific and already sanitised on the
 *    way to the UI. Copying it here would be a second copy to go stale.
 *  · **It does not promise green.** `clears` says what following the
 *    resolution actually achieves, and `misleadingOperation` names the Assist
 *    operation a reader would reasonably expect to fix the check and which does
 *    not. That field exists because of two real cases, both below.
 */

/** Where the answer lives. */
export const AGENT_ISSUE_RESOLUTION_KINDS = [
    /** Assist can write the object itself, under review. Names an executable operation. */
    'assist_operation',
    /** Assist hands off to the screen that owns the decision. Names a routed operation. */
    'assist_route',
    /** A guided tour opens the exact screen and points at the control. */
    'guided_tour',
    /** The check's own deep link is the whole answer: one screen, one field. */
    'screen',
    /** Reading conversations and deciding. There is no control to point at. */
    'human_review',
] as const;
export type AgentIssueResolutionKind = typeof AGENT_ISSUE_RESOLUTION_KINDS[number];

/** What following the resolution actually achieves. */
export const AGENT_ISSUE_CLEARANCE = [
    /** Doing it clears the check. */
    'closes',
    /** The write lands and a person still has to activate, publish or replace something. */
    'needs_person',
    /** No single write clears it: it is read-the-conversations work. */
    'needs_judgement',
    /** It clears only as real conversations accumulate. Nothing to configure. */
    'needs_traffic',
] as const;
export type AgentIssueClearance = typeof AGENT_ISSUE_CLEARANCE[number];

export interface AgentIssueResolution {
    /** A quality check code, a pillar recommendation code, or a production issue code. */
    readonly code: string;
    readonly kind: AgentIssueResolutionKind;
    /** Required for `assist_operation` and `assist_route`; forbidden otherwise. */
    readonly operation?: AgentOperationKey;
    /** Must match `findGuidedTourForQualityCode(code)`, including its absence. */
    readonly tourId?: GuidedTourId;
    readonly clears: AgentIssueClearance;
    /**
     * An Assist operation a reader would expect to clear this check, that does
     * not — with the reason. Assist is told this so it stops offering a write
     * that cannot move the thing the person was sent to fix.
     */
    readonly misleadingOperation?: { readonly operation: AgentOperationKey; readonly because: string };
    /** Required whenever `clears` is anything but `closes`: what is still left to do. */
    readonly note?: string;
}

/**
 * How the judge's free-text flags are bucketed before they become
 * `investigate_<code>` recommendations. Declared here so the resolution table
 * has a universe to cover; `classifyQualityFlag` returns this union.
 */
export const AGENT_QUALITY_ISSUE_CODES = [
    'qa_knowledge_accuracy', 'qa_unresolved_need', 'qa_missing_handoff', 'qa_tone_empathy',
    'qa_ignored_question', 'qa_repetition_clarity', 'qa_other', 'tool_failures',
] as const;
export type AgentQualityIssueCode = typeof AGENT_QUALITY_ISSUE_CODES[number];

const entry = (row: AgentIssueResolution): AgentIssueResolution => Object.freeze(row);

export const AGENT_ISSUE_RESOLUTIONS: readonly AgentIssueResolution[] = Object.freeze([
    // ── Alcance del negocio ──────────────────────────────────────────────────
    entry({ code: 'agent_active', kind: 'screen', clears: 'closes' }),
    entry({ code: 'persona_identity', kind: 'guided_tour', tourId: 'agent_handoff_rules', clears: 'closes' }),
    entry({ code: 'business_identity', kind: 'guided_tour', tourId: 'business_identity', clears: 'closes' }),
    entry({ code: 'business_contact', kind: 'guided_tour', tourId: 'business_identity', clears: 'closes' }),
    entry({ code: 'business_context', kind: 'guided_tour', tourId: 'business_identity', clears: 'closes' }),

    // ── Conversación y marca ─────────────────────────────────────────────────
    entry({ code: 'agent_language', kind: 'screen', clears: 'closes' }),
    entry({ code: 'brand_voice', kind: 'guided_tour', tourId: 'agent_handoff_rules', clears: 'closes' }),
    entry({ code: 'greeting', kind: 'guided_tour', tourId: 'agent_handoff_rules', clears: 'closes' }),
    entry({ code: 'fallback_message', kind: 'guided_tour', tourId: 'agent_handoff_rules', clears: 'closes' }),
    entry({ code: 'behavior_rules', kind: 'guided_tour', tourId: 'agent_handoff_rules', clears: 'closes' }),
    entry({ code: 'custom_prompt', kind: 'guided_tour', tourId: 'agent_handoff_rules', clears: 'closes' }),

    // ── Conocimiento ─────────────────────────────────────────────────────────
    entry({
        code: 'knowledge_coverage', kind: 'assist_operation', operation: 'knowledge.faq.create',
        tourId: 'knowledge_base', clears: 'closes',
    }),
    entry({
        code: 'rag_knowledge', kind: 'assist_operation', operation: 'knowledge.faq.create',
        tourId: 'knowledge_base', clears: 'needs_person',
        note: 'The resource is written and ingested in the same call, but the check counts embedded chunks: if the '
            + 'ingest fails the row exists and the check does not move, and the knowledge screen shows why.',
    }),
    entry({ code: 'rag_configuration', kind: 'screen', clears: 'closes' }),
    entry({
        code: 'tool_faqs', kind: 'guided_tour', tourId: 'knowledge_base', clears: 'closes',
        misleadingOperation: {
            operation: 'knowledge.faq.create',
            because: 'it writes a knowledge resource of type faq, which feeds retrieval, while this check counts '
                + 'published rows of the faqs table behind /admin/knowledge/faqs. Both are called "FAQ" in the '
                + 'product and they are two different objects.',
        },
    }),
    entry({
        code: 'tool_policies', kind: 'screen', clears: 'closes',
        misleadingOperation: {
            operation: 'policies.legal_text.create',
            because: 'it writes an inactive row in legal_text_versions — the customer-facing legal texts of '
                + '/admin/compliance — while this check counts active rows of the policies table. Different table, '
                + 'and deliberately inactive: publishing terms to the tenant\'s customers is a person\'s decision.',
        },
    }),

    // ── Acciones y resultados ────────────────────────────────────────────────
    entry({
        code: 'channel_assignment', kind: 'guided_tour', tourId: 'assign_agent_channel', clears: 'closes',
    }),
    entry({
        code: 'operational_channel_scope', kind: 'guided_tour', tourId: 'assign_agent_channel', clears: 'closes',
    }),
    entry({
        code: 'channel_connection', kind: 'assist_route', operation: 'channels.account.connect',
        tourId: 'connect_channel', clears: 'closes',
    }),
    entry({
        code: 'channel_coverage', kind: 'assist_route', operation: 'channels.account.connect',
        tourId: 'connect_channel', clears: 'closes',
    }),
    entry({
        code: 'tool_appointments', kind: 'assist_operation', operation: 'agenda.service.create',
        tourId: 'appointments_setup', clears: 'needs_person',
        note: 'Assist can add the service; the check also needs availability, and saving a week replaces the whole '
            + 'set rather than adding a row, so a person does that on the agenda screen.',
    }),
    entry({ code: 'tool_vehicles', kind: 'screen', clears: 'closes' }),
    entry({
        code: 'test_drive_permissions', kind: 'screen', clears: 'closes',
        note: 'Deliberately no tour: the fix is two switches on the agent itself, and the setup card suppresses a '
            + 'tour for this code for the same reason.',
    }),
    entry({ code: 'test_drive_service', kind: 'guided_tour', tourId: 'appointments_setup', clears: 'closes' }),
    entry({ code: 'test_drive_staff', kind: 'guided_tour', tourId: 'appointments_setup', clears: 'closes' }),
    entry({ code: 'tool_catalog', kind: 'screen', clears: 'closes' }),
    entry({ code: 'tool_ecommerce', kind: 'screen', clears: 'closes' }),
    entry({ code: 'tool_orders', kind: 'screen', clears: 'closes' }),
    entry({
        code: 'tool_offers', kind: 'assist_route', operation: 'catalogue.offer.create', clears: 'closes',
        note: 'An offer is a price the agent will then quote, bound to a course or campaign that must already '
            + 'exist. Assist routes to the offers screen rather than guessing at a commitment.',
    }),
    entry({ code: 'tool_crm', kind: 'screen', clears: 'closes' }),

    // Vertical catalogues. Six of them count rows of `services`, which is the
    // table `agenda.service.create` writes with `is_active` at its default of
    // true — so Assist really can close those, and the table says so instead of
    // sending everybody to a screen by default.
    entry({ code: 'tool_properties', kind: 'screen', clears: 'closes' }),
    entry({ code: 'tool_tours', kind: 'screen', clears: 'closes' }),
    entry({ code: 'tool_treatments', kind: 'assist_operation', operation: 'agenda.service.create', clears: 'closes' }),
    entry({ code: 'tool_real_estate', kind: 'screen', clears: 'closes' }),
    entry({ code: 'tool_pets', kind: 'assist_operation', operation: 'agenda.service.create', clears: 'closes' }),
    entry({ code: 'tool_restaurants', kind: 'screen', clears: 'closes' }),
    entry({ code: 'tool_gyms', kind: 'screen', clears: 'closes' }),
    entry({ code: 'tool_education', kind: 'assist_operation', operation: 'catalogue.course.create', clears: 'closes' }),
    entry({ code: 'tool_insurance', kind: 'screen', clears: 'closes' }),
    entry({ code: 'tool_home_services', kind: 'assist_operation', operation: 'agenda.service.create', clears: 'closes' }),
    entry({ code: 'tool_pet_services', kind: 'assist_operation', operation: 'agenda.service.create', clears: 'closes' }),
    entry({ code: 'tool_photography', kind: 'assist_operation', operation: 'agenda.service.create', clears: 'closes' }),
    entry({
        code: 'tool_professional_services', kind: 'assist_operation', operation: 'agenda.service.create',
        clears: 'closes',
    }),

    // ── Seguridad y escalada ─────────────────────────────────────────────────
    entry({ code: 'forbidden_topics', kind: 'guided_tour', tourId: 'agent_handoff_rules', clears: 'closes' }),
    entry({ code: 'handoff_triggers', kind: 'guided_tour', tourId: 'agent_handoff_rules', clears: 'closes' }),
    entry({
        code: 'human_handoff_route', kind: 'assist_route', operation: 'roles.member.grant',
        tourId: 'human_handoff_route', clears: 'closes',
        note: 'The check wants an active human who can take the conversation. Who may do that is a privilege '
            + 'decision, so Assist opens the team screen instead of granting it.',
    }),

    // ── Robustez y operación ─────────────────────────────────────────────────
    entry({ code: 'business_hours', kind: 'guided_tour', tourId: 'business_hours', clears: 'closes' }),
    entry({ code: 'after_hours_behavior', kind: 'guided_tour', tourId: 'business_hours', clears: 'closes' }),
    entry({ code: 'llm_limits', kind: 'screen', clears: 'closes' }),

    // ── Recomendaciones del pilar probado ────────────────────────────────────
    entry({ code: 'run_eval', kind: 'guided_tour', tourId: 'run_agent_tests', clears: 'closes' }),
    entry({ code: 'refresh_eval', kind: 'guided_tour', tourId: 'run_agent_tests', clears: 'closes' }),
    entry({
        code: 'fix_failed_eval', kind: 'guided_tour', tourId: 'run_agent_tests', clears: 'needs_judgement',
        note: 'Re-running a failed evaluation without changing anything reproduces the failure. What clears it is '
            + 'reading which cases failed and fixing the configuration or the knowledge behind them.',
    }),
    entry({ code: 'run_simulation', kind: 'guided_tour', tourId: 'run_agent_tests', clears: 'closes' }),

    // ── Recomendaciones del pilar de producción ──────────────────────────────
    entry({
        code: 'collect_production_evidence', kind: 'guided_tour', tourId: 'agent_quality_center',
        clears: 'needs_traffic',
        note: 'Nothing to configure: the pillar needs a minimum number of attributed conversations, and that only '
            + 'arrives with use. Saying so beats offering an action that cannot help.',
    }),
    entry({
        code: 'improve_verified_resolution', kind: 'guided_tour', tourId: 'agent_quality_center',
        clears: 'needs_judgement',
        note: 'The unverified conversations are listed with the signal; the fix is whatever they turn out to have '
            + 'in common, which is usually knowledge or a missing handoff trigger.',
    }),
    entry({
        code: 'review_low_quality_conversations', kind: 'guided_tour', tourId: 'agent_quality_center',
        clears: 'needs_judgement',
        note: 'The conversations are linked from the signal. Reading them is the work; nothing here is a setting.',
    }),
    entry({
        code: 'review_tool_failures', kind: 'guided_tour', tourId: 'agent_quality_center', clears: 'needs_judgement',
        note: 'A reconciliation-required execution is a real effect in an unknown state and is looked at first; the '
            + 'rest is read from the linked conversations.',
    }),
    entry({
        code: 'resolve_knowledge_gaps', kind: 'assist_operation', operation: 'knowledge.faq.create',
        tourId: 'knowledge_base', clears: 'closes',
        note: 'The gap is a question the agent could not answer from the knowledge base, and the answer to it is '
            + 'exactly the object Assist can draft.',
    }),

    // ── Clases de hallazgo en producción (`investigate_<code>`) ──────────────
    entry({
        code: 'qa_knowledge_accuracy', kind: 'human_review', clears: 'needs_judgement',
        note: 'The judge flagged an answer as invented or wrong. Read what was asked, then correct the source: a '
            + 'knowledge article, a price in the catalogue, or a rule in the instructions.',
    }),
    entry({
        code: 'qa_unresolved_need', kind: 'human_review', clears: 'needs_judgement',
        note: 'Conversations that ended without the customer getting what they came for. What clears them differs '
            + 'per case: a missing tool, a missing answer, or a handoff that never happened.',
    }),
    entry({
        code: 'qa_missing_handoff', kind: 'human_review', clears: 'needs_judgement',
        note: 'The agent should have escalated and did not. The trigger list on the agent is where that is fixed, '
            + 'but which trigger is missing comes from the conversations.',
    }),
    entry({
        code: 'qa_tone_empathy', kind: 'human_review', clears: 'needs_judgement',
        note: 'Tone lives in the persona and the instructions; which conversations felt cold is a reading.',
    }),
    entry({
        code: 'qa_ignored_question', kind: 'human_review', clears: 'needs_judgement',
        note: 'The customer asked something the reply did not address. Usually a knowledge gap, sometimes a reply '
            + 'that answered the previous turn.',
    }),
    entry({
        code: 'qa_repetition_clarity', kind: 'human_review', clears: 'needs_judgement',
        note: 'Repeating or over-long replies. The instructions and the fallback message are where this is tuned.',
    }),
    entry({
        code: 'qa_other', kind: 'human_review', clears: 'needs_judgement',
        note: 'The bucket for a flag none of the classes matched. It exists so an unrecognised finding is still '
            + 'counted and still linked to its conversations, instead of disappearing.',
    }),
    entry({
        code: 'tool_failures', kind: 'human_review', clears: 'needs_judgement',
        note: 'The one flag class that never becomes an investigate_ recommendation: it is filtered out of that '
            + 'loop and reaches the person as review_tool_failures instead, which carries the quality-centre tour. '
            + 'It has no tour of its own precisely because sending somebody to two places for one cause is what '
            + 'that filter exists to prevent.',
    }),
] as const satisfies readonly AgentIssueResolution[]);

const BY_CODE = new Map<string, AgentIssueResolution>(
    AGENT_ISSUE_RESOLUTIONS.map(resolution => [resolution.code, resolution]),
);

/**
 * The resolution for a blocker, a recommendation or a production issue code.
 *
 * Exact match first, so `fix_failed_eval` — a recommendation code that happens
 * to start with the recommendation prefix — resolves to itself rather than to a
 * check called `failed_eval` that does not exist.
 */
export function resolutionForIssueCode(code: unknown): AgentIssueResolution | null {
    if (typeof code !== 'string' || !code.trim()) return null;
    const normalized = code.trim().toLowerCase();
    const exact = BY_CODE.get(normalized);
    if (exact) return exact;
    for (const prefix of ['fix_', 'investigate_']) {
        if (normalized.startsWith(prefix)) {
            const inner = BY_CODE.get(normalized.slice(prefix.length));
            if (inner) return inner;
        }
    }
    return null;
}

/** Codes whose resolution is an Assist operation the person can apply from the chat. */
export function assistExecutableIssueCodes(): readonly string[] {
    return Object.freeze(AGENT_ISSUE_RESOLUTIONS
        .filter(resolution => resolution.kind === 'assist_operation')
        .map(resolution => resolution.code));
}

/**
 * The pairs Assist must not offer: a code, and the operation that looks like it
 * would fix it. Fed to the model so it names the screen instead of the write.
 */
export function misleadingAssistOperations(): ReadonlyArray<{ code: string; operation: AgentOperationKey; because: string }> {
    return Object.freeze(AGENT_ISSUE_RESOLUTIONS
        .filter((resolution): resolution is AgentIssueResolution & { misleadingOperation: NonNullable<AgentIssueResolution['misleadingOperation']> } =>
            resolution.misleadingOperation !== undefined)
        .map(resolution => ({
            code: resolution.code,
            operation: resolution.misleadingOperation.operation,
            because: resolution.misleadingOperation.because,
        })));
}

/**
 * Structural problems with the table itself, as a list rather than a boolean:
 * an operation that is not in the registry, a tour that disagrees with the tour
 * contract, a non-`closes` row with nothing said about what is left.
 *
 * Exported so both the shared unit test and the API coverage spec judge the
 * table the same way, and so a reader can run it.
 */
export function agentIssueResolutionDefects(): readonly string[] {
    const executable = new Set<string>(AGENT_EXECUTABLE_OPERATIONS);
    const routed = new Set<string>(AGENT_ROUTED_OPERATIONS);
    const defects: string[] = [];
    const seen = new Set<string>();
    for (const resolution of AGENT_ISSUE_RESOLUTIONS) {
        if (seen.has(resolution.code)) defects.push(`${resolution.code}: declared twice`);
        seen.add(resolution.code);
        if (resolution.kind === 'assist_operation' && !executable.has(resolution.operation ?? '')) {
            defects.push(`${resolution.code}: assist_operation names ${resolution.operation ?? 'nothing'}, which Assist cannot execute`);
        }
        if (resolution.kind === 'assist_route' && !routed.has(resolution.operation ?? '')) {
            defects.push(`${resolution.code}: assist_route names ${resolution.operation ?? 'nothing'}, which is not a routed operation`);
        }
        if (!['assist_operation', 'assist_route'].includes(resolution.kind) && resolution.operation) {
            defects.push(`${resolution.code}: ${resolution.kind} carries an operation`);
        }
        const tour = findGuidedTourForQualityCode(resolution.code);
        if (tour && resolution.tourId !== tour.id) {
            defects.push(`${resolution.code}: the tour contract offers ${tour.id}, the table says ${resolution.tourId ?? 'none'}`);
        }
        if (!tour && resolution.tourId) {
            defects.push(`${resolution.code}: names tour ${resolution.tourId}, which does not claim this code`);
        }
        if (resolution.kind === 'guided_tour' && !resolution.tourId) {
            defects.push(`${resolution.code}: guided_tour with no tour`);
        }
        if (resolution.clears !== 'closes' && !(resolution.note ?? '').trim()) {
            defects.push(`${resolution.code}: ${resolution.clears} without saying what is left to do`);
        }
        if (resolution.misleadingOperation
            && !executable.has(resolution.misleadingOperation.operation)) {
            defects.push(`${resolution.code}: misleadingOperation names ${resolution.misleadingOperation.operation}, which is not executable`);
        }
    }
    return Object.freeze(defects);
}
