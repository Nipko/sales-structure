# Reserving WhatsApp spend atomically — design for the next batch

Status: **design only.** No code in this batch. The resolver next to this file
answers *what a delivery costs*; this describes the thing that spends against
that answer, and it is written down first because the three failures it has to
survive are all failures of a design, not of a line of code.

The three, stated plainly:

1. **Two producers take the last budget at the same time.** Both read "80 cents
   left", both reserve 60, and 120 cents of messages go out against 80 cents of
   authority.
2. **A timeout after acceptance.** We handed the message to Meta and the call
   timed out. It may have been delivered and billed; it may not. Releasing the
   reservation is how money gets spent with nothing holding it.
3. **An uncertain COMMIT.** The client sends `COMMIT`, the connection drops, and
   nothing in the process can say whether it applied. Under PgBouncer in
   transaction mode this is more likely than it looks, not less.

Everything below exists to make each of those produce a *recorded* outcome
rather than a guess.

---

## 1. What is being counted, and what it is not

A budget here is a **cap on what Parallly transmits**. It is not a wallet, not a
prepaid balance, and it does not mean Parallly funds anybody's Meta account. The
directive is explicit about this and the UI copy has to be too: we control what
this platform sends, and we cannot cap what another app on the same WABA sends,
what Meta charges for obligations incurred before we were asked, or what the
provider reports late. Discrepancies get recorded, not smoothed away.

Two independent ceilings apply **together**, because they protect different
things:

| Ceiling | Unit | Protects |
|---|---|---|
| Money per account / business / contact / batch | minor units | the bill |
| Deliveries per number per month | messages | the free thousand |

A money cap alone lets a cheap market burn the free allowance on noise. A
message cap alone lets an expensive market spend the budget in twenty replies.
Both are checked, and the stricter one wins.

---

## 2. Tables

Per-tenant schema, `$queryRawUnsafe` with `::uuid` casts and snake_case columns,
like everything else here.

```
whatsapp_spend_counters
  scope_kind      text     -- 'account' | 'business' | 'contact' | 'number_month'
  scope_key       text     -- the identity being capped
  period_key      text     -- 'YYYY-MM-DD' or 'YYYY-MM', in the WABA time zone
  cap_minor       bigint   -- money ceiling; NULL when this row caps messages
  cap_deliveries  integer  -- message ceiling; NULL when this row caps money
  reserved_minor  bigint   NOT NULL DEFAULT 0
  settled_minor   bigint   NOT NULL DEFAULT 0
  used_deliveries integer  NOT NULL DEFAULT 0
  currency        text
  PRIMARY KEY (scope_kind, scope_key, period_key)

whatsapp_spend_reservations
  id                uuid PRIMARY KEY
  effect_key        text NOT NULL          -- see §5; UNIQUE with tenant scope
  state             text NOT NULL          -- 'held' | 'settled' | 'released'
                                           -- | 'pending_reconciliation' | 'indeterminate'
  decision          text NOT NULL          -- 'accepted' | 'unknown'
  basis             text NOT NULL          -- PricingBasis from the shared contract
  reserved_minor    bigint NOT NULL
  unit_ceiling_minor bigint NOT NULL
  charged_minor     bigint                 -- NULL until 'settled'
  currency          text NOT NULL
  free_deliveries   integer NOT NULL DEFAULT 0
  charged_deliveries integer NOT NULL
  rate_version      text                   -- which card priced it
  applied_local_date date                  -- the WABA-local date used
  exact_micros      bigint NOT NULL        -- the true cost, before rounding up
  lease_expires_at  timestamptz NOT NULL
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp()

  UNIQUE (effect_key)
```

`exact_micros` is carried because the reservation rounds **up** to whole minor
units and the settlement has to give the difference back. Without it the
platform slowly over-holds budget and nobody can say by how much.

---

## 3. The last-budget race

The bug is *read, then decide, then write*. Any version of that loses, including
one wrapped in a transaction at READ COMMITTED, because the read sees a snapshot
the write no longer belongs to.

