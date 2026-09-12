import { inLockOrder, isTenantDeclarableScope, scopeId, type SpendScope, type SpendScopeKind }
    from './spend-scopes';

/**
 * The money engine's SQL, as pure functions over a caller's transaction.
 *
 * ── THE THREE FAILURES THIS SHAPE EXISTS FOR ────────────────────────────────
 *
 * 1. **Two producers take the last budget at the same time.** The invariant goes
 *    INTO the statement — `WHERE cap - settled - reserved >= $n` — so zero rows
 *    returned IS the refusal. The second writer blocks on the row lock,
 *    re-evaluates against what the first committed, and fails. There is no
 *    comparison in application code to get wrong.
 *
 * 2. **A timeout after acceptance.** Nothing here releases on a timeout. Release
 *    needs a positive negative: an explicit rejection with no message id.
 *    Everything else keeps the money counted and visible as exposure.
 *
 * 3. **An uncertain COMMIT.** The reservation row is the single witness, and it
 *    is addressable by a key the caller recomputes from the effect alone. A
 *    worker that lost its connection asks `WHERE effect_key = $1`: row present
 *    means the transaction committed, row absent means it did not.
 *
 * Nothing in this file opens a transaction. The caller owns it, because the
 * reservation and the counter increment have to commit together or the row
 * stops being a witness for the increment.
 */

export type SpendQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export class SpendLedgerError extends Error {
    constructor(readonly code: string, detail?: string) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'SpendLedgerError';
    }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMA = /^tenant_[a-z0-9_]+$/;

function assertSchema(schema: string): void {
    if (!SCHEMA.test(schema)) throw new SpendLedgerError('spend_schema_invalid', schema);
}

/** What a counter row limits. `observe` counts without ever refusing. */
export type SpendCapKind = 'money' | 'deliveries' | 'observe' | 'both';

export interface SpendCounterRow {
    readonly scope: SpendScope;
    readonly capKind: SpendCapKind;
    readonly capMinor: number | null;
    readonly capDeliveries: number | null;
    readonly currency: string | null;
    readonly reservedMinor: number;
    readonly settledMinor: number;
    readonly releasedMinor: number;
    /** HELD: committed, delivered or not. What a ceiling is decided against. */
    readonly usedDeliveries: number;
    readonly freeDeliveries: number;
    /**
     * Actually delivered.
     *
     * The difference from `usedDeliveries` is exactly the work nobody has
     * resolved yet. Meta's free allowance is spent on DELIVERY, so a thousand
     * failed attempts must not exhaust a thousand free deliveries.
     */
    readonly confirmedDeliveries: number;
    /** Where "warn" and "stop the proactive" sit, as a fraction of the cap. */
    readonly warnPermille: number;
    readonly softPermille: number;
}

/**
 * ═══ SIX ANSWERS TO TWO DIFFERENT QUESTIONS ═══
 *
 * "Did it arrive?" and "what did it cost?" are not the same question, and for
 * a while this type pretended they were. A `wamid` from the POST was recorded
 * as `pending_reconciliation` with `remote_state='delivered'`, and 72 hours
 * later the reconciler settled it at the reserved amount. A message Meta
 * accepted and never delivered appeared in the books as a confirmed charge,
 * under evidence named `reconciled_at_reserved_amount` — a phrase that sounds
 * like an invoice and means "nobody looked".
 *
 *   `held`        Reserved. The POST has not resolved.
 *   `accepted`    Meta has the message. Whether it arrived is UNKNOWN, and the
 *                 charge lands on delivery — so the exposure is retained and
 *                 no amount of waiting turns it into a charge.
 *   `pending_reconciliation`
 *                 It arrived, and nobody could compute what it cost.
 *   `estimated`   It arrived, nobody could compute the cost, and the grace
 *                 period elapsed. The upper bound is kept AS AN ESTIMATE — the
 *                 most honest thing that can be said without an invoice, said
 *                 by its own name.
 *   `indeterminate`
 *                 We cannot say whether it arrived at all.
 *   `settled` / `released`
 *                 Finished. Money moved, or provably did not.
 *
 * `settled` now means exactly one thing: an AUTHORITY stated the amount — Meta
 * with `billable:false`, the published rate over a confirmed delivery, or an
 * imported invoice. Time is not an authority.
 */
export type ReservationState =
    'held' | 'accepted' | 'settled' | 'released'
    | 'pending_reconciliation' | 'estimated' | 'indeterminate';

/**
 * The states a LATER authority may still resolve.
 *
 * `held` is the sending attempt's own outcome. The rest are what an attempt
 * leaves behind when it could not say what happened. All of them keep the full
 * amount counted, and all of them are waiting for exactly this — a status
 * webhook minutes later, or a reconciliation against what Meta billed.
 *
 * Settling and releasing used to accept `held` and nothing else, so every
 * receipt that arrived after the POST found a row it could not touch and the
 * exposure stayed on the books for ever. `settled` and `released` are
 * deliberately absent: an effect whose money has already moved is finished, and
 * a duplicate or out-of-order event must not move it again.
 */
export const RESOLVABLE_STATES: readonly ReservationState[] =
    Object.freeze(['held', 'accepted', 'pending_reconciliation',
        'estimated', 'indeterminate']);

/**
 * Every state whose money is still counted against a cap.
 *
 * Used by the reads that answer "how much of this account's ceiling is
 * committed". Listed once, here, because the last time this set existed in
 * several SQL literals one of them was missed and a whole state's worth of
 * exposure disappeared from the report.
 */
export const EXPOSED_STATES: readonly ReservationState[] =
    Object.freeze(['held', 'accepted', 'pending_reconciliation',
        'estimated', 'indeterminate']);

/** The identity a retry adopts instead of resolving the connection again. */
export interface ReservationIdentity {
    readonly tenantId: string;
    readonly channelType: string;
    readonly channelAccountId: string;
    readonly channelAddress?: string | null;
    readonly payerKind: 'business_direct' | 'partner' | 'unknown';
    readonly payerWabaId?: string | null;
    readonly payerBusinessId?: string | null;
    readonly credentialId: string;
    readonly credentialSource: 'channel_account' | 'tenant_credential' | 'system_user';
    readonly recipientScope: 'customer' | 'test_recipient' | 'internal' | 'synthetic';
    /** A contact id or a hashed address. NEVER the raw phone number. */
    readonly recipientRef: string;
    readonly category: string;
    readonly market?: string | null;
    readonly currency: string;
    readonly rateVersion?: string | null;
    readonly appliedLocalDate?: string | null;
    readonly admissionReason: string;
}

export interface ReservationMoney {
    readonly basis: 'priced' | 'free_allowance' | 'free_entry_point' | 'unknown';
    readonly decision: 'accepted' | 'unknown';
    readonly reservedMinor: number;
    readonly unitCeilingMinor: number;
    readonly exactMicros: number;
    readonly freeDeliveries: number;
    readonly chargedDeliveries: number;
}

export interface ReservationBinding {
    readonly inboundMessageId?: string | null;
    readonly batchId?: string | null;
    readonly dispatchItemId?: string | null;
    readonly itemIndex?: number | null;
}

export interface ReservationRow {
    readonly id: string;
    readonly effectKey: string;
    readonly state: ReservationState;
    readonly identity: ReservationIdentity;
    readonly money: ReservationMoney;
    readonly binding: ReservationBinding;
    readonly chargedMinor: number | null;
    readonly providerMessageId: string | null;
    readonly remoteState: string | null;
    readonly evidence: string | null;
    readonly reason: string | null;
    readonly leaseExpiresAt: Date;
    readonly attempts: number;
    readonly adopted: number;
    readonly createdAt: Date;
}

function mapReservation(row: any): ReservationRow {
    return Object.freeze({
        id: String(row.id),
        effectKey: String(row.effect_key),
        state: String(row.state) as ReservationState,
        identity: Object.freeze({
            tenantId: String(row.tenant_id),
            channelType: String(row.channel_type),
            channelAccountId: String(row.channel_account_id),
            channelAddress: row.channel_address ?? null,
            payerKind: String(row.payer_kind) as ReservationIdentity['payerKind'],
            payerWabaId: row.payer_waba_id ?? null,
            payerBusinessId: row.payer_business_id ?? null,
            credentialId: String(row.credential_id),
            credentialSource: String(row.credential_source) as ReservationIdentity['credentialSource'],
            recipientScope: String(row.recipient_scope) as ReservationIdentity['recipientScope'],
            recipientRef: String(row.recipient_ref),
            category: String(row.category),
            market: row.market ?? null,
            currency: String(row.currency),
            rateVersion: row.rate_version ?? null,
            appliedLocalDate: row.applied_local_date
                ? new Date(row.applied_local_date).toISOString().slice(0, 10) : null,
            admissionReason: String(row.admission_reason),
        }),
        money: Object.freeze({
            basis: String(row.basis) as ReservationMoney['basis'],
            decision: String(row.decision) as ReservationMoney['decision'],
            reservedMinor: Number(row.reserved_minor),
            unitCeilingMinor: Number(row.unit_ceiling_minor),
            exactMicros: Number(row.exact_micros),
            freeDeliveries: Number(row.free_deliveries),
            chargedDeliveries: Number(row.charged_deliveries),
        }),
        binding: Object.freeze({
            inboundMessageId: row.inbound_message_id ?? null,
            batchId: row.batch_id ?? null,
            dispatchItemId: row.dispatch_item_id ?? null,
            itemIndex: row.item_index === null || row.item_index === undefined
                ? null : Number(row.item_index),
        }),
        chargedMinor: row.charged_minor === null || row.charged_minor === undefined
            ? null : Number(row.charged_minor),
        providerMessageId: row.provider_message_id ?? null,
        remoteState: row.remote_state ?? null,
        evidence: row.evidence ?? null,
        reason: row.reason ?? null,
        leaseExpiresAt: new Date(row.lease_expires_at),
        attempts: Number(row.attempts),
        adopted: Number(row.adopted),
        createdAt: new Date(row.created_at),
    });
}

/** Find the reservation for this effect, if one was ever committed. */
/**
 * The reservation a provider receipt is about.
 *
 * A status webhook knows the wamid and nothing else: it never saw an effect key
 * and could not compute one — the body it was rendered from is long gone. The
 * id is written onto the row by whichever attempt got an answer from Meta, so
 * this is the only road from a receipt back to the money.
 *
 * Ordered so the newest row wins if a provider id somehow appears twice; that
 * should not happen and the ordering is here so it degrades to "the current
 * one" rather than to "whichever the planner returned first".
 */
export async function findReservationByProviderMessage(
    query: SpendQuery, schema: string, providerMessageId: string,
): Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `SELECT * FROM "${schema}".whatsapp_spend_reservations
          WHERE provider_message_id = $1
          ORDER BY created_at DESC LIMIT 1`, [providerMessageId]);
    return rows[0] ? mapReservation(rows[0]) : null;
}

export async function findReservation(query: SpendQuery, schema: string, effectKey: string):
    Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `SELECT * FROM "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`, [effectKey]);
    return rows[0] ? mapReservation(rows[0]) : null;
}

/**
 * Make sure every scope this effect is measured against has a counter row.
 *
 * `INSERT … ON CONFLICT DO NOTHING` as its own statement, then the locking read
 * — separate statements because PgBouncer in transaction mode will not take a
 * multi-statement string, and because the insert must not hold a lock it does
 * not need.
 *
 * A counter that did not exist is created as `observe`: counting from the first
 * message, refusing nobody, until somebody configures a ceiling. Creating it as
 * a zero-money cap would silence a tenant who never asked for a limit.
 */
export async function ensureCounters(query: SpendQuery, schema: string, scopes: readonly SpendScope[],
    currency: string, freeAllowance?: number): Promise<void> {
    assertSchema(schema);
    for (const scope of inLockOrder(scopes)) {
        // ── THE ALLOWANCE IS SEEDED WITH THE COUNTER, OR IT NEVER EXISTS ────
        //
        // `number_month` is the row Meta's thousand free service messages live
        // in, and it was being created like every other scope: `cap_kind =
        // 'observe'` with a null `cap_deliveries`. `grantFreeDeliveries`
        // matches on `cap_kind = 'deliveries'`, so it found no row, granted
        // nothing, and every tenant was charged from their first message while
        // the panel showed a thousand free ones waiting.
        //
        // Seeded on INSERT only. A month already under way keeps the figure it
        // started with: changing a ceiling mid-period retroactively rewrites
        // what a business was told it had.
        const isAllowance = scope.kind === 'number_month' && freeAllowance !== undefined;
        await query(
            `INSERT INTO "${schema}".whatsapp_spend_counters
                (scope_kind, scope_key, period_key, cap_kind, currency, cap_deliveries)
             VALUES ($1,$2,$3,$5,$4,$6)
             ON CONFLICT (scope_kind, scope_key, period_key) DO NOTHING`,
            [scope.kind, scope.key, scope.period, currency,
                isAllowance ? 'deliveries' : 'observe',
                isAllowance ? Math.max(0, Math.trunc(freeAllowance!)) : null]);
    }
}

/**
 * Take the counter rows in the one canonical order, FOR UPDATE.
 *
 * The order is what stops two producers capping different scopes from
 * deadlocking each other. Returned as a map so the caller reads them by scope
 * rather than by position.
 */
export async function lockCounters(query: SpendQuery, schema: string, scopes: readonly SpendScope[]):
    Promise<Map<string, SpendCounterRow>> {
    assertSchema(schema);
    const locked = new Map<string, SpendCounterRow>();
    for (const scope of inLockOrder(scopes)) {
        const rows = await query<any[]>(
            `SELECT * FROM "${schema}".whatsapp_spend_counters
              WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3 FOR UPDATE`,
            [scope.kind, scope.key, scope.period]);
        if (!rows[0]) continue;
        locked.set(scopeId(scope), Object.freeze({
            scope,
            capKind: String(rows[0].cap_kind) as SpendCapKind,
            capMinor: rows[0].cap_minor === null ? null : Number(rows[0].cap_minor),
            capDeliveries: rows[0].cap_deliveries === null ? null : Number(rows[0].cap_deliveries),
            currency: rows[0].currency ?? null,
            reservedMinor: Number(rows[0].reserved_minor),
            settledMinor: Number(rows[0].settled_minor),
            releasedMinor: Number(rows[0].released_minor),
            usedDeliveries: Number(rows[0].used_deliveries),
            freeDeliveries: Number(rows[0].free_deliveries),
            confirmedDeliveries: Number(rows[0].confirmed_deliveries ?? 0),
            warnPermille: Number(rows[0].warn_permille),
            softPermille: Number(rows[0].soft_permille),
        }));
    }
    return locked;
}

