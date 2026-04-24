# Billing Runbook

Operational guide for Parallly's subscription billing. For the strategic plan, pricing rationale, and decisions, see [`docs/billing-plan.md`](./billing-plan.md). For the code architecture, see [`apps/api/src/modules/billing/README.md`](../apps/api/src/modules/billing/README.md).

This document is the **runbook**: what happens on deploy, how to add a country, how to update prices, how to recover from incidents.

---

## 1. What the deploy pipeline does automatically

Every push to `main` triggers `.github/workflows/deploy.yml`. After building images and running DB migrations, the deploy does three billing-specific steps in order:

### 1.1 Prisma schema migration
```bash
docker compose run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
```
Applies any new `prisma/migrations/*/migration.sql` to the global `public` schema. Idempotent — already-applied migrations are skipped.

The billing schema ships in migration `20260423000000_add_billing`:
- 7 new columns on `tenants` (billingEmail, billingCountry, subscriptionStatus, trialEndsAt, currentPeriodEnd, paymentProvider, paymentProviderCustomerId)
- 4 new tables: `billing_plans`, `billing_subscriptions`, `billing_events`, `billing_payments`

### 1.2 Seed billing plans
```bash
docker compose run --rm api node prisma/seed-billing-plans.js
```
Upserts the 4 tier plans (`starter`, `pro`, `enterprise`, `custom`) into `billing_plans`. Prices are stored in USD cents — these are the source of truth. Running this is safe on every deploy; it updates name/price/limits if they change in the source file, otherwise it's a no-op.

### 1.3 Sync plans to MercadoPago per country
```bash
docker compose run --rm api node scripts/sync-mp-plans.js --country=CO --fx=4200
```
For every country in `$PROD_MP_SYNC_COUNTRIES` (default `CO`), registers the 3 paid tiers (`starter`, `pro`, `enterprise`) as `preapproval_plan` resources in MercadoPago and saves the returned MP plan ids in `billing_plans.priceLocalOverrides[COUNTRY]`. Colombia also mirrors the id to the top-level `mpPlanId` column (legacy until the country-aware resolver lands).

**Idempotency guarantee**: a tier already synced for a country is skipped by default. Reruns on every deploy are safe and cheap (one SELECT per tier, zero MP API calls if nothing changed).

---

## 2. Environment variables

### Required (MP billing will be broken without them)
| Variable | Where | Purpose |
|---|---|---|
| `MP_ACCESS_TOKEN` | GitHub Secret | Server auth to MercadoPago API. TEST-* in sandbox, APP_USR-* in production |
| `MP_WEBHOOK_SECRET` | GitHub Secret | HMAC-SHA256 signing key for incoming webhooks |

### Optional (defaults kick in when unset)
| Variable | Default | Purpose |
|---|---|---|
| `MP_PUBLIC_KEY` | empty | Used by the dashboard frontend to tokenize cards (Sprint 3) |
| `MP_SYNC_COUNTRIES` | `CO` | Comma-separated ISO codes to sync each deploy. Valid: `CO,AR,MX,CL,PE,UY,BR` |
| `MP_FX_CO` | `4200` | USD→COP rate. Override when it drifts |
| `MP_FX_AR` | `1200` | USD→ARS rate |
| `MP_FX_MX` | `18` | USD→MXN rate |
| `MP_FX_CL` | `950` | USD→CLP rate |
| `MP_FX_PE` | `3.8` | USD→PEN rate |
| `MP_FX_UY` | `40` | USD→UYU rate |
| `MP_FX_BR` | `5.5` | USD→BRL rate |

All `MP_FX_*` secrets are optional. Set them in GitHub → Settings → Secrets and variables → Actions when you need to override a default.

---

## 3. Adding a new country

The MP Subscriptions API is country-scoped — you need a MercadoPago merchant account in that country. Once you have one:

1. **Get fresh credentials** from the country-specific MP developer portal (e.g., `mercadopago.com.mx/developers` for Mexico) — each country has its own Access Token and Webhook Secret. In the short term we support only one country's credentials at a time via `MP_ACCESS_TOKEN` — multi-account support is Phase 4 work.
2. **Set the FX rate** in GitHub Secrets. Example for Mexico:
   ```
   MP_FX_MX = 18.5
   ```
