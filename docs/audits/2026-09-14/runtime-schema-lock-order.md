# Runtime schema deadlock: pipeline repair

The reported `40P01` is a regression in the lock protocol introduced by
`c1d11a95`: acquiring the schema advisory lock lazily at the first DDL statement
is too late if the transaction already holds relation or domain locks.

## Reproduced sequence

1. `PipelineService.migrateToMultiPipeline` calls `ensurePrimaryPipeline`, takes
   the tenant advisory lock and reads/updates pipeline tables.
2. Another request prepares pipeline columns. It acquires `runtime-schema:<schema>`
   and waits for `AccessExclusiveLock` on `pipeline_stages`.
3. The first transaction reaches `CREATE UNIQUE INDEX`, attempts to acquire the
   schema advisory lock and waits for the second transaction. PostgreSQL detects
   the cycle and aborts one transaction with `40P01`.

`pipeline-schema-lock-order.postgres.spec.ts` calls the actual pipeline method
through the production Prisma transaction wrapper, pauses after the ownership
read, starts the competing repair and observes its blocked PostgreSQL backend.
Before the fix this reproduced the reported relation/advisory lock cycle.

## Correction

- Mixed schema transactions declare `schemaLock: true`. The transaction wrapper
  acquires the schema mutex before invoking the callback, so it precedes table,
  row and domain advisory locks.
- A transaction whose first query is DDL retains the existing automatic lock.
  A transaction that already issued a query may not acquire a late schema lock;
  it fails before executing that DDL with an actionable declaration error. Its
  preceding writes roll back. Callbacks are not automatically replayed.
- Ordinary business transactions do not acquire the schema mutex.
- Migrated callers: pipeline ownership/index repair, identity merging, operational
  notice and review initialization, both native evidence repair entry points,
  turn ledger initialization, dispatch outbox initialization, widget reply
  initialization, pet command receipt initialization and Watchtower sampling
  schema initialization.
- The broader database run found the four dynamic-DDL initializers omitted by
  the first source sweep. That intermediate run was stopped; those callers were
  updated before rerunning the selection.

## Validation

- Before correction, the new integration test reproduced `40P01` on PostgreSQL
  with the actual pipeline method and Prisma transaction wrapper.
- Focused regression selection: 6 suites / 70 cases passed.
- Related unit and bootstrap selection: 14 suites / 147 cases passed.
- Broad real-database selection: 92 suites / 1,394 cases passed, zero omitted,
  counting each case once after rerunning five suites. Besides the sampling
  initializer, the first completed run exposed test adapters dropping transaction
  options, a test-only provenance initializer needing the declaration, and a
  database-cleanup timeout. All five passed on the targeted rerun.
- Additional pet commands and Watchtower checks: 2 suites / 22 cases passed.
- Cold API typecheck, API build, changed-file lint, diff whitespace and generated
  source-artifact checks passed.

## Rollout boundary

The fix changes lock ordering, not table definitions or credentials. It requires
updating API and worker; old processes can still execute the inverted ordering.
No production database was reset and no provider call was used for this review.
This prevents the reproduced lock inversion; unrelated deadlocks can still occur
and must be diagnosed from their own lock graph.
