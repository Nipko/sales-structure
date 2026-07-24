# Operations Runbook — Parallext Engine

_Actualizado: jul 2026._

Operational procedures for super_admin. Aimed at production maintenance: tenant lifecycle, channel diagnostics, recall configuration, backups/restore, platform monitoring (Ops Center), SMS credits, fiscal DIAN, billing/MercadoPago, deploy/auth hardening, and recovery from common edge cases.

---

## 1. Tenant lifecycle

### 1.1 Delete a tenant completely (production-safe)

Two paths, in order of preference:

**A) Via API endpoint (recommended)** — orchestrates provider unsubscribe + DB + filesystem + Redis in the right order:

```bash
# Get a super_admin JWT first
TOKEN=$(curl -sX POST https://api.parallly-chat.cloud/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"super@admin.com","password":"..."}' | jq -r .data.accessToken)

curl -X DELETE "https://api.parallly-chat.cloud/api/v1/offboarding/<TENANT_ID>/purge" \
  -H "Authorization: Bearer $TOKEN" | jq
```

The endpoint returns a summary:
```json
{
  "success": true,
  "data": {
    "channelsDisconnected": 2,
    "publicRowsDeleted": {
      "billing_events": 0,
      "billing_payments": 0,
      "billing_subscriptions": 1,
      "billing_coupon_redemptions": 0,
      "audit_logs": 17,
      "channel_accounts": 2,
      "api_keys": 1,
      "users": 3,
      "fiscal_invoices_retained": 4,
      "tenants": 1
    },
    "schemaDropped": true,
    "mediaFilesRemoved": 47,
    "usersRevoked": 3
  }
}
```

**B) Via shell script (when API is down)** — falls back to raw SQL + Redis + filesystem:

```bash
# Preferred: use the API path through the script
PARALLLY_SUPER_ADMIN_TOKEN="$JWT" \
  ./infra/scripts/delete-tenant.sh <TENANT_UUID>

# Fallback: no token = raw SQL (skips provider unsubscribe)
./infra/scripts/delete-tenant.sh <TENANT_UUID>
```

**What gets deleted (both paths):**
- Public schema rows: `billing_events`, `billing_payments`, `billing_subscriptions`, `billing_coupon_redemptions`, `audit_logs`, `channel_accounts`, `whatsapp_onboardings`, `whatsapp_credentials`, `tenant_financial_snapshots`, `crm_connections`, `api_keys`, `feature_request_*`, `users`, `tenants`
- The tenant's PostgreSQL schema (`DROP SCHEMA tenant_<slug> CASCADE`) — wipes contacts, conversations, messages, properties, listings, tour_packages, treatment_plans, etc.
- Filesystem: `/data/media/{tenantId}/` (logos, product photos, property photos, attachments)
- Redis: `tenant:<id>:*`, `vertical:<id>`, `tenant_plan:<id>`, `offboard:past_due:<id>`, `refresh:<userId>:*` for every user
- External access is revoked before the drop: MP/Stripe subscription cancelled (`billing.cancelSubscription`), Google Calendar + Google Business Profile OAuth tokens revoked

**RETAINED on purpose (NOT deleted, both paths):** `fiscal_invoices` rows and the `/data/invoices/{tenantId}/` XML+PDF artifacts. Colombian DIAN requires keeping issued electronic invoices ~5 years. Since the `tenants` row disappears, each retained invoice's `metadata` is stamped (`tenantPurgedAt`, `tenantNameSnapshot`, `tenantSchemaSnapshot`) so it stays identifiable; the count comes back in the summary as `fiscal_invoices_retained` (NOT `*_deleted`). `mediaService.deleteAllTenantFiles` only touches `/data/media`, never `/data/invoices`.

**Difference between paths:** API path also calls Meta/Telegram/Instagram/Twilio to unsubscribe webhooks and cancels the payment-provider subscription. SQL fallback skips that — Meta might keep firing webhooks until you clean it up manually in their console, and an active MP/Stripe subscription may stay open.

### 1.2 Suspend / cancel a tenant (reversible)

```bash
# Voluntary cancellation (keeps access until period_end)
POST /offboarding/:tenantId/cancel
{ "reason": "client requested cancellation" }

# Immediate suspension (super_admin only)
POST /offboarding/:tenantId/suspend
{ "reason": "non-payment" }

# Reactivate
POST /offboarding/:tenantId/reactivate
```

Difference from `purge`:
- Suspend/cancel **flip flags** (`is_active=false`, `subscription_status='cancelled'`) but keep all data. Reversible
- Purge **deletes everything** irreversibly