3. **Add the country code** to `MP_SYNC_COUNTRIES`:
   ```
   MP_SYNC_COUNTRIES = CO,MX
   ```
4. **Deploy** — push any commit to `main`. The deploy script will pick up the new country, call MercadoPago's `/preapproval_plan` endpoint once per tier, and persist the ids into `billing_plans.priceLocalOverrides[MX]`.
5. **Verify** — SSH into the VPS and check:
   ```bash
   docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
     "SELECT slug, price_local_overrides FROM billing_plans WHERE slug != 'custom';"
   ```
   Each row's `price_local_overrides` should now have a `MX` key alongside `CO`.

---

## 4. Updating plan prices

### For a permanent price change (applies to all future signups)

1. Edit `apps/api/prisma/seed-billing-plans.js` → change `priceUsdCents`.
2. Commit + push → the deploy will upsert the new price into `billing_plans`.
3. **But MP plans are frozen** — already-created `preapproval_plan` records keep their original amount. New subscriptions created after this deploy will continue to reference the old MP plan id until you do step 4.
4. To force MP to pick up the new price, you need to **recreate the plan in MP**:
   ```bash
   docker exec parallext-api sh -c \
     'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200 --force'
   ```
   The `--force` flag creates a fresh plan in MP and overwrites the id in `priceLocalOverrides[CO].mpPlanId`. Existing subscribers stay on the old plan id — only new signups pick up the new price. **Existing subscriptions must be manually migrated** with a BillingService.upgradeSubscription call if you want them on the new price.

### For an FX-only adjustment (e.g., devaluation)

Same as above but only the `MP_FX_*` secret changes. The USD price in `billing_plans` stays the same. Force-sync recreates the MP plan at the new local amount.

---

## 5. Manual operations

All operations below assume SSH access to the production VPS.

### Re-run seed (e.g., after a schema change)
```bash
docker exec parallext-api node prisma/seed-billing-plans.js
```

### Re-run sync for a single country
```bash
docker exec parallext-api sh -c \
  'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200'
```

### Dry-run the sync (prints the MP request bodies, does not call MP)
```bash
docker exec parallext-api sh -c \
  'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200 --dry-run'
```

### Force-recreate plans for a country (MP doesn't upsert)
```bash
docker exec parallext-api sh -c \
  'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200 --force'
```
Use this when a price changed or the plan was accidentally deleted in MP.

### Inspect current plan state
```bash
# What's in our DB?
docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
  "SELECT slug, price_usd_cents, trial_days, mp_plan_id, price_local_overrides FROM billing_plans ORDER BY sort_order;"

# What's in MP sandbox?
# Go to https://www.mercadopago.com.co/developers → your app → Subscriptions
```

### Inspect a specific tenant's subscription
```bash
docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
  "SELECT tenant_id, status, provider_subscription_id, trial_ends_at, current_period_end FROM billing_subscriptions WHERE tenant_id = '<TENANT_UUID>';"
```

### Check recent billing events for a tenant
```bash
docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
  "SELECT processed_at, event_type, provider, provider_event_id FROM billing_events WHERE tenant_id = '<TENANT_UUID>' ORDER BY processed_at DESC LIMIT 20;"
```

---

## 6. Incident response

### A tenant says "my subscription was cancelled but I paid"
1. Get their tenant id + MP subscription id:
   ```sql
   SELECT tenant_id, provider_subscription_id, status
   FROM billing_subscriptions WHERE tenant_id = '...';
   ```
2. Poll MP directly — the reconciliation cron should do this hourly, but if you want to force it now:
   ```bash
   docker exec parallext-api node -e "
     const { MercadoPagoConfig, PreApproval } = require('mercadopago');
     const c = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
     new PreApproval(c).get({ id: '<SUB_ID>' }).then(r => console.log(JSON.stringify(r, null, 2)));
   "
   ```
3. If MP says `authorized` and our DB says `cancelled` → the webhook failed at some point. The hourly reconciliation cron will self-heal, but you can force it by calling BillingService with a synthetic event (see `reconciliation.processor.ts`).

