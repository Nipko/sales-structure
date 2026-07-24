> ⚠️ **ARCHIVADO (2026-07-23) — documento histórico.** Sprint tecnico Tier 1 cerrado. No refleja el estado actual del código; se conserva como referencia.

# Sprint Tier 1 — Technical Reference

Internal architecture of the May 2026 vertical sprints. For developers extending or operating these modules.

---

## 1. Tours module (`apps/api/src/modules/tours/`)

### Schema (tenant schema)

```sql
tour_packages       -- catalogue, both same-day (duration_type=hours) and multi-day (duration_type=days)
  (id, name, description, duration_type, duration_value, price, currency,
   max_capacity, min_party_size, departure_location, destination,
   languages JSONB, includes JSONB, excludes JSONB, what_to_bring,
   child_discount_pct, cancellation_policy, images JSONB, tags JSONB,
   is_active, sort_order, metadata JSONB)
  index: (is_active, sort_order) where is_active=true

tour_inventory      -- per-departure capacity. OPTIONAL — packages without rows = unlimited
  (id, package_id, departure_date, departure_time, available_seats,
   total_seats, price_override, is_active, notes)
  unique: (package_id, departure_date, departure_time)

tour_bookings
  (id, package_id, inventory_id NULL-able, contact_id, conversation_id,
   guest_name, guest_email, guest_phone, departure_date, departure_time,
   party_size, adults, children, unit_price, total_price, currency,
   language, special_requests, status, payment_status, metadata)
  status enum: reserved | confirmed | completed | cancelled | no_show
  payment_status: pending | paid | refunded (V1 doesn't charge online)
```

### Services + key methods

`ToursService`:
- `listPackages(schemaName, includeInactive=false)`
- `createPackage(tenantId, schemaName, data)` — plan-gated via `throttle.getPlanFeatures(tenantId).maxProperties` (shared cap with vacation-rental)
- `updatePackage`, `deletePackage` (soft delete)
- `listInventory`, `createInventory` (UPSERT on `package_id, departure_date, departure_time`), `deleteInventory` (soft)
- `checkAvailability(schemaName, packageId, departureDate, partySize)` — returns `{ available, seatsLeft: number | 'unlimited', reason? }`
- `createBooking(...)` — atomically decrements `tour_inventory.available_seats` if inventory row exists. **Uses a non-locking UPDATE** (no FOR UPDATE) — fine for V1 traffic, upgrade path for high concurrency
- `cancelBooking(...)` — restores seats
- `searchPackages(schemaName, params)` — used by AI tool, max 20 hits per call

### REST endpoints (`/tours/:tenantId/...`)

| Method | Path | Notes |
|---|---|---|
| GET | `/packages` | `?includeInactive=true` to see soft-deleted |
| POST | `/packages` | plan-gated |
| GET | `/packages/:id` | |
| PUT | `/packages/:id` | partial update |
| DELETE | `/packages/:id` | soft |
| GET | `/packages/:id/inventory` | `?fromDate=YYYY-MM-DD` |
| POST | `/packages/:id/inventory` | upsert by date+time |
| DELETE | `/inventory/:invId` | soft |
| GET | `/packages/:id/availability` | `?date=&partySize=` |
| GET | `/bookings` | `?packageId=` filter |
| POST | `/bookings` | requires packageId, departureDate, partySize, guestName |
| PUT | `/bookings/:id/cancel` | restores seats |

### AI tools (`apps/api/src/modules/conversations/tools/tours-tools.ts`)

Gated by `config.tools.tours.enabled`. Registered in both `ConversationsService` and `AgentTestService`.

| Tool | Purpose |
|---|---|
| `search_packages` | filters: `destination`, `durationType`, `date`, `partySize`, `maxPrice`. Returns up to 8 packages with seats remaining when `date` is provided |
| `get_package_details` | full record + upcoming departures (next 10) |
| `check_package_availability` | seats-left check for specific date |
| `create_tour_booking` | requires packageId, departureDate, partySize, guestName. Decrements inventory, returns booking summary |

Handler implementation in `ai-tool-executor.service.ts:searchPackages` / `getPackageDetails` / `checkPackageAvailabilityTool` / `createTourBooking`.

### Bootstrap content