### 1.3 Reactivate channels for a tenant whose channels were silently turned off

If a tenant's channels were marked inactive by the past_due cron (or any other path) and you reactivated the tenant manually but channels stayed off:

```bash
# Endpoint
POST /offboarding/:tenantId/reactivate-channels

# Response
{
  "success": true,
  "data": {
    "restored": 2,        // channels back online
    "needsReconnect": 1   // channels where Meta was unsubscribed — user must redo OAuth
  }
}
```

The `needsReconnect` count are channels with `metadata.disconnected_at_provider=true` — those need full OAuth flow again, not just a flag flip. The endpoint does NOT touch them.

---

## 2. Diagnose a tenant's channels

> **Multi-account per type (jul 2026).** A tenant can now hold **more than one connection of the same `channel_type`** (e.g. 2 WhatsApp numbers, 2 Instagram accounts). The number allowed is gated per plan × channel via `features.maxChannelAccounts` (default 1) in `billing_plans`, with an optional per-tenant override. This changes several assumptions below:
> - `channel_accounts` can return **>1 row for the same `channel_type`** — always disambiguate by `account_id` (WhatsApp: phone_number_id).
> - Tokens are now **per-account**: `channel_accounts.access_token` (encrypted) is preferred; legacy rows with the `credential_ref`/`encrypted_ref` placeholder fall back to the shared `whatsapp_credentials` row. Token cache key is `${channel}_token:{tenantId}:{accountId}`.
> - Agents bind **per connection**, not per channel: `agent_personas.channel_bindings` holds `"{type}:{accountId}"` entries (an exact binding wins over the type-level `channels` array). "One agent per connection".
> - Disconnect is **per-account** (`DELETE .../disconnect` targets one `accountId`); disconnecting one number leaves the tenant's other same-type connections online.

### 2.1 What channels does a tenant have?

> A tenant may have several rows per `channel_type` — the `ORDER BY channel_type` groups them; read `account_id` to tell them apart.

```sql
SELECT
    ca.channel_type,
    ca.account_id              AS phone_number_id,
    ca.display_name,
    ca.is_active,
    ca.metadata->>'disconnected_at'           AS disconnected_at,
    ca.metadata->>'disconnected_at_provider'  AS provider_unsubscribed,
    ca.metadata->>'disconnect_error'          AS error,
    ca.created_at,
    ca.updated_at
FROM channel_accounts ca
WHERE ca.tenant_id = '<TENANT_UUID>'
ORDER BY ca.channel_type;
```

### 2.2 Tenants with broken channels (BD says inactive, has conversations)

```sql
SELECT
    t.id, t.name, t.slug,
    t.is_active                                AS tenant_activo,
    t.subscription_status                      AS estado,
    (SELECT COUNT(*) FROM channel_accounts WHERE tenant_id = t.id AND is_active = true)  AS canales_activos,
    (SELECT COUNT(*) FROM channel_accounts WHERE tenant_id = t.id AND is_active = false) AS canales_inactivos,
    (SELECT MAX(created_at) FROM audit_logs WHERE tenant_id = t.id AND action ILIKE '%offboard%') AS ultimo_offboarding
FROM tenants t
WHERE EXISTS (
    SELECT 1 FROM channel_accounts ca
    WHERE ca.tenant_id = t.id AND ca.is_active = false
)
ORDER BY t.created_at DESC;
```

### 2.3 Audit trail of channel disconnects

```sql
SELECT created_at, action, resource, details
FROM audit_logs
WHERE tenant_id = '<TENANT_UUID>'
  AND action IN ('channel_disconnected', 'channels_force_reactivated', 'tenant_offboarded', 'tenant_reactivated', 'stale_channels_purged')
ORDER BY created_at DESC
LIMIT 30;
```

### 2.4 The webhook is rejecting messages — is the channel marked active?

When the WhatsApp logs show:
```
WhatsappWebhookService: No active channel_account for phoneNumberId: <id>
WhatsappWebhookService: No tenant found for phoneNumberId: <id> — ignoring message
```

That means Meta is sending webhooks but BD doesn't have an `is_active=true` row matching `account_id=<phone_number_id>`. Two scenarios:

```sql
-- Does the row exist? In what state?
SELECT id, tenant_id, channel_type, account_id, is_active,
       metadata->>'disconnected_at' AS disconnected_at,
       metadata->>'disconnected_at_provider' AS provider_unsubscribed
FROM channel_accounts
WHERE account_id = '<phone_number_id_from_log>';
```