### Webhooks stopped arriving in production
1. Check the webhook endpoint is reachable from MP's side:
   ```bash
   curl -I https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago
   ```
   Should return `405 Method Not Allowed` (GET not supported; POST is).
2. Check MP dashboard → Webhooks → recent deliveries. Look for 401 responses (signature mismatch — see next section) or 5xx.
3. Look at API logs:
   ```bash
   docker logs parallext-api --tail 200 | grep -i webhook
   ```

### Webhook signature verification fails (`401 invalid_signature`)
1. Confirm `MP_WEBHOOK_SECRET` matches the "Signing Key" in the MP dashboard (they rotate secrets — check `x-signature` recent deliveries).
2. If the secret is correct, MP may have changed their signature format (happened before — see `sdk-nodejs#318`). Log raw headers for debugging:
   ```bash
   docker logs parallext-api --tail 500 | grep -E 'x-signature|webhook'
   ```
3. Rotate the webhook secret in MP dashboard + update GitHub Secret `MP_WEBHOOK_SECRET` + redeploy.

### Plan sync failed on deploy (check the deploy log)
Common causes:
- `MP_ACCESS_TOKEN is not set` → the GitHub Secret is missing. Add it and redeploy.
- `Invalid --fx value` → the `MP_FX_<CC>` secret has a non-numeric value.
- MP returned an error body → read the "FAILED: MP returned..." line in the deploy log for MP's specific reason.

Seed failures on deploy are visible the same way. Both steps have `|| true` on the pipeline so they don't halt the deploy — a failure just means billing stays in its previous state. Fix the cause and redeploy.

---

## 7. Sandbox vs production credentials

| Token prefix | Environment | Where |
|---|---|---|
| `TEST-xxxxxxxxxxxxxxxx-xxxxxx-xxxxx` | MP Sandbox | Use during development. No real money moves |
| `APP_USR-xxxxxxxxxxxxxxxx-xxxxxx-xxxxx` | MP Production | Real customers, real charges |

The `MercadoPagoConfigService.environment()` method infers sandbox vs production from the token prefix — it logs which mode is active on every API boot. No code change is needed when swapping — just update the GitHub Secret value.

**Cutover plan for going live in Colombia:**
1. Create a production MP merchant account (requires Colombian legal entity or the Delaware LLC with local banking).
2. Get the APP_USR-prefixed Access Token + new Webhook Secret.
3. Replace the values in GitHub Secrets `MP_ACCESS_TOKEN` and `MP_WEBHOOK_SECRET`.
4. Trigger a deploy → the sync script creates production plans (fresh ids) and persists them into `billing_plans.priceLocalOverrides[CO].mpPlanId`, replacing the sandbox ones.
5. Update the webhook URL in the MP production dashboard to `https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago`.
6. Test a real card (low amount) end to end before announcing.

---

## 8. Quick reference — file map

| Concern | File |
|---|---|
| Strategic plan & decisions | `docs/billing-plan.md` |
| This runbook | `docs/billing-runbook.md` |
| Code architecture | `apps/api/src/modules/billing/README.md` |
| Tenant billing columns | `apps/api/prisma/schema.prisma` (`model Tenant`) |
| Global billing tables | `apps/api/prisma/schema.prisma` (4 `BillingX` models) |
| Schema migration | `apps/api/prisma/migrations/20260423000000_add_billing/migration.sql` |
| Seed script | `apps/api/prisma/seed-billing-plans.js` |
| MP sync script | `apps/api/scripts/sync-mp-plans.js` |
| Deploy automation | `.github/workflows/deploy.yml` (billing section) |
| Provider interface | `apps/api/src/modules/billing/adapters/payment-provider.interface.ts` |
| MercadoPago adapter | `apps/api/src/modules/billing/adapters/mercadopago.adapter.ts` |
| Billing service | `apps/api/src/modules/billing/billing.service.ts` |
| Webhook receiver | `apps/api/src/modules/billing/webhook.controller.ts` |
| Reconciliation cron | `apps/api/src/modules/billing/processors/reconciliation.processor.ts` |
