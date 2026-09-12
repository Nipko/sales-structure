/**
 * Which ceilings one outbound effect is measured against, and in what order the
 * rows are taken.
 *
 * ── WHY SEVERAL AT ONCE ─────────────────────────────────────────────────────
 *
 * A single WhatsApp delivery can cross five different limits: what the account
 * may spend this month, what the business portfolio may spend, what one contact
 * may cost before somebody looks at the conversation, how much of the number's
 * free thousand is left, and what the campaign that produced it was budgeted
 * for. They protect different things and the strictest one wins, so a reservation
 * has to be measured against all of them and released back to all of them.
 *
 * ── WHY THE ORDER IS FIXED ──────────────────────────────────────────────────
 *
 * Two producers reserving at the same time each lock several counter rows. If
 * one takes `account` then `contact` while the other takes `contact` then
 * `account`, PostgreSQL resolves it by killing one of them with a deadlock —
 * under load, at the exact moment the platform is busiest. One total order,
 * declared here and used by every writer, removes the possibility rather than
 * retrying afterwards.
 *
 * The allowance goes FIRST because it decides how many of the batch are free,
 * and the money rows can only be sized once that split is known.
 */

/** Every ceiling an effect can be measured against. */
export const SPEND_SCOPE_KINDS = ['number_month', 'account', 'business', 'contact', 'task'] as const;
export type SpendScopeKind = (typeof SPEND_SCOPE_KINDS)[number];

/**
 * ═══ ONE OF THESE SCOPES IS NOT A CEILING ═══
 *
 * `number_month` is not a limit anybody chose. It IS Meta's free thousand:
 * `ensureCounters` seeds the row `cap_kind = 'deliveries'`,
 * `cap_deliveries = 1000`, and `grantFreeDeliveries` hands out free slots with
 * `LEAST(used_deliveries + n, cap_deliveries)` against that exact row. The
 * counter and the allowance are the same object.
 *
 * So a tenant writing to it is not setting a limit, it is editing what Meta
 * gives them — in either direction, and both are bad:
 *
 *   · raise `cap_deliveries` and the ledger hands out free deliveries Meta
 *     bills in full, recorded `basis: 'free_allowance'` at zero, so the
 *     exposure report shows a month that cost nothing;
 *   · set a money cap with no delivery cap and `cap_kind` becomes `'money'`,
 *     `cap_deliveries` becomes NULL, `grantFreeDeliveries` matches nothing, and
 *     every message is charged from the first for the rest of the month. That
 *     is verbatim the regression `ensureCounters` documents as fixed.
 *
 * A subtraction rather than a second list, so adding a scope kind above cannot
 * silently leave it undeclarable — or, worse, declarable when it should not be.
 */
export const TENANT_DECLARABLE_SCOPE_KINDS: readonly SpendScopeKind[] =
    SPEND_SCOPE_KINDS.filter(kind => kind !== 'number_month');

/** Is this a scope a person is allowed to set a ceiling on? */
export function isTenantDeclarableScope(kind: string): kind is SpendScopeKind {
    return (TENANT_DECLARABLE_SCOPE_KINDS as readonly string[]).includes(kind);
}

/**
 * The one total order every writer takes counter rows in.
 *
 * Index in this array IS the lock order. Adding a scope means deciding where it
 * belongs here, once, rather than in each writer.
 */
export const SPEND_LOCK_ORDER: readonly SpendScopeKind[] = SPEND_SCOPE_KINDS;

export interface SpendScope {
    readonly kind: SpendScopeKind;
    /** The identity being capped: an account id, a business id, a contact id. */
    readonly key: string;
    /** `YYYY-MM` or `YYYY-MM-DD`, in the WABA's own zone. Never the server's. */
    readonly period: string;
}

/** What an effect knows about itself, before any ceiling is consulted. */
export interface SpendScopeSubject {
    readonly channelAccountId: string;
    readonly payerWabaId?: string | null;
    readonly payerBusinessId?: string | null;
    readonly contactId?: string | null;
    /** The campaign, broadcast or automation batch that produced this effect. */
    readonly taskId?: string | null;
    /** `YYYY-MM` in the WABA zone: the month the free allowance resets with. */
    readonly allowanceMonth: string;
    /** The period money is capped over. Usually the same month. */
    readonly spendPeriod: string;
}

const clean = (value?: string | null): string => String(value ?? '').trim();

/**
 * The scopes this effect must be measured against, already in lock order.
 *
 * A scope whose identity is unknown is OMITTED rather than keyed on an empty
 * string: `scope_key = ''` would put every effect with no contact into one
 * shared counter, and the first such conversation would exhaust a ceiling that
 * belongs to nobody.
 */
export function scopesFor(subject: SpendScopeSubject): readonly SpendScope[] {
    const candidates: Partial<Record<SpendScopeKind, string>> = {
        number_month: clean(subject.channelAccountId),
        account: clean(subject.channelAccountId),
        business: clean(subject.payerBusinessId) || clean(subject.payerWabaId),
        contact: clean(subject.contactId),
        task: clean(subject.taskId),
    };
    return Object.freeze(SPEND_LOCK_ORDER.flatMap(kind => {
        const key = candidates[kind];
        if (!key) return [];
        // The allowance is counted per number per calendar MONTH, whatever the
        // money period is: one is Meta's rule and the other is ours.
        const period = kind === 'number_month' ? subject.allowanceMonth : subject.spendPeriod;
        return [Object.freeze({ kind, key, period })];
    }));
}

/**
 * Sort scopes into the canonical order.
 *
 * Used on a path that receives scopes from somewhere else — a recovered
 * reservation, a caller's own list — so the order is a property of the writer
 * rather than of whoever assembled the array.
 */
export function inLockOrder(scopes: readonly SpendScope[]): readonly SpendScope[] {
    const rank = (scope: SpendScope) => SPEND_LOCK_ORDER.indexOf(scope.kind);
    return Object.freeze([...scopes].sort((left, right) =>
        rank(left) - rank(right)
        || left.key.localeCompare(right.key)
        || left.period.localeCompare(right.period)));
}

/** Stable identity of a scope, for a map key or a log line. */
export function scopeId(scope: SpendScope): string {
    return `${scope.kind}/${scope.key}/${scope.period}`;
}
