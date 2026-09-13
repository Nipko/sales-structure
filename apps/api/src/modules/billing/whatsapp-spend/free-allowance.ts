/**
 * ═══ THE THOUSAND FREE SERVICE MESSAGES, PER NUMBER, PER MONTH ═══
 *
 * Meta's own words, from the October 2026 rate-card update: "Each month, every
 * business phone number will receive 1,000 free service messages; Meta will
 * only charge as of the 1,001st service message delivered. These free service
 * messages do not roll over if not used in a specific month and reset monthly,
 * for each business phone number."
 *
 * Four facts are load-bearing and each of them was got wrong somewhere before:
 *
 *   · PER NUMBER, not per WABA and not per tenant. A Pro plan with two numbers
 *     has two thousand free messages, and saying otherwise both under-counts a
 *     customer's benefit and over-counts their bill.
 *   · PER CALENDAR MONTH IN THE NUMBER'S OWN ZONE. Not the server's month. For
 *     a WABA in Bogotá the two disagree for five hours at every boundary, and
 *     an allowance attached to the wrong month is an allowance that applies to
 *     nothing.
 *   · SERVICE ONLY. Utility templates inside the 24-hour window became
 *     chargeable in the same update and explicitly do NOT consume this quota;
 *     marketing and authentication never did. Letting a utility template eat a
 *     free service message makes the customer pay twice: once for the template,
 *     and once for the service reply that no longer had a free slot.
 *   · NO ROLL-OVER. An unused month is gone. A counter that carried a remainder
 *     forward would show a business a benefit Meta will not honour.
 *
 * ── WHY THE NUMBER LIVES HERE AND IS STILL CONFIGURABLE ─────────────────────
 *
 * It is a fact about Meta's pricing, so it belongs beside the rate cards rather
 * than in a settings table somebody has to populate before the platform counts
 * correctly — a default of zero would have silently charged every tenant from
 * their first message. But it is a fact that CHANGES: it was 1,000 conversations
 * before November 2024, nothing at all between then and October 2026, and 1,000
 * messages after. So a tenant can be given a different figure when Meta gives
 * them one, and the override is read from the account rather than guessed.
 */

/** Meta's published allowance, per business phone number, per calendar month. */
export const FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH = 1000;

/**
 * Which of Meta's five categories draw on the free allowance.
 *
 * Exactly one. Written as a set rather than a comparison so the reason survives
 * the next person reading it: the other four are chargeable from the first
 * message, and a category we could not classify is NOT eligible — treating an
 * unknown as free would hand out an allowance on a guess.
 */
const ALLOWANCE_ELIGIBLE_CATEGORIES: ReadonlySet<string> = new Set(['service']);

export function consumesFreeAllowance(category: string | null | undefined): boolean {
    return ALLOWANCE_ELIGIBLE_CATEGORIES.has(String(category ?? '').trim().toLowerCase());
}

/**
 * How many free deliveries this number gets this month.
 *
 * `override` is whatever the account row says, when a business has been told a
 * different figure by Meta. Anything that is not a whole number of messages is
 * ignored rather than coerced: `"1000"` typed into a JSON field is fine, `-5`
 * and `"unlimited"` are not, and silently reading either as a number is how an
 * account ends up with an allowance nobody intended.
 */
export function freeAllowanceFor(override?: unknown): number {
    if (override === null || override === undefined || override === '') {
        return FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH;
    }
    const parsed = typeof override === 'number' ? override : Number(String(override).trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
        return FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH;
    }
    return parsed;
}

/** Where a per-number override is written, so the reader and the writer agree. */
export const FREE_ALLOWANCE_METADATA_KEY = 'whatsappFreeServiceMessages';

/** The override for one account, read from its metadata blob. */
export function freeAllowanceFromMetadata(metadata: unknown): number {
    const blob = (metadata ?? {}) as Record<string, unknown>;
    return freeAllowanceFor(blob[FREE_ALLOWANCE_METADATA_KEY]);
}