/**
 * Grant free deliveries out of a number's monthly allowance, atomically.
 *
 * The split happens INSIDE the statement. Deciding it beforehand is the same
 * read-then-write bug wearing different clothes: with 999 used and two producers
 * each sending one, both would see a free delivery available and only one is.
 *
 * Returns how many of `deliveries` were actually free.
 */
export async function grantFreeDeliveries(query: SpendQuery, schema: string, scope: SpendScope,
    deliveries: number): Promise<number> {
    assertSchema(schema);
    if (deliveries <= 0) return 0;
    // ── WHY THE PRE-IMAGE IS A `FROM` SUBQUERY AND NOT A SIBLING CTE ────────
    //
    // The obvious shape — `WITH before AS (SELECT … FOR UPDATE), granted AS
    // (UPDATE … RETURNING …) SELECT granted - before` — is wrong twice over, and
    // the concurrency test caught both:
    //
    //   · With `FOR UPDATE` in the CTE it returns ZERO ROWS. Sibling CTEs cannot
    //     see each other's effects, and a locking read of a row the same command
    //     has already updated yields nothing, so the caller reads "no free
    //     deliveries" for a delivery it just consumed.
    //   · Without `FOR UPDATE` it double-grants. In READ COMMITTED the CTE reads
    //     the statement snapshot, so a second transaction that started before the
    //     first committed sees 999, blocks on the UPDATE, is re-evaluated against
    //     the new row to 1000, and reports 1000 − 999 = one free delivery that
    //     somebody else already took.
    //
    // Read inside the UPDATE's own `FROM`, the lock and the pre-image are the
    // same act: EvalPlanQual re-runs the subquery against the committed row, so
    // the second writer reads 1000, computes `LEAST(1001, 1000) = 1000`, and
    // returns zero. The split is decided by the row, not by a snapshot.
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_counters AS target
            SET used_deliveries = LEAST(target.used_deliveries + $4, target.cap_deliveries),
                free_deliveries = target.free_deliveries
                    + LEAST(target.used_deliveries + $4, target.cap_deliveries) - target.used_deliveries,
                updated_at = clock_timestamp()
           FROM (SELECT scope_kind, scope_key, period_key, used_deliveries AS was
                   FROM "${schema}".whatsapp_spend_counters
                  WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3 AND cap_kind='deliveries'
                  FOR UPDATE) AS pre
          WHERE target.scope_kind = pre.scope_kind AND target.scope_key = pre.scope_key
            AND target.period_key = pre.period_key
         RETURNING target.used_deliveries - pre.was AS free_granted`,
        [scope.kind, scope.key, scope.period, deliveries]);
    return rows[0] ? Number(rows[0].free_granted) : 0;
}

/**
 * Hand back free deliveries that were held for a message that never arrived.
 *
 * Used only where the caller has no allocation row to travel on — a grant that
 * was taken and then refused inside the same authorisation, before anything was
 * recorded. Everything that got as far as a reservation goes back through
 * `applyToCounters`, which is the one place that knows what each counter was
 * holding.
 *
 * `GREATEST(0, …)` because this must be safe to run twice: a retry that reached
 * here after the first attempt already returned the grant would otherwise take
 * the counter negative, and a negative allowance reads on screen as a business
 * that has used less than nothing.
 */
export async function returnFreeDeliveries(query: SpendQuery, schema: string,
    scope: SpendScope, deliveries: number): Promise<void> {
    assertSchema(schema);
    if (deliveries <= 0) return;
    await query(
        `UPDATE "${schema}".whatsapp_spend_counters
            SET used_deliveries = GREATEST(0, used_deliveries - $4),
                free_deliveries = GREATEST(0, free_deliveries - $4),
                confirmed_deliveries = LEAST(confirmed_deliveries,
                    GREATEST(0, used_deliveries - $4)),
                updated_at = clock_timestamp()
          WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3 AND cap_kind='deliveries'`,
        [scope.kind, scope.key, scope.period, Math.trunc(deliveries)]);
}

/**
 * How close this counter is to its ceiling, AFTER the reservation being asked
 * about.
 *
 * A single number — the ceiling — can only do one thing: let everything through
 * until, from one message to the next, it lets nothing through. To the business
 * owner that is indistinguishable from an outage, and it makes no distinction
 * between the campaign they scheduled and the customer who just wrote in.
 *
 *   · `clear`     — nothing to say.
 *   · `warning`   — tell somebody. Stops nothing.
 *   · `soft_stop` — stop what WE start: campaigns, drips, reminders, follow-ups.
 *                   A person who wrote to the business still gets answered.
 *   · `hard_stop` — stop everything chargeable.
 *
 * The soft stop is the one that earns its keep. Spending is not one thing: a
 * budget exhausted by a broadcast should not silence the reply to a customer
 * asking where their order is, and a platform that cannot tell those apart has
 * to choose between overspending and going mute.
 */
export type SpendPressure = 'clear' | 'warning' | 'soft_stop' | 'hard_stop';

/**
 * Did WE start this exchange, or did the customer?
 *
 * Read from the producer, never inferred from the content: guessing intent from
 * a message body is how a platform decides that a person asking for help is a
 * marketing blast. `reactive` passes the soft stop; `proactive` does not.
 */
export type SpendDisposition = 'reactive' | 'proactive';

const PRESSURE_ORDER: Readonly<Record<SpendPressure, number>> =
    Object.freeze({ clear: 0, warning: 1, soft_stop: 2, hard_stop: 3 });

/** The highest pressure of a set of scopes — one full scope decides for all. */
export function worstPressure(values: readonly SpendPressure[]): SpendPressure {
    return values.reduce<SpendPressure>((worst, value) =>
        PRESSURE_ORDER[value] > PRESSURE_ORDER[worst] ? value : worst, 'clear');
}

/**
 * The pressure of a counter, in SQL, from whichever row version is in scope.
 *
 * Written once and used from both the `UPDATE … RETURNING` (which sees the NEW
 * row, so the answer is the state the reservation just produced) and the
 * refusal read (which sees the current row plus the amount that was asked for).
 * Two hand-written copies of this arithmetic would eventually disagree, and the
 * one place they would disagree is the boundary between "warned" and "stopped".
 *
 * No division anywhere: comparing `used * 1000` against `cap * permille` avoids
 * both integer truncation and a division by a zero cap. A zero cap therefore
 * reads as `hard_stop`, which is what a zero cap means.
 */
function pressureSql(alias: string, addMinor: string, addDeliveries: string): string {
    // ── WHAT A CEILING HAS COMMITTED ────────────────────────────────────────
    //
    // Settled plus still-held. NOT minus released, and the difference is not a
    // refinement — it is the difference between a limit and a way to mint one.
    //
    // `applyToCounters` already takes the amount OUT of `reserved_minor` when a
    // reservation settles or is released. Subtracting `released_minor` here as
    // well gives the money back a second time: reserve 10 and settle 6 leaves
    // (reserved 0, settled 6, released 4), and the old formula read that as
    // "2 used" and offered cap − 2 when only cap − 6 was left. Worse, a refused
    // reservation of 8 leaves (0, 0, 8) and the formula offered cap + 8 — so a
    // recipient who rejects everything became a way to raise the ceiling, once
    // per rejection, for ever.
    //
    // `released_minor` stays on the row as the honest historical metric it was
    // always documented to be: "what did this account reserve and not use". It
    // is simply not part of the operational balance.
    const spent = `(${alias}.settled_minor + ${alias}.reserved_minor + ${addMinor})`;
    const used = `(${alias}.used_deliveries + ${addDeliveries})`;
    // ── MONEY AND MESSAGES APPLY TOGETHER, AND THE WORSE ONE WINS ───────────
    //
    // A ceiling used to be one or the other, which leaves unprotected exactly
    // what has to be protected from October. The thousand free service
    // deliveries per number per month are a MESSAGE quota that costs no money:
    // a money ceiling does not limit them at all. A tenant can burn the whole
    // franchise without spending a cent, and from then on every message is
    // charged — which is the moment the money ceiling starts working, already
    // too late.
    //
    // `both` carries the two columns and takes the WORSE pressure: whichever
    // fills first is the one that decides.
    const moneyPressure = `CASE
            WHEN ${spent} >= ${alias}.cap_minor THEN 'hard_stop'
            WHEN ${spent} * 1000 >= ${alias}.cap_minor * ${alias}.soft_permille THEN 'soft_stop'
            WHEN ${spent} * 1000 >= ${alias}.cap_minor * ${alias}.warn_permille THEN 'warning'
            ELSE 'clear' END`;
    const deliveryPressure = `CASE
            WHEN ${used} >= ${alias}.cap_deliveries THEN 'hard_stop'
            WHEN ${used} * 1000 >= ${alias}.cap_deliveries * ${alias}.soft_permille THEN 'soft_stop'
            WHEN ${used} * 1000 >= ${alias}.cap_deliveries * ${alias}.warn_permille THEN 'warning'
            ELSE 'clear' END`;
    // Ordered worst-first, so `LEAST` over the rank picks the worse of the two
    // without needing the vocabulary repeated in SQL.
    const rank = (expression: string) => `CASE ${expression}
            WHEN 'hard_stop' THEN 0 WHEN 'soft_stop' THEN 1
            WHEN 'warning' THEN 2 ELSE 3 END`;
    return `CASE
        WHEN ${alias}.cap_kind = 'observe' THEN 'clear'
        WHEN ${alias}.cap_kind = 'money' THEN ${moneyPressure}
        WHEN ${alias}.cap_kind = 'both' THEN CASE
            LEAST(${rank(moneyPressure)}, ${rank(deliveryPressure)})
            WHEN 0 THEN 'hard_stop' WHEN 1 THEN 'soft_stop'
            WHEN 2 THEN 'warning' ELSE 'clear' END
        ELSE ${deliveryPressure}
    END`;
}

/**
 * How full these ceilings are right now, with nothing added.
 *
 * Needed by the adoption path, which reserves nothing — the amount was counted
 * by the attempt being adopted — but still owes the caller an honest answer
 * about how close the ceiling is. Returning `clear` there because no reservation
 * happened would report a full account as empty on every retry.
 */
export async function readPressure(query: SpendQuery, schema: string,
    scopes: readonly SpendScope[]): Promise<SpendPressure> {
    assertSchema(schema);
    const values: SpendPressure[] = [];
    for (const scope of scopes) {
        const [row] = await query<any[]>(
            `SELECT ${pressureSql('c', '0', '0')} AS pressure
               FROM "${schema}".whatsapp_spend_counters AS c
              WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3`,
            [scope.kind, scope.key, scope.period]);
        if (row) values.push(String(row.pressure) as SpendPressure);
    }
    return worstPressure(values);
}

export interface TaskBudget {
    readonly capKind: SpendCapKind;
    readonly capDeliveries: number | null;
    readonly capMinor: number | null;
    /** What the task had already spent when the budget was declared. */
    readonly usedDeliveries: number;
}

/**
 * Declare what one batch is allowed to cost, BEFORE it fans out.
 *
 * A campaign launched for five hundred recipients should be incapable of
 * producing five thousand charges. Nothing in the per-message ceilings stops
 * that: an account cap is shared with every other producer, and the batch's own
 * size is known only at launch. So the size becomes a ceiling of its own, and
 * because every worker reserves against it inside its own statement, ten
 * parallel workers cannot collectively exceed it — which is the property a
 * budget checked in application code would not have.
 *
 * The ceiling is expressed in DELIVERIES rather than money when the operator has
 * not set an amount. Deliveries need no rate card, no currency and no market, so
 * the bound exists even for an account the pricing cannot resolve — and "at most
 * N messages" is what a launch actually authorises.
 *
 * `used_deliveries + n` on an existing counter, not `n`: relaunching a campaign
 * queues only the recipients still pending, and a ceiling of "the pending count"
 * would hard-stop a campaign that had already sent half of itself.
 */
/**
 * ═══ A CEILING AN OPERATOR SET, ON A CONNECTION THEY OWN ═══
 *
 * `declareTaskBudget` is the size of ONE batch, declared by the producer that
 * launches it. This is the other kind: a standing limit a person put on an
 * account, a business or a number's month, which every producer then spends
 * against.
 *
 * Nothing wrote one. `whatsapp_spend_counters` has had the columns since the
 * ledger was built and the reservation path has always honoured them, but the
 * only rows anybody created were the free-allowance counter and per-task
 * budgets — so a tenant could not say "never more than fifty dollars a month on
 * this number", which is the first thing somebody asks for when messages start
 * costing money.
 *
 * ── MONEY AND MESSAGES TOGETHER ─────────────────────────────────────────────
 *
 * Both may be set at once, and the worse one decides. A money ceiling alone
 * does not protect the thousand free service deliveries, because those cost
 * nothing: the whole franchise can be spent without the money ceiling moving,
 * and from then on every message is charged.
 *
 * ── WHAT LOWERING A CEILING MEANS ───────────────────────────────────────────
 *
 * A standing ceiling is ABSOLUTE, unlike a task budget — which tops itself up
 * from where the task already is, so a relaunch is not capped below its own
 * progress. Somebody lowering a monthly limit below what has already been spent
 * means "stop", and the pressure predicate reads that as `hard_stop` on the
 * next reservation without any special case here. Silently raising it to what
 * was already spent would be the system overruling the person.
 *
 * ── AND WHAT A CEILING CANNOT PROMISE ───────────────────────────────────────
 *
 * It bounds what PARALLLY sends. The same WhatsApp account can be charged by
 * another app, by a person using Meta's own inbox, or by an obligation from
 * before the limit existed. The product has to say so where the number is
 * shown; here it is enough that the function does not pretend otherwise.
 */
export interface SpendCeiling {
    readonly scopeKind: SpendScopeKind;
    readonly scopeKey: string;
    readonly periodKey: string;
    readonly capKind: 'money' | 'deliveries' | 'observe' | 'both';
    readonly capMinor: number | null;
    readonly capDeliveries: number | null;
    readonly currency: string | null;
    readonly warnPermille: number;
    readonly softPermille: number;
    /** What has already been committed against it, so the caller can show it. */
    readonly settledMinor: number;
    readonly reservedMinor: number;
    readonly usedDeliveries: number;
}

/**
 * Set, change or remove a standing ceiling.
 *
 * Passing neither a money nor a delivery ceiling sets `observe`: the counter
 * keeps measuring and stops refusing. That is a real operator choice — "I want
 * to see it before I limit it" — and it is deliberately not the same as
 * deleting the row, which would also throw away what has been counted.
 */
export async function declareSpendCeiling(query: SpendQuery, schema: string, input: {
    readonly scope: SpendScope;
    readonly capMinor?: number | null;
    readonly capDeliveries?: number | null;
    readonly currency?: string | null;
    readonly warnPermille?: number;
    readonly softPermille?: number;
}): Promise<SpendCeiling> {
    assertSchema(schema);
    // ── ONE OF THESE SCOPES IS NOT A CEILING ────────────────────────────────
    //
    // This is the invariant, not the validation. The route checks the same
    // thing and answers 400, but the route is one caller: a script, a job or
    // the next endpoint reaches this function directly, and the statement below
    // is an `ON CONFLICT DO UPDATE` that overwrites `cap_kind` and
    // `cap_deliveries` on whatever row it lands on. For `number_month` that row
    // IS Meta's free thousand — raise it and the ledger hands out free
    // deliveries Meta bills in full; turn it into a money row and
    // `grantFreeDeliveries` stops matching and every message is charged from
    // the first, which is verbatim the regression `ensureCounters` records as
    // fixed.
    if (!isTenantDeclarableScope(input.scope.kind)) {
        throw new SpendLedgerError('spend_ceiling_scope_not_declarable',
            `${input.scope.kind} no es un techo que fije el tenant: es la franquicia gratuita `
            + 'de Meta para ese número. Para acotar ese mismo número, use el alcance `account`.');
    }
    // `Number(null)` is 0, and `Number(undefined)` is NaN. Reading the first as
    // a ceiling of zero turned "no money ceiling" into "may spend nothing" —
    // which then demanded a currency, and refused a perfectly valid
    // messages-only ceiling. Absence is checked BEFORE the number.
    const asCap = (value: unknown): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
    };
    const money = asCap(input.capMinor);
    const deliveries = asCap(input.capDeliveries);
    const capKind = money !== null && deliveries !== null ? 'both'
        : money !== null ? 'money'
            : deliveries !== null ? 'deliveries' : 'observe';
    // The currency belongs to the WhatsApp account being billed, and a money
    // ceiling without one cannot be compared to anything. Refused rather than
    // defaulted: a ceiling of "50" in a currency nobody named is a number that
    // will be read as whichever currency the reader expects.
    const currency = input.currency ? String(input.currency).toUpperCase() : null;
    if ((capKind === 'money' || capKind === 'both') && !currency) {
        throw new SpendLedgerError('spend_ceiling_currency_required',
            'un techo de dinero necesita la moneda de la cuenta de WhatsApp');
    }
    const warn = clampPermille(input.warnPermille, 800);
    const soft = clampPermille(input.softPermille, 950);
    if (warn > soft) {
        throw new SpendLedgerError('spend_ceiling_thresholds_out_of_order',
            `aviso ${warn} por mil no puede ir despues del freno ${soft}`);
    }

    const [row] = await query<any[]>(
        `INSERT INTO "${schema}".whatsapp_spend_counters
            (scope_kind, scope_key, period_key, cap_kind, cap_minor, cap_deliveries, currency,
             warn_permille, soft_permille)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (scope_kind, scope_key, period_key) DO UPDATE
            SET cap_kind = EXCLUDED.cap_kind,
                -- Absolute, NOT topped up from what is already spent. Somebody
                -- lowering a limit below the spend means stop, and the pressure
                -- predicate reads that as a hard stop on the next reservation.
                cap_minor = EXCLUDED.cap_minor,
                cap_deliveries = EXCLUDED.cap_deliveries,
                currency = EXCLUDED.currency,
                warn_permille = EXCLUDED.warn_permille,
                soft_permille = EXCLUDED.soft_permille,
                updated_at = clock_timestamp()
         RETURNING scope_kind, scope_key, period_key, cap_kind, cap_minor, cap_deliveries,
                   currency, warn_permille, soft_permille,
                   settled_minor, reserved_minor, used_deliveries`,
        [input.scope.kind, input.scope.key, input.scope.period, capKind,
            money, deliveries, currency, warn, soft]);
    return mapCeiling(row);
}

/** Every standing ceiling on one period, for the screen that shows them. */
export async function readSpendCeilings(query: SpendQuery, schema: string, input: {
    readonly periodKey?: string | null;
    readonly scopeKind?: SpendScopeKind | null;
}): Promise<readonly SpendCeiling[]> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `SELECT scope_kind, scope_key, period_key, cap_kind, cap_minor, cap_deliveries,
                currency, warn_permille, soft_permille,
                settled_minor, reserved_minor, used_deliveries
           FROM "${schema}".whatsapp_spend_counters
          WHERE ($1::text IS NULL OR period_key = $1)
            AND ($2::text IS NULL OR scope_kind = $2)
          ORDER BY period_key DESC, scope_kind, scope_key`,
        [input.periodKey ?? null, input.scopeKind ?? null]);
    return Object.freeze(rows.map(mapCeiling));
}

const clampPermille = (value: unknown, fallback: number): number => {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 && number <= 1000 ? number : fallback;
};

function mapCeiling(row: any): SpendCeiling {
    return Object.freeze({
        scopeKind: String(row.scope_kind) as SpendScopeKind,
        scopeKey: String(row.scope_key),
        periodKey: String(row.period_key),
        capKind: String(row.cap_kind) as SpendCeiling['capKind'],
        capMinor: row.cap_minor === null ? null : Number(row.cap_minor),
        capDeliveries: row.cap_deliveries === null ? null : Number(row.cap_deliveries),
        currency: row.currency === null ? null : String(row.currency),
        warnPermille: Number(row.warn_permille),
        softPermille: Number(row.soft_permille),
        settledMinor: Number(row.settled_minor),
        reservedMinor: Number(row.reserved_minor),
        usedDeliveries: Number(row.used_deliveries),
    });
}

export async function declareTaskBudget(query: SpendQuery, schema: string, input: {
    readonly taskId: string;
    readonly period: string;
    readonly deliveries?: number;
    readonly capMinor?: number | null;
    readonly currency: string;
    readonly warnPermille?: number;
    readonly softPermille?: number;
}): Promise<TaskBudget> {
    assertSchema(schema);
    const warn = input.warnPermille ?? 800;
    // ── WHY A TASK CEILING HAS NO SOFT STOP BY DEFAULT ──────────────────────
    //
    // The soft stop exists to protect replies from campaigns on a SHARED
    // ceiling — the account, the contact, the number's month. A task ceiling is
    // not shared: it is one batch's own size, and the only thing spending it is
    // that batch.
    //
    // Left at 950, a campaign launched for a hundred people would stop at
    // ninety-five. Five people never hear from the business, the campaign
    // reports itself incomplete, and the limit fired on exactly the thing it was
    // set to allow. The suite caught this: five sends against a ceiling of five
    // left `used_deliveries` at four.
    //
    // The warning line stays where it is, so an operator watching a big batch
    // still sees it fill.
    const soft = input.softPermille ?? 1000;
    const money = input.capMinor !== undefined && input.capMinor !== null;
    const [row] = await query<any[]>(
        `INSERT INTO "${schema}".whatsapp_spend_counters
            (scope_kind, scope_key, period_key, cap_kind, cap_minor, cap_deliveries, currency,
             warn_permille, soft_permille)
         VALUES ('task', $1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (scope_kind, scope_key, period_key) DO UPDATE
            SET cap_kind = EXCLUDED.cap_kind,
                cap_minor = EXCLUDED.cap_minor,
                -- The new allowance is measured from where the task already is,
                -- so a relaunch tops the budget up instead of capping below it.
                cap_deliveries = CASE WHEN EXCLUDED.cap_kind = 'deliveries'
                    THEN whatsapp_spend_counters.used_deliveries + EXCLUDED.cap_deliveries
                    ELSE NULL END,
                currency = EXCLUDED.currency,
                warn_permille = EXCLUDED.warn_permille,
                soft_permille = EXCLUDED.soft_permille,
                updated_at = clock_timestamp()
         RETURNING cap_kind, cap_minor, cap_deliveries, used_deliveries`,
        [input.taskId, input.period,
            money ? 'money' : 'deliveries',
            money ? input.capMinor : null,
            money ? null : Math.max(0, input.deliveries ?? 0),
            input.currency, warn, soft]);
    return Object.freeze({
        capKind: String(row.cap_kind) as SpendCapKind,
        capMinor: row.cap_minor === null ? null : Number(row.cap_minor),
        capDeliveries: row.cap_deliveries === null ? null : Number(row.cap_deliveries),
        usedDeliveries: Number(row.used_deliveries),
    });
}

/**
 * What a reservation was refused FOR.
 *
 * `cap` is the ordinary answer: the ceiling said no. `currency` is not a
 * ceiling at all — it is the counter and the reservation disagreeing about what
 * the numbers in them MEAN, which no amount of budget would fix and which a
 * caller must never retry its way out of.
 */
export type ReserveRefusal = 'cap' | 'currency';

export interface ReserveAgainstCounter {
    readonly scope: SpendScope;
    readonly amountMinor: number;
    readonly deliveries: number;
    /**
     * What `amountMinor` is denominated in.
     *
     * Required, and compared against the counter's own: minor units of what is
     * a fact about the counter, not about the arithmetic.
     */
    readonly currency: string;
    /** Defaults to `proactive`: the expensive reading, when nobody said. */
    readonly disposition?: SpendDisposition;
    /**
     * Count this even though the ceiling would have refused it.
     *
     * ONLY for a tenant in `observe`, where the point is to learn what a limit
     * would have stopped without stopping it. The message is going out whatever
     * this function says, so the choice is not "count it or refuse it" — it is
     * "count it or lose it", and losing it means a chargeable POST with no
     * exposure, no ceiling movement and nothing to reconcile against.
     *
     * The currency test still applies. That one is not a ceiling: adding COP
     * centavos to a USD counter would not be a measurement, it would be a
     * wrong number that looks like one.
     */
    readonly overCap?: boolean;
}

export interface ReserveOutcome {
    /** May the effect proceed against THIS counter? */
    readonly ok: boolean;
    /**
     * The ceiling refused, and the amount was counted anyway.
     *
     * Only ever true under `overCap`. It is the difference between "this
     * tenant is inside their limit" and "this tenant is over it and nobody is
     * stopping them yet", which is exactly what an observation is for.
     */
    readonly overCap?: boolean;
    /** Present only on a refusal, and `cap` unless stated otherwise. */
    readonly refusal?: ReserveRefusal;
    /** The currency the counter is already keeping, when that is the problem. */
    readonly counterCurrency?: string | null;
    /**
     * The pressure the reservation produced, or — when it was refused — the
     * pressure it would have produced. Either way it names which of the three
     * heights is in play, so the refusal can say `soft_stop` rather than the
     * undifferentiated `cap_exhausted` that tells an operator nothing.
     */
    readonly pressure: SpendPressure;
}

/**
 * Add this amount to a counter, but only if the ceiling still allows it.
 *
 * The predicate is in the statement. `false` means the cap refused — not an
 * error, a decision — and the caller rolls back rather than sending.
 *
 * An `observe` counter always allows: it exists to know, not to stop.
 *
 * ═══ AND ONLY IF THE TWO AGREE WHAT THE NUMBERS MEAN ═══
 *
 * `reserved_minor` is a count of MINOR UNITS, and minor units of what is a fact
 * about the counter, not about the arithmetic. The primary key is (scope,
 * period) with the currency as an ordinary column, so a month that opened with
 * a USD reservation and later received a COP one used to add 3 500 COP centavos
 * to a counter of US cents: off by a factor of four thousand, in the direction
 * that makes a ceiling look full.
 *
 * The currency test is a PREDICATE in the same statement as the cap, for the
 * same reason the cap is: read-then-write leaves a window two workers can both
 * pass through. The refusal is deliberately NOT a cap refusal — a caller must
 * not retry its way out of it, and an operator must not resolve it by raising a
 * limit. It needs a decision about which currency the period is in.
 */
export async function reserveAgainstCounter(query: SpendQuery, schema: string,
    entry: ReserveAgainstCounter): Promise<ReserveOutcome> {
    assertSchema(schema);
    const { scope, amountMinor, deliveries } = entry;
    const proactive = (entry.disposition ?? 'proactive') === 'proactive';
    // The soft stop is a PREDICATE, not a check the caller runs afterwards. Read
    // first and decide second is the same race the cap itself exists to close:
    // two campaign workers would both read 94 % and both go.
    //
    // `soft_permille >= 1000` disables it, and that branch is not a shortcut —
    // it is required for correctness. The comparison is STRICTLY below, to stay
    // consistent with the pressure function, which reports `soft_stop` from the
    // threshold inclusive. At 1000 that strictness would make the effective
    // ceiling for a proactive send `cap - 1`: a batch of three could send two,
    // and a ceiling "configured as a cliff" would quietly be one lower than the
    // number written on it.
    // `both` has to satisfy BOTH sides, which is why each clause names the
    // kinds it applies to rather than being an either/or chain: a ceiling that
    // carries money and messages must be under its money soft line AND under
    // its message soft line, or the half that is full lets the other half
    // through.
    // Each clause is "if this ceiling HAS a money side, be under it" — not "be
    // a money ceiling and be under it". The second reading refuses a
    // messages-only ceiling outright, because its money disjunct can never
    // hold; the suite caught exactly that, on the plain money path.
    const softClause = proactive
        ? `AND (soft_permille >= 1000
                OR cap_kind NOT IN ('money','both')
                OR (settled_minor + reserved_minor + $4) * 1000
                    < cap_minor * soft_permille)
           AND (soft_permille >= 1000
                OR cap_kind NOT IN ('deliveries','both')
                OR (used_deliveries + $5) * 1000 < cap_deliveries * soft_permille)`
        : '';
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_counters AS c
            SET reserved_minor = reserved_minor + $4,
                used_deliveries = used_deliveries + $5,
                updated_at = clock_timestamp()
          WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3
            -- A counter with no currency yet has not committed to one. A
            -- counter WITH one only accepts amounts denominated in it.
            AND (currency IS NULL OR currency = $6)
            -- Two clauses ANDed rather than one either/or chain, for the same
            -- reason as the soft line: a ceiling carrying BOTH has to have room
            -- on the money side AND on the message side. An OR would let a full
            -- message quota through because the money side still had room,
            -- which is precisely the hole this kind exists to close.
            AND (cap_kind NOT IN ('money','both')
                 OR cap_minor - settled_minor - reserved_minor >= $4)
            AND (cap_kind NOT IN ('deliveries','both')
                 OR cap_deliveries - used_deliveries >= $5)
            ${softClause}
          RETURNING ${pressureSql('c', '0', '0')} AS pressure`,
        [scope.kind, scope.key, scope.period, amountMinor, deliveries, entry.currency]);
    // RETURNING sees the row AFTER the update, so `0` is the right addend: the
    // amount is already in `reserved_minor`.
    if (rows[0]) return { ok: true, pressure: String(rows[0].pressure) as SpendPressure };

    // ── OBSERVED: THE CEILING SAID NO AND THE MESSAGE IS GOING ANYWAY ───────
    //
    // A tenant in `observe` has no enforcement, so refusing here would not stop
    // the send — it would only stop the ACCOUNTING of a send that happens
    // regardless. That was the old behaviour, and it produced exactly the state
    // nobody can recover from: a chargeable POST with no reservation, no
    // exposure, no transmission right and nothing for a receipt to resolve.
    //
    // So the amount is recorded, over the ceiling, and said out loud.
    if (entry.overCap) {
        const forced = await query<any[]>(
            `UPDATE "${schema}".whatsapp_spend_counters AS c
                SET reserved_minor = reserved_minor + $4,
                    used_deliveries = used_deliveries + $5,
                    updated_at = clock_timestamp()
              WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3
                -- The currency still decides. A measurement in the wrong units
                -- is not a measurement.
                AND (currency IS NULL OR currency = $6)
              RETURNING ${pressureSql('c', '0', '0')} AS pressure`,
            [scope.kind, scope.key, scope.period, amountMinor, deliveries, entry.currency]);
        if (forced[0]) {
            return {
                ok: true, overCap: true,
                pressure: String(forced[0].pressure) as SpendPressure,
            };
        }
    }

    // Refused. Say WHICH height refused it, which needs the pressure the
    // reservation WOULD have produced — hence the amount as an addend here.
    const [current] = await query<any[]>(
        `SELECT currency, ${pressureSql('c', '$4', '$5')} AS pressure
           FROM "${schema}".whatsapp_spend_counters AS c
          WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3`,
        [scope.kind, scope.key, scope.period, amountMinor, deliveries]);
    // A counter that vanished between the two statements cannot be reasoned
    // about, and "the ceiling is unknown" must never read as "there is room".
    if (!current) return { ok: false, refusal: 'cap', pressure: 'hard_stop' };
    const counterCurrency = current.currency ?? null;
    if (counterCurrency && counterCurrency !== entry.currency) {
        // Not a ceiling. The two disagree about what their numbers mean, and
        // raising a limit would not change that.
        return {
            ok: false, refusal: 'currency', counterCurrency,
            pressure: String(current.pressure) as SpendPressure,
        };
    }
    return {
        ok: false, refusal: 'cap', counterCurrency,
        pressure: String(current.pressure) as SpendPressure,
    };
}

