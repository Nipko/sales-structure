# Vertical provisioning v2 — release runbook

This migration reconciles existing tenants with the subtype-specific pipeline,
tools, persona and operational workspace contract. It is deliberately not an
automatic startup migration: every tenant keeps its previous runtime contract
until the reconciler completes successfully.

## Release order

1. Deploy the API/dashboard commit and wait for health, database and Redis to
   report healthy.
2. Keep the new mobile build out of Play while reconciliation is pending.
3. Inspect the candidate set (no writes):

   ```bash
   docker exec parallext-api node scripts/reconcile-vertical-provisioning.js --dry-run
   ```

4. Reconcile the apartment-rental demo tenant first:

   ```bash
   docker exec parallext-api node scripts/reconcile-vertical-provisioning.js \
     --tenant=<TENANT_UUID> --apply
   ```

5. Verify the canary before proceeding:

   - `settings.verticalProvisioning.version` equals the current version and
     `status` is `complete`;
   - one default pipeline exists;
   - its stage slugs are unique and no stage has `pipeline_id IS NULL`;
   - the subtype's canonical transition rule is present;
   - appointments is disabled when `appointment_booking` is absent;
   - the intended mobile/dashboard operation lists and opens real records.

6. Reconcile the remaining tenants in bounded batches. `--limit` is the number
   of successful reconciliations, not the number of attempts: a tenant that
   fails closed is reported for review but cannot starve every tenant created
   after it. The scanner paginates the full active/onboarded population and
   reports the number deferred, so it does not stop at the first 10,000 rows.
   A non-zero exit code means one or more tenants require review; successful
   tenants remain complete and the failed tenant records the rejected attempt.

   ```bash
   docker exec parallext-api node scripts/reconcile-vertical-provisioning.js --limit=25 --apply
   ```

7. Repeat the dry-run. It must report zero candidates before publishing the
   mobile build.

## Mandatory canaries

Exercise at least one tenant for each contract that stopped using generic
appointments: vacation rental/hotel, tours, fast food/dark kitchen, home
services, photography, pharmacy/retail order, automotive parts, vehicle rental,
technology hardware and pet boarding/day care. Also verify a normal appointment
tenant and both persisted legacy subtypes (`boutique`, `delivery`).

## Conflict policy

The reconciler uses the same lifecycle/provisioning locks and idempotent seeds
as onboarding. Exact, unreferenced duplicate stages can be repaired. Edited or
referenced duplicates, ambiguous default pipelines, quota conflicts and invalid
legacy identities fail closed and are logged as
`vertical_provisioning_needs_review`; they must never be deleted or overwritten
manually without inspecting their deals and custom rules.

## Rollback

Do not publish the mobile build if the batch is incomplete. A plain rollback to
an image that predates provisioning v2 is allowed only **before the first v2
tenant is reconciled**. Once a tenant is current, its pipeline can contain
native transition rules that an older image does not understand; silently
deploying that image would turn fail-closed gates into no-ops.

After the first reconciliation, use one of these two recovery paths:

1. roll forward with a corrected image that still understands every v2 rule;
2. deploy an explicitly prepared rollback image with the v2 rule evaluator
   backported and verified against the same contract/PG suites.

Never downgrade `verticalProvisioning`, rewrite transition rules, or restore an
old database snapshot for only one schema by hand. Stop the reconciler, keep
the mobile build unpublished, and repeat dry-run/canaries after the compatible
API is healthy.
