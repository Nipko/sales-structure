# Billing module

Provider-capability-driven subscription billing for Parallly.

## Live provider boundary (August 2026)

- **Wompi is the only live platform subscription rail**. Colombia/COP uses
  reusable payment sources and Parallly's internal renewal engine.
- **Mercado Pago is not a subscription provider**. Its remaining live use is
  tenant-owned credentials and payment links for tenant → end-customer sales in
  `tenant-payments`; there are no global `MP_*` subscription credentials.
- Stripe remains an adapter/capability for a future international rollout; it
  is not a fallback for unsupported countries unless Billing Ops explicitly
  enables and routes it.
- Mock is test-only.

Operational details and go-live checks: [`docs/billing-runbook.md`](../../../../../docs/billing-runbook.md).

## Request flow

```text
public plan/config endpoints
  → PaymentRoutingService (kill switch → country → tenant pin → frozen sub)
  → browser tokenization with provider public key
  → PaymentSourceService (explicit consent + AVAILABLE source)
  → BillingService (trial/change/cancel/pause/resume)
  → RenewalSchedulerService / SubscriptionEngineService
  → provider transaction (async)
  → webhook + poll reconciliation
  → payment, entitlement and fiscal events
```

Wompi has no remote subscription object. The internal engine owns billing
anchor, period, price/currency, next charge, retries and pending plan changes.
Every Wompi transaction starts asynchronous; only a terminal `APPROVED` result
can activate a paid subscription or promote a charged upgrade.

## Main files

| Area | Files |
|---|---|
| Tenant subscription API | `billing.controller.ts`, `billing.service.ts` |
| Public plan/checkout contract | `billing-public.controller.ts`, `billing-plan-catalog.service.ts` |
| Runtime routing and method flags | `payment-routing.service.ts`, `adapters/provider-capabilities.ts` |
| Wompi configuration/HTTP | `adapters/wompi-config.service.ts`, `adapters/wompi.adapter.ts` |
| Sources and legal consent | `recurring/payment-source.controller.ts`, `recurring/payment-source.service.ts` |
| Renewal execution | `recurring/renewal-scheduler.service.ts`, `recurring/subscription-engine.service.ts` |
| Dunning/proration | `recurring/dunning.service.ts`, `recurring/proration.service.ts` |
| Webhooks/reconciliation | `webhook.controller.ts`, `processors/reconciliation.processor.ts` |
| Super admin | `billing-admin.controller.ts` |
| Tenant → customer links (Mercado Pago only) | `../tenant-payments/tenant-payments.controller.ts`, `../tenant-payments/tenant-payments.service.ts` |

## Invariants

1. Prices, trials, cycles and limits come from active `billing_plans` rows.
2. No implicit provider, method, country, cycle or plan fallback.
3. `pending_auth` never grants paid entitlement.
4. Card PAN/CVV never reaches this API; the browser sends only provider tokens.
5. Wompi sources require both current acceptance contracts and explicit consent.
6. Nequi/Bancolombia tokens may be pending locally, but the remote payment
   source is created only after token `APPROVED`; charges require `AVAILABLE`.
7. Provider references and attempt rows are idempotent; do not mutate payment or
   subscription states by hand.
8. A charged plan change is pending until settlement succeeds. Failure leaves
   the tenant on the previous plan.
9. `isInternal` tenants cannot be charged by the engine and fiscal records the
   skip instead of issuing a sales invoice.
10. Sandbox Wompi payments never issue a production DIAN invoice.

## Required Wompi configuration

```dotenv
WOMPI_PUBLIC_KEY=
WOMPI_PRIVATE_KEY=
WOMPI_EVENTS_SECRET=
WOMPI_INTEGRITY_SECRET=
WOMPI_MAX_TRANSACTION_COP_CENTS=
WOMPI_DAILY_CAP_COP_CENTS=
```

All four keys must share test or production prefixes. The events secret is not
the private key. The webhook endpoint is `POST /billing/webhook/wompi` and must
validate Wompi's event checksum before dispatch.

Runtime switches live in platform settings and are edited in `/admin/plans`:

- `billing.providers_enabled`
- `billing.default_provider_by_country`
- `billing.wompi_methods_enabled` (`card`, `nequi`, `bancolombiaTransfer`)

An empty enabled-method array is a deliberate kill switch.

## Lifecycle

```text
pending_auth → trialing → active → past_due → expired
                    └──────────────→ cancelled
```

- Two-phase onboarding creates tenant/subscription first, then attaches a
  tenant-owned source. No trial/paid access is fabricated while authorization
  is missing.
- Trial conversion freezes the amount/currency and schedules `nextChargeAt`.
- Monthly/annual renewal uses the subscription anchor and timezone.
- Same-cycle lower-price downgrade is scheduled at period end.
- Charge-bearing upgrade/cycle change uses a pending target and proration.
- Pause/resume/retry are local engine operations for Wompi, not calls to a
  nonexistent remote subscription.

## Fiscal boundary

Successful payments emit the normalized billing event consumed by the fiscal
module. The generic billing PDF is a commercial receipt; DIAN FEVs and credit
notes are owned by `modules/fiscal`. Internal, sandbox and zero-consideration
payments get durable `skipped` decisions; configuration gaps get retryable
`blocked_config` rows.

## Testing

Relevant suites include:

- `adapters/wompi*.spec.ts`
- `recurring/payment-source*.spec.ts`
- `recurring/subscription-engine*.spec.ts`
- `recurring/renewal-scheduler*.spec.ts`
- `recurring/dunning*.spec.ts`
- `billing.service.spec.ts`
- `webhook.controller.spec.ts`

Production enablement still requires real minimum-value smoke tests for each
method, webhook finality/idempotency, renewal, upgrade/downgrade, cancellation,
dunning and the fiscal result. A green sandbox suite is not merchant activation.