/**
 * Write the allocation that says how much of this reservation touched a counter.
 *
 * `ON CONFLICT DO NOTHING` on the composite key: a retry that reaches here twice
 * must not double the exposure the cap already authorised once.
 */
export async function recordAllocation(query: SpendQuery, schema: string, reservationId: string,
    entry: ReserveAgainstCounter, currency: string): Promise<void> {
    assertSchema(schema);
    await query(
        `INSERT INTO "${schema}".whatsapp_spend_allocations
            (reservation_id, scope_kind, scope_key, period_key, amount_minor, deliveries, currency)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (reservation_id, scope_kind, scope_key, period_key) DO NOTHING`,
        [reservationId, entry.scope.kind, entry.scope.key, entry.scope.period,
            entry.amountMinor, entry.deliveries, currency]);
}

/**
 * ═══ "¿YA LE DIJIMOS ESTO MISMO, HACE UN RATO?" ═══
 *
 * A different question from the one `effect_key` answers. That key mixes the
 * producer and the ordinal into the hash, so it recognises a RETRY of one
 * effect. It cannot recognise the same sentence arriving by another road, and
 * from 1 October those are the two most expensive invisible wastes:
 *
 *   · Two producers, one message. The appointment reminder and the drip step
 *     say the same thing to the same customer ten minutes apart. Two effect
 *     keys, two charges, two identical notifications on somebody's phone.
 *   · The agent repeating itself. A turn that makes no progress produces the
 *     answer the previous turn produced. The customer writes again, the turn
 *     makes no progress again, and the loop is billed in full.
 *
 * Note what is measured: what WE said. Nothing here reads the customer's words,
 * so a complaint, a person insisting, somebody writing in another language or
 * asking for a human is indistinguishable from any other message and can never
 * become a reason to stop answering them.
 *
 * Only states that PROVE the message existed are counted. A `released`
 * reservation is a proven rejection — the customer received nothing — so trying
 * again is not repeating.
 */