The invariant goes **into the statement**:

```sql
UPDATE whatsapp_spend_counters
   SET reserved_minor = reserved_minor + $4
 WHERE scope_kind = $1 AND scope_key = $2 AND period_key = $3
   AND cap_minor - settled_minor - reserved_minor >= $4
RETURNING cap_minor - settled_minor - reserved_minor AS remaining_after;
```

Zero rows returned **is** the refusal. The second writer blocks on the row lock,
re-evaluates the `WHERE` against the row the first one committed, and fails.
There is no comparison in application code to get wrong, and no advisory lock in
the common path — which also avoids the `pg_advisory_xact_lock` trap this
codebase has already been bitten by, where the primitive `query` path rejects a
`void`-typed column.

The counter row has to exist first. `INSERT … ON CONFLICT DO NOTHING` as a
separate statement, then the `UPDATE` — separate statements because PgBouncer in
transaction mode will not take a multi-statement string.

**Lock ordering.** Every path takes the allowance row before the money rows, and
money rows in a fixed order (`account`, then `business`, then `contact`). One
order everywhere, or two producers capping different scopes deadlock.

### The allowance is a race too

The free thousand is a finite resource with the same shape, and it must be split
*inside* the statement rather than computed beforehand:

```sql
WITH before AS (
    SELECT used_deliveries FROM whatsapp_spend_counters
     WHERE scope_kind = 'number_month' AND scope_key = $1 AND period_key = $2
     FOR UPDATE
), granted AS (
    UPDATE whatsapp_spend_counters
       SET used_deliveries = LEAST(used_deliveries + $3, cap_deliveries)
     WHERE scope_kind = 'number_month' AND scope_key = $1 AND period_key = $2
    RETURNING used_deliveries
)
SELECT granted.used_deliveries - before.used_deliveries AS free_granted
  FROM granted, before;
```

`free_granted` is how many of the batch were actually free; `$3 - free_granted`
is what gets priced. Deciding the split before the lock is the same read-then-
write bug wearing different clothes — with 999 used and two producers each
sending one message, both would see a free delivery available and only one is.

`period_key` is the WABA-local `YYYY-MM` and `scope_key` is the phone number id.
No market appears in either, which is what makes "one thousand per number, not
per country" structural rather than remembered.

---

## 4. Timeout after acceptance

**A timeout never releases a reservation.** Release requires a positive
negative — an explicit rejection from Meta with no message id. Everything else
keeps the money counted:

| What came back | Settlement state | Reservation |
|---|---|---|
| Delivery + price | `settled` | charged recorded, surplus released |
| Delivery, no price | `pending_reconciliation` | held in full |
| Explicit rejection, no message id | `released` | returned in full |
| Timeout, no message id | `indeterminate` | held in full |
| Timeout, message id in hand | `pending_reconciliation` | held in full |

This is exactly what `retainedExposure` in the shared contract already computes,
and the table above is the mapping that keeps this module and that function
saying the same thing.

**Expiry must not become a quiet release.** A reservation held by a crashed
worker would otherwise pin budget forever, so `lease_expires_at` exists — but the
sweeper moves an expired `held` row to `indeterminate`, never to `released`. The
money stays visible as exposure and an operator sees a number that needs
reconciling, which is the honest outcome; only a reconciliation against Meta's
own figures may release it.

The sweeper compares against `clock_timestamp()`, not `now()`. `now()` freezes at
`BEGIN`, and a long transaction sweeping leases with it will consider rows
unexpired that expired minutes ago — this codebase has already had two sites in
one file disagree for exactly that reason.

---

## 5. The uncertain COMMIT

Nothing may be concluded from "the COMMIT threw". The rule is:

> **The reservation row is the single witness, and it is addressable by a key
> the caller can recompute from the effect alone.**

Because the counter increment and the reservation row are written in the *same*
transaction, the row's existence answers both questions at once. A worker that
lost its connection reconnects and asks `SELECT … WHERE effect_key = $1`:

- row present → the transaction committed; adopt it, do not reserve again;
- row absent → it did not; retry the whole claim.

That only works if `effect_key` is **derivable, not generated**:

```
effect_key = hash(tenant_id, channel_account_id, recipient, category,
                  producer, effect_ordinal, content_digest)
```

A random UUID minted inside the failed attempt is not recomputable, so the retry
would mint a second one and double-spend — the same class of mistake as the
outbound `jobId` incident. And when this key is reused as a BullMQ `jobId` it
must be encoded without `:`, which BullMQ rejects.

The claim is therefore:

```sql
INSERT INTO whatsapp_spend_reservations (id, effect_key, …)
VALUES ($1::uuid, $2, …)
ON CONFLICT (effect_key) DO NOTHING
RETURNING id;
```

No row returned means somebody already claimed this effect — `SELECT` it and
adopt its decision, including its uncertainty. A retry inherits the original
reservation and the original doubt; it does not get a fresh, cleaner one.

Settlement is idempotent the same way: `UPDATE … WHERE state = 'held'
RETURNING`. Zero rows means it was already settled, which is success, not an
error to retry.

---

## 6. Revalidation before transmitting

A reservation taken at enqueue time is a claim about a rate card, and the job may
sit in the queue across the 1 October boundary. Before transmitting, re-resolve
with the resolver in this directory and compare `rate_version` and
`applied_local_date`:

- unchanged → transmit;
- cheaper → transmit, release the difference at settlement;
- dearer → reserve the difference first; if that reservation is refused, the
  send is refused. Authority for the old price is not authority for the new one.
- above the authorised unit ceiling for that category and market → refused
  outright, even with plenty of aggregate budget left. The ceiling is per
  message and denominated in the account's currency; it is not a global constant
  per country.

---

## 7. What the tests have to show

Not "the guard returns false" — that is the reply of a function, not the
behaviour of a system. Each of these needs a real transport double that records
what was actually transmitted, and the double must not re-implement the guard,
or it will be tested against itself.

1. **Two workers, one last amount.** Concurrent transactions on real PostgreSQL,
   not sequential calls. Exactly one reservation; the sum never exceeds the cap.
2. **Two workers, the 1,000th free delivery.** One `free_granted = 1`, the other
   `0` and priced.
3. **Timeout after acceptance.** The transport times out after the write; the
   reservation stays `indeterminate`, exposure is the full amount, no reissue.
4. **Uncertain COMMIT.** Kill the connection during `COMMIT`; on reconnect the
   worker reaches the same reservation via `effect_key` and does not create a
   second one. Run it both ways — committed and not — and check the worker
   agrees with the database in both.
5. **Retry after a lost response.** Same `effect_key`, one reservation, one
   delivery.
6. **Boundary in the queue.** Enqueued 30 September, delivered 1 October: the
   dearer rate is re-reserved or the send is refused.
7. **Mixed categories in one batch.** Service and marketing in the same turn
   settle against their own rates; one delivery raises one charge.
8. **A market with no rate card.** With `allowUnknownCost: false` nothing is
   transmitted; with it true, a reservation exists at the declared ceiling and
   the settlement is `pending_reconciliation`.

---

## 8. What I need from outside this module

Listed here so the next batch does not start by inventing them:

- **A migration** creating both tables in the tenant schema — additive only, per
  the expand-contract rule. Integrator's file, not mine.
- **The counter caps.** Where the per-account and per-contact ceilings come
  from: the runtime plan catalogue, tenant overrides, or a new setting.
- **The WABA time zone**, per channel account. Every period key and every
  effective date depends on it, and there is no safe default.
- **The month's service usage**, per number. The evidence says the exact webhook
  signal for consuming the free thousand is not documented and must not be
  invented; until it is known, `deliveriesAlreadyUsedThisMonth` stays `null` and
  every delivery is reserved as chargeable, then reconciled.