When onboarding completes with `industry='turismo'` and sub-type in `['tours', 'agencia_viajes']`, `VerticalsService.seedToursExtras` seeds 5 ops-focused FAQs (transfer, child discount, languages, cancellation, meeting point) in the tenant's language. `enableToursTool` flips `config.tools.tours.enabled=true` on the default agent so the AI can use the tools immediately.

### Vertical agent templates

In `persona.service.ts:getVerticalTemplates('turismo')`:
- `tpl_turismo_tours` (Maya — Tours del Día) — explicit rules: ask date+party first, USE search_packages, confirm guide language, escalate groups >10
- `tpl_turismo_agencia` (Maya — Agencia de Viajes) — captures lead data, recommends insurance for international, escalates custom packages

---

## 2. Treatment Plans module (`apps/api/src/modules/treatment-plans/`)

### Schema

```sql
treatment_plans     -- multi-session treatments (orthodontics, physiotherapy, aesthetic series)
  (id, contact_id, name, plan_type, total_sessions, completed_sessions,
   frequency_days, total_cost, currency, started_at, expected_end_at,
   completed_at, status, notes, metadata)
  status enum: active | completed | paused | cancelled
  index: (contact_id) where status='active'

treatment_sessions
  (id, plan_id, appointment_id NULL-able, session_number,
   scheduled_at, completed_at, status, notes)
  status enum: pending | scheduled | completed | cancelled | no_show
  unique-ish: (plan_id, session_number)

contacts.last_appointment_at  TIMESTAMP  -- new column, ALTER TABLE … IF NOT EXISTS
contacts.next_recall_at       TIMESTAMP  -- index where next_recall_at IS NOT NULL
```

### Services + key methods

`TreatmentPlansService`:
- `create(schemaName, data)` — auto-calculates `expected_end_at` if `frequencyDays` and `startedAt` provided
- `addSession(schemaName, planId, data)` — auto-assigns next session_number (rejects if plan would exceed `total_sessions`)
- `completeSession(schemaName, sessionId)` — bumps parent's `completed_sessions`, auto-marks plan as `completed` when full
- `cancelSession`, `delete` (soft → status='cancelled')
- `summaryForContact(schemaName, contactId)` — used by AI tools, returns active plan + upcoming sessions

### REST endpoints (`/treatment-plans/:tenantId/...`)

`GET /contacts/:contactId` (list plans), `POST /plans`, `GET /plans/:id`, `PUT /plans/:id`, `DELETE /plans/:id`, `POST /plans/:id/sessions`, `PUT /sessions/:id/complete`, `PUT /sessions/:id/cancel`

### AI tools (`treatment-tools.ts`)

Gated by `config.tools.treatments.enabled`.

| Tool | Purpose |
|---|---|
| `get_treatment_plan` | active plan + progress % + sessions left for the contact in conversation |
| `list_upcoming_sessions` | next N pending/scheduled sessions |

### Hooks for `last_appointment_at`

Both update sites:
- `AppointmentsService.update` — when `data.status === 'completed'`, sets `contacts.last_appointment_at = NOW()` and clears `next_recall_at`
- `AppointmentRemindersService.processAutoComplete` — bulk update for auto-completed appointments (cron `20 * * * *`)

### Vertical template

`tpl_salud_dental` — Sofía dental:
- Pain/trauma/bleeding triggers immediate handoff
- Routine cleanings book directly; orthodontics/whitening require 30-min assessment first
- Uses `get_treatment_plan` + `list_upcoming_sessions` when patient has active plan
- Forbidden: diagnoses, prescriptions, treatment outcome predictions, exact prices without assessment

---

## 3. Recall module (`apps/api/src/modules/recall/`)

Transversal system — sends WhatsApp template to contacts inactive for N days.

### Service

`RecallService`:
- `processRecalls()` — cron `0 9 * * *`. Iterates active tenants where `tenant.settings.recallConfig.enabled=true`, processes each
- `processForTenant(tenantId, schemaName, config)` — finds contacts where `last_appointment_at < NOW() - daysThreshold AND (next_recall_at IS NULL OR next_recall_at <= NOW())`. Limit 100 per run. Sends via `OutboundQueueService.enqueue`. Stamps `next_recall_at = NOW() + cooldownDays` to avoid spam
- `getConfig(tenantId)` — returns persisted config or defaults
- `setConfig(tenantId, config)` — validates + persists to `tenant.settings.recallConfig`
- `runNow(tenantId)` — manual trigger, returns `{ sent: number }`