export interface IdenticalDelivery {
    readonly effectKey: string;
    readonly producer: string;
    readonly createdAt: Date;
    readonly state: ReservationState;
}

export async function recentIdenticalDeliveries(query: SpendQuery, schema: string, input: {
    readonly channelAccountId: string;
    readonly recipientRef: string;
    readonly contentDigest: string;
    readonly since: Date;
    readonly limit?: number;
}): Promise<readonly IdenticalDelivery[]> {
    assertSchema(schema);
    if (!String(input.contentDigest || '').trim()) return [];
    const rows = await query<any[]>(
        `SELECT effect_key, admission_reason, created_at, state
           FROM "${schema}".whatsapp_spend_reservations
          WHERE channel_account_id = $1 AND recipient_ref = $2 AND content_digest = $3
            AND created_at >= $4
            AND state IN ('held','accepted','settled',
                          'pending_reconciliation','estimated','indeterminate')
          ORDER BY created_at DESC
          LIMIT ${Math.max(1, Math.min(50, input.limit ?? 10))}`,
        [input.channelAccountId, input.recipientRef, input.contentDigest, input.since.toISOString()]);
    return Object.freeze(rows.map(row => Object.freeze({
        effectKey: String(row.effect_key),
        producer: String(row.admission_reason),
        createdAt: new Date(row.created_at),
        state: String(row.state) as ReservationState,
    })));
}

/**
 * ═══ SIGNALS, NOT SENTENCES ═══
 *
 * What the ledger can honestly say about where a month's money went, so that a
 * business owner can act on it instead of guessing.
 *
 * Every one of these READS. Nothing here blocks anything, and nothing here is a
 * judgement about a person: the ceilings and the repetition rule are separate
 * mechanisms, and neither they nor this ever look at what a customer wrote. The
 * strongest statement any of these makes is "this is what WE did".
 *
 * That distinction is the reason `disposition` is stored. "Twenty messages to
 * somebody who never wrote back" is a count of our own sends. "A difficult
 * customer" would be an invented intent, and this deliberately cannot produce
 * one.
 */
export interface CostlyRecipient {
    /** The hashed address or contact id. Never a phone number. */
    readonly recipientRef: string;
    readonly currency: string;
    /** Messages WE started. */
    readonly proactive: number;
    /** Messages that answered somebody who wrote in. */
    readonly reactive: number;
    readonly settledMinor: number;
    /** Money held against outcomes that never resolved. Exposure, not cost. */
    readonly uncertainMinor: number;
}

export interface CategorySpend {
    readonly category: string;
    readonly market: string | null;
    readonly currency: string;
    readonly deliveries: number;
    readonly settledMinor: number;
    readonly proactive: number;
}

export interface SpendSignals {
    /**
     * Who cost the most, and whether any of it was a conversation.
     *
     * A row with a high `proactive` and a `reactive` of zero is the signal
     * worth acting on: the platform wrote to somebody twenty times and they
     * never once wrote back. That is not a statement about them — it is a
     * statement about twenty messages that produced no conversation.
     */
    readonly costliestRecipients: readonly CostlyRecipient[];
    /** Where the money goes by category and market, never summed across currencies. */
    readonly byCategory: readonly CategorySpend[];
}

/**
 * Read the signals for one window.
 *
 * Grouped by currency everywhere, because adding pesos to dollars produces a
 * number that is wrong in a way nobody notices until they act on it.
 */
export async function readSpendSignals(query: SpendQuery, schema: string, input: {
    readonly since: Date;
    readonly channelAccountId?: string | null;
    readonly limit?: number;
}): Promise<SpendSignals> {
    assertSchema(schema);
    const limit = Math.max(1, Math.min(200, input.limit ?? 20));
    const account = input.channelAccountId ?? null;

    const recipients = await query<any[]>(
        `SELECT recipient_ref, currency,
                count(*) FILTER (WHERE disposition = 'proactive')::int AS proactive,
                count(*) FILTER (WHERE disposition = 'reactive')::int AS reactive,
                COALESCE(sum(charged_minor) FILTER (WHERE state = 'settled'), 0)::bigint AS settled_minor,
                COALESCE(sum(reserved_minor) FILTER (
                    WHERE state IN ('accepted','pending_reconciliation',
                                    'estimated','indeterminate')), 0)::bigint AS uncertain_minor
           FROM "${schema}".whatsapp_spend_reservations
          WHERE created_at >= $1 AND state <> 'released'
            AND ($2::text IS NULL OR channel_account_id = $2)
          GROUP BY recipient_ref, currency
          ORDER BY settled_minor DESC, proactive DESC
          LIMIT ${limit}`,
        [input.since.toISOString(), account]);

    const categories = await query<any[]>(
        `SELECT category, market, currency,
                count(*)::int AS deliveries,
                COALESCE(sum(charged_minor) FILTER (WHERE state = 'settled'), 0)::bigint AS settled_minor,
                count(*) FILTER (WHERE disposition = 'proactive')::int AS proactive
           FROM "${schema}".whatsapp_spend_reservations
          WHERE created_at >= $1 AND state <> 'released'
            AND ($2::text IS NULL OR channel_account_id = $2)
          GROUP BY category, market, currency
          ORDER BY settled_minor DESC`,
        [input.since.toISOString(), account]);

    return Object.freeze({
        costliestRecipients: Object.freeze(recipients.map(row => Object.freeze({
            recipientRef: String(row.recipient_ref),
            currency: String(row.currency),
            proactive: Number(row.proactive),
            reactive: Number(row.reactive),
            settledMinor: Number(row.settled_minor),
            uncertainMinor: Number(row.uncertain_minor),
        }))),
        byCategory: Object.freeze(categories.map(row => Object.freeze({
            category: String(row.category),
            market: row.market === null ? null : String(row.market),
            currency: String(row.currency),
            deliveries: Number(row.deliveries),
            settledMinor: Number(row.settled_minor),
            proactive: Number(row.proactive),
        }))),
    });
}

/**
 * ═══ WHO OWNS THIS EFFECT, DECIDED BEFORE ANY MONEY MOVES ═══
 *
 * `claimReservation` is unique on `effect_key`, so only one row can ever exist
 * for an effect. That is necessary and it is not sufficient, because the old
 * order granted the free allowance and incremented every counter FIRST and
 * claimed the row last:
 *
 *     A: find → nothing      B: find → nothing
 *     A: grant, reserve×N     B: grant, reserve×N      ← both moved money
 *     A: claim → wins         B: claim → nothing, adopts A's row
 *
 * B commits its increments and holds no allocations, so nothing can ever give
 * them back. One effect, one reservation, two charges against every ceiling —
 * and the ceilings are the only thing standing between a bug and a bill.
 *
 * A transaction-scoped advisory lock on the effect key closes it. The lock and
 * the read are one act: whoever holds it either finds the row and adopts, or
 * finds nothing and is the owner for the rest of the transaction. The loser
 * blocks until the winner commits and then SEES the row, so it never reaches a
 * counter at all.
 *
 * The lock is released by COMMIT or ROLLBACK, always, because it is
 * transaction-scoped — a worker that dies mid-authorisation does not pin the
 * effect.
 *
 * ── WHY THIS RETURNS A TOKEN RATHER THAN A BOOLEAN ──────────────────────────
 *
 * So that the counter primitives cannot be reached without it. A boolean is a
 * fact the caller may forget to check; a value the rest of the path needs is
 * one it cannot.
 */
export interface EffectOwnership {
    readonly effectKey: string;
    /** True only for the transaction that may move money for this effect. */
    readonly owned: boolean;
    /** The row that already exists, when somebody else got there first. */
    readonly existing: ReservationRow | null;
}