- **0 rows** → row never existed or was hard-deleted. Tenant has to reconnect through Embedded Signup
- **is_active=false, provider_unsubscribed=true** → user (or the cron) explicitly disconnected from Meta. Reconnect required
- **is_active=false, provider_unsubscribed=false** → row was flipped without telling Meta. Either reactivate (`reactivate-channels` endpoint) or unsubscribe in Meta Business Suite manually

---

## 3. Recall (time-since-last-appointment) configuration

### 3.1 Configure for a tenant

```bash
# Read current config (returns defaults if nothing saved)
GET /api/v1/recall/{tenantId}/config

# Update — typical dental setup
PUT /api/v1/recall/{tenantId}/config
{
  "enabled": true,
  "daysThreshold": 180,
  "cooldownDays": 90,
  "channelType": "whatsapp",
  "message": "Hola {name}, ya pasaron {months} meses desde tu última visita. ¿Quieres agendar tu cita de control?"
}

# Trigger manually (testing)
POST /api/v1/recall/{tenantId}/run-now
```

`{name}` and `{months}` are interpolated server-side per contact.

### 3.2 What contacts are eligible right now?

```sql
SELECT id, name, phone, last_appointment_at, next_recall_at,
       EXTRACT(DAY FROM (NOW() - last_appointment_at)) AS days_since_last
FROM <tenant_schema>.contacts
WHERE phone IS NOT NULL
  AND last_appointment_at IS NOT NULL
  AND last_appointment_at < NOW() - INTERVAL '180 days'
  AND (next_recall_at IS NULL OR next_recall_at <= NOW())
ORDER BY last_appointment_at ASC
LIMIT 50;
```

The cron runs at 9 AM daily and processes up to 100 contacts per tenant per run.

### 3.3 Why didn't the recall fire for X tenant?

Common causes:
- `tenant.settings.recallConfig.enabled` is not `true`
- Tenant has no active WhatsApp channel (`channel_accounts.is_active=true`)
- `next_recall_at` was set recently and hasn't expired (cooldown)
- `last_appointment_at` is `NULL` — appointments need to be marked as `completed` (manually or via the auto-complete cron)

```sql
SELECT (settings->>'recallConfig')::jsonb AS recall_config
FROM tenants
WHERE id = '<TENANT_UUID>';
```

---

## 4. Stale channels purge

The `purgeStaleInactiveChannels` cron runs at 5 AM daily and hard-deletes `channel_accounts` rows that have been `is_active=false` for >90 days.

### 4.1 Force-run the purge logic right now (debugging)

There's no manual trigger endpoint — to test, edit a row's `metadata.disconnected_at` to a date >90 days ago and wait for 5 AM:

```sql
UPDATE channel_accounts
SET metadata = metadata || jsonb_build_object('disconnected_at', (NOW() - INTERVAL '100 days')::text)
WHERE id = '<channel_account_id>'
  AND is_active = false;
```

Then check the audit log the next day:

```sql
SELECT created_at, details->>'purged' AS count, details->'channels' AS purged_channels
FROM audit_logs
WHERE action = 'stale_channels_purged'
ORDER BY created_at DESC LIMIT 5;
```

### 4.2 Adjust the threshold

The 90-day window is hardcoded in `OffboardingCronService.purgeStaleInactiveChannels`. If you need to tune it per environment, lift it to an env var (`STALE_CHANNEL_DAYS`) and `parseInt(process.env.STALE_CHANNEL_DAYS || '90', 10)`.

---

## 5. MercadoPago — operating tasks

### 5.1 Rotate the access token without rebuild

```bash
# 1. Edit .env on the VPS
vi /opt/parallext-engine/.env
# Change MP_ACCESS_TOKEN=...

# 2. Recreate api + worker (env_file is only read on container create, not restart)
cd /opt/parallext-engine/infra/docker
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps api worker
```

The next deploy from GitHub Actions regenerates `.env` from secrets — **also update the secret** in GitHub if the change should survive deploys.

### 5.2 Sync MP plan IDs after price change

Plans are the source of truth in the `billing_plans` table (seeded by `apps/api/prisma/seed-billing-plans.js`, then editable from **`/admin/plans`**). Prices are **data-driven** — there are no hardcoded COP amounts anymore. USD anchors: emprendedor $21, starter $49, pro $129, enterprise $349, custom (sales-led, not syncable). Local overrides (e.g. COP) and the yearly total live in `priceLocalOverrides[country]` / `...annual`.

Preferred path is the panel, which replaces the SSH-only `scripts/sync-mp-plans.js` for a single plan+country and registers the preapproval_plan **per cycle** (monthly vs annual are SEPARATE MP plans):

