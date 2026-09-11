/**
 * ═══ THE TWO FACTS THAT DECIDE WHAT META CHARGES ═══
 *
 * `resolveMessageCategory` is a pure function over evidence, and it is honest
 * about not knowing: with no template category and no window it answers
 * `unknown`, which under `enforce` is a refusal and under `observe` is the most
 * expensive bound. That is the right behaviour for a producer that genuinely
 * cannot tell.
 *
 * The durable lane is not that producer. Both facts are written down in the
 * tenant's own database:
 *
 *   · a template's approval category is in `whatsapp_templates.category`,
 *     synced from Meta, which is the authority on it;
 *   · whether the 24-hour customer service window is open is the age of the
 *     last INBOUND message on the thread.
 *
 * The lane was passing neither. Every template it sent arrived as
 * `template_category_missing` — so a perfectly valid, approved, correctly
 * categorised reminder was refused under `enforce` and priced at the ceiling
 * under `observe`, for a fact sitting one join away.
 *
 * ── WHY THE LOOKUP IS SCOPED BY WABA AND NOT BY NAME ────────────────────────
 *
 * Template names are unique per WABA, not per tenant. A tenant with two numbers
 * on two WABAs can have `recordatorio_24h` approved as UTILITY on one and as
 * MARKETING on the other — a four-fold price difference. Matching on the name
 * alone returns whichever synced last, so the price depends on a sync order
 * nobody controls. With no sender named, "the tenant's catalogue" has a single
 * referent exactly while the tenant has ONE WABA; with two it does not, and
 * `null` is the honest answer.
 */

/** The narrow query primitive both the pooled service and a transaction expose. */
export type PriceFactQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

/**
 * Meta's approved category for one template, as this tenant's sync recorded it.
 *
 * `null` means "not established" — never a default. The admission already knows
 * what to do with an unknown category, and what it does is treat it as
 * expensive rather than as cheap.
 */
export async function approvedTemplateCategory(
    query: PriceFactQuery,
    input: { readonly templateName: string; readonly channelAccountId?: string | null },
): Promise<string | null> {
    const name = String(input.templateName ?? '').trim();
    if (!name) return null;
    const sender = String(input.channelAccountId ?? '').trim();
    const rows = await query<any[]>(
        `SELECT t.category
           FROM whatsapp_templates t
           JOIN whatsapp_channels c ON c.id = t.channel_id
          WHERE t.name = $1 AND t.category IS NOT NULL
            AND c.meta_waba_id IS NOT NULL
            AND c.meta_waba_id = CASE
                WHEN $2 <> '' THEN (
                    SELECT meta_waba_id FROM whatsapp_channels
                     WHERE phone_number_id = $2 LIMIT 1)
                ELSE (
                    SELECT MIN(meta_waba_id) FROM whatsapp_channels
                     WHERE meta_waba_id IS NOT NULL
                    HAVING COUNT(DISTINCT meta_waba_id) = 1)
                END
          ORDER BY t.last_sync_at DESC NULLS LAST LIMIT 1`,
        [name, sender]);
    const category = rows?.[0]?.category;
    return category ? String(category) : null;
}

/** Meta's window, in the units Meta states it in. */
export const SERVICE_WINDOW_HOURS = 24;

/**
 * Is the 24-hour customer service window open on this thread?
 *
 * `undefined` means unreadable — distinct from `false`, which is a claim. The
 * caller passes `undefined` straight through, and `resolveMessageCategory`
 * treats an absent window as "not established" rather than as "closed", which
 * is what keeps a database hiccup from refusing a deliverable message.
 *
 * ── WHY THIS IS NOT ASSUMED FOR PROACTIVE TRAFFIC ───────────────────────────
 *
 * The lane used to hardcode `false` for everything proactive, reasoning that
 * nobody wrote to us. That is right about a reminder to a customer who last
 * spoke in March and wrong about the very common case of a reminder to somebody
 * who wrote twenty minutes ago — and under `enforce` "wrong" means a refusal for
 * a message Meta would have delivered as a free service reply. The window is a
 * fact about the thread, so it is read off the thread.
 */
export async function serviceWindowOpen(
    query: PriceFactQuery, conversationId: string | null | undefined,
): Promise<boolean | undefined> {
    const id = String(conversationId ?? '').trim();
    if (!id) return undefined;
    const rows = await query<any[]>(
        // `clock_timestamp()`, not `now()`: `now()` freezes at BEGIN, and a
        // window that closed while the transaction ran is a window that closed.
        `SELECT MAX(created_at) > clock_timestamp() - INTERVAL '${SERVICE_WINDOW_HOURS} hours'
                AS open
           FROM messages
          WHERE conversation_id = $1::uuid AND direction = 'inbound'`,
        [id]);
    const open = rows?.[0]?.open;
    // No inbound message at all: the window was never opened. That IS a fact,
    // and it is `false`.
    return open === null || open === undefined ? false : Boolean(open);
}

/**
 * Everything the admission needs to price one dispatch row, read from the
 * tenant's own database.
 *
 * Never throws. A fact that cannot be read comes back absent, and absent is
 * what `resolveMessageCategory` is designed to receive — the alternative,
 * letting the read failure propagate, would turn an unreadable catalogue into a
 * dropped message.
 */
export async function dispatchPriceFacts(
    query: PriceFactQuery,
    input: {
        readonly itemKind: string;
        readonly templateName?: string | null;
        readonly channelAccountId?: string | null;
        readonly conversationId?: string | null;
        readonly onUnreadable?: (what: string, error: unknown) => void;
    },
): Promise<{
    readonly template: { readonly name: string; readonly category: string | null } | null;
    readonly insideServiceWindow: boolean | undefined;
}> {
    const isTemplate = input.itemKind === 'template';
    const name = String(input.templateName ?? '').trim();
    let category: string | null = null;
    if (isTemplate && name) {
        try {
            category = await approvedTemplateCategory(query,
                { templateName: name, channelAccountId: input.channelAccountId });
        } catch (error) {
            input.onUnreadable?.(`template category for ${name}`, error);
        }
    }
    let insideServiceWindow: boolean | undefined;
    try {
        insideServiceWindow = await serviceWindowOpen(query, input.conversationId);
    } catch (error) {
        input.onUnreadable?.('service window', error);
    }
    return {
        template: isTemplate && name ? { name, category } : null,
        insideServiceWindow,
    };
}