export async function ownEffect(query: SpendQuery, schema: string,
    effectKey: string): Promise<EffectOwnership> {
    assertSchema(schema);
    if (!String(effectKey || '').trim()) throw new SpendLedgerError('spend_effect_key_empty');
    // `::text` because the primitive this runs through rejects a `void` column —
    // a lock taken without it fails with "column of type void", which reads like
    // a syntax error and is really a missing cast.
    await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS held`,
        [`whatsapp-spend-effect:${schema}:${effectKey}`]);
    const existing = await findReservation(query, schema, effectKey);
    return Object.freeze({ effectKey, owned: !existing, existing: existing ?? null });
}

/**
 * ═══ THE RIGHT TO MAKE THE POST, WHICH IS NOT THE RESERVATION ═══
 *
 * A `held` reservation says the money is set aside. It does not say WHICH of
 * the callers that found it may send the message.
 *
 * With the effect lock in place, two concurrent authorisations already produce
 * one reservation — the loser adopts — and both were then authorised to
 * transmit, because the only question asked was `state === 'held'`. One effect,
 * one reservation, two POSTs.
 *
 * The transmission right is exclusive and leased. Only its holder may make the
 * request, and only its holder may record what came back: a worker whose lease
 * expired cannot overwrite the result of the attempt that replaced it.
 *
 * ── THE TWO CRASHES ─────────────────────────────────────────────────────────
 *
 * `claimed` and `in_flight` are two states because a crash before the POST and
 * a crash after it need opposite answers, and with one state you must pick one
 * and be wrong about the other:
 *
 *   · crashed while `claimed` — the worker took the right and died before
 *     touching the network. It is PROVEN that nothing went out, so the right
 *     returns to `idle` and another worker sends the message. Once.
 *   · crashed while `in_flight` — the request had already begun. Nobody knows
 *     whether Meta processed it. A blind retry is exactly the duplicate this
 *     whole mechanism exists to prevent, so the effect becomes `indeterminate`
 *     and goes to reconciliation.
 *
 * `claimed -> in_flight` is written BEFORE the fetch, never after. After the
 * fetch it would distinguish nothing: anything written then already presupposes
 * the POST happened.
 */
export type TransmitState = 'idle' | 'claimed' | 'in_flight' | 'resolved';

export interface TransmissionGrant {
    readonly effectKey: string;
    /** Present ONLY for the caller that may transmit. */
    readonly token: string;
    readonly expiresAt: Date;
}

export type TransmissionClaim =
    | { readonly kind: 'granted'; readonly grant: TransmissionGrant }
    /** Somebody else holds a live right. This caller must not send. */
    | { readonly kind: 'held_by_other'; readonly expiresAt: Date | null }
    /**
     * A previous attempt died with the request already started.
     *
     * Nobody can say whether Meta processed it, so nobody may send it again.
     * The effect is moved to `indeterminate` by this very call and goes to
     * reconciliation — never to a second POST.
     */
    | { readonly kind: 'uncertain'; readonly since: Date | null }
    /** The effect is over, or was never reservable. Nothing to transmit. */
    | { readonly kind: 'not_transmittable'; readonly state: ReservationState | null };

/**
 * Take the exclusive right to POST this effect, or discover why you may not.
 *
 * ═══ THE ONE THING THIS MUST NEVER DO ═══
 *
 * Hand a second POST to an effect whose first request had already started.
 *
 * The predicate used to recapture `claimed` OR `in_flight` once the lease ran
 * out, and those are opposite situations:
 *
 *   · `claimed` expired — the worker took the right and died BEFORE touching
 *     the network. `markTransmissionInFlight` commits before the fetch
 *     precisely so this is PROVABLE. Recovering it is correct, and it is the
 *     only recovery that puts a message back on its way to a person.
 *   · `in_flight` expired — the request had begun. Meta may have processed it,
 *     answered, and had the answer lost. Granting a new token here is the
 *     duplicate delivery this entire mechanism exists to prevent, and the
 *     customer sees the same message twice while the business pays for both.
 *
 * The old test passed because it ran the sweeper first, which moved the row out
 * of `in_flight` before anyone tried to claim it. Between two sweeps — which is
 * a window minutes wide — a direct claim took the right and sent again.
 *
 * One statement, so the check and the take cannot be separated by another
 * worker. `clock_timestamp()` rather than `now()`: `now()` freezes at BEGIN, so
 * a transaction that has been open a while would read an expired lease as live
 * and refuse work it should do.
 */
export async function claimTransmission(query: SpendQuery, schema: string, input: {
    readonly effectKey: string;
    readonly leaseSeconds: number;
}): Promise<TransmissionClaim> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET transmit_token = gen_random_uuid(),
                transmit_state = 'claimed',
                transmit_expires_at = clock_timestamp()
                    + make_interval(secs => $2::double precision),
                attempts = attempts + 1,
                updated_at = clock_timestamp()
          WHERE effect_key = $1
            AND state = 'held'
            -- Free, or abandoned BEFORE the network was touched. in_flight is
            -- deliberately absent: see the header of this function.
            AND (transmit_state = 'idle'
                 OR (transmit_state = 'claimed'
                     AND transmit_expires_at < clock_timestamp()))
         RETURNING transmit_token, transmit_expires_at`,
        [input.effectKey, input.leaseSeconds]);

    if (rows[0]) {
        return Object.freeze({
            kind: 'granted' as const,
            grant: Object.freeze({
                effectKey: input.effectKey,
                token: String(rows[0].transmit_token),
                expiresAt: new Date(rows[0].transmit_expires_at),
            }),
        });
    }

    // Nothing updated. Say WHY, because "somebody is sending it", "somebody
    // already sent it and we do not know what happened" and "it is over" are
    // three different things to the caller and to an operator.
    const [current] = await query<any[]>(
        // `lease_expired` is computed BY THE DATABASE, against the same
        // `clock_timestamp()` the UPDATE above used. Comparing a
        // database-generated timestamp with the application's own clock would
        // make this answer depend on how far the two have drifted — and the
        // two answers are "wait for the holder" and "nobody may ever send this
        // again", which is not a difference to leave to NTP.
        `SELECT state, transmit_state, transmit_expires_at,
                (transmit_expires_at IS NOT NULL
                 AND transmit_expires_at < clock_timestamp()) AS lease_expired
           FROM "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`,
        [input.effectKey]);
    if (!current) return Object.freeze({ kind: 'not_transmittable' as const, state: null });
    if (String(current.state) !== 'held') {
        return Object.freeze({
            kind: 'not_transmittable' as const, state: String(current.state) as ReservationState,
        });
    }
    const expiresAt = current.transmit_expires_at
        ? new Date(current.transmit_expires_at) : null;
    if (String(current.transmit_state) === 'in_flight' && current.lease_expired === true) {
        // Resolved here and now rather than left for the sweeper. The caller is
        // about to decide what to do with this effect, and leaving it `held`
        // means the NEXT caller asks the same question and gets the same answer
        // — a spin that keeps an unknowable effect looking retryable.
        await query(
            `UPDATE "${schema}".whatsapp_spend_reservations
                SET state = 'indeterminate',
                    reason = COALESCE(reason, 'in_flight_lease_expired'),
                    remote_state = COALESCE(remote_state, 'unknown'),
                    transmit_state = 'resolved', transmit_token = NULL,
                    transmit_expires_at = NULL,
                    updated_at = clock_timestamp()
              WHERE effect_key = $1 AND state = 'held' AND transmit_state = 'in_flight'
                AND transmit_expires_at < clock_timestamp()`,
            [input.effectKey]);
        return Object.freeze({ kind: 'uncertain' as const, since: expiresAt });
    }
    return Object.freeze({ kind: 'held_by_other' as const, expiresAt });
}

/**
 * Record, durably, that the request is about to begin.
 *
 * The one line that separates "provably sent nothing" from "nobody knows". It
 * must be committed before the fetch, and the caller must treat a false return
 * as "somebody took this right from me" and send nothing.
 */
export async function markTransmissionInFlight(query: SpendQuery, schema: string,
    grant: TransmissionGrant): Promise<boolean> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET transmit_state = 'in_flight', updated_at = clock_timestamp()
          WHERE effect_key = $1 AND transmit_token = $2::uuid
            AND transmit_state = 'claimed' AND state = 'held'
         RETURNING effect_key`,
        [grant.effectKey, grant.token]);
    return rows.length > 0;
}

/**
 * Give the right back without sending, when the caller decides not to.
 *
 * Only from `claimed`: an `in_flight` effect cannot be handed back, because
 * nobody can prove it did not happen.
 */
export async function releaseTransmission(query: SpendQuery, schema: string,
    grant: TransmissionGrant): Promise<boolean> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET transmit_token = NULL, transmit_state = 'idle', transmit_expires_at = NULL,
                updated_at = clock_timestamp()
          WHERE effect_key = $1 AND transmit_token = $2::uuid AND transmit_state = 'claimed'
         RETURNING effect_key`,
        [grant.effectKey, grant.token]);
    return rows.length > 0;
}

/**
 * ═══ A REFUSAL THE PROVIDER INVITED US TO REPEAT ═══
 *
 * A 429, a documented rate limit, a `is_transient: true`. The provider REFUSED
 * — nothing was created, nothing was delivered, nobody was billed — and its own
 * contract says the identical request may succeed later.
 *
 * That is an outcome of the ATTEMPT, not of the EFFECT. The message is still
 * owed to the customer. Recording it as a rejection released the reservation
 * and resolved the transmission right, so the retry found a `released` row,
 * `mayTransmit` said no, and the effect was refused as `effect_already_resolved`
 * — one rate limit, one message silently abandoned for ever. Recording it as a
 * timeout was worse: it retains money for a message that provably never
 * existed, and never releases.
 *
 * So the reservation stays `held` — same amount, same identity, no second
 * reservation — and only the send right goes back to `idle`. The next attempt
 * re-claims THE SAME row, which is what makes "no duplicate reservation and no
 * duplicate POST" true rather than hoped for.
 *
 * From `in_flight` as well as `claimed`, and that is safe precisely because the
 * provider answered: a refusal is evidence the request was processed and
 * declined, which is the one thing an ordinary `in_flight` timeout can never
 * establish.
 */
