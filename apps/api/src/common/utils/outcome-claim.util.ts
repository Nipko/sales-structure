/**
 * Did the agent tell the customer something happened that never happened?
 *
 * This is the failure that costs the most and shows the least. In production the
 * guard returned "nothing executed, ask for confirmation" and the agent replied
 * "¡Tu reserva está confirmada! 🎉" — the customer walked away believing they
 * had an apartment for two nights, and the backend had no reservation at all.
 * Nothing in the logs said anything was wrong: the turn looked perfectly healthy.
 *
 * Reserving, paying and cancelling are things the backend does. The agent can
 * only report them. So a reply that asserts one of those in the past tense is
 * only truthful when a tool actually succeeded in that same turn.
 */

/**
 * Past-tense completion claims in the four supported languages, restricted to
 * the operations that touch money or capacity.
 *
 * Deliberately narrow: it must not fire on "puedo reservarte", "¿confirmas?" or
 * "voy a generar el enlace", which are proposals and questions, not claims. Only
 * the shapes that leave a customer believing the deed is done.
 */
const COMPLETION_CLAIM = new RegExp(
    [
        // es — "tu reserva está confirmada", "quedó reservado", "ya está pagado"
        'reserva (esta|quedo|fue) (confirmada|hecha|creada|realizada)',
        '(esta|quedo|fue) (confirmada|confirmado|reservada|reservado|pagada|pagado|cancelada|cancelado|agendada|agendado)',
        '(reserve|agende|cancele|cobre) (tu|su|la|el)',
        'ya (esta|quedo) (confirmad|reservad|pagad|cancelad|agendad)',
        // en — "your booking is confirmed", "has been booked"
        '(booking|reservation|appointment|payment) (is|has been|was) (confirmed|booked|created|cancelled|canceled|paid)',
        '(has|have) been (confirmed|booked|cancelled|canceled|paid)',
        // pt — "sua reserva esta confirmada", "foi reservado"
        'reserva (esta|foi) (confirmada|feita|criada)',
        '(foi|esta) (confirmado|confirmada|reservado|reservada|pago|paga|cancelado|cancelada)',
        // fr — "votre reservation est confirmee"
        'reservation est (confirmee|creee|effectuee)',
        'a ete (confirmee|reservee|annulee|payee)',
    ].join('|'),
);

/** Same normalisation the confirmation classifier uses: accents and case are noise. */
function normalize(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

export function claimsCompletedAction(reply: unknown): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    return COMPLETION_CLAIM.test(normalize(reply));
}

/**
 * A tool result counts as success only when it says so. An `error` field, a
 * `success: false`, or the guard asking for confirmation all mean the operation
 * did NOT happen — which is precisely the state the agent kept narrating as done.
 */
export function toolResultSucceeded(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    const row = result as Record<string, unknown>;
    if (row.error) return false;
    if (row.success === false) return false;
    return true;
}

export interface TurnClaimAudit {
    /** The agent asserted an action was completed. */
    claimed: boolean;
    /** At least one tool actually completed in this turn. */
    backed: boolean;
    /** Claimed something that never happened. */
    falseClaim: boolean;
}

/**
 * Fallback recogniser for tools that commit something, used when the caller does
 * not supply the canonical registry predicate.
 *
 * The original `^(create|cancel|…)_` prefix list silently missed every writer
 * that does not start with one of those verbs — `place_order`, `book_class`,
 * `enroll_student`, `register_pet`, `file_claim`, `apply_discount`,
 * `freeze_membership`, `calculate_quote` — which is most of what the vertical
 * toolsets actually close a sale with. A booking that really happened would then
 * be audited as a lie.
 */
const BACKING_TOOL_NAME = new RegExp(
    '^(create|cancel|reschedule|update|confirm|charge|refund|place|book|enroll'
    + '|register|file|apply|freeze|calculate|request|schedule|submit)_'
    + '|^get_placement_test_link$',
);

export interface TurnClaimAuditOptions {
    /**
     * Canonical "this tool commits a business change" predicate. Callers inside
     * the API pass the tool-policy registry so the audit tracks the real writer
     * set instead of a name heuristic.
     */
    isBackingTool?: (name: string) => boolean;
}

/**
 * Audit one turn: what the agent said against what the backend did.
 *
 * Only calls to tools that change something count as backing. A successful
 * availability lookup does not make "your booking is confirmed" true.
 *
 * The asymmetry matters. Denying a booking that DID happen pushes the customer
 * back into confirming something already paid for — the loop the owner reported
 * — while letting one exotic claim through costs a single wrong sentence. So an
 * unknown tool (MCP, opaque) that succeeded counts as backing: we cannot prove
 * it did nothing, and the safe direction here is to believe the backend.
 */
export function auditTurnClaim(
    reply: unknown,
    toolCalls: Array<{ name?: string; result?: unknown }> | undefined,
    options: TurnClaimAuditOptions = {},
): TurnClaimAudit {
    const claimed = claimsCompletedAction(reply);
    const isBacking = options.isBackingTool || ((name: string) => BACKING_TOOL_NAME.test(name));
    const backed = (toolCalls || []).some((call) => (
        typeof call?.name === 'string'
        && isBacking(call.name)
        && toolResultSucceeded(call.result)
        // Escrita pero NO confirmada: el dueño exige pago y el cupo sigue a la
        // venta. La operación existe —por eso `toolResultSucceeded` es true— y
        // aun asi no respalda un "quedó confirmada": sin esta linea el guardrail
        // avalaba exactamente la mentira que la politica de pago existe para
        // evitar.
        && (call.result as any)?.awaitingPayment !== true
    ));
    return { claimed, backed, falseClaim: claimed && !backed };
}