```bash
# Panel: /admin/plans → "Sincronizar con MercadoPago" (per plan+country+cycle)
# API:  POST /billing-admin/plans/:slug/sync-mp   { "country": "CO", "cycle": "month" | "year", "force": false }
#   → creates the MP plan and stores mpPlanId under priceLocalOverrides[CO].mpPlanId (monthly)
#     or priceLocalOverrides[CO].annual.mpPlanId (annual). Idempotent per cycle.
```

`cycle:"year"` requires an annual local price already set (`priceLocalOverrides.CO.annual.amountCents` = full-year total in cents, ≈ −15% vs 12× monthly); it 400s with `no_annual_price` otherwise. `Custom` returns `custom_not_syncable`. Every sync writes an `billing_plan_synced_mp` audit row.

The legacy batch script still exists for bulk/one-off use:

```bash
docker exec parallext-api sh -c 'node scripts/sync-mp-plans.js --country=CO'
```

### 5.3 Why is starter trial returning 400?

`starter` is free-trial without card. The MP adapter requires `card_token_id` always — if `BillingService.createTrialSubscription` calls the adapter, it 400s. The fix in `b0e9c53` makes `createTrialSubscription` skip the provider call for free trials and create the subscription locally in `trialing` state. If you see the bug again, check `plan.requiresCardForTrial` is `false` for starter and `cardTokenId` is empty in the payload.

### 5.4 Monthly vs annual billing cycle

Every plan (except custom) can be billed **monthly or annually** (annual ≈ −15% vs 12× monthly). The two cycles are distinct MercadoPago `preapproval_plan`s with their own `mpPlanId` (`priceLocalOverrides[country].mpPlanId` vs `...annual.mpPlanId`), synced independently via §5.2. The landing `/precios` page and the in-app plan toggle read these amounts data-driven from `billing_plans`.

### 5.5 Cross-tenant billing views + inline refund (super_admin)

Billing-ops screens are backed by `/billing-admin/*` (super_admin):

```bash
GET  /billing-admin/subscriptions          # all tenants' subscriptions
GET  /billing-admin/payments               # all payments
GET  /billing-admin/events                 # all billing_events
POST /billing-admin/payments/:paymentId/refund   # inline refund (audited)
POST /billing-admin/tenants/:tenantId/comp-plan   # grant a comped plan
PUT  /billing-admin/tenants/:tenantId/plan        # change/downgrade a tenant's plan
```

### 5.6 Reconciliation (on-demand + downgrade sync)

Beyond the hourly `ReconciliationProcessor`, super_admin can trigger it by hand:

```bash
POST /billing-admin/reconcile              { "scope": "past_due" | "full" }   # platform-wide
POST /billing-admin/tenants/:tenantId/reconcile    # single tenant: syncFromProvider
```

Downgrades through `PUT /billing-admin/tenants/:tenantId/plan` also sync the change down to MercadoPago (the preapproval amount is updated), so the provider and our DB don't drift.

### 5.7 Price-change auditing

Editing a plan in `/admin/plans` (`PUT /billing-admin/plans/:slug`) is a create-only-safe upsert (the seed never overwrites panel values without `--force`) and writes an audit row on price/plan changes. MP syncs and manual reconciles are audited too (`billing_plan_synced_mp`, `billing_reconcile_manual`).

---

## 6. Vertical config — repair a tenant whose verticalConfig is missing

Tenants created before May 2 don't have `tenant.settings.verticalConfig`. The dashboard handles this gracefully now (`getVerticalConfig` rebuilds + persists from `tenant.industry`), but if you need to force the rebuild:

```sql
-- See tenants without verticalConfig
SELECT id, name, industry, settings->'verticalConfig' AS vc
FROM tenants
WHERE settings->'verticalConfig' IS NULL
  AND industry IS NOT NULL;
```

```bash
# Force rebuild for one tenant — just hit the endpoint, the service writes back
GET /api/v1/verticals/<TENANT_ID>
```

Or trigger the bootstrap fully (re-seeds FAQs, services, pipeline stages — only safe for fresh tenants, not for ones already with data):

```sql
DELETE FROM <tenant_schema>.faqs WHERE category IN ('seguros','dolor','ortodoncia','urgencias','costos');
DELETE FROM <tenant_schema>.services WHERE name IN (...);
-- then call the verticals service from a node REPL or restart with onboarding flag
```

---

## 7. Inbox — mass-resolve / mass-reopen

### 7.1 Find conversations the cron auto-resolved