export async function returnTransmissionAfterRefusal(query: SpendQuery, schema: string, input: {
    readonly effectKey: string;
    /** The right the caller held. A worker whose lease lapsed may not do this. */
    readonly transmitToken: string;
    readonly reason: string;
}): Promise<boolean> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET transmit_state = 'idle', transmit_token = NULL, transmit_expires_at = NULL,
                reason = $3,
                remote_state = 'rejected',
                updated_at = clock_timestamp()
          WHERE effect_key = $1 AND transmit_token = $2::uuid
            AND state = 'held'
            AND transmit_state IN ('claimed','in_flight')
         RETURNING effect_key`,
        [input.effectKey, input.transmitToken, input.reason.slice(0, 200)]);
    return rows.length > 0;
}

/**
 * Expired transmission rights, resolved by what they can prove.
 *
 * `claimed` goes back to `idle` — provably nothing was sent, so the effect is
 * still owed to the customer. `in_flight` becomes `indeterminate` — the request
 * had begun, and a blind retry is the duplicate.
 *
 * ── AND THE RESERVATION LEASE GOES WITH IT ──────────────────────────────────
 *
 * A worker that died holding the send right almost certainly died holding an
 * expiring RESERVATION lease too — they were taken seconds apart. Recovering
 * only the first left the row `held` with a lease already in the past, and the
 * very next step of the same maintenance pass (`sweepExpiredLeases`) turned it
 * into `indeterminate`. The recovery was undone before anything could use it:
 * the message was never re-sent, and the effect was reported as exposure nobody
 * could account for — the exact opposite of what had just been proven about it.
 *
 * So the two leases are harmonised in one statement. `GREATEST` rather than an
 * assignment, so a row whose reservation lease is still comfortably in the
 * future is not shortened by being recovered.
 *
 * Returns both lists, because an operator watching this needs to see them apart:
 * a growing `recovered` is workers dying early, and a growing `uncertain` is
 * money and messages nobody can account for.
 */
export async function sweepTransmissionLeases(
    query: SpendQuery, schema: string, limit = 200, recoveredLeaseSeconds = 900,
): Promise<{ readonly recovered: readonly string[]; readonly uncertain: readonly string[] }> {
    assertSchema(schema);
    const recovered = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET transmit_token = NULL, transmit_state = 'idle', transmit_expires_at = NULL,
                -- The half that was missing. Without it the next step of this
                -- same pass expires the reservation and the recovery is lost.
                lease_expires_at = GREATEST(lease_expires_at,
                    clock_timestamp() + make_interval(secs => $1::double precision)),
                updated_at = clock_timestamp()
          WHERE effect_key IN (
                SELECT effect_key FROM "${schema}".whatsapp_spend_reservations
                 WHERE transmit_state = 'claimed' AND transmit_expires_at < clock_timestamp()
                 ORDER BY transmit_expires_at LIMIT ${Math.max(1, Math.min(1000, limit))})
         RETURNING effect_key`,
        [Math.max(1, Math.trunc(recoveredLeaseSeconds))]);
    const uncertain = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = 'indeterminate',
                transmit_state = 'resolved',
                transmit_token = NULL, transmit_expires_at = NULL,
                reason = COALESCE(reason, 'transmission_lease_expired_in_flight'),
                updated_at = clock_timestamp()
          WHERE effect_key IN (
                SELECT effect_key FROM "${schema}".whatsapp_spend_reservations
                 WHERE transmit_state = 'in_flight' AND transmit_expires_at < clock_timestamp()
                 ORDER BY transmit_expires_at LIMIT ${Math.max(1, Math.min(1000, limit))})
         RETURNING effect_key`);
    return Object.freeze({
        recovered: Object.freeze(recovered.map(row => String(row.effect_key))),
        uncertain: Object.freeze(uncertain.map(row => String(row.effect_key))),
    });
}

/**
 * Claim this effect, or discover that somebody already did.
 *
 * `ON CONFLICT DO NOTHING RETURNING id` is the whole mechanism: no row returned
 * means the effect is already claimed, and the caller adopts that reservation —
 * including its uncertainty — rather than minting a second one.
 */
export async function claimReservation(query: SpendQuery, schema: string, input: {
    readonly effectKey: string;
    readonly identity: ReservationIdentity;
    readonly money: ReservationMoney;
    readonly binding?: ReservationBinding;
    /** What is being said, as a digest. Enables the "again?" question. */
    readonly contentDigest?: string | null;
    /** Did we start this exchange, or did the customer? */
    readonly disposition?: SpendDisposition | null;
    readonly leaseSeconds: number;
}): Promise<ReservationRow | null> {
    assertSchema(schema);
    if (!UUID.test(input.identity.tenantId)) throw new SpendLedgerError('spend_tenant_invalid');
    if (!String(input.effectKey || '').trim()) throw new SpendLedgerError('spend_effect_key_empty');
    // BullMQ rejects ':' in a jobId, and this key is reused as one.
    if (input.effectKey.includes(':')) throw new SpendLedgerError('spend_effect_key_has_colon');

    const rows = await query<any[]>(
        `INSERT INTO "${schema}".whatsapp_spend_reservations (
            effect_key, inbound_message_id, batch_id, dispatch_item_id, item_index,
            tenant_id, channel_type, channel_account_id, channel_address,
            payer_kind, payer_waba_id, payer_business_id,
            credential_id, credential_source, recipient_scope, recipient_ref,
            category, market, currency, rate_version, applied_local_date, admission_reason,
            content_digest, disposition,
            basis, decision, reserved_minor, unit_ceiling_minor, exact_micros,
            free_deliveries, charged_deliveries, lease_expires_at)
         VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20,$21::date,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
                 clock_timestamp() + make_interval(secs => $32::double precision))
         ON CONFLICT (effect_key) DO NOTHING
         RETURNING *`,
        [
            input.effectKey, input.binding?.inboundMessageId ?? null, input.binding?.batchId ?? null,
            input.binding?.dispatchItemId ?? null, input.binding?.itemIndex ?? null,
            input.identity.tenantId, input.identity.channelType, input.identity.channelAccountId,
            input.identity.channelAddress ?? null,
            input.identity.payerKind, input.identity.payerWabaId ?? null,
            input.identity.payerBusinessId ?? null,
            input.identity.credentialId, input.identity.credentialSource,
            input.identity.recipientScope, input.identity.recipientRef,
            input.identity.category, input.identity.market ?? null, input.identity.currency,
            input.identity.rateVersion ?? null, input.identity.appliedLocalDate ?? null,
            input.identity.admissionReason,
            input.contentDigest ?? null, input.disposition ?? null,
            input.money.basis, input.money.decision, input.money.reservedMinor,
            input.money.unitCeilingMinor, input.money.exactMicros,
            input.money.freeDeliveries, input.money.chargedDeliveries,
            Math.max(1, Math.trunc(input.leaseSeconds)),
        ]);
    return rows[0] ? mapReservation(rows[0]) : null;
}

/**
 * Note that a retry reached an existing reservation, and extend its lease.
 *
 * The count is kept because "this effect was retried eleven times" is a fact an
 * operator needs and a log line will not preserve.
 */
export async function adoptReservation(query: SpendQuery, schema: string, effectKey: string,
    leaseSeconds: number): Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET adopted = adopted + 1, attempts = attempts + 1,
                lease_expires_at = GREATEST(lease_expires_at,
                    clock_timestamp() + make_interval(secs => $2::double precision)),
                updated_at = clock_timestamp()
          WHERE effect_key = $1 AND state = 'held'
          RETURNING *`,
        [effectKey, Math.max(1, Math.trunc(leaseSeconds))]);
    // Not `held` any more: settled, released or retained. The caller adopts what
    // it finds rather than re-opening a decision somebody already recorded.
    return rows[0] ? mapReservation(rows[0]) : findReservation(query, schema, effectKey);
}

/** What the provider said, and what that allows. */
export type RemoteOutcome =
    | { readonly kind: 'accepted'; readonly providerMessageId: string }
    | { readonly kind: 'rejected'; readonly errorCode: string }
    | { readonly kind: 'unknown'; readonly detail: string }
    | { readonly kind: 'delivered'; readonly providerMessageId: string; readonly chargedMinor?: number | null };

/**
 * Settle the real charge, exactly once.
 *
 * `WHERE state = 'held' RETURNING` is the idempotence: zero rows means it was
 * already settled, which is success rather than an error to retry.
 *
 * The surplus — what was reserved minus what was charged — is given back to
 * every counter this reservation touched, which is why the allocations exist.
 */
export async function settleReservation(query: SpendQuery, schema: string, input: {
    readonly effectKey: string;
    readonly chargedMinor: number;
    readonly evidence: string;
    readonly providerMessageId?: string | null;
    readonly remoteState?: string | null;
    /**
     * The transmission right this outcome belongs to.
     *
     * Required of a caller that transmitted, so a worker whose lease expired
     * cannot overwrite the result of the attempt that replaced it. Omitted only
     * by writers that did not transmit at all — a status webhook arriving later,
     * or the reconciler.
     */
    readonly transmitToken?: string | null;
    /**
     * Which states this writer may resolve. Defaults to the sending attempt's
     * own `held`; a later authority passes `RESOLVABLE_STATES`.
     */
    readonly fromStates?: readonly ReservationState[];
}): Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = 'settled', charged_minor = $2, evidence = $3,
                provider_message_id = COALESCE($4, provider_message_id),
                remote_state = COALESCE($5, remote_state),
                -- The right is spent with the outcome. A resolved effect has no
                -- live holder, so nothing can claim it again.
                transmit_state = 'resolved', transmit_token = NULL,
                transmit_expires_at = NULL,
                updated_at = clock_timestamp()
          WHERE effect_key = $1 AND state = ANY($7::text[])
            -- The transmission right, when the caller held one. A worker whose
            -- lease expired cannot overwrite the result of the attempt that
            -- replaced it; a writer that did not transmit (a status webhook, the
            -- reconciler) passes nothing and is not gated on it.
            AND ($6::uuid IS NULL OR transmit_token = $6::uuid)
          RETURNING *`,
        [input.effectKey, Math.max(0, Math.trunc(input.chargedMinor)), input.evidence,
            input.providerMessageId ?? null, input.remoteState ?? null,
            input.transmitToken ?? null, [...(input.fromStates ?? ['held'])]]);
    if (!rows[0]) return null;
    const settled = mapReservation(rows[0]);
    await applyToCounters(query, schema, settled.id, 'settled', settled.money.reservedMinor,
        settled.chargedMinor ?? 0);
    return settled;
}

/**
 * Give the whole reservation back.
 *
 * Only ever called with proof: an explicit rejection with no message id, or a
 * send that never happened. A timeout is NOT proof and never reaches here.
 */
export async function releaseReservation(query: SpendQuery, schema: string, input: {
    readonly effectKey: string;
    readonly evidence: string;
    readonly reason?: string | null;
    readonly remoteState?: string | null;
    /**
     * The transmission right this outcome belongs to.
     *
     * Required of a caller that transmitted, so a worker whose lease expired
     * cannot overwrite the result of the attempt that replaced it. Omitted only
     * by writers that did not transmit at all — a status webhook arriving later,
     * or the reconciler.
     */
    readonly transmitToken?: string | null;
    /** Which states this writer may resolve. See `settleReservation`. */
    readonly fromStates?: readonly ReservationState[];
}): Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = 'released', evidence = $2, reason = COALESCE($3, reason),
                remote_state = COALESCE($4, remote_state),
                -- The right is spent with the outcome: a resolved effect has
                -- no live holder, so nothing can claim it again.
                transmit_state = 'resolved', transmit_token = NULL,
                transmit_expires_at = NULL,
                updated_at = clock_timestamp()
          WHERE effect_key = $1 AND state = ANY($6::text[])
            -- The transmission right, when the caller held one. A writer that
            -- did not transmit — a status webhook, the reconciler — passes
            -- nothing and is not gated on it.
            AND ($5::uuid IS NULL OR transmit_token = $5::uuid)
          RETURNING *`,
        [input.effectKey, input.evidence, input.reason ?? null, input.remoteState ?? null,
            input.transmitToken ?? null, [...(input.fromStates ?? ['held'])]]);
    if (!rows[0]) return null;
    const released = mapReservation(rows[0]);
    await applyToCounters(query, schema, released.id, 'released', released.money.reservedMinor, 0);
    return released;
}

/**
 * Keep the exposure and record what is still unknown about it.
 *
 * Four destinations, each answering a different question:
 *
 *   `accepted`               Meta took it. Whether it ARRIVED is unknown, and
 *                            the charge lands on delivery.
 *   `pending_reconciliation` It arrived and nobody could say what it cost.
 *   `estimated`              Same, and the grace elapsed: the bound is kept as
 *                            an estimate rather than turned into a charge.
 *   `indeterminate`          We cannot say whether it arrived at all.
 *
 * All four keep the full amount counted, and none of them is a state a sweeper
 * may turn into a release — or, since this batch, into a charge.
 */
export async function retainReservation(query: SpendQuery, schema: string, input: {
    readonly effectKey: string;
    readonly state: 'accepted' | 'pending_reconciliation' | 'estimated' | 'indeterminate';
    readonly reason: string;
    readonly providerMessageId?: string | null;
    readonly remoteState?: string | null;
    /**
     * The transmission right this outcome belongs to.
     *
     * Required of a caller that transmitted, so a worker whose lease expired
     * cannot overwrite the result of the attempt that replaced it. Omitted only
     * by writers that did not transmit at all — a status webhook arriving later,
     * or the reconciler.
     */
    readonly transmitToken?: string | null;
    /**
     * Which states this transition may start from. Defaults to `held`.
     *
     * An `accepted` row moving to `pending_reconciliation` when its delivery
     * receipt finally lands is a real transition and the default would refuse
     * it — silently, by matching no rows, which is how an effect can sit in
     * `accepted` for ever while every later pass reports success.
     */
    readonly fromStates?: readonly ReservationState[];
}): Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = $2, reason = $3,
                provider_message_id = COALESCE($4, provider_message_id),
                remote_state = COALESCE($5, remote_state),
                -- The right is spent with the outcome: a resolved effect has
                -- no live holder, so nothing can claim it again.
                transmit_state = 'resolved', transmit_token = NULL,
                transmit_expires_at = NULL,
                updated_at = clock_timestamp()
          WHERE effect_key = $1 AND state = ANY($7::text[])
            -- The transmission right, when the caller held one. A writer that
            -- did not transmit — a status webhook, the reconciler — passes
            -- nothing and is not gated on it.
            AND ($6::uuid IS NULL OR transmit_token = $6::uuid)
          RETURNING *`,
        [input.effectKey, input.state, input.reason,
            input.providerMessageId ?? null, input.remoteState ?? null,
            input.transmitToken ?? null, [...(input.fromStates ?? ['held'])]]);
    return rows[0] ? mapReservation(rows[0]) : null;
}

/**
 * Move the money on every counter this reservation touched.
 *
 * Settling turns reserved into settled and hands back the surplus; releasing
 * hands back everything. Both are proportional: a reservation that allocated
 * 8 to the account and 8 to the contact returns to both.
 *
 * `released_minor` is tracked separately rather than subtracted from
 * `reserved_minor`, so "what did this account actually spend this month" and
 * "what did it reserve and not use" stay two different numbers.
 *
 * That was always the intent, and for a while the predicates disagreed with it:
 * they subtracted `released_minor` from the balance a second time, after this
 * function had already taken the amount out of `reserved_minor`. The result was
 * a ceiling that grew by the amount of every rejection. The balance now reads
 * `settled + reserved` and nothing else; see `pressureSql`.
 */
async function applyToCounters(query: SpendQuery, schema: string, reservationId: string,
    state: 'settled' | 'released', reservedMinor: number, chargedMinor: number): Promise<void> {
    const allocations = await query<any[]>(
        `SELECT scope_kind, scope_key, period_key, amount_minor, deliveries
           FROM "${schema}".whatsapp_spend_allocations
          WHERE reservation_id = $1::uuid AND state = 'reserved'
          ORDER BY scope_kind, scope_key, period_key`, [reservationId]);

    for (const allocation of allocations) {
        const allocated = Number(allocation.amount_minor);
        const deliveries = Number(allocation.deliveries ?? 0);
        // The share of the charge this counter carries. Proportional so two
        // counters that reserved different amounts settle different amounts,
        // and integer so nothing is created by rounding.
        const settledHere = state === 'settled' && reservedMinor > 0
            ? Math.min(allocated, Math.round((chargedMinor * allocated) / reservedMinor))
            : 0;
        const returnedHere = allocated - settledHere;
        // ── AND THE DELIVERIES, WHICH USED TO ONLY EVER GO UP ────────────────
        //
        // `reserveAgainstCounter` adds to `used_deliveries` before the POST and
        // nothing ever subtracted. So a delivery-capped counter counted
        // ATTEMPTS: a number with a rejected template burned its whole ceiling
        // without one message arriving, and Meta's thousand free service
        // messages — which Meta itself charges on delivery — were gone after a
        // thousand failures.
        //
        // Released gives them back; settled confirms them. `confirmed` is a
        // second number rather than a move, because "committed" is what a
        // ceiling must be decided against and "delivered" is what a business
        // is actually billed for.
        const returnedDeliveries = state === 'released' ? deliveries : 0;
        const confirmedDeliveries = state === 'settled' ? deliveries : 0;
        await query(
            `UPDATE "${schema}".whatsapp_spend_counters
                SET reserved_minor = GREATEST(0, reserved_minor - $4),
                    settled_minor = settled_minor + $5,
                    released_minor = released_minor + $6,
                    used_deliveries = GREATEST(0, used_deliveries - $7),
                    free_deliveries = GREATEST(0, free_deliveries - $7),
                    confirmed_deliveries = LEAST(
                        confirmed_deliveries + $8,
                        GREATEST(0, used_deliveries - $7)),
                    updated_at = clock_timestamp()
              WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3`,
            [allocation.scope_kind, allocation.scope_key, allocation.period_key,
                allocated, settledHere, returnedHere,
                returnedDeliveries, confirmedDeliveries]);
        await query(
            `UPDATE "${schema}".whatsapp_spend_allocations
                SET state = $5, amount_minor = $6, updated_at = clock_timestamp()
              WHERE reservation_id = $1::uuid AND scope_kind=$2 AND scope_key=$3 AND period_key=$4`,
            [reservationId, allocation.scope_kind, allocation.scope_key, allocation.period_key,
                state, settledHere]);
    }
}

/**
 * Expired leases, moved to `indeterminate` — never to `released`.
 *
 * A reservation held by a crashed worker would otherwise pin budget forever. But
 * the attempt may have reached the provider, so the money stays visible as
 * exposure and an operator gets a number that needs reconciling, which is the
 * honest outcome. Only a reconciliation against Meta's own figures may release
 * it.
 *
 * `clock_timestamp()`, not `now()`: `now()` freezes at BEGIN, and a long sweep
 * using it considers rows unexpired that expired minutes ago.
 */
export async function sweepExpiredLeases(query: SpendQuery, schema: string, limit = 200):
    Promise<readonly string[]> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = 'indeterminate',
                reason = COALESCE(reason, 'lease_expired_without_outcome'),
                updated_at = clock_timestamp()
          WHERE effect_key IN (
                SELECT effect_key FROM "${schema}".whatsapp_spend_reservations
                 WHERE state = 'held' AND lease_expires_at < clock_timestamp()
                 ORDER BY lease_expires_at ASC LIMIT ${Math.max(1, Math.trunc(limit))})
          RETURNING effect_key`);
    return Object.freeze(rows.map(row => String(row.effect_key)));
}

