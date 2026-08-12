# Billing — Ciclo mensual/anual y billing-ops

_Última actualización: 2026-07-23_

Referencia del ciclo de facturación **mensual/anual** y de las operaciones de billing cross-tenant (super_admin). El ciclo anual es first-class en el código pero antes no estaba documentado en ningún doc vivo. Para el setup de MercadoPago ver [`billing-mp-setup.md`](billing-mp-setup.md); para el runbook operativo, [`billing-runbook.md`](billing-runbook.md).

> **Modelo en una línea:** un plan (`billing_plans`) tiene precio **mensual** y, opcionalmente, precio **anual** por país. El anual es un `preapproval_plan` **separado** en MercadoPago (frequency 12 meses), cuyo id se guarda en `priceLocalOverrides[country].annual.mpPlanId`. El sync mensual y el anual son **independientes** e idempotentes por ciclo.

---

## 1. Estructura de precios (`priceLocalOverrides`)

Cada plan guarda overrides de precio por país en el JSON `priceLocalOverrides`:

```jsonc
{
  "CO": {
    "currency": "COP",
    "amountCents": <precio mensual local en centavos>,
    "mpPlanId": "<preapproval_plan_id MENSUAL>",
    "annual": {
      "currency": "COP",
      "amountCents": <TOTAL del año en centavos>,   // no es mensual×12 automático
      "mpPlanId": "<preapproval_plan_id ANUAL>"
    }
  }
}
```

- El **precio anual es explícito** (`annual.amountCents` = total del año). No hay derivación automática mensual×12 ni una fuente USD/FX para el anual — el descuento (~15%) se refleja al setear ese total. Es el editor de planes (o el seed) quien lo define.
- El mensual y el anual tienen **`mpPlanId` distintos** (dos preapproval_plans en MP).

## 2. Sincronización a MercadoPago

MP requiere un `preapproval_plan` por (plan × país × ciclo). Dos caminos, ambos **idempotentes por ciclo** (saltan si ese ciclo ya existe, salvo `--force`):

**Desde el panel super_admin** (`billing-admin.controller.ts` → `POST /billing-admin/plans/:slug/sync-mp`):
```jsonc
{ "country": "CO", "cycle": "year" }   // cycle: "month" (default) | "year"
```
Fail-closed: si no hay precio anual local para el país, responde error pidiendo definir `priceLocalOverrides.<country>.annual.amountCents` **antes** de sincronizar el ciclo anual (no crea un plan anual "adivinando" el precio).

**Por script** (`apps/api/scripts/sync-mp-plans.js`):
```bash
node scripts/sync-mp-plans.js --country=CO --cycle=annual   # alias: --cycle=year (frequency 12 meses)
```

> ⚠️ **El deploy no sincroniza ningún ciclo con MercadoPago.** La integración está en
> pausa desde agosto de 2026 y el workflow omite de forma explícita el preflight y el
> sync. Cuando la pasarela vuelva a estar habilitada, los planes mensuales y anuales
> deberán crearse en una operación controlada desde el panel o los scripts. Si falta
> el `mpPlanId` del ciclo solicitado, la suscripción falla en vez de cobrar mal.

## 3. Suscripción y cambio de ciclo

- Al crear/cambiar una suscripción, el ciclo elegido (`month`/`year`) determina qué `mpPlanId` se usa (el mensual o el `annual.mpPlanId`).
- **Cambiar de ciclo** (mensual↔anual) implica **cancelar y recrear** el preapproval en MercadoPago (MP no permite mutar la frecuencia de un preapproval existente), igual que un cambio de plan. El ciclo vigente queda persistido en la metadata de la suscripción.

## 4. Frontend

- **Dashboard** (`settings/billing`): toggle **mensual/anual** que muestra el precio de cada ciclo y el ahorro del anual.
- **Landing** (`/precios`, `apps/landing/(marketing)/precios`): página de precios **data-driven** — lee los planes reales desde `billing_plans` (no precios hardcodeados), con el toggle mensual/anual.

## 5. Billing-ops cross-tenant (super_admin)

`billing-admin.controller.ts` expone operaciones de plataforma sobre todos los tenants:

| Acción | Endpoint |
|--------|----------|
| Sync de plan+país+ciclo a MP | `POST /billing-admin/plans/:slug/sync-mp` |
| Reconciliación on-demand (global / por tenant) | `POST /billing-admin/reconcile`, `POST /billing-admin/tenants/:tenantId/reconcile` |
| Refund inline de un pago | `POST /billing-admin/payments/:paymentId/refund` |
| Editar plan (precio/overrides) con auditoría | `PUT /billing-admin/plans/:slug` |
| Vistas cross-tenant de suscripciones / pagos / eventos | endpoints de listado bajo `/billing-admin` |

Toda edición de precio/plan de catálogo queda **auditada** (se registra `from`/`to` de los campos, incl. `priceLocalOverrides`). Los checkouts de **créditos SMS** (pago único MP) van por `sms-checkout.*`, no por el ciclo de suscripción.

## 6. Planes (fuente de verdad)

Los planes, ciclos y features aplicables viven en la tabla runtime `billing_plans` y
se editan con auditoría desde `/admin/plans`. El archivo
`apps/api/prisma/seed-billing-plans.js` es solo un baseline **create-only** para filas
faltantes; no actualiza planes existentes. Los precios locales por país viven en
`priceLocalOverrides`. Los documentos fechados de rentabilidad sirven para análisis,
no como contrato de precio vigente.

---

## Referencias

- [`billing-runbook.md`](billing-runbook.md) — runbook operativo de billing
- [`billing-mp-setup.md`](billing-mp-setup.md) — setup de MercadoPago
- [`plan-profitability-2026-07.md`](plan-profitability-2026-07.md) — precios COP por país y rentabilidad
- `apps/api/src/modules/billing/billing-admin.controller.ts`, `apps/api/scripts/sync-mp-plans.js`, `apps/api/prisma/seed-billing-plans.js`