```sql
SELECT c.id, c.contact_id, c.channel_type, c.status, c.resolved_at,
       ct.name AS contact, ct.phone
FROM <tenant_schema>.conversations c
LEFT JOIN <tenant_schema>.contacts ct ON ct.id = c.contact_id
WHERE c.status = 'resolved'
  AND c.resolved_at IS NOT NULL
ORDER BY c.resolved_at DESC
LIMIT 50;
```

### 7.2 Reopen a conversation manually

```sql
UPDATE <tenant_schema>.conversations
SET status = 'active', resolved_at = NULL, updated_at = NOW()
WHERE id = '<conversation_id>';
```

Or via API:
```bash
POST /api/v1/agent-console/conversation/<TENANT_ID>/<CONV_ID>/reopen
```

### 7.3 Disable auto-resolve for a tenant (not yet exposed)

The cron `NurturingService.autoResolveStale` runs globally every 6h. If you need to keep stale conversations open for a specific tenant, the cleanest fix is to set a high inactivity threshold (currently hardcoded at 72h). To bypass for a specific tenant, you'd need to add a `tenant.settings.autoResolveStale=false` check inside the cron.

---

## 8. Cron schedule reference

| Cron expression | Service | Purpose |
|---|---|---|
| `0 1 1 * *` | FinancialSnapshotService | Monthly platform-wide MRR snapshot |
| `0 2 * * *` | MetricsAggregationService | Nightly aggregation into daily_metrics |
| `0 3 * * *` | OffboardingCronService | Grace enforcer (past_due >7d, cancelled+ended → offboard) |
| `0 4 * * *` | OffboardingCronService | Archive cleaner (drop schemas of inactive >90d tenants) |
| `0 5 * * *` | OffboardingCronService | **NEW: Stale channel purge (channel_accounts inactive >90d)** |
| `0 6 * * *` | InstagramTokenRefreshService | Refresh IG tokens expiring within 30 days |
| `0 9 * * *` | RecallService | **NEW: Send recall messages (time_since_last_appointment)** |
| `*/15 * * * *` | AlertsService | Evaluate threshold alert rules |
| `*/30 * * * *` | IcalSyncService | Sync iCal feeds (Airbnb/Booking) |
| `0 8 * * 1` | ScheduledReportsService | Weekly email reports (Monday 8 AM) |
| `0 8 1 * *` | ScheduledReportsService | Monthly email reports |
| `*/5 * * * *` | AgentAvailabilityService | Auto-offline inactive agents |
| `*/2 * * * *` | AgentAvailabilityService | Escalate stale handoffs (>5 min) |
| `0 */6 * * *` | NurturingService | Auto-resolve conversations inactive >72h |
| `0 */2 * * *` | NurturingService | Check stale conversations for follow-up |
| `*/15 * * * *` | AppointmentRemindersService | 24h appointment reminders |
| `3,18,33,48 * * * *` | AppointmentRemindersService | 1h appointment reminders |
| `5,35 * * * *` | AppointmentRemindersService | Auto-mark no-shows |
| `20 * * * *` | AppointmentRemindersService | Auto-complete confirmed appointments (ended 2h+ ago) |
| daily | BillingService | Trial ending soon (3 days before) |
| hourly | ReconciliationProcessor | past_due sweep + drift detection |

---

## 9. Quick reference — common SQL queries

### What's the state of every tenant?

```sql
SELECT t.id, t.name, t.slug, t.industry,
       t.is_active, t.subscription_status,
       (SELECT COUNT(*) FROM channel_accounts WHERE tenant_id = t.id AND is_active = true) AS canales,
       (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND is_active = true)             AS users
FROM tenants t
ORDER BY t.created_at DESC;
```

### Storage usage per tenant (filesystem)

```bash
docker exec parallext-api sh -c 'cd /data/media && du -sh */ 2>/dev/null | sort -h | tail -20'
```

### Audit recent actions

```sql
SELECT created_at, tenant_id, action, resource
FROM audit_logs
ORDER BY created_at DESC
LIMIT 50;
```

---

## 10. Related docs

- `CHANGELOG.md` — chronological list of every change
- `user-manual.md` — end-user documentation (sections 21-26 cover Tier 1 features)
- `architecture-detail.md` — internal architecture
- `modules-reference.md` — 40 modules and their files
- `analytics-billing-reference.md` — analytics / billing / financials
- `appointments-manual.md` — appointments specifics
- `billing-runbook.md` — MercadoPago specifics
- `offboarding-manual.md` — offboarding flow detail
- `vertical-strategy.md` — which verticals + roadmap