/**
 * ═══ WAITING IS NOT EVIDENCE ═══
 *
 * `pending_reconciliation` is the state a send leaves behind when the message
 * is known to have ARRIVED and nobody could say what it cost: a delivery whose
 * rate card had no row, a currency that was never established.
 *
 * This used to settle those at the reserved amount after 72 hours, under the
 * evidence string `reconciled_at_reserved_amount` — a phrase that reads like an
 * invoice and means "the clock ran out". Combined with an ACK being recorded as
 * a delivery, that turned a message Meta accepted and never delivered into a
 * confirmed charge in the books, with nothing to distinguish it from one that
 * was actually billed.
 *
 * So it no longer settles. It moves the row to `estimated`, which keeps the
 * same upper bound and calls it what it is. A business reading its ceiling sees
 * the same committed money; a business reading its BILL sees only amounts an
 * authority stated. Turning an estimate into a charge needs
 * `settleFromProviderEvidence` and a real invoice line.
 *
 * Deliberately does NOT touch `indeterminate` or `accepted`. Those mean nobody
 * knows whether the message arrived, and no amount of waiting turns
 * not-knowing into evidence. Those go to a person.
 */
export async function estimateDeliveredEffects(query: SpendQuery, schema: string, input: {
    readonly olderThan: Date;
    readonly limit?: number;
}): Promise<readonly ReservationRow[]> {
    assertSchema(schema);
    const limit = Math.max(1, Math.trunc(input.limit ?? 200));
    const due = await query<any[]>(
        `SELECT effect_key FROM "${schema}".whatsapp_spend_reservations
          WHERE state = 'pending_reconciliation' AND updated_at < $1
          ORDER BY updated_at ASC LIMIT ${limit}`, [input.olderThan]);
    const estimated: ReservationRow[] = [];
    for (const row of due) {
        // One at a time and through the normal writer, for the same reason the
        // settlement path does it: a bulk UPDATE here would be a second
        // implementation of a rule that already has one.
        const resolved = await retainReservation(query, schema, {
            effectKey: String(row.effect_key),
            state: 'estimated',
            reason: 'upper_bound_without_invoice',
            fromStates: ['pending_reconciliation'],
        });
        if (resolved) estimated.push(resolved);
    }
    return Object.freeze(estimated);
}

/**
 * Effects Meta accepted and never reported on.
 *
 * A read, never a write, and separate from `staleIndeterminateEffects` because
 * the two states got there by different roads: `accepted` means the POST
 * succeeded and no status webhook ever followed; `indeterminate` means even the
 * POST's outcome is unknown. Both need a person; conflating them would hide
 * which question that person has to answer.
 */
export async function staleAcceptedEffects(query: SpendQuery, schema: string, input: {
    readonly olderThan: Date;
    readonly limit?: number;
}): Promise<readonly ReservationRow[]> {
    assertSchema(schema);
    const limit = Math.max(1, Math.trunc(input.limit ?? 200));
    const rows = await query<any[]>(
        `SELECT * FROM "${schema}".whatsapp_spend_reservations
          WHERE state = 'accepted' AND updated_at < $1
          ORDER BY updated_at ASC LIMIT ${limit}`, [input.olderThan]);
    return Object.freeze(rows.map(mapReservation));
}

/** One line of what a provider says it actually billed. */
export interface ProviderInvoiceLine {
    /** The wamid the invoice line is about. */
    readonly providerMessageId: string;
    /** What the provider says it charged, in minor units of `currency`. */
    readonly chargedMinor: number;
    readonly currency: string;
    /**
     * Which document this came from, and which version of it.
     *
     * Required, and stored: an amount with no provenance is indistinguishable
     * from a number somebody typed, and re-importing a corrected invoice has to
     * be able to say which one it is correcting.
     */
    readonly source: string;
    readonly version: string;
}

export interface InvoiceSettlement {
    readonly applied: number;
    readonly currencyMismatch: readonly string[];
    readonly unknown: readonly string[];
    /**
     * Lines the provider says cost MORE than was ever reserved.
     *
     * Refused rather than applied, because the counters can only settle what
     * was allocated: `applyToCounters` clamps to the allocation, so a larger
     * figure would be written on the reservation and silently truncated in the
     * ceiling — two numbers disagreeing with nobody told.
     *
     * And the disagreement matters on its own. The reserved amount is an upper
     * bound derived from the published rate; an invoice above it means the rate
     * table is wrong, which is a thing to fix rather than to absorb.
     */
    readonly overReserved: readonly string[];
}

/**
 * Settle against what the provider says it actually billed.
 *
 * THE authority, and the only road from an estimate to a charge. Every line
 * carries its document and version, because an amount with no provenance is
 * indistinguishable from a number somebody typed.
 *
 * A line whose currency disagrees with the reservation's is refused rather than
 * converted: adding COP minor units to a USD counter is off by a factor of four
 * thousand, and it is exactly the kind of wrong number nobody questions.
 */
export async function settleFromProviderEvidence(
    query: SpendQuery, schema: string, lines: readonly ProviderInvoiceLine[],
): Promise<InvoiceSettlement> {
    assertSchema(schema);
    let applied = 0;
    const currencyMismatch: string[] = [];
    const unknown: string[] = [];
    const overReserved: string[] = [];
    for (const line of lines) {
        const current = await findReservationByProviderMessage(
            query, schema, line.providerMessageId);
        if (!current) { unknown.push(line.providerMessageId); continue; }
        if (current.identity.currency !== line.currency) {
            currencyMismatch.push(line.providerMessageId);
            continue;
        }
        if (Math.trunc(line.chargedMinor) > current.money.reservedMinor) {
            overReserved.push(line.providerMessageId);
            continue;
        }
        const resolved = await settleReservation(query, schema, {
            effectKey: current.effectKey,
            chargedMinor: Math.max(0, Math.trunc(line.chargedMinor)),
            evidence: `provider_invoice:${line.source}@${line.version}`.slice(0, 120),
            providerMessageId: line.providerMessageId,
            remoteState: 'delivered',
            fromStates: RESOLVABLE_STATES,
        });
        if (resolved) applied += 1;
    }
    return Object.freeze({
        applied,
        currencyMismatch: Object.freeze(currencyMismatch),
        unknown: Object.freeze(unknown),
        overReserved: Object.freeze(overReserved),
    });
}

/**
 * Effects nobody can resolve without a person looking.
 *
 * A read, never a write. `indeterminate` means the request went out and no
 * answer ever came back — no receipt, no rejection, nothing. Meta sends a
 * status for everything it accepted, so a row that has sat here past the grace
 * period is either a lost webhook or a message that never existed, and those
 * two have opposite answers. Guessing either way is how a business is charged
 * for something that did not happen, or stops being charged for something that
 * did.
 */
export async function staleIndeterminateEffects(query: SpendQuery, schema: string, input: {
    readonly olderThan: Date;
    readonly limit?: number;
}): Promise<readonly ReservationRow[]> {
    assertSchema(schema);
    const limit = Math.max(1, Math.trunc(input.limit ?? 200));
    const rows = await query<any[]>(
        `SELECT * FROM "${schema}".whatsapp_spend_reservations
          WHERE state = 'indeterminate' AND updated_at < $1
          ORDER BY updated_at ASC LIMIT ${limit}`, [input.olderThan]);
    return Object.freeze(rows.map(mapReservation));
}

/**
 * ═══ SIX NUMBERS, BECAUSE THEY MEAN SIX DIFFERENT THINGS ═══
 *
 * A single "spend" figure is a lie in both directions: it either hides money
 * that may still be charged, or presents a bound as a bill. Each of these
 * answers one question, and the screen that shows them has to keep them apart:
 *
 *   `reservedMinor`   committed, POST unresolved — RESERVADO
 *   `acceptedMinor`   Meta took it, delivery unknown — ACEPTADO
 *   `estimatedMinor`  arrived, price unknown, bound kept — ESTIMADO
 *   `uncertainMinor`  we cannot say whether it arrived — INCIERTO
 *   `settledMinor`    an authority stated the amount — CONFIRMADO
 *   `releasedMinor`   provably not charged — LIBERADO
 *
 * `retainedMinor` is the sum of the four unresolved ones, kept because "how
 * much of my ceiling is committed" is a real question with one answer — but it
 * is a derived total, never a substitute for the parts.
 */
export interface SpendExposure {
    readonly currency: string;
    readonly reservedMinor: number;
    readonly acceptedMinor: number;
    readonly estimatedMinor: number;
    readonly uncertainMinor: number;
    readonly settledMinor: number;
    readonly retainedMinor: number;
    readonly releasedMinor: number;
    readonly freeDeliveries: number;
    readonly chargedDeliveries: number;
}

/**
 * The month's position, per currency.
 *
 * Grouped by currency because adding COP to USD produces a number that is not
 * money. A caller that wants one figure has to convert deliberately, with a rate
 * it can name.
 */
/**
 * ═══ THE MONTH META ACTUALLY BILLS, NOT THE LAST THIRTY DAYS ═══
 *
 * `readExposure` answers about a rolling window, which is the right shape for
 * "what is happening right now". It is the wrong shape for every question an
 * operator actually has before an invoice arrives, because the two things they
 * are trying to reconcile are both CALENDAR-MONTH facts:
 *
 *   · the thousand free service deliveries are per number per calendar month,
 *     and they reset at midnight on the first — in the WhatsApp account's own
 *     time zone, not ours and not the tenant's;
 *   · Meta invoices by calendar month.
 *
 * A rolling thirty days straddles that boundary by construction, so an operator
 * comparing our figure to their allowance or their bill was comparing two
 * different periods and being told they disagreed.
 *
 * ── WHY `applied_local_date` AND NOT `created_at` ───────────────────────────
 *
 * `applied_local_date` is the WABA-local calendar date the rate was applied on,
 * written when the reservation was priced. Grouping on it needs no time-zone
 * arithmetic here and — more importantly — cannot drift from the date the
 * PRICE was chosen against. Grouping `created_at` in UTC would put a message
 * sent at 8pm in Bogotá on the 31st into the following month, which is exactly
 * the boundary this exists to get right.
 *
 * A row with no `applied_local_date` is one nobody could price. It is reported
 * as `undated` rather than folded into the current month: attributing unpriced
 * spend to a month it may not belong to is how a reconciliation that looks
 * complete hides the rows that need attention.
 */
export interface CalendarMonthConsumption {
    /** `YYYY-MM` in the WhatsApp account's own time zone, or `null` for undated. */
    readonly month: string | null;
    readonly channelAccountId: string;
    /** Service deliveries drawn from the free allowance this number/month. */
    readonly freeDeliveries: number;
    /** Deliveries that were charged, free allowance already excluded. */
    readonly chargedDeliveries: number;
    /** Per currency, never summed across them. */
    readonly money: ReadonlyArray<{
        readonly currency: string;
        readonly settledMinor: number;
        readonly retainedMinor: number;
    }>;
    /** Where it went: the recipient's market and the category Meta charged by. */
    readonly byMarketCategory: ReadonlyArray<{
        readonly market: string | null;
        readonly category: string;
        readonly deliveries: number;
        readonly currency: string;
        readonly settledMinor: number;
        readonly retainedMinor: number;
    }>;
}

/**
 * Consumption per number per WABA-local calendar month.
 *
 * `months` bounds the scan: an unbounded one is a full read of the busiest
 * table this tenant has, asked for by a query string.
 */
