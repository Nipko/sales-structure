import { inLockOrder, scopeId, type SpendScope } from './spend-scopes';

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
export type SpendCapKind = 'money' | 'deliveries' | 'observe';

export interface SpendCounterRow {
    readonly scope: SpendScope;
    readonly capKind: SpendCapKind;
    readonly capMinor: number | null;
    readonly capDeliveries: number | null;
    readonly currency: string | null;
    readonly reservedMinor: number;
    readonly settledMinor: number;
    readonly releasedMinor: number;
    readonly usedDeliveries: number;
    readonly freeDeliveries: number;
    /** Where "warn" and "stop the proactive" sit, as a fraction of the cap. */
    readonly warnPermille: number;
    readonly softPermille: number;
}

export type ReservationState =
    'held' | 'settled' | 'released' | 'pending_reconciliation' | 'indeterminate';

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
    currency: string): Promise<void> {
    assertSchema(schema);
    for (const scope of inLockOrder(scopes)) {
        await query(
            `INSERT INTO "${schema}".whatsapp_spend_counters
                (scope_kind, scope_key, period_key, cap_kind, currency)
             VALUES ($1,$2,$3,'observe',$4)
             ON CONFLICT (scope_kind, scope_key, period_key) DO NOTHING`,
            [scope.kind, scope.key, scope.period, currency]);
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
    const spent = `(${alias}.settled_minor + ${alias}.reserved_minor - ${alias}.released_minor + ${addMinor})`;
    const used = `(${alias}.used_deliveries + ${addDeliveries})`;
    return `CASE
        WHEN ${alias}.cap_kind = 'observe' THEN 'clear'
        WHEN ${alias}.cap_kind = 'money' THEN CASE
            WHEN ${spent} >= ${alias}.cap_minor THEN 'hard_stop'
            WHEN ${spent} * 1000 >= ${alias}.cap_minor * ${alias}.soft_permille THEN 'soft_stop'
            WHEN ${spent} * 1000 >= ${alias}.cap_minor * ${alias}.warn_permille THEN 'warning'
            ELSE 'clear' END
        ELSE CASE
            WHEN ${used} >= ${alias}.cap_deliveries THEN 'hard_stop'
            WHEN ${used} * 1000 >= ${alias}.cap_deliveries * ${alias}.soft_permille THEN 'soft_stop'
            WHEN ${used} * 1000 >= ${alias}.cap_deliveries * ${alias}.warn_permille THEN 'warning'
            ELSE 'clear' END
    END`;
}

/**
 * How full these ceilings are right now, with nothing added.
 *
 * Needed by the adoption path, which reserves nothing — the amount was counted
 * by the attempt being adopted — but still owes the caller an honest answer
 * about how close the ceiling is. Returning [H[2J[3J there because no reservation
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

export interface ReserveAgainstCounter {
    readonly scope: SpendScope;
    readonly amountMinor: number;
    readonly deliveries: number;
    /** Defaults to `proactive`: the expensive reading, when nobody said. */
    readonly disposition?: SpendDisposition;
}