### Config shape

```typescript
{
  enabled: boolean,
  daysThreshold: number,    // e.g. 180 for dental
  cooldownDays: number,     // default 90
  channelType: 'whatsapp' | 'instagram' | ...,
  message: string,          // template body. Supports {name} and {months}
}
```

### REST endpoints

```
GET  /recall/:tenantId/config    (super_admin / tenant_admin)
PUT  /recall/:tenantId/config    (super_admin / tenant_admin)
POST /recall/:tenantId/run-now   (super_admin / tenant_admin)
```

---

## 4. Listings module (`apps/api/src/modules/listings/`)

Long-term sale/rent — separate from `vacation-rental` (short-term stays).

### Schema

```sql
real_estate_listings
  (id, name, transaction_type, property_kind, price, currency, rent_period,
   hoa_fee, deposit, min_rental_months, financing_available,
   bedrooms, bathrooms (DECIMAL 3,1 — supports half-baths), area_m2,
   parking_spots, stratum, year_built,
   address, neighborhood, city, country, latitude, longitude,
   description, amenities JSONB, images JSONB, external_url,
   status, assigned_agent_id, is_active, metadata)
  transaction_type enum: sale | rent
  property_kind enum: apartment | house | commercial | land | office
  status enum: available | reserved | sold | rented | inactive
  index: (transaction_type, city, neighborhood, status) where is_active=true
  index: (transaction_type, price) where is_active=true and status='available'

listing_zone_agents -- maps neighborhood → default agent
  (id, neighborhood, city, agent_id)
  unique: (neighborhood, city)
```

### Service

`ListingsService` — CRUD + `search(schemaName, params)` (used by AI tool) + zone agent CRUD + `resolveAgentForZone(neighborhood, city)` for routing.

`search` accepts: `transactionType`, `propertyKind`, `maxPrice`, `minPrice`, `minBedrooms`, `neighborhood` (partial match), `city` (partial match), `minAreaM2`, `limit` (max 50, default 10).

### REST endpoints (`/listings/:tenantId/...`)

| Method | Path |
|---|---|
| GET | `/` (list) — `?transactionType=sale\|rent&status=` |
| POST | `/` |
| GET | `/search` — same params as service |
| GET | `/listings/:id` |
| PUT | `/listings/:id` |
| DELETE | `/listings/:id` (soft) |
| GET | `/zones` |
| POST | `/zones` — `{ neighborhood, agentId, city? }` |
| DELETE | `/zones/:id` |

### AI tools (`listings-tools.ts`)

Gated by `config.tools.realEstate.enabled`.

| Tool | Purpose |
|---|---|
| `search_listings` | structured search; returns up to 8 with key fields + status |
| `get_listing_details` | full record incl. external_url, deposit/HOA/financing |

### Vertical template

