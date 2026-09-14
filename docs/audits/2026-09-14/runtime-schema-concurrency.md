# Runtime schema concurrency repair

Reported failure: PostgreSQL `23505` on `(typname, typnamespace) =
('webhook_delivery_outbox', 2200)` while the webhook recovery cron executed
`CREATE TABLE IF NOT EXISTS`. This is a catalog creation race, not a duplicate
customer message. An existence clause and a Redis readiness hint do not serialize
concurrent API/worker initialization.

## Implemented scope

- A transaction-scoped PostgreSQL advisory lock keyed by `runtime-schema:<schema>`
  serializes cooperating initializers. The lock and DDL use the same transaction
  connection, including through PgBouncer transaction pooling.
- Both tenant query wrappers acquire it for schema-changing statements. Ordinary
  reads and writes do not acquire this schema lock. Tenant provisioning, canonical
  table repair and `migrate-tenants.js` participate in the same protocol.
- Direct initializers for webhooks, push, email, widget, alerts, scheduled reports,
  broadcasts, business identity, channel manager, ecommerce, external CRM, FAQs,
  policies, persona, orders, consent evidence, staff scheduling and vehicles now
  run their DDL on a locked transaction client.
- Quality, traces, procedures, attribution, reviews, vertical integrations,
  evaluations and knowledge no longer turn a failed DDL statement into cached
  readiness by swallowing unique violations. Changed readiness cache versions
  force rechecking previously cached incomplete initialization.
- Both widget services use one schema definition. Previously the trigger service
  could create a weaker table first. This consolidates fresh initialization; it
  does not retroactively repair every constraint on an existing widget table.
- Startup column widening and historical pipeline schema repairs also participate.
  The pipeline constraint replacement is atomic. Unexpected widening failures are
  logged as failures instead of being swallowed under a success message.
- Optional historical text-to-UUID conversion for alert/report tenant IDs remains
  separate from mandatory table initialization, because existing readers support
  text IDs. Failure of that optional conversion is logged and does not abort the
  valid table creation transaction.

## Evidence

- Broad related PostgreSQL selection: 92 suites, 1,413 cases, all passed with zero
  omissions after targeted reruns. The first run had 80 passing suites and 12
  failing suites; the 12-suite rerun passed 213 cases. Counts are deduplicated by
  suite, not summed across executions.
- Initial broad failures included misconfigured disposable knowledge/Redis
  endpoints, one database-cleanup timeout, and fixtures that either scraped the
  moved widget SQL or lacked the newly required transaction adapter. Guards were
  preserved; fixtures now call the canonical initializer and use real transactions.
- Related non-database selection: 919 passing cases, zero failed, 87 conditional
  cases not executed in that selection. This is not an all-tests/no-skips claim.
- Specific real PostgreSQL/PgBouncer checks cover 12 simultaneous webhook
  initializers, actual lock waiters from both production tenant wrappers, rollback
  and retry of incomplete FAQ creation, trigger-first widget initialization, eight
  concurrent initializers through a transaction pool of one, and lock release on
  both commit and rollback.
- Unit checks include failed COMMIT before readiness publication and reattempt
  after initialization failure. A TypeScript AST guard rejects literal DDL on
  uncoordinated root clients, including `super` calls and fake guards in comments.
- All 94 global migrations applied on a fresh disposable database. Tenant migration
  smoke passed, including deliberate duplicate-data failure and rollback checks.
- Final focused verification: 8 suites / 56 cases passed, including real Nest
  bootstrap (the AST suite was rerun after fixing its TypeScript annotation).
  Cold API typecheck, API build, lint of changed TypeScript files and diff whitespace
  checks passed. These checks do not replace a full release test run.

## Boundaries and rollout

This is a local code repair, not evidence of deployment or of a full release
certification. No provider calls, new credentials or tenant-data reset are needed.
Deploy API and worker from the same corrected revision: an older process that
does not acquire the lock can still race a new process. Recheck webhook recovery
and initialization errors after both processes have restarted.

The static guard checks literal DDL and recognizable prefixes, not arbitrary SQL
dataflow. Dynamic initialization arrays were inspected separately. Locks cannot
coordinate external SQL or other code that ignores this protocol. Existing schema
drift, invalid historical data and genuine uniqueness conflicts must still surface
as errors; this change does not hide them or promise an error-free platform.