export interface ReserveOutcome {
    /** May the effect proceed against THIS counter? */
    readonly ok: boolean;
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
    const softClause = proactive
        ? `AND (soft_permille >= 1000
                OR cap_kind = 'observe'
                OR (cap_kind = 'money'
                    AND (settled_minor + reserved_minor - released_minor + $4) * 1000
                        < cap_minor * soft_permille)
                OR (cap_kind = 'deliveries'
                    AND (used_deliveries + $5) * 1000 < cap_deliveries * soft_permille))`
        : '';
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_counters AS c
            SET reserved_minor = reserved_minor + $4,
                used_deliveries = used_deliveries + $5,
                updated_at = clock_timestamp()
          WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3
            AND (cap_kind = 'observe'
                 OR (cap_kind = 'money'
                     AND cap_minor - settled_minor - reserved_minor + released_minor >= $4)
                 OR (cap_kind = 'deliveries'
                     AND cap_deliveries - used_deliveries >= $5))
            ${softClause}
          RETURNING ${pressureSql('c', '0', '0')} AS pressure`,
        [scope.kind, scope.key, scope.period, amountMinor, deliveries]);
    // RETURNING sees the row AFTER the update, so `0` is the right addend: the
    // amount is already in `reserved_minor`.
    if (rows[0]) return { ok: true, pressure: String(rows[0].pressure) as SpendPressure };

    // Refused. Say WHICH height refused it, which needs the pressure the
    // reservation WOULD have produced — hence the amount as an addend here.
    const [current] = await query<any[]>(
        `SELECT ${pressureSql('c', '$4', '$5')} AS pressure
           FROM "${schema}".whatsapp_spend_counters AS c
          WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3`,
        [scope.kind, scope.key, scope.period, amountMinor, deliveries]);
    // A counter that vanished between the two statements cannot be reasoned
    // about, and "the ceiling is unknown" must never read as "there is room".
    return { ok: false, pressure: current ? String(current.pressure) as SpendPressure : 'hard_stop' };
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
            basis, decision, reserved_minor, unit_ceiling_minor, exact_micros,
            free_deliveries, charged_deliveries, lease_expires_at)
         VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20,$21::date,$22,$23,$24,$25,$26,$27,$28,$29,
                 clock_timestamp() + make_interval(secs => $30::double precision))
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
}): Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = 'settled', charged_minor = $2, evidence = $3,
                provider_message_id = COALESCE($4, provider_message_id),
                remote_state = COALESCE($5, remote_state),
                updated_at = clock_timestamp()
          WHERE effect_key = $1 AND state = 'held'
          RETURNING *`,
        [input.effectKey, Math.max(0, Math.trunc(input.chargedMinor)), input.evidence,
            input.providerMessageId ?? null, input.remoteState ?? null]);
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
}): Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = 'released', evidence = $2, reason = COALESCE($3, reason),
                remote_state = COALESCE($4, remote_state), updated_at = clock_timestamp()
          WHERE effect_key = $1 AND state = 'held'
          RETURNING *`,
        [input.effectKey, input.evidence, input.reason ?? null, input.remoteState ?? null]);
    if (!rows[0]) return null;
    const released = mapReservation(rows[0]);
    await applyToCounters(query, schema, released.id, 'released', released.money.reservedMinor, 0);
    return released;
}

/**
 * Keep the exposure and record that nobody can say what happened.
 *
 * `pending_reconciliation` is "we know it arrived and not what it cost";
 * `indeterminate` is "we do not know whether it arrived". Both keep the full
 * amount counted, and neither is a state a sweeper may turn into a release.
 */
export async function retainReservation(query: SpendQuery, schema: string, input: {
    readonly effectKey: string;
    readonly state: 'pending_reconciliation' | 'indeterminate';
    readonly reason: string;
    readonly providerMessageId?: string | null;
    readonly remoteState?: string | null;
}): Promise<ReservationRow | null> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = $2, reason = $3,
                provider_message_id = COALESCE($4, provider_message_id),
                remote_state = COALESCE($5, remote_state), updated_at = clock_timestamp()
          WHERE effect_key = $1 AND state = 'held'
          RETURNING *`,
        [input.effectKey, input.state, input.reason,
            input.providerMessageId ?? null, input.remoteState ?? null]);
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
 */
async function applyToCounters(query: SpendQuery, schema: string, reservationId: string,
    state: 'settled' | 'released', reservedMinor: number, chargedMinor: number): Promise<void> {
    const allocations = await query<any[]>(
        `SELECT scope_kind, scope_key, period_key, amount_minor
           FROM "${schema}".whatsapp_spend_allocations
          WHERE reservation_id = $1::uuid AND state = 'reserved'
          ORDER BY scope_kind, scope_key, period_key`, [reservationId]);

    for (const allocation of allocations) {
        const allocated = Number(allocation.amount_minor);
        // The share of the charge this counter carries. Proportional so two
        // counters that reserved different amounts settle different amounts,
        // and integer so nothing is created by rounding.
        const settledHere = state === 'settled' && reservedMinor > 0
            ? Math.min(allocated, Math.round((chargedMinor * allocated) / reservedMinor))
            : 0;
        const returnedHere = allocated - settledHere;
        await query(
            `UPDATE "${schema}".whatsapp_spend_counters
                SET reserved_minor = GREATEST(0, reserved_minor - $4),
                    settled_minor = settled_minor + $5,
                    released_minor = released_minor + $6,
                    updated_at = clock_timestamp()
              WHERE scope_kind=$1 AND scope_key=$2 AND period_key=$3`,
            [allocation.scope_kind, allocation.scope_key, allocation.period_key,
                allocated, settledHere, returnedHere]);
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

/** What is reserved, settled, retained, released and free — never one number. */
export interface SpendExposure {
    readonly currency: string;
    readonly reservedMinor: number;
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
export async function readExposure(query: SpendQuery, schema: string, input: {
    readonly channelAccountId?: string | null;
    readonly payerWabaId?: string | null;
    readonly since: Date;
}): Promise<readonly SpendExposure[]> {
    assertSchema(schema);
    const rows = await query<any[]>(
        `SELECT currency,
                COALESCE(SUM(reserved_minor) FILTER (WHERE state = 'held'),0)::bigint AS reserved,
                COALESCE(SUM(charged_minor) FILTER (WHERE state = 'settled'),0)::bigint AS settled,
                COALESCE(SUM(reserved_minor) FILTER (
                    WHERE state IN ('pending_reconciliation','indeterminate')),0)::bigint AS retained,
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
        settledMinor: Number(row.settled),
        retainedMinor: Number(row.retained),
        releasedMinor: Number(row.released),
        freeDeliveries: Number(row.free_deliveries),
        chargedDeliveries: Number(row.charged_deliveries),
    })));
}