`tpl_inmobiliaria_listings` — Carlos:
- Asks sale-vs-rent + budget + zone + bedrooms FIRST
- USES search_listings (rule: don't invent properties)
- Captures name + phone before booking viewing
- For rent: warns HOA usually paid separately
- For sale: surfaces mortgage/housing subsidy eligibility

---

## 5. Channels — disconnect + reactivate flow

### Universal contract

Every disconnect endpoint now returns:

```typescript
{
  success: true,
  message: string,        // localised
  providerOk: boolean,    // true = remote provider unsubscribe confirmed
  providerError?: string, // human-readable error if providerOk=false
}
```

### Helper used by all channel-management endpoints

`ChannelManagementController.finalizeChannelDisconnect(tenantId, channelType, providerOk, providerError, userId)` does:
1. UPDATE channel_accounts WHERE tenant_id AND channel_type AND is_active=true → `is_active=false` + metadata stamp:
   ```jsonb
   {
     "disconnected_at": "<ISO>",
     "disconnected_at_provider": <bool>,
     "disconnect_error": <string|null>
   }
   ```
2. Inserts `audit_logs` row (`action='channel_disconnected'`, `resource=channelType`, details with `triggeredBy`, `providerOk`, `providerError`, `rowsTouched`)
3. Invalidates Redis token cache (`channelTokenService.invalidateCache(channelType, tenantId)`)

### Per-channel provider calls

| Channel | Endpoint called | Method |
|---|---|---|
| WhatsApp | `https://graph.facebook.com/v21.0/{wabaId}/subscribed_apps?access_token=...` | DELETE |
| Telegram | `https://api.telegram.org/bot{token}/deleteWebhook?drop_pending_updates=true` | POST |
| Messenger | `https://graph.facebook.com/v21.0/{pageId}/subscribed_apps?access_token=...` (one per page) | DELETE |
| Instagram | `https://graph.instagram.com/me/permissions?access_token=...` | DELETE |
| SMS / Twilio | `https://api.twilio.com/2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers/{Pn}.json` (clears `SmsUrl` + `SmsFallbackUrl`) | POST |

### Reactivate logic

`OffboardingService.reactivate(tenantId)` and `reactivateChannels(tenantId)`:
- UPDATE channel_accounts WHERE tenant_id AND is_active=false **AND** `COALESCE((metadata->>'disconnected_at_provider')::boolean, false) = false`
- Channels with `disconnected_at_provider=true` are left inactive (can't auto-restore — user must redo OAuth)
- Returns `{ restored: number, needsReconnect: number }` so the dashboard can warn

### `purgeStaleInactiveChannels` cron (5 AM daily)

```sql
DELETE FROM channel_accounts
WHERE is_active = false
  AND COALESCE((metadata->>'disconnected_at')::timestamp, updated_at) < (NOW() - INTERVAL '90 days')
RETURNING id, tenant_id, channel_type, account_id;
```

One audit_log batch row per run with the list. `audit_logs` row stays — that's the historical truth.

---

## 6. Tenant purge (`OffboardingService.purgeTenant`)

Single irreversible flow; called via:
- `DELETE /offboarding/:tenantId/purge` (super_admin)
- `infra/scripts/delete-tenant.sh --api-token=...` (preferred path)

### Order of operations (FK-safe + provider-safe)

1. **Resolve tenant** (`schemaName`, `name`) — throws if not found
2. **`disconnectAllChannels(tenantId)`** — provider unsubscribe (Meta/Telegram/IG/Twilio), per-account `metadata.disconnected_at_provider` stamp
3. **Capture `userIds`** before delete — needed for refresh-token cleanup
4. **`drainTenantQueues(tenantId)`** — purges 5 BullMQ queues so no in-flight job touches the schema after drop
5. **Delete public-schema rows** in FK-safe order:
   - `billing_events` (via subscription_id IN ...)
   - `billing_payments`
   - `billing_subscriptions`
   - `audit_logs`
   - `channel_accounts`
   - `whatsapp_onboardings`
   - `whatsapp_credentials`
   - `tenant_financial_snapshots`
   - `crm_connections`
   - `feature_request_votes`
   - `feature_request_comments`
   - `feature_request_subscribers` (by userId, not tenantId — different schema)
   - `feature_requests` (by author_tenant_id)
   - `users`
6. **`DROP SCHEMA "{schemaName}" CASCADE`** — wipes contacts, conversations, messages, properties, listings, tour_packages, treatment_plans, media_files, faqs, services, etc. Schema name sanitized against path traversal first
7. **`mediaService.deleteAllTenantFiles(tenantId)`** — `rm -rf /data/media/{tenantId}/`
8. **Delete `tenants` row**
9. **Redis cleanup**:
   - `tenant:<id>:config`, `tenant:<id>:schema`, `tenant_plan:<id>`, `vertical:<id>`, `offboard:past_due:<id>`
   - Wildcard scan `tenant:<id>:*` for any leftover keys
   - For each user: `refresh:<userId>:*` (revokes all sessions)
10. **Emit `tenant.purged` event** for downstream listeners (analytics, BI)

### Returns

```typescript
{
  channelsDisconnected: number,
  publicRowsDeleted: { [table]: number },  // -1 if a delete failed (logged but not thrown)
  schemaDropped: boolean,
  mediaFilesRemoved: number,
  usersRevoked: number,
}
```

---

## 7. Inbox — resolved filter

`AgentConsoleService.getInbox` now accepts a 5th filter `'resolved'`:

```typescript
type InboxFilter = 'all' | 'mine' | 'unassigned' | 'handoff' | 'resolved';
```

When `filter='resolved'`:
- WHERE clause inverts: `c.status = 'resolved'` (instead of NOT IN ('resolved','archived'))
- ORDER BY `c.resolved_at DESC NULLS LAST`
- LIMIT 200 (vs 100 for active inbox)

`POST /agent-console/conversation/:tenantId/:id/reopen` flips status back to `'active'` and clears `resolved_at`.

Frontend (`/admin/inbox/page.tsx`):
- New pill "Resueltas" in the filter row
- `useEffect` reloads when filter changes
- When viewing a resolved conversation, the message input is hidden and replaced by a banner with `<CheckCircle>` + "Reabrir conversación" button
- Clicking reopen → API call → `setFilter('all')` so the thread reappears

---

## 8. Convention reminders

These showed up as bugs during this sprint — keep them in mind:

- **`$queryRawUnsafe<T>(...)`** — Prisma in this version doesn't accept generic type arguments. Use `(await this.prisma.$queryRawUnsafe(...)) as any[]` instead. CLAUDE.md has this rule
- **`tenant_id` column type** is **inconsistent across tables**. `channel_accounts.tenant_id` is `uuid` (so `$1::uuid` cast works), `whatsapp_credentials.tenant_id` is `text` (so the cast crashes with `text = uuid`). Prefer the typed Prisma client (`prisma.whatsappCredential.updateMany({ where: { tenantId } })`) for tables you're not sure about
- **i18n keys** that the sidebar reads live under `nav.items.<key>`, NOT under `topbar.breadcrumbs.<key>`. Adding to one without the other shows the literal key in the UI
- **Vertical empty-state strings** are read dynamically as `verticalEmptyStates.<industry>.<page>` — every industry needs all the page sub-keys, plus a `default` fallback
- **camelCase vs snake_case at the API boundary**: backend services accept camelCase in req.body (`maxGuests`, `nightPrice`), Postgres columns are snake_case. Forms that send snake_case get silently dropped. Always check the field map in the service's `update()` method

---

## 9. Files added in this sprint

```
apps/api/src/modules/tours/
  tours.service.ts
  tours.controller.ts
  tours.module.ts
apps/api/src/modules/treatment-plans/
  treatment-plans.service.ts
  treatment-plans.controller.ts
  treatment-plans.module.ts
apps/api/src/modules/listings/
  listings.service.ts
  listings.controller.ts
  listings.module.ts
apps/api/src/modules/recall/
  recall.service.ts
  recall.controller.ts
  recall.module.ts
apps/api/src/modules/conversations/tools/
  tours-tools.ts
  treatment-tools.ts
  listings-tools.ts
apps/api/src/modules/vacation-rental/
  ical-export-public.controller.ts        (public iCal export endpoint, no auth)

apps/dashboard/src/app/admin/
  tours/page.tsx + [packageId]/page.tsx
  listings/page.tsx + [listingId]/page.tsx
apps/dashboard/src/components/
  TreatmentPlansCard.tsx                  (collapsible card on lead detail)

infra/scripts/
  delete-tenant.sql                        (auto-resolves schema_name, FK-safe)
  delete-tenant.sh                         (dual-mode: API or raw SQL)

docs/
  CHANGELOG.md                             (v5.2.0 entry)
  user-manual.md                           (sections 21-26)
  operations-runbook.md                    (this file's sibling)
  sprint-tier1-technical.md                (this file)
```

---

## 10. What's NOT in scope of Tier 1 (deferred)

- **Online payments for tour bookings** (V1 has `payment_status='pending'`, no MercadoPago integration on the booking flow)
- **Multi-language tour content** (tour_packages has a `languages` array but each tour is described in one language only)
- **Tour reviews / ratings**
- **Seasonal pricing rules** for tours (only static `price_override` per inventory row)
- **OTA channel manager** for tours (Viator, GetYourGuide, etc. — only iCal one-way for vacation_rental today)
- **Dental clinical history / prescriptions / consent forms** (treatment_plans only tracks session count + cost)
- **Real estate MLS integration** (only manual catalog)
- **Real estate document signing / contract templates**
- **WhatsApp Flows for dental pre-intake**
- **Recall config UI** (endpoints exist but no settings page yet)

Roadmap continuation lives in `docs/vertical-strategy.md`.