export async function readCalendarMonthConsumption(query: SpendQuery, schema: string, input: {
    readonly channelAccountId?: string | null;
    readonly months?: number;
}): Promise<readonly CalendarMonthConsumption[]> {
    assertSchema(schema);
    const months = Math.min(24, Math.max(1, Number(input.months) || 3));
    const rows = await query<any[]>(
        `SELECT to_char(applied_local_date, 'YYYY-MM') AS month,
                channel_account_id,
                market,
                category,
                currency,
                COALESCE(SUM(free_deliveries), 0)::int AS free_deliveries,
                COALESCE(SUM(charged_deliveries) FILTER (WHERE state <> 'released'), 0)::int
                    AS charged_deliveries,
                COALESCE(SUM(charged_minor) FILTER (WHERE state = 'settled'), 0)::bigint AS settled,
                COALESCE(SUM(reserved_minor) FILTER (
                    WHERE state IN ('accepted','pending_reconciliation',
                                    'estimated','indeterminate')), 0)::bigint AS retained
           FROM "${schema}".whatsapp_spend_reservations
          WHERE ($1::text IS NULL OR channel_account_id = $1)
            -- The window is expressed in MONTHS of the account's own calendar,
            -- so it lines up with the allowance and the invoice rather than
            -- with an arbitrary number of days back from now.
            AND (applied_local_date IS NULL
                 OR applied_local_date >= date_trunc('month', CURRENT_DATE)
                     - make_interval(months => $2::int))
          GROUP BY 1, 2, 3, 4, 5
          ORDER BY 1 DESC NULLS LAST, 2, 3, 4`,
        [input.channelAccountId ?? null, months - 1]);

    const buckets = new Map<string, {
        month: string | null; channelAccountId: string;
        freeDeliveries: number; chargedDeliveries: number;
        money: Map<string, { settledMinor: number; retainedMinor: number }>;
        byMarketCategory: Array<CalendarMonthConsumption['byMarketCategory'][number]>;
    }>();
    for (const row of rows) {
        const month = row.month === null || row.month === undefined ? null : String(row.month);
        const channelAccountId = String(row.channel_account_id);
        // Length-prefixed, not separated. A delimiter that can appear inside a
        // part makes two different keys collide, and this codebase has already
        // shipped a hash whose separator was silently a NUL byte.
        const parts = [month ?? 'undated', channelAccountId];
        const key = parts.map(part => `${part.length}#${part}`).join('');
        const bucket = buckets.get(key) ?? {
            month, channelAccountId, freeDeliveries: 0, chargedDeliveries: 0,
            money: new Map<string, { settledMinor: number; retainedMinor: number }>(),
            byMarketCategory: [] as Array<CalendarMonthConsumption['byMarketCategory'][number]>,
        };
        bucket.freeDeliveries += Number(row.free_deliveries);
        bucket.chargedDeliveries += Number(row.charged_deliveries);
        const currency = String(row.currency);
        const money = bucket.money.get(currency) ?? { settledMinor: 0, retainedMinor: 0 };
        money.settledMinor += Number(row.settled);
        money.retainedMinor += Number(row.retained);
        bucket.money.set(currency, money);
        bucket.byMarketCategory.push(Object.freeze({
            market: row.market === null || row.market === undefined ? null : String(row.market),
            category: String(row.category),
            deliveries: Number(row.charged_deliveries) + Number(row.free_deliveries),
            currency,
            settledMinor: Number(row.settled),
            retainedMinor: Number(row.retained),
        }));
        buckets.set(key, bucket);
    }

    return Object.freeze([...buckets.values()].map(bucket => Object.freeze({
        month: bucket.month,
        channelAccountId: bucket.channelAccountId,
        freeDeliveries: bucket.freeDeliveries,
        chargedDeliveries: bucket.chargedDeliveries,
        money: Object.freeze([...bucket.money.entries()]
            .map(([currency, totals]) => Object.freeze({ currency, ...totals }))
            .sort((left, right) => left.currency.localeCompare(right.currency))),
        byMarketCategory: Object.freeze([...bucket.byMarketCategory]
            .sort((left, right) => right.deliveries - left.deliveries)),
    })));
}

export async function readExposure(query: SpendQuery, schema: string, input: {
    readonly channelAccountId?: string | null;
    readonly payerWabaId?: string | null;
    readonly since: Date;
}): Promise<readonly SpendExposure[]> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `SELECT currency,
                COALESCE(SUM(reserved_minor) FILTER (WHERE state = 'held'),0)::bigint AS reserved,
                COALESCE(SUM(reserved_minor) FILTER (WHERE state = 'accepted'),0)::bigint AS accepted,
                COALESCE(SUM(reserved_minor) FILTER (
                    WHERE state IN ('pending_reconciliation','estimated')),0)::bigint AS estimated,
                COALESCE(SUM(reserved_minor)
                    FILTER (WHERE state = 'indeterminate'),0)::bigint AS uncertain,
                COALESCE(SUM(charged_minor) FILTER (WHERE state = 'settled'),0)::bigint AS settled,
                COALESCE(SUM(reserved_minor) FILTER (
                    WHERE state IN ('accepted','pending_reconciliation',
                                    'estimated','indeterminate')),0)::bigint AS retained,
                COALESCE(SUM(reserved_minor) FILTER (WHERE state = 'released'),0)::bigint AS released,
                COALESCE(SUM(free_deliveries),0)::int AS free_deliveries,
                COALESCE(SUM(charged_deliveries) FILTER (WHERE state <> 'released'),0)::int AS charged_deliveries
           FROM "${schema}".whatsapp_spend_reservations
          WHERE created_at >= $1
            AND ($2::text IS NULL OR channel_account_id = $2)
            AND ($3::text IS NULL OR payer_waba_id = $3)
          GROUP BY currency ORDER BY currency`,
        [input.since.toISOString(), input.channelAccountId ?? null, input.payerWabaId ?? null]);
    return Object.freeze(rows.map(row => Object.freeze({
        currency: String(row.currency),
        reservedMinor: Number(row.reserved),
        acceptedMinor: Number(row.accepted),
        estimatedMinor: Number(row.estimated),
        uncertainMinor: Number(row.uncertain),
        settledMinor: Number(row.settled),
        retainedMinor: Number(row.retained),
        releasedMinor: Number(row.released),
        freeDeliveries: Number(row.free_deliveries),
        chargedDeliveries: Number(row.charged_deliveries),
    })));
}

// ════════════════════════════════════════════════════════════════════════════
// THE DURABLE INBOX OF DELIVERY RECEIPTS
//
// What Meta said, written down before anything tries to act on it.
//
// A receipt changes two records that live in two transactions: the customer's
// history and the money. When the second failed, the event survived only in a
// log line; the webhook was acknowledged, Meta never redelivered it, and the
// reservation stayed counted for ever. Nothing looked broken.
//
// The honest fix is not a distributed transaction — there is no such thing
// between "what Meta already told us" and "what our database managed to write".
// It is to make the FACT durable first, and to mark it applied only once its
// consequences actually landed.
// ════════════════════════════════════════════════════════════════════════════

export type ReceiptInboxStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface DurableReceipt {
    readonly providerMessageId: string;
    readonly status: ReceiptInboxStatus;
    readonly tenantId?: string | null;
    readonly channelAccountId?: string | null;
    readonly errorCode?: string | null;
    readonly errorDetail?: string | null;
    readonly pricing?: unknown;
}

/**
 * Write the receipt down. Idempotent by `(receipt, status)`.
 *
 * `ON CONFLICT DO NOTHING` rather than an upsert: a redelivery of the same
 * event carries the same facts, and overwriting would reset `attempts` and
 * `next_attempt_at` — turning Meta's own retry cadence into a way of keeping a
 * failing receipt permanently at the front of the queue.
 *
 * Returns whether this call was the first sighting, which is what lets a caller
 * tell a genuine duplicate from work it still has to do.
 */
export async function rememberReceipt(
    query: SpendQuery, schema: string, receipt: DurableReceipt,
): Promise<boolean> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `INSERT INTO "${schema}".whatsapp_receipt_inbox
             (provider_message_id, status, tenant_id, channel_account_id,
              error_code, error_detail, pricing)
         VALUES ($1, $2, $3::uuid, $4, $5, $6, $7::jsonb)
         ON CONFLICT (provider_message_id, status) DO NOTHING
         RETURNING provider_message_id`,
        [
            receipt.providerMessageId, receipt.status, receipt.tenantId ?? null,
            receipt.channelAccountId ?? null, receipt.errorCode ?? null,
            receipt.errorDetail ?? null,
            receipt.pricing ? JSON.stringify(receipt.pricing) : null,
        ]);
    return rows.length > 0;
}

/**
 * How long a receipt waits for the send path to write its `wamid`.
 *
 * Meta's `sent` webhook can arrive before the POST's own answer has been
 * committed — the round trip to our database is not always faster than the round
 * trip from Meta's — so "no reservation names this message" does not mean "not
 * ours". It means "not ours YET", for a window measured in seconds.
 *
 * Twenty minutes, because the association is written inside the send's own
 * transaction: if it has not appeared by then, the sending process died before
 * the commit and no amount of further waiting will produce it. After that the
 * receipt really does belong to something else — a message sent before metering
 * existed, or another tool on the same number — and saying so is correct.
 */
export const UNASSOCIATED_RECEIPT_GRACE_MS = 20 * 60_000;

/**
 * A receipt that matched no reservation, held rather than filed.
 *
 * Returns whether it is still within the grace window. `false` means the row
 * was marked `applied` as genuinely-not-ours; `true` means it stays `pending`
 * and the sweep will ask again.
 *
 * Written as one statement so the decision and the write cannot straddle the
 * moment the send path commits: reading `first_seen_at`, deciding in
 * JavaScript, then writing would let two sweepers reach opposite conclusions
 * about the same row.
 */
export async function holdUnassociatedReceipt(
    query: SpendQuery, schema: string,
    receipt: { readonly providerMessageId: string; readonly status: ReceiptInboxStatus },
    graceMs = UNASSOCIATED_RECEIPT_GRACE_MS,
): Promise<boolean> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_receipt_inbox
            SET attempts = attempts + 1,
                updated_at = clock_timestamp(),
                state = CASE
                    WHEN first_seen_at <= clock_timestamp() - make_interval(secs => $3::double precision)
                        THEN 'applied' ELSE 'pending' END,
                outcome = CASE
                    WHEN first_seen_at <= clock_timestamp() - make_interval(secs => $3::double precision)
                        THEN 'unknown_receipt' ELSE outcome END,
                last_error = CASE
                    WHEN first_seen_at <= clock_timestamp() - make_interval(secs => $3::double precision)
                        THEN NULL ELSE 'no_reservation_names_this_message_yet' END,
                next_attempt_at = clock_timestamp()
                    + (LEAST(POWER(2, LEAST(attempts + 1, 6)), 60) || ' seconds')::interval
          WHERE provider_message_id = $1 AND status = $2 AND state = 'pending'
         RETURNING state`,
        [receipt.providerMessageId, receipt.status, Math.max(0, Math.trunc(graceMs / 1000))]);
    return rows[0] ? String(rows[0].state) === 'pending' : false;
}

/** Both consequences landed. Nothing will retry this receipt again. */
export async function markReceiptApplied(
    query: SpendQuery, schema: string,
    receipt: { readonly providerMessageId: string; readonly status: ReceiptInboxStatus },
    outcome: string,
): Promise<void> {
    assertSchema(schema);
    await query(
        `UPDATE "${schema}".whatsapp_receipt_inbox
            SET state = 'applied', outcome = $3, last_error = NULL,
                attempts = attempts + 1, updated_at = clock_timestamp()
          WHERE provider_message_id = $1 AND status = $2 AND state <> 'applied'`,
        [receipt.providerMessageId, receipt.status, outcome.slice(0, 80)]);
}

/**
 * A consequence did not land. The row stays `pending` and backs off.
 *
 * The backoff is exponential and capped, computed in SQL from the attempt
 * count that the same statement writes — so two workers that both fail on the
 * same receipt cannot compute different next attempts from a value they read
 * before the other wrote.
 */
export async function noteReceiptFailure(
    query: SpendQuery, schema: string,
    receipt: { readonly providerMessageId: string; readonly status: ReceiptInboxStatus },
    error: string,
): Promise<void> {
    assertSchema(schema);
    await query(
        `UPDATE "${schema}".whatsapp_receipt_inbox
            SET attempts = attempts + 1,
                last_error = $3,
                updated_at = clock_timestamp(),
                next_attempt_at = clock_timestamp()
                    + (LEAST(POWER(2, LEAST(attempts + 1, 8)), 900) || ' seconds')::interval
          WHERE provider_message_id = $1 AND status = $2 AND state = 'pending'`,
        [receipt.providerMessageId, receipt.status, error.slice(0, 400)]);
}

/**
 * The receipts whose consequences never landed, due for another try.
 *
 * `FOR UPDATE SKIP LOCKED` so two sweepers on two workers divide the work
 * instead of fighting over it.
 */
export async function pendingReceipts(
    query: SpendQuery, schema: string, input: { readonly limit?: number; readonly at?: Date } = {},
): Promise<readonly DurableReceipt[]> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `SELECT provider_message_id, status, tenant_id, channel_account_id,
                error_code, error_detail, pricing
           FROM "${schema}".whatsapp_receipt_inbox
          WHERE state = 'pending' AND next_attempt_at <= $1::timestamptz
          ORDER BY next_attempt_at
          LIMIT $2
            FOR UPDATE SKIP LOCKED`,
        [(input.at ?? new Date()).toISOString(), input.limit ?? 100]);
    return Object.freeze(rows.map(row => Object.freeze({
        providerMessageId: String(row.provider_message_id),
        status: String(row.status) as ReceiptInboxStatus,
        tenantId: row.tenant_id ?? null,
        channelAccountId: row.channel_account_id ?? null,
        errorCode: row.error_code ?? null,
        errorDetail: row.error_detail ?? null,
        pricing: row.pricing ?? null,
    })));
}

/**
 * Stop retrying a receipt no number of attempts can resolve.
 *
 * `abandoned` is deliberately a state and not a deletion: a receipt nobody
 * could apply is evidence, and the operator asking why a reservation is still
 * held needs to find it.
 */
export async function abandonExhaustedReceipts(
    query: SpendQuery, schema: string, input: { readonly maxAttempts?: number } = {},
): Promise<number> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_receipt_inbox
            SET state = 'abandoned', updated_at = clock_timestamp()
          WHERE state = 'pending' AND attempts >= $1
          RETURNING provider_message_id`,
        [input.maxAttempts ?? 24]);
    return rows.length;
}
