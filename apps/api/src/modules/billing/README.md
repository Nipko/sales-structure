# Billing Module

Provider-agnostic subscription billing for Parallly. MercadoPago is the primary provider in LatAm; Stripe will be added later for international markets without touching the service layer.

The authoritative reference for the plan and the decisions that shaped it is [`docs/billing-plan.md`](../../../../../docs/billing-plan.md). This README documents the **code layout** and current implementation state.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  BillingService  (pure business logic, provider-agnostic)│
│  - createTrialSubscription / upgrade / cancel            │
│  - handleBillingEvent (state machine + idempotency)      │
│  - getActiveSubscription                                 │
└───────┬─────────────────────────────────────────────────┘
        │ uses
        ▼
┌─────────────────────────────────────────────────────────┐
│  PaymentProviderFactory                                  │
│  - getByName(providerName) → IPaymentProvider            │
└───────┬─────────────────────────────────────────────────┘
        │ resolves to
        ▼
┌──────────────────┐    ┌──────────────────┐   ┌──────────┐
│ MercadoPagoAdapter│    │ StripeAdapter   │   │ Mock     │
│ (Sprint 2)        │    │ (Phase 4+)       │   │ (in-mem) │
└──────────────────┘    └──────────────────┘   └──────────┘
```

Every payment provider implements the same `IPaymentProvider` interface. The factory selects the adapter per request based on `Tenant.paymentProvider`. Swapping providers is a factory change — `BillingService` never sees a concrete adapter.

---

## File layout

```
billing/
├── billing.module.ts                  NestJS module registration
├── billing.service.ts                 Business logic + state machine
├── billing.service.spec.ts            12 unit tests (state machine, idempotency, validation)
├── billing.controller.ts              Tenant REST: /billing/plans, /billing/subscription
├── webhook.controller.ts              POST /billing/webhook/:provider (stub until Sprint 2)
├── payment-provider.factory.ts        Adapter selector
├── adapters/
│   ├── payment-provider.interface.ts  The contract — IPaymentProvider
│   ├── mock-payment-provider.adapter.ts  Deterministic in-memory (tests + dev)
│   └── mercadopago.adapter.ts         MP Preapproval API (stub until Sprint 2)
├── processors/
│   └── reconciliation.processor.ts    Cron reconciliation vs. GET /preapproval (Sprint 2)
└── types/
    ├── subscription-status.enum.ts    6 internal states
    ├── billing-event.enum.ts          12 normalized events
    └── provider-types.ts              ProviderCustomer, ProviderSubscription, NormalizedBillingEvent, DTOs
```

---

## Persistence

Global tables (in `public` schema, not tenant-scoped — billing crosses tenants):

| Table | Purpose |
|---|---|
| `billing_plans` | Catalog. Prices in USD cents. Per-country overrides in `price_local_overrides` JSONB. `mp_plan_id` + `stripe_plan_id` populated by per-provider sync scripts |
| `billing_subscriptions` | One active row per tenant (UNIQUE `tenant_id`). `status` is the internal enum; adapters translate from provider vocabulary |
| `billing_events` | Append-only audit log. UNIQUE `(provider, provider_event_id)` is the webhook idempotency store |
| `billing_payments` | Charge history for invoices + dashboard. `invoice_pdf_url` populated by Phase 4 fiscal integration |

Denormalized on `tenants` for the hot path (rate limiter, middleware): `subscription_status`, `trial_ends_at`, `current_period_end`, `payment_provider`, `payment_provider_customer_id`, `billing_email`, `billing_country`. `BillingService` keeps them in sync on every state transition.

---

## State machine

```
pending_auth ──► trialing ──► active ──► past_due ──► cancelled ──► expired
                                 ▲          │             │
                                 └──────────┘             ▼
                              (retry OK)              (no recovery)
```

Transitions are enforced by `deriveSubscriptionPatch()` inside `handleBillingEvent`. Do not mutate `billing_subscriptions.status` from outside the service.

---

## Normalized event taxonomy

Every webhook from every provider maps to one of 12 events published via `EventEmitter2`:

```
billing.subscription.created        billing.payment.succeeded
billing.subscription.activated      billing.payment.failed
billing.subscription.past_due       billing.payment.refunded
billing.subscription.cancelled      billing.trial.started
billing.subscription.expired        billing.trial.ending_soon
billing.subscription.plan_changed   billing.trial.ended
```

Listeners subscribe with `@OnEvent('billing.payment.succeeded')`. They never see raw provider payloads.

---

## Adding a new payment provider

1. Create `adapters/<provider>.adapter.ts` implementing `IPaymentProvider`.
2. Map the provider's native status strings to `SubscriptionStatus` inside the adapter.
3. Map the provider's webhook topics to `BillingEventType` inside `parseWebhookEvent`.
4. Register the adapter as a provider in `billing.module.ts`.
5. Add a branch in `PaymentProviderFactory.getByName()`.
6. Extend `billing_plans` with the new provider's plan id column (or store in a JSONB map).
7. Write a sync script `scripts/sync-<provider>-plans.ts` that creates the 4 plans on the provider side and populates the plan ids.

No changes to `BillingService`, controllers, or listeners are required.

---

## Current state (April 23, 2026 — end of Sprint 1)

Done:
- Schema + migration applied
- `IPaymentProvider` interface + normalized types
- `BillingService` with full business logic (create / upgrade / cancel / handleBillingEvent / getActive)
- `PaymentProviderFactory`
- `MockPaymentProvider` — deterministic in-memory, test helpers `simulateWebhookEvent()` / `buildPayment()` / `reset()`
- `MercadoPagoAdapter` — skeleton (throws NotImplementedException until Sprint 2)
- `BillingWebhookController` — 200 stub until Sprint 2
- 12 unit tests (state machine, idempotency, input validation), green
- 5 billing email templates auto-seeded
- Seed script for 4 billing plans (run with `npx ts-node prisma/seed-billing-plans.ts`)
- Server-side enforcement of `maxAgents` per plan (commit `837c183`)

Pending:
- Sprint 2: MercadoPago adapter real HTTP + HMAC webhook verification + reconciliation cron + raw-body middleware for webhooks. SDK chosen: `mercadopago@2.12.0` official — it exposes `PreApproval` (create/get/search/update) and `PreApprovalPlan` classes with proper TypeScript types including `auto_recurring.free_trial`, `summarized.semaphore`, `card_token_id`, `external_reference`. No need for `mercadopago-extended` or raw HTTP.
- Sprint 3: Onboarding plan picker, dashboard billing page, email sender wiring, server-side enforcement of remaining plan limits (services, automations, broadcasts, AI messages)
- Sprint 4: Fiscal integration (Facturapi for MX+CL+AR)
- Sprint 5: Beta rollout (feature flag per tenant)

---

## Ops runbook (stub — fill in as we hit real incidents)

- **A subscription is stuck in `past_due` after the provider reports a successful retry**: The reconciliation cron (hourly) should recover within 1 hour. If not, check `billing_events` for the relevant `billing.payment.succeeded` — if missing, the webhook never arrived; run `listCustomerSubscriptions(providerCustomerId)` against the adapter and call `handleBillingEvent` manually from a script.
- **Manual refund**: issue refund on the provider dashboard; the webhook fires `billing.payment.refunded` which BillingService records into `billing_payments`. No manual DB work needed.
- **Change a tenant's plan outside the upgrade flow**: call `BillingService.upgradeSubscription(tenantId, newSlug)` via a super-admin script. Do not mutate rows directly — denormalized fields on `tenants` and provider state would drift.
